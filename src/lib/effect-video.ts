import type { CelebrationId } from "@/lib/celebrations";
import confetti from "canvas-confetti";


type ParticleShape = "circle" | "rect" | "star" | "heart" | "spark";

export const EFFECT_EXPORT_SIZE = 320;
const EXPORT_FRAMES = 30;
export const EFFECT_EXPORT_FPS = 12;
const TAU = Math.PI * 2;

const BASE_COLORS = [
  "#ff4ecd",
  "#a855f7",
  "#3b82f6",
  "#22d3ee",
  "#fbbf24",
  "#fb923c",
  "#22c55e",
  "#ef4444",
  "#ffffff",
];

const GOLD_COLORS = ["#fbbf24", "#f59e0b", "#fde68a", "#fcd34d", "#ffffff"];
const NEON_COLORS = ["#22d3ee", "#a855f7", "#ff4ecd", "#ffffff"];
const CASH_COLORS = ["#22c55e", "#86efac", "#16a34a", "#fbbf24", "#ffffff"];
const SNOW_COLORS = ["#ffffff", "#bfdbfe", "#67e8f9", "#93c5fd"];
const HEART_COLORS = ["#ff4ecd", "#ef4444", "#f43f5e", "#ec4899", "#ffffff"];


const seedFromText = (text: string) => {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
};

const createRng = (seed: number) => {
  let value = seed || 1;
  return () => {
    value = Math.imul(value, 1664525) + 1013904223;
    return (value >>> 0) / 4294967296;
  };
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - (1 - value) ** 3;
const easeInOut = (value: number) => (value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2);
const cycle = (value: number) => ((value % 1) + 1) % 1;

const pick = <T,>(items: T[], rng: () => number) => items[Math.floor(rng() * items.length)];

const setFill = (ctx: CanvasRenderingContext2D, color: string, alpha = 1) => {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
};

const drawStar = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha = 1) => {
  ctx.save();
  setFill(ctx, color, alpha);
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const pointRadius = i % 2 === 0 ? radius : radius * 0.45;
    const px = x + Math.cos(angle) * pointRadius;
    const py = y + Math.sin(angle) * pointRadius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawSpark = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha = 1) => {
  ctx.save();
  setFill(ctx, color, alpha);
  ctx.lineWidth = Math.max(2, radius * 0.18);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - radius, y);
  ctx.lineTo(x + radius, y);
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x, y + radius);
  ctx.moveTo(x - radius * 0.65, y - radius * 0.65);
  ctx.lineTo(x + radius * 0.65, y + radius * 0.65);
  ctx.moveTo(x + radius * 0.65, y - radius * 0.65);
  ctx.lineTo(x - radius * 0.65, y + radius * 0.65);
  ctx.stroke();
  ctx.restore();
};

const drawHeart = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 32, size / 32);
  setFill(ctx, color, alpha);
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.bezierCurveTo(-20, -6, -15, -24, 0, -13);
  ctx.bezierCurveTo(15, -24, 20, -6, 0, 10);
  ctx.fill();
  ctx.restore();
};

const drawParticle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  shape: ParticleShape,
  rotation = 0,
  alpha = 1,
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  setFill(ctx, color, alpha);

  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, TAU);
    ctx.fill();
  } else if (shape === "rect") {
    ctx.fillRect(-size * 0.45, -size * 1.15, size * 0.9, size * 2.3);
  } else if (shape === "star") {
    ctx.restore();
    drawStar(ctx, x, y, size, color, alpha);
    return;
  } else if (shape === "heart") {
    ctx.restore();
    drawHeart(ctx, x, y, size * 2.1, color, alpha);
    return;
  } else {
    ctx.restore();
    drawSpark(ctx, x, y, size * 1.4, color, alpha);
    return;
  }

  ctx.restore();
};

const drawBurst = (
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: () => number,
  colors: string[],
  t: number,
  cx = size * 0.5,
  cy = size * 0.52,
  count = 80,
  shapes: ParticleShape[] = ["circle", "rect", "star"],
) => {
  const progress = easeOut(clamp01(t));
  const fade = clamp01(1 - t);

  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const distance = (35 + rng() * size * 0.38) * progress;
    const gravity = size * 0.12 * t * t;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance + gravity;
    const particleSize = 3 + rng() * 7;
    drawParticle(ctx, x, y, particleSize, pick(colors, rng), pick(shapes, rng), angle + t * TAU, fade);
  }
};

const drawFireworks = (
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: () => number,
  colors: string[],
  t: number,
  count = 5,
  mega = false,
) => {
  for (let i = 0; i < count; i += 1) {
    const start = i / count;
    const local = cycle(t - start);
    if (local > 0.8) continue;
    const x = size * (0.16 + rng() * 0.68);
    const y = size * (0.18 + rng() * 0.38);
    drawBurst(ctx, size, rng, colors, local / 0.8, x, y, mega ? 140 : 80, ["circle", "star", "spark"]);
  }
};

const drawFalling = (
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: () => number,
  colors: string[],
  t: number,
  count: number,
  shape: ParticleShape,
) => {
  for (let i = 0; i < count; i += 1) {
    const phase = rng();
    const x = size * rng();
    const y = size * (cycle(phase + t * (0.45 + rng() * 0.35)) * 1.18 - 0.12);
    const drift = Math.sin((t + phase) * TAU) * size * 0.04;
    const s = 3 + rng() * 12;
    drawParticle(ctx, x + drift, y, s, pick(colors, rng), shape, t * TAU * (0.5 + rng()), 0.95);
  }
};

const drawRising = (
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: () => number,
  colors: string[],
  t: number,
  count: number,
  draw: (x: number, y: number, scale: number, color: string, alpha: number) => void,
) => {
  for (let i = 0; i < count; i += 1) {
    const phase = rng();
    const x = size * (0.08 + rng() * 0.84);
    const y = size * (1.12 - cycle(phase + t * (0.25 + rng() * 0.25)) * 1.28);
    const drift = Math.sin((t + phase) * TAU) * size * (0.025 + rng() * 0.06);
    draw(x + drift, y, 0.65 + rng() * 0.65, pick(colors, rng), 0.95);
  }
};

const drawBalloon = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  setFill(ctx, color, alpha);
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 20, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-5, 18);
  ctx.lineTo(5, 18);
  ctx.lineTo(0, 27);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 26);
  ctx.bezierCurveTo(-6, 38, 8, 48, 0, 62);
  ctx.stroke();
  ctx.restore();
};

const drawBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  const r = 16 * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = alpha * 0.85;
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.18, 0, TAU);
  ctx.fill();
  ctx.restore();
};

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const drawMoney = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(x + y) * 0.45);
  ctx.scale(scale, scale);
  setFill(ctx, color, alpha);
  roundRect(ctx, -22, -12, 44, 24, 4);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", 0, 1);
  ctx.restore();
};

const drawSnowflake = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((x + y) * 0.01);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, scale * 2);
  ctx.lineCap = "round";
  const r = 14 * scale;
  for (let i = 0; i < 6; i += 1) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(r * 0.45, 0);
    ctx.lineTo(r * 0.25, r * 0.18);
    ctx.moveTo(r * 0.45, 0);
    ctx.lineTo(r * 0.25, -r * 0.18);
    ctx.stroke();
  }
  ctx.restore();
};

const drawBell = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  setFill(ctx, color, alpha);
  ctx.beginPath();
  ctx.arc(0, -16, 5, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-18, 12);
  ctx.quadraticCurveTo(-12, -18, 0, -18);
  ctx.quadraticCurveTo(12, -18, 18, 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-22, 10, 44, 7);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 21, 5, 0, TAU);
  ctx.fill();
  ctx.restore();
};

const drawBolt = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  setFill(ctx, color, alpha);
  ctx.beginPath();
  ctx.moveTo(4, -52);
  ctx.lineTo(-22, 4);
  ctx.lineTo(0, 4);
  ctx.lineTo(-8, 52);
  ctx.lineTo(28, -10);
  ctx.lineTo(6, -10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawUfo = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#93c5fd";
  ctx.beginPath();
  ctx.ellipse(0, -9, 22, 13, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 42, 13, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  for (let i = -1; i <= 1; i += 1) {
    ctx.beginPath();
    ctx.arc(i * 18, 1, 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
};

const drawRainbow = (ctx: CanvasRenderingContext2D, size: number, t: number) => {
  const colors = ["#ef4444", "#fb923c", "#fbbf24", "#22c55e", "#22d3ee", "#3b82f6", "#a855f7"];
  ctx.save();
  ctx.lineCap = "round";
  colors.forEach((color, i) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 12;
    ctx.beginPath();
    const r = size * (0.28 + i * 0.04);
    const offset = Math.sin((t + i / colors.length) * TAU) * 8;
    ctx.arc(size * 0.5, size * 0.73 + offset, r, Math.PI, TAU);
    ctx.stroke();
  });
  ctx.restore();
};

const drawSmile = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  setFill(ctx, color, alpha);
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.arc(-8, -5, 3, 0, TAU);
  ctx.arc(8, -5, 3, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 2, 10, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
};

const drawCrown = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  setFill(ctx, "#fbbf24", alpha);
  ctx.beginPath();
  ctx.moveTo(-42, 22);
  ctx.lineTo(-34, -20);
  ctx.lineTo(-12, 6);
  ctx.lineTo(0, -32);
  ctx.lineTo(12, 6);
  ctx.lineTo(34, -20);
  ctx.lineTo(42, 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-36, 20, 72, 9);
  ctx.restore();
};

const drawLaserLines = (ctx: CanvasRenderingContext2D, size: number, rng: () => number, t: number) => {
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < 9; i += 1) {
    const y = size * (0.1 + i * 0.1);
    const shift = (cycle(t + i * 0.13) - 0.5) * size * 0.8;
    ctx.strokeStyle = pick(NEON_COLORS, rng);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 4 + rng() * 5;
    ctx.beginPath();
    ctx.moveTo(-size * 0.1 + shift, y);
    ctx.lineTo(size * 1.1 + shift, size - y);
    ctx.stroke();
  }
  ctx.restore();
};

const drawMagicWand = (ctx: CanvasRenderingContext2D, size: number, t: number) => {
  ctx.save();
  ctx.translate(size * 0.46, size * 0.62);
  ctx.rotate(-0.72 + Math.sin(t * TAU) * 0.08);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-70, 50);
  ctx.lineTo(72, -50);
  ctx.stroke();
  ctx.strokeStyle = "#a855f7";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-70, 50);
  ctx.lineTo(72, -50);
  ctx.stroke();
  ctx.restore();
};

const drawDrum = (ctx: CanvasRenderingContext2D, size: number, t: number) => {
  ctx.save();
  ctx.translate(size * 0.5, size * 0.58);
  ctx.fillStyle = "#ef4444";
  roundRect(ctx, -54, -28, 108, 66, 13);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-80, -72 + Math.sin(t * TAU) * 12);
  ctx.lineTo(-22, -28);
  ctx.moveTo(80, -72 - Math.sin(t * TAU) * 12);
  ctx.lineTo(22, -28);
  ctx.stroke();
  ctx.restore();
};

const drawApplause = (ctx: CanvasRenderingContext2D, size: number, t: number) => {
  const spread = Math.sin(t * TAU) * 10;
  ctx.save();
  ctx.translate(size * 0.5, size * 0.56);
  [-1, 1].forEach((side) => {
    ctx.save();
    ctx.translate(side * (28 + spread), 0);
    ctx.rotate(side * (-0.42 + spread * 0.006));
    ctx.scale(side, 1);
    ctx.fillStyle = "#fbbf24";
    roundRect(ctx, -16, -38, 32, 72, 15);
    ctx.fill();
    for (let i = 0; i < 4; i += 1) {
      roundRect(ctx, -30 + i * 14, -70, 12, 42, 6);
      ctx.fill();
    }
    ctx.restore();
  });
  ctx.restore();
};

const drawSpiral = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  for (let i = 0; i < 90; i += 1) {
    const p = i / 90;
    const angle = p * TAU * 3 + t * TAU * 1.5;
    const r = size * p * 0.42;
    drawParticle(
      ctx,
      size * 0.5 + Math.cos(angle) * r,
      size * 0.5 + Math.sin(angle) * r,
      3 + p * 5,
      pick(NEON_COLORS, rng),
      "circle",
      angle,
      1 - p * 0.2,
    );
  }
};

const drawHeartFirework = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  const progress = easeOut(t);
  for (let i = 0; i < 120; i += 1) {
    const a = (i / 120) * TAU;
    const hx = 16 * Math.sin(a) ** 3;
    const hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    drawParticle(
      ctx,
      size * 0.5 + hx * size * 0.011 * progress * 7,
      size * 0.48 + hy * size * 0.011 * progress * 7,
      4 + rng() * 5,
      pick(HEART_COLORS, rng),
      "heart",
      a,
      clamp01(1 - t * 0.65),
    );
  }
};

export const renderEffectFrame = (ctx: CanvasRenderingContext2D, id: CelebrationId, size: number, t: number) => {
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const rng = createRng(seedFromText(id));

  switch (id) {
    case "celebration":
      drawBurst(ctx, size, rng, BASE_COLORS, cycle(t * 1.2), size * 0.5, size * 0.55, 150);
      break;
    case "confetti-cannon":
      drawBurst(ctx, size, rng, BASE_COLORS, cycle(t * 1.4), size * 0.13, size * 0.82, 90, ["rect", "circle", "star"]);
      drawBurst(ctx, size, rng, BASE_COLORS, cycle(t * 1.4), size * 0.87, size * 0.82, 90, ["rect", "circle", "star"]);
      break;
    case "fireworks":
    case "fw-classic":
      drawFireworks(ctx, size, rng, BASE_COLORS, t, 6);
      break;
    case "fw-mega":
      drawFireworks(ctx, size, rng, BASE_COLORS, t, 4, true);
      break;
    case "balloons":
      drawRising(ctx, size, rng, BASE_COLORS, t, 12, (x, y, s, c, a) => drawBalloon(ctx, x, y, s, c, a));
      break;
    case "glitter":
      drawFalling(ctx, size, rng, BASE_COLORS, t, 130, "spark");
      break;
    case "stars":
      drawFalling(ctx, size, rng, GOLD_COLORS, t, 48, "star");
      drawStar(ctx, size * 0.5, size * 0.5, 42 + Math.sin(t * TAU) * 6, "#ffffff", 0.9);
      break;
    case "starburst":
      drawBurst(ctx, size, rng, GOLD_COLORS, cycle(t * 1.35), size * 0.5, size * 0.5, 115, ["star", "spark"]);
      drawFalling(ctx, size, rng, GOLD_COLORS, 1 - t, 36, "star");
      break;
    case "hearts":
      drawRising(ctx, size, rng, HEART_COLORS, t, 28, (x, y, s, c, a) => drawHeart(ctx, x, y, 34 * s, c, a));
      break;
    case "heart-rain":
      drawRising(ctx, size, rng, HEART_COLORS, 1 - t, 36, (x, y, s, c, a) => drawHeart(ctx, x, y, 30 * s, c, a));
      break;
    case "emojis":
      drawRising(ctx, size, rng, ["#fbbf24", "#22d3ee", "#ff4ecd"], t, 10, (x, y, s, c, a) => drawSmile(ctx, x, y, s, c, a));
      drawBurst(ctx, size, rng, BASE_COLORS, cycle(t * 1.1), size * 0.5, size * 0.62, 55);
      break;
    case "neon":
    case "laser":
      drawLaserLines(ctx, size, rng, t);
      drawBurst(ctx, size, rng, NEON_COLORS, cycle(t * 1.3), size * 0.5, size * 0.52, 55, ["circle", "spark"]);
      break;
    case "neon-rings":
      drawLaserLines(ctx, size, rng, t * 0.8);
      for (let i = 0; i < 6; i += 1) {
        const local = cycle(t + i * 0.14);
        ctx.save();
        ctx.globalAlpha = clamp01(1 - local);
        ctx.strokeStyle = pick(NEON_COLORS, rng);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(size * 0.5, size * 0.5, size * (0.06 + easeOut(local) * 0.42), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      break;
    case "golden":
      drawCrown(ctx, size * 0.5, size * 0.48, 1 + Math.sin(t * TAU) * 0.05, 0.95);
      drawFalling(ctx, size, rng, GOLD_COLORS, t, 70, "spark");
      break;
    case "gold-comet":
      for (let i = 0; i < 82; i += 1) {
        const p = i / 82;
        const head = cycle(t * 1.05);
        const trail = cycle(head - p * 0.012);
        const x = size * (-0.08 + trail * 1.18);
        const y = size * (0.74 - trail * 0.5 + Math.sin(p * TAU) * 0.025);
        drawParticle(ctx, x, y, 4 + (1 - p) * 8, pick(GOLD_COLORS, rng), p < 0.08 ? "star" : "spark", -0.5, clamp01(1 - p * 0.85));
      }
      break;
    case "happy":
      drawRising(ctx, size, rng, ["#fbbf24", "#22c55e", "#22d3ee"], t, 8, (x, y, s, c, a) => drawSmile(ctx, x, y, s, c, a));
      drawBurst(ctx, size, rng, BASE_COLORS, cycle(t * 1.4), size * 0.5, size * 0.58, 95);
      break;
    case "rainbow":
      drawRainbow(ctx, size, t);
      drawRising(ctx, size, rng, BASE_COLORS, t, 16, (x, y, s, c, a) => drawStar(ctx, x, y, 10 * s, c, a));
      break;
    case "cash":
      drawRising(ctx, size, rng, CASH_COLORS, 1 - t, 18, (x, y, s, c, a) => drawMoney(ctx, x, y, s, c, a));
      break;
    case "bubbles":
      drawRising(ctx, size, rng, ["#22d3ee", "#93c5fd", "#ffffff"], t, 22, (x, y, s, c, a) => drawBubble(ctx, x, y, s, c, a));
      break;
    case "bubble-pop":
      drawRising(ctx, size, rng, ["#22d3ee", "#93c5fd", "#ffffff"], t, 20, (x, y, s, c, a) => drawBubble(ctx, x, y, s, c, a));
      drawBurst(ctx, size, rng, ["#22d3ee", "#93c5fd", "#ffffff"], cycle(t * 1.6), size * 0.5, size * 0.5, 45, ["circle", "spark"]);
      break;
    case "snow":
      drawRising(ctx, size, rng, SNOW_COLORS, 1 - t, 40, (x, y, s, c, a) => drawSnowflake(ctx, x, y, s, c, a));
      break;
    case "bells":
      drawRising(ctx, size, rng, GOLD_COLORS, 1 - t, 16, (x, y, s, c, a) => drawBell(ctx, x, y, s, c, a));
      break;
    case "thunder":
      drawBolt(ctx, size * 0.5, size * 0.5, 1.7 + Math.sin(t * TAU) * 0.08, "#fbbf24", 0.95);
      drawBurst(ctx, size, rng, ["#ffffff", "#fbbf24", "#22d3ee"], cycle(t * 2), size * 0.5, size * 0.55, 36, ["spark"]);
      break;
    case "ufo":
      drawRising(ctx, size, rng, NEON_COLORS, t * 0.45, 5, (x, y, s, c, a) => drawUfo(ctx, x, y, s, c, a));
      drawLaserLines(ctx, size, rng, t * 0.4);
      break;
    case "drumroll":
      drawDrum(ctx, size, t);
      drawBurst(ctx, size, rng, GOLD_COLORS, cycle(t * 1.5), size * 0.5, size * 0.48, 42, ["circle", "spark"]);
      break;
    case "magic":
      drawMagicWand(ctx, size, t);
      drawFalling(ctx, size, rng, NEON_COLORS, 1 - t, 80, "star");
      break;
    case "applause":
      drawApplause(ctx, size, t);
      drawBurst(ctx, size, rng, GOLD_COLORS, cycle(t * 1.1), size * 0.5, size * 0.46, 52, ["spark", "star"]);
      break;
    case "fw-rain":
      drawFalling(ctx, size, rng, GOLD_COLORS, t, 150, "spark");
      break;
    case "fw-spiral":
      drawSpiral(ctx, size, t, rng);
      break;
    case "fw-heart":
      drawHeartFirework(ctx, size, cycle(t * 1.2), rng);
      break;
    case "fw-pulse":
      for (let i = 0; i < 5; i += 1) {
        const local = cycle(t + i * 0.18);
        ctx.save();
        ctx.globalAlpha = clamp01(1 - local);
        ctx.strokeStyle = pick(NEON_COLORS, rng);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(size * 0.5, size * 0.5, size * (0.08 + easeOut(local) * 0.36), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      break;
    case "fw-rgb":
      ["#ef4444", "#22c55e", "#3b82f6"].forEach((color, i) => {
        drawBurst(ctx, size, rng, [color, "#ffffff"], cycle(t + i * 0.22), size * (0.28 + i * 0.22), size * 0.38, 60, ["circle", "spark"]);
      });
      break;
    case "fw-finale":
      drawFireworks(ctx, size, rng, BASE_COLORS, t, 9, true);
      drawCrown(ctx, size * 0.5, size * 0.62, 0.8 + easeInOut(cycle(t)) * 0.3, 0.75);
      break;
    case "fw-crackle":
      drawFireworks(ctx, size, rng, GOLD_COLORS, t * 1.5, 9);
      drawFalling(ctx, size, rng, GOLD_COLORS, t, 90, "spark");
      break;
  }
};

type OverlayMode = "none" | "rising" | "falling" | "twinkle";

type OverlaySceneItem = {
  left: number;
  top: number;
  delay: number;
  size: number;
  duration: number;
  drift: number;
  rotation: number;
  twinkleDuration: number;
  emoji?: string;
  color?: string;
};

type OverlayFlash = {
  start: number;
  duration: number;
  variant: "neon" | "white";
};

type OverlayScene = {
  mode: OverlayMode;
  items: OverlaySceneItem[];
  flashes: OverlayFlash[];
};

type ExportPlayback = {
  stop: () => void;
};

const OVERLAY_PALETTE = ["#ff4ecd", "#a855f7", "#3b82f6", "#22d3ee", "#fbbf24", "#fb923c", "#22c55e"];
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif';

const OVERLAY_DURATIONS: Partial<Record<CelebrationId, number>> = {
  balloons: 7000,
  glitter: 4500,
  hearts: 6500,
  stars: 3500,
  neon: 1200,
  golden: 3500,
  cash: 5500,
  bubbles: 7000,
  snow: 8500,
  bells: 5500,
  thunder: 1500,
  ufo: 6500,
  drumroll: 2500,
  magic: 3500,
  applause: 3000,
  rainbow: 6000,
};

const CONFETTI_DURATIONS: Partial<Record<CelebrationId, number>> = {
  celebration: 3600,
  fireworks: 3300,
  emojis: 2600,
  happy: 3200,
  golden: 3200,
  rainbow: 3200,
  laser: 2200,
  applause: 2600,
  magic: 3000,
  drumroll: 3800,
  "fw-classic": 3400,
  "fw-mega": 3800,
  "fw-rain": 3500,
  "fw-spiral": 2700,
  "fw-heart": 3000,
  "fw-pulse": 3000,
  "fw-rgb": 3000,
  "fw-finale": 4600,
  "fw-crackle": 3000,
};

const getExportDurationMs = (id: CelebrationId) =>
  Math.max(OVERLAY_DURATIONS[id] ?? 0, CONFETTI_DURATIONS[id] ?? 0) || 3000;

const createOverlayScene = (id: CelebrationId): OverlayScene => {
  const rng = createRng(seedFromText(`${id}-overlay`));
  const make = (
    count: number,
    opts: Partial<OverlaySceneItem> & { emojis?: string[]; colors?: string[] },
  ): OverlaySceneItem[] =>
    Array.from({ length: count }).map(() => ({
      left: rng() * 100,
      top: rng() * 90,
      delay: rng() * 0.8,
      size: (opts.size ?? 24) + rng() * 20,
      duration: (opts.duration ?? 4) + rng() * 3,
      drift: (rng() - 0.5) * 200,
      rotation: (rng() - 0.5) * 720,
      twinkleDuration: 1 + rng() * 1.5,
      emoji: opts.emojis ? pick(opts.emojis, rng) : undefined,
      color: opts.colors ? pick(opts.colors, rng) : undefined,
    }));

  switch (id) {
    case "balloons":
      return { mode: "rising", items: make(28, { emojis: ["🎈"], size: 36, duration: 6 }), flashes: [] };
    case "glitter":
      return { mode: "falling", items: make(120, { colors: OVERLAY_PALETTE, size: 6, duration: 3 }), flashes: [] };
    case "hearts":
      return { mode: "rising", items: make(35, { emojis: ["❤️", "💖", "💕", "💗", "💝"], size: 30, duration: 5 }), flashes: [] };
    case "stars":
      return { mode: "twinkle", items: make(40, { emojis: ["⭐", "✨", "🌟", "💫"], size: 28, duration: 0 }), flashes: [] };
    case "neon":
      return { mode: "none", items: [], flashes: [{ start: 0, duration: 0.7, variant: "neon" }] };
    case "golden":
      return { mode: "falling", items: make(60, { colors: ["#fbbf24", "#f59e0b", "#fde68a", "#fcd34d"], size: 8, duration: 2.5 }), flashes: [] };
    case "cash":
      return { mode: "falling", items: make(40, { emojis: ["💵", "💸", "💰", "🤑"], size: 36, duration: 4 }), flashes: [] };
    case "bubbles":
      return { mode: "rising", items: make(35, { emojis: ["🫧"], size: 40, duration: 6 }), flashes: [] };
    case "snow":
      return { mode: "falling", items: make(80, { emojis: ["❄️", "❅", "❆"], size: 22, duration: 7 }), flashes: [] };
    case "bells":
      return { mode: "falling", items: make(20, { emojis: ["🔔", "🎐"], size: 34, duration: 4 }), flashes: [] };
    case "thunder":
      return {
        mode: "none",
        items: [],
        flashes: [
          { start: 0, duration: 0.2, variant: "white" },
          { start: 0.4, duration: 0.2, variant: "white" },
        ],
      };
    case "ufo":
      return { mode: "twinkle", items: make(8, { emojis: ["🛸", "👽"], size: 50, duration: 5 }), flashes: [] };
    case "drumroll":
      return { mode: "twinkle", items: make(12, { emojis: ["🥁"], size: 40, duration: 0 }), flashes: [] };
    case "magic":
      return { mode: "twinkle", items: make(50, { emojis: ["🪄", "✨", "🔮"], size: 26, duration: 0 }), flashes: [] };
    case "applause":
      return { mode: "twinkle", items: make(35, { emojis: ["👏", "🙌"], size: 36, duration: 0 }), flashes: [] };
    case "rainbow":
      return { mode: "rising", items: make(25, { emojis: ["🌈"], size: 44, duration: 5 }), flashes: [] };
    default:
      return { mode: "none", items: [], flashes: [] };
  }
};

const drawOverlayEmoji = (
  ctx: CanvasRenderingContext2D,
  item: OverlaySceneItem,
  x: number,
  y: number,
  alpha: number,
  scale: number,
  rotation: number,
) => {
  if (!item.emoji) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.font = `${item.size}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(item.emoji, 0, 0);
  ctx.restore();
};

const drawOverlayParticle = (
  ctx: CanvasRenderingContext2D,
  item: OverlaySceneItem,
  x: number,
  y: number,
  alpha: number,
  scale: number,
  rotation: number,
) => {
  if (!item.color) return;

  const radius = (item.size * scale) / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = item.color;
  ctx.shadowBlur = 12;
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, item.color);
  gradient.addColorStop(0.7, item.color);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.restore();
};

const drawOverlayItem = (
  ctx: CanvasRenderingContext2D,
  item: OverlaySceneItem,
  x: number,
  y: number,
  alpha: number,
  scale: number,
  rotation: number,
) => {
  if (item.emoji) drawOverlayEmoji(ctx, item, x, y, alpha, scale, rotation);
  else drawOverlayParticle(ctx, item, x, y, alpha, scale, rotation);
};

const drawFlash = (ctx: CanvasRenderingContext2D, size: number, flash: OverlayFlash, seconds: number) => {
  const local = (seconds - flash.start) / flash.duration;
  if (local < 0 || local > 1) return;

  const alpha = local < 0.2 ? local / 0.2 : 1 - (local - 0.2) / 0.8;
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  if (flash.variant === "white") {
    ctx.fillStyle = "#ffffff";
  } else {
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, "#22d3ee");
    gradient.addColorStop(1, "#a855f7");
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
};

const drawOverlayScene = (ctx: CanvasRenderingContext2D, scene: OverlayScene, size: number, elapsedMs: number) => {
  const seconds = elapsedMs / 1000;
  scene.flashes.forEach((flash) => drawFlash(ctx, size, flash, seconds));

  for (const item of scene.items) {
    const x0 = (item.left / 100) * size;
    const delayed = seconds - item.delay;

    if (scene.mode === "twinkle") {
      if (delayed < 0) continue;
      const pulse = (1 - Math.cos((delayed / item.twinkleDuration) * TAU)) / 2;
      const scale = 1 + pulse * 0.4;
      const alpha = 1 - pulse * 0.4;
      drawOverlayItem(ctx, item, x0, (item.top / 100) * size, alpha, scale, Math.PI * pulse);
      continue;
    }

    const progress = delayed / item.duration;
    if (progress < 0 || progress > 1) continue;

    const eased = clamp01(progress);
    const x = x0 + (item.drift / 320) * size * eased;
    const rotation = (item.rotation * Math.PI / 180) * eased;
    const alpha = clamp01(1 - eased);
    const y =
      scene.mode === "rising"
        ? size + item.size * 0.35 - eased * (size * 1.1 + item.size)
        : -size * 0.1 + eased * (size * 1.2 + item.size);

    drawOverlayItem(ctx, item, x, y, alpha, 1, rotation);
  }
};

const launchExportBurst = (
  fire: confetti.CreateTypes,
  x: number,
  y: number,
  colors: string[],
  opts: confetti.Options = {},
) => {
  fire({
    particleCount: 80,
    startVelocity: 28,
    spread: 360,
    ticks: 70,
    origin: { x, y },
    colors,
    shapes: ["circle"],
    scalar: 1,
    ...opts,
  });
};

const playCardConfettiEffect = (id: CelebrationId, fire: confetti.CreateTypes): ExportPlayback => {
  const timers: number[] = [];
  const rng = createRng(seedFromText(`${id}-confetti`));
  let stopped = false;

  const schedule = (fn: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      if (!stopped) fn();
    }, delay);
    timers.push(timer);
  };

  const random = () => rng();
  const fireConfetti = (opts: confetti.Options = {}) => {
    fire({ particleCount: 120, spread: 80, origin: { y: 0.6 }, ...opts });
  };
  const fullScreenConfetti = () => {
    const duration = 2500;
    const end = performance.now() + duration;
    const colors = ["#ff4ecd", "#a855f7", "#3b82f6", "#22d3ee", "#fbbf24", "#fb923c"];
    const frame = () => {
      if (stopped) return;
      fire({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors });
      fire({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors });
      if (performance.now() < end) requestAnimationFrame(frame);
    };
    frame();
    fire({ particleCount: 200, spread: 160, origin: { y: 0.5 }, colors, scalar: 1.2 });
  };
  const fireworksConfetti = () => {
    const colors = ["#ff4ecd", "#fbbf24", "#22d3ee", "#a855f7", "#22c55e"];
    for (let i = 0; i < 8; i += 1) {
      schedule(() => {
        fire({
          startVelocity: 30,
          spread: 360,
          ticks: 60,
          particleCount: 60,
          origin: { x: random(), y: random() * 0.5 },
          colors,
          shapes: ["circle"],
          scalar: 1.1,
        });
      }, i * 350);
    }
  };
  const triggerEmojiConfetti = (emojis: string[]) => {
    const scalar = 2;
    const shapes = emojis.map((emoji) => confetti.shapeFromText({ text: emoji, scalar }));
    fire({ particleCount: 50, spread: 100, origin: { y: 0.6 }, scalar, shapes });
    schedule(() => fire({ particleCount: 40, spread: 120, origin: { y: 0.7 }, scalar, shapes }), 200);
  };
  const rainbowConfetti = () => {
    const colors = ["#ff0000", "#ff8c00", "#ffd700", "#00c853", "#00b0ff", "#651fff", "#d500f9"];
    colors.forEach((color, i) => {
      schedule(() => {
        fire({ particleCount: 30, angle: 90, spread: 30, startVelocity: 55, origin: { x: 0.5, y: 0.7 }, colors: [color], scalar: 1.1 });
      }, i * 80);
    });
  };
  const laserConfetti = () => {
    const colors = ["#22d3ee", "#a855f7", "#ff4ecd"];
    for (let i = 0; i < 6; i += 1) {
      schedule(() => {
        fire({ particleCount: 1, startVelocity: 80, spread: 1, ticks: 100, origin: { x: random(), y: 1 }, colors, shapes: ["square"], scalar: 2 });
      }, i * 100);
    }
  };

  switch (id) {
    case "celebration":
      fullScreenConfetti();
      schedule(() => fullScreenConfetti(), 600);
      break;
    case "fireworks":
      fireworksConfetti();
      break;
    case "emojis":
      triggerEmojiConfetti(["🎉", "🥳", "😄", "🤩", "🔥", "💥"]);
      break;
    case "happy":
      fireConfetti({ particleCount: 80, colors: ["#fbbf24", "#22c55e", "#22d3ee", "#a855f7"] });
      triggerEmojiConfetti(["😄", "🎊", "🌈"]);
      break;
    case "golden":
      fireConfetti({ particleCount: 100, colors: ["#fbbf24", "#f59e0b", "#fde68a"], shapes: ["circle"], scalar: 1.1 });
      break;
    case "rainbow":
      rainbowConfetti();
      break;
    case "laser":
      laserConfetti();
      break;
    case "applause":
      triggerEmojiConfetti(["👏", "🙌", "🎉"]);
      break;
    case "magic":
      fireConfetti({ particleCount: 60, colors: ["#a855f7", "#22d3ee", "#fbbf24"], shapes: ["star"], scalar: 1.3 });
      triggerEmojiConfetti(["✨", "🪄", "🔮"]);
      break;
    case "drumroll":
      schedule(() => fullScreenConfetti(), 700);
      break;
    case "fw-classic": {
      const colors = ["#ff4ecd", "#fbbf24", "#22d3ee", "#a855f7", "#22c55e", "#fb923c"];
      for (let i = 0; i < 6; i += 1) {
        schedule(() => launchExportBurst(fire, 0.15 + random() * 0.7, 0.2 + random() * 0.3, colors), i * 350);
      }
      break;
    }
    case "fw-mega": {
      const colors = ["#ff4ecd", "#fbbf24", "#22d3ee", "#a855f7"];
      for (let i = 0; i < 5; i += 1) {
        schedule(() => {
          launchExportBurst(fire, random(), random() * 0.4, colors, { particleCount: 200, startVelocity: 45, scalar: 1.5 });
        }, i * 500);
      }
      break;
    }
    case "fw-rain": {
      const colors = ["#fbbf24", "#fde68a", "#f59e0b"];
      for (let i = 0; i < 38; i += 1) {
        schedule(() => {
          fire({
            particleCount: 8,
            angle: 270,
            spread: 30,
            startVelocity: 25,
            gravity: 0.4,
            origin: { x: random(), y: -0.1 },
            colors,
            shapes: ["circle"],
            scalar: 0.8,
          });
        }, i * 80);
      }
      break;
    }
    case "fw-spiral": {
      const colors = ["#a855f7", "#22d3ee", "#ff4ecd"];
      for (let i = 0; i < 24; i += 1) {
        schedule(() => {
          const angle = (i * 30) % 360;
          fire({ particleCount: 6, angle, spread: 10, startVelocity: 40, origin: { x: 0.5, y: 0.5 }, colors, shapes: ["circle"], scalar: 0.9 });
        }, i * 60);
      }
      break;
    }
    case "fw-heart": {
      const colors = ["#ff4ecd", "#ef4444", "#f43f5e", "#ec4899"];
      launchExportBurst(fire, 0.4, 0.35, colors, { particleCount: 100, scalar: 1.2 });
      schedule(() => launchExportBurst(fire, 0.6, 0.35, colors, { particleCount: 100, scalar: 1.2 }), 100);
      schedule(() => launchExportBurst(fire, 0.5, 0.55, colors, { particleCount: 140, scalar: 1.4 }), 300);
      break;
    }
    case "fw-pulse": {
      const colors = ["#22d3ee", "#a855f7"];
      for (let i = 0; i < 5; i += 1) {
        schedule(() => {
          launchExportBurst(fire, 0.5, 0.45, colors, {
            particleCount: 40 + i * 30,
            startVelocity: 20 + i * 8,
            scalar: 0.8 + i * 0.2,
          });
        }, i * 250);
      }
      break;
    }
    case "fw-rgb": {
      const groups = [
        ["#ff0000", "#ff4444"],
        ["#22c55e", "#4ade80"],
        ["#3b82f6", "#60a5fa"],
      ];
      groups.forEach((colors, i) => {
        schedule(() => launchExportBurst(fire, 0.25 + i * 0.25, 0.3, colors, { particleCount: 120, scalar: 1.2 }), i * 250);
      });
      break;
    }
    case "fw-finale": {
      const colors = ["#ff4ecd", "#fbbf24", "#22d3ee", "#a855f7", "#22c55e", "#fb923c", "#ffffff"];
      for (let i = 0; i < 10; i += 1) {
        schedule(() => launchExportBurst(fire, random(), 0.1 + random() * 0.4, colors, { particleCount: 60 }), i * 180);
      }
      schedule(() => {
        for (let j = 0; j < 6; j += 1) {
          launchExportBurst(fire, random(), random() * 0.5, colors, { particleCount: 250, startVelocity: 50, scalar: 1.6 });
        }
      }, 2000);
      break;
    }
    case "fw-crackle": {
      const colors = ["#fbbf24", "#fde68a", "#ffffff"];
      for (let i = 0; i < 12; i += 1) {
        schedule(() => {
          fire({
            particleCount: 30,
            startVelocity: 35,
            spread: 360,
            ticks: 40,
            origin: { x: random(), y: 0.1 + random() * 0.4 },
            colors,
            shapes: ["circle"],
            scalar: 0.6,
          });
        }, i * 120);
      }
      break;
    }
  }

  return {
    stop: () => {
      stopped = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      fire.reset();
    },
  };
};

const renderCompositeEffectFrame = (
  ctx: CanvasRenderingContext2D,
  confettiCanvas: HTMLCanvasElement,
  scene: OverlayScene,
  size: number,
  elapsedMs: number,
) => {
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(confettiCanvas, 0, 0, size, size);
  drawOverlayScene(ctx, scene, size, elapsedMs);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
};


const getSupportedVideoTypes = () => {
  if (!("MediaRecorder" in window)) return [];

  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  return types.filter((type) => MediaRecorder.isTypeSupported(type));
};

const getCanvasStream = (canvas: HTMLCanvasElement) => {
  if (!canvas.captureStream) {
    throw new Error("Seu navegador nao suporta exportar esse efeito como video. Abra no Chrome ou Edge desktop.");
  }

  return canvas.captureStream(EFFECT_EXPORT_FPS);
};

const createVideoRecorder = (stream: MediaStream) => {
  const errors: string[] = [];
  const options: MediaRecorderOptions = {
    audioBitsPerSecond: 128_000,
    videoBitsPerSecond: 4_000_000,
  };

  for (const mimeType of getSupportedVideoTypes()) {
    try {
      return new MediaRecorder(stream, { ...options, mimeType });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    return new MediaRecorder(stream, options);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  throw new Error(errors[0] || "Nao foi possivel iniciar o gravador WebM neste navegador.");
};

const waitForMs = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

type ExportAudio = {
  stream: MediaStream;
  close: () => void;
};

const getAudioContextConstructor = () =>
  window.AudioContext || (window as any).webkitAudioContext;

const toneTo = (
  ac: AudioContext,
  destination: AudioNode,
  freq: number,
  dur: number,
  type: OscillatorType = "sine",
  vol = 0.2,
  delay = 0,
) => {
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
};

const sweepTo = (
  ac: AudioContext,
  destination: AudioNode,
  f1: number,
  f2: number,
  dur: number,
  type: OscillatorType = "sawtooth",
  vol = 0.18,
  delay = 0,
) => {
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f1, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
};

const noiseTo = (
  ac: AudioContext,
  destination: AudioNode,
  dur: number,
  vol = 0.15,
  delay = 0,
) => {
  const t0 = ac.currentTime + delay;
  const buffer = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * dur)), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const src = ac.createBufferSource();
  const gain = ac.createGain();
  src.buffer = buffer;
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(gain).connect(destination);
  src.start(t0);
};

const scheduleAudioForEffect = (
  id: CelebrationId,
  ac: AudioContext,
  destination: AudioNode,
  offset = 0.2,
) => {
  const tone = (...args: Parameters<typeof toneTo> extends [any, any, ...infer Rest] ? Rest : never) =>
    toneTo(ac, destination, args[0], args[1], args[2], args[3], (args[4] ?? 0) + offset);
  const sweep = (...args: Parameters<typeof sweepTo> extends [any, any, ...infer Rest] ? Rest : never) =>
    sweepTo(ac, destination, args[0], args[1], args[2], args[3], args[4], (args[5] ?? 0) + offset);
  const noise = (dur: number, vol = 0.15, delay = 0) => noiseTo(ac, destination, dur, vol, delay + offset);

  const partyHorn = () => {
    sweep(220, 880, 0.3, "sawtooth", 0.22);
    sweep(220, 660, 0.4, "square", 0.12, 0.15);
    sweep(180, 700, 0.35, "sawtooth", 0.18, 0.35);
  };
  const fireworks = () => {
    for (let i = 0; i < 4; i += 1) {
      const d = i * 0.3;
      sweep(80, 1200, 0.15, "triangle", 0.18, d);
      noise(0.4, 0.12, d + 0.15);
    }
  };
  const sparkle = () => [880, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.15, "sine", 0.1, i * 0.05));
  const twinkle = () => [1568, 2093, 2637].forEach((f, i) => tone(f, 0.2, "triangle", 0.1, i * 0.08));
  const heart = () => {
    tone(523, 0.15, "sine", 0.18);
    tone(659, 0.2, "sine", 0.15, 0.1);
  };
  const neon = () => {
    sweep(1500, 200, 0.4, "sawtooth", 0.18);
    noise(0.2, 0.1, 0.05);
  };
  const golden = () => [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.18, "sine", 0.14, i * 0.06));
  const bubble = () => [400, 600, 800, 1000].forEach((f, i) => sweep(f, f * 1.5, 0.15, "sine", 0.1, i * 0.08));
  const thunder = (delay = 0) => {
    noise(0.8, 0.25, delay);
    sweep(120, 40, 0.6, "sawtooth", 0.2, delay + 0.1);
  };
  const drumroll = () => {
    for (let i = 0; i < 12; i += 1) noise(0.04, 0.12, i * 0.04);
    tone(880, 0.4, "triangle", 0.2, 0.5);
  };
  const applause = () => {
    for (let i = 0; i < 25; i += 1) noise(0.05 + Math.random() * 0.05, 0.06 + Math.random() * 0.05, i * 0.04);
  };

  switch (id) {
    case "celebration":
    case "confetti-cannon":
      partyHorn();
      break;
    case "fireworks":
    case "fw-classic":
    case "fw-rgb":
      fireworks();
      break;
    case "fw-mega":
      thunder();
      fireworks();
      break;
    case "fw-finale":
      fireworks();
      thunder(1.8);
      break;
    case "balloons":
      tone(800, 0.08, "triangle", 0.2);
      tone(1200, 0.06, "sine", 0.15, 0.05);
      break;
    case "glitter":
    case "fw-rain":
      sparkle();
      break;
    case "stars":
    case "starburst":
      twinkle();
      break;
    case "hearts":
    case "heart-rain":
    case "fw-heart":
      heart();
      if (id === "fw-heart") fireworks();
      break;
    case "emojis":
      sweep(400, 900, 0.2, "square", 0.15);
      tone(1200, 0.1, "triangle", 0.15, 0.15);
      break;
    case "neon":
    case "laser":
    case "neon-rings":
      neon();
      break;
    case "golden":
    case "gold-comet":
      golden();
      break;
    case "happy":
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, "triangle", 0.16, i * 0.08));
      break;
    case "rainbow":
      [392, 440, 494, 523, 587, 659, 698, 784].forEach((f, i) => tone(f, 0.1, "sine", 0.12, i * 0.05));
      break;
    case "cash":
      [1568, 1976].forEach((f, i) => tone(f, 0.08, "square", 0.15, i * 0.05));
      tone(2349, 0.15, "triangle", 0.12, 0.15);
      break;
    case "bubbles":
    case "bubble-pop":
      bubble();
      break;
    case "snow":
      [2000, 2500, 3000].forEach((f, i) => tone(f, 0.4, "sine", 0.06, i * 0.15));
      noise(0.6, 0.04);
      break;
    case "bells":
      [1047, 1319, 1568].forEach((f, i) => tone(f, 0.6, "sine", 0.12, i * 0.1));
      break;
    case "thunder":
      thunder();
      break;
    case "ufo":
    case "fw-spiral":
      sweep(400, 1200, 0.3, "sine", 0.15);
      sweep(1200, 400, 0.3, "sine", 0.15, 0.3);
      sweep(400, 1200, 0.3, "sine", 0.15, 0.6);
      break;
    case "drumroll":
    case "fw-pulse":
      drumroll();
      break;
    case "magic":
      [523, 698, 880, 1175, 1568].forEach((f, i) => tone(f, 0.2, "triangle", 0.12, i * 0.06));
      break;
    case "applause":
    case "fw-crackle":
      applause();
      break;
  }
};

const createEffectAudio = async (id: CelebrationId): Promise<ExportAudio> => {
  const AudioCtor = getAudioContextConstructor();
  if (!AudioCtor) throw new Error("Seu navegador nao suporta gerar audio para o video.");

  const ac = new AudioCtor() as AudioContext;
  await ac.resume();
  const destination = ac.createMediaStreamDestination();
  if (destination.stream.getAudioTracks().length === 0) {
    throw new Error("Nao foi possivel criar a faixa de audio do video.");
  }

  scheduleAudioForEffect(id, ac, destination);

  return {
    stream: destination.stream,
    close: () => {
      window.setTimeout(() => {
        void ac.close().catch(() => undefined);
      }, 500);
    },
  };
};

export const createTransparentEffectVideo = async (id: CelebrationId) => {
  if (!("MediaRecorder" in window)) {
    throw new Error("Seu navegador nao suporta gravacao de video WebM. Abra no Chrome ou Edge desktop.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = EFFECT_EXPORT_SIZE;
  canvas.height = EFFECT_EXPORT_SIZE;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas 2D is not available.");

  const confettiCanvas = document.createElement("canvas");
  confettiCanvas.width = EFFECT_EXPORT_SIZE;
  confettiCanvas.height = EFFECT_EXPORT_SIZE;
  const exportConfetti = confetti.create(confettiCanvas, { resize: false, useWorker: false });
  const overlayScene = createOverlayScene(id);
  const durationMs = getExportDurationMs(id);
  const frameCount = Math.ceil((durationMs / 1000) * EFFECT_EXPORT_FPS);
  renderCompositeEffectFrame(ctx, confettiCanvas, overlayScene, EFFECT_EXPORT_SIZE, 0);

  const stream = getCanvasStream(canvas);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!track) throw new Error("Nao foi possivel criar a faixa de video do canvas.");
  const audio = await createEffectAudio(id);
  audio?.stream.getAudioTracks().forEach((audioTrack) => stream.addTrack(audioTrack));

  const chunks: BlobPart[] = [];
  const recorder = createVideoRecorder(stream);
  let playback: ExportPlayback | null = null;

  const buildBlob = () => new Blob(chunks, { type: recorder.mimeType || "video/webm" });
  const failIfEmpty = (blob: Blob) => {
    if (blob.size === 0) {
      throw new Error("O navegador gerou um video vazio. Tente abrir no Chrome ou Edge desktop.");
    }

    return blob;
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(recorder.error ?? new Error("Falha ao gravar o video WebM."));
    recorder.onstop = () => {
      playback?.stop();
      track?.stop();
      audio?.stream.getAudioTracks().forEach((audioTrack) => audioTrack.stop());
      audio?.close();
      try {
        resolve(failIfEmpty(buildBlob()));
      } catch (error) {
        reject(error);
      }
    };
  });

  recorder.start(100);
  playback = playCardConfettiEffect(id, exportConfetti);

  const startedAt = performance.now();
  for (let frame = 0; frame <= frameCount; frame += 1) {
    const elapsedMs = frame === 0 ? 0 : performance.now() - startedAt;
    renderCompositeEffectFrame(ctx, confettiCanvas, overlayScene, EFFECT_EXPORT_SIZE, elapsedMs);
    track?.requestFrame?.();
    if (recorder.state === "recording" && frame % 6 === 5) recorder.requestData();
    await waitForMs(1000 / EFFECT_EXPORT_FPS);
  }

  if (recorder.state === "recording") recorder.requestData();
  await waitForMs(250);
  if (recorder.state !== "inactive") {
    recorder.stop();
  }

  return Promise.race([
    stopped,
    waitForMs(3000).then(() => {
      playback?.stop();
      track?.stop();
      audio?.stream.getAudioTracks().forEach((audioTrack) => audioTrack.stop());
      audio?.close();
      return failIfEmpty(buildBlob());
    }),
  ]);
};

const safeFilePart = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");


export const downloadTransparentEffectVideo = async (id: CelebrationId, name: string) => {
  const blob = await createTransparentEffectVideo(id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `winks-${safeFilePart(name || id)}-sem-fundo.webm`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
