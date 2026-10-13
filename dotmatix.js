/*!
 * Dotmatix v0.2.0
 * Canvas-rendered dot-matrix loaders. No dependencies, no build step.
 * MIT License
 */
(function (root, factory) {
  const lib = factory(root);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.Dotmatix = lib;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const VERSION = "0.2.0";
  const TAU = Math.PI * 2;
  const hasDOM = typeof document !== "undefined";

  /* ---------- helpers ---------- */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function smoothstep(e0, e1, x) {
    const k = clamp((x - e0) / (e1 - e0), 0, 1);
    return k * k * (3 - 2 * k);
  }

  function prng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(n, rand) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------- brightness field ---------- */

  // A w×h index grid. `mask` hides cells, `px`/`py` hold each cell's drawing position in dot spacings.
  class Field {
    constructor(w, h, mask, px, py) {
      const n = w * h;
      this.w = w;
      this.h = h;
      this.v = new Float32Array(n);
      this.mask = mask || null;
      this.px = px || Float32Array.from({ length: n }, (_, i) => i % w);
      this.py = py || Float32Array.from({ length: n }, (_, i) => Math.floor(i / w));
      this.cells = [];
      let maxX = 0;
      let maxY = 0;
      for (let i = 0; i < n; i++) {
        if (mask && !mask[i]) continue;
        this.cells.push(i);
        maxX = Math.max(maxX, this.px[i]);
        maxY = Math.max(maxY, this.py[i]);
      }
      this.spanX = maxX + 1;
      this.spanY = maxY + 1;
      this.cx = maxX / 2;
      this.cy = maxY / 2;
    }

    // Hexagon of the given radius in axial coordinates (q = x - radius, r = y - radius).
    static hex(radius) {
      const size = radius * 2 + 1;
      const n = size * size;
      const mask = new Uint8Array(n);
      const px = new Float32Array(n);
      const py = new Float32Array(n);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const q = x - radius;
          const r = y - radius;
          if (Math.abs(q + r) > radius) continue;
          const i = y * size + x;
          mask[i] = 1;
          px[i] = q + r / 2 + radius;
          py[i] = (r + radius) * (Math.sqrt(3) / 2);
        }
      }
      const f = new Field(size, size, mask, px, py);
      f.radius = radius;
      f.ring = new Uint8Array(n);
      f.nb = [];
      for (const i of f.cells) {
        const [q, r] = f.axial(i);
        f.ring[i] = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
        f.nb[i] = HEX_STEPS.map(([dq, dr]) => f.index(q + dq, r + dr)).filter((j) => j >= 0);
      }
      return f;
    }

    axial(i) {
      return [(i % this.w) - this.radius, Math.floor(i / this.w) - this.radius];
    }

    index(q, r) {
      const x = q + this.radius;
      const y = r + this.radius;
      return this.inside(x, y) ? y * this.w + x : -1;
    }

    clear() {
      this.v.fill(0);
    }

    // Exponential fade with the given half-life in seconds (frame-rate independent).
    decay(halfLife, dt) {
      const k = Math.pow(0.5, dt / halfLife);
      for (let i = 0; i < this.v.length; i++) this.v[i] *= k;
    }

    inside(x, y) {
      return x >= 0 && y >= 0 && x < this.w && y < this.h && (!this.mask || this.mask[y * this.w + x] === 1);
    }

    set(x, y, a) {
      x = Math.round(x);
      y = Math.round(y);
      if (this.inside(x, y)) this.v[y * this.w + x] = a;
    }

    lift(x, y, a) {
      x = Math.round(x);
      y = Math.round(y);
      if (!this.inside(x, y)) return;
      const i = y * this.w + x;
      if (a > this.v[i]) this.v[i] = a;
    }

    // Soft point at sub-cell coordinates with linear falloff over radius r.
    glow(px, py, r, a) {
      if (this.mask) {
        for (const i of this.cells) {
          const d = Math.hypot(this.px[i] - px, this.py[i] - py);
          if (d < r && a * (1 - d / r) > this.v[i]) this.v[i] = a * (1 - d / r);
        }
        return;
      }
      const x0 = Math.max(0, Math.floor(px - r));
      const x1 = Math.min(this.w - 1, Math.ceil(px + r));
      const y0 = Math.max(0, Math.floor(py - r));
      const y1 = Math.min(this.h - 1, Math.ceil(py + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - px, y - py);
          if (d < r) this.lift(x, y, a * (1 - d / r));
        }
      }
    }

    line(x0, y0, x1, y1, a) {
      const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        this.lift(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, a);
      }
    }

    // fn receives the drawing position of each cell (equal to its column/row on rectangular grids).
    fill(fn) {
      this.v.fill(0);
      for (const i of this.cells) this.v[i] = clamp(fn(this.px[i], this.py[i], i), 0, 1);
    }
  }

  const HEX_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

  /* ---------- registry ---------- */

  const REGISTRY = Object.create(null);

  function register(name, def) {
    if (!name || typeof name !== "string") throw new TypeError("Dotmatix.register: name must be a string");
    if (!def || typeof def.update !== "function") throw new TypeError("Dotmatix.register: update() is required");
    REGISTRY[name] = Object.assign({ cols: 7, rows: 7, radius: 3, title: name, note: "", still: 1.2 }, def);
  }

  /* ---------- built-in animations ---------- */

  register("rain", {
    title: "Rain",
    note: "Drops fall down every column at their own pace and leave fading tails.",
    cols: 7,
    rows: 7,
    init(s, f) {
      s.drops = Array.from({ length: f.w }, () => ({ y: -s.rand() * f.h, v: 4 + s.rand() * 5 }));
    },
    update(s, f, c) {
      f.decay(0.09, c.dt);
      s.drops.forEach((d, x) => {
        d.y += d.v * c.dt;
        if (d.y >= 0) f.lift(x, Math.floor(d.y), 1);
        if (d.y > f.h + s.rand() * 2) {
          d.y = -s.rand() * f.h * 0.6;
          d.v = 4 + s.rand() * 5;
        }
      });
    },
  });

  register("raindrop", {
    title: "Raindrop",
    note: "Drops land at random spots and spread out as overlapping rings.",
    cols: 9,
    rows: 9,
    init(s) {
      s.drops = [];
      s.next = 0;
    },
    update(s, f, c) {
      const LIFE = 1.2;
      s.next -= c.dt;
      if (s.next <= 0) {
        s.next = 0.55;
        s.drops.push({ x: 1 + s.rand() * (f.w - 3), y: 1 + s.rand() * (f.h - 3), age: 0 });
      }
      f.clear();
      s.drops = s.drops.filter((d) => (d.age += c.dt) < LIFE);
      for (const d of s.drops) {
        const r = d.age * 5;
        const fade = 1 - d.age / LIFE;
        for (let y = 0; y < f.h; y++) {
          for (let x = 0; x < f.w; x++) {
            const band = 1 - Math.abs(Math.hypot(x - d.x, y - d.y) - r) * 1.4;
            if (band > 0) f.lift(x, y, band * fade);
          }
        }
      }
    },
  });

  register("orbit", {
    title: "Orbit",
    note: "A comet circles the grid on a smooth path around a softly pulsing core.",
    cols: 7,
    rows: 7,
    update(s, f, c) {
      f.decay(0.14, c.dt);
      const a = c.t * TAU * 0.85;
      const r = f.cx * 0.92;
      f.glow(f.cx + Math.cos(a) * r, f.cy + Math.sin(a) * r, 1.3, 1);
      f.glow(f.cx, f.cy, 0.9, 0.3 + 0.2 * Math.sin(c.t * TAU * 1.7));
    },
  });

  register("pendulum", {
    title: "Pendulum",
    note: "A weight swings on a faint rod hanging from the top edge.",
    cols: 9,
    rows: 7,
    update(s, f, c) {
      f.clear();
      const a = Math.sin(c.t * Math.PI * 1.3) * 1.05;
      const len = f.h - 1.4;
      const px = f.cx;
      const py = -0.4;
      const bx = px + Math.sin(a) * len;
      const by = py + Math.cos(a) * len;
      f.line(px, py, bx, by, 0.35);
      f.glow(bx, by, 1.25, 1);
    },
  });

  register("bounce", {
    title: "Bounce",
    note: "A ball hops across the floor with gravity and a little splash on impact.",
    cols: 9,
    rows: 7,
    update(s, f, c) {
      f.decay(0.07, c.dt);
      const period = 0.8;
      const p = (c.t % period) / period;
      const y = (f.h - 1) * (1 - 4 * p * (1 - p) * 0.92);
      const u = (c.t * 0.32) % 2;
      const x = (u < 1 ? u : 2 - u) * (f.w - 1);
      f.glow(x, y, 1.1, 1);
      if (p < 0.07 || p > 0.93) {
        f.lift(x - 1, f.h - 1, 0.55);
        f.lift(x + 1, f.h - 1, 0.55);
      }
    },
  });

  const ECG = [
    [0, 0], [0.3, 0], [0.33, 0.25], [0.36, 0], [0.42, 0], [0.44, -0.3], [0.47, 1],
    [0.5, -0.7], [0.53, 0], [0.64, 0], [0.7, 0.35], [0.76, 0], [1, 0],
  ];

  function ecg(u) {
    for (let i = 1; i < ECG.length; i++) {
      const b = ECG[i];
      if (u <= b[0]) {
        const a = ECG[i - 1];
        return a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]);
      }
    }
    return 0;
  }

  register("heartbeat", {
    title: "Heartbeat",
    note: "A monitor trace sweeps from left to right and draws a heartbeat curve.",
    cols: 13,
    rows: 7,
    init(s) {
      s.prevY = null;
    },
    update(s, f, c) {
      f.decay(0.45, c.dt);
      const u = (c.t / 1.4) % 1;
      const x = Math.floor(u * f.w);
      const y = Math.round(f.cy - ecg(u) * f.cy);
      const from = s.prevY == null ? y : s.prevY;
      for (let r = Math.min(from, y); r <= Math.max(from, y); r++) f.set(x, r, 1);
      s.prevY = y;
    },
  });

  register("typing", {
    title: "Typing",
    note: "Three dots hop one after another, like someone is writing a message.",
    cols: 7,
    rows: 4,
    still: 0.25,
    update(s, f, c) {
      f.clear();
      for (let i = 0; i < 3; i++) {
        const lift = Math.max(0, Math.sin(c.t * TAU * 1.1 - i * 0.85));
        f.glow(1 + i * 2, f.h - 1 - lift * (f.h - 1.5), 1, 0.45 + 0.55 * lift);
      }
    },
  });

  function seedLife(s, n) {
    s.cells = new Uint8Array(n);
    for (let i = 0; i < n; i++) s.cells[i] = s.rand() < 0.38 ? 1 : 0;
    s.gen = 0;
    s.seen = [];
  }

  register("life", {
    title: "Life",
    note: "Conway's Game of Life on a wrapping grid. It reseeds when it dies out or loops.",
    cols: 9,
    rows: 9,
    tick: 150,
    init(s, f) {
      seedLife(s, f.v.length);
      f.v.set(s.cells);
    },
    update(s, f) {
      const { w, h } = f;
      const cur = s.cells;
      const next = new Uint8Array(cur.length);
      let pop = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx || dy) n += cur[((y + dy + h) % h) * w + ((x + dx + w) % w)];
            }
          }
          const i = y * w + x;
          next[i] = n === 3 || (cur[i] && n === 2) ? 1 : 0;
          pop += next[i];
        }
      }
      const key = next.join("");
      s.gen++;
      if (pop === 0 || s.gen > 80 || s.seen.includes(key)) {
        seedLife(s, cur.length);
      } else {
        s.seen.push(key);
        if (s.seen.length > 4) s.seen.shift();
        s.cells = next;
      }
      f.v.set(s.cells);
    },
  });

  register("lava", {
    title: "Lava",
    note: "Overlapping sine fields make slow blobs that flow and merge.",
    cols: 9,
    rows: 9,
    update(s, f, c) {
      const t = c.t;
      const mx = f.cx + Math.cos(t * 0.7) * 2.5;
      const my = f.cy + Math.sin(t * 0.9) * 2.5;
      f.fill((x, y) => {
        const v =
          Math.sin(x * 0.8 + t * 1.4) +
          Math.sin(y * 0.9 - t * 1.1) +
          Math.sin((x + y) * 0.55 + t * 0.8) +
          Math.sin(Math.hypot(x - mx, y - my) * 1.1 - t * 2);
        return smoothstep(0.35, 0.8, (v + 4) / 8);
      });
    },
  });

  register("twinkle", {
    title: "Twinkle",
    note: "Every dot sparkles on its own random rhythm, like a starry sky.",
    cols: 9,
    rows: 9,
    init(s, f) {
      s.freq = Array.from(f.v, () => 1.5 + s.rand() * 3);
      s.phase = Array.from(f.v, () => s.rand() * TAU);
    },
    update(s, f, c) {
      f.fill((x, y) => {
        const i = y * f.w + x;
        return Math.pow(Math.max(0, Math.sin(c.t * s.freq[i] + s.phase[i])), 10);
      });
    },
  });

  register("metaballs", {
    title: "Metaballs",
    note: "Three blobs drift on looping paths and melt together when they meet.",
    cols: 9,
    rows: 9,
    update(s, f, c) {
      const t = c.t;
      const balls = [
        [f.cx + Math.cos(t * 1.3) * 2.6, f.cy + Math.sin(t * 1.9) * 2.4, 1.8],
        [f.cx + Math.cos(t * 0.9 + 2) * 2.8, f.cy + Math.sin(t * 1.2 + 1) * 2.6, 1.5],
        [f.cx + Math.sin(t * 1.6) * 2.2, f.cy + Math.cos(t * 0.7) * 2.8, 1.3],
      ];
      f.fill((x, y) => {
        let sum = 0;
        for (const [bx, by, r] of balls) sum += (r * r) / ((x - bx) ** 2 + (y - by) ** 2 + 0.01);
        return smoothstep(0.9, 1.6, sum);
      });
    },
  });

  register("chomp", {
    title: "Chomp",
    note: "A hungry mouth opens and closes while pellets roll into it.",
    cols: 13,
    rows: 7,
    update(s, f, c) {
      const r = 3.2;
      const cx = 3;
      const cy = f.cy;
      const mouth = 0.15 + 0.65 * Math.abs(Math.sin(c.t * Math.PI * 2.4));
      f.fill((x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d > r) return 0;
        if (d < 0.5) return 1;
        return Math.abs(Math.atan2(dy, dx)) > mouth ? 1 : 0;
      });
      f.set(cx, cy - 2, 0);
      const gap = 3;
      const off = (c.t * 3.2) % gap;
      for (let k = 0; k < 5; k++) {
        const px = 4 + k * gap - off;
        if (px >= 3.6 && px <= f.w - 1) f.set(px, cy, 0.7);
      }
    },
  });

  register("firework", {
    title: "Firework",
    note: "Sparks burst from random points, slow down and fall with gravity.",
    cols: 11,
    rows: 11,
    init(s) {
      s.sparks = [];
      s.next = 0;
    },
    update(s, f, c) {
      f.decay(0.12, c.dt);
      s.next -= c.dt;
      if (s.next <= 0) {
        s.next = 0.95;
        const ox = 2 + s.rand() * (f.w - 5);
        const oy = 2 + s.rand() * (f.h - 6);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + s.rand() * 0.3;
          const sp = 3.2 + s.rand() * 1.6;
          s.sparks.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
        }
      }
      const drag = Math.pow(0.25, c.dt);
      s.sparks = s.sparks.filter((p) => {
        p.vx *= drag;
        p.vy = p.vy * drag + 5 * c.dt;
        p.x += p.vx * c.dt;
        p.y += p.vy * c.dt;
        p.life -= c.dt * 1.1;
        if (p.life > 0) f.lift(p.x, p.y, p.life);
        return p.life > 0;
      });
    },
  });

  register("clock", {
    title: "Clock",
    note: "A long and a short hand turn around the center between four markers.",
    cols: 9,
    rows: 9,
    update(s, f, c) {
      f.clear();
      const { cx, cy } = f;
      f.set(cx, 0, 0.4);
      f.set(cx, f.h - 1, 0.4);
      f.set(0, cy, 0.4);
      f.set(f.w - 1, cy, 0.4);
      const hour = c.t * TAU * 0.12 - Math.PI / 2;
      const minute = c.t * TAU * 0.5 - Math.PI / 2;
      f.line(cx, cy, cx + Math.cos(hour) * 2, cy + Math.sin(hour) * 2, 0.6);
      f.line(cx, cy, cx + Math.cos(minute) * 3.3, cy + Math.sin(minute) * 3.3, 1);
    },
  });

  register("wave", {
    title: "Wave",
    note: "An oscilloscope-style sine wave travels along the grid and changes its height.",
    cols: 11,
    rows: 7,
    update(s, f, c) {
      const amp = (f.cy - 0.2) * (0.55 + 0.45 * Math.sin(c.t * 1.7));
      const at = (x) => f.cy + Math.sin(x * 0.75 - c.t * 5) * amp;
      f.fill((x, y) => {
        const d = Math.min(Math.abs(y - at(x - 0.5)), Math.abs(y - at(x)), Math.abs(y - at(x + 0.5)));
        return 1 - d * 1.1;
      });
    },
  });

  register("dissolve", {
    title: "Dissolve",
    note: "Dots switch on one by one in random order, hold, then switch off again.",
    cols: 7,
    rows: 7,
    tick: 45,
    init(s, f) {
      s.order = shuffled(f.v.length, s.rand);
      s.i = 0;
      s.on = 1;
      s.hold = 0;
    },
    update(s, f) {
      if (s.hold > 0) {
        s.hold--;
        return;
      }
      if (s.i < s.order.length) {
        f.v[s.order[s.i++]] = s.on;
        return;
      }
      s.on = 1 - s.on;
      s.order = shuffled(f.v.length, s.rand);
      s.i = 0;
      s.hold = s.on ? 6 : 12;
    },
  });

  register("spinner", {
    title: "Spinner",
    note: "Eight dots on a circle light up in turn with a fading trail.",
    cols: 9,
    rows: 9,
    tick: 90,
    update(s, f, c) {
      f.clear();
      const head = c.n % 8;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU - Math.PI / 2;
        const behind = (head - k + 8) % 8;
        f.set(f.cx + Math.cos(a) * 3.2, f.cy + Math.sin(a) * 3.2, Math.max(0, 1 - behind * 0.18));
      }
    },
  });

  const FONT = {
    0: ["111", "101", "101", "101", "111"],
    1: ["010", "110", "010", "010", "111"],
    2: ["111", "001", "111", "100", "111"],
    3: ["111", "001", "111", "001", "111"],
    4: ["101", "101", "111", "001", "001"],
    5: ["111", "100", "111", "001", "111"],
    6: ["111", "100", "111", "101", "111"],
    7: ["111", "001", "010", "010", "010"],
    8: ["111", "101", "111", "101", "111"],
    9: ["111", "101", "111", "001", "111"],
    A: ["010", "101", "111", "101", "101"],
    D: ["110", "101", "101", "101", "110"],
    G: ["111", "100", "101", "101", "111"],
    I: ["111", "010", "010", "010", "111"],
    L: ["100", "100", "100", "100", "111"],
    N: ["101", "111", "111", "101", "101"],
    O: ["111", "101", "101", "101", "111"],
    " ": ["000", "000", "000", "000", "000"],
  };

  // Text as a list of 5-dot columns, one blank column after each glyph.
  function textColumns(text) {
    const cols = [];
    for (const ch of text) {
      const g = FONT[ch] || FONT[" "];
      for (let x = 0; x < 3; x++) cols.push(g.map((row) => +row[x]));
      cols.push([0, 0, 0, 0, 0]);
    }
    return cols;
  }

  function drawGlyph(f, ch, ox, oy, a) {
    const g = FONT[ch] || FONT[" "];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 3; x++) if (g[y][x] === "1") f.set(ox + x, oy + y, a);
    }
  }

  const MARQUEE = textColumns("LOADING  ");

  register("marquee", {
    title: "Marquee",
    note: "The word LOADING scrolls by on a tiny pixel sign.",
    cols: 17,
    rows: 7,
    update(s, f, c) {
      const off = Math.floor(c.t * 8);
      const top = Math.round(f.cy) - 2;
      f.fill((x, y) => {
        const row = y - top;
        if (row < 0 || row > 4) return 0;
        return MARQUEE[(x + off) % MARQUEE.length][row];
      });
    },
  });

  register("counter", {
    title: "Counter",
    note: "Two pixel digits count from 00 to 99 and start over.",
    cols: 9,
    rows: 7,
    tick: 120,
    update(s, f, c) {
      f.clear();
      const n = c.n % 100;
      const top = Math.round(f.cy) - 2;
      drawGlyph(f, String(Math.floor(n / 10)), Math.round(f.cx) - 3, top, 1);
      drawGlyph(f, String(n % 10), Math.round(f.cx) + 1, top, 1);
    },
  });

  register("galaxy", {
    title: "Galaxy",
    note: "Two curved arms wind around a bright core and slowly turn.",
    cols: 11,
    rows: 11,
    update(s, f, c) {
      const edge = Math.min(f.cx, f.cy) + 0.5;
      f.fill((x, y) => {
        const dx = x - f.cx;
        const dy = y - f.cy;
        const r = Math.hypot(dx, dy);
        if (r > edge) return 0;
        const arm = Math.cos(2 * (Math.atan2(dy, dx) - Math.log(r + 0.6) * 2.2 + c.t * 1.6));
        const core = 1 - r / 1.6;
        return Math.max(core, smoothstep(0.55, 1, arm) * (1 - (r / edge) * 0.5));
      });
    },
  });

  register("snow", {
    title: "Snow",
    note: "Flakes drift down with a gentle sway, pile up on the ground and slowly melt.",
    cols: 9,
    rows: 9,
    still: 4,
    init(s, f) {
      s.ground = new Float32Array(f.w);
      s.flakes = Array.from({ length: 6 }, () => ({
        x: s.rand() * (f.w - 1),
        y: -s.rand() * f.h,
        v: 1.6 + s.rand() * 1.4,
        ph: s.rand() * TAU,
      }));
    },
    update(s, f, c) {
      f.clear();
      for (let x = 0; x < f.w; x++) {
        s.ground[x] = Math.max(0, s.ground[x] - c.dt * 0.12);
        const g = s.ground[x];
        for (let k = 0; k < Math.ceil(g); k++) f.set(x, f.h - 1 - k, 0.75 * Math.min(1, g - k));
      }
      for (const fl of s.flakes) {
        fl.y += fl.v * c.dt;
        const x = clamp(fl.x + Math.sin(c.t * 1.5 + fl.ph) * 0.6, 0, f.w - 1);
        const col = Math.round(x);
        if (fl.y >= f.h - 1 - Math.floor(s.ground[col])) {
          s.ground[col] = Math.min(2.5, s.ground[col] + 0.5);
          fl.y = -s.rand() * 2;
          fl.x = s.rand() * (f.w - 1);
          continue;
        }
        if (fl.y >= 0) f.glow(x, fl.y, 1, 1);
      }
    },
  });

  register("tank", {
    title: "Tank",
    note: "Water fills up with a sloshing surface and drains again.",
    cols: 9,
    rows: 9,
    update(s, f, c) {
      const p = (c.t / 3) % 1;
      const level = p < 0.5 ? smoothstep(0, 0.5, p) : 1 - smoothstep(0.5, 1, p);
      const depth = f.h * (0.1 + 0.8 * level);
      f.fill((x, y) => {
        const surface = f.h - depth + Math.sin(x * 0.9 + c.t * 5) * 0.45;
        const d = y - surface;
        if (d >= 0.5) return 0.5;
        if (d > -0.5) return 1;
        return 0;
      });
    },
  });

  const GAZE = [[0, 0], [-1, 0], [-1, -1], [1, 0], [0, 0], [1, 1], [0, -1]];

  register("eye", {
    title: "Eye",
    note: "An eye glances around and blinks every few seconds.",
    cols: 11,
    rows: 7,
    update(s, f, c) {
      const rx = f.cx + 0.3;
      const ry = f.cy + 0.2;
      const seg = Math.floor(c.t / 0.9);
      const e = smoothstep(0, 0.35, (c.t % 0.9) / 0.9);
      const from = GAZE[seg % GAZE.length];
      const to = GAZE[(seg + 1) % GAZE.length];
      const px = f.cx + (from[0] + (to[0] - from[0]) * e) * rx * 0.5;
      const py = f.cy + (from[1] + (to[1] - from[1]) * e) * ry * 0.3;
      const bt = c.t % 3.1;
      const blink = bt < 0.2 ? Math.sin((bt / 0.2) * Math.PI) : 0;
      const lid = ry * (1 - blink);
      f.fill((x, y) => {
        const k = ((x - f.cx) / rx) ** 2 + ((y - f.cy) / ry) ** 2;
        if (k > 1) return 0;
        if (blink > 0.9) return y === Math.round(f.cy) ? 0.6 : 0;
        if (Math.abs(y - f.cy) > lid) return 0;
        const pupil = 1 - Math.hypot(x - px, y - py) / 1.5;
        return Math.max(k > 0.7 ? 0.55 : 0.22, pupil);
      });
    },
  });

  register("starfield", {
    title: "Starfield",
    note: "Stars rush out of the center as if flying at warp speed.",
    cols: 11,
    rows: 11,
    init(s) {
      s.stars = Array.from({ length: 14 }, () => ({
        a: s.rand() * TAU,
        d: s.rand() * 6,
        v: 1.5 + s.rand() * 2,
      }));
    },
    update(s, f, c) {
      f.decay(0.06, c.dt);
      for (const st of s.stars) {
        st.d += c.dt * st.v * (0.4 + st.d);
        if (st.d > 8) {
          st.d = s.rand() * 0.5;
          st.a = s.rand() * TAU;
          st.v = 1.5 + s.rand() * 2;
        }
        f.lift(f.cx + Math.cos(st.a) * st.d, f.cy + Math.sin(st.a) * st.d, Math.min(1, 0.3 + st.d / 4));
      }
    },
  });

  register("pong", {
    title: "Pong",
    note: "Two paddles keep a ball in play forever.",
    cols: 13,
    rows: 9,
    init(s, f) {
      Object.assign(s, { bx: f.cx, by: f.cy, vx: 7, vy: 4.3, l: f.cy, r: f.cy });
    },
    update(s, f, c) {
      const { w, h } = f;
      s.bx += s.vx * c.dt;
      s.by += s.vy * c.dt;
      if (s.by < 0) {
        s.by = -s.by;
        s.vy = -s.vy;
      } else if (s.by > h - 1) {
        s.by = 2 * (h - 1) - s.by;
        s.vy = -s.vy;
      }
      if (s.bx < 1 || s.bx > w - 2) {
        s.bx = s.bx < 1 ? 2 - s.bx : 2 * (w - 2) - s.bx;
        s.vx = -s.vx;
        s.vy += (s.rand() - 0.5) * 2;
        s.vy = Math.sign(s.vy || 1) * clamp(Math.abs(s.vy), 1.5, 6);
      }
      const k = c.dt * 9;
      s.l = clamp(s.l + clamp(s.by - s.l, -k, k), 1, h - 2);
      s.r = clamp(s.r + clamp(s.by - s.r, -k, k), 1, h - 2);
      f.clear();
      for (let y = 0; y < h; y += 2) f.set(f.cx, y, 0.25);
      for (let d = -1; d <= 1; d++) {
        f.set(0, s.l + d, 0.8);
        f.set(w - 1, s.r + d, 0.8);
      }
      f.lift(s.bx, s.by, 1);
    },
  });

  register("atom", {
    title: "Atom",
    note: "Two electrons race around a glowing nucleus on tilted orbits.",
    cols: 11,
    rows: 11,
    update(s, f, c) {
      f.decay(0.1, c.dt);
      const orbits = [
        { tilt: 0.6, speed: 0.7, offset: 0 },
        { tilt: -0.6, speed: 0.55, offset: Math.PI },
      ];
      for (const o of orbits) {
        const cos = Math.cos(o.tilt);
        const sin = Math.sin(o.tilt);
        const at = (a) => {
          const ex = Math.cos(a) * 4.3;
          const ey = Math.sin(a) * 1.6;
          return [f.cx + ex * cos - ey * sin, f.cy + ex * sin + ey * cos];
        };
        for (let i = 0; i < 40; i++) {
          const [x, y] = at((i / 40) * TAU);
          f.lift(x, y, 0.18);
        }
        const [x, y] = at(c.t * TAU * o.speed + o.offset);
        f.glow(x, y, 1.1, 1);
      }
      f.glow(f.cx, f.cy, 1.2, 0.9);
    },
  });

  register("fireflies", {
    title: "Fireflies",
    note: "A few lights wander around at random and glow on and off.",
    cols: 11,
    rows: 9,
    init(s, f) {
      s.flies = Array.from({ length: 5 }, () => ({
        x: s.rand() * (f.w - 1),
        y: s.rand() * (f.h - 1),
        vx: 0,
        vy: 0,
        ph: s.rand() * TAU,
        fr: 2 + s.rand() * 2,
      }));
    },
    update(s, f, c) {
      f.decay(0.1, c.dt);
      const damp = Math.pow(0.4, c.dt);
      for (const fl of s.flies) {
        fl.vx = fl.vx * damp + (s.rand() - 0.5) * c.dt * 12;
        fl.vy = fl.vy * damp + (s.rand() - 0.5) * c.dt * 12;
        fl.x += fl.vx * c.dt;
        fl.y += fl.vy * c.dt;
        if (fl.x < 0 || fl.x > f.w - 1) fl.vx = -fl.vx;
        if (fl.y < 0 || fl.y > f.h - 1) fl.vy = -fl.vy;
        fl.x = clamp(fl.x, 0, f.w - 1);
        fl.y = clamp(fl.y, 0, f.h - 1);
        const b = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(c.t * fl.fr + fl.ph)), 3);
        f.glow(fl.x, fl.y, 1.1, b);
      }
    },
  });

  register("inchworm", {
    title: "Inchworm",
    note: "A worm stretches forward, arches its back and pulls its tail after it.",
    cols: 13,
    rows: 5,
    update(s, f, c) {
      f.clear();
      const p = c.t % 1;
      const pos = Math.floor(c.t) * 3;
      let tail;
      let head;
      if (p < 0.5) {
        tail = pos;
        head = pos + 2 + 3 * smoothstep(0, 1, p * 2);
      } else {
        tail = pos + 3 * smoothstep(0, 1, (p - 0.5) * 2);
        head = pos + 5;
      }
      const len = head - tail;
      const arch = ((5 - len) / 3) * 2;
      const span = f.w + 6;
      const wrap = (x) => (((x % span) + span) % span) - 3;
      const floor = f.h - 2;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        f.lift(wrap(tail + t * len), floor - Math.sin(t * Math.PI) * arch, 0.7);
      }
      f.lift(wrap(head), floor, 1);
    },
  });

  register("maze", {
    title: "Maze",
    note: "A random maze carves itself out path by path, then starts again.",
    cols: 11,
    rows: 11,
    tick: 35,
    init(s, f) {
      s.carved = new Uint8Array(f.v.length);
      s.carved[f.w + 1] = 1;
      s.stack = [[1, 1]];
      s.hold = 0;
      f.clear();
    },
    update(s, f) {
      const { w, h } = f;
      if (!s.stack.length) {
        if (++s.hold > 25) this.init(s, f);
        else f.v.forEach((v, i) => (f.v[i] = s.carved[i] ? 0.6 : 0));
        return;
      }
      const [x, y] = s.stack[s.stack.length - 1];
      const options = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && !s.carved[ny * w + nx];
      });
      if (options.length) {
        const [dx, dy] = options[Math.floor(s.rand() * options.length)];
        s.carved[(y + dy / 2) * w + x + dx / 2] = 1;
        s.carved[(y + dy) * w + x + dx] = 1;
        s.stack.push([x + dx, y + dy]);
      } else {
        s.stack.pop();
      }
      for (let i = 0; i < f.v.length; i++) f.v[i] = s.carved[i] ? 0.6 : 0;
      const top = s.stack[s.stack.length - 1];
      if (top) f.v[top[1] * w + top[0]] = 1;
    },
  });

  /* ---------- small grids ---------- */

  const DICE = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

  register("dice", {
    title: "Dice",
    note: "A die tumbles through random faces and lands on a number.",
    cols: 3,
    rows: 3,
    tick: 110,
    init(s) {
      s.count = 0;
      s.face = 1;
    },
    update(s, f) {
      const k = s.count++ % 18;
      if (k <= 8) {
        let next;
        do next = 1 + Math.floor(s.rand() * 6);
        while (next === s.face);
        s.face = next;
      }
      f.clear();
      for (const i of DICE[s.face]) f.v[i] = k < 8 ? 0.7 : 1;
    },
  });

  register("binary", {
    title: "Binary",
    note: "Nine dots count upward in binary, the last dot being the lowest bit.",
    cols: 3,
    rows: 3,
    tick: 160,
    update(s, f, c) {
      const n = f.v.length;
      const value = c.n % 2 ** n;
      for (let i = 0; i < n; i++) f.v[i] = (value >> (n - 1 - i)) & 1;
    },
  });

  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  register("tictactoe", {
    title: "Tic-Tac-Toe",
    note: "Bright X and dim O take turns until someone wins and the line flashes.",
    cols: 3,
    rows: 3,
    tick: 260,
    still: 1.6,
    init(s) {
      s.board = new Array(9).fill(0);
      s.turn = 1;
      s.win = null;
      s.wait = 0;
    },
    update(s, f) {
      if (s.wait > 0) {
        s.wait--;
        if (s.wait === 0) this.init(s);
      } else {
        const free = s.board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
        s.board[free[Math.floor(s.rand() * free.length)]] = s.turn;
        s.win = LINES.find((l) => l.every((i) => s.board[i] === s.turn)) || null;
        if (s.win) s.wait = 8;
        else if (free.length === 1) s.wait = 4;
        s.turn = 3 - s.turn;
      }
      for (let i = 0; i < 9; i++) {
        const v = s.board[i] === 1 ? 1 : s.board[i] === 2 ? 0.45 : 0;
        if (!s.win) f.v[i] = v;
        else f.v[i] = s.win.includes(i) ? (s.wait % 2 ? 1 : 0.15) : 0.2;
      }
    },
  });

  register("static", {
    title: "Static",
    note: "Random flicker, like an untuned TV.",
    cols: 4,
    rows: 4,
    tick: 70,
    update(s, f) {
      for (let i = 0; i < f.v.length; i++) f.v[i] = s.rand() ** 2;
    },
  });

  register("slide", {
    title: "Slide",
    note: "A sliding-tile puzzle where one tile moves into the gap at a time.",
    cols: 4,
    rows: 4,
    tick: 380,
    init(s, f) {
      s.gap = f.v.length - 1;
      s.prev = -1;
      s.moved = -1;
      for (let i = 0; i < f.v.length; i++) f.v[i] = i === s.gap ? 0 : 0.5;
    },
    update(s, f) {
      const { w, h } = f;
      const gx = s.gap % w;
      const gy = Math.floor(s.gap / w);
      const options = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => [gx + dx, gy + dy])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < h && y * w + x !== s.prev)
        .map(([x, y]) => y * w + x);
      const from = options[Math.floor(s.rand() * options.length)];
      s.prev = s.gap;
      s.moved = s.gap;
      s.gap = from;
      for (let i = 0; i < f.v.length; i++) f.v[i] = i === s.gap ? 0 : i === s.moved ? 1 : 0.5;
    },
  });

  register("quadrants", {
    title: "Quadrants",
    note: "The four 2×2 quarters light up clockwise, the last one fading out.",
    cols: 4,
    rows: 4,
    tick: 220,
    update(s, f, c) {
      const order = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const active = c.n % 4;
      const previous = (active + 3) % 4;
      const hw = f.w / 2;
      const hh = f.h / 2;
      f.fill((x, y) => {
        const q = order.findIndex(([qx, qy]) => Math.floor(x / hw) === qx && Math.floor(y / hh) === qy);
        return q === active ? 1 : q === previous ? 0.35 : 0;
      });
    },
  });

  const GRAVITY = [[0, 1], [-1, 0], [0, -1], [1, 0]];

  register("tilt", {
    title: "Tilt",
    note: "Five beads slide inside a box whose gravity turns a quarter every moment.",
    cols: 4,
    rows: 4,
    tick: 110,
    init(s, f) {
      s.beads = shuffled(f.v.length, s.rand)
        .slice(0, 5)
        .map((i) => [i % f.w, Math.floor(i / f.w)]);
    },
    update(s, f, c) {
      const [dx, dy] = GRAVITY[Math.floor(c.n / 9) % 4];
      const taken = (x, y) => s.beads.some((b) => b[0] === x && b[1] === y);
      s.beads.sort((a, b) => (b[0] - a[0]) * dx + (b[1] - a[1]) * dy);
      for (const b of s.beads) {
        const nx = b[0] + dx;
        const ny = b[1] + dy;
        if (f.inside(nx, ny) && !taken(nx, ny)) {
          b[0] = nx;
          b[1] = ny;
        }
      }
      f.clear();
      for (const [x, y] of s.beads) f.set(x, y, 1);
    },
  });

  const HEART_BIG = [".X.X.", "XXXXX", "XXXXX", ".XXX.", "..X.."];
  const HEART_SMALL = [".....", ".X.X.", ".XXX.", "..X..", "....."];

  register("heart", {
    title: "Heart",
    note: "A pixel heart beats with a double pulse.",
    cols: 5,
    rows: 5,
    update(s, f, c) {
      const p = (c.t % 1.1) / 1.1;
      const bump = (at) => Math.max(0, 1 - Math.abs(p - at) / 0.07);
      const beat = Math.max(bump(0.06), bump(0.28) * 0.8);
      f.fill((x, y) => {
        if (HEART_SMALL[y] && HEART_SMALL[y][x] === "X") return 0.75 + 0.25 * beat;
        if (HEART_BIG[y] && HEART_BIG[y][x] === "X") return beat;
        return 0;
      });
    },
  });

  const INVADER = [
    [".XXX.", "X.X.X", "XXXXX", ".X.X.", "X...X"],
    [".XXX.", "X.X.X", "XXXXX", ".X.X.", ".X.X."],
  ];

  register("invader", {
    title: "Invader",
    note: "A little pixel alien shuffles its legs.",
    cols: 5,
    rows: 5,
    tick: 400,
    init(s, f) {
      this.update(s, f, { n: 0 });
    },
    update(s, f, c) {
      const sprite = INVADER[c.n % 2];
      f.fill((x, y) => (sprite[y] && sprite[y][x] === "X" ? 1 : 0));
    },
  });

  register("bouncer", {
    title: "Bouncer",
    note: "A single dot ricochets off the walls of the box, like an old screensaver.",
    cols: 5,
    rows: 5,
    update(s, f, c) {
      f.decay(0.08, c.dt);
      const tri = (u) => {
        const k = u % 2;
        return k < 1 ? k : 2 - k;
      };
      f.lift(tri(c.t * 1.1) * (f.w - 1), tri(c.t * 0.74) * (f.h - 1), 1);
    },
  });

  register("drip", {
    title: "Drip",
    note: "A drop swells at the top, falls and splashes on the floor.",
    cols: 5,
    rows: 5,
    update(s, f, c) {
      f.clear();
      const p = (c.t % 1.6) / 1.6;
      const x = Math.round(f.cx);
      const floor = f.h - 1;
      for (let i = x - 1; i <= x + 1; i++) f.set(i, floor, 0.3);
      if (p < 0.5) {
        f.set(x, 0, smoothstep(0, 0.5, p));
      } else if (p < 0.8) {
        f.glow(x, floor * ((p - 0.5) / 0.3) ** 2, 1, 1);
      } else {
        const k = (p - 0.8) / 0.2;
        const y = floor - Math.sin(k * Math.PI) * 1.5;
        f.lift(x - 1 - k * 1.5, y, 1 - k);
        f.lift(x + 1 + k * 1.5, y, 1 - k);
        f.lift(x, floor, 1 - k);
      }
    },
  });

  /* ---------- hexagons ---------- */

  const hexDistance = (f, a, b) => {
    const [q1, r1] = f.axial(a);
    const [q2, r2] = f.axial(b);
    return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
  };

  // All cells reachable from i by the hexagon's rotations and mirror images.
  function hexOrbit(f, i) {
    let [q, r] = f.axial(i);
    const out = new Set();
    for (let k = 0; k < 6; k++) {
      out.add(f.index(q, r));
      out.add(f.index(r, q));
      [q, r] = [-r, q + r];
    }
    out.delete(-1);
    return [...out];
  }

  const pick = (list, rand) => list[Math.floor(rand() * list.length)];

  register("hive", {
    title: "Hive",
    note: "Cells grow outward from the middle like honeycomb being built, then clear away.",
    layout: "hex",
    radius: 3,
    tick: 70,
    init(s, f) {
      const center = f.index(0, 0);
      s.filled = new Set([center]);
      s.recent = [center];
      s.phase = "grow";
      s.hold = 0;
      this.paint(s, f);
    },
    paint(s, f) {
      f.clear();
      for (const i of s.filled) f.v[i] = 0.55;
      for (const i of s.recent) if (s.filled.has(i)) f.v[i] = 1;
    },
    update(s, f) {
      if (s.phase === "grow") {
        const frontier = new Set();
        for (const i of s.filled) for (const j of f.nb[i]) if (!s.filled.has(j)) frontier.add(j);
        if (!frontier.size) {
          s.phase = "hold";
          s.hold = 10;
        } else {
          const next = pick([...frontier], s.rand);
          s.filled.add(next);
          s.recent.push(next);
          if (s.recent.length > 3) s.recent.shift();
        }
      } else if (s.phase === "hold") {
        s.recent = [];
        if (--s.hold <= 0) s.phase = "clear";
      } else {
        const list = [...s.filled];
        if (!list.length) {
          this.init(s, f);
          return;
        }
        for (let k = 0; k < 2 && list.length; k++) {
          s.filled.delete(list.splice(Math.floor(s.rand() * list.length), 1)[0]);
        }
      }
      this.paint(s, f);
    },
  });

  register("hexlife", {
    title: "Hex Life",
    note: "Game of Life on a honeycomb: cells are born with two neighbours and survive with three or four.",
    layout: "hex",
    radius: 3,
    tick: 220,
    init(s, f) {
      s.alive = new Uint8Array(f.v.length);
      for (const i of f.cells) s.alive[i] = s.rand() < 0.45 ? 1 : 0;
      s.gen = 0;
      s.seen = [];
      f.v.set(s.alive);
    },
    update(s, f) {
      const next = new Uint8Array(f.v.length);
      let pop = 0;
      for (const i of f.cells) {
        let n = 0;
        for (const j of f.nb[i]) n += s.alive[j];
        next[i] = (s.alive[i] ? n === 3 || n === 4 : n === 2) ? 1 : 0;
        pop += next[i];
      }
      const key = next.join("");
      s.gen++;
      if (!pop || s.gen > 60 || s.seen.includes(key)) {
        this.init(s, f);
        return;
      }
      s.seen.push(key);
      if (s.seen.length > 4) s.seen.shift();
      s.alive = next;
      f.v.set(next);
    },
  });

  register("zap", {
    title: "Zap",
    note: "Lightning bolts crackle from the center to a random point on the edge.",
    layout: "hex",
    radius: 3,
    init(s) {
      s.next = 0;
    },
    update(s, f, c) {
      f.decay(0.1, c.dt);
      const center = f.index(0, 0);
      s.next -= c.dt;
      if (s.next <= 0) {
        s.next = 0.35 + s.rand() * 0.5;
        let i = center;
        const path = [i];
        while (f.ring[i] < f.radius) {
          const outward = f.nb[i].filter((j) => f.ring[j] > f.ring[i]);
          const sideways = f.nb[i].filter((j) => f.ring[j] === f.ring[i] && !path.includes(j));
          i = pick(sideways.length && s.rand() < 0.3 ? sideways : outward, s.rand);
          path.push(i);
        }
        for (const j of path) f.v[j] = 1;
      }
      f.v[center] = Math.max(f.v[center], 0.35);
    },
  });

  register("bee", {
    title: "Bee",
    note: "A bee buzzes from cell to cell and collects the glowing flowers.",
    layout: "hex",
    radius: 3,
    tick: 140,
    init(s, f) {
      s.pos = f.index(0, 0);
      s.prev = -1;
      s.trail = [];
      s.flowers = new Set();
      while (s.flowers.size < 3) {
        const k = pick(f.cells, s.rand);
        if (k !== s.pos) s.flowers.add(k);
      }
    },
    update(s, f) {
      let options = f.nb[s.pos].filter((j) => j !== s.prev);
      const target = s.flowers.values().next().value;
      if (target != null && s.rand() < 0.7) {
        const best = Math.min(...options.map((j) => hexDistance(f, j, target)));
        options = options.filter((j) => hexDistance(f, j, target) === best);
      }
      s.prev = s.pos;
      s.pos = pick(options, s.rand);
      s.trail.unshift(s.prev);
      s.trail.length = Math.min(s.trail.length, 3);
      if (s.flowers.delete(s.pos)) {
        let k;
        do k = pick(f.cells, s.rand);
        while (k === s.pos || s.flowers.has(k));
        s.flowers.add(k);
      }
      f.clear();
      for (const i of s.flowers) f.v[i] = 0.35;
      s.trail.forEach((i, n) => (f.v[i] = Math.max(f.v[i], 0.6 - n * 0.18)));
      f.v[s.pos] = 1;
    },
  });

  register("snowflake", {
    title: "Snowflake",
    note: "A six-fold crystal grows random branches from the middle, then melts from the tips.",
    layout: "hex",
    radius: 4,
    tick: 160,
    still: 2,
    init(s, f) {
      s.ice = new Set([f.index(0, 0)]);
      s.phase = "grow";
      s.steps = 0;
      s.hold = 0;
      this.paint(s, f);
    },
    paint(s, f) {
      f.clear();
      for (const i of s.ice) f.v[i] = 1 - f.ring[i] * 0.1;
    },
    update(s, f) {
      if (s.phase === "grow") {
        const frontier = new Set();
        for (const i of s.ice) for (const j of f.nb[i]) if (!s.ice.has(j)) frontier.add(j);
        const all = [...frontier];
        const tips = all.filter((j) => f.nb[j].filter((k) => s.ice.has(k)).length === 1);
        const pool = tips.length ? tips : all;
        if (!pool.length || s.steps++ >= 7) {
          s.phase = "hold";
          s.hold = 8;
        } else {
          for (const j of hexOrbit(f, pick(pool, s.rand))) s.ice.add(j);
        }
      } else if (s.phase === "hold") {
        if (--s.hold <= 0) s.phase = "melt";
      } else if (s.hold++ % 2 === 0) {
        let far = 0;
        for (const i of s.ice) far = Math.max(far, f.ring[i]);
        if (far === 0) {
          this.init(s, f);
          return;
        }
        for (const i of [...s.ice]) if (f.ring[i] === far) s.ice.delete(i);
      }
      this.paint(s, f);
    },
  });

  function spawnBubble(s, f, y) {
    return { x: 1 + s.rand() * (f.spanX - 3), y, r: 0.6 + s.rand() * 0.9, v: 1.6 + s.rand() * 1.2, ph: s.rand() * TAU };
  }

  register("bubbles", {
    title: "Bubbles",
    note: "Bubbles of different sizes wobble upward through the hexagon.",
    layout: "hex",
    radius: 3,
    init(s, f) {
      s.list = [0, 1, 2].map((k) => spawnBubble(s, f, (f.spanY * (k + 1)) / 3));
    },
    update(s, f, c) {
      for (const b of s.list) {
        b.y -= b.v * c.dt;
        if (b.y < -b.r - 1) Object.assign(b, spawnBubble(s, f, f.spanY + b.r));
      }
      f.fill((x, y) => {
        let v = 0;
        for (const b of s.list) {
          const d = Math.hypot(x - (b.x + Math.sin(c.t * 2.2 + b.ph) * 0.5), y - b.y);
          v = Math.max(v, b.r > 1 ? 1 - Math.abs(d - b.r) * 1.6 : 1 - d / (b.r + 0.4));
        }
        return v;
      });
    },
  });

  /* ---------- matrix patterns ---------- */
  // Approximate ports of the matrix-vanilla loaders: same dot counts, layouts and sequences.

  function wrapNum(a, n) {
    return ((a % n) + n) % n;
  }

  function falloff(v, center, width) {
    const d = Math.abs(v - center);
    return d >= width ? 0 : 1 - d / width;
  }

  function pingpong(p) {
    const x = wrapNum(p, 1);
    return x < 0.5 ? x * 2 : 2 - x * 2;
  }

  function angBetween(a, b) {
    return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  }

  function paintCells(f, fn) {
    for (const i of f.cells) {
      const v = fn(f.row[i], f.col[i]);
      f.v[i] = v > 1 ? 1 : v > 0 ? v : 0;
    }
  }

  function gridField(n, keep) {
    const mask = new Uint8Array(n * n);
    const px = new Float32Array(n * n);
    const py = new Float32Array(n * n);
    const row = new Int8Array(n * n);
    const col = new Int8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        row[i] = y;
        col[i] = x;
        if (keep && !keep(x, y)) continue;
        mask[i] = 1;
        px[i] = x;
        py[i] = y;
      }
    }
    const f = new Field(n, n, mask, px, py);
    f.row = row;
    f.col = col;
    return f;
  }

  const TRI_DOTS = [
    [1, 3],
    [2, 2],
    [2, 4],
    [3, 1],
    [3, 3],
    [3, 5],
    [4, 0],
    [4, 2],
    [4, 4],
    [4, 6],
  ];

  function triangleField() {
    const n = 7;
    const mask = new Uint8Array(n * n);
    const px = new Float32Array(n * n);
    const py = new Float32Array(n * n);
    const row = new Int8Array(n * n);
    const col = new Int8Array(n * n);
    for (const [y, x] of TRI_DOTS) {
      const i = y * n + x;
      mask[i] = 1;
      px[i] = x;
      py[i] = y - 1;
      row[i] = y;
      col[i] = x;
    }
    const f = new Field(n, n, mask, px, py);
    f.row = row;
    f.col = col;
    return f;
  }

  const HEX_COUNT = [3, 4, 5, 4, 3];

  function honeyField() {
    const w = 5;
    const h = 5;
    const mask = new Uint8Array(w * h);
    const px = new Float32Array(w * h);
    const py = new Float32Array(w * h);
    const row = new Int8Array(w * h);
    const col = new Int8Array(w * h);
    const pitch = Math.sqrt(3) / 2;
    let minX = Infinity;
    let minY = Infinity;
    const placed = [];
    for (let r = 0; r < 5; r++) {
      const count = HEX_COUNT[r];
      for (let c = 0; c < count; c++) {
        const i = r * w + c;
        const x = c - (count - 1) / 2;
        const y = (r - 2) * pitch;
        placed.push(i);
        px[i] = x;
        py[i] = y;
        row[i] = r;
        col[i] = c;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
      }
    }
    for (const i of placed) {
      mask[i] = 1;
      px[i] -= minX;
      py[i] -= minY;
    }
    const f = new Field(w, h, mask, px, py);
    f.row = row;
    f.col = col;
    return f;
  }

  function hexPos(row, col) {
    const count = HEX_COUNT[row];
    const x = col - (count - 1) / 2;
    const y = (row - 2) * (Math.sqrt(3) / 2);
    return { x, y, r: Math.hypot(x, y), a: Math.atan2(y, x) };
  }

  function spiralOrder(n) {
    const order = new Array(n * n);
    let top = 0;
    let bottom = n - 1;
    let left = 0;
    let right = n - 1;
    let t = 0;
    while (top <= bottom && left <= right) {
      for (let c = left; c <= right; c++) order[top * n + c] = t++;
      for (let r = top + 1; r <= bottom; r++) order[r * n + right] = t++;
      if (top < bottom) for (let c = right - 1; c >= left; c--) order[bottom * n + c] = t++;
      if (left < right) for (let r = bottom - 1; r > top; r--) order[r * n + left] = t++;
      top++;
      bottom--;
      left++;
      right--;
    }
    return order;
  }

  function snakeOrder(n) {
    const order = new Array(n * n);
    let t = 0;
    for (let r = 0; r < n; r++) {
      if (r % 2 === 0) for (let c = 0; c < n; c++) order[r * n + c] = t++;
      else for (let c = n - 1; c >= 0; c--) order[r * n + c] = t++;
    }
    return order;
  }

  function diagonalOrder() {
    const order = new Array(25);
    let t = 0;
    for (let d = 0; d <= 8; d++) {
      const rs = Math.max(0, d - 4);
      const re = Math.min(4, d);
      if (d % 2 === 0) for (let r = re; r >= rs; r--) order[r * 5 + (d - r)] = t++;
      else for (let r = rs; r <= re; r++) order[r * 5 + (d - r)] = t++;
    }
    return order;
  }

  const SPIRAL5 = spiralOrder(5);
  const SPIRAL3 = spiralOrder(3);
  const SNAKE5 = snakeOrder(5);
  const SNAKE3 = snakeOrder(3);
  const DIAG5 = diagonalOrder();

  const OUTER5 = [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 4], [2, 4], [3, 4], [4, 4], [4, 3],
    [4, 2], [4, 1], [4, 0], [3, 0], [2, 0], [1, 0],
  ];
  const MIDDLE5 = [
    [1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2],
  ];
  const DISC_RING = [
    [0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [3, 4],
    [4, 3], [4, 2], [4, 1], [3, 0], [2, 0], [1, 0],
  ];
  const OUTER3 = [
    [0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0],
  ];
  const LADDER = [
    [4, 0], [3, 0], [2, 0], [1, 0], [0, 0],
    [0, 1], [0, 2],
    [1, 2], [2, 2], [3, 2], [4, 2],
    [4, 1],
    [3, 1], [2, 1], [1, 1], [0, 1],
    [0, 2], [0, 3],
    [1, 3], [2, 3], [3, 3], [4, 3],
    [4, 2],
    [3, 2], [2, 2], [1, 2], [0, 2],
    [0, 3], [0, 4],
    [1, 4], [2, 4], [3, 4], [4, 4],
  ];
  const TRI_RIM = [
    [1, 3], [2, 2], [3, 1], [4, 0], [4, 2], [4, 4], [4, 6], [3, 5], [2, 4],
  ];
  const TRI_RAKE = [
    [4, 0], [3, 1], [4, 2], [2, 2], [3, 3], [1, 3], [4, 4], [2, 4], [3, 5], [4, 6],
  ];
  const TRI_ZIP = [
    [4, 0], [4, 2], [4, 4], [4, 6], [3, 5], [3, 3], [3, 1], [2, 2], [2, 4], [1, 3],
  ];
  const TRI_LOOP = [
    [4, 0], [3, 1], [2, 2], [1, 3], [2, 4], [3, 5], [4, 6], [4, 4], [3, 3], [4, 2],
  ];
  const HEX_RIM = [
    [0, 0], [0, 1], [0, 2], [1, 3], [2, 4], [3, 3], [4, 2], [4, 1], [4, 0], [3, 0], [2, 0], [1, 0],
  ];
  const HEX_VERTS = [
    [0, 0], [0, 2], [2, 4], [4, 2], [4, 0], [2, 0],
  ];

  function pathIndex(path, row, col) {
    for (let i = 0; i < path.length; i++) if (path[i][0] === row && path[i][1] === col) return i;
    return -1;
  }

  function pathGlow(path, row, col, head, span) {
    const i = pathIndex(path, row, col);
    if (i < 0) return 0;
    const d = wrapNum(head - i, path.length);
    return d >= span ? 0 : 1 - d / span;
  }

  function visitGlow(path, row, col, head, span) {
    let best = 0;
    for (let step = 0; step < path.length; step++) {
      if (path[step][0] !== row || path[step][1] !== col) continue;
      const d = wrapNum(head - step, path.length);
      if (d < span) best = Math.max(best, 1 - d / span);
    }
    return best;
  }

  function orderGlow(order, n, index, head, span) {
    const d = wrapNum(head - order[index], n);
    return d >= span ? 0 : 1 - d / span;
  }

  function keyOn(keys, row, col) {
    for (let i = 0; i < keys.length; i++) if (keys[i][0] === row && keys[i][1] === col) return true;
    return false;
  }

  const SQ = { cols: 5, rows: 5, grid: "5×5", group: "Square · 25 dots", field: () => gridField(5) };
  const DISC = {
    cols: 5,
    rows: 5,
    grid: "21·circle",
    group: "Circle · 21 dots",
    field: () => gridField(5, (x, y) => !((y === 0 || y === 4) && (x === 0 || x === 4))),
  };
  const G3 = { cols: 3, rows: 3, grid: "3×3", group: "Grid · 9 dots", field: () => gridField(3) };
  const TRIS = { cols: 7, rows: 4, grid: "10·triangle", group: "Triangle · 10 dots", field: triangleField };
  const HONEY = { cols: 5, rows: 5, grid: "19·hex", group: "Hexagon · 19 dots", field: honeyField };
  const DIA = {
    cols: 5,
    rows: 5,
    grid: "13·diamond",
    group: "Diamond · 13 dots",
    field: () => gridField(5, (x, y) => Math.abs(x - 2) + Math.abs(y - 2) <= 2),
  };

  function motif(name, title, note, shape, seconds, draw) {
    register(name, {
      title,
      note,
      cols: shape.cols,
      rows: shape.rows,
      grid: shape.grid,
      group: shape.group,
      field: shape.field,
      still: Math.min(1.8, seconds * 0.42),
      update(_s, f, c) {
        const p = wrapNum(c.t / seconds, 1);
        paintCells(f, (row, col) => draw(row, col, p));
      },
    });
  }

  motif("drift", "Neon Drift", "A checkerboard wave sweeps from the top-right corner toward the bottom-left.", SQ, 1.5, (row, col, p) => {
    const k = row + (4 - col);
    const local = wrapNum(p - k / 10 - (k % 2) * 0.5, 1);
    return local < 0.18 ? 1 - local / 0.18 : 0;
  });

  motif("ladder", "Pulse Ladder", "A tail climbs column 1, drops down column 3, climbs column 2, and repeats one column to the right.", SQ, 1.7, (row, col, p) => {
    return visitGlow(LADDER, row, col, p * LADDER.length, 8);
  });

  motif("spiral", "Core Spiral", "A four-dot tail spirals clockwise from the outer border into the center.", SQ, 1.5, (row, col, p) => {
    return orderGlow(SPIRAL5, 25, row * 5 + col, p * 25, 4);
  });

  motif("twin", "Twin Orbit", "The outer ring runs clockwise, the middle ring runs the other way, and the center stays dark.", SQ, 1.6, (row, col, p) => {
    if (row === 2 && col === 2) return 0;
    const outer = pathGlow(OUTER5, row, col, p * 16, 3.2);
    const inner = pathGlow(MIDDLE5, row, col, (1 - p) * 8, 2.4);
    return Math.max(outer, inner * 0.9);
  });

  motif("prism", "Prism Sweep", "A short trail walks the grid along alternating diagonals.", SQ, 1.6, (row, col, p) => {
    return orderGlow(DIAG5, 25, row * 5 + col, p * 25, 4);
  });

  motif("columns", "Flux Columns", "Columns 1, 3 and 5 travel upward while columns 2 and 4 travel downward.", SQ, 1.3, (row, col, p) => {
    const up = col % 2 === 0;
    const head = up ? wrapNum(4 - p * 5, 5) : wrapNum(p * 5, 5);
    const d = up ? wrapNum(row - head, 5) : wrapNum(head - row, 5);
    return d < 3 ? 1 - d / 3 : 0;
  });

  motif("blocks", "Block Drop", "Full rows stack from the bottom, the grid flashes, then it clears.", SQ, 1.9, (row, col, p) => {
    if (p < 0.58) {
      const filled = Math.floor((p / 0.58) * 6);
      if (filled <= 0 || row < 5 - filled) return 0;
      return row === 5 - filled ? 1 : 0.42;
    }
    if (p < 0.7 || (p >= 0.82 && p < 0.92)) return 0.92;
    return 0;
  });

  motif("stack", "Strobe Stack", "Columns stack upward with a stagger, the grid blinks twice, then the columns drain.", SQ, 2, (row, col, p) => {
    let height;
    if (p < 0.42) height = clamp(Math.floor((p / 0.42) * 10) - col, 0, 5);
    else if (p < 0.62) height = 5;
    else height = clamp(5 - Math.max(0, Math.floor(((p - 0.62) / 0.38) * 10) - col), 0, 5);
    const top = 5 - height;
    if (!(height > 0 && row >= top)) return 0;
    if (p >= 0.42 && p < 0.62) return Math.floor(p * 18) % 2 ? 1 : 0.28;
    return row === top && height < 5 ? 1 : 0.5;
  });

  const GLYPH_BITS = {
    "1,0": 1, "2,0": 2, "3,0": 4, "1,1": 8, "2,1": 16, "3,1": 32,
    "1,3": 1, "2,3": 2, "3,3": 4, "1,4": 8, "2,4": 16, "3,4": 32,
  };
  const GLYPH_FRAMES = [7, 63, 9, 18, 36, 63, 21, 47, 7, 56];

  motif("glyphs", "Glyph Pulse", "Two synced 2×3 cells step through rails, rows, a checker, a horseshoe and alternating columns.", SQ, 3.2, (row, col, p) => {
    const bit = GLYPH_BITS[row + "," + col];
    if (!bit) return 0;
    const mask = GLYPH_FRAMES[Math.floor(p * GLYPH_FRAMES.length) % GLYPH_FRAMES.length];
    return mask & bit ? 1 : 0;
  });

  motif("scan", "CRT Glide", "A scanline moves down the grid and leaves a fading phosphor trail.", SQ, 1.5, (row, col, p) => {
    const scan = p * 5;
    if (row > scan) return 0;
    const trail = Math.exp(-(scan - row) * 0.85);
    return Math.min(1, trail * (1 + 0.08 * Math.sin(col * 1.7 + scan)));
  });

  motif("echo", "Echo Ring", "Diamond rings ripple out from the center, each followed by a softer echo.", SQ, 1.6, (row, col, p) => {
    const ring = Math.abs(row - 2) + Math.abs(col - 2);
    const head = p * 5.2;
    return Math.max(falloff(ring, head, 0.85), falloff(ring, head - 1.6, 1) * 0.55);
  });

  motif("origin", "Origin Wave", "Rings expand from the cell one step down and right of the top-left corner.", SQ, 1.6, (row, col, p) => {
    const ring = Math.abs(row - 1) + Math.abs(col - 1);
    return falloff(ring, p * 7, 0.9);
  });

  const ROTOR = [
    [[1, 2], [0, 2]],
    [[1, 3], [0, 4]],
    [[2, 3], [2, 4]],
    [[3, 3], [4, 4]],
    [[3, 2], [4, 2]],
    [[3, 1], [4, 0]],
    [[2, 1], [2, 0]],
    [[1, 1], [0, 0]],
  ];

  motif("rotor", "Core Rotor", "One two-dot blade steps around a steady center hub.", SQ, 1.55, (row, col, p) => {
    if (row === 2 && col === 2) return 0.55;
    const i = Math.floor(p * 8) % 8;
    const blade = ROTOR[i];
    const prev = ROTOR[(i + 7) % 8];
    if (keyOn(blade, row, col)) return 1;
    if (keyOn(prev, row, col)) return 0.35;
    return 0;
  });

  const BLOOM = [
    "x...x.x.x...o...x.x.x...x",
    "..x...xox.xoxox.xox...x..",
    ".x.x.x.o.x..o..x.o.x.x.x.",
    "x.x.x.o.o.x.o.x.o.o.x.x.x",
  ];

  motif("bloom", "Prism Bloom", "Symmetric motifs — an X, a diamond, a ring and a cross — take turns.", SQ, 1.7, (row, col, p) => {
    const frame = BLOOM[Math.floor(pingpong(p) * 3.999) % 4];
    const ch = frame[row * 5 + col];
    return ch === "x" ? 1 : ch === "o" ? 0.48 : 0;
  });

  function helixCols(row, p, spread) {
    const left = Math.round(spread + spread * Math.sin(p * TAU * 2 + row * 1.25));
    return [left, 4 - left];
  }

  motif("helix", "Helix Glow", "Two mirrored strands weave down the grid and flash a bridge between them.", SQ, 1.6, (row, col, p) => {
    const [left, right] = helixCols(row, p, 1);
    if (col === left || col === right) return 1;
    if (Math.cos(p * TAU * 4 + row * 2.5) > 0.82 && col > left && col < right) return 0.55;
    if (Math.abs(col - left) === 1 || Math.abs(col - right) === 1) return 0.22;
    return 0;
  });

  motif("helixcore", "Helix Core", "A narrower helix stays in the middle columns, still with strand and rung beats.", SQ, 1.4, (row, col, p) => {
    const left = Math.round(1.5 + 0.5 * Math.sin(p * TAU * 2 + row * 1.25));
    const right = 4 - left;
    if (col === left || col === right) return 1;
    if (Math.cos(p * TAU * 4 + row * 2.5) > 0.82 && col > left && col < right) return 0.55;
    if (Math.abs(col - left) === 1 || Math.abs(col - right) === 1) return 0.22;
    return 0;
  });

  motif("halfhelix", "Half Helix", "A single strand snakes from side to side.", SQ, 1.6, (row, col, p) => {
    const strand = Math.round(2 + 2 * Math.sin(p * TAU * 2 + row * 1.25));
    if (col === strand) return 1;
    if (Math.abs(col - strand) === 1) return 0.28;
    return 0;
  });

  motif("bars", "Sound Bars", "Five columns rise and fall like an equalizer.", SQ, 1.75, (row, col, p) => {
    const level = clamp(Math.round(1 + ((Math.sin(p * TAU * 3.2 + col * 1.15) + 1) / 2) * 4), 1, 5);
    const top = 5 - level;
    if (row > top) return 0.85;
    if (row === top) return 1;
    return 0;
  });

  motif("infinity", "Infinity Run", "Two heads chase each other around a figure-eight and brighten where they cross.", SQ, 1.7, (row, col, p) => {
    const x = (col - 2) / 2;
    const y = (2 - row) / 2;
    const glowAt = (t) => {
      const hx = Math.sin(t);
      const hy = 0.58 * Math.sin(2 * t);
      return Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / 0.16);
    };
    const lead = Math.max(glowAt(p * TAU), glowAt(p * TAU + Math.PI));
    const trail = Math.max(glowAt(p * TAU - 0.55), glowAt(p * TAU + Math.PI - 0.55));
    return Math.min(1, lead * 0.85 + trail * 0.4);
  });

  motif("mobius", "Mobius Run", "Two trains run the outer ring half a lap apart, flashing the inner corner they pass.", SQ, 1.6, (row, col, p) => {
    const head = p * 16;
    const main = pathGlow(OUTER5, row, col, head, 5);
    const back = pathGlow(OUTER5, row, col, head + 8, 3.2) * 0.45;
    const corner = Math.floor(head) % 16;
    const twist = [
      [0, 1, 1],
      [4, 1, 3],
      [8, 3, 3],
      [12, 3, 1],
    ];
    let flash = 0;
    for (const [at, r, c] of twist) if (corner === at && row === r && col === c) flash = 0.7;
    if (row === 2 && col === 2 && corner % 4 === 0) flash = Math.max(flash, 0.45);
    return Math.min(1, Math.max(main, back, flash));
  });

  motif("serpent", "Serpent Wave", "A pulse follows the serpentine path through all 25 cells.", SQ, 1.6, (row, col, p) => {
    return orderGlow(SNAKE5, 25, row * 5 + col, p * 25, 3.5);
  });

  motif("colwave", "Column Wave", "A bright band steps from the left column to the right.", SQ, 1.4, (row, col, p) => {
    return falloff(col, (p * 5) % 5, 0.75);
  });

  motif("ringwave", "Ring Wave", "Square rings light up from the center outward.", SQ, 1.4, (row, col, p) => {
    const ring = Math.max(Math.abs(row - 2), Math.abs(col - 2));
    return falloff(ring, (p * 3) % 3, 0.7);
  });

  motif("diamond", "Diamond Ripple", "Thirteen dots in a diamond: rings ripple out from the center.", DIA, 1.5, (row, col, p) => {
    const ring = Math.abs(row - 2) + Math.abs(col - 2);
    return falloff(ring, (p * 3.2) % 3.2, 0.7);
  });

  motif("halodrift", "Halo Drift", "A bright diagonal strand travels from the top-left toward the bottom-right.", DISC, 1.7, (row, col, p) => {
    const strand = Math.round(2 * Math.sin(p * TAU * 2 + (row + col) * 0.85));
    const d = Math.abs(col - row - strand);
    return d === 0 ? 1 : d === 1 ? 0.3 : 0;
  });

  motif("triorbit", "Tri Orbit", "Three heads chase around the 12-dot rim, evenly spaced.", DISC, 1.6, (row, col, p) => {
    const i = pathIndex(DISC_RING, row, col);
    if (i < 0) return row === 2 && col === 2 ? 0.2 : 0;
    const head = p * 12;
    let best = 0;
    for (let k = 0; k < 3; k++) {
      const d = wrapNum(head + k * 4 - i, 12);
      if (d < 2.5) best = Math.max(best, 1 - d / 2.5);
    }
    return best;
  });

  motif("veil", "Plasma Veil", "A diagonal band sweeps across the circle while the core pulses.", DISC, 1.65, (row, col, p) => {
    const sweep = Math.sin(p * TAU) * 4 + 4;
    const band = falloff(row + col, sweep, 1.15);
    const core = (row === 2 && col === 2 ? 0.7 : 0) + falloff(Math.hypot(col - 2, row - 2), 0, 1.2) * (0.35 + 0.25 * Math.sin(p * TAU * 2));
    return Math.min(1, Math.max(band, core));
  });

  motif("radar", "Radar Arc", "A beam turns around the circle with a short wake and a faint outer ring.", DISC, 1.8, (row, col, p) => {
    const x = col - 2;
    const y = row - 2;
    const radius = Math.hypot(x, y);
    if (radius < 0.5) return 0.65;
    const theta = p * TAU;
    const ahead = x * Math.cos(theta) + y * Math.sin(theta);
    const side = Math.abs(x * Math.sin(theta) - y * Math.cos(theta));
    if (ahead > 0.3 && side < 0.55) return 1;
    if (ahead > 0 && side < 1.15) return 0.35;
    if (radius > 1.6) return 0.16;
    return 0;
  });

  motif("pinwheel", "Nova Wheel", "Four blades spin around a glowing center.", DISC, 1.65, (row, col, p) => {
    const x = col - 2;
    const y = row - 2;
    const radius = Math.hypot(x, y);
    if (radius < 0.6) return 0.7;
    const pin = Math.cos(Math.atan2(y, x) * 4 - p * TAU * 2);
    return pin > 0.45 ? 1 : pin > 0.05 ? 0.32 : 0;
  });

  motif("phaseorb", "Phase Orb", "One soft orb drifts around an off-center loop.", DISC, 1.7, (row, col, p) => {
    const ox = Math.cos(p * TAU) * 1.25;
    const oy = Math.sin(p * TAU * 0.95) * 1.05;
    const d = Math.hypot(col - 2 - ox, row - 2 - oy);
    const core = row === 2 && col === 2 ? 0.3 : 0;
    return Math.max(core, Math.max(0, 1 - d / 1.35));
  });

  motif("gate", "Gate Shift", "The sweep flips between a vertical bar and a horizontal bar.", DISC, 1.6, (row, col, p) => {
    const vertical = p % 0.5 < 0.25;
    const slide = 2 + Math.sin(p * TAU * 4) * 1.4;
    return vertical ? falloff(col, slide, 0.7) : falloff(row, slide, 0.7);
  });

  motif("throb", "Heart Pulse", "A double beat sends rings out from the center.", DISC, 1.4, (row, col, p) => {
    const beat = Math.max(0, Math.sin(p * TAU)) + Math.max(0, Math.sin(p * TAU * 2)) * 0.55;
    const radius = Math.hypot(col - 2, row - 2);
    if (radius < 0.55) return Math.min(1, 0.3 + beat);
    if (radius < 1.65) return beat * 0.55;
    return beat * 0.18;
  });

  motif("compass", "Star Compass", "North, east, south and west light up in turn, with a dim opposite echo.", DISC, 1.9, (row, col, p) => {
    const x = col - 2;
    const y = row - 2;
    if (x === 0 && y === 0) return 0.3;
    const angle = Math.atan2(y, x);
    const dir = (Math.floor(p * 4) % 4) * (Math.PI / 2);
    const main = Math.max(0, 1 - angBetween(angle, dir) / 0.55);
    const echo = Math.max(0, 1 - angBetween(angle, dir + Math.PI) / 0.7);
    const tier = Math.round(Math.hypot(x, y));
    if (main > 0.75 && tier >= 1) return 1;
    if (main > 0.35) return 0.55;
    if (echo > 0.45 && tier >= 1) return 0.28;
    return 0;
  });

  motif("codebloom", "Binary Bloom", "Cells peak in a modular code so only a few are bright at once.", DISC, 1.6, (row, col, p) => {
    const tick = Math.floor(p * 10);
    const code = (row * 3 + col * 5 + Math.round(Math.hypot(col - 2, row - 2)) * 2) % 10;
    const raw = Math.abs(code - (tick % 10));
    const d = Math.min(raw, 10 - raw);
    if (row === 2 && col === 2) return Math.max(d === 0 ? 1 : d === 1 ? 0.5 : 0.15, 0.4);
    if (d === 0) return 1;
    if (d === 1) return 0.48;
    if ((row + col + tick) % 2 === 0) return 0.16;
    return 0;
  });

  motif("crescent", "Lunar Breathe", "A crescent moon rotates inside the circle.", DISC, 1.85, (row, col, p) => {
    const x = col - 2;
    const y = row - 2;
    const mx = Math.cos(p * TAU) * 0.7;
    const my = Math.sin(p * TAU) * 0.7;
    const body = Math.hypot(x - mx, y - my);
    const bite = Math.hypot(x - (mx + Math.cos(p * TAU) * 0.85), y - (my + Math.sin(p * TAU) * 0.85));
    if (body < 1.55 && bite > 1.05) return 1;
    if (Math.abs(body - 1.55) < 0.4) return 0.35;
    return 0;
  });

  motif("beacon", "Arc Beacon", "An eight-direction beam steps around the circle, with a dim opposite echo.", DISC, 1.7, (row, col, p) => {
    const x = col - 2;
    const y = row - 2;
    if (x === 0 && y === 0) return 0.28;
    const target = (Math.floor(p * 8) % 8) * (Math.PI / 4);
    const angle = Math.atan2(y, x);
    const beam = Math.max(0, 1 - angBetween(angle, target) / 0.42);
    const echo = Math.max(0, 1 - angBetween(angle, target + Math.PI) / 0.65);
    if (beam > 0.7) return 1;
    if (beam > 0.35) return 0.5;
    if (echo > 0.5) return 0.28;
    return 0;
  });

  motif("twinhelix", "Twin Helix", "Two side strands weave in and out, with bridges across the middle.", DISC, 1.75, (row, col, p) => {
    const x = col - 2;
    const y = row - 2;
    const offset = Math.sin(y * 1.35 + p * TAU * 1.3) * 1.15;
    const strand = Math.min(Math.abs(x + offset), Math.abs(x - offset));
    if (strand < 0.4) return 1;
    if (strand < 0.85) return 0.4;
    const between = x > Math.min(-offset, offset) && x < Math.max(-offset, offset);
    if (between && Math.cos(y * 2 + p * TAU * 2) > 0.55) return 0.35;
    return 0;
  });

  motif("rung", "Rung Shift", "A bright rung steps down the rows while the side posts sway.", DISC, 1.65, (row, col, p) => {
    const active = Math.floor(p * 5) % 5;
    const left = Math.round(1 + Math.sin(p * TAU + (row - 2) * 0.9));
    const right = 4 - left;
    if (row === active && col >= left && col <= right) return 1;
    if ((col === left || col === right) && Math.abs(row - active) <= 1) return 0.5;
    if ((col === left || col === right) && Math.abs(row - active) === 2) return 0.22;
    return 0;
  });

  const CLUSTER = [
    [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]],
    [[1, 1], [2, 1], [3, 1], [2, 2], [1, 3], [2, 3], [3, 3]],
    [[1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3]],
    [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
    [[2, 1], [1, 2], [3, 2], [2, 3]],
    [[1, 1], [2, 1], [2, 2], [2, 3], [3, 3]],
  ];

  motif("cluster", "Glyph Cluster", "Small grouped motifs — rails, a bridge, a box, an X and a cross — take turns.", DISC, 1.7, (row, col, p) => {
    const i = Math.floor(p * CLUSTER.length) % CLUSTER.length;
    if (keyOn(CLUSTER[i], row, col)) return 1;
    if (keyOn(CLUSTER[(i + CLUSTER.length - 1) % CLUSTER.length], row, col)) return 0.32;
    return Math.hypot(col - 2, row - 2) < 1.1 ? 0.12 : 0;
  });

  motif("railscan", "Rail Scan", "A scanline steps down the left rail, then the right, with a mark in the center column.", DISC, 1.7, (row, col, p) => {
    const t = Math.floor(p * 10) % 10;
    const active = t % 5;
    const rail = t < 5 ? 1 : 3;
    if (col === rail && row === active) return 1;
    if (col === rail && Math.abs(row - active) === 1) return 0.32;
    if (col === 2 && row === active) return 0.5;
    return 0;
  });

  motif("checker", "Checker Shift", "Checker phases step, keeping the two rail columns stronger than the rest.", DISC, 1.5, (row, col, p) => {
    const t = Math.floor(p * 4) % 4;
    const on = (row + col + t) % 2 === 0;
    const rail = col === 1 || col === 3;
    const cross = row === 2 || col === 2;
    if (on && rail) return 1;
    if (on || cross) return 0.34;
    if (rail) return 0.18;
    return 0;
  });

  motif("pair", "Pulse Pair", "Mirrored pairs step from the top and bottom rows in toward the middle.", DISC, 1.55, (row, col, p) => {
    const bandRow = Math.floor(p * 3) % 3;
    const onRow = row === bandRow || row === 4 - bandRow;
    const pair = col === 1 || col === 3;
    if (onRow && pair) return 1;
    if (onRow && col === 2) return 0.55;
    if (row === 2 || col === 2) return 0.22;
    return 0;
  });

  const INNER8 = [
    [1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [2, 1],
  ];

  motif("cellorbit", "Orbit Cell", "A head and a one-dot tail orbit the inner eight cells while the rails stay dim.", DISC, 1.3, (row, col, p) => {
    const head = Math.floor(p * 8) % 8;
    const h = INNER8[head];
    const t = INNER8[(head + 7) % 8];
    if (row === h[0] && col === h[1]) return 1;
    if (row === t[0] && col === t[1]) return 0.5;
    if ((col === 1 || col === 3) && row >= 1 && row <= 3) return 0.22;
    if (row === 2 && col === 2) return 0.14;
    return 0;
  });

  const GLYPH_CYCLE = [
    [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]],
    [[1, 1], [2, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
    [[1, 1], [1, 2], [1, 3], [3, 1], [3, 2], [3, 3]],
    [[1, 1], [2, 1], [3, 1], [1, 3], [2, 2], [3, 3]],
    [[1, 1], [2, 2], [3, 3], [1, 3], [3, 1]],
    [[2, 1], [1, 2], [2, 2], [3, 2], [2, 3]],
  ];

  motif("glyphcycle", "Glyph Cycle", "Six braille-like glyphs swap, leaving a ghost of the previous one.", DISC, 1.8, (row, col, p) => {
    const i = Math.floor(p * GLYPH_CYCLE.length) % GLYPH_CYCLE.length;
    if (keyOn(GLYPH_CYCLE[i], row, col)) return 1;
    if (keyOn(GLYPH_CYCLE[(i + GLYPH_CYCLE.length - 1) % GLYPH_CYCLE.length], row, col)) return 0.32;
    if (row === 2 && col === 2) return 0.16;
    return 0;
  });

  function sweep3(norm, p) {
    return falloff(norm, (p * 1.35) % 1.35, 0.28);
  }

  motif("minispiral", "Square Spiral", "A four-dot tail spirals clockwise into the center of a 3×3 grid.", G3, 1.2, (row, col, p) => {
    return orderGlow(SPIRAL3, 9, row * 3 + col, p * 9, 4);
  });

  motif("drifttr", "Drift TR", "Diagonal bands travel from the top-right toward the bottom-left.", G3, 1.15, (row, col, p) => sweep3((row + (2 - col)) / 4, p));
  motif("drifttl", "Drift TL", "Diagonal bands travel from the top-left toward the bottom-right.", G3, 1.15, (row, col, p) => sweep3((row + col) / 4, p));
  motif("driftbr", "Drift BR", "Diagonal bands travel from the bottom-right toward the top-left.", G3, 1.15, (row, col, p) => sweep3((4 - row - col) / 4, p));
  motif("driftbl", "Drift BL", "Diagonal bands travel from the bottom-left toward the top-right.", G3, 1.15, (row, col, p) => sweep3((4 - row - (2 - col)) / 4, p));

  motif("coreecho", "Core Echo", "Manhattan rings step outward from the center cell.", G3, 1.1, (row, col, p) => {
    const ring = Math.abs(row - 1) + Math.abs(col - 1);
    return falloff(ring, (p * 3) % 3, 0.55);
  });

  motif("colflux", "Column Flux", "The three columns light from left to right.", G3, 1.1, (row, col, p) => falloff(col, (p * 3) % 3, 0.55));
  motif("rowsweep", "Row Sweep", "The three rows light from top to bottom.", G3, 1.1, (row, col, p) => falloff(row, (p * 3) % 3, 0.55));

  motif("miniserpent", "Serpent", "A narrow pulse visits all nine cells in serpentine order.", G3, 1.2, (row, col, p) => {
    return orderGlow(SNAKE3, 9, row * 3 + col, p * 9, 2.2);
  });

  motif("frame", "Frame Chase", "A highlight runs clockwise around the frame while the center pulses.", G3, 1.2, (row, col, p) => {
    if (row === 1 && col === 1) return 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(p * TAU * 2));
    return pathGlow(OUTER3, row, col, p * 8, 1.6);
  });

  const MINI_GLYPHS = [
    [[0, 0], [0, 2], [2, 0], [2, 2]],
    [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
    [[1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]],
    [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    [[0, 1], [1, 0], [1, 2], [2, 1]],
  ];

  motif("pixglyph", "Glyph Pulse", "Corners, a cross, the full grid, the center, the ring, an X and the side rails flash in order.", G3, 2.6, (row, col, p) => {
    const n = MINI_GLYPHS.length;
    const scaled = p * n;
    const i = Math.floor(scaled) % n;
    const seg = scaled - Math.floor(scaled);
    const cur = keyOn(MINI_GLYPHS[i], row, col) ? 1 : 0;
    const next = keyOn(MINI_GLYPHS[(i + 1) % n], row, col) ? 1 : 0;
    const morph = seg < 0.55 ? 0 : smoothstep(0.55, 0.9, seg);
    return cur * (1 - morph) + next * morph;
  });

  motif("droplet", "Drop Ripple", "Round ripples expand from the center like a drop in water.", G3, 1.2, (row, col, p) => {
    const d = Math.hypot(col - 1, row - 1);
    return falloff(d, (p * 2.4) % 2.4, 0.45);
  });

  motif("surge", "Right Surge", "A vertical band sweeps from the right column toward the left.", G3, 1.15, (row, col, p) => falloff(2 - col, (p * 3) % 3, 0.55));

  motif("comet", "Comet Trail", "A comet with a two-dot tail races around the frame. The center breathes.", G3, 1.15, (row, col, p) => {
    if (row === 1 && col === 1) return 0.2 + (Math.floor(p * 8) % 2) * 0.15;
    return pathGlow(OUTER3, row, col, p * 8, 3);
  });

  motif("miniecho", "Echo Rings", "Square rings leave the center, with a softer second pulse behind the first.", G3, 1.3, (row, col, p) => {
    const ring = Math.abs(row - 1) + Math.abs(col - 1);
    const head = (p * 3.2) % 3.2;
    return Math.max(falloff(ring, head, 0.5), falloff(ring, head - 1.1, 0.65) * 0.5);
  });

  function rotate3(pattern, turns) {
    let out = pattern.slice();
    const n = ((turns % 4) + 4) % 4;
    for (let k = 0; k < n; k++) {
      const next = new Array(9).fill(0);
      for (let i = 0; i < 9; i++) {
        const r = Math.floor(i / 3);
        const c = i % 3;
        next[c * 3 + (2 - r)] = out[i];
      }
      out = next;
    }
    return out;
  }

  function spinGlyph(name, title, note, glyph) {
    motif(name, title, note, G3, 1.6, (row, col, p) => {
      const scaled = p * 4;
      const turns = Math.floor(scaled);
      const blend = smoothstep(0, 1, scaled - turns);
      const cur = rotate3(glyph, turns);
      const next = rotate3(glyph, turns + 1);
      const i = row * 3 + col;
      return cur[i] * (1 - blend) + next[i] * blend;
    });
  }

  spinGlyph("smiley", "Smiley Spin", "A pixel smiley turns in place.", [1, 0, 1, 0, 0, 0, 0, 1, 0]);
  spinGlyph("checkspin", "Check Spin", "A pixel checkmark turns in place.", [0, 0, 1, 0, 1, 0, 1, 0, 0]);
  spinGlyph("arrowspin", "Arrow Spin", "A pixel arrow turns in place.", [0, 1, 0, 0, 1, 1, 0, 1, 0]);
  spinGlyph("cornerspin", "Corner Spin", "An L-shaped corner turns in place.", [1, 1, 0, 1, 0, 0, 1, 0, 0]);
  spinGlyph("playspin", "Play Spin", "A pixel play triangle turns in place.", [1, 0, 0, 1, 1, 0, 1, 0, 0]);

  const SPOKES = [
    [[3, 3], [1, 3]],
    [[3, 3], [3, 1], [4, 0]],
    [[3, 3], [3, 5], [4, 6]],
  ];

  motif("spokes", "Core Spokes", "Three spokes leave the center, one toward each corner of the triangle.", TRIS, 1.65, (row, col, p) => {
    const which = Math.floor(p * 3) % 3;
    const along = (p * 3) % 1;
    const path = SPOKES[which];
    const i = pathIndex(path, row, col);
    if (i < 0) return 0;
    const head = along * (path.length - 1);
    const d = Math.abs(i - head);
    return d < 1.2 ? 1 - d / 1.2 : 0;
  });

  motif("altitude", "Altitude Wave", "A soft wave travels between the apex and the base. The middle column stays a little brighter.", TRIS, 1.55, (row, col, p) => {
    const pulse = 0.5 - 0.5 * Math.cos((p + (4 - row) * 0.16) * TAU);
    const weight = 0.45 + (4 - row) * 0.14 + (col === 3 ? 0.22 : 0);
    return Math.min(1, pulse * weight + pulse * pulse * 0.35);
  });

  motif("cornerbounce", "Corner Bounce", "One head runs the outline to the far corner, then comes back the same way.", TRIS, 1.7, (row, col, p) => {
    const span = TRI_RIM.length - 1;
    const head = pingpong(p) * span;
    const i = pathIndex(TRI_RIM, row, col);
    if (i < 0) return 0;
    const d = Math.abs(i - head);
    return d < 2.2 ? 1 - d / 2.2 : 0;
  });

  motif("chase", "Vertex Chase", "Three heads chase around the outline, each with a short tail.", TRIS, 1.45, (row, col, p) => {
    const head = p * TRI_RIM.length;
    let best = 0;
    for (let k = 0; k < 3; k++) best = Math.max(best, pathGlow(TRI_RIM, row, col, head + k * 3, 2.4));
    return best;
  });

  motif("trisweep", "Row Sweep", "A scanline travels from the apex to the base and back.", TRIS, 1.7, (row, col, p) => {
    const scan = 1 + pingpong(p) * 3;
    let v = falloff(row, scan, 1.15);
    if (row === 3 && col === 3) v = Math.max(v, 0.35);
    return v;
  });

  motif("braille", "Braille Beat", "The left edge fills downward, then the right edge, then every dot blinks and clears.", TRIS, 3, (row, col, p) => {
    const left = [[2, 2], [3, 1], [4, 0]];
    const right = [[2, 4], [3, 5], [4, 6]];
    const onLeft = keyOn(left, row, col);
    if (p < 0.34) {
      const n = Math.floor((p / 0.34) * 4);
      const i = pathIndex(left, row, col);
      if (i >= 0 && i < n) return 1;
      return 0;
    }
    if (p < 0.68) {
      if (onLeft) return 1;
      const n = Math.floor(((p - 0.34) / 0.34) * 4);
      const i = pathIndex(right, row, col);
      if (i >= 0 && i < n) return 1;
      return 0;
    }
    if (p < 0.88) return Math.floor((p - 0.68) * 20) % 2 ? 1 : 0;
    return Math.max(0, 1 - (p - 0.88) / 0.12);
  });

  motif("oblique", "Oblique Weave", "Bright bands glide along the diagonals where row plus column stays constant.", TRIS, 2.2, (row, col, p) => {
    const u = (row + col) * 0.55 - p * TAU * 1.35;
    const crest = (0.5 + 0.5 * Math.cos(u)) ** 2;
    let v = crest;
    if (row === 3 && col === 3) v = Math.max(v, 0.35);
    return v;
  });

  const WING_L = [[2, 2], [3, 1], [4, 0], [4, 2]];
  const WING_R = [[2, 4], [3, 5], [4, 4], [4, 6]];

  motif("wings", "Wing Metronome", "The left and right wings trade places. Apex and center peak when they meet.", TRIS, 1.5, (row, col, p) => {
    const swing = pingpong(p);
    const left = swing * swing;
    const right = (1 - swing) ** 2;
    const mid = Math.max(0, 1 - 4 * (swing - 0.5) ** 2);
    if (row === 1 && col === 3) return 0.35 + mid * 0.65;
    if (row === 3 && col === 3) return mid * 0.7;
    if (keyOn(WING_L, row, col)) return left;
    if (keyOn(WING_R, row, col)) return right;
    return 0;
  });

  motif("corona", "Corona Tier", "Rings measured from the center dot swell outward and fall back.", TRIS, 1.8, (row, col, p) => {
    const ring = Math.abs(row - 3) + Math.abs(col - 3);
    const wave = 0.5 + 0.5 * Math.cos((ring / 4) * TAU - pingpong(p) * TAU);
    return smoothstep(0.35, 1, wave);
  });

  motif("rake", "Column Rake", "A tail visits the dots bottom-to-top in each column, columns left to right.", TRIS, 1.75, (row, col, p) => {
    return pathGlow(TRI_RAKE, row, col, p * TRI_RAKE.length, 4);
  });

  motif("shelf", "Shelf Descent", "Horizontal shelves, counted from the apex, drop through the triangle.", TRIS, 1.4, (row, col, p) => {
    const tier = Math.abs(row - 1) + Math.abs(col - 3);
    const wave = 0.5 + 0.5 * Math.cos((tier / 6) * TAU - p * TAU);
    return smoothstep(0.25, 1, wave);
  });

  motif("skew", "Skew Drift", "Ridges travel along the other diagonal, where row minus column stays constant.", TRIS, 2.3, (row, col, p) => {
    const u = (row - col) * 0.62 - p * TAU * 1.45;
    const crest = (0.5 + 0.5 * Math.cos(u)) ** 2;
    let v = crest;
    if (row === 3 && col === 3) v = Math.max(v, 0.32);
    return v;
  });

  motif("zip", "Serpent Zip", "A long tail zigzags row by row, starting along the base.", TRIS, 1.4, (row, col, p) => {
    return pathGlow(TRI_ZIP, row, col, p * TRI_ZIP.length, 4.2);
  });

  motif("pillar", "Pillar Sweep", "A vertical slice of the triangle sweeps from the left edge to the right.", TRIS, 1.5, (row, col, p) => {
    let v = falloff(col, p * 6.4, 0.85);
    if (row === 3 && col === 3) v = Math.max(v, 0.3);
    return v;
  });

  motif("tripod", "Tripod Handoff", "Brightness passes from the apex to the left base corner, then the right.", TRIS, 1.3, (row, col, p) => {
    const hubs = [[1, 3], [4, 0], [4, 6]];
    let sum = 0;
    let glow = 0;
    for (let k = 0; k < 3; k++) {
      const w = Math.max(0, Math.cos(p * TAU - (k * TAU) / 3)) ** 4;
      sum += w;
      const d = Math.abs(row - hubs[k][0]) + Math.abs(col - hubs[k][1]);
      glow += (1 - smoothstep(0, 5.4, d)) * w;
    }
    return glow / (sum + 1e-4);
  });

  motif("updraft", "Updraft", "An inverted V climbs the two lower edges toward the apex.", TRIS, 2.2, (row, col, p) => {
    const climb = 4.2 - pingpong(p) * 3.2;
    const ridge = climb - 0.55 * Math.abs(col - 3);
    const d = row - ridge;
    return Math.exp(-(d * d) / 0.7);
  });

  motif("crossloop", "Infinity Trace", "One tail climbs to the apex, drops down the right edge, then crosses through the center.", TRIS, 1.6, (row, col, p) => {
    return pathGlow(TRI_LOOP, row, col, p * TRI_LOOP.length, 4);
  });

  motif("hollow", "Hollow Shell", "Every dot except the center breathes together.", TRIS, 1.6, (row, col, p) => {
    if (row === 3 && col === 3) return 0.12;
    return 0.15 + smoothstep(0.2, 0.95, 0.5 + 0.5 * Math.sin(p * TAU)) * 0.85;
  });

  motif("ray", "Pivot Ray", "A wedge of light turns around the center dot.", TRIS, 1.5, (row, col, p) => {
    if (row === 3 && col === 3) return 0.45 + 0.2 * Math.sin(p * TAU);
    const d = angBetween(Math.atan2(row - 3, col - 3), p * TAU);
    return Math.exp(-(d * d) / 0.34);
  });

  motif("twinrim", "Twin Perimeter", "Two heads run the outline half a lap apart. The center stays dim.", TRIS, 1.8, (row, col, p) => {
    if (row === 3 && col === 3) return 0.16;
    const head = p * TRI_RIM.length;
    return Math.max(pathGlow(TRI_RIM, row, col, head, 3.2), pathGlow(TRI_RIM, row, col, head + TRI_RIM.length / 2, 3.2));
  });

  motif("hexorbit", "Hex Orbit", "Two heads chase around the 12-dot shell. The center stays lit.", HONEY, 1.5, (row, col, p) => {
    if (row === 2 && col === 2) return 0.35;
    const head = p * HEX_RIM.length;
    const a = pathGlow(HEX_RIM, row, col, head, 4);
    const b = pathGlow(HEX_RIM, row, col, head + HEX_RIM.length / 2, 3.2) * 0.75;
    return Math.max(a, b);
  });

  motif("hexbloom", "Hex Prism", "Three spokes turn through the honeycomb while the outer shell and the center breathe.", HONEY, 1.5, (row, col, p) => {
    const q = hexPos(row, col);
    if (q.r < 0.05) return 0.45 + 0.25 * Math.sin(p * TAU);
    const rot = p * TAU;
    let nearest = 4;
    for (let k = 0; k < 3; k++) nearest = Math.min(nearest, angBetween(q.a, rot + (k * TAU) / 3));
    const spoke = Math.max(0, 1 - nearest / 0.38);
    const shell = q.r > 1.7 ? (0.5 + 0.5 * Math.sin(p * TAU - q.r)) * 0.28 : 0;
    return Math.min(1, spoke * 0.9 + shell);
  });

  motif("honeygate", "Honey Gate", "Two diagonal bands slide in from opposite sides and flash when they meet.", HONEY, 1.85, (row, col, p) => {
    const q = hexPos(row, col);
    const sweep = Math.sin(p * TAU) * 2;
    const a = falloff(q.x * 0.86 + q.y * 0.5, sweep, 0.55);
    const b = falloff(-q.x * 0.86 + q.y * 0.5, -sweep, 0.55);
    const flash = falloff(sweep, 0, 0.55) * falloff(q.r, 0, 1.6);
    return Math.min(1, a * 0.85 + b * 0.85 + flash * 0.5);
  });

  motif("relay", "Vertex Relay", "A signal hops around the six vertices. Neighbours echo it and the center pulses.", HONEY, 1.65, (row, col, p) => {
    const head = p * HEX_VERTS.length;
    const i = Math.floor(head) % HEX_VERTS.length;
    const here = hexPos(row, col);
    const at = hexPos(HEX_VERTS[i][0], HEX_VERTS[i][1]);
    const prev = hexPos(HEX_VERTS[(i + 5) % 6][0], HEX_VERTS[(i + 5) % 6][1]);
    const d = Math.hypot(here.x - at.x, here.y - at.y);
    const dp = Math.hypot(here.x - prev.x, here.y - prev.y);
    let v = d < 0.2 ? 1 : d < 1.15 ? 0.45 : 0;
    if (dp < 0.2) v = Math.max(v, 0.35);
    if (row === 2 && col === 2) v = Math.max(v, 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(p * TAU * 6)));
    return v;
  });

  motif("lattice", "Spiral Lattice", "Two spiral waves turn in opposite directions around a fast core.", HONEY, 1.45, (row, col, p) => {
    const q = hexPos(row, col);
    const peak = (value) => {
      const w = wrapNum(value, 1);
      return Math.max(0, 1 - Math.abs(w * 2 - 1) / 0.55);
    };
    const a = peak(p + q.r * 0.18 + q.a / TAU);
    const b = peak(p * 0.72 - q.r * 0.16 - q.a / TAU) * 0.55;
    const core = q.r < 0.1 ? 0.55 + Math.sin(p * TAU * 2) * 0.3 : 0;
    return Math.min(1, a * 0.75 + b + core);
  });

  function wrapBand(a, b) {
    const diff = Math.abs(a - b) % 4;
    return Math.min(diff, 4 - diff);
  }

  motif("chevron", "Chevron March", "Arrow-shaped bands march through the honeycomb and wrap around.", HONEY, 1.35, (row, col, p) => {
    const x = col - (HEX_COUNT[row] - 1) / 2;
    const y = row - 2;
    const head = p * 4;
    const primary = Math.max(0, 1 - wrapBand(y + Math.abs(x) * 0.92 + 1.55, head) / 0.8);
    const secondary = Math.max(0, 1 - wrapBand(-y + Math.abs(x) * 0.92 + 1.55, head + 2) / 0.95);
    return Math.min(1, primary * 0.9 + secondary * 0.4 + (row === 2 && col === 2 ? 0.18 : 0));
  });

  const HOURGLASS = [
    { "0,0": 2, "0,1": 2, "0,2": 2, "1,1": 1, "1,2": 1, "2,2": 2, "3,1": 1, "3,2": 1, "4,0": 2, "4,1": 2, "4,2": 2 },
    { "0,1": 1, "1,0": 2, "1,1": 2, "1,2": 2, "1,3": 2, "2,2": 1, "3,0": 2, "3,1": 2, "3,2": 2, "3,3": 2, "4,1": 1 },
    { "0,1": 2, "1,1": 2, "1,2": 2, "2,0": 1, "2,1": 2, "2,2": 2, "2,3": 2, "2,4": 1, "3,1": 2, "3,2": 2, "4,1": 2 },
    { "0,0": 1, "0,2": 1, "1,0": 2, "1,3": 2, "2,1": 2, "2,2": 1, "2,3": 2, "3,0": 2, "3,3": 2, "4,0": 1, "4,2": 1 },
  ];

  motif("hourglass", "Hourglass Flip", "Top and bottom bars squeeze into the center, then open into side rails and a diamond.", HONEY, 1.6, (row, col, p) => {
    const tone = HOURGLASS[Math.floor(p * 4) % 4][row + "," + col] || 0;
    return tone === 2 ? 1 : tone === 1 ? 0.4 : 0;
  });

  const HEX_GLYPHS = [
    { "0,1": 2, "1,1": 1, "1,2": 1, "2,0": 2, "2,2": 2, "2,4": 2, "3,1": 1, "3,2": 1, "4,1": 2 },
    { "0,0": 2, "0,2": 2, "1,1": 2, "1,2": 2, "2,2": 2, "3,1": 1, "3,2": 1, "4,1": 1 },
    { "1,0": 2, "2,0": 2, "3,0": 2, "1,3": 2, "2,4": 2, "3,3": 2, "2,2": 1 },
    { "0,0": 1, "0,2": 1, "1,1": 2, "1,2": 2, "2,1": 1, "2,3": 1, "3,1": 2, "3,2": 2, "4,0": 1, "4,2": 1 },
  ];

  motif("hexglyph", "Glyph Flip", "A star, a chevron, side rails and a diamond snap from one to the next.", HONEY, 1.5, (row, col, p) => {
    const tone = HEX_GLYPHS[Math.floor(p * 4) % 4][row + "," + col] || 0;
    return tone === 2 ? 1 : tone === 1 ? 0.42 : 0;
  });

  motif("petal", "Petal Shimmer", "Four petals turn around a steady center, two of them brighter than the others.", HONEY, 1.65, (row, col, p) => {
    const q = hexPos(row, col);
    if (q.r < 0.1) return 0.45 + 0.25 * Math.sin(p * TAU);
    const rot = p * TAU;
    const petal = (offset, width) => Math.max(0, 1 - angBetween(q.a, rot + offset) / width);
    const peak = Math.max(petal(0, 0.42), petal(Math.PI, 0.42));
    const cross = petal(Math.PI / 2, 0.55) * 0.45 + petal(Math.PI * 1.5, 0.55) * 0.45;
    return Math.min(1, peak * 0.95 + cross);
  });

  motif("vortex", "Liquid Vortex", "A lens and two swirl bands drift across the honeycomb.", HONEY, 1.85, (row, col, p) => {
    const q = hexPos(row, col);
    const lens = falloff(Math.sin(p * TAU) * 1.15, q.x * 0.88 + q.y * 0.16, 0.7);
    const ripple = (value) => {
      const w = wrapNum(value, 1);
      return Math.max(0, 1 - Math.min(w, 1 - w) / 0.16);
    };
    const front = ripple(p + q.x * 0.12 - q.y * 0.05 + q.r * 0.07);
    const back = ripple(p + 0.34 + q.x * 0.09 + q.y * 0.04) * 0.4;
    const core = q.r < 0.1 ? 0.4 : 0;
    return Math.min(1, lens * 0.8 + front * 0.45 + back + core);
  });


  /* ---------- rendering ---------- */

  let probe = null;

  function parseColor(str) {
    if (!probe) probe = document.createElement("canvas").getContext("2d");
    probe.fillStyle = "#000";
    probe.fillStyle = str;
    const s = String(probe.fillStyle);
    if (s[0] === "#") return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const m = s.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
  }

  const rgb = (c) => "rgb(" + c.map(Math.round).join(",") + ")";

  function drawDot(ctx, shape, x, y, r) {
    ctx.beginPath();
    if (shape === "square") {
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.fill();
    } else if (shape === "diamond") {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
    } else if (shape === "ring") {
      ctx.lineWidth = r * 0.42;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.arc(x, y, r * 0.79, 0, TAU);
      ctx.stroke();
    } else {
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }

  /* ---------- shared frame loop ---------- */

  const running = new Set();
  let rafId = 0;

  function loop(now) {
    rafId = 0;
    running.forEach((inst) => inst.tick(now));
    if (running.size) rafId = requestAnimationFrame(loop);
  }

  function start(inst) {
    running.add(inst);
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function stop(inst) {
    running.delete(inst);
  }

  /* ---------- loader instance ---------- */

  const DEFAULTS = {
    name: "orbit",
    size: 32,
    cols: null,
    rows: null,
    radius: null,
    color: "currentColor",
    accent: null,
    dim: 0.14,
    dot: 0.72,
    shape: "circle",
    speed: 1,
    glow: 0,
    seed: null,
    label: "Loading",
    paused: false,
    motion: "auto",
  };

  function merge(base, patch) {
    const out = Object.assign({}, base);
    if (!patch) return out;
    for (const k of Object.keys(patch)) {
      if (!(k in DEFAULTS)) continue;
      if (patch[k] === null) out[k] = DEFAULTS[k];
      else if (patch[k] !== undefined) out[k] = patch[k];
    }
    return out;
  }

  class Loader {
    constructor(target, options) {
      const host = typeof target === "string" ? document.querySelector(target) : target;
      if (!host) throw new Error("Dotmatix: target element not found");
      this.host = host;
      this.opts = merge(DEFAULTS, options);
      this.visible = true;
      this.running = false;
      this.destroyed = false;
      this.frames = 0;
      this.last = 0;

      this.element = document.createElement("span");
      this.element.className = "dotmatix";
      this.element.setAttribute("role", "status");
      this.element.style.cssText = "display:inline-block;line-height:0;vertical-align:middle";
      this.canvas = document.createElement("canvas");
      this.canvas.setAttribute("aria-hidden", "true");
      this.canvas.style.display = "block";
      this.element.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      host.textContent = "";
      host.appendChild(this.element);

      if (typeof IntersectionObserver === "function") {
        this.io = new IntersectionObserver((entries) => {
          this.visible = entries[entries.length - 1].isIntersecting;
          this.sync();
        });
        this.io.observe(this.element);
      }
      if (typeof matchMedia === "function") {
        this.mq = matchMedia("(prefers-reduced-motion: reduce)");
        this.onMotionChange = () => this.sync();
        if (this.mq.addEventListener) this.mq.addEventListener("change", this.onMotionChange);
      }

      this.build();
      this.sync();
    }

    build() {
      const def = REGISTRY[this.opts.name];
      if (!def) throw new Error('Dotmatix: unknown loader "' + this.opts.name + '"');
      this.def = def;
      if (typeof def.field === "function") {
        this.field = def.field();
      } else if (def.layout === "hex") {
        this.field = Field.hex(Math.max(1, Math.round(this.opts.radius || def.radius)));
      } else {
        const cols = Math.max(1, Math.round(this.opts.cols || def.cols));
        const rows = Math.max(1, Math.round(this.opts.rows || def.rows));
        this.field = new Field(cols, rows);
      }
      this.shown = new Float32Array(this.field.v.length);
      this.reset();
      this.layout();
    }

    reset() {
      const seed = this.opts.seed != null ? +this.opts.seed : Math.floor(Math.random() * 4294967296);
      this.state = { rand: prng(seed) };
      this.clock = { t: 0, dt: 0, n: 0, acc: 0 };
      this.field.clear();
      if (this.def.init) this.def.init(this.state, this.field);
      this.shown.set(this.field.v);
    }

    layout() {
      const { spanX, spanY } = this.field;
      const size = Math.max(4, +this.opts.size || DEFAULTS.size);
      this.pitch = size / Math.max(spanX, spanY);
      this.dpr = Math.min(3, root.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.pitch * spanX * this.dpr);
      this.canvas.height = Math.round(this.pitch * spanY * this.dpr);
      this.canvas.style.width = this.pitch * spanX + "px";
      this.canvas.style.height = this.pitch * spanY + "px";
      this.element.setAttribute("aria-label", this.opts.label);
      this.resolveColors();
      this.draw();
    }

    resolveColors() {
      const f = this.field;
      const c = this.opts.color;
      const base = !c || c === "currentColor" ? getComputedStyle(this.host).color : c;
      const a = parseColor(base);
      if (!this.opts.accent) {
        this.palette = null;
        this.solid = rgb(a);
        return;
      }
      const b = parseColor(this.opts.accent);
      this.palette = [];
      for (let i = 0; i < f.v.length; i++) {
        const k = (f.px[i] / Math.max(1, f.spanX - 1) + f.py[i] / Math.max(1, f.spanY - 1)) / 2;
        this.palette.push(rgb(a.map((v, j) => v + (b[j] - v) * k)));
      }
    }

    reducedMotion() {
      if (this.opts.motion === "always") return false;
      if (this.opts.motion === "never") return true;
      return !!(this.mq && this.mq.matches);
    }

    sync() {
      const reduced = this.reducedMotion();
      const run = !this.destroyed && !this.opts.paused && this.visible && !reduced;
      if (run && !this.running) {
        this.running = true;
        this.last = 0;
        start(this);
      } else if (!run && this.running) {
        this.running = false;
        stop(this);
      }
      if (!run && reduced && !this.destroyed) this.still();
    }

    still() {
      this.reset();
      const step = 1 / 30;
      for (let t = 0; t < this.def.still; t += step) this.advance(step);
      this.shown.set(this.field.v);
      this.draw();
    }

    advance(dt) {
      const c = this.clock;
      const def = this.def;
      c.t += dt;
      c.dt = dt;
      if (!def.tick) {
        def.update(this.state, this.field, c);
        this.shown.set(this.field.v);
        return;
      }
      c.acc += dt * 1000;
      for (let guard = 0; c.acc >= def.tick && guard < 50; guard++) {
        c.acc -= def.tick;
        c.n++;
        def.update(this.state, this.field, c);
      }
      const k = 1 - Math.exp(-dt * 24);
      const v = this.field.v;
      for (let i = 0; i < v.length; i++) this.shown[i] += (v[i] - this.shown[i]) * k;
    }

    tick(now) {
      if (!this.last) {
        this.last = now;
        return;
      }
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.advance(dt * Math.max(0, +this.opts.speed || 0));
      if (++this.frames % 30 === 0 && (!this.opts.color || this.opts.color === "currentColor")) {
        this.resolveColors();
      }
      this.draw();
    }

    draw() {
      const { ctx, canvas, field, opts } = this;
      const pitch = this.pitch * this.dpr;
      const r = (pitch * clamp(+opts.dot || DEFAULTS.dot, 0.1, 1)) / 2;
      const dim = clamp(+opts.dim, 0, 1);
      const glow = Math.max(0, +opts.glow || 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const i of field.cells) {
        const v = clamp(this.shown[i], 0, 1);
        const alpha = dim + (1 - dim) * v;
        if (alpha < 0.01) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.palette ? this.palette[i] : this.solid;
        if (glow && v > 0.4) {
          ctx.shadowBlur = pitch * glow * v;
          ctx.shadowColor = ctx.fillStyle;
        } else {
          ctx.shadowBlur = 0;
        }
        drawDot(ctx, opts.shape, (field.px[i] + 0.5) * pitch, (field.py[i] + 0.5) * pitch, r);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    set(options) {
      const prev = this.opts;
      this.opts = merge(prev, options);
      const o = this.opts;
      const rebuild = ["name", "cols", "rows", "radius", "seed"].some((k) => o[k] !== prev[k]);
      if (rebuild) this.build();
      else this.layout();
      this.sync();
      return this;
    }

    play() {
      return this.set({ paused: false });
    }

    pause() {
      return this.set({ paused: true });
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.sync();
      if (this.io) this.io.disconnect();
      if (this.mq && this.mq.removeEventListener) this.mq.removeEventListener("change", this.onMotionChange);
      this.element.remove();
    }
  }

  /* ---------- custom element ---------- */

  const ATTRS = Object.keys(DEFAULTS);
  const NUMERIC = new Set(["size", "cols", "rows", "radius", "dim", "dot", "speed", "glow", "seed"]);

  function readAttributes(el) {
    const out = {};
    for (const name of ATTRS) {
      if (!el.hasAttribute(name)) {
        out[name] = null;
        continue;
      }
      const raw = el.getAttribute(name);
      if (name === "paused") out[name] = raw !== "false";
      else if (NUMERIC.has(name)) out[name] = Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : null;
      else out[name] = raw;
    }
    return out;
  }

  if (hasDOM && root.customElements && !root.customElements.get("dotmatix-loader")) {
    class DotmatixLoader extends HTMLElement {
      static get observedAttributes() {
        return ATTRS;
      }

      connectedCallback() {
        if (this.loader) return;
        try {
          this.loader = new Loader(this, readAttributes(this));
        } catch (err) {
          console.warn(err.message);
        }
      }

      disconnectedCallback() {
        if (this.loader) this.loader.destroy();
        this.loader = null;
      }

      attributeChangedCallback() {
        if (!this.loader) return;
        try {
          this.loader.set(readAttributes(this));
        } catch (err) {
          console.warn(err.message);
        }
      }
    }
    root.customElements.define("dotmatix-loader", DotmatixLoader);
  }

  /* ---------- public API ---------- */

  return {
    version: VERSION,
    defaults: Object.assign({}, DEFAULTS),
    mount(target, name, options) {
      return new Loader(target, Object.assign({}, options, { name }));
    },
    register,
    list() {
      return Object.keys(REGISTRY).map((name) => {
        const d = REGISTRY[name];
        const grid = d.grid || (d.layout === "hex" ? "hex r" + d.radius : d.cols + "×" + d.rows);
        return { name, title: d.title, note: d.note, layout: d.layout || "grid", grid, group: d.group || "" };
      });
    },
  };
});
