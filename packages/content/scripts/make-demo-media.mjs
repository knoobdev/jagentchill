// Makes the demo media the bundled templates are rendered with: eleven 6 s clips, a still of each, and a paper still.
// Every picture is drawn here — a 2D canvas in a headless browser, from the scene functions below and a seeded random
// generator — and encoded with ffmpeg (H.264 720p, a little film grain). No photograph, no footage, no network.
// The set is used only to render template covers and previews; it is never offered as media to a user.
// Licence of the output: CC0-1.0, author "JAgentChill project".
// Usage: node packages/content/scripts/make-demo-media.mjs [only-id …]
import { spawn } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const out = join(import.meta.dirname, "../templates/demo");
mkdirSync(out, { recursive: true });
const WIDTH = 1280, HEIGHT = 720, FPS = 30, SECONDS = 6;

// The scenes, as they run in the page: `make(w, h)` prepares a scene once and returns `draw(c, t)` with t in 0…1.
const pageScript = () => {
  const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const rgba = (hex, alpha) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;
  const mix = (a, b, k) => { const p = (hex, at) => parseInt(hex.slice(at, at + 2), 16); return `rgb(${[1, 3, 5].map((at) => Math.round(p(a, at) + (p(b, at) - p(a, at)) * k)).join(",")})`; };
  const linear = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [at, colour] of stops) g.addColorStop(at, colour); return g; };
  const radial = (c, x, y, r, stops) => { const g = c.createRadialGradient(x, y, 0, x, y, r); for (const [at, colour] of stops) g.addColorStop(at, colour); return g; };
  const glow = (c, x, y, r, hex, alpha) => { c.fillStyle = radial(c, x, y, r, [[0, rgba(hex, alpha)], [1, rgba(hex, 0)]]); c.fillRect(x - r, y - r, r * 2, r * 2); };
  const vignette = (c, w, h, strength) => { c.fillStyle = radial(c, w / 2, h / 2, Math.hypot(w, h) / 2, [[0.55, "rgba(0,0,0,0)"], [1, `rgba(0,0,0,${strength})`]]); c.fillRect(0, 0, w, h); };
  const sprite = (width, height, paint, blur = 0) => {
    const canvas = new OffscreenCanvas(Math.ceil(width), Math.ceil(height)), c = canvas.getContext("2d");
    if (blur) c.filter = `blur(${blur}px)`;
    paint(c, canvas.width, canvas.height);
    return canvas;
  };
  /** An out-of-focus light: an even disc with a brighter rim. */
  const bokehDisc = (hex, radius, soft) => sprite(radius * 2 + soft * 6, radius * 2 + soft * 6, (c, w, h) => {
    c.fillStyle = radial(c, w / 2, h / 2, radius, [[0, rgba(hex, 0.5)], [0.78, rgba(hex, 0.56)], [0.92, rgba(hex, 0.95)], [1, rgba(hex, 0)]]);
    c.beginPath(); c.arc(w / 2, h / 2, radius, 0, Math.PI * 2); c.fill();
  }, soft);
  /** A cumulus cloud: puffs on a flat base, lit from above, shaded underneath. */
  const cloud = (random, width, height, shade) => sprite(width, height, (c, w, h) => {
    const base = sprite(w, h, (b) => {
      b.fillStyle = "#ffffff";
      for (let index = 0; index < 16; index++) {
        const x = w * (0.16 + 0.68 * random()), bell = 1 - Math.abs(x / w - 0.5) * 2, r = h * (0.12 + 0.2 * random()) * (0.55 + 0.45 * bell);
        b.beginPath(); b.arc(x, h * 0.62 - r * 0.55 - h * 0.14 * bell * random(), r, 0, Math.PI * 2); b.fill();
      }
      b.beginPath(); b.ellipse(w / 2, h * 0.64, w * 0.36, h * 0.09, 0, 0, Math.PI * 2); b.fill();
    }, h * 0.05);
    c.drawImage(base, 0, 0);
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = linear(c, 0, h * 0.2, 0, h * 0.75, [[0, "rgba(255,255,255,0)"], [1, shade]]);
    c.fillRect(0, 0, w, h);
  });
  const ridge = (c, w, h, baseY, amplitude, phase, shift, colour) => {
    c.fillStyle = colour; c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) { const u = x / w * 6.283 + shift; c.lineTo(x, baseY - amplitude * (Math.sin(u * 1.1 + phase) + 0.5 * Math.sin(u * 2.7 + phase * 2.1) + 0.22 * Math.sin(u * 6.3 + phase * 3.3))); }
    c.lineTo(w, h); c.closePath(); c.fill();
  };

  const scenes = {
    "sky-morning": (w, h) => {
      const random = rng(11);
      const clouds = Array.from({ length: 9 }, (_, index) => { const scale = 0.5 + random() * 0.9; return { image: cloud(random, 620 * scale, 260 * scale, "rgba(214,160,170,0.75)"), x: random() * 1.3 - 0.15, y: 0.06 + (index / 9) * 0.5 + random() * 0.05, speed: 0.03 + 0.05 * scale, alpha: 0.75 + 0.2 * random() }; });
      return (c, t) => {
        c.fillStyle = linear(c, 0, 0, 0, h, [[0, "#3565b0"], [0.45, "#86b0de"], [0.78, "#f7ccaa"], [1, "#f6a678"]]); c.fillRect(0, 0, w, h);
        glow(c, w * 0.7, h * 0.95, w * 0.6, "#ffe2b0", 0.85);
        for (const item of clouds) { c.globalAlpha = item.alpha; c.drawImage(item.image, ((item.x + item.speed * t + 0.3) % 1.5 - 0.3) * w, item.y * h); }
        c.globalAlpha = 1; vignette(c, w, h, 0.18);
      };
    },
    "hills-sunset": (w, h) => {
      const far = "#d07b8c", near = "#1c1030";
      return (c, t) => {
        c.fillStyle = linear(c, 0, 0, 0, h * 0.8, [[0, "#3a3a8c"], [0.4, "#b3558f"], [0.72, "#f4874c"], [1, "#ffd27d"]]); c.fillRect(0, 0, w, h);
        const sunX = w * 0.58, sunY = h * (0.5 + 0.03 * t);
        glow(c, sunX, sunY, w * 0.45, "#ffd08a", 0.75);
        c.fillStyle = "#fff4cf"; c.beginPath(); c.arc(sunX, sunY, w * 0.045, 0, Math.PI * 2); c.fill();
        for (let layer = 0; layer < 5; layer++) {
          ridge(c, w, h, h * (0.6 + 0.085 * layer), h * (0.035 + 0.012 * layer), layer * 1.9, t * (0.08 + 0.09 * layer) + layer, mix(far, near, layer / 4));
          c.fillStyle = linear(c, 0, h * (0.56 + 0.085 * layer), 0, h * (0.74 + 0.085 * layer), [[0, "rgba(255,170,120,0)"], [1, `rgba(255,170,120,${0.2 - layer * 0.04})`]]); c.fillRect(0, h * 0.5, w, h * 0.5);
        }
        vignette(c, w, h, 0.14);
      };
    },
    "ocean-day": (w, h) => {
      const random = rng(23), horizon = h * 0.46;
      const clouds = Array.from({ length: 5 }, () => { const scale = 0.35 + random() * 0.45; return { image: cloud(random, 620 * scale, 240 * scale, "rgba(170,196,224,0.8)"), x: random() * 1.2 - 0.1, y: 0.1 + random() * 0.22, speed: 0.02 + 0.03 * scale }; });
      const sparks = Array.from({ length: 420 }, () => { const depth = random() ** 1.8; return { x: random(), depth, phase: random() * 6.283, speed: 1 + random() * 2 }; });
      return (c, t) => {
        c.fillStyle = linear(c, 0, 0, 0, horizon, [[0, "#3f8fdc"], [1, "#d9eefb"]]); c.fillRect(0, 0, w, horizon);
        for (const item of clouds) { c.globalAlpha = 0.9; c.drawImage(item.image, (item.x + item.speed * t) * w, item.y * h); }
        c.globalAlpha = 1;
        c.fillStyle = linear(c, 0, horizon, 0, h, [[0, "#3a93bd"], [0.35, "#1b6a98"], [1, "#0a3554"]]); c.fillRect(0, horizon, w, h - horizon);
        // Swell: long darker bands that widen toward the viewer.
        for (let row = 0; row < 16; row++) {
          const depth = (row / 16) ** 1.7, y = horizon + depth * (h - horizon);
          c.strokeStyle = `rgba(4,36,64,${0.1 + depth * 0.16})`; c.lineWidth = 2 + depth * 16; c.beginPath();
          for (let x = -20; x <= w + 20; x += 16) c.lineTo(x, y + Math.sin(x / (50 + depth * 190) + row * 1.7 + t * 6.283 * (0.6 + depth)) * (2 + depth * 9));
          c.stroke();
        }
        c.fillStyle = "#ffffff";
        for (const spark of sparks) {
          const alpha = Math.max(0, Math.sin(spark.phase + t * 6.283 * spark.speed)) ** 4 * (0.25 + 0.6 * (1 - spark.depth));
          if (alpha < 0.02) continue;
          c.globalAlpha = alpha; c.beginPath(); c.ellipse(spark.x * w, horizon + 3 + spark.depth * (h - horizon), 4 + spark.depth * 26, 0.8 + spark.depth * 2.6, 0, 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = 1; glow(c, w * 0.5, horizon, w * 0.5, "#ffffff", 0.35); vignette(c, w, h, 0.22);
      };
    },
    "bokeh-gold": (w, h) => {
      const random = rng(37), colours = ["#ffcf6b", "#ff9a3c", "#ffe9b0", "#ff6f3c", "#ffd9a0"];
      const discs = colours.flatMap((hex) => [bokehDisc(hex, 26, 1), bokehDisc(hex, 48, 2), bokehDisc(hex, 84, 4)]);
      const lights = Array.from({ length: 64 }, () => ({ image: discs[Math.floor(random() * discs.length)], x: random(), y: random(), alpha: 0.12 + random() * 0.45, dx: (random() - 0.5) * 0.05, dy: -0.02 - random() * 0.06, phase: random() * 6.283 }));
      return (c, t) => {
        c.fillStyle = radial(c, w * 0.5, h * 0.62, w * 0.8, [[0, "#5d2b0d"], [1, "#120703"]]); c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = "lighter";
        for (const light of lights) { c.globalAlpha = light.alpha * (0.72 + 0.28 * Math.sin(light.phase + t * 12.566)); c.drawImage(light.image, (light.x + light.dx * t) * w - light.image.width / 2, (light.y + light.dy * t) * h - light.image.height / 2); }
        c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; vignette(c, w, h, 0.4);
      };
    },
    "street-night": (w, h) => {
      const random = rng(41), colours = ["#4fd6ff", "#ff5fa2", "#ffc24f", "#ffffff", "#7d6bff", "#ff4b3e"];
      const discs = colours.flatMap((hex) => [bokehDisc(hex, 22, 1), bokehDisc(hex, 40, 2), bokehDisc(hex, 66, 3)]);
      const lights = Array.from({ length: 70 }, () => { const pick = Math.floor(random() * discs.length); return { image: discs[pick], hex: colours[Math.floor(pick / 3)], x: random() * 1.3, y: 0.26 + random() * 0.34 + (random() - 0.5) * 0.12, alpha: 0.2 + random() * 0.5, speed: 0.05 + random() * 0.12, phase: random() * 6.283 }; });
      return (c, t) => {
        c.fillStyle = linear(c, 0, 0, 0, h, [[0, "#060a1c"], [0.6, "#151238"], [1, "#07060f"]]); c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = "lighter";
        for (const light of lights) {
          const x = ((light.x - light.speed * t + 1.3) % 1.3 - 0.15) * w, y = light.y * h, alpha = light.alpha * (0.8 + 0.2 * Math.sin(light.phase + t * 9));
          c.globalAlpha = alpha; c.drawImage(light.image, x - light.image.width / 2, y - light.image.height / 2);
          // The wet road: each light again below, stretched and faint.
          c.globalAlpha = 1; c.save(); c.translate(x, h * 0.86); c.scale(1, 3.4); glow(c, 0, 0, light.image.width * 0.42, light.hex, alpha * 0.2); c.restore();
        }
        c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; vignette(c, w, h, 0.45);
      };
    },
    "city-dusk": (w, h) => {
      const random = rng(53);
      const skyline = (colour, lit, minHeight, maxHeight, span) => sprite(w * span, h, (c, sw) => {
        let x = 0;
        while (x < sw) {
          const width = 34 + random() * 78, height = h * (minHeight + random() * (maxHeight - minHeight)), top = h - height;
          c.fillStyle = colour; c.fillRect(x, top, width + 1, height);
          if (random() < 0.3) c.fillRect(x + width * 0.42, top - 26 * random() - 8, 3, 34);
          if (lit) for (let wy = top + 12; wy < h - 14; wy += 17) for (let wx = x + 7; wx < x + width - 9; wx += 12) if (random() < lit) { c.fillStyle = random() < 0.8 ? "rgba(255,214,140,0.9)" : "rgba(190,225,255,0.85)"; c.fillRect(wx, wy, 5, 8); }
          x += width + (random() < 0.2 ? 12 : 0);
        }
      });
      const layers = [{ image: skyline("#6b4a80", 0, 0.2, 0.42, 1.2), speed: 0.04 }, { image: skyline("#372752", 0.2, 0.16, 0.36, 1.35), speed: 0.1 }, { image: skyline("#120d22", 0.34, 0.1, 0.27, 1.5), speed: 0.2 }];
      return (c, t) => {
        c.fillStyle = linear(c, 0, 0, 0, h, [[0, "#191d48"], [0.42, "#6f3c7c"], [0.74, "#ee855c"], [1, "#ffc88d"]]); c.fillRect(0, 0, w, h);
        glow(c, w * 0.4, h * 0.8, w * 0.55, "#ffcf99", 0.7);
        layers.forEach((layer, index) => { c.drawImage(layer.image, -layer.speed * t * w, 0); if (index < 2) { c.fillStyle = linear(c, 0, h * 0.45, 0, h, [[0, "rgba(240,140,110,0)"], [1, "rgba(240,140,110,0.3)"]]); c.fillRect(0, h * 0.45, w, h * 0.55); } });
        vignette(c, w, h, 0.32);
      };
    },
    "forest-light": (w, h) => {
      const random = rng(67), greens = ["#3f7a2c", "#6fae3d", "#a8d65c", "#2b5a27", "#d7f08a"];
      const leaf = greens.map((hex) => sprite(420, 420, (c) => { c.fillStyle = radial(c, 210, 210, 150, [[0, rgba(hex, 0.9)], [1, rgba(hex, 0)]]); c.fillRect(0, 0, 420, 420); }, 14));
      const foliage = Array.from({ length: 34 }, () => ({ image: leaf[Math.floor(random() * leaf.length)], x: random() * 1.2 - 0.1, y: random() * 0.9 - 0.15, scale: 0.6 + random() * 1.3, alpha: 0.3 + random() * 0.4, sway: random() * 6.283 }));
      const trunks = Array.from({ length: 7 }, () => ({ x: random() * 1.15, width: 0.018 + random() * 0.04, depth: random() }));
      const dust = Array.from({ length: 90 }, () => ({ x: random(), y: random(), r: 1.2 + random() * 3.2, phase: random() * 6.283, dx: (random() - 0.5) * 0.06, dy: -random() * 0.05 }));
      return (c, t) => {
        c.fillStyle = linear(c, 0, 0, 0, h, [[0, "#35592a"], [1, "#0b170c"]]); c.fillRect(0, 0, w, h);
        for (const item of foliage) { c.globalAlpha = item.alpha; const size = 420 * item.scale; c.drawImage(item.image, item.x * w + Math.sin(item.sway + t * 6.283) * 8 - size / 2, item.y * h - size / 2 + h * 0.2, size, size); }
        c.globalAlpha = 1; c.filter = "blur(3px)";
        for (const trunk of trunks) { c.fillStyle = mix("#3a4a2c", "#0c120b", trunk.depth); c.fillRect((trunk.x - t * 0.03 * (0.4 + trunk.depth)) * w, 0, trunk.width * w * (0.6 + trunk.depth), h); }
        c.filter = "none"; c.globalCompositeOperation = "lighter";
        glow(c, w * 0.16, -h * 0.06, w * 0.62, "#fff3b0", 0.8);
        for (let ray = 0; ray < 8; ray++) {
          const angle = 0.5 + ray * 0.115 + Math.sin(t * 6.283 + ray) * 0.012, reach = w * 1.4;
          c.fillStyle = linear(c, w * 0.16, 0, w * 0.16 + Math.cos(angle) * reach, Math.sin(angle) * reach, [[0, `rgba(255,243,176,${0.2 + 0.08 * Math.sin(ray * 2.3)})`], [1, "rgba(255,243,176,0)"]]);
          c.beginPath(); c.moveTo(w * 0.16, -h * 0.06); c.lineTo(w * 0.16 + Math.cos(angle - 0.024) * reach, Math.sin(angle - 0.024) * reach); c.lineTo(w * 0.16 + Math.cos(angle + 0.024) * reach, Math.sin(angle + 0.024) * reach); c.closePath(); c.fill();
        }
        for (const mote of dust) { const alpha = 0.25 + 0.4 * Math.max(0, Math.sin(mote.phase + t * 9)); glow(c, (mote.x + mote.dx * t) * w, (mote.y + mote.dy * t) * h, mote.r * 3, "#fff6c8", alpha); }
        c.globalCompositeOperation = "source-over"; vignette(c, w, h, 0.4);
      };
    },
    "studio-product": (w, h) => {
      const floor = h * 0.64;
      const round = (c, x, y, width, height, r) => { c.beginPath(); c.roundRect(x, y, width, height, r); c.fill(); };
      return (c, t) => {
        c.save();
        const zoom = 1 + 0.05 * t; c.translate(w / 2, h * 0.55); c.scale(zoom, zoom); c.translate(-w / 2, -h * 0.55);
        c.fillStyle = linear(c, 0, 0, 0, floor, [[0, "#efd3c4"], [1, "#f8e8de"]]); c.fillRect(-40, -40, w + 80, floor + 40);
        c.fillStyle = linear(c, 0, floor, 0, h, [[0, "#edccb9"], [1, "#d9ab95"]]); c.fillRect(-40, floor, w + 80, h - floor + 40);
        glow(c, w * (0.46 + 0.08 * t), h * 0.36, w * 0.42, "#ffffff", 0.7);
        // Arch behind the product.
        c.fillStyle = "#e3b7a3"; c.beginPath(); c.moveTo(w * 0.33, floor); c.lineTo(w * 0.33, h * 0.36); c.arc(w * 0.45, h * 0.36, w * 0.12, Math.PI, 0); c.lineTo(w * 0.57, floor); c.closePath(); c.fill();
        // Pedestal with its shadow.
        c.filter = "blur(18px)"; c.fillStyle = "rgba(120,70,50,0.35)"; c.beginPath(); c.ellipse(w * 0.54, h * 0.845, w * 0.2, h * 0.035, 0, 0, Math.PI * 2); c.fill(); c.filter = "none";
        c.fillStyle = linear(c, w * 0.34, 0, w * 0.66, 0, [[0, "#e8c8b6"], [0.5, "#f6e4d9"], [1, "#d9b29d"]]); c.fillRect(w * 0.34, h * 0.74, w * 0.32, h * 0.09);
        c.beginPath(); c.ellipse(w * 0.5, h * 0.83, w * 0.16, h * 0.03, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#fbf1ea"; c.beginPath(); c.ellipse(w * 0.5, h * 0.74, w * 0.16, h * 0.03, 0, 0, Math.PI * 2); c.fill();
        // Bottle: glass body, label, cap, a highlight down its side.
        const bx = w * 0.455, bw = w * 0.07, by = h * 0.4, bh = h * 0.335;
        c.fillStyle = "rgba(110,60,45,0.25)"; c.beginPath(); c.ellipse(bx + bw * 0.75, by + bh, bw * 0.9, h * 0.012, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = linear(c, bx, 0, bx + bw, 0, [[0, "#1f4a4f"], [0.35, "#5f9488"], [0.7, "#2e6164"], [1, "#173b40"]]); round(c, bx, by, bw, bh, bw * 0.16);
        c.fillStyle = "#f4ebe1"; c.fillRect(bx, by + bh * 0.42, bw, bh * 0.32);
        c.fillStyle = "#2e6164"; c.fillRect(bx + bw * 0.2, by + bh * 0.5, bw * 0.6, 3); c.fillRect(bx + bw * 0.3, by + bh * 0.58, bw * 0.4, 2); c.fillRect(bx + bw * 0.3, by + bh * 0.64, bw * 0.4, 2);
        c.fillStyle = linear(c, bx, 0, bx + bw, 0, [[0, "#b98a5e"], [0.4, "#f0cf9f"], [1, "#a97a50"]]); round(c, bx + bw * 0.24, by - bh * 0.17, bw * 0.52, bh * 0.18, 4);
        c.fillStyle = "rgba(255,255,255,0.3)"; round(c, bx + bw * 0.14, by + bh * 0.05, bw * 0.1, bh * 0.88, 4);
        // A sphere beside it.
        c.fillStyle = "rgba(110,60,45,0.22)"; c.beginPath(); c.ellipse(w * 0.585, h * 0.738, w * 0.036, h * 0.01, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = c.createRadialGradient(w * 0.572, h * 0.672, 2, w * 0.58, h * 0.69, w * 0.036); c.fillStyle.addColorStop(0, "#ffd9c2"); c.fillStyle.addColorStop(1, "#d98a6c");
        c.beginPath(); c.arc(w * 0.58, h * 0.69, w * 0.03, 0, Math.PI * 2); c.fill();
        c.restore(); vignette(c, w, h, 0.16);
      };
    },
    "light-leak": (w, h) => {
      const random = rng(79), colours = ["#ff5a1f", "#ff2d6f", "#ffb347", "#b5179e", "#ff7a3c"];
      const blobs = colours.map((hex) => sprite(900, 900, (c) => { c.fillStyle = radial(c, 450, 450, 380, [[0, rgba(hex, 0.95)], [0.5, rgba(hex, 0.45)], [1, rgba(hex, 0)]]); c.fillRect(0, 0, 900, 900); }));
      const leaks = Array.from({ length: 8 }, (_, index) => ({ image: blobs[index % blobs.length], ax: random() * 6.283, ay: random() * 6.283, cx: random(), cy: random(), scale: 0.8 + random() * 1.2, alpha: 0.6 + random() * 0.4 }));
      return (c, t) => {
        c.fillStyle = "#1c0c0a"; c.fillRect(0, 0, w, h); c.globalCompositeOperation = "screen";
        for (const leak of leaks) { const size = 900 * leak.scale; c.globalAlpha = leak.alpha; c.drawImage(leak.image, (leak.cx + 0.22 * Math.sin(leak.ax + t * 3.1)) * w - size / 2, (leak.cy + 0.2 * Math.cos(leak.ay + t * 2.3)) * h - size / 2, size, size); }
        c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; vignette(c, w, h, 0.3);
      };
    },
    "confetti-party": (w, h) => {
      const random = rng(83), colours = ["#ffd400", "#ff2d92", "#34c7ff", "#7dff6b", "#ffffff", "#ff8a3c"];
      const discs = ["#ff5fa2", "#8a5bff", "#ffc24f"].map((hex) => bokehDisc(hex, 60, 5));
      const lights = Array.from({ length: 22 }, () => ({ image: discs[Math.floor(random() * discs.length)], x: random(), y: random() * 0.8, alpha: 0.1 + random() * 0.25 }));
      const pieces = Array.from({ length: 170 }, () => ({ x: random(), y: random(), size: 9 + random() * 16, colour: colours[Math.floor(random() * colours.length)], fall: 0.35 + random() * 0.55, spin: 2 + random() * 5, turn: random() * 6.283, sway: random() * 6.283, near: random() < 0.12 }));
      return (c, t) => {
        c.fillStyle = radial(c, w * 0.5, h * 0.3, w * 0.85, [[0, "#6a23b8"], [1, "#190a36"]]); c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = "lighter";
        for (const light of lights) { c.globalAlpha = light.alpha; c.drawImage(light.image, light.x * w - light.image.width / 2, light.y * h - light.image.height / 2); }
        c.globalCompositeOperation = "source-over";
        for (const piece of pieces) {
          const scale = piece.near ? 3.2 : 1, x = (piece.x + 0.03 * Math.sin(piece.sway + t * 7)) * w, y = ((piece.y + piece.fall * t * scale * 0.6) % 1.1 - 0.05) * h;
          c.save(); c.translate(x, y); c.rotate(piece.turn + t * piece.spin); c.scale(1, Math.cos(piece.turn + t * piece.spin * 2.2));
          c.globalAlpha = piece.near ? 0.55 : 0.95; if (piece.near) c.filter = "blur(5px)";
          c.fillStyle = piece.colour; c.fillRect(-piece.size * scale / 2, -piece.size * scale * 0.3, piece.size * scale, piece.size * scale * 0.6);
          c.restore();
        }
        c.globalAlpha = 1; vignette(c, w, h, 0.35);
      };
    },
    "pastel-wash": (w, h) => {
      const random = rng(97), colours = ["#ffc8dd", "#bde0fe", "#cdb4db", "#ffafcc", "#a2d2ff", "#fff1a8", "#b8f2e6"];
      const blobs = colours.map((hex) => sprite(900, 900, (c) => { c.fillStyle = radial(c, 450, 450, 400, [[0, rgba(hex, 1)], [0.55, rgba(hex, 0.6)], [1, rgba(hex, 0)]]); c.fillRect(0, 0, 900, 900); }));
      const washes = Array.from({ length: 10 }, (_, index) => ({ image: blobs[index % blobs.length], ax: random() * 6.283, ay: random() * 6.283, cx: random(), cy: random(), scale: 0.9 + random() }));
      return (c, t) => {
        c.fillStyle = "#f4e8ff"; c.fillRect(0, 0, w, h);
        for (const wash of washes) { const size = 900 * wash.scale; c.globalAlpha = 0.85; c.drawImage(wash.image, (wash.cx + 0.16 * Math.sin(wash.ax + t * 2.6)) * w - size / 2, (wash.cy + 0.16 * Math.cos(wash.ay + t * 2.1)) * h - size / 2, size, size); }
        c.globalAlpha = 1;
      };
    },
    "paper": (w, h) => {
      const random = rng(101);
      return (c) => {
        c.fillStyle = "#f3ecdf"; c.fillRect(0, 0, w, h);
        c.filter = "blur(40px)";
        for (let index = 0; index < 60; index++) { c.fillStyle = random() < 0.5 ? "rgba(255,255,255,0.22)" : "rgba(196,170,130,0.1)"; c.beginPath(); c.arc(random() * w, random() * h, 60 + random() * 160, 0, Math.PI * 2); c.fill(); }
        c.filter = "none"; c.lineWidth = 0.7;
        for (let index = 0; index < 5200; index++) { const x = random() * w, y = random() * h, angle = random() * 6.283, length = 3 + random() * 16; c.strokeStyle = random() < 0.5 ? "rgba(120,96,64,0.07)" : "rgba(255,255,255,0.3)"; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); c.stroke(); }
        const image = c.getImageData(0, 0, w, h), data = image.data;
        for (let at = 0; at < data.length; at += 4) { const grain = (random() - 0.5) * 12; data[at] += grain; data[at + 1] += grain; data[at + 2] += grain; }
        c.putImageData(image, 0, 0); vignette(c, w, h, 0.14);
      };
    },
  };
  let current = null;
  globalThis.__demo = {
    ids: Object.keys(scenes),
    start(id, w, h) { const canvas = new OffscreenCanvas(w, h), c = canvas.getContext("2d"); current = { canvas, c, draw: scenes[id](w, h) }; },
    async frame(t) {
      const { canvas, c, draw } = current;
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.filter = "none";
      draw(c, t);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.96 })).arrayBuffer());
      let text = ""; for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      return btoa(text);
    },
  };
};

/** What each item shows, for the provenance row and the manifest. */
const DESCRIPTIONS = {
  "sky-morning": "morning sky, blue to peach, with drifting cumulus clouds",
  "hills-sunset": "sun low over five hazy ridges, purple to orange sky",
  "ocean-day": "open sea to the horizon under a pale sky, with swell and glitter",
  "bokeh-gold": "out-of-focus golden lights drifting on a dark warm ground",
  "street-night": "out-of-focus street lights passing at night, reflected on a wet road",
  "city-dusk": "city skyline at dusk in three layers, lit windows, slow pan",
  "forest-light": "sun rays through blurred foliage and trunks, floating dust",
  "studio-product": "a glass bottle and a sphere on a pedestal in a peach studio set, slow push-in",
  "light-leak": "orange and magenta film light leaks moving over black",
  "confetti-party": "confetti falling in front of violet party lights",
  "pastel-wash": "slowly moving pastel colour washes",
  "paper": "cream paper with fibres and grain",
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.evaluate(`(${pageScript.toString()})()`);
const ids = await page.evaluate(() => globalThis.__demo.ids);
const only = process.argv.slice(2);
const items = [];
const frame = async (t) => Buffer.from(await page.evaluate((time) => globalThis.__demo.frame(time), t), "base64");
const encode = (args, frames) => new Promise((resolve, reject) => {
  const child = spawn("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: ["pipe", "inherit", "inherit"] });
  child.on("error", reject);
  child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  (async () => { for await (const bytes of frames) if (!child.stdin.write(bytes)) await new Promise((drained) => child.stdin.once("drain", drained)); child.stdin.end(); })().catch(reject);
});
for (const id of ids) {
  const still = join(out, `${id}.jpg`), clip = join(out, `${id}.mp4`);
  if (only.length === 0 || only.includes(id)) {
    await page.evaluate(({ id, w, h }) => globalThis.__demo.start(id, w, h), { id, w: WIDTH, h: HEIGHT });
    if (id === "paper") writeFileSync(still, await frame(0));
    else {
      const total = FPS * SECONDS;
      await encode(["-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-vf", "noise=alls=5:allf=t:all_seed=7,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", "-an", clip],
        (async function* () { for (let index = 0; index < total; index++) yield await frame(index / total); })());
      // The still of a clip is its frame at 40 %: what an image slot shows.
      await page.evaluate(({ id, w, h }) => globalThis.__demo.start(id, w, h), { id, w: WIDTH, h: HEIGHT });
      await encode(["-f", "image2pipe", "-c:v", "mjpeg", "-i", "-", "-frames:v", "1", "-q:v", "3", still], (async function* () { yield await frame(0.4); })());
    }
    console.log("made", id);
  }
  items.push({ id, description: DESCRIPTIONS[id], still: `${id}.jpg`, ...(id === "paper" ? {} : { clip: `${id}.mp4`, seconds: SECONDS }) });
}
await browser.close();
writeFileSync(join(out, "demo.json"), `${JSON.stringify({ author: "JAgentChill project", license: "CC0-1.0", note: "Drawn and encoded by packages/content/scripts/make-demo-media.mjs. Used only to render the covers and previews of the bundled templates.", width: WIDTH, height: HEIGHT, items }, null, 2)}\n`);
let bytes = 0;
for (const item of items) for (const name of [item.still, item.clip]) if (name) bytes += statSync(join(out, name)).size;
console.log(`demo media: ${items.length} items, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
