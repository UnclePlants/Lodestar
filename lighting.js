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

  // Where the ray (x, y) + t·(dx, dy) meets a segment, as t (Infinity if it doesn't).
  function hitT(x, y, dx, dy, [ax, ay, bx, by]) {
    const sx = bx - ax;
    const sy = by - ay;
    const den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-12) return Infinity;
    const t = ((ax - x) * sy - (ay - y) * sx) / den;
    const u = ((ax - x) * dy - (ay - y) * dx) / den;
    return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
  }

  /* A uniform grid over the walls (64 cells across), so a ray only looks at the walls in the
     cells it passes through, nearest cell first, and stops at the first wall it meets. */

  // Visit the cells along (x, y) + t·(dx, dy) for t from t0 to t1, in order; visit(cell, tExit)
  // returns false to stop early. tExit is where the line leaves that cell.
  function walkGrid(g, x, y, dx, dy, t0, t1, visit) {
    let cx = clamp(Math.floor((x + dx * t0 - g.x0) / g.cell), 0, g.cols - 1);
    let cy = clamp(Math.floor((y + dy * t0 - g.y0) / g.cell), 0, g.rows - 1);
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const tdx = dx ? g.cell / Math.abs(dx) : Infinity;
    const tdy = dy ? g.cell / Math.abs(dy) : Infinity;
    let tx = dx ? (g.x0 + (cx + (dx > 0 ? 1 : 0)) * g.cell - x) / dx : Infinity;
    let ty = dy ? (g.y0 + (cy + (dy > 0 ? 1 : 0)) * g.cell - y) / dy : Infinity;
    for (let guard = 0; guard < 100000; guard++) {
      const tExit = Math.min(tx, ty);
      if (visit(cy * g.cols + cx, tExit) === false || tExit >= t1) return;
      if (tx < ty) {
        cx += sx;
        tx += tdx;
        if (cx < 0 || cx >= g.cols) return;
      } else {
        cy += sy;
        ty += tdy;
        if (cy < 0 || cy >= g.rows) return;
      }
    }
  }

  function buildGrid(segs) {
    if (!segs.length) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    segs.forEach(([ax, ay, bx, by]) => {
      x0 = Math.min(x0, ax, bx);
      y0 = Math.min(y0, ay, by);
      x1 = Math.max(x1, ax, bx);
      y1 = Math.max(y1, ay, by);
    });
    const cell = Math.max(x1 - x0, y1 - y0, 1) / 64;
    const g = { x0, y0, cell, cols: Math.floor((x1 - x0) / cell) + 1, rows: Math.floor((y1 - y0) / cell) + 1, cells: [], segs, stamp: new Uint32Array(segs.length), tick: 0 };
    segs.forEach(([ax, ay, bx, by], i) => walkGrid(g, ax, ay, bx - ax, by - ay, 0, 1, (c) => void (g.cells[c] || (g.cells[c] = [])).push(i)));
    return g;
  }

  // The part [t0, t1] of a ray that's over the grid, or null if it misses it.
  function gridSpan(g, x, y, dx, dy) {
    let t0 = 0;
    let t1 = Infinity;
    const axes = [
      [x, dx, g.x0, g.x0 + g.cols * g.cell],
      [y, dy, g.y0, g.y0 + g.rows * g.cell],
    ];
    for (const [p, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-12) {
        if (p < lo || p > hi) return null;
        continue;
      }
      const a = (lo - p) / d;
      const b = (hi - p) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    return t0 <= t1 ? [t0, t1] : null;
  }

  // How far the ray goes before it meets a wall in `g` or one of `extras`.
  function castRay(g, extras, x, y, dx, dy) {
    let best = Infinity;
    for (const s of extras) best = Math.min(best, hitT(x, y, dx, dy, s));
    if (!g) return best;
    const span = gridSpan(g, x, y, dx, dy);
    if (!span || span[0] >= best) return best;
    const tick = ++g.tick;
    walkGrid(g, x, y, dx, dy, span[0], Math.min(span[1], best), (c, tExit) => {
      const list = g.cells[c];
      if (list) {
        for (const i of list) {
          if (g.stamp[i] === tick) continue; // a long wall sits in several cells
          g.stamp[i] = tick;
          best = Math.min(best, hitT(x, y, dx, dy, g.segs[i]));
        }
      }
      return best > tExit; // on to the next cell only while nothing's been met in this one
    });
    return best;
  }

  // What can be seen (or lit) from (x, y) out to radius r: a polygon of points by angle, with
  // the walls in grid `g` and the `extras` (closed doors) casting shadows. Rays go exactly to
  // each wall end within `exact` of the point (and just either side of it), and, for a small
  // circle, to where walls cross its edge; others go evenly around (every 15°, or every
  // quarter degree for a long view). Each stops at the first wall, or at a box around the circle.
  function visibility(x, y, r, g, extras = [], exact = r) {
    const e = Math.min(r, exact);
    const angles = [];
    const ends = new Set();
    const aim = (px, py) => {
      const key = `${px},${py}`;
      if (ends.has(key)) return;
      ends.add(key);
      const a = Math.atan2(py - y, px - x);
      angles.push(a - 1e-4, a, a + 1e-4);
    };
    const consider = ([ax, ay, bx, by]) => {
      if (Math.hypot(ax - x, ay - y) <= e) aim(ax, ay);
      if (Math.hypot(bx - x, by - y) <= e) aim(bx, by);
      if (e < r) return;
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
    };
    if (g) {
      // The walls in the cells around the point, out to e.
      const tick = ++g.tick;
      const c0 = clamp(Math.floor((x - e - g.x0) / g.cell), 0, g.cols - 1);
      const c1 = clamp(Math.floor((x + e - g.x0) / g.cell), 0, g.cols - 1);
      const r0 = clamp(Math.floor((y - e - g.y0) / g.cell), 0, g.rows - 1);
      const r1 = clamp(Math.floor((y + e - g.y0) / g.cell), 0, g.rows - 1);
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const list = g.cells[cy * g.cols + cx];
          if (!list) continue;
          for (const i of list) {
            if (g.stamp[i] === tick) continue;
            g.stamp[i] = tick;
            if (segDistance(x, y, g.segs[i]) <= e) consider(g.segs[i]);
          }
        }
      }
    }
    extras.forEach((s) => segDistance(x, y, s) <= e && consider(s));
    const n = e < r ? 1440 : 24;
    for (let k = 0; k < n; k++) angles.push((k * 2 * Math.PI) / n - Math.PI);
    const x0 = x - r * 1.01;
    const y0 = y - r * 1.01;
    const x1 = x + r * 1.01;
    const y1 = y + r * 1.01;
    const stops = extras.concat([
      [x0, y0, x1, y0],
      [x1, y0, x1, y1],
      [x1, y1, x0, y1],
      [x0, y1, x0, y0],
    ]);
    const pts = angles.map((a) => {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const t = castRay(g, stops, x, y, dx, dy);
      return { a, x: x + dx * t, y: y + dy * t };
    });
    pts.sort((p, q) => p.a - q.a);
    return pts;
  }

  // The walls as a grid, and the shadow polygons worked out against them, kept in `cache`
  // until the walls change (checked by content, not identity: the player display gets a fresh
  // copy of the walls with every sync).
  function wallGrid(walls, cache) {
    let hash = walls.length;
    walls.forEach((pts) => pts.forEach((p) => (hash = (hash * 31 + p.x * 7 + p.y * 13) % 1e9)));
    if (cache.wallKey !== hash) {
      cache.wallKey = hash;
      cache.grid = buildGrid(segmentsOf(walls, []));
      cache.byLight = new Map();
      cache.byViewer = new Map();
    }
    return cache.grid;
  }

  // Each light's shadow polygon, kept in `cache` until the walls change or a door within its
  // reach opens or closes (so a door click only redoes the lights near that door).
  function lightPolygons(scene, cache) {
    const doors = scene.doors || [];
    const grid = wallGrid(scene.walls || [], cache);
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
        poly = visibility(l.x, l.y, l.range, grid, near);
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

  function tracePoly(c, poly) {
    c.beginPath();
    poly.forEach((p, k) => (k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
  }

  // Paint white into `out` wherever a viewer ({ x, y, darkvision } in map px) can see: their
  // line of sight out to `scene.sight` (exact for walls within `scene.exact`, a quarter-degree
  // fan beyond), which walls and closed doors block, and, when
  // `scene.dark` is set, only where a light reaches or within their darkvision. `dvOut` (the
  // same size, optional) gets just the darkvision part, so the darkness can be lifted there.
  // Both are sized to the map times `scale`; `cache` keeps the lines of sight and light
  // shadows between calls.
  function buildVision(out, scene, scale, cache = {}, dvOut = null) {
    const octx = out.getContext("2d");
    const dvctx = dvOut?.getContext("2d");
    [octx, dvctx].forEach((c) => {
      if (!c) return;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    });
    const viewers = scene.viewers || [];
    if (!viewers.length) return;
    const grid = wallGrid(scene.walls || [], cache);
    const doors = scene.doors || [];
    const closed = segmentsOf([], doors);
    const doorBits = doors.map((d) => (d.open ? 1 : 0)).join("");
    const lights = scene.lights || [];
    const lightPolys = scene.dark ? lightPolygons(scene, cache) : null;
    if (cache.byViewer.size > 64) cache.byViewer.clear();
    const tmp = cache.tmp || (cache.tmp = document.createElement("canvas"));
    tmp.width = out.width; // also clears it
    tmp.height = out.height;
    const t = tmp.getContext("2d");
    viewers.forEach((v) => {
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = "source-over";
      t.clearRect(0, 0, tmp.width, tmp.height);
      t.setTransform(scale, 0, 0, scale, 0, 0);
      t.fillStyle = "#fff";
      if (lightPolys) {
        lights.forEach((l, i) => {
          t.save();
          if (lightPolys[i]) {
            tracePoly(t, lightPolys[i]);
            t.clip();
          }
          t.beginPath();
          t.arc(l.x, l.y, l.range, 0, Math.PI * 2);
          t.fill();
          t.restore();
        });
        if (v.darkvision > 0) {
          t.beginPath();
          t.arc(v.x, v.y, v.darkvision, 0, Math.PI * 2);
          t.fill();
        }
      } else {
        t.fillRect(0, 0, tmp.width / scale, tmp.height / scale);
      }
      const key = `${v.x},${v.y}|${doorBits}|${scene.sight}`;
      let los = cache.byViewer.get(key);
      if (!los) {
        los = visibility(v.x, v.y, scene.sight, grid, closed, scene.exact || scene.sight);
        cache.byViewer.set(key, los);
      }
      t.globalCompositeOperation = "destination-in";
      tracePoly(t, los);
      t.fill();
      octx.drawImage(tmp, 0, 0);
      if (dvctx && scene.dark && v.darkvision > 0) {
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = "source-over";
        t.clearRect(0, 0, tmp.width, tmp.height);
        t.setTransform(scale, 0, 0, scale, 0, 0);
        // Soft at its edge, like the lights.
        const g = t.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.darkvision);
        g.addColorStop(0, "#fff");
        g.addColorStop(0.75, "#fff");
        g.addColorStop(1, "rgba(255, 255, 255, 0)");
        t.fillStyle = g;
        t.beginPath();
        t.arc(v.x, v.y, v.darkvision, 0, Math.PI * 2);
        t.fill();
        t.globalCompositeOperation = "destination-in";
        tracePoly(t, los);
        t.fill();
        dvctx.drawImage(tmp, 0, 0);
      }
    });
  }

  window.LodestarLight = { parseVtt, visibility, segmentsOf, buildLightmap, buildVision, luminance };
})();
