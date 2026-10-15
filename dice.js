/* Lodestar dice — a dependency-free 3D dice roller (window.LodestarDice).
 *
 * A roll is simulated up front with a small rigid-body model (gravity, bounces off the table
 * and the tray walls, friction, dice knocking into each other) and recorded at 60 fps. The
 * animation then just plays that recording back on a 2D canvas, drawing flat-shaded
 * polyhedra in perspective. Because a roll is plain data, the GM window can send the very
 * same tumble to the player display. Results are read off the physics — whichever face
 * ends up on top — and every throw is seeded from crypto.getRandomValues.
 *
 * Supported shapes: d4 (read at the top corner), d6, d8, d10, d12, d20, and d100 (a tens d10
 * plus a units d10). Other sizes (d2, d3, d7…) roll without a 3D die.
 */
(function () {
  "use strict";

  /* ---------------- vectors & quaternions ([w, x, y, z]) ---------------- */

  const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
  const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
  const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len = (a) => Math.hypot(a.x, a.y, a.z);
  const norm = (a) => mul(a, 1 / (len(a) || 1));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const qmul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const qnorm = (q) => {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  };
  function qrot(q, v) {
    const [w, x, y, z] = q;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return v3(v.x + w * tx + (y * tz - z * ty), v.y + w * ty + (z * tx - x * tz), v.z + w * tz + (x * ty - y * tx));
  }
  // Shortest rotation taking unit vector a onto unit vector b.
  function qFromTo(a, b) {
    const d = dot(a, b);
    if (d < -0.999999) {
      let axis = cross(v3(1, 0, 0), a);
      if (len(axis) < 1e-6) axis = cross(v3(0, 1, 0), a);
      axis = norm(axis);
      return [0, axis.x, axis.y, axis.z];
    }
    const c = cross(a, b);
    return qnorm([1 + d, c.x, c.y, c.z]);
  }
  function qnlerp(a, b, t) {
    const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
    return qnorm([lerp(a[0], s * b[0], t), lerp(a[1], s * b[1], t), lerp(a[2], s * b[2], t), lerp(a[3], s * b[3], t)]);
  }

  /* ---------------- randomness (crypto-backed) ---------------- */

  const randBuf = new Uint32Array(128);
  let randIdx = randBuf.length;
  function rand() {
    if (randIdx >= randBuf.length) {
      crypto.getRandomValues(randBuf);
      randIdx = 0;
    }
    return randBuf[randIdx++] / 4294967296;
  }
  const randRange = (a, b) => a + (b - a) * rand();
  // Unbiased integer in [0, n).
  function randInt(n) {
    const limit = Math.floor(4294967296 / n) * n;
    let x;
    do x = rand() * 4294967296;
    while (x >= limit);
    return x % n;
  }
  function randUnit() {
    const z = 2 * rand() - 1;
    const a = 2 * Math.PI * rand();
    const r = Math.sqrt(1 - z * z);
    return v3(r * Math.cos(a), r * Math.sin(a), z);
  }
  // Uniformly random orientation (Shoemake).
  function randQuat() {
    const u1 = rand(), u2 = rand(), u3 = rand();
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    return [a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3), b * Math.cos(2 * Math.PI * u3)];
  }

  /* ---------------- die shapes ---------------- */

  const PHYSICAL = new Set([4, 6, 8, 10, 12, 20]);
  const SIZE = { 4: 0.82, 6: 0.7, 8: 0.74, 10: 0.74, 12: 0.74, 20: 0.76 }; // circumradius, tray units
  const PHI = (1 + Math.sqrt(5)) / 2;

  function baseVerts(sides) {
    const out = [];
    const s = [-1, 1];
    if (sides === 4) return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    if (sides === 6) s.forEach((x) => s.forEach((y) => s.forEach((z) => out.push([x, y, z]))));
    if (sides === 8) [0, 1, 2].forEach((axis) => s.forEach((sg) => out.push([0, 1, 2].map((i) => (i === axis ? sg : 0)))));
    if (sides === 12) {
      s.forEach((x) => s.forEach((y) => s.forEach((z) => out.push([x, y, z]))));
      s.forEach((a) => s.forEach((b) => out.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI])));
    }
    if (sides === 20) s.forEach((a) => s.forEach((b) => out.push([0, a, b * PHI], [a, b * PHI, 0], [a * PHI, 0, b])));
    if (sides === 10) {
      // Pentagonal trapezohedron: two poles plus a zig-zag ring. This ring height makes
      // every kite planar for any pole height h (ring radius 1).
      const h = 1.1;
      const ring = h / (2 / (1 - Math.cos(Math.PI / 5)) - 1);
      out.push([0, 0, h], [0, 0, -h]);
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5;
        out.push([Math.cos(a), Math.sin(a), i % 2 ? ring : -ring]);
      }
    }
    return out;
  }

  // Faces of a convex polyhedron whose points are all hull vertices: every plane through
  // three points with all the others on one side, vertices ordered around the normal.
  function buildFaces(verts) {
    const faces = [];
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          let nrm = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
          if (len(nrm) < 1e-9) continue;
          nrm = norm(nrm);
          let d = dot(nrm, verts[i]);
          let pos = 0, neg = 0;
          for (const p of verts) {
            const sd = dot(nrm, p) - d;
            if (sd > 1e-6) pos++;
            else if (sd < -1e-6) neg++;
          }
          if (pos && neg) continue;
          if (pos) {
            nrm = mul(nrm, -1);
            d = -d;
          }
          if (faces.some((f) => dot(f.normal, nrm) > 1 - 1e-6)) continue;
          const idx = [];
          verts.forEach((p, m) => {
            if (Math.abs(dot(nrm, p) - d) < 1e-6) idx.push(m);
          });
          faces.push({ normal: nrm, idx });
        }
      }
    }
    faces.forEach((f) => {
      const c = mul(f.idx.reduce((acc, m) => add(acc, verts[m]), v3()), 1 / f.idx.length);
      const u = norm(sub(verts[f.idx[0]], c));
      const w = cross(f.normal, u);
      const ang = (m) => {
        const p = sub(verts[m], c);
        return Math.atan2(dot(p, w), dot(p, u));
      };
      f.idx.sort((a, b) => ang(a) - ang(b));
      f.center = c;
      // Distance from the centre to the nearest edge: sizes the number printed on the face.
      f.inner = Math.min(
        ...f.idx.map((m, e) => {
          const a = verts[m];
          const b = verts[f.idx[(e + 1) % f.idx.length]];
          const ab = norm(sub(b, a));
          const ac = sub(c, a);
          return len(sub(ac, mul(ab, dot(ac, ab))));
        }),
      );
    });
    return faces;
  }

  const KINDS = {};
  function getKind(sides) {
    if (KINDS[sides]) return KINDS[sides];
    const raw = baseVerts(sides).map(([x, y, z]) => v3(x, y, z));
    const circ0 = Math.max(...raw.map(len));
    const circ = SIZE[sides];
    const verts = raw.map((p) => mul(p, circ / circ0));
    const faces = buildFaces(verts);
    const inr = Math.min(...faces.map((f) => dot(f.normal, f.center)));

    // Number the faces so opposite faces add up like real dice (7 on a d6, 21 on a d20…).
    const low = sides === 10 ? 0 : 1;
    const high = sides === 10 ? 9 : sides;
    if (sides !== 4) {
      const order = faces.map((f, i) => i).sort((a, b) => {
        const fa = faces[a].normal, fb = faces[b].normal;
        return fb.z - fa.z || Math.atan2(fa.y, fa.x) - Math.atan2(fb.y, fb.x);
      });
      let next = low;
      order.forEach((i) => {
        if (faces[i].value !== undefined) return;
        const opp = faces.findIndex((g) => dot(g.normal, faces[i].normal) < -0.999);
        faces[i].value = next;
        if (opp >= 0) faces[opp].value = low + high - next;
        next++;
      });
    }
    // Where and which way up each number is printed.
    faces.forEach((f) => {
      let toward = verts[f.idx[0]];
      if (sides === 10) toward = f.idx.map((m) => verts[m]).reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a)); // the pole
      const off = sub(toward, f.center);
      f.up = norm(sub(off, mul(f.normal, dot(off, f.normal))));
      f.textSize = f.inner * ({ 6: 1.0, 8: 0.95, 10: 0.78, 12: 0.8, 20: 0.88 }[sides] || 0.9);
    });
    const reff = (inr + circ) / 2;
    KINDS[sides] = {
      sides,
      verts,
      faces,
      circ,
      radius: reff * 0.96, // die-to-die collision radius
      inertia: 0.4 * reff * reff,
      vertexLabels: sides === 4 ? [1, 2, 3, 4] : null, // d4: numbers live at the corners
    };
    return KINDS[sides];
  }

  /* ---------------- notation ---------------- */

  const MAX_DICE = 100;
  const MAX_PHYSICAL = 30;

  // "2d20kh1+1d6-2" -> [{ type:"dice", sign, count, sides, keep }, { type:"num", sign, value }]
  function parse(expr) {
    const src = String(expr || "").toLowerCase().replace(/\s+/g, "").replace(/d%/g, "d100");
    if (!src) throw new Error("Type a roll, like 1d20+5 or 4d6dl1.");
    const re = /([+-]?)(?:(\d*)d(\d+)(?:(kh|kl|dh|dl|k)(\d*))?|(\d+))/y;
    const terms = [];
    let total = 0;
    while (re.lastIndex < src.length) {
      const at = re.lastIndex;
      const m = re.exec(src);
      if (!m || m[0] === "" || (terms.length && !m[1])) {
        throw new Error(`Couldn't read "${src.slice(at)}". Try something like 2d6+3 or 1d20kh1.`);
      }
      const sign = m[1] === "-" ? -1 : 1;
      if (m[6] !== undefined) {
        terms.push({ type: "num", sign, value: Number(m[6]) });
        continue;
      }
      const count = m[2] === "" ? 1 : Number(m[2]);
      const sides = Number(m[3]);
      if (count < 1) throw new Error("Roll at least one die.");
      if (sides < 2 || sides > 1000) throw new Error(`A d${sides} isn't a die Lodestar can roll.`);
      let keep = null;
      if (m[4]) {
        const n = m[5] === "" ? 1 : Number(m[5]);
        const mode = m[4] === "k" ? "kh" : m[4];
        // Drop-lowest/highest is the same as keeping the rest (but stays written as typed).
        if (mode === "dl") keep = { mode: "h", n: count - n, text: `dl${n}` };
        else if (mode === "dh") keep = { mode: "l", n: count - n, text: `dh${n}` };
        else keep = { mode: mode[1], n };
        if (keep.n < 1 || keep.n > count) throw new Error(`Can't keep ${keep.n} of ${count} dice.`);
      }
      total += count;
      terms.push({ type: "dice", sign, count, sides, keep });
    }
    if (total > MAX_DICE) throw new Error(`That's more than ${MAX_DICE} dice.`);
    if (terms.length > 12) throw new Error("That roll has too many parts.");
    return terms;
  }

  function formatTerm(t) {
    if (t.type === "num") return String(t.value);
    const keep = t.keep ? t.keep.text || `k${t.keep.mode}${t.keep.n}` : "";
    return `${t.count}d${t.sides}${keep}`;
  }

  function format(terms) {
    return terms.map((t, i) => (i === 0 ? (t.sign < 0 ? "-" : "") : t.sign < 0 ? "-" : "+") + formatTerm(t)).join("");
  }

  /* ---------------- physics ---------------- */

  const TRAY_W = 8; // half-width of the tray (x), in die-sized units
  const TRAY_H = 4.5; // half-height (y)
  const GRAVITY = 52;
  const DT = 1 / 240;
  const STEPS_PER_FRAME = 4; // record at 60 fps
  const MAX_SECONDS = 4.5; // anything still rocking by then is eased flat by the settle step
  const PLANES = [
    { n: v3(0, 0, 1), d: 0, e: 0.3, mu: 0.5, floor: true },
    { n: v3(1, 0, 0), d: -TRAY_W, e: 0.5, mu: 0.2 },
    { n: v3(-1, 0, 0), d: -TRAY_W, e: 0.5, mu: 0.2 },
    { n: v3(0, 1, 0), d: -TRAY_H, e: 0.5, mu: 0.2 },
    { n: v3(0, -1, 0), d: -TRAY_H, e: 0.5, mu: 0.2 },
  ];

  function applyImpulse(b, r, J) {
    b.v = add(b.v, J);
    b.w = add(b.w, mul(cross(r, J), 1 / b.kind.inertia));
  }

  function collidePlanes(b, t, impacts) {
    b.onFloor = false;
    for (const P of PLANES) {
      let deepest = 0;
      const contacts = [];
      for (const vb of b.kind.verts) {
        const r = qrot(b.q, vb);
        const pen = P.d - dot(P.n, add(b.x, r));
        if (pen > 0) contacts.push(r);
        deepest = Math.max(deepest, pen);
      }
      if (!contacts.length) continue;
      if (P.floor) b.onFloor = true;
      // Contacts are resolved one after another, and the order nudges which way a die tips.
      // A fixed vertex order would favour some faces (it measurably did on the d10), so
      // shuffle it every time — then every face is statistically equivalent again.
      for (let i = contacts.length - 1; i > 0; i--) {
        const k = randInt(i + 1);
        [contacts[i], contacts[k]] = [contacts[k], contacts[i]];
      }
      for (const r of contacts) {
        const vn = dot(add(b.v, cross(b.w, r)), P.n);
        if (vn >= 0) continue;
        const rn = cross(r, P.n);
        const k = 1 + dot(rn, rn) / b.kind.inertia;
        const e = vn < -1.2 ? P.e : 0; // slow contacts rest instead of bouncing
        const j = (-(1 + e) * vn) / k;
        applyImpulse(b, r, mul(P.n, j));
        // Coulomb friction at the contact.
        const vrel = add(b.v, cross(b.w, r));
        const vt = sub(vrel, mul(P.n, dot(vrel, P.n)));
        const vtl = len(vt);
        if (vtl > 1e-6) {
          const tdir = mul(vt, 1 / vtl);
          const rt = cross(r, tdir);
          const kt = 1 + dot(rt, rt) / b.kind.inertia;
          applyImpulse(b, r, mul(tdir, -Math.min(vtl / kt, P.mu * j)));
        }
        if (j > 1.4 && t - b.lastHit > 0.06) {
          impacts.push({ t: Math.round(t * 1000) / 1000, s: Math.round(Math.min(1, j / 9) * 100) / 100 });
          b.lastHit = t;
        }
      }
      if (deepest > 0) b.x = add(b.x, mul(P.n, deepest));
    }
  }

  // Dice knock into each other as spheres — close enough at this size and much simpler.
  function collideBodies(bodies, t, impacts) {
    for (let i = 0; i < bodies.length; i++) {
      for (let k = i + 1; k < bodies.length; k++) {
        const a = bodies[i], b = bodies[k];
        if (a.asleep && b.asleep) continue;
        const d = sub(b.x, a.x);
        const dist = len(d);
        const minD = a.kind.radius + b.kind.radius;
        if (dist >= minD || dist < 1e-6) continue;
        const n = mul(d, 1 / dist);
        const rel = sub(b.v, a.v);
        const vn = dot(rel, n);
        // Separate them sideways only: pushing up or down would lift a die off the table.
        const side = norm(v3(n.x, n.y, 0));
        const corr = (minD - dist) / 2;
        if (!a.asleep) a.x = sub(a.x, mul(side, corr));
        if (!b.asleep) b.x = add(b.x, mul(side, corr));
        if (vn >= -0.05) continue; // resting side by side, not a hit
        const j = (-(1 + 0.4) * vn) / 2;
        a.v = sub(a.v, mul(n, j));
        b.v = add(b.v, mul(n, j));
        const vt = sub(rel, mul(n, vn));
        a.w = add(a.w, mul(cross(n, vt), 0.6));
        b.w = sub(b.w, mul(cross(n, vt), 0.6));
        if (j > 0.3) {
          a.asleep = b.asleep = false; // a real knock wakes a resting die
          a.rest = b.rest = 0;
        }
        if (j > 1 && t - Math.max(a.lastHit, b.lastHit) > 0.05) {
          impacts.push({ t: Math.round(t * 1000) / 1000, s: Math.round(Math.min(1, j / 7) * 100) / 100 });
          a.lastHit = b.lastHit = t;
        }
      }
    }
  }

  function step(b) {
    b.v.z -= GRAVITY * DT;
    b.x = add(b.x, mul(b.v, DT));
    const dq = qmul([0, b.w.x, b.w.y, b.w.z], b.q);
    b.q = qnorm([b.q[0] + 0.5 * DT * dq[0], b.q[1] + 0.5 * DT * dq[1], b.q[2] + 0.5 * DT * dq[2], b.q[3] + 0.5 * DT * dq[3]]);
    if (b.onFloor) {
      // Rolling resistance so dice come to rest instead of spinning forever.
      b.w = mul(b.w, 0.994);
      b.v = v3(b.v.x * 0.997, b.v.y * 0.997, b.v.z);
    } else {
      b.w = mul(b.w, 0.9995);
    }
  }

  // The face the die is lying on, and the rotation that sets it exactly flat.
  function restPose(b) {
    let bottom = b.kind.faces[0];
    let lowest = Infinity;
    b.kind.faces.forEach((f) => {
      const z = qrot(b.q, f.normal).z;
      if (z < lowest) {
        lowest = z;
        bottom = f;
      }
    });
    const q = qnorm(qmul(qFromTo(qrot(b.q, bottom.normal), v3(0, 0, -1)), b.q));
    const minZ = Math.min(...b.kind.verts.map((p) => qrot(q, p).z));
    const x = v3(clamp(b.x.x, -TRAY_W + 0.5, TRAY_W - 0.5), clamp(b.x.y, -TRAY_H + 0.5, TRAY_H - 0.5), -minZ);
    return { x, q };
  }

  // The number showing: top face, or for a d4 the number at the top corner.
  function readValue(kind, q) {
    if (kind.vertexLabels) {
      let best = 0;
      kind.verts.forEach((p, i) => {
        if (qrot(q, p).z > qrot(q, kind.verts[best]).z) best = i;
      });
      return kind.vertexLabels[best];
    }
    let top = kind.faces[0];
    kind.faces.forEach((f) => {
      if (qrot(q, f.normal).z > qrot(q, top.normal).z) top = f;
    });
    return top.value;
  }

  // Throw the dice and record the whole tumble. Returns per-die flat frame arrays
  // ([x, y, z, qw, qx, qy, qz] per frame), the values rolled, and impact times for sound.
  function simulate(sidesList) {
    const n = sidesList.length;
    if (!n) return { frames: [], values: [], impacts: [] };
    const dir = rand() < 0.5 ? 1 : -1; // thrown from the left or the right edge
    const cols = Math.min(4, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const bodies = sidesList.map((sides, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const y = clamp((row - (rows - 1) / 2) * 1.6 + randRange(-0.4, 0.4), -TRAY_H + 1, TRAY_H - 1);
      return {
        kind: getKind(sides),
        x: v3(-dir * (TRAY_W - 1.1 - col * 1.5), y, randRange(2.2, 3.8)),
        v: v3(dir * randRange(10, 16), randRange(-3, 3) - y * 0.5, randRange(0, 2.5)),
        w: mul(randUnit(), randRange(14, 26)),
        q: randQuat(),
        asleep: false,
        rest: 0,
        lastHit: -1,
        onFloor: false,
      };
    });
    const frames = bodies.map(() => []);
    const r4 = (v) => Math.round(v * 10000) / 10000;
    const record = (poses) =>
      poses.forEach((p, i) => frames[i].push(r4(p.x.x), r4(p.x.y), r4(p.x.z), r4(p.q[0]), r4(p.q[1]), r4(p.q[2]), r4(p.q[3])));
    const impacts = [];
    record(bodies);
    const maxSteps = MAX_SECONDS / DT;
    const REST_EVERY = 12; // check for rest every 0.05 s
    for (let s = 0; s < maxSteps; s++) {
      const t = s * DT;
      bodies.forEach((b) => {
        if (b.asleep) return;
        step(b);
        collidePlanes(b, t, impacts);
      });
      collideBodies(bodies, t, impacts);
      // A die is at rest once it has barely moved or turned for a while. (Its instantaneous
      // velocity never quite reaches zero: gravity and contact impulses keep trading tiny
      // amounts back and forth every step while it sits on the table.)
      if ((s + 1) % REST_EVERY === 0) {
        bodies.forEach((b) => {
          if (b.asleep) return;
          const still = b.snap && len(sub(b.x, b.snap.x)) < 0.012 && Math.abs(b.q[0] * b.snap.q[0] + b.q[1] * b.snap.q[1] + b.q[2] * b.snap.q[2] + b.q[3] * b.snap.q[3]) > 0.99995;
          b.rest = still && b.onFloor ? b.rest + REST_EVERY * DT : 0;
          b.snap = { x: b.x, q: b.q };
          if (b.rest >= 0.3) {
            b.asleep = true;
            b.v = v3();
            b.w = v3();
          }
        });
      }
      if ((s + 1) % STEPS_PER_FRAME === 0) record(bodies);
      if (bodies.every((b) => b.asleep)) break;
    }
    // Ease every die onto the face it's resting on, so each one ends perfectly flat.
    const finals = bodies.map(restPose);
    const SETTLE = 9;
    for (let k = 1; k <= SETTLE; k++) {
      const e = 1 - Math.pow(1 - k / SETTLE, 2);
      record(bodies.map((b, i) => ({
        x: v3(lerp(b.x.x, finals[i].x.x, e), lerp(b.x.y, finals[i].x.y, e), lerp(b.x.z, finals[i].x.z, e)),
        q: qnlerp(b.q, finals[i].q, e),
      })));
    }
    return { frames, values: bodies.map((b, i) => readValue(b.kind, finals[i].q)), impacts };
  }

  /* ---------------- a roll ---------------- */

  // Parse, throw and total a roll. The result is plain JSON: safe to send to the player.
  function createRoll(expr, opts = {}) {
    const terms = parse(expr);
    const color = opts.color || "#8c1c2c";
    const phys = []; // { sides, labels } for every 3D die in the throw
    const plan = terms.map((t) => {
      if (t.type !== "dice") return null;
      return Array.from({ length: t.count }, () => {
        if (t.sides === 100) {
          const tens = phys.push({ sides: 10, labels: "tens" }) - 1;
          const units = phys.push({ sides: 10, labels: "units" }) - 1;
          return { tens, units };
        }
        if (PHYSICAL.has(t.sides)) return { index: phys.push({ sides: t.sides, labels: "std" }) - 1 };
        return { value: 1 + randInt(t.sides) }; // no 3D shape for this size
      });
    });
    if (phys.length > MAX_PHYSICAL) throw new Error(`That's too many dice to throw at once (max ${MAX_PHYSICAL}).`);
    const sim = simulate(phys.map((p) => p.sides));

    let total = 0;
    const outTerms = terms.map((t, ti) => {
      if (t.type === "num") {
        total += t.sign * t.value;
        return { text: String(t.value), sign: t.sign, value: t.value };
      }
      const rolls = plan[ti].map((d) => {
        if (d.value !== undefined) return { value: d.value, dice: [] };
        if (d.tens !== undefined) {
          const v = sim.values[d.tens] * 10 + sim.values[d.units];
          return { value: v === 0 ? 100 : v, dice: [d.tens, d.units] };
        }
        const raw = sim.values[d.index];
        return { value: t.sides === 10 && raw === 0 ? 10 : raw, dice: [d.index] };
      });
      if (t.keep) {
        const order = rolls.map((r, i) => i).sort((a, b) => (t.keep.mode === "h" ? rolls[b].value - rolls[a].value : rolls[a].value - rolls[b].value));
        order.slice(t.keep.n).forEach((i) => {
          rolls[i].dropped = true;
          rolls[i].dice.forEach((di) => (phys[di].dropped = true));
        });
      }
      const value = rolls.reduce((s, r) => s + (r.dropped ? 0 : r.value), 0);
      total += t.sign * value;
      return { text: formatTerm(t), sign: t.sign, value, rolls: rolls.map((r) => ({ value: r.value, dropped: !!r.dropped })) };
    });

    return {
      id: `roll-${Date.now().toString(36)}-${randInt(1e9).toString(36)}`,
      expr: format(terms),
      total,
      terms: outTerms,
      frameRate: 60,
      impacts: sim.impacts,
      dice: phys.map((p, i) => ({ sides: p.sides, labels: p.labels, color, dropped: !!p.dropped, frames: sim.frames[i] })),
    };
  }

  /* ---------------- rendering ---------------- */

  const CAM_H = 30; // camera height above the table, looking straight down
  const CAM = v3(0, 0, CAM_H);
  const LIGHT = norm(v3(-0.35, 0.45, 0.85));
  const HALF = norm(add(LIGHT, v3(0, 0, 1)));
  const HOLD_MS = 4200; // how long settled dice stay up before fading
  const FADE_MS = 700;

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    const n = m ? parseInt(m[1], 16) : 0x8c1c2c;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function labelText(value, labels) {
    if (labels === "tens") return value === 0 ? "00" : String(value * 10);
    return String(value);
  }

  // The overlay that plays rolls back. One per window (GM and player).
  function createStage(canvas) {
    const ctx = canvas.getContext("2d");
    let current = null;
    let audioCtx = null;
    let noiseBuf = null;

    function layout() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      // Fit the tray (plus a margin) into the overlay.
      const scale = Math.min(rect.width / (TRAY_W * 2 + 1.2), rect.height / (TRAY_H * 2 + 1.2));
      return { dpr, w: rect.width, h: rect.height, cx: rect.width / 2, cy: rect.height / 2, scale };
    }

    function project(p, L) {
      const s = CAM_H / (CAM_H - p.z);
      return { x: L.cx + p.x * L.scale * s, y: L.cy - p.y * L.scale * s };
    }

    function poseAt(die, f) {
      const fr = die.frames;
      const count = fr.length / 7;
      const i0 = clamp(Math.floor(f), 0, count - 1);
      const i1 = Math.min(count - 1, i0 + 1);
      const t = clamp(f - i0, 0, 1);
      const a = i0 * 7, b = i1 * 7;
      return {
        x: v3(lerp(fr[a], fr[b], t), lerp(fr[a + 1], fr[b + 1], t), lerp(fr[a + 2], fr[b + 2], t)),
        q: qnlerp([fr[a + 3], fr[a + 4], fr[a + 5], fr[a + 6]], [fr[b + 3], fr[b + 4], fr[b + 5], fr[b + 6]], t),
      };
    }

    // Print text flat on a face: an affine map from text space onto the projected face.
    function drawText(text, center, up, normal, size, L, color, alpha, underline) {
      const right = cross(up, normal);
      const F = 64; // text px
      const k = size / F; // world units per text px
      const e = 0.02;
      const O = project(center, L);
      const R = project(add(center, mul(right, e)), L);
      const D = project(sub(center, mul(up, e)), L);
      const px = e / k;
      ctx.setTransform(
        (L.dpr * (R.x - O.x)) / px, (L.dpr * (R.y - O.y)) / px,
        (L.dpr * (D.x - O.x)) / px, (L.dpr * (D.y - O.y)) / px,
        L.dpr * O.x, L.dpr * O.y,
      );
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillText(text, 0, F * 0.05);
      if (underline) ctx.fillRect(-F * 0.24, F * 0.44, F * 0.48, F * 0.08);
    }

    function drawDie(die, pose, L, alpha) {
      const kind = getKind(die.sides);
      const base = hexToRgb(die.color);
      const lum = (0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2]) / 255;
      const ink = lum > 0.6 ? "#1b1b1b" : "#f6eed8";
      const world = kind.verts.map((p) => add(pose.x, qrot(pose.q, p)));
      const scr = world.map((p) => project(p, L));
      ctx.font = "700 64px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      kind.faces.forEach((face) => {
        const nW = qrot(pose.q, face.normal);
        const cW = add(pose.x, qrot(pose.q, face.center));
        const facing = dot(nW, norm(sub(CAM, cW)));
        if (facing <= 0) return; // back face of a convex solid
        const lam = Math.max(0, dot(nW, LIGHT));
        const spec = Math.pow(Math.max(0, dot(nW, HALF)), 28) * 0.32;
        const shade = 0.36 + 0.64 * lam;
        const rgb = base.map((c) => Math.min(255, Math.round(c * shade + 255 * spec)));
        ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        face.idx.forEach((vi, i) => (i ? ctx.lineTo(scr[vi].x, scr[vi].y) : ctx.moveTo(scr[vi].x, scr[vi].y)));
        ctx.closePath();
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.stroke();
        const textAlpha = alpha * clamp((facing - 0.12) / 0.3, 0, 1) * (0.55 + 0.45 * shade);
        if (textAlpha <= 0.02) return;
        if (kind.vertexLabels) {
          face.idx.forEach((vi) => {
            const vp = kind.verts[vi];
            const at = add(pose.x, qrot(pose.q, add(face.center, mul(sub(vp, face.center), 0.52))));
            const up = qrot(pose.q, norm(sub(vp, face.center)));
            drawText(String(kind.vertexLabels[vi]), at, up, nW, face.inner * 0.62, L, ink, textAlpha, false);
          });
        } else {
          const text = labelText(face.value, die.labels);
          const size = face.textSize * (text.length > 1 ? 0.78 : 1);
          const underline = (text === "6" || text === "9") && kind.sides >= 10;
          drawText(text, cW, qrot(pose.q, face.up), nW, size, L, ink, textAlpha, underline);
        }
      });
    }

    function draw(roll, f, alpha, dropFade) {
      const L = layout();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const items = roll.dice.map((die) => ({ die, pose: poseAt(die, f) }));
      // Soft contact shadows first, fading as a die rises.
      ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
      items.forEach(({ die, pose }) => {
        const kind = getKind(die.sides);
        const c = project(v3(pose.x.x + pose.x.z * 0.12, pose.x.y - pose.x.z * 0.12, 0), L);
        const r = kind.circ * L.scale * (1.05 + pose.x.z * 0.1);
        const g = ctx.createRadialGradient(c.x, c.y, r * 0.2, c.x, c.y, r);
        const a = 0.42 * clamp(1 - pose.x.z / 7, 0, 1) * alpha;
        g.addColorStop(0, `rgba(0,0,0,${a})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
      });
      items
        .sort((a, b) => a.pose.x.z - b.pose.x.z)
        .forEach(({ die, pose }) => drawDie(die, pose, L, alpha * (die.dropped ? 1 - 0.62 * dropFade : 1)));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }

    function ensureAudio() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) {
        audioCtx = new AC();
        const n = Math.floor(audioCtx.sampleRate * 0.07);
        noiseBuf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
        const ch = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.16));
      }
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      return audioCtx;
    }

    // A short filtered-noise "clack" for every recorded impact.
    function scheduleSounds(impacts) {
      const ac = ensureAudio();
      if (!ac || !impacts.length) return [];
      const t0 = ac.currentTime + 0.03;
      return impacts.slice(0, 90).map((imp) => {
        const src = ac.createBufferSource();
        src.buffer = noiseBuf;
        src.playbackRate.value = 0.8 + Math.random() * 0.6;
        const bp = ac.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1500 + Math.random() * 2300;
        bp.Q.value = 1.3;
        const gain = ac.createGain();
        gain.gain.value = 0.04 + 0.32 * imp.s;
        src.connect(bp);
        bp.connect(gain);
        gain.connect(ac.destination);
        src.start(t0 + imp.t);
        return src;
      });
    }

    function stop() {
      if (!current) return;
      cancelAnimationFrame(current.raf);
      current.sounds.forEach((s) => {
        try {
          s.stop();
        } catch {}
      });
      current = null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.hidden = true;
    }

    // Play a roll from createRoll(). opts: { sound, onSettle(roll), onDone(roll) }.
    function play(roll, opts = {}) {
      stop();
      canvas.hidden = false;
      const frameCount = roll.dice.length ? roll.dice[0].frames.length / 7 : 0;
      const simMs = frameCount ? ((frameCount - 1) / roll.frameRate) * 1000 : 0;
      const cur = { raf: 0, start: performance.now(), settled: false, sounds: opts.sound ? scheduleSounds(roll.impacts || []) : [] };
      current = cur;
      const tick = (now) => {
        if (current !== cur) return;
        const ms = now - cur.start;
        if (!cur.settled && ms >= simMs) {
          cur.settled = true;
          opts.onSettle?.(roll);
        }
        const after = ms - simMs;
        const alpha = after > HOLD_MS ? clamp(1 - (after - HOLD_MS) / FADE_MS, 0, 1) : 1;
        if (frameCount) draw(roll, (ms / 1000) * roll.frameRate, alpha, cur.settled ? clamp(after / 400, 0, 1) : 0);
        if (alpha <= 0) {
          current = null;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          canvas.hidden = true;
          opts.onDone?.(roll);
          return;
        }
        cur.raf = requestAnimationFrame(tick);
      };
      cur.raf = requestAnimationFrame(tick);
    }

    canvas.hidden = true;
    return { play, stop, isPlaying: () => !!current };
  }

  window.LodestarDice = { parse, format, createRoll, createStage, PHYSICAL };
})();
