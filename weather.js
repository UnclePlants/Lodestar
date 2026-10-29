/* Lodestar weather — atmosphere over the battlemap (window.LodestarWeather).
 *
 * Rain, a storm (heavier rain with lightning), snow, drifting fog and rising embers, drawn in
 * screen space on their own overlay canvas so the map never has to redraw for them. A single
 * requestAnimationFrame loop runs only while there is weather to draw. The GM picks the kind,
 * intensity (0.1–1) and wind (-1 = blowing left … 1 = blowing right); app.js mirrors that to the
 * player display with the rest of the state.
 *
 * Lightning is a soft brightening several seconds apart (or when the GM calls it), never
 * anywhere near three flashes a second; with { calm: true } (reduced motion) there's none.
 */
(function () {
  "use strict";

  const KINDS = ["none", "rain", "storm", "snow", "fog", "embers"];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // A complete, safe weather setting from whatever was given.
  function normWeather(w) {
    const o = w && typeof w === "object" ? w : {};
    return {
      kind: KINDS.includes(o.kind) ? o.kind : "none",
      intensity: clamp(Number(o.intensity) || 0.6, 0.1, 1),
      wind: clamp(Number.isFinite(Number(o.wind)) ? Number(o.wind) : 0.3, -1, 1),
    };
  }

  // Soft cloud shapes for fog, made once: overlapping grey-white glows.
  let fogShapes = null;
  function getFogShapes() {
    if (fogShapes) return fogShapes;
    fogShapes = Array.from({ length: 4 }, () => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 260;
      const o = c.getContext("2d");
      for (let i = 0; i < 26; i++) {
        const u = Math.random();
        const bulge = Math.sin(Math.PI * u);
        const x = c.width * (0.1 + 0.8 * u);
        const y = c.height * (0.58 - 0.16 * bulge * Math.random());
        const r = c.height * (0.12 + 0.26 * bulge * (0.5 + 0.5 * Math.random()));
        const g = o.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(206, 214, 226, 0.55)");
        g.addColorStop(1, "rgba(206, 214, 226, 0)");
        o.fillStyle = g;
        o.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      return c;
    });
    return fogShapes;
  }

  function createWeather(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const calm = !!opts.calm;
    let cfg = normWeather(null);
    let view = { w: 0, h: 0, dpr: 1 };
    let parts = []; // rain drops, snowflakes, embers, or fog banks, by kind
    let splashes = []; // little rings where rain lands
    let raf = 0;
    let last = 0;
    let clock = 0; // seconds of weather so far
    let nextFlash = 0;
    let flashAt = -1;

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w === view.w && h === view.h) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(4.5e6 / (w * h)));
      view = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      return true;
    };

    // How many particles: by intensity and screen area (relative to 1280×720).
    const count = (base, extra) => Math.round((base + extra * cfg.intensity) * clamp((view.w * view.h) / (1280 * 720), 0.35, 3));

    const newDrop = (anywhere) => {
      const heavy = cfg.kind === "storm";
      const v = rnd(900, 1300) * (heavy ? 1.2 : 1);
      return { x: rnd(-0.2, 1.2) * view.w, y: anywhere ? rnd(-0.1, 1) * view.h : rnd(-0.25, -0.02) * view.h, v, len: rnd(12, 26) * (0.7 + 0.5 * cfg.intensity), a: rnd(0.22, 0.5) };
    };
    const newFlake = (anywhere) => ({
      x: rnd(-0.1, 1.1) * view.w,
      y: anywhere ? rnd(-0.05, 1) * view.h : rnd(-0.1, -0.01) * view.h,
      r: rnd(1.4, 4),
      v: rnd(30, 90),
      sway: rnd(8, 26),
      f: rnd(0.4, 1.4),
      p: rnd(0, Math.PI * 2),
      a: rnd(0.55, 0.95),
    });
    const newEmber = (anywhere) => ({
      x: rnd(-0.05, 1.05) * view.w,
      y: anywhere ? rnd(0.2, 1.1) * view.h : view.h + rnd(4, 40),
      r: rnd(1.2, 3.2),
      v: rnd(28, 90),
      sway: rnd(6, 22),
      f: rnd(0.8, 2.2),
      p: rnd(0, Math.PI * 2),
      life: rnd(0.5, 1),
    });
    const newBank = (anywhere) => {
      const shapes = getFogShapes();
      const s = rnd(1.1, 2.3) * Math.max(0.7, view.w / 1440);
      const bw = shapes[0].width * s;
      return { shape: shapes[Math.floor(Math.random() * shapes.length)], s, x: anywhere ? rnd(-bw, view.w) : cfg.wind >= 0 ? -bw : view.w, y: rnd(-0.15, 0.85) * view.h, v: rnd(6, 14), a: rnd(0.6, 1) };
    };

    function seed() {
      splashes = [];
      if (cfg.kind === "rain") parts = Array.from({ length: count(140, 520) }, () => newDrop(true));
      else if (cfg.kind === "storm") parts = Array.from({ length: count(260, 760) }, () => newDrop(true));
      else if (cfg.kind === "snow") parts = Array.from({ length: count(90, 320) }, () => newFlake(true));
      else if (cfg.kind === "embers") parts = Array.from({ length: count(40, 150) }, () => newEmber(true));
      else if (cfg.kind === "fog") parts = Array.from({ length: 4 + Math.round(5 * cfg.intensity) }, () => newBank(true));
      else parts = [];
      nextFlash = clock + rnd(3, 7);
    }

    function step(dt) {
      clock += dt;
      const { w, h } = view;
      const k = cfg.kind;
      if (k === "rain" || k === "storm") {
        const vx = cfg.wind * (k === "storm" ? 620 : 420);
        parts.forEach((d, i) => {
          d.x += vx * dt * (d.v / 1100);
          d.y += d.v * dt;
          if (d.y - d.len > h) {
            if (Math.random() < 0.35 * cfg.intensity) splashes.push({ x: rnd(0, w), y: rnd(0.1, 1) * h, t: 0 });
            parts[i] = newDrop(false);
          } else if (d.x < -0.25 * w) d.x += 1.5 * w;
          else if (d.x > 1.25 * w) d.x -= 1.5 * w;
        });
        splashes.forEach((s) => (s.t += dt));
        splashes = splashes.filter((s) => s.t < 0.3);
        if (k === "storm" && !calm && clock >= nextFlash) {
          flashAt = clock;
          nextFlash = clock + rnd(5, 13);
        }
      } else if (k === "snow") {
        parts.forEach((f, i) => {
          f.y += f.v * dt;
          f.x += (cfg.wind * 70 + Math.sin(clock * f.f + f.p) * f.sway) * dt;
          if (f.y - f.r > h) parts[i] = newFlake(false);
          else if (f.x < -0.1 * w) f.x += 1.2 * w;
          else if (f.x > 1.1 * w) f.x -= 1.2 * w;
        });
      } else if (k === "embers") {
        parts.forEach((e, i) => {
          e.y -= e.v * dt;
          e.x += (cfg.wind * 45 + Math.sin(clock * e.f + e.p) * e.sway) * dt;
          if (e.y < -10 || e.x < -20 || e.x > w + 20) parts[i] = newEmber(false);
        });
      } else if (k === "fog") {
        const dir = cfg.wind >= 0 ? 1 : -1;
        parts.forEach((b, i) => {
          b.x += dir * (b.v + Math.abs(cfg.wind) * 26) * dt;
          const bw = b.shape.width * b.s;
          if ((dir > 0 && b.x > w) || (dir < 0 && b.x < -bw)) parts[i] = newBank(false);
        });
      }
    }

    // The storm's flash: a quick double flicker, then a slow fade (0 → ~1 → 0 over ~0.9 s).
    function flashLevel() {
      if (flashAt < 0) return 0;
      const t = clock - flashAt;
      if (t > 0.9) return 0;
      if (t < 0.06) return t / 0.06;
      if (t < 0.14) return 1 - ((t - 0.06) / 0.08) * 0.8;
      if (t < 0.2) return 0.2 + ((t - 0.14) / 0.06) * 0.8;
      return Math.exp(-(t - 0.2) * 5);
    }

    function draw() {
      const { w, h, dpr } = view;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const I = cfg.intensity;
      const k = cfg.kind;
      if (k === "rain" || k === "storm") {
        // A cool, darker sky, then the streaks (one batched path per brightness band).
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(8, 16, 30, ${k === "storm" ? 0.12 + 0.2 * I : 0.05 + 0.1 * I})`;
        ctx.fillRect(0, 0, w, h);
        const slant = cfg.wind * (k === "storm" ? 0.56 : 0.38);
        ctx.lineCap = "round";
        [
          [0.22, 1],
          [0.36, 1.2],
          [0.5, 1.5],
        ].forEach(([a, lw], band) => {
          ctx.beginPath();
          parts.forEach((d, i) => {
            if (i % 3 !== band) return;
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x - slant * d.len, d.y - d.len);
          });
          ctx.strokeStyle = `rgba(196, 214, 240, ${a})`;
          ctx.lineWidth = lw;
          ctx.stroke();
        });
        ctx.lineWidth = 1;
        splashes.forEach((s) => {
          const e = s.t / 0.3;
          ctx.globalAlpha = 0.35 * (1 - e);
          ctx.strokeStyle = "rgb(196, 214, 240)";
          ctx.beginPath();
          ctx.ellipse(s.x, s.y, 1 + 6 * e, 0.5 + 2.4 * e, 0, 0, Math.PI * 2);
          ctx.stroke();
        });
        const f = flashLevel();
        if (f > 0) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(214, 226, 255, ${0.3 * f})`;
          ctx.fillRect(0, 0, w, h);
        }
      } else if (k === "snow") {
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(220, 230, 245, ${0.03 + 0.05 * I})`;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#f4f8ff";
        parts.forEach((s) => {
          ctx.globalAlpha = s.a;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
          if (s.r > 2.2) {
            ctx.globalAlpha = s.a * 0.18;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      } else if (k === "embers") {
        // A warm glow rising from the bottom edge, then sparks drifting up and flickering.
        const glow = ctx.createLinearGradient(0, h, 0, h * 0.55);
        glow.addColorStop(0, `rgba(255, 96, 24, ${0.06 + 0.1 * I})`);
        glow.addColorStop(1, "rgba(255, 96, 24, 0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = glow;
        ctx.fillRect(0, h * 0.55, w, h * 0.45);
        ctx.globalCompositeOperation = "lighter";
        parts.forEach((e) => {
          const heat = clamp(e.y / h, 0, 1); // brighter low down, cooling as they rise
          const flicker = 0.65 + 0.35 * Math.sin(clock * 9 * e.f + e.p);
          ctx.globalAlpha = clamp(0.5 + 0.5 * heat, 0, 1) * flicker * e.life;
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 3);
          g.addColorStop(0, "rgba(255, 220, 140, 1)");
          g.addColorStop(0.35, "rgba(255, 128, 32, 0.9)");
          g.addColorStop(1, "rgba(255, 64, 0, 0)");
          ctx.fillStyle = g;
          ctx.fillRect(e.x - e.r * 3, e.y - e.r * 3, e.r * 6, e.r * 6);
        });
        ctx.globalCompositeOperation = "source-over";
      } else if (k === "fog") {
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(178, 188, 204, ${0.05 + 0.1 * I})`;
        ctx.fillRect(0, 0, w, h);
        parts.forEach((b) => {
          ctx.globalAlpha = (0.2 + 0.42 * I) * b.a;
          ctx.drawImage(b.shape, b.x, b.y, b.shape.width * b.s, b.shape.height * b.s);
        });
      }
      ctx.globalAlpha = 1;
    }

    function loop(now) {
      if (cfg.kind === "none") return;
      raf = requestAnimationFrame(loop);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (fit()) seed();
      step(dt);
      draw();
    }

    // Change the weather. Re-seeds when the kind or intensity changes; wind just steers.
    function set(next) {
      const n = normWeather(next);
      const reseed = n.kind !== cfg.kind || Math.abs(n.intensity - cfg.intensity) > 0.04;
      cfg = n;
      canvas.hidden = cfg.kind === "none";
      if (cfg.kind === "none") {
        cancelAnimationFrame(raf);
        raf = 0;
        parts = [];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      fit();
      if (reseed) seed();
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(loop);
      }
    }

    // Lightning right now (the GM's button), during a storm.
    function flash() {
      if (cfg.kind !== "storm" || calm) return;
      flashAt = clock;
      nextFlash = clock + rnd(6, 13);
    }

    canvas.hidden = true;
    return { set, flash, get: () => ({ ...cfg }) };
  }

  window.LodestarWeather = { createWeather, normWeather, KINDS };
})();
