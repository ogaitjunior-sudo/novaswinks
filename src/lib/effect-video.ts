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
const PARTY_COLORS = ["#ff4ecd", "#a855f7", "#22d3ee", "#fbbf24", "#fb923c", "#ffffff"];
const LUCKY_COLORS = ["#22c55e", "#86efac", "#fbbf24", "#fde68a", "#ffffff"];
const FLOWER_COLORS = ["#f9a8d4", "#f472b6", "#fbcfe8", "#fef3c7", "#ffffff"];

const normalizeCelebrationKey = (id: string) => {
  const key = id.trim().toLowerCase();
  switch (key) {
    case "bingo!":
      return "bingo";
    case "thumbs up":
      return "thumbs-up";
    case "trivia time":
      return "trivia-time";
    case "happy birthday":
      return "happy-birthday";
    default:
      return key;
  }
};


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
const CORE_WINK_KEYS = new Set([
  "celebration",
  "bingo",
  "flowers",
  "thumbs-up",
  "leprechaun",
  "countdown",
  "trivia-time",
  "happy-birthday",
]);
const WINK_DURATION_MS = 8000;
const createWinkBeat = (value: number) => {
  const progress = clamp01(value);
  const intro = easeOut(clamp01(progress / 0.18));
  const formation = easeOut(clamp01((progress - 0.18) / 0.2));
  const hero = easeInOut(clamp01((progress - 0.38) / 0.18));
  const hold = easeInOut(clamp01((progress - 0.56) / 0.19));
  const dissolve = easeInOut(clamp01((progress - 0.75) / 0.13));
  const exit = easeInOut(clamp01((progress - 0.88) / 0.12));
  const renderTime = progress < 0.56
    ? 0.018 + (easeInOut(clamp01(progress / 0.56)) * 0.802)
    : progress < 0.75
      ? 0.82 + (easeInOut(clamp01((progress - 0.56) / 0.19)) * 0.08)
      : 0.9 + (easeInOut(clamp01((progress - 0.75) / 0.25)) * 0.1);
  return {
    progress,
    intro,
    formation,
    hero,
    hold,
    dissolve,
    exit,
    renderTime,
    visibleAlpha: (0.12 + (intro * 0.88)) * (1 - exit),
  };
};

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

const drawGlowCloud = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha = 1) => {
  ctx.save();
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.45, color);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
  ctx.restore();
};

const drawShockwave = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, radius * 0.06);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, radius * 0.022);
  ctx.globalAlpha = alpha * 0.7;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.22, 0, TAU);
  ctx.stroke();
  ctx.restore();
};

const drawLensFlare = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, scale * 6);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-scale * 80, 0);
  ctx.lineTo(scale * 80, 0);
  ctx.moveTo(0, -scale * 52);
  ctx.lineTo(0, scale * 52);
  ctx.stroke();
  drawGlowCloud(ctx, 0, 0, scale * 56, color, alpha * 0.32);
  ctx.restore();
};

const drawLightStreaks = (
  ctx: CanvasRenderingContext2D,
  size: number,
  t: number,
  colors: string[],
  count = 8,
  direction = 1,
) => {
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < count; i += 1) {
    const progress = cycle(t * (0.75 + i * 0.04) + i * 0.13);
    const x = size * (-0.15 + progress * 1.35);
    const y = size * (0.12 + i * 0.08);
    ctx.strokeStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.2 + (1 - progress) * 0.35;
    ctx.lineWidth = 2 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(x - size * 0.14, y - direction * size * 0.08);
    ctx.lineTo(x + size * 0.16, y + direction * size * 0.11);
    ctx.stroke();
  }
  ctx.restore();
};

const drawCoin = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha = 1, rotation = 0) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  drawGlowCloud(ctx, 0, 0, 22, "#fbbf24", 0.24);
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 18, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#fde68a";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-4, -4, 6, 4, -0.5, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", 0, 1);
  ctx.restore();
};

const drawBingoBallIcon = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
  digit: string,
  alpha = 1,
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  drawGlowCloud(ctx, 0, 0, 28, color, 0.26);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.arc(-6, -7, 8, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.font = "bold 12px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(digit, 0, 0.8);
  ctx.restore();
};

const drawPartyHorn = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha = 1, rotation = 0) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.moveTo(-36, -8);
  ctx.lineTo(32, 0);
  ctx.lineTo(-36, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#a855f7";
  roundRect(ctx, -52, -10, 18, 20, 7);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-12, -6);
  ctx.lineTo(8, -2);
  ctx.moveTo(-6, 5);
  ctx.lineTo(18, 4);
  ctx.stroke();
  ctx.restore();
};

const drawStreamer = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  color: string,
  alpha = 1,
  rotation = 0,
  wave = 1,
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(5, length * 0.045);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(length * 0.18, -16 * wave, length * 0.42, 24 * wave, length * 0.68, -18 * wave);
  ctx.bezierCurveTo(length * 0.82, -30 * wave, length * 0.96, 16 * wave, length * 1.08, -8 * wave);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.24;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(2, length * 0.016);
  ctx.beginPath();
  ctx.moveTo(length * 0.08, -2);
  ctx.bezierCurveTo(length * 0.22, -10 * wave, length * 0.48, 16 * wave, length * 0.9, -8 * wave);
  ctx.stroke();
  ctx.restore();
};

const drawPetal = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1, rotation = 0) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  drawGlowCloud(ctx, 0, 0, 18, color, 0.18);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.bezierCurveTo(16, -18, 18, 4, 0, 22);
  ctx.bezierCurveTo(-18, 4, -16, -18, 0, -18);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = alpha * 0.4;
  ctx.beginPath();
  ctx.ellipse(-4, -6, 5, 10, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
};

const drawShamrock = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha = 1, rotation = 0) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ["-12,0", "12,0", "0,-12", "0,12"].forEach((pair) => {
    const [dx, dy] = pair.split(",").map(Number);
    drawHeart(ctx, dx, dy, 22, "#22c55e", alpha);
  });
  ctx.strokeStyle = "#86efac";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.quadraticCurveTo(14, 28, 8, 44);
  ctx.stroke();
  ctx.restore();
};

const drawPotOfGold = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#fde68a";
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.arc(i * 11, -18 - Math.abs(i % 2) * 3, 10, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#111827";
  roundRect(ctx, -42, -16, 84, 42, 14);
  ctx.fill();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
};

const drawThumb = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1, rotation = 0) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  drawGlowCloud(ctx, 0, 0, 42, color, 0.22);
  ctx.fillStyle = color;
  roundRect(ctx, -20, -18, 34, 48, 14);
  ctx.fill();
  roundRect(ctx, -34, -6, 18, 36, 12);
  ctx.fill();
  roundRect(ctx, -8, -36, 18, 28, 10);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = alpha * 0.28;
  roundRect(ctx, -10, -12, 12, 28, 8);
  ctx.fill();
  ctx.restore();
};

const drawQuestionMark = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.08);
  ctx.strokeText("?", 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("?", 0, 0);
  ctx.restore();
};

const drawBirthdayCandle = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  roundRect(ctx, -5, -26, 10, 36, 4);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-1, -26, 2, 36);
  drawGlowCloud(ctx, 0, -34, 16, "#fb923c", 0.3);
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.moveTo(0, -44);
  ctx.quadraticCurveTo(8, -36, 0, -28);
  ctx.quadraticCurveTo(-8, -36, 0, -44);
  ctx.fill();
  ctx.restore();
};

const drawBirthdayCake = (ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  drawGlowCloud(ctx, 0, -10, 82, "#f472b6", 0.18);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, -86, 34, 172, 12, 6);
  ctx.fill();
  ctx.fillStyle = "#ec4899";
  roundRect(ctx, -66, -4, 132, 42, 14);
  ctx.fill();
  ctx.fillStyle = "#fef3c7";
  roundRect(ctx, -74, -26, 148, 24, 12);
  ctx.fill();
  ctx.fillStyle = "#f9a8d4";
  roundRect(ctx, -42, -54, 84, 30, 10);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, -48, -66, 96, 18, 9);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.globalAlpha = alpha * 0.45;
  for (let i = -4; i <= 4; i += 2) {
    ctx.beginPath();
    ctx.arc(i * 15, 12, 5, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
};

const drawSpotlightCone = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  alpha = 1,
  rotation = 0,
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  const gradient = ctx.createLinearGradient(0, 0, 0, -height);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(-width * 0.12, 0);
  ctx.lineTo(width * 0.12, 0);
  ctx.lineTo(width, -height);
  ctx.lineTo(-width, -height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawImpactText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke: string,
  alpha = 1,
) => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(5, size * 0.12);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
};

const drawDustField = (
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: () => number,
  colors: string[],
  t: number,
  count: number,
) => {
  for (let i = 0; i < count; i += 1) {
    const phase = rng();
    const x = size * cycle(phase + t * (0.08 + rng() * 0.08));
    const y = size * (0.08 + rng() * 0.84);
    const radius = 2 + rng() * 5;
    drawGlowCloud(ctx, x, y, radius * 2.4, pick(colors, rng), 0.07 + (1 - phase) * 0.08);
    if (i % 7 === 0) drawSpark(ctx, x, y, radius * 1.5, "#ffffff", 0.55);
  }
};

const renderCelebrationScene = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  const pulse = 1 + Math.sin(t * TAU * 2.2) * 0.05;
  drawGlowCloud(ctx, size * 0.5, size * 0.48, size * 0.3, "#a855f7", 0.16);
  drawGlowCloud(ctx, size * 0.5, size * 0.44, size * 0.16, "#fbbf24", 0.08);
  drawFalling(ctx, size, rng, PARTY_COLORS, t, 54, "rect");
  drawBurst(ctx, size, rng, PARTY_COLORS, cycle(t * 1.08), size * 0.5, size * 0.42, 54, ["rect", "star"]);
  drawShockwave(ctx, size * 0.5, size * 0.5, size * (0.12 + cycle(t * 0.9) * 0.08), "#ffffff", 0.14);
  for (let i = 0; i < 4; i += 1) {
    const phase = cycle(t * 0.38 + i * 0.16);
    const x = size * (0.18 + i * 0.2);
    const y = size * (0.15 + (i % 2) * 0.08);
    drawStreamer(
      ctx,
      x,
      y,
      size * (0.17 + (i % 2) * 0.03),
      PARTY_COLORS[i % PARTY_COLORS.length],
      0.72,
      -1.05 + phase * 0.38,
      i % 2 === 0 ? 1 : -1,
    );
  }
  drawImpactText(ctx, "YAY!", size * 0.5, size * 0.48, size * 0.2 * pulse, "#fff7d6", "#7c3aed", 0.98);
  const hornPulse = 1 + Math.sin(t * TAU * 2.4) * 0.06;
  drawPartyHorn(ctx, size * 0.26, size * 0.76, hornPulse * 1.15, 0.98, -0.26);
  drawPartyHorn(ctx, size * 0.74, size * 0.76, hornPulse * 1.15, 0.98, Math.PI + 0.26);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * TAU + t * 0.7;
    drawSpark(
      ctx,
      size * 0.5 + Math.cos(angle) * size * 0.19,
      size * 0.48 + Math.sin(angle) * size * 0.12,
      8 + (i % 2) * 3,
      i % 2 === 0 ? "#ffffff" : "#fbbf24",
      0.5,
    );
  }
  drawLensFlare(ctx, size * 0.5, size * 0.48, 0.56 + Math.sin(t * TAU) * 0.06, "#ffffff", 0.34);
};

const renderBingoScene = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  const impact = clamp01(t * 2.4);
  const shake = (1 - impact) * size * 0.045 + Math.max(0, Math.sin(t * TAU * 6)) * size * 0.012;
  const jackpotColors = ["#fde68a", "#fbbf24", "#f59e0b", "#ef4444", "#ffffff"];
  ctx.save();
  ctx.translate(Math.sin(t * TAU * 23) * shake, Math.cos(t * TAU * 17) * shake * 0.65);
  drawGlowCloud(ctx, size * 0.5, size * 0.5, size * 0.34, "#f59e0b", 0.18);
  drawGlowCloud(ctx, size * 0.5, size * 0.46, size * 0.16, "#ef4444", 0.11);
  drawShockwave(ctx, size * 0.5, size * 0.52, size * (0.12 + easeOut(impact) * 0.28), "#fde68a", 0.38);
  drawShockwave(ctx, size * 0.5, size * 0.52, size * (0.18 + easeOut(impact) * 0.2), "#ffffff", 0.16);
  drawBurst(ctx, size, rng, jackpotColors, impact, size * 0.5, size * 0.54, 72, ["circle", "spark"]);
  drawImpactText(ctx, "BINGO!", size * 0.5, size * 0.46, size * (0.22 + impact * 0.03), "#fff4c4", "#b45309", 0.98);
  const heroBalls = [
    { angle: -2.15, radius: 0.18, scale: 1.08, color: "#ef4444", label: "7" },
    { angle: -0.9, radius: 0.23, scale: 0.98, color: "#a855f7", label: "3" },
    { angle: 0.12, radius: 0.25, scale: 1.02, color: "#22d3ee", label: "8" },
    { angle: 1.24, radius: 0.18, scale: 1.16, color: "#fbbf24", label: "9" },
    { angle: 2.45, radius: 0.2, scale: 0.94, color: "#3b82f6", label: "1" },
  ];
  heroBalls.forEach((ball, index) => {
    const distance = size * (0.08 + easeOut(impact) * ball.radius);
    const bx = size * 0.5 + Math.cos(ball.angle + t * 0.12) * distance;
    const by = size * 0.54 + Math.sin(ball.angle + t * 0.12) * distance - easeOut(impact) * size * 0.08;
    drawBingoBallIcon(ctx, bx, by, ball.scale, ball.color, ball.label, 0.98);
    drawSpark(ctx, bx + (index % 2 === 0 ? -12 : 12), by - 10, 9 + (index % 2) * 2, "#ffffff", 0.62);
  });
  drawLensFlare(ctx, size * 0.5, size * 0.5, 0.88, "#ffffff", 0.6);
  ctx.restore();
};

const renderFlowersScene = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  drawGlowCloud(ctx, size * 0.5, size * 0.46, size * 0.28, "#f9a8d4", 0.14);
  drawGlowCloud(ctx, size * 0.5, size * 0.48, size * 0.14, "#fef3c7", 0.12);
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * TAU + t * 0.18;
    const px = size * 0.5 + Math.cos(angle) * size * 0.11;
    const py = size * 0.48 + Math.sin(angle) * size * 0.09;
    drawPetal(ctx, px, py, 1.22 + Math.sin(t * TAU * 1.8 + i) * 0.05, FLOWER_COLORS[i % FLOWER_COLORS.length], 0.88, angle);
  }
  drawGlowCloud(ctx, size * 0.5, size * 0.48, size * 0.06, "#ffffff", 0.26);
  for (let i = 0; i < 12; i += 1) {
    const phase = cycle(t * 0.2 + i * 0.08);
    const x = size * (-0.1 + phase * 1.2);
    const y = size * (0.18 + (i % 4) * 0.12 + Math.sin(phase * TAU * 1.4 + i) * 0.03);
    drawPetal(ctx, x, y, 0.5 + (i % 3) * 0.08, FLOWER_COLORS[(i + 2) % FLOWER_COLORS.length], 0.34, phase * TAU);
  }
  for (let i = 0; i < 6; i += 1) {
    const phase = cycle(t * 0.26 + i * 0.14);
    const x = size * (-0.12 + phase * 1.24);
    const y = size * (0.6 + ((i % 3) - 1) * 0.08);
    drawPetal(ctx, x, y, 1.02 + (i % 2) * 0.18, FLOWER_COLORS[i % FLOWER_COLORS.length], 0.52, phase * TAU * 0.8);
  }
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * TAU + t * 0.7;
    drawSpark(
      ctx,
      size * 0.5 + Math.cos(angle) * size * 0.18,
      size * 0.48 + Math.sin(angle) * size * 0.14,
      6 + (i % 2) * 2,
      "#ffffff",
      0.42,
    );
  }
  drawLensFlare(ctx, size * 0.5, size * 0.44, 0.62, "#ffffff", 0.28);
};

const renderThumbsUpScene = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  const pop = easeOut(clamp01(t * 1.8));
  drawGlowCloud(ctx, size * 0.5, size * 0.5, size * 0.26, "#3b82f6", 0.16);
  drawGlowCloud(ctx, size * 0.5, size * 0.46, size * 0.14, "#a855f7", 0.08);
  drawShockwave(ctx, size * 0.5, size * 0.56, size * (0.1 + pop * 0.14), "#ffffff", 0.16);
  drawBurst(ctx, size, rng, ["#3b82f6", "#22d3ee", "#a855f7", "#ffffff"], cycle(t * 1.18), size * 0.5, size * 0.56, 34, ["circle", "spark"]);
  const mainScale = 1 + pop * 0.38 + Math.sin(t * TAU * 3) * 0.04;
  drawThumb(ctx, size * 0.5, size * 0.56, mainScale * 1.7, "#60a5fa", 0.98, Math.sin(t * TAU) * 0.05);
  drawThumb(ctx, size * 0.3, size * 0.64, 0.78, "#c084fc", 0.58, -0.18);
  drawThumb(ctx, size * 0.7, size * 0.64, 0.78, "#22d3ee", 0.58, 0.18);
  drawImpactText(ctx, "+1", size * 0.5, size * 0.8, size * 0.11, "#ffffff", "#7c3aed", 0.88);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU + t * 0.72;
    drawSpark(
      ctx,
      size * 0.5 + Math.cos(angle) * size * 0.18,
      size * 0.56 + Math.sin(angle) * size * 0.14,
      8,
      i % 2 === 0 ? "#22d3ee" : "#ffffff",
      0.5,
    );
  }
};

const renderLeprechaunScene = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  drawGlowCloud(ctx, size * 0.5, size * 0.52, size * 0.3, "#22c55e", 0.16);
  drawGlowCloud(ctx, size * 0.5, size * 0.6, size * 0.18, "#fbbf24", 0.12);
  drawRainbow(ctx, size, t * 0.42);
  drawPotOfGold(ctx, size * 0.5, size * 0.76, 1.24 + Math.sin(t * TAU * 1.4) * 0.04, 0.98);
  drawBurst(ctx, size, rng, LUCKY_COLORS, cycle(t * 1.08), size * 0.5, size * 0.66, 42, ["circle", "spark"]);
  for (let i = 0; i < 10; i += 1) {
    const phase = cycle(t * 0.82 + i * 0.09);
    const arc = Math.sin(phase * Math.PI);
    const x = size * 0.5 + Math.cos(-1.08 + (i % 5) * 0.54) * arc * size * 0.18;
    const y = size * 0.74 - arc * size * (0.16 + (i % 2) * 0.04) + phase * size * 0.03;
    drawCoin(ctx, x, y, 0.48 + (i % 2) * 0.08, 0.72 + arc * 0.18, phase * TAU * 1.5);
  }
  for (let i = 0; i < 8; i += 1) {
    const phase = cycle(t * 0.24 + i * 0.11);
    const x = size * (0.18 + (i % 4) * 0.18 + Math.sin(phase * TAU) * 0.03);
    const y = size * (0.22 + (i % 2) * 0.14 + Math.cos(phase * TAU) * 0.04);
    drawShamrock(ctx, x, y, 0.34 + (i % 3) * 0.07, 0.48, phase * TAU * 0.7);
  }
  for (let i = 0; i < 3; i += 1) {
    const phase = cycle(t * 0.18 + i * 0.26);
    const x = size * (-0.08 + phase * 1.22);
    const y = size * (0.3 + i * 0.18);
    drawShamrock(ctx, x, y, 0.68 + (i % 2) * 0.12, 0.34, phase * TAU * 0.5);
  }
  drawLensFlare(ctx, size * 0.5, size * 0.6, 0.68, "#fde68a", 0.28);
};

const renderCountdownScene = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  const phase = clamp01(t) * 3;
  const stage = Math.min(2, Math.floor(phase));
  const local = phase - stage;
  const digit = ["3", "2", "1"][stage];
  const stageColors = [
    ["#a855f7", "#22d3ee", "#ffffff"],
    ["#ef4444", "#fb923c", "#ffffff"],
    ["#fbbf24", "#ffffff", "#ef4444"],
  ] as const;
  const activeColors = stageColors[stage];
  const pulse = 0.9 + easeOut(clamp01(local * 1.1)) * 0.32;
  const shake = size * (0.012 + stage * 0.006) * (1 - clamp01(local * 0.8));
  ctx.save();
  ctx.translate(Math.sin(t * TAU * 19) * shake, Math.cos(t * TAU * 13) * shake);
  drawGlowCloud(ctx, size * 0.5, size * 0.48, size * 0.28, activeColors[0], 0.16);
  drawShockwave(ctx, size * 0.5, size * 0.5, size * (0.1 + local * 0.18), activeColors[2], 0.36);
  drawBurst(ctx, size, rng, [...activeColors], clamp01(local * 1.08), size * 0.5, size * 0.52, 26 + stage * 12, ["spark", "circle"]);
  drawImpactText(ctx, digit, size * 0.5, size * 0.5, size * 0.34 * pulse, "#ffffff", stage === 2 ? "#b45309" : activeColors[0], 0.96);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU + local * 0.8;
    drawSpark(
      ctx,
      size * 0.5 + Math.cos(angle) * size * 0.2,
      size * 0.5 + Math.sin(angle) * size * 0.14,
      8,
      activeColors[i % activeColors.length],
      0.44,
    );
  }
  if (stage === 2) {
    drawLensFlare(ctx, size * 0.5, size * 0.5, 0.92 + local * 0.24, "#ffffff", 0.72);
    drawShockwave(ctx, size * 0.5, size * 0.5, size * (0.2 + local * 0.22), "#fde68a", 0.24);
    drawBurst(ctx, size, rng, ["#ffffff", "#fbbf24", "#fde68a", "#ef4444"], clamp01(local * 1.8), size * 0.5, size * 0.52, 118, ["spark", "circle", "rect"]);
  }
  ctx.restore();
};

const renderTriviaTimeScene = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  drawGlowCloud(ctx, size * 0.5, size * 0.45, size * 0.32, "#22d3ee", 0.12);
  drawGlowCloud(ctx, size * 0.5, size * 0.5, size * 0.16, "#a855f7", 0.1);
  drawSpotlightCone(ctx, size * 0.2, size * 0.98, size * 0.16, size * 0.6, "#22d3ee", 0.16, -0.24);
  drawSpotlightCone(ctx, size * 0.8, size * 0.98, size * 0.16, size * 0.6, "#a855f7", 0.16, 0.24);
  ctx.save();
  ctx.fillStyle = "rgba(12, 18, 42, 0.58)";
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 4;
  roundRect(ctx, size * 0.2, size * 0.24, size * 0.6, size * 0.38, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 3; i += 1) {
    const phase = cycle(t * 0.7 + i * 0.22);
    const qx = size * (0.28 + i * 0.22);
    const qy = size * (0.3 + Math.sin(phase * TAU) * 0.06 + (i % 2) * 0.12);
    drawQuestionMark(ctx, qx, qy, size * (0.11 + i * 0.015), i % 2 === 0 ? "#22d3ee" : "#a855f7", 0.38 + (1 - phase) * 0.24);
  }
  drawQuestionMark(ctx, size * 0.5, size * 0.45, size * 0.28, "#ffffff", 0.94);
  for (let i = 0; i < 8; i += 1) {
    drawGlowCloud(ctx, size * (0.3 + i * 0.05), size * 0.24, size * 0.011, i % 2 === 0 ? "#fbbf24" : "#ffffff", 0.48);
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU + t * 0.6;
    drawSpark(
      ctx,
      size * 0.5 + Math.cos(angle) * size * 0.16,
      size * 0.46 + Math.sin(angle) * size * 0.18,
      7,
      i % 2 === 0 ? "#22d3ee" : "#ffffff",
      0.4,
    );
  }
};

const renderHappyBirthdayScene = (ctx: CanvasRenderingContext2D, size: number, t: number, rng: () => number) => {
  drawGlowCloud(ctx, size * 0.5, size * 0.48, size * 0.34, "#f472b6", 0.14);
  drawGlowCloud(ctx, size * 0.5, size * 0.52, size * 0.24, "#fbbf24", 0.12);
  drawFalling(ctx, size, rng, PARTY_COLORS, t, 60, "rect");
  drawBurst(ctx, size, rng, PARTY_COLORS, cycle(t * 1.06), size * 0.5, size * 0.42, 52, ["rect", "star"]);
  drawRising(ctx, size, rng, ["#f472b6", "#22d3ee", "#fbbf24", "#a855f7"], t, 4, (x, y, s, c, a) => drawBalloon(ctx, x, y, s, c, a));
  drawBirthdayCake(ctx, size * 0.5, size * 0.72, 1.02, 0.98);
  for (let i = 0; i < 5; i += 1) {
    drawBirthdayCandle(ctx, size * (0.32 + i * 0.09), size * 0.57 + Math.sin(t * TAU * 2 + i) * 5, 0.88, PARTY_COLORS[i % PARTY_COLORS.length], 0.94);
  }
  for (let i = 0; i < 8; i += 1) {
    const phase = cycle(t * 0.58 + i * 0.1);
    drawSpark(ctx, size * (0.22 + i * 0.055), size * (0.2 + Math.sin(phase * TAU) * 0.05), 7 + (i % 2) * 2, "#ffffff", 0.48);
  }
  drawLensFlare(ctx, size * 0.5, size * 0.48, 0.84, "#ffffff", 0.66);
};

export const renderEffectFrame = (ctx: CanvasRenderingContext2D, id: CelebrationId, size: number, t: number) => {
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const key = normalizeCelebrationKey(id);
  const rng = createRng(seedFromText(key));
  const winkBeat = CORE_WINK_KEYS.has(key) ? createWinkBeat(t) : null;
  const sceneTime = winkBeat?.renderTime ?? t;

  ctx.save();
  ctx.globalAlpha = winkBeat?.visibleAlpha ?? 1;

  switch (key) {
    case "celebration":
      renderCelebrationScene(ctx, size, sceneTime, rng);
      break;
    case "bingo":
      renderBingoScene(ctx, size, sceneTime, rng);
      break;
    case "flowers":
      renderFlowersScene(ctx, size, sceneTime, rng);
      break;
    case "thumbs-up":
      renderThumbsUpScene(ctx, size, sceneTime, rng);
      break;
    case "leprechaun":
      renderLeprechaunScene(ctx, size, sceneTime, rng);
      break;
    case "countdown":
      renderCountdownScene(ctx, size, sceneTime, rng);
      break;
    case "trivia-time":
      renderTriviaTimeScene(ctx, size, sceneTime, rng);
      break;
    case "happy-birthday":
    case "happy":
      renderHappyBirthdayScene(ctx, size, sceneTime, rng);
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

  ctx.restore();
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
  durationMs?: number;
  timeScale?: number;
};

type ExportPlayback = {
  stop: () => void;
};

const OVERLAY_PALETTE = ["#ff4ecd", "#a855f7", "#3b82f6", "#22d3ee", "#fbbf24", "#fb923c", "#22c55e"];
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif';

const OVERLAY_DURATIONS: Partial<Record<CelebrationId, number>> = {
  celebration: 4200,
  bingo: 4800,
  "bingo!": 4800,
  flowers: 5200,
  "thumbs-up": 3600,
  "thumbs up": 3600,
  leprechaun: 5000,
  countdown: 3400,
  "trivia-time": 3800,
  "trivia time": 3800,
  "happy-birthday": 4400,
  "happy birthday": 4400,
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
  celebration: 4200,
  bingo: 4800,
  "bingo!": 4800,
  flowers: 3600,
  "thumbs-up": 3200,
  "thumbs up": 3200,
  leprechaun: 4200,
  countdown: 3600,
  "trivia-time": 3200,
  "trivia time": 3200,
  "happy-birthday": 4600,
  "happy birthday": 4600,
  fireworks: 3300,
  emojis: 2600,
  happy: 4600,
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

const getExportDurationMs = (id: CelebrationId) => {
  const key = normalizeCelebrationKey(id);
  if (CORE_WINK_KEYS.has(key)) {
    return WINK_DURATION_MS;
  }
  return Math.max(OVERLAY_DURATIONS[key as CelebrationId] ?? 0, CONFETTI_DURATIONS[key as CelebrationId] ?? 0) || 3000;
};

const finalizeWinkOverlayScene = (key: string, scene: OverlayScene): OverlayScene => {
  if (!CORE_WINK_KEYS.has(key)) {
    return scene;
  }

  const baseDuration = Math.max(
    OVERLAY_DURATIONS[key as CelebrationId] ?? 0,
    CONFETTI_DURATIONS[key as CelebrationId] ?? 0,
    3000,
  );

  return {
    ...scene,
    durationMs: WINK_DURATION_MS,
    timeScale: baseDuration / WINK_DURATION_MS,
  };
};

const createOverlayScene = (id: CelebrationId): OverlayScene => {
  const key = normalizeCelebrationKey(id);
  const rng = createRng(seedFromText(`${key}-overlay`));
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

  if (key === "celebration") {
    return finalizeWinkOverlayScene(key, {
      mode: "falling",
      items: make(28, { colors: PARTY_COLORS, size: 7, duration: 3.1 }),
      flashes: [{ start: 0.08, duration: 0.22, variant: "neon" }],
    });
  }

  if (key === "bingo") {
    return finalizeWinkOverlayScene(key, {
      mode: "twinkle",
      items: make(10, { emojis: ["7", "8", "3", "9", "!"], size: 18, duration: 0 }),
      flashes: [{ start: 0.02, duration: 0.2, variant: "white" }, { start: 0.5, duration: 0.24, variant: "neon" }],
    });
  }

  if (key === "flowers") {
    return finalizeWinkOverlayScene(key, { mode: "rising", items: make(16, { colors: FLOWER_COLORS, size: 9, duration: 4.8 }), flashes: [] });
  }

  if (key === "thumbs-up") {
    return finalizeWinkOverlayScene(key, {
      mode: "twinkle",
      items: make(8, { emojis: ["+1", "OK"], size: 22, duration: 0 }),
      flashes: [{ start: 0.05, duration: 0.18, variant: "neon" }],
    });
  }

  if (key === "leprechaun") {
    return finalizeWinkOverlayScene(key, {
      mode: "rising",
      items: make(16, { colors: LUCKY_COLORS, size: 10, duration: 4.2 }),
      flashes: [{ start: 0.12, duration: 0.2, variant: "neon" }],
    });
  }

  if (key === "countdown") {
    return finalizeWinkOverlayScene(key, {
      mode: "none",
      items: [],
      flashes: [
        { start: 0.2, duration: 0.16, variant: "white" },
        { start: 1.2, duration: 0.16, variant: "white" },
        { start: 2.2, duration: 0.24, variant: "white" },
      ],
    });
  }

  if (key === "trivia-time") {
    return finalizeWinkOverlayScene(key, {
      mode: "twinkle",
      items: make(10, { emojis: ["?"], size: 28, duration: 0 }),
      flashes: [{ start: 0.05, duration: 0.24, variant: "neon" }],
    });
  }

  if (key === "happy-birthday") {
    return finalizeWinkOverlayScene(key, {
      mode: "rising",
      items: make(18, { colors: PARTY_COLORS, size: 8, duration: 4.6 }),
      flashes: [{ start: 0.06, duration: 0.18, variant: "white" }],
    });
  }

  switch (key) {
    case "celebration":
      return { mode: "falling", items: make(64, { colors: PARTY_COLORS, size: 8, duration: 3.4 }), flashes: [{ start: 0.08, duration: 0.26, variant: "neon" }] };
    case "bingo":
      return {
        mode: "falling",
        items: make(36, { emojis: ["7", "8", "3", "9", "!", "●"], size: 22, duration: 3.8 }),
        flashes: [{ start: 0.02, duration: 0.2, variant: "white" }, { start: 0.5, duration: 0.24, variant: "neon" }],
      };
    case "flowers":
      return { mode: "rising", items: make(32, { emojis: ["✿", "❀", "❁", "✾"], size: 22, duration: 4.6 }), flashes: [] };
    case "thumbs-up":
      return { mode: "twinkle", items: make(22, { emojis: ["👍", "✨", "+1"], size: 26, duration: 0 }), flashes: [{ start: 0.05, duration: 0.18, variant: "neon" }] };
    case "leprechaun":
      return { mode: "falling", items: make(28, { emojis: ["🍀", "🌈", "💰"], size: 24, duration: 4.2 }), flashes: [{ start: 0.12, duration: 0.24, variant: "neon" }] };
    case "countdown":
      return { mode: "none", items: [], flashes: [{ start: 0.2, duration: 0.16, variant: "white" }, { start: 1.2, duration: 0.16, variant: "white" }, { start: 2.2, duration: 0.24, variant: "white" }] };
    case "trivia-time":
      return { mode: "twinkle", items: make(18, { emojis: ["?", "❓", "✦"], size: 30, duration: 0 }), flashes: [{ start: 0.05, duration: 0.3, variant: "neon" }] };
    case "happy-birthday":
      return { mode: "rising", items: make(28, { emojis: ["🎂", "🎈", "✨"], size: 28, duration: 4.6 }), flashes: [{ start: 0.06, duration: 0.22, variant: "white" }] };
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

const drawFlash = (ctx: CanvasRenderingContext2D, size: number, flash: OverlayFlash, seconds: number, alphaMultiplier = 1) => {
  const local = (seconds - flash.start) / flash.duration;
  if (local < 0 || local > 1) return;

  const alpha = local < 0.2 ? local / 0.2 : 1 - (local - 0.2) / 0.8;
  ctx.save();
  ctx.globalAlpha = clamp01(alpha) * alphaMultiplier;
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
  const seconds = (elapsedMs / 1000) * (scene.timeScale ?? 1);
  const beat = scene.durationMs ? createWinkBeat(elapsedMs / scene.durationMs) : null;
  const alphaMultiplier = beat?.visibleAlpha ?? 1;
  scene.flashes.forEach((flash) => drawFlash(ctx, size, flash, seconds, alphaMultiplier));

  for (const item of scene.items) {
    const x0 = (item.left / 100) * size;
    const delayed = seconds - item.delay;

    if (scene.mode === "twinkle") {
      if (delayed < 0) continue;
      const pulse = (1 - Math.cos((delayed / item.twinkleDuration) * TAU)) / 2;
      const scale = 1 + pulse * 0.4;
      const alpha = (1 - pulse * 0.4) * alphaMultiplier;
      drawOverlayItem(ctx, item, x0, (item.top / 100) * size, alpha, scale, Math.PI * pulse);
      continue;
    }

    const progress = delayed / item.duration;
    if (progress < 0 || progress > 1) continue;

    const eased = clamp01(progress);
    const x = x0 + (item.drift / 320) * size * eased;
    const rotation = (item.rotation * Math.PI / 180) * eased;
    const alpha = clamp01(1 - eased) * alphaMultiplier;
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
  const key = normalizeCelebrationKey(id);
  const rng = createRng(seedFromText(`${key}-confetti`));
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

  if (key === "celebration") {
    fireConfetti({ particleCount: 92, colors: PARTY_COLORS, spread: 112, scalar: 1.1 });
    schedule(() => fireConfetti({ particleCount: 64, colors: PARTY_COLORS, spread: 126, scalar: 1.02 }), 360);
  } else if (key === "bingo") {
    fireConfetti({ particleCount: 84, colors: GOLD_COLORS, shapes: ["circle"], scalar: 1.2, startVelocity: 42 });
    triggerEmojiConfetti(["7", "8", "3", "9", "!"]);
    schedule(() => fireConfetti({ particleCount: 56, colors: ["#fbbf24", "#fde68a", "#ffffff"], shapes: ["circle"], scalar: 1.22, spread: 92 }), 320);
  } else if (key === "flowers") {
    fireConfetti({ particleCount: 42, colors: FLOWER_COLORS, spread: 86, startVelocity: 22, scalar: 0.9 });
    schedule(() => fireConfetti({ particleCount: 28, colors: ["#ffffff", "#f9a8d4", "#fbcfe8"], spread: 72, startVelocity: 18, scalar: 0.82 }), 220);
  } else if (key === "thumbs-up") {
    fireConfetti({ particleCount: 40, colors: ["#60a5fa", "#22d3ee", "#c084fc", "#ffffff"], scalar: 0.96, spread: 68 });
    triggerEmojiConfetti(["+1", "OK"]);
  } else if (key === "leprechaun") {
    fireConfetti({ particleCount: 54, colors: LUCKY_COLORS, scalar: 1.02, spread: 82 });
    schedule(() => rainbowConfetti(), 240);
  } else if (key === "countdown") {
    schedule(() => fireConfetti({ particleCount: 18, colors: ["#ffffff"], startVelocity: 28 }), 0);
    schedule(() => fireConfetti({ particleCount: 18, colors: ["#ffffff"], startVelocity: 28 }), 900);
    schedule(() => fireConfetti({ particleCount: 90, colors: ["#ffffff", "#fde68a", "#fbbf24"], startVelocity: 50, spread: 138, scalar: 1.2 }), 1800);
  } else if (key === "trivia-time") {
    fireConfetti({ particleCount: 24, colors: ["#22d3ee", "#a855f7", "#ffffff"], shapes: ["square"], scalar: 0.96, spread: 68 });
    triggerEmojiConfetti(["?"]);
  } else if (key === "happy-birthday") {
    fireConfetti({ particleCount: 72, colors: PARTY_COLORS, scalar: 1.04, spread: 106 });
    schedule(() => fireConfetti({ particleCount: 36, colors: PARTY_COLORS, scalar: 0.9, spread: 120 }), 280);
  } else {

  switch (key) {
    case "celebration":
      fireConfetti({ particleCount: 140, colors: PARTY_COLORS, spread: 126, scalar: 1.18 });
      triggerEmojiConfetti(["🎉", "🎊", "✨"]);
      schedule(() => fireConfetti({ particleCount: 90, colors: PARTY_COLORS, spread: 136, scalar: 1.08 }), 420);
      break;
    case "bingo":
      fireConfetti({ particleCount: 120, colors: GOLD_COLORS, shapes: ["circle"], scalar: 1.25, startVelocity: 42 });
      triggerEmojiConfetti(["7", "8", "3", "9", "!"]);
      schedule(() => fireConfetti({ particleCount: 90, colors: ["#fbbf24", "#fde68a", "#ffffff"], shapes: ["circle"], scalar: 1.3, spread: 96 }), 320);
      break;
    case "flowers":
      triggerEmojiConfetti(["🌸", "🌼", "✨"]);
      break;
    case "thumbs-up":
      fireConfetti({ particleCount: 56, colors: ["#60a5fa", "#22d3ee", "#c084fc", "#ffffff"], scalar: 1.02 });
      triggerEmojiConfetti(["👍", "✨", "+1"]);
      break;
    case "leprechaun":
      fireConfetti({ particleCount: 72, colors: LUCKY_COLORS, scalar: 1.08 });
      triggerEmojiConfetti(["🍀", "🌈", "💰"]);
      schedule(() => rainbowConfetti(), 240);
      break;
    case "countdown":
      schedule(() => fireConfetti({ particleCount: 24, colors: ["#ffffff"], startVelocity: 28 }), 0);
      schedule(() => fireConfetti({ particleCount: 24, colors: ["#ffffff"], startVelocity: 28 }), 900);
      schedule(() => fireConfetti({ particleCount: 120, colors: ["#ffffff", "#fde68a", "#fbbf24"], startVelocity: 50, spread: 144, scalar: 1.3 }), 1800);
      break;
    case "trivia-time":
      fireConfetti({ particleCount: 36, colors: ["#22d3ee", "#a855f7", "#ffffff"], shapes: ["square"], scalar: 1.02 });
      triggerEmojiConfetti(["?", "❓", "✦"]);
      break;
    case "happy-birthday":
      fireConfetti({ particleCount: 96, colors: PARTY_COLORS, scalar: 1.12 });
      triggerEmojiConfetti(["🎂", "🎈", "✨"]);
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
  const key = normalizeCelebrationKey(id);
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

  switch (key) {
    case "celebration":
    case "confetti-cannon":
      partyHorn();
      fireworks();
      break;
    case "bingo":
      partyHorn();
      fireworks();
      thunder(0.18);
      [523, 659, 784, 988].forEach((f, i) => tone(f, 0.18, "square", 0.18, i * 0.08));
      break;
    case "flowers":
      [698, 880, 1047, 1319].forEach((f, i) => tone(f, 0.22, "triangle", 0.12, i * 0.08));
      sparkle();
      break;
    case "thumbs-up":
      sweep(340, 900, 0.16, "square", 0.16);
      [988, 1175, 1319].forEach((f, i) => tone(f, 0.12, "triangle", 0.12, i * 0.05));
      applause();
      break;
    case "leprechaun":
      [440, 554, 659, 880].forEach((f, i) => tone(f, 0.14, "triangle", 0.13, i * 0.07));
      golden();
      break;
    case "countdown":
      drumroll();
      thunder(1.5);
      break;
    case "trivia-time":
      neon();
      [880, 1175, 1568].forEach((f, i) => tone(f, 0.12, "square", 0.11, i * 0.07));
      break;
    case "happy-birthday":
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, "triangle", 0.16, i * 0.08));
      fireworks();
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
