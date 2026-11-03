/* Lodestar lighting — walls, doors and light sources (window.LodestarLight).
 *
 * parseVtt(text) reads a Universal VTT map (.dd2vtt from Dungeondraft or Dungeon Alchemist,
 * .uvtt, .df2vtt from DungeonFog): its image, grid, wall lines, doors and lights, with every
 * position turned into map pixels.
 *
 * buildLightmap() paints the darkness over a map: a dark wash with each light cut out of it,
 * as far as the light reaches and only where walls and closed doors let it through, plus a
 * second layer carrying the lights' colours. Both canvases cover the whole map (scaled down,
 * like the fog), and app.js redraws them only when the walls, doors, lights or darkness change.
 */
(function () {
  "use strict";

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // "ffeccd8b" (alpha first, as the format writes it), "eccd8b" or "#eccd8b" → "#eccd8b".
  function toHex(color) {
    const s = String(color || "").replace(/^#/, "").toLowerCase();
    if (/^[0-9a-f]{8}$/.test(s)) return `#${s.slice(2)}`;
    if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
    return "";
  }

  function luminance(hex) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    if (!Number.isFinite(n)) return 1;
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  }

  function imageDataUrl(b64) {
    const s = String(b64).trim();
    if (s.startsWith("data:")) return s;
    const type = s.startsWith("/9j/") ? "image/jpeg" : s.startsWith("UklGR") ? "image/webp" : "image/png";
    return `data:${type};base64,${s}`;
  }

  // Positions in the file are in grid squares from map_origin; `size` is the map in pixels as
  // the file describes it (the image can come out a different size, so app.js rescales).
  function parseVtt(text) {
    let d;
    try {
      d = JSON.parse(text);
    } catch {
      throw new Error("it isn't a Universal VTT file (not JSON)");
    }
    const res = d?.resolution || {};
    const cell = Number(res.pixels_per_grid) || 0;
    if (!d?.image || cell <= 0) throw new Error("it has no map image or grid size");
    const ox = Number(res.map_origin?.x) || 0;
    const oy = Number(res.map_origin?.y) || 0;
    const at = (p) => ({ x: ((Number(p?.x) || 0) - ox) * cell, y: ((Number(p?.y) || 0) - oy) * cell });
    const lines = [...(Array.isArray(d.line_of_sight) ? d.line_of_sight : []), ...(Array.isArray(d.objects_line_of_sight) ? d.objects_line_of_sight : [])];
    const walls = lines.filter((line) => Array.isArray(line) && line.length >= 2).map((line) => line.map(at));
    const doors = (Array.isArray(d.portals) ? d.portals : [])
      .filter((p) => Array.isArray(p?.bounds) && p.bounds.length >= 2)
      .map((p) => ({ a: at(p.bounds[0]), b: at(p.bounds[1]), open: p.closed === false }));
    const lights = (Array.isArray(d.lights) ? d.lights : [])
      .map((l) => ({
        ...at(l?.position),
        range: Math.max(0, Number(l?.range) || 0) * cell,
        color: toHex(l?.color) || "#ffd9a0",
        intensity: clamp(Number(l?.intensity) || 1, 0.05, 1),
        shadows: l?.shadows !== false,
      }))
      .filter((l) => l.range > 0);
    return {
      image: imageDataUrl(d.image),
      cell,
      size: { w: (Number(res.map_size?.x) || 0) * cell, h: (Number(res.map_size?.y) || 0) * cell },
      walls,
      doors,
      lights,
      ambient: toHex(d.environment?.ambient_light) || "#ffffff",
      baked: !!d.environment?.baked_lighting,
    };
  }

  // Wall segments [ax, ay, bx, by] from the walls (polylines) and the closed doors.
  function segmentsOf(walls, doors) {
    const segs = [];
    (walls || []).forEach((pts) => {
      for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y]);
    });
    (doors || []).forEach((d) => {
      if (!d.open) segs.push([d.a.x, d.a.y, d.b.x, d.b.y]);
    });
    return segs;
  }

  // Distance from (x, y) to the segment [ax, ay, bx, by].
  function segDistance(x, y, [ax, ay, bx, by]) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  }

  // What a light at (x, y) reaches out to radius r: a polygon (points by angle), with every
  // wall in range casting a shadow. Rays go to each wall end inside the circle and to where
  // walls cross its edge (and just either side of each), plus every 15°, and stop at the
  // nearest wall; a box around the light makes sure every ray stops somewhere.
  function visibility(x, y, r, segs) {
    const near = segs.filter((s) => segDistance(x, y, s) <= r);
    const angles = [];
    const ends = new Set();
    const aim = (px, py) => {
      const key = `${px},${py}`;
      if (ends.has(key)) return;
      ends.add(key);
      const a = Math.atan2(py - y, px - x);
      angles.push(a - 1e-4, a, a + 1e-4);
    };
    near.forEach(([ax, ay, bx, by]) => {
      if (Math.hypot(ax - x, ay - y) <= r) aim(ax, ay);
      if (Math.hypot(bx - x, by - y) <= r) aim(bx, by);
      // Where the wall crosses the circle: |A + u(B - A) - O| = r for u in [0, 1].
      const dx = bx - ax;
      const dy = by - ay;
      const fx = ax - x;
      const fy = ay - y;
      const qa = dx * dx + dy * dy;
      const qb = 2 * (fx * dx + fy * dy);
      const disc = qb * qb - 4 * qa * (fx * fx + fy * fy - r * r);
      if (qa > 0 && disc > 0) {
        [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)].forEach((u) => {
          if (u > 0 && u < 1) aim(ax + u * dx, ay + u * dy);
        });
      }
    });
    for (let k = 0; k < 24; k++) angles.push((k * Math.PI) / 12 - Math.PI);
    const x0 = x - r * 1.01;
    const y0 = y - r * 1.01;
    const x1 = x + r * 1.01;
    const y1 = y + r * 1.01;
    near.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]);
    const pts = [];
    angles.forEach((a) => {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let best = Infinity;
      for (const [ax, ay, bx, by] of near) {
        const sx = bx - ax;
        const sy = by - ay;
        const den = dx * sy - dy * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((ax - x) * sy - (ay - y) * sx) / den;
        const u = ((ax - x) * dy - (ay - y) * dx) / den;
        if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
      }
      if (best < Infinity) pts.push({ a, x: x + dx * best, y: y + dy * best });
    });
    pts.sort((p, q) => p.a - q.a);
    return pts;
  }

  // Each light's shadow polygon, kept in `cache` until the walls change or a door within its
  // reach opens or closes (so a door click only redoes the lights near that door).
  function lightPolygons(scene, cache) {
    const walls = scene.walls || [];
    const doors = scene.doors || [];
    // By content, not identity: the player display gets a fresh copy of the walls with every sync.
    let hash = walls.length;
    walls.forEach((pts) => pts.forEach((p) => (hash = (hash * 31 + p.x * 7 + p.y * 13) % 1e9)));
    if (cache.wallKey !== hash) {
      cache.wallKey = hash;
      cache.wallSegs = segmentsOf(walls, []);
      cache.byLight = new Map();
    }
    const lights = scene.lights || [];
    if (cache.byLight.size > 4 * lights.length + 16) cache.byLight.clear();
    return lights.map((l) => {
      if (!l.shadows) return null;
      const near = [];
      let doorKey = "";
      doors.forEach((d, i) => {
        if (segDistance(l.x, l.y, [d.a.x, d.a.y, d.b.x, d.b.y]) > l.range) return;
        doorKey += `${i}${d.open ? "o" : "c"}`;
        if (!d.open) near.push([d.a.x, d.a.y, d.b.x, d.b.y]);
      });
      const key = `${l.x},${l.y},${l.range}|${doorKey}`;
      let poly = cache.byLight.get(key);
      if (!poly) {
        poly = visibility(l.x, l.y, l.range, cache.wallSegs.concat(near));
        cache.byLight.set(key, poly);
      }
      return poly;
    });
  }

  // Paint the darkness for `scene` ({ walls, doors, lights, darkness }) into `dark`, and the
  // lights' colours into `tint`; both are sized to the map times `scale`. `cache` (see
  // lightPolygons) carries the shadow polygons from one call to the next.
  function buildLightmap(dark, tint, scene, scale, cache = {}) {
    const dctx = dark.getContext("2d");
    const tctx = tint.getContext("2d");
    [dctx, tctx].forEach((c) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    });
    dctx.fillStyle = `rgba(3, 4, 10, ${clamp(scene.darkness, 0, 1)})`;
    dctx.fillRect(0, 0, dark.width, dark.height);
    const lights = scene.lights || [];
    const polys = lightPolygons(scene, cache);
    lights.forEach((l, i) => {
      const poly = polys[i];
      const clip = (c) => {
        if (!poly) return;
        c.beginPath();
        poly.forEach((p, k) => (k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.closePath();
        c.clip();
      };
      const glow = (c, stops) => {
        const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.range);
        stops.forEach(([at, color]) => g.addColorStop(at, color));
        c.fillStyle = g;
        c.fillRect(l.x - l.range, l.y - l.range, 2 * l.range, 2 * l.range);
      };
      // Cut the light out of the darkness: bright for its inner half, fading to its edge.
      dctx.save();
      dctx.setTransform(scale, 0, 0, scale, 0, 0);
      clip(dctx);
      dctx.globalCompositeOperation = "destination-out";
      glow(dctx, [
        [0, `rgba(0, 0, 0, ${l.intensity})`],
        [0.5, `rgba(0, 0, 0, ${0.85 * l.intensity})`],
        [1, "rgba(0, 0, 0, 0)"],
      ]);
      dctx.restore();
      // Its colour: a warm (or cold) cast over what it lights.
      const n = parseInt(l.color.slice(1), 16);
      const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
      tctx.save();
      tctx.setTransform(scale, 0, 0, scale, 0, 0);
      clip(tctx);
      glow(tctx, [
        [0, `rgba(${rgb}, ${0.55 * l.intensity})`],
        [1, `rgba(${rgb}, 0)`],
      ]);
      tctx.restore();
    });
  }

  window.LodestarLight = { parseVtt, visibility, segmentsOf, buildLightmap, luminance };
})();
