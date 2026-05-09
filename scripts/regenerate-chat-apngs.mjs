import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const WIDTH = 768;
const HEIGHT = 1024;
const FRAME_COUNT = 28;
const FRAME_DELAY_MS = 42;
const TAU = Math.PI * 2;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + ((b - a) * t);
const mod01 = (value) => ((value % 1) + 1) % 1;
const easeOutCubic = (t) => 1 - ((1 - t) ** 3);
const easeOutQuad = (t) => 1 - ((1 - t) ** 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + (c3 * ((t - 1) ** 3)) + (c1 * ((t - 1) ** 2));
};
const triangleWave = (value) => 1 - Math.abs((mod01(value) * 2) - 1);

const hexToRgb = (hex) => {
  const clean = hex.replace("#", "");
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
};

const createRng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pointToSegmentDistance = (px, py, ax, ay, bx, by) => {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = (abx * abx) + (aby * aby);
  if (abLenSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = clamp((((px - ax) * abx) + ((py - ay) * aby)) / abLenSq);
  const cx = ax + (abx * t);
  const cy = ay + (aby * t);
  return Math.hypot(px - cx, py - cy);
};

const putPixel = (buffer, x, y, color, alpha) => {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || alpha <= 0) return;

  const index = (y * WIDTH + x) * 4;
  const srcAlpha = clamp(alpha);
  const dstAlpha = buffer[index + 3] / 255;
  const outAlpha = srcAlpha + (dstAlpha * (1 - srcAlpha));
  if (outAlpha <= 0) return;

  buffer[index] = Math.round(
    ((color.r * srcAlpha) + (buffer[index] * dstAlpha * (1 - srcAlpha))) / outAlpha,
  );
  buffer[index + 1] = Math.round(
    ((color.g * srcAlpha) + (buffer[index + 1] * dstAlpha * (1 - srcAlpha))) / outAlpha,
  );
  buffer[index + 2] = Math.round(
    ((color.b * srcAlpha) + (buffer[index + 2] * dstAlpha * (1 - srcAlpha))) / outAlpha,
  );
  buffer[index + 3] = Math.round(outAlpha * 255);
};

const alphaFromSignedDistance = (signedDistance, feather = 1.25) => {
  if (signedDistance <= -feather) return 1;
  if (signedDistance >= feather) return 0;
  return clamp((feather - signedDistance) / (feather * 2));
};

const drawCircle = (buffer, cx, cy, radius, color, alpha = 1, feather = 1.4) => {
  const minX = Math.max(0, Math.floor(cx - radius - feather));
  const maxX = Math.min(WIDTH - 1, Math.ceil(cx + radius + feather));
  const minY = Math.max(0, Math.floor(cy - radius - feather));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(cy + radius + feather));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x - cx, y - cy) - radius;
      const coverage = alphaFromSignedDistance(distance, feather);
      if (coverage > 0) putPixel(buffer, x, y, color, coverage * alpha);
    }
  }
};

const drawRing = (buffer, cx, cy, radius, width, color, alpha = 1, feather = 1.2) => {
  const minX = Math.max(0, Math.floor(cx - radius - width - feather));
  const maxX = Math.min(WIDTH - 1, Math.ceil(cx + radius + width + feather));
  const minY = Math.max(0, Math.floor(cy - radius - width - feather));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(cy + radius + width + feather));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.abs(Math.hypot(x - cx, y - cy) - radius) - (width * 0.5);
      const coverage = alphaFromSignedDistance(distance, feather);
      if (coverage > 0) putPixel(buffer, x, y, color, coverage * alpha);
    }
  }
};

const drawCapsule = (buffer, ax, ay, bx, by, radius, color, alpha = 1, feather = 1.15) => {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius - feather));
  const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(ax, bx) + radius + feather));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius - feather));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(ay, by) + radius + feather));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = pointToSegmentDistance(x, y, ax, ay, bx, by) - radius;
      const coverage = alphaFromSignedDistance(distance, feather);
      if (coverage > 0) putPixel(buffer, x, y, color, coverage * alpha);
    }
  }
};

const drawRotatedRect = (buffer, cx, cy, width, height, angle, color, alpha = 1, feather = 1.1) => {
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const radius = Math.hypot(halfW, halfH);
  const minX = Math.max(0, Math.floor(cx - radius - feather));
  const maxX = Math.min(WIDTH - 1, Math.ceil(cx + radius + feather));
  const minY = Math.max(0, Math.floor(cy - radius - feather));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(cy + radius + feather));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const localX = ((x - cx) * cos) + ((y - cy) * sin);
      const localY = ((y - cy) * cos) - ((x - cx) * sin);
      const dx = Math.abs(localX) - halfW;
      const dy = Math.abs(localY) - halfH;
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
      const inside = Math.min(Math.max(dx, dy), 0);
      const signedDistance = outside + inside;
      const coverage = alphaFromSignedDistance(signedDistance, feather);
      if (coverage > 0) putPixel(buffer, x, y, color, coverage * alpha);
    }
  }
};

const drawDiamond = (buffer, cx, cy, size, angle, color, alpha = 1) => {
  drawRotatedRect(buffer, cx, cy, size, size, angle + (Math.PI / 4), color, alpha, 1.05);
};

const drawHeartFill = (buffer, cx, cy, size, color, alpha = 1) => {
  const range = Math.ceil(size * 0.62);
  const minX = Math.max(0, Math.floor(cx - range));
  const maxX = Math.min(WIDTH - 1, Math.ceil(cx + range));
  const minY = Math.max(0, Math.floor(cy - range));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(cy + range));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const nx = (x - cx) / (size * 0.5);
      const ny = (y - cy) / (size * 0.5);
      const eq = (((nx * nx) + (ny * ny) - 1) ** 3) - (nx * nx * ny ** 3);
      if (eq <= 0) {
        const edge = clamp((0.06 - eq) / 0.12);
        putPixel(buffer, x, y, color, alpha * (0.45 + (edge * 0.55)));
      }
    }
  }
};

const drawGlossyHeart = (buffer, cx, cy, size, color, alpha = 1) => {
  drawHeartFill(buffer, cx, cy, size, color, alpha);
  drawHeartFill(buffer, cx - (size * 0.08), cy - (size * 0.1), size * 0.56, hexToRgb("#ffffff"), alpha * 0.18);
  drawHeartFill(buffer, cx, cy, size + 2.6, hexToRgb("#fff0c9"), alpha * 0.08);
};

const drawSpark = (buffer, cx, cy, size, color, alpha = 1) => {
  drawCircle(buffer, cx, cy, Math.max(2.6, size * 0.54), color, alpha * 0.1);
  drawCircle(buffer, cx, cy, Math.max(1.8, size * 0.3), color, alpha * 0.16);
  drawCapsule(buffer, cx - size, cy, cx + size, cy, Math.max(1.1, size * 0.12), color, alpha * 0.92);
  drawCapsule(buffer, cx, cy - size, cx, cy + size, Math.max(1.1, size * 0.12), color, alpha * 0.92);
  drawCapsule(
    buffer,
    cx - (size * 0.6),
    cy - (size * 0.6),
    cx + (size * 0.6),
    cy + (size * 0.6),
    Math.max(0.8, size * 0.08),
    color,
    alpha * 0.6,
  );
  drawCapsule(
    buffer,
    cx - (size * 0.6),
    cy + (size * 0.6),
    cx + (size * 0.6),
    cy - (size * 0.6),
    Math.max(0.8, size * 0.08),
    color,
    alpha * 0.6,
  );
  drawCircle(buffer, cx, cy, Math.max(1.2, size * 0.14), color, alpha);
  drawCircle(buffer, cx, cy, Math.max(1.1, size * 0.12), hexToRgb("#fff6d7"), alpha * 0.22);
  drawCircle(buffer, cx, cy, Math.max(0.8, size * 0.08), hexToRgb("#ffffff"), alpha * 0.72);
};

const drawTrailDots = (
  buffer,
  fromX,
  fromY,
  toX,
  toY,
  count,
  size,
  color,
  alpha = 1,
  taper = 0.72,
) => {
  for (let step = 0; step < count; step += 1) {
    const t = count <= 1 ? 1 : step / (count - 1);
    const radius = size * (1 - (t * taper));
    drawCircle(
      buffer,
      mix(fromX, toX, t),
      mix(fromY, toY, t),
      radius,
      color,
      alpha * (1 - (t * 0.78)),
    );
    if (step < Math.max(2, Math.floor(count * 0.45))) {
      drawCircle(
        buffer,
        mix(fromX, toX, t),
        mix(fromY, toY, t),
        Math.max(0.8, radius * 0.44),
        hexToRgb("#ffffff"),
        alpha * (0.12 - (t * 0.08)),
      );
    }
  }
};

const drawShockwave = (buffer, cx, cy, radius, color, alpha = 1) => {
  drawRing(buffer, cx, cy, radius, Math.max(3.4, radius * 0.042), color, alpha * 0.4);
  drawRing(buffer, cx, cy, radius * 0.94, Math.max(2.8, radius * 0.03), color, alpha * 0.16);
  drawRing(buffer, cx, cy, radius * 0.86, Math.max(2.2, radius * 0.026), hexToRgb("#ffffff"), alpha * 0.16);
  drawRing(buffer, cx, cy, radius * 1.1, Math.max(1.8, radius * 0.022), color, alpha * 0.08);
};

const drawCoin = (buffer, cx, cy, radius, alpha = 1, rotation = 0) => {
  const gold = hexToRgb("#f5c65b");
  const shadow = hexToRgb("#b98115");
  drawCircle(buffer, cx, cy, radius * 1.42, gold, alpha * 0.09);
  drawCircle(buffer, cx, cy, radius * 1.16, gold, alpha * 0.1);
  drawCircle(buffer, cx, cy, radius, gold, alpha);
  drawRing(buffer, cx, cy, radius * 0.78, Math.max(2, radius * 0.16), shadow, alpha * 0.55);
  drawRing(buffer, cx, cy, radius * 0.94, Math.max(1.4, radius * 0.08), hexToRgb("#fff2c1"), alpha * 0.72);
  drawCapsule(
    buffer,
    cx - (Math.cos(rotation) * radius * 0.22),
    cy - (Math.sin(rotation) * radius * 0.22),
    cx + (Math.cos(rotation) * radius * 0.22),
    cy + (Math.sin(rotation) * radius * 0.22),
    Math.max(1, radius * 0.08),
    shadow,
    alpha * 0.72,
  );
  drawCapsule(
    buffer,
    cx + (Math.sin(rotation) * radius * 0.15),
    cy - (Math.cos(rotation) * radius * 0.15),
    cx - (Math.sin(rotation) * radius * 0.15),
    cy + (Math.cos(rotation) * radius * 0.15),
    Math.max(1, radius * 0.08),
    shadow,
    alpha * 0.72,
  );
  drawCircle(buffer, cx - (radius * 0.22), cy - (radius * 0.24), radius * 0.16, hexToRgb("#fff6db"), alpha * 0.44);
  drawCircle(buffer, cx + (radius * 0.18), cy + (radius * 0.12), radius * 0.08, hexToRgb("#fffef1"), alpha * 0.24);
};

const SEGMENTS = {
  a: [[-0.18, -0.48], [0.18, -0.48]],
  b: [[0.23, -0.4], [0.23, -0.04]],
  c: [[0.23, 0.04], [0.23, 0.4]],
  d: [[-0.18, 0.48], [0.18, 0.48]],
  e: [[-0.23, 0.04], [-0.23, 0.4]],
  f: [[-0.23, -0.4], [-0.23, -0.04]],
  g: [[-0.18, 0], [0.18, 0]],
};

const DIGIT_SEGMENTS = {
  0: ["a", "b", "c", "d", "e", "f"],
  1: ["b", "c"],
  2: ["a", "b", "g", "e", "d"],
  3: ["a", "b", "g", "c", "d"],
  4: ["f", "g", "b", "c"],
  5: ["a", "f", "g", "c", "d"],
  6: ["a", "f", "g", "c", "d", "e"],
  7: ["a", "b", "c"],
  8: ["a", "b", "c", "d", "e", "f", "g"],
  9: ["a", "b", "c", "d", "f", "g"],
};

const drawDigit = (buffer, cx, cy, size, digit, color, alpha = 1) => {
  const segments = DIGIT_SEGMENTS[digit] ?? DIGIT_SEGMENTS[8];
  for (const name of segments) {
    const [from, to] = SEGMENTS[name];
    drawCapsule(
      buffer,
      cx + (from[0] * size),
      cy + (from[1] * size),
      cx + (to[0] * size),
      cy + (to[1] * size),
      Math.max(1.1, size * 0.06),
      color,
      alpha,
      1,
    );
  }
};

const drawBingoBall = (buffer, cx, cy, radius, bodyColor, digit, alpha = 1) => {
  drawCircle(buffer, cx, cy, radius * 1.42, bodyColor, alpha * 0.08);
  drawCircle(buffer, cx, cy, radius * 1.18, bodyColor, alpha * 0.1);
  drawCircle(buffer, cx, cy, radius, bodyColor, alpha);
  drawRing(buffer, cx, cy, radius * 0.92, Math.max(2, radius * 0.08), hexToRgb("#fffdf5"), alpha * 0.65);
  drawCircle(buffer, cx - (radius * 0.22), cy - (radius * 0.24), radius * 0.18, hexToRgb("#ffffff"), alpha * 0.24);
  drawCircle(buffer, cx, cy, radius * 0.44, hexToRgb("#ffffff"), alpha * 0.94);
  drawRing(buffer, cx, cy, radius * 0.44, Math.max(1.6, radius * 0.06), bodyColor, alpha * 0.6);
  drawDigit(buffer, cx, cy, radius * 0.92, digit, hexToRgb("#141414"), alpha * 0.9);
  drawCircle(buffer, cx + (radius * 0.14), cy + (radius * 0.18), radius * 0.08, hexToRgb("#fffef6"), alpha * 0.16);
};

const drawConfettiSprite = (buffer, x, y, width, height, rotation, type, color, alpha = 1) => {
  if (type === "diamond") {
    drawDiamond(buffer, x, y, width, rotation, color, alpha);
    drawDiamond(buffer, x, y, Math.max(2, width * 0.38), rotation, hexToRgb("#ffffff"), alpha * 0.18);
    return;
  }

  drawRotatedRect(buffer, x, y, width, height, rotation, color, alpha);
  drawCapsule(
    buffer,
    x - (Math.cos(rotation) * width * 0.18),
    y - (Math.sin(rotation) * width * 0.18),
    x + (Math.cos(rotation) * width * 0.18),
    y + (Math.sin(rotation) * width * 0.18),
    0.8,
    hexToRgb("#ffffff"),
    alpha * 0.38,
  );
};

const drawBurstRays = (buffer, cx, cy, radius, rayCount, color, accent, alpha = 1, phase = 0, widthBoost = 1) => {
  for (let ray = 0; ray < rayCount; ray += 1) {
    const angle = ((ray / rayCount) * TAU) + phase;
    const jitter = 0.8 + (0.28 * Math.sin((ray * 1.9) + (phase * 6)));
    const outerX = cx + (Math.cos(angle) * radius * jitter);
    const outerY = cy + (Math.sin(angle) * radius * jitter);
    const innerX = cx + (Math.cos(angle) * radius * 0.14);
    const innerY = cy + (Math.sin(angle) * radius * 0.14);
    drawCapsule(buffer, innerX, innerY, outerX, outerY, (ray % 4 === 0 ? 4.4 : 3.1) * widthBoost, color, alpha * 0.98);
    drawCapsule(buffer, innerX, innerY, outerX, outerY, 1.24 * widthBoost, accent, alpha * 0.94);
    drawCapsule(buffer, cx + (Math.cos(angle) * radius * 0.18), cy + (Math.sin(angle) * radius * 0.18), cx + (Math.cos(angle) * radius * 0.72), cy + (Math.sin(angle) * radius * 0.72), 0.9 * widthBoost, accent, alpha * 0.24);
    drawCapsule(buffer, cx + (Math.cos(angle) * radius * 0.22), cy + (Math.sin(angle) * radius * 0.22), cx + (Math.cos(angle) * radius * 0.9), cy + (Math.sin(angle) * radius * 0.9), 0.54 * widthBoost, hexToRgb("#ffffff"), alpha * 0.16);
    drawTrailDots(buffer, innerX, innerY, outerX, outerY, 4, 2.8 * widthBoost, accent, alpha * 0.16);
    drawCircle(buffer, outerX, outerY, 2.4 + ((ray % 4) * 0.6), accent, alpha * 0.94);
  }
};

const drawLuckyClover = (buffer, cx, cy, size, color, alpha = 1) => {
  const petalSize = size * 0.48;
  drawGlossyHeart(buffer, cx - (size * 0.22), cy - (size * 0.16), petalSize, color, alpha);
  drawGlossyHeart(buffer, cx + (size * 0.22), cy - (size * 0.16), petalSize, color, alpha);
  drawGlossyHeart(buffer, cx - (size * 0.18), cy + (size * 0.2), petalSize, color, alpha);
  drawGlossyHeart(buffer, cx + (size * 0.18), cy + (size * 0.2), petalSize, color, alpha);
  drawCapsule(buffer, cx + (size * 0.08), cy + (size * 0.34), cx + (size * 0.34), cy + (size * 0.82), Math.max(1.2, size * 0.06), hexToRgb("#5fe58e"), alpha * 0.72);
  drawSpark(buffer, cx, cy, Math.max(4, size * 0.16), hexToRgb("#fff8d7"), alpha * 0.34);
};

const drawThumbsUp = (buffer, cx, cy, size, palette, alpha = 1, tilt = 0, mirror = false) => {
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const mirrorScale = mirror ? -1 : 1;
  const point = (lx, ly) => {
    const mx = lx * mirrorScale;
    return [
      cx + (mx * cos) - (ly * sin),
      cy + (mx * sin) + (ly * cos),
    ];
  };
  const angle = mirror ? -tilt : tilt;
  const handColor = palette.hand;
  const cuffColor = palette.cuff;
  const glowColor = palette.glow;
  const outlineColor = palette.outline ?? hexToRgb("#ffffff");

  drawCircle(buffer, cx, cy - (size * 0.02), size * 0.86, glowColor, alpha * 0.08);
  drawCircle(buffer, cx + (mirror ? -1 : 1) * size * 0.08, cy - (size * 0.16), size * 0.46, glowColor, alpha * 0.06);

  const [cuffX, cuffY] = point(-size * 0.02, size * 0.28);
  drawRotatedRect(buffer, cuffX, cuffY, size * 0.54, size * 0.22, angle, cuffColor, alpha * 0.96, 1.5);
  drawRotatedRect(buffer, cuffX, cuffY, size * 0.38, size * 0.08, angle, outlineColor, alpha * 0.24, 1);

  const [palmX, palmY] = point(-size * 0.02, 0);
  drawRotatedRect(buffer, palmX, palmY, size * 0.56, size * 0.5, angle, handColor, alpha, 1.6);

  const fingerOffsets = [-0.2, -0.06, 0.08, 0.22];
  for (const offset of fingerOffsets) {
    const [fx, fy] = point(offset * size, -size * 0.22);
    drawCircle(buffer, fx, fy, size * 0.105, handColor, alpha);
  }

  const [thumbAx, thumbAy] = point(size * 0.18, -size * 0.04);
  const [thumbBx, thumbBy] = point(size * 0.28, -size * 0.42);
  drawCapsule(buffer, thumbAx, thumbAy, thumbBx, thumbBy, Math.max(2.8, size * 0.14), handColor, alpha, 1.3);
  drawCircle(buffer, thumbBx, thumbBy, size * 0.12, handColor, alpha);

  const [sideX, sideY] = point(-size * 0.3, 0);
  drawCircle(buffer, sideX, sideY, size * 0.14, handColor, alpha * 0.98);

  const [highlightAx, highlightAy] = point(-size * 0.18, -size * 0.08);
  const [highlightBx, highlightBy] = point(size * 0.08, -size * 0.18);
  drawCapsule(buffer, highlightAx, highlightAy, highlightBx, highlightBy, Math.max(1.2, size * 0.04), outlineColor, alpha * 0.22, 1);

  const [thumbHighlightX, thumbHighlightY] = point(size * 0.2, -size * 0.28);
  drawCircle(buffer, thumbHighlightX, thumbHighlightY, size * 0.08, outlineColor, alpha * 0.16);
};

const TEXT_FONT = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};

const getTextLines = (text) => text.toUpperCase().split("\n");

const measureTextBlock = (text, cell, tracking = 1) => {
  const lines = getTextLines(text);
  const lineWidths = lines.map((line) => {
    let width = 0;
    for (let index = 0; index < line.length; index += 1) {
      const glyph = TEXT_FONT[line[index]] ?? TEXT_FONT[" "];
      width += (glyph[0].length * cell) + (index < line.length - 1 ? tracking * cell : 0);
    }
    return width;
  });
  return {
    lines,
    width: Math.max(...lineWidths),
    height: lines.length * (7 * cell) + ((lines.length - 1) * cell * 3),
    lineWidths,
  };
};

const getTextPixelOffsets = (text, cell, tracking = 1) => {
  const { lines, width, lineWidths } = measureTextBlock(text, cell, tracking);
  const offsets = [];
  let y = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let x = (width - lineWidths[lineIndex]) * 0.5;

    for (const character of line) {
      const glyph = TEXT_FONT[character] ?? TEXT_FONT[" "];
      for (let row = 0; row < glyph.length; row += 1) {
        for (let col = 0; col < glyph[row].length; col += 1) {
          if (glyph[row][col] === "1") {
            offsets.push({ x: x + (col * cell), y: y + (row * cell) });
          }
        }
      }
      x += (glyph[0].length + tracking) * cell;
    }

    y += (7 * cell) + (cell * 3);
  }

  return { offsets, width, height: y - (cell * 3) };
};

const drawTextBlock = (buffer, text, cx, cy, cell, color, alpha = 1, glowColor = hexToRgb("#ffffff")) => {
  const { offsets, width, height } = getTextPixelOffsets(text, cell, 1.1);
  const originX = cx - (width * 0.5);
  const originY = cy - (height * 0.5);

  for (const point of offsets) {
    drawRotatedRect(buffer, originX + point.x + (cell * 0.5), originY + point.y + (cell * 0.5), cell * 1.18, cell * 1.18, 0, glowColor, alpha * 0.08, 1.8);
    drawRotatedRect(buffer, originX + point.x + (cell * 0.5), originY + point.y + (cell * 0.5), cell * 0.9, cell * 0.9, 0, color, alpha, 1.1);
  }
};

const drawCasinoStar = (buffer, cx, cy, radius, color, alpha = 1) => {
  drawSpark(buffer, cx, cy, radius, color, alpha * 0.92);
  drawDiamond(buffer, cx, cy, radius * 0.66, 0, color, alpha * 0.8);
  drawCircle(buffer, cx, cy, radius * 0.2, hexToRgb("#ffffff"), alpha * 0.5);
};

const drawCasinoChip = (buffer, cx, cy, radius, bodyColor, accentColor, alpha = 1, rotation = 0) => {
  drawCircle(buffer, cx, cy, radius, bodyColor, alpha);
  drawRing(buffer, cx, cy, radius * 0.9, Math.max(3, radius * 0.16), accentColor, alpha * 0.94);
  drawRing(buffer, cx, cy, radius * 0.58, Math.max(2, radius * 0.08), accentColor, alpha * 0.5);

  for (let mark = 0; mark < 8; mark += 1) {
    const angle = rotation + ((mark / 8) * TAU);
    const px = cx + (Math.cos(angle) * radius * 0.76);
    const py = cy + (Math.sin(angle) * radius * 0.76);
    drawRotatedRect(buffer, px, py, radius * 0.24, radius * 0.14, angle, hexToRgb("#ffffff"), alpha * 0.88, 1);
  }

  drawCircle(buffer, cx - (radius * 0.2), cy - (radius * 0.22), radius * 0.14, hexToRgb("#ffffff"), alpha * 0.24);
};

const drawDiamondGem = (buffer, cx, cy, size, color, alpha = 1, rotation = 0) => {
  drawDiamond(buffer, cx, cy, size, rotation, color, alpha);
  drawDiamond(buffer, cx, cy, size * 0.66, rotation, hexToRgb("#ffffff"), alpha * 0.18);
  drawCapsule(buffer, cx, cy - (size * 0.52), cx - (size * 0.32), cy + (size * 0.08), 1.4, hexToRgb("#ffffff"), alpha * 0.28);
  drawCapsule(buffer, cx, cy - (size * 0.52), cx + (size * 0.32), cy + (size * 0.08), 1.4, hexToRgb("#ffffff"), alpha * 0.22);
};

const drawBill = (buffer, cx, cy, width, height, rotation = 0, alpha = 1) => {
  const green = hexToRgb("#7ddf73");
  const dark = hexToRgb("#1c5c26");
  drawRotatedRect(buffer, cx, cy, width, height, rotation, green, alpha, 1.2);
  drawRotatedRect(buffer, cx, cy, width * 0.84, height * 0.74, rotation, dark, alpha * 0.24, 1);
  drawCircle(buffer, cx, cy, Math.min(width, height) * 0.16, dark, alpha * 0.5);
  drawCapsule(buffer, cx - (width * 0.22), cy, cx + (width * 0.22), cy, Math.max(1.4, height * 0.06), hexToRgb("#d7ffd0"), alpha * 0.3);
};

const drawCrown = (buffer, cx, cy, width, color, alpha = 1) => {
  const baseY = cy + (width * 0.12);
  drawCapsule(buffer, cx - (width * 0.46), baseY, cx + (width * 0.46), baseY, Math.max(3, width * 0.06), color, alpha * 0.95);
  const tips = [
    { x: cx - (width * 0.34), y: cy - (width * 0.26) },
    { x: cx - (width * 0.12), y: cy - (width * 0.42) },
    { x: cx + (width * 0.12), y: cy - (width * 0.38) },
    { x: cx + (width * 0.34), y: cy - (width * 0.24) },
  ];

  let previousX = cx - (width * 0.44);
  for (const tip of tips) {
    drawCapsule(buffer, previousX, baseY, tip.x, tip.y, Math.max(2.2, width * 0.04), color, alpha * 0.88);
    drawDiamond(buffer, tip.x, tip.y, width * 0.08, 0, hexToRgb("#ffffff"), alpha * 0.56);
    previousX = tip.x;
  }
  drawCapsule(buffer, previousX, baseY, cx + (width * 0.44), baseY, Math.max(2.2, width * 0.04), color, alpha * 0.88);
};

const drawLightningBolt = (buffer, points, color, alpha = 1) => {
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    drawCapsule(buffer, from.x, from.y, to.x, to.y, 4.2, color, alpha * 0.26);
    drawCapsule(buffer, from.x, from.y, to.x, to.y, 1.8, hexToRgb("#ffffff"), alpha * 0.92);
  }
};

const drawFlame = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy + (size * 0.14), size * 0.34, hexToRgb("#ff4a1e"), alpha * 0.38);
  drawCapsule(buffer, cx, cy + (size * 0.34), cx, cy - (size * 0.42), size * 0.22, hexToRgb("#ff7a1a"), alpha * 0.7);
  drawCapsule(buffer, cx, cy + (size * 0.24), cx, cy - (size * 0.2), size * 0.12, hexToRgb("#ffe36e"), alpha * 0.82);
};

const drawRouletteWheel = (buffer, cx, cy, radius, rotation = 0, alpha = 1) => {
  drawCircle(buffer, cx, cy, radius, hexToRgb("#35120f"), alpha * 0.35);
  drawRing(buffer, cx, cy, radius * 0.92, Math.max(4, radius * 0.08), hexToRgb("#f5c65b"), alpha * 0.82);
  drawRing(buffer, cx, cy, radius * 0.66, Math.max(3, radius * 0.08), hexToRgb("#1f1f2d"), alpha * 0.84);
  drawCircle(buffer, cx, cy, radius * 0.14, hexToRgb("#f5c65b"), alpha * 0.82);

  for (let segment = 0; segment < 12; segment += 1) {
    const angle = rotation + ((segment / 12) * TAU);
    const color = segment % 2 === 0 ? hexToRgb("#ff4a3d") : hexToRgb("#0fd27a");
    const innerX = cx + (Math.cos(angle) * radius * 0.3);
    const innerY = cy + (Math.sin(angle) * radius * 0.3);
    const outerX = cx + (Math.cos(angle) * radius * 0.8);
    const outerY = cy + (Math.sin(angle) * radius * 0.8);
    drawCapsule(buffer, innerX, innerY, outerX, outerY, Math.max(2, radius * 0.06), color, alpha * 0.72);
  }
};

const buildScanlines = (rgba) => {
  const stride = WIDTH * 4;
  const raw = Buffer.alloc((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rawOffset = y * (stride + 1);
    raw[rawOffset] = 0;
    rgba.copy(raw, rawOffset + 1, y * stride, (y + 1) * stride);
  }
  return raw;
};

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), output.length - 4);
  return output;
};

const compressRgba = (rgba) => zlib.deflateSync(buildScanlines(rgba), { level: 9 });

const buildPng = (rgba) => {
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  parts.push(chunk("IHDR", ihdr));
  parts.push(chunk("IDAT", compressRgba(rgba)));
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
};

const buildApng = (frames) => {
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  parts.push(chunk("IHDR", ihdr));

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4);
  parts.push(chunk("acTL", actl));

  let sequence = 0;
  frames.forEach((frame, index) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(sequence, 0);
    fctl.writeUInt32BE(WIDTH, 4);
    fctl.writeUInt32BE(HEIGHT, 8);
    fctl.writeUInt16BE(FRAME_DELAY_MS, 20);
    fctl.writeUInt16BE(1000, 22);
    parts.push(chunk("fcTL", fctl));
    sequence += 1;

    if (index === 0) {
      parts.push(chunk("IDAT", frame));
      return;
    }

    const fdat = Buffer.alloc(4 + frame.length);
    fdat.writeUInt32BE(sequence, 0);
    frame.copy(fdat, 4);
    parts.push(chunk("fdAT", fdat));
    sequence += 1;
  });

  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
};

const compositeBuffer = (background, overlay, opacity = 1) => {
  for (let index = 0; index < background.length; index += 4) {
    const srcAlpha = (overlay[index + 3] / 255) * opacity;
    if (srcAlpha <= 0) continue;
    const dstAlpha = background[index + 3] / 255;
    const outAlpha = srcAlpha + (dstAlpha * (1 - srcAlpha));
    if (outAlpha <= 0) continue;

    background[index] = Math.round(
      ((overlay[index] * srcAlpha) + (background[index] * dstAlpha * (1 - srcAlpha))) / outAlpha,
    );
    background[index + 1] = Math.round(
      ((overlay[index + 1] * srcAlpha) + (background[index + 1] * dstAlpha * (1 - srcAlpha))) / outAlpha,
    );
    background[index + 2] = Math.round(
      ((overlay[index + 2] * srcAlpha) + (background[index + 2] * dstAlpha * (1 - srcAlpha))) / outAlpha,
    );
    background[index + 3] = Math.round(outAlpha * 255);
  }
};

const renderPremiumChatEnhancement = (time, seed) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(seed);
  const phase = mod01(time);
  const impact = easeOutCubic(clamp(1 - Math.abs(phase - 0.1) / 0.14));
  const earlyImpact = easeOutBack(clamp(phase / 0.18));
  const pulse = 0.5 + (0.5 * Math.sin((phase * TAU * 2) + ((seed % 17) * 0.12)));
  const focusX = WIDTH * (0.4 + (((seed >>> 3) % 4) * 0.06));
  const focusY = HEIGHT * (0.66 + (((seed >>> 1) % 3) * 0.04));
  const palette = [
    hexToRgb("#f5c65b"),
    hexToRgb("#fff1b4"),
    hexToRgb("#58c7ff"),
    hexToRgb("#ff4fd8"),
    hexToRgb("#8f5bff"),
    hexToRgb("#ff9c36"),
    hexToRgb("#23bf66"),
    hexToRgb("#ffffff"),
  ];
  const pick = (offset) => palette[(offset + (seed % palette.length)) % palette.length];

  drawCircle(rgba, focusX, focusY - 12, 150 + (impact * 68), pick(0), 0.05 + (impact * 0.08), 56);
  drawCircle(rgba, focusX - 36, focusY + 18, 238 + (impact * 92), pick(2), 0.03 + (pulse * 0.04), 74);
  drawCircle(rgba, focusX + 24, focusY - 26, 188 + (impact * 82), pick(3), 0.028 + (impact * 0.04), 68);
  drawShockwave(rgba, focusX, focusY, 96 + (impact * 82), pick(0), 0.18 + (impact * 0.16));
  drawShockwave(rgba, focusX, focusY, 166 + (impact * 112), pick(2), 0.09 + (impact * 0.1));
  drawShockwave(rgba, focusX, focusY, 244 + (impact * 126), pick(3), 0.04 + (impact * 0.05));

  for (let dust = 0; dust < 46; dust += 1) {
    const orbit = mod01((phase * (0.22 + (rng() * 0.28))) + rng());
    const x = 56 + (rng() * (WIDTH - 112)) + (Math.sin((orbit * TAU * 2) + rng()) * (12 + (rng() * 36)));
    const y = 84 + (rng() * (HEIGHT - 168)) + (Math.cos((orbit * TAU * 1.6) + rng()) * (14 + (rng() * 44)));
    const size = 3.8 + (rng() * 7.4);
    const alpha = 0.05 + (0.1 * pulse) + (rng() * 0.05);
    const color = pick(dust % 6);
    drawCircle(rgba, x, y, size, color, alpha);
    if (dust % 2 === 0) {
      drawSpark(rgba, x, y, size * 0.9, dust % 3 === 0 ? pick(1) : pick(7), alpha * 0.38);
    }
  }

  for (let burst = 0; burst < 28; burst += 1) {
    const angle = ((burst / 28) * TAU) + (phase * TAU * (0.28 + ((burst % 3) * 0.08)));
    const radius = 62 + ((burst % 6) * 28) + (impact * (88 + ((burst % 4) * 16)));
    const x = focusX + (Math.cos(angle) * radius);
    const y = focusY + (Math.sin(angle) * radius * 0.76);
    const color = pick((burst + 2) % 6);
    drawTrailDots(rgba, focusX, focusY + 12, x, y, 6, 3.6 + ((burst % 3) * 0.9), pick(1), 0.18 + (impact * 0.14));
    drawSpark(rgba, x, y, 7.6 + ((burst % 4) * 1.6), color, 0.36 + (impact * 0.28));
  }

  for (let streak = 0; streak < 18; streak += 1) {
    const angle = -1.26 + ((streak / 17) * 2.52) + (Math.sin((phase * TAU * 1.24) + streak) * 0.09);
    const length = 88 + ((streak % 4) * 44) + (impact * 70);
    const innerX = focusX + (Math.cos(angle) * 28);
    const innerY = focusY + (Math.sin(angle) * 28 * 0.84);
    const outerX = focusX + (Math.cos(angle) * length);
    const outerY = focusY + (Math.sin(angle) * length * 0.84);
    drawCapsule(rgba, innerX, innerY, outerX, outerY, 3.9 + ((streak % 3) * 0.9), pick((streak + 3) % 5), 0.18 + (impact * 0.18));
    drawCapsule(rgba, innerX, innerY, outerX, outerY, 1.3, pick(7), 0.34 + (impact * 0.22));
  }

  const burstProgress = easeOutBack(clamp(phase / 0.26));
  for (let confetti = 0; confetti < 38; confetti += 1) {
    const angle = ((confetti / 38) * TAU) + ((seed % 31) * 0.04);
    const radius = mix(24 + ((confetti % 4) * 12), 220 + ((confetti % 5) * 28), burstProgress);
    const x = focusX + (Math.cos(angle) * radius);
    const y = focusY + (Math.sin(angle) * radius * 0.82) - (Math.sin(burstProgress * Math.PI) * (18 + ((confetti % 3) * 8)));
    const size = 10 + ((confetti % 4) * 3.2);
    const alpha = clamp(1 - Math.max(0, (phase - 0.68) / 0.32)) * (0.5 + (impact * 0.36));
    const color = pick(confetti % 6);
    drawTrailDots(rgba, focusX, focusY, x, y, 5, 3.1, pick(1), alpha * 0.2);
    drawConfettiSprite(rgba, x, y, size, Math.max(4, size * 0.52), angle + (phase * TAU * 0.7), confetti % 3 === 0 ? "diamond" : "rect", color, alpha);
  }

  for (let floatIndex = 0; floatIndex < 16; floatIndex += 1) {
    const progress = mod01((phase * (0.36 + (rng() * 0.34))) + rng());
    const x = 44 + (rng() * (WIDTH - 88));
    const y = HEIGHT - 40 - (progress * (HEIGHT + 100));
    const sway = Math.sin((progress * TAU * 1.8) + floatIndex) * (18 + (rng() * 28));
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.9 ? (1 - progress) / 0.1 : 1) * 0.28;
    if (floatIndex % 4 === 0) {
      drawCoin(rgba, x + sway, y, 10 + (rng() * 11), alpha * 0.94, progress * TAU * 3.6);
    } else if (floatIndex % 4 === 1) {
      drawDiamond(rgba, x + sway, y, 12 + (rng() * 10), progress * TAU * 2.7, pick(2 + (floatIndex % 4)), alpha * 0.92);
    } else if (floatIndex % 4 === 2) {
      drawConfettiSprite(rgba, x + sway, y, 16 + (rng() * 10), 8 + (rng() * 6), progress * TAU * 2.1, "diamond", pick(floatIndex % 6), alpha * 0.94);
    } else {
      drawSpark(rgba, x + sway, y, 8 + (rng() * 7), pick(floatIndex % 5), alpha * 0.9);
    }
  }

  for (let foreground = 0; foreground < 8; foreground += 1) {
    const travel = mod01((phase * (0.9 + foreground * 0.08)) + (foreground * 0.16));
    const startX = foreground % 2 === 0 ? -96 : WIDTH + 96;
    const endX = foreground % 2 === 0 ? WIDTH + 96 : -96;
    const x = mix(startX, endX, travel);
    const y = HEIGHT * (0.16 + ((foreground % 5) * 0.12)) + Math.sin((travel * TAU * 2) + foreground) * 38;
    const alpha = (0.06 + (earlyImpact * 0.12)) * clamp(1 - Math.abs(travel - 0.5) / 0.5);
    drawCapsule(rgba, x - 80, y - 12, x + 80, y + 12, 10 + (foreground % 3) * 2, pick((foreground + 2) % 6), alpha);
    drawCapsule(rgba, x - 54, y - 4, x + 54, y + 4, 3, pick(7), alpha * 0.8);
  }

  return rgba;
};

const renderEnhancedChatFrame = (effect, time, seed, enhancementOpacity = effect.enhanceOpacity ?? 0.14) => {
  const frame = effect.render(time);
  if (enhancementOpacity > 0) {
    compositeBuffer(frame, renderPremiumChatEnhancement(time, seed), enhancementOpacity);
  }
  return frame;
};

const renderPreviewChatFrame = (effect, seed) => {
  const heroFrame = effect.previewFrames.reduce(
    (best, frame) => (frame.opacity > best.opacity ? frame : best),
    effect.previewFrames[0] ?? { time: 0.2, opacity: 1 },
  );
  return effect.render(heroFrame.time, seed);
};

const fillBackdrop = (buffer, theme) => {
  const top = hexToRgb(theme.top);
  const bottom = hexToRgb(theme.bottom);
  const hot = hexToRgb(theme.hot);
  const cool = hexToRgb(theme.cool);
  const gold = hexToRgb(theme.gold);
  const centerX = WIDTH * 0.5;
  const floorY = HEIGHT * 0.94;

  for (let y = 0; y < HEIGHT; y += 1) {
    const vertical = y / (HEIGHT - 1);
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 4;
      const baseT = vertical ** 0.88;
      const dx = Math.abs((x / (WIDTH - 1)) - 0.5) * 2;
      const vignette = clamp(1 - (dx * 0.24) - (vertical * 0.08), 0.7, 1);
      const floorGlow = clamp(1 - (Math.hypot(x - centerX, y - floorY) / 420));
      const hotSweep = clamp(1 - (Math.hypot(x - (WIDTH * 0.28), y - (HEIGHT * 0.72)) / 540));
      const coolSweep = clamp(1 - (Math.hypot(x - (WIDTH * 0.72), y - (HEIGHT * 0.58)) / 560));

      const r = clamp(((mix(top.r, bottom.r, baseT) * vignette) + (gold.r * floorGlow * 0.16) + (hot.r * hotSweep * 0.06)) / 255) * 255;
      const g = clamp(((mix(top.g, bottom.g, baseT) * vignette) + (gold.g * floorGlow * 0.14) + (cool.g * coolSweep * 0.05)) / 255) * 255;
      const b = clamp(((mix(top.b, bottom.b, baseT) * vignette) + (hot.b * hotSweep * 0.1) + (cool.b * coolSweep * 0.12)) / 255) * 255;

      buffer[index] = Math.round(r);
      buffer[index + 1] = Math.round(g);
      buffer[index + 2] = Math.round(b);
      buffer[index + 3] = 255;
    }
  }

  for (const beam of theme.beams) {
    const beamColor = hexToRgb(beam.color);
    drawCapsule(
      buffer,
      centerX + beam.originX,
      HEIGHT - 44,
      centerX + beam.targetX,
      beam.targetY,
      beam.radius,
      beamColor,
      beam.alpha,
    );
  }

  const rng = createRng(theme.seed);
  for (let index = 0; index < 46; index += 1) {
    const x = 44 + (rng() * (WIDTH - 88));
    const y = 54 + (rng() * (HEIGHT - 164));
    const size = 1.8 + (rng() * 3.8);
    const alpha = 0.08 + (rng() * 0.16);
    const colors = [gold, hot, cool, hexToRgb("#ffffff")];
    drawCircle(buffer, x, y, size, colors[Math.floor(rng() * colors.length)], alpha, 1.2);
  }

  drawRing(buffer, centerX, HEIGHT - 84, 208, 5.5, gold, 0.1);
  drawSpark(buffer, centerX, HEIGHT - 72, 18, gold, 0.18);
};

const confettiPalette = ["#ff4fd8", "#58c7ff", "#f5c65b", "#8f5bff", "#ff8f45", "#ffffff"].map(hexToRgb);
const goldHeartPalette = ["#fff4c8", "#f9d86d", "#f5c65b", "#eb9b1f"].map(hexToRgb);
const heartPulsePalette = ["#ff63c7", "#ff95dd", "#f5c65b", "#fff0cc", "#ffffff"].map(hexToRgb);
const sparklePalette = ["#f5c65b", "#58c7ff", "#ffffff", "#ff8f45", "#ff4fd8"].map(hexToRgb);
const luckyPalette = ["#f5c65b", "#12f7d6", "#58c7ff", "#ffffff", "#a7ff5a"].map(hexToRgb);
const jackpotPalette = ["#f5c65b", "#ffd98f", "#58c7ff", "#ff4fd8", "#ffffff"].map(hexToRgb);
const ballPalette = [
  { color: hexToRgb("#ff6e2e"), digit: 7 },
  { color: hexToRgb("#7a44ff"), digit: 8 },
  { color: hexToRgb("#2f86ff"), digit: 3 },
  { color: hexToRgb("#23bf66"), digit: 9 },
  { color: hexToRgb("#f5c65b"), digit: 1 },
  { color: hexToRgb("#ff4fd8"), digit: 4 },
];

const confettiPieces = (() => {
  const rng = createRng(17);
  return Array.from({ length: 184 }, () => ({
    offset: rng(),
    flight: 0.56 + (rng() * 0.26),
    angle: (-Math.PI * 0.96) + (rng() * (Math.PI * 0.92)),
    speed: 420 + (rng() * 340),
    gravity: 420 + (rng() * 180),
    drift: (rng() - 0.5) * 112,
    width: 6 + (rng() * 18),
    height: 4 + (rng() * 13),
    spin: (-8 + (rng() * 16)),
    baseRotation: rng() * Math.PI,
    type: rng() > 0.76 ? "diamond" : "rect",
    color: confettiPalette[Math.floor(rng() * confettiPalette.length)],
  }));
})();

const confettiStreamers = (() => {
  const rng = createRng(22);
  return Array.from({ length: 34 }, () => ({
    offset: rng(),
    flight: 0.64 + (rng() * 0.18),
    angle: (-Math.PI * 0.92) + (rng() * (Math.PI * 0.8)),
    speed: 340 + (rng() * 260),
    gravity: 480 + (rng() * 140),
    width: 20 + (rng() * 36),
    height: 5 + (rng() * 4),
    wave: 22 + (rng() * 32),
    spin: (-5 + (rng() * 10)),
    baseRotation: rng() * Math.PI,
    color: confettiPalette[Math.floor(rng() * confettiPalette.length)],
  }));
})();

const confettiSparks = (() => {
  const rng = createRng(21);
  return Array.from({ length: 156 }, () => ({
    offset: rng(),
    flight: 0.52 + (rng() * 0.18),
    angle: (-Math.PI * 0.94) + (rng() * (Math.PI * 0.88)),
    speed: 340 + (rng() * 280),
    gravity: 420 + (rng() * 140),
    drift: (rng() - 0.5) * 72,
    size: 3.2 + (rng() * 8.4),
    color: sparklePalette[Math.floor(rng() * sparklePalette.length)],
  }));
})();

const confettiFallers = (() => {
  const rng = createRng(24);
  return Array.from({ length: 54 }, () => ({
    offset: rng(),
    x: 28 + (rng() * (WIDTH - 56)),
    sway: 12 + (rng() * 38),
    speed: 0.42 + (rng() * 0.42),
    size: 4 + (rng() * 10),
    spin: (-2.8 + (rng() * 5.6)),
    phase: rng() * TAU,
    type: rng() > 0.7 ? "diamond" : "rect",
    color: confettiPalette[Math.floor(rng() * confettiPalette.length)],
  }));
})();

const goldenHearts = (() => {
  const rng = createRng(31);
  return Array.from({ length: 28 }, () => ({
    offset: rng(),
    x: 78 + (rng() * (WIDTH - 156)),
    sway: 20 + (rng() * 46),
    size: 20 + (rng() * 54),
    phase: rng() * TAU,
    speed: 0.68 + (rng() * 0.28),
    depth: 0.62 + (rng() * 0.7),
    color: goldHeartPalette[Math.floor(rng() * goldHeartPalette.length)],
  })).sort((a, b) => a.depth - b.depth);
})();

const heartDust = (() => {
  const rng = createRng(37);
  return Array.from({ length: 132 }, () => ({
    offset: rng(),
    x: 54 + (rng() * (WIDTH - 108)),
    y: 64 + (rng() * (HEIGHT - 148)),
    drift: 8 + (rng() * 24),
    size: 2.2 + (rng() * 5.4),
    phase: rng() * TAU,
    color: goldHeartPalette[Math.floor(rng() * goldHeartPalette.length)],
  }));
})();

const heartGlints = (() => {
  const rng = createRng(39);
  return Array.from({ length: 34 }, () => ({
    offset: rng(),
    x: 48 + (rng() * (WIDTH - 96)),
    y: 54 + (rng() * (HEIGHT - 108)),
    size: 4 + (rng() * 10),
    phase: rng() * TAU,
  }));
})();

const fireworkBursts = [
  {
    x: 384,
    y: 482,
    radius: 224,
    phase: 0,
    rayCount: 34,
    color: hexToRgb("#ffb03a"),
    accent: hexToRgb("#fff7d1"),
    launchX: 384,
  },
  {
    x: 198,
    y: 322,
    radius: 162,
    phase: 0.16,
    rayCount: 24,
    color: hexToRgb("#58c7ff"),
    accent: hexToRgb("#dff6ff"),
    launchX: 176,
  },
  {
    x: 582,
    y: 268,
    radius: 176,
    phase: 0.34,
    rayCount: 26,
    color: hexToRgb("#ff4fd8"),
    accent: hexToRgb("#ffe1f5"),
    launchX: 612,
  },
  {
    x: 304,
    y: 198,
    radius: 118,
    phase: 0.58,
    rayCount: 18,
    color: hexToRgb("#8f5bff"),
    accent: hexToRgb("#e7dbff"),
    launchX: 276,
  },
  {
    x: 512,
    y: 154,
    radius: 112,
    phase: 0.72,
    rayCount: 16,
    color: hexToRgb("#f5c65b"),
    accent: hexToRgb("#fff0be"),
    launchX: 546,
  },
];

const chaosBalls = [
  {
    minX: 114,
    maxX: 364,
    minY: 168,
    maxY: 404,
    radius: 60,
    speedX: 0.72,
    speedY: 1.18,
    phaseX: 0.12,
    phaseY: 0.14,
    arc: 24,
    phaseZ: 0.2,
    body: ballPalette[0],
  },
  {
    minX: 268,
    maxX: 562,
    minY: 346,
    maxY: 706,
    radius: 50,
    speedX: 0.96,
    speedY: 1.34,
    phaseX: 0.36,
    phaseY: 0.52,
    arc: 18,
    phaseZ: 0.52,
    body: ballPalette[1],
  },
  {
    minX: 262,
    maxX: 608,
    minY: 250,
    maxY: 722,
    radius: 72,
    speedX: 0.84,
    speedY: 1.08,
    phaseX: 0.62,
    phaseY: 0.18,
    arc: 28,
    phaseZ: 0.74,
    body: ballPalette[2],
  },
  {
    minX: 392,
    maxX: 694,
    minY: 150,
    maxY: 512,
    radius: 62,
    speedX: 0.64,
    speedY: 1.22,
    phaseX: 0.82,
    phaseY: 0.4,
    arc: 20,
    phaseZ: 0.12,
    body: ballPalette[3],
  },
  {
    minX: 70,
    maxX: 240,
    minY: 586,
    maxY: 900,
    radius: 44,
    speedX: 1.08,
    speedY: 1.48,
    phaseX: 0.2,
    phaseY: 0.68,
    arc: 14,
    phaseZ: 0.9,
    body: ballPalette[4],
  },
  {
    minX: 548,
    maxX: 708,
    minY: 498,
    maxY: 874,
    radius: 40,
    speedX: 1.14,
    speedY: 1.42,
    phaseX: 0.56,
    phaseY: 0.86,
    arc: 12,
    phaseZ: 0.32,
    body: ballPalette[5],
  },
  {
    minX: 138,
    maxX: 312,
    minY: 112,
    maxY: 322,
    radius: 38,
    speedX: 1.18,
    speedY: 1.56,
    phaseX: 0.74,
    phaseY: 0.08,
    arc: 16,
    phaseZ: 0.44,
    body: ballPalette[2],
  },
  {
    minX: 474,
    maxX: 690,
    minY: 312,
    maxY: 662,
    radius: 48,
    speedX: 0.86,
    speedY: 1.12,
    phaseX: 0.92,
    phaseY: 0.26,
    arc: 18,
    phaseZ: 0.66,
    body: ballPalette[0],
  },
];

const jackpotCoins = (() => {
  const rng = createRng(45);
  return Array.from({ length: 34 }, () => ({
    offset: rng(),
    flight: 0.48 + (rng() * 0.24),
    angle: (-Math.PI * 0.94) + (rng() * (Math.PI * 0.88)),
    speed: 360 + (rng() * 320),
    gravity: 400 + (rng() * 140),
    drift: (rng() - 0.5) * 76,
    radius: 10 + (rng() * 16),
    spin: (-3.4 + (rng() * 6.8)),
  }));
})();

const jackpotShards = (() => {
  const rng = createRng(47);
  return Array.from({ length: 176 }, () => ({
    offset: rng(),
    flight: 0.54 + (rng() * 0.18),
    angle: (-Math.PI * 0.92) + (rng() * (Math.PI * 0.84)),
    speed: 300 + (rng() * 280),
    gravity: 440 + (rng() * 140),
    size: 3.2 + (rng() * 7.4),
    drift: (rng() - 0.5) * 58,
    type: rng() > 0.62 ? "diamond" : "spark",
    color: jackpotPalette[Math.floor(rng() * jackpotPalette.length)],
  }));
})();

const jackpotDust = (() => {
  const rng = createRng(49);
  return Array.from({ length: 96 }, () => ({
    offset: rng(),
    flight: 0.44 + (rng() * 0.24),
    angle: (-Math.PI * 0.98) + (rng() * (Math.PI * 0.96)),
    speed: 220 + (rng() * 210),
    gravity: 360 + (rng() * 120),
    drift: (rng() - 0.5) * 42,
    size: 2.4 + (rng() * 5.4),
    color: jackpotPalette[Math.floor(rng() * jackpotPalette.length)],
  }));
})();

const heartPulseCluster = (() => {
  const rng = createRng(57);
  return Array.from({ length: 12 }, (_, index) => ({
    angle: (index / 12) * TAU,
    radius: 76 + ((index % 4) * 26) + (rng() * 22),
    size: 24 + ((index % 3) * 10) + (rng() * 8),
    orbitSpeed: 0.42 + (rng() * 0.34),
    pulseOffset: rng(),
    color: heartPulsePalette[index % heartPulsePalette.length],
  }));
})();

const cupidDriftHearts = (() => {
  const rng = createRng(59);
  return Array.from({ length: 24 }, () => ({
    offset: rng(),
    startX: 62 + (rng() * (WIDTH - 124)),
    startY: 160 + (rng() * (HEIGHT - 320)),
    sway: 18 + (rng() * 34),
    rise: 180 + (rng() * 260),
    speed: 0.54 + (rng() * 0.28),
    size: 18 + (rng() * 34),
    depth: 0.64 + (rng() * 0.72),
    color: heartPulsePalette[Math.floor(rng() * heartPulsePalette.length)],
  })).sort((a, b) => a.depth - b.depth);
})();

const rocketBursts = [
  { x: 140, y: 348, radius: 108, launchX: 118, phase: 0.02, rayCount: 22, color: hexToRgb("#58c7ff"), accent: hexToRgb("#dff6ff") },
  { x: 310, y: 250, radius: 148, launchX: 284, phase: 0.18, rayCount: 28, color: hexToRgb("#ff8f45"), accent: hexToRgb("#fff0d7") },
  { x: 594, y: 314, radius: 124, launchX: 628, phase: 0.32, rayCount: 24, color: hexToRgb("#ff4fd8"), accent: hexToRgb("#ffe6f8") },
  { x: 446, y: 178, radius: 102, launchX: 420, phase: 0.5, rayCount: 18, color: hexToRgb("#8f5bff"), accent: hexToRgb("#efe6ff") },
  { x: 220, y: 170, radius: 92, launchX: 188, phase: 0.68, rayCount: 18, color: hexToRgb("#f5c65b"), accent: hexToRgb("#fff5cf") },
  { x: 644, y: 196, radius: 96, launchX: 676, phase: 0.84, rayCount: 18, color: hexToRgb("#58c7ff"), accent: hexToRgb("#ffffff") },
];

const auroraBursts = [
  { x: 96, y: 278, radius: 84, launchX: 72, phase: 0.04, rayCount: 16, color: hexToRgb("#12f7d6"), accent: hexToRgb("#dffff9") },
  { x: 206, y: 194, radius: 72, launchX: 188, phase: 0.14, rayCount: 14, color: hexToRgb("#58c7ff"), accent: hexToRgb("#e0f6ff") },
  { x: 334, y: 144, radius: 88, launchX: 306, phase: 0.28, rayCount: 16, color: hexToRgb("#ff63c7"), accent: hexToRgb("#ffe3f5") },
  { x: 456, y: 212, radius: 76, launchX: 430, phase: 0.42, rayCount: 14, color: hexToRgb("#f5c65b"), accent: hexToRgb("#fff4cb") },
  { x: 560, y: 142, radius: 86, launchX: 544, phase: 0.58, rayCount: 16, color: hexToRgb("#8f5bff"), accent: hexToRgb("#ede4ff") },
  { x: 674, y: 224, radius: 92, launchX: 698, phase: 0.72, rayCount: 16, color: hexToRgb("#58c7ff"), accent: hexToRgb("#ffffff") },
  { x: 384, y: 308, radius: 116, launchX: 384, phase: 0.86, rayCount: 24, color: hexToRgb("#ff8f45"), accent: hexToRgb("#fff0d1") },
];

const paradeBalls = (() => {
  const rng = createRng(61);
  return Array.from({ length: 10 }, (_, index) => ({
    offset: rng(),
    laneX: 84 + (rng() * (WIDTH - 168)),
    sway: 24 + (rng() * 54),
    speed: 0.52 + (rng() * 0.34),
    radius: 26 + (rng() * 18),
    rise: HEIGHT + 240 + (rng() * 80),
    phase: rng() * TAU,
    drift: 0.5 + (rng() * 1.4),
    body: ballPalette[index % ballPalette.length],
  }));
})();

const turboBounceBalls = (() => {
  const rng = createRng(63);
  return Array.from({ length: 6 }, (_, index) => ({
    minX: 108 + (index * 96),
    maxX: 244 + (index * 76),
    radius: 36 + (rng() * 18),
    speed: 0.74 + (rng() * 0.42),
    bounce: 120 + (rng() * 160),
    floorY: HEIGHT - 182 - (rng() * 92),
    phase: rng(),
    swing: 0.5 + (rng() * 0.8),
    arc: 10 + (rng() * 24),
    body: ballPalette[(index + 2) % ballPalette.length],
  }));
})();

const cloverField = (() => {
  const rng = createRng(65);
  return Array.from({ length: 14 }, () => ({
    offset: rng(),
    x: 92 + (rng() * (WIDTH - 184)),
    sway: 16 + (rng() * 42),
    size: 18 + (rng() * 26),
    speed: 0.34 + (rng() * 0.28),
    phase: rng() * TAU,
    color: luckyPalette[Math.floor(rng() * luckyPalette.length)],
  }));
})();

const bonusShowerCoins = (() => {
  const rng = createRng(67);
  return Array.from({ length: 26 }, () => ({
    offset: rng(),
    flight: 0.58 + (rng() * 0.22),
    angle: (Math.PI * 0.2) + (rng() * (Math.PI * 0.66)),
    speed: 180 + (rng() * 260),
    gravity: 320 + (rng() * 180),
    drift: (rng() - 0.5) * 56,
    radius: 10 + (rng() * 14),
    spin: (-3.2 + (rng() * 6.4)),
  }));
})();

const bonusShowerShards = (() => {
  const rng = createRng(69);
  return Array.from({ length: 168 }, () => ({
    offset: rng(),
    flight: 0.52 + (rng() * 0.22),
    angle: (Math.PI * 0.18) + (rng() * (Math.PI * 0.7)),
    speed: 180 + (rng() * 320),
    gravity: 280 + (rng() * 180),
    size: 2.8 + (rng() * 6.2),
    drift: (rng() - 0.5) * 48,
    type: rng() > 0.68 ? "diamond" : "spark",
    color: luckyPalette[Math.floor(rng() * luckyPalette.length)],
  }));
})();

const renderConfettiStorm = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT - 92;
  const pulse = 0.5 + (0.5 * Math.sin(time * TAU * 1.2));

  drawSpark(rgba, originX, originY - 8, 24 + (pulse * 8), hexToRgb("#fff2c1"), 0.28);
  drawShockwave(rgba, originX, originY - 10, 124 + (pulse * 28), hexToRgb("#f5c65b"), 0.24);
  drawShockwave(rgba, originX, originY - 14, 212 + (pulse * 34), hexToRgb("#58c7ff"), 0.14);

  for (const piece of confettiPieces) {
    const local = mod01(time + piece.offset);
    const progress = local / piece.flight;
    if (progress > 1) continue;
    const eased = easeOutBack(progress);
    const previous = Math.max(0, progress - 0.052);
    const previousEased = easeOutQuad(previous);
    const x = originX + (Math.cos(piece.angle) * piece.speed * eased) + (piece.drift * progress);
    const y = originY + (Math.sin(piece.angle) * piece.speed * eased) + (piece.gravity * progress * progress * 0.46) - (Math.sin(progress * Math.PI) * 18);
    const previousX = originX + (Math.cos(piece.angle) * piece.speed * previousEased) + (piece.drift * previous);
    const previousY = originY + (Math.sin(piece.angle) * piece.speed * previousEased) + (piece.gravity * previous * previous * 0.46) - (Math.sin(previous * Math.PI) * 18);
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.9 ? (1 - progress) / 0.1 : 1);
    const rotation = piece.baseRotation + (piece.spin * progress * TAU);

    if (progress > 0.02) {
      drawTrailDots(rgba, previousX, previousY, x, y, 4, Math.max(1.8, piece.height * 0.24), piece.color, alpha * 0.16);
    }

    if (piece.type === "diamond") {
      drawDiamond(rgba, x, y, piece.width, rotation, piece.color, alpha);
    } else {
      drawRotatedRect(rgba, x, y, piece.width, piece.height, rotation, piece.color, alpha);
      drawCapsule(
        rgba,
        x - (Math.cos(rotation) * piece.width * 0.18),
        y - (Math.sin(rotation) * piece.width * 0.18),
        x + (Math.cos(rotation) * piece.width * 0.18),
        y + (Math.sin(rotation) * piece.width * 0.18),
        0.8,
        hexToRgb("#ffffff"),
        alpha * 0.38,
      );
    }
  }

  for (const streamer of confettiStreamers) {
    const local = mod01(time + streamer.offset);
    const progress = local / streamer.flight;
    if (progress > 1) continue;
    const eased = easeOutBack(progress);
    const previous = Math.max(0, progress - 0.04);
    const previousEased = easeOutQuad(previous);
    const x = originX + (Math.cos(streamer.angle) * streamer.speed * eased);
    const y = originY + (Math.sin(streamer.angle) * streamer.speed * eased) + (streamer.gravity * progress * progress * 0.5);
    const previousX = originX + (Math.cos(streamer.angle) * streamer.speed * previousEased);
    const previousY = originY + (Math.sin(streamer.angle) * streamer.speed * previousEased) + (streamer.gravity * previous * previous * 0.5);
    const wave = Math.sin((progress * TAU * 2.5) + streamer.baseRotation) * streamer.wave;
    const alpha = clamp(1 - (progress * 0.9));
    drawCapsule(rgba, previousX, previousY, x + wave, y, Math.max(1.2, streamer.height * 0.18), streamer.color, alpha * 0.18);
    drawRotatedRect(
      rgba,
      x + wave,
      y,
      streamer.width,
      streamer.height,
      streamer.baseRotation + (streamer.spin * progress),
      streamer.color,
      alpha * 0.86,
    );
  }

  for (const spark of confettiSparks) {
    const local = mod01(time + spark.offset);
    const progress = local / spark.flight;
    if (progress > 1) continue;
    const eased = easeOutCubic(progress);
    const x = originX + (Math.cos(spark.angle) * spark.speed * eased) + (spark.drift * progress);
    const y = originY + (Math.sin(spark.angle) * spark.speed * eased) + (spark.gravity * progress * progress * 0.48);
    const alpha = clamp(1 - progress);
    drawTrailDots(rgba, originX, originY - 12, x, y, 4, spark.size * 0.3, spark.color, alpha * 0.26);
    drawSpark(rgba, x, y, spark.size, spark.color, alpha * 0.98);
  }

  for (const faller of confettiFallers) {
    const progress = mod01((time * faller.speed) + faller.offset);
    const x = faller.x + (Math.sin((progress * TAU * 1.4) + faller.phase) * faller.sway);
    const y = -56 + (progress * (HEIGHT + 112));
    const alpha = clamp(progress < 0.1 ? progress / 0.1 : progress > 0.92 ? (1 - progress) / 0.08 : 1) * 0.82;
    const rotation = faller.phase + (progress * TAU * faller.spin);

    if (faller.type === "diamond") {
      drawDiamond(rgba, x, y, faller.size, rotation, faller.color, alpha);
    } else {
      drawRotatedRect(rgba, x, y, faller.size * 1.1, faller.size * 0.48, rotation, faller.color, alpha);
    }
  }

  return rgba;
};

const renderGoldenHeartRain = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (const heart of goldenHearts) {
    const progress = mod01((time * heart.speed) + heart.offset);
    const x = heart.x + (Math.sin((progress * TAU * 1.45) + heart.phase) * heart.sway);
    const y = -190 + (progress * (HEIGHT + 380));
    const previousProgress = mod01(((time - 0.028) * heart.speed) + heart.offset);
    const previousX = heart.x + (Math.sin((previousProgress * TAU * 1.45) + heart.phase) * heart.sway);
    const previousY = -190 + (previousProgress * (HEIGHT + 380));
    const size = heart.size * heart.depth * (0.9 + (0.1 * Math.sin((progress * TAU) + heart.phase)));
    const alpha = clamp(progress < 0.1 ? progress / 0.1 : progress > 0.92 ? (1 - progress) / 0.08 : 1) * 0.98;

    if (progress > 0.04) {
      drawTrailDots(rgba, previousX, previousY, x, y, 5, Math.max(2.2, size * 0.09), hexToRgb("#fff0bf"), alpha * 0.16);
    }
    drawHeartFill(rgba, x, y, size + 10, hexToRgb("#fff4c8"), alpha * 0.08);
    drawGlossyHeart(rgba, x, y, size, heart.color, alpha);
    drawSpark(rgba, x + (size * 0.26), y - (size * 0.18), Math.max(2.8, size * 0.12), hexToRgb("#fff7dc"), alpha * 0.34);
    drawSpark(rgba, x - (size * 0.2), y + (size * 0.12), Math.max(2.4, size * 0.08), hexToRgb("#f5c65b"), alpha * 0.18);
  }

  for (const dust of heartDust) {
    const pulse = 0.4 + (0.6 * Math.sin((time * TAU * 1.6) + dust.phase));
    const x = dust.x + (Math.sin((time * TAU) + dust.phase) * dust.drift);
    const y = dust.y + (((mod01(time + dust.offset) * 2) - 1) * 24);
    drawSpark(rgba, x, y, dust.size, dust.color, pulse * 0.36);
  }

  for (const glint of heartGlints) {
    const pulse = 0.5 + (0.5 * Math.sin((time * TAU * 1.2) + glint.phase));
    const drift = Math.sin((time * TAU * 0.7) + glint.phase) * 10;
    drawSpark(rgba, glint.x + drift, glint.y, glint.size, hexToRgb("#fff7dc"), pulse * 0.22);
  }

  return rgba;
};

const renderFireworkImpact = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (const burst of fireworkBursts) {
    const local = mod01(time + burst.phase);
    const launch = clamp(local / 0.2);
    const burstProgress = clamp((local - 0.12) / 0.74);
    const rayLength = burst.radius * easeOutBack(burstProgress);
    const rayAlpha = clamp(1 - burstProgress) * 0.98;
    const launchY = mix(HEIGHT - 26, burst.y, launch);

    drawCapsule(rgba, burst.launchX, HEIGHT - 26, burst.x, launchY, 4.6, burst.color, 0.16);
    drawCapsule(rgba, burst.launchX, HEIGHT - 26, burst.x, launchY, 2.8, hexToRgb("#f5c65b"), 0.64);
    drawCapsule(rgba, burst.launchX, HEIGHT - 26, burst.x, launchY, 1.2, hexToRgb("#ffffff"), 0.42);
    drawTrailDots(rgba, burst.launchX, HEIGHT - 26, burst.x, launchY, 6, 4, burst.accent, 0.1 + (launch * 0.14));

    if (burstProgress > 0.01) {
      for (let ray = 0; ray < burst.rayCount; ray += 1) {
        const angle = (ray / burst.rayCount) * TAU;
        const jitter = 0.8 + (0.28 * Math.sin((ray * 1.7) + (burst.phase * 7)));
        const outerX = burst.x + (Math.cos(angle) * rayLength * jitter);
        const outerY = burst.y + (Math.sin(angle) * rayLength * jitter);
        const innerX = burst.x + (Math.cos(angle) * rayLength * 0.18);
        const innerY = burst.y + (Math.sin(angle) * rayLength * 0.18);
        drawCapsule(rgba, innerX, innerY, outerX, outerY, ray === 0 ? 4.2 : 2.8, burst.color, rayAlpha * 0.94);
        drawCapsule(rgba, innerX, innerY, outerX, outerY, 1.2, burst.accent, rayAlpha * 0.9);
        drawTrailDots(rgba, innerX, innerY, outerX, outerY, 4, 3.2, burst.accent, rayAlpha * 0.16);
        drawCircle(rgba, outerX, outerY, 2.6 + ((ray % 4) * 0.65), burst.accent, rayAlpha * 0.92);
      }

      drawShockwave(rgba, burst.x, burst.y, rayLength * 0.72, burst.accent, rayAlpha * 0.9);
      drawShockwave(rgba, burst.x, burst.y, Math.max(28, rayLength * 0.34), burst.color, rayAlpha * 0.64);
      drawSpark(rgba, burst.x, burst.y, 22 + (rayLength * 0.04), burst.accent, rayAlpha * 0.48);
      drawCircle(rgba, burst.x, burst.y, 18 + (rayLength * 0.04), burst.accent, rayAlpha * 0.18);

      for (let ember = 0; ember < Math.floor(burst.rayCount * 1.3); ember += 1) {
        const angle = ((ember / Math.floor(burst.rayCount * 1.3)) * TAU) + (burst.phase * 4);
        const distance = rayLength * (0.28 + ((ember % 6) * 0.1));
        drawCircle(
          rgba,
          burst.x + (Math.cos(angle) * distance),
          burst.y + (Math.sin(angle) * distance),
          2.2 + ((ember % 3) * 0.55),
          burst.color,
          rayAlpha * 0.72,
        );
      }
    }
  }

  return rgba;
};

const getChaosBallPosition = (ball, time) => {
  const xOsc = 0.5 + (0.5 * Math.sin((time * TAU * ball.speedX) + (ball.phaseX * TAU)));
  const yOsc = triangleWave((time * ball.speedY) + ball.phaseY);
  const arc = Math.sin((time * TAU * 1.3) + (ball.phaseZ * TAU)) * ball.arc;

  return {
    x: mix(ball.minX, ball.maxX, xOsc),
    y: mix(ball.minY, ball.maxY, yOsc) + arc,
  };
};

const renderBingoBallChaos = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const positions = chaosBalls
    .map((ball) => ({ ball, ...getChaosBallPosition(ball, time) }))
    .sort((a, b) => a.y - b.y);

  for (const entry of positions) {
    const last = getChaosBallPosition(entry.ball, time - 0.02);
    const older = getChaosBallPosition(entry.ball, time - 0.05);
    drawCapsule(rgba, older.x, older.y, last.x, last.y, entry.ball.radius * 0.26, entry.ball.body.color, 0.08);

    for (let trail = 4; trail >= 1; trail -= 1) {
      const trailPosition = getChaosBallPosition(entry.ball, time - (trail * 0.028));
      drawCircle(
        rgba,
        trailPosition.x,
        trailPosition.y,
        entry.ball.radius * (0.66 - (trail * 0.08)),
        entry.ball.body.color,
        0.12 / trail,
      );
    }

    drawTrailDots(rgba, last.x, last.y, entry.x, entry.y, 4, entry.ball.radius * 0.16, hexToRgb("#ffffff"), 0.08);
    drawBingoBall(rgba, entry.x, entry.y, entry.ball.radius, entry.ball.body.color, entry.ball.body.digit, 0.98);
    drawSpark(
      rgba,
      entry.x + (entry.ball.radius * 0.78),
      entry.y - (entry.ball.radius * 0.72),
      5.4,
      hexToRgb("#ffffff"),
      0.34,
    );
  }

  for (let index = 0; index < positions.length; index += 1) {
    for (let compare = index + 1; compare < positions.length; compare += 1) {
      const a = positions[index];
      const b = positions[compare];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < ((a.ball.radius + b.ball.radius) * 1.14)) {
        const hitX = (a.x + b.x) * 0.5;
        const hitY = (a.y + b.y) * 0.5;
        drawSpark(rgba, hitX, hitY, 14, hexToRgb("#fff2c1"), 0.54);
        drawShockwave(rgba, hitX, hitY, 24, hexToRgb("#f5c65b"), 0.4);

        for (let burst = 0; burst < 8; burst += 1) {
          const angle = ((burst / 8) * TAU) + (time * TAU * 0.8);
          const distanceOut = 14 + ((burst % 3) * 8);
          drawSpark(
            rgba,
            hitX + (Math.cos(angle) * distanceOut),
            hitY + (Math.sin(angle) * distanceOut),
            4 + (burst % 2),
            sparklePalette[burst % sparklePalette.length],
            0.42,
          );
        }
      }
    }
  }

  for (let burst = 0; burst < 24; burst += 1) {
    const angle = ((burst / 24) * TAU) + (time * TAU * 0.28);
    const radius = 88 + ((burst % 4) * 24);
    drawSpark(
      rgba,
      (WIDTH * 0.5) + (Math.cos(angle) * radius),
      HEIGHT - 166 + (Math.sin(angle) * radius * 0.48),
      4.6,
      sparklePalette[burst % sparklePalette.length],
      0.44,
    );
  }

  return rgba;
};

const renderJackpotPop = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT - 96;
  const flashPulse = 0.56 + (0.44 * Math.sin(time * TAU));

  drawSpark(rgba, originX, originY - 18, 28 + (flashPulse * 10), hexToRgb("#fff6d8"), 0.5);
  drawShockwave(rgba, originX, originY - 20, 98 + (flashPulse * 28), hexToRgb("#f5c65b"), 0.32);
  drawShockwave(rgba, originX, originY - 20, 168 + (flashPulse * 34), hexToRgb("#58c7ff"), 0.14);

  for (let streak = 0; streak < 12; streak += 1) {
    const angle = (-Math.PI * 0.92) + ((streak / 11) * (Math.PI * 0.84));
    const length = 120 + ((streak % 4) * 30) + (flashPulse * 18);
    drawCapsule(
      rgba,
      originX,
      originY - 10,
      originX + (Math.cos(angle) * length),
      originY - 12 + (Math.sin(angle) * length),
      2 + (streak % 2),
      streak % 3 === 0 ? hexToRgb("#58c7ff") : hexToRgb("#f5c65b"),
      0.08,
    );
  }

  for (const coin of jackpotCoins) {
    const local = mod01(time + coin.offset);
    const progress = local / coin.flight;
    if (progress > 1) continue;
    const eased = easeOutCubic(progress);
    const previous = Math.max(0, progress - 0.036);
    const previousEased = easeOutQuad(previous);
    const x = originX + (Math.cos(coin.angle) * coin.speed * eased) + (coin.drift * progress);
    const y = originY + (Math.sin(coin.angle) * coin.speed * eased) + (coin.gravity * progress * progress * 0.48);
    const previousX = originX + (Math.cos(coin.angle) * coin.speed * previousEased) + (coin.drift * previous);
    const previousY = originY + (Math.sin(coin.angle) * coin.speed * previousEased) + (coin.gravity * previous * previous * 0.48);
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.9 ? (1 - progress) / 0.1 : 1);

    drawTrailDots(rgba, previousX, previousY, x, y, 4, coin.radius * 0.18, hexToRgb("#fff1bc"), alpha * 0.22);
    drawCircle(rgba, x - 8, y + 10, coin.radius * 0.84, hexToRgb("#f5c65b"), alpha * 0.12);
    drawCoin(rgba, x, y, coin.radius, alpha, progress * TAU * coin.spin);
  }

  for (const shard of jackpotShards) {
    const local = mod01(time + shard.offset);
    const progress = local / shard.flight;
    if (progress > 1) continue;
    const eased = easeOutQuad(progress);
    const x = originX + (Math.cos(shard.angle) * shard.speed * eased) + (shard.drift * progress);
    const y = originY + (Math.sin(shard.angle) * shard.speed * eased) + (shard.gravity * progress * progress * 0.52);
    const alpha = clamp(1 - progress);

    if (shard.type === "diamond") {
      drawDiamond(rgba, x, y, shard.size, progress * TAU, shard.color, alpha * 0.9);
    } else {
      drawSpark(rgba, x, y, shard.size, shard.color, alpha * 0.96);
    }
  }

  for (const dust of jackpotDust) {
    const local = mod01(time + dust.offset);
    const progress = local / dust.flight;
    if (progress > 1) continue;
    const eased = easeOutBack(progress);
    const x = originX + (Math.cos(dust.angle) * dust.speed * eased) + (dust.drift * progress);
    const y = originY + (Math.sin(dust.angle) * dust.speed * eased) + (dust.gravity * progress * progress * 0.42);
    const alpha = clamp(1 - progress);
    drawSpark(rgba, x, y, dust.size, dust.color, alpha * 0.44);
  }

  return rgba;
};

const renderPrismConfettiRush = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const origins = [
    { x: WIDTH * 0.24, y: HEIGHT - 116, phase: 0.02, spin: 1 },
    { x: WIDTH * 0.76, y: HEIGHT - 116, phase: 0.34, spin: -1 },
  ];
  const corePulse = 0.52 + (0.48 * Math.sin(time * TAU * 1.3));

  drawSpark(rgba, WIDTH * 0.5, HEIGHT - 148, 28 + (corePulse * 10), hexToRgb("#fff6dc"), 0.3);
  drawShockwave(rgba, WIDTH * 0.5, HEIGHT - 152, 164 + (corePulse * 36), hexToRgb("#58c7ff"), 0.12);

  origins.forEach((origin, originIndex) => {
    drawShockwave(rgba, origin.x, origin.y - 4, 122 + (corePulse * 24), originIndex === 0 ? hexToRgb("#ff4fd8") : hexToRgb("#58c7ff"), 0.18);
    drawShockwave(rgba, origin.x, origin.y - 8, 182 + (corePulse * 26), hexToRgb("#f5c65b"), 0.1);
  });

  for (let pieceIndex = 0; pieceIndex < confettiPieces.length; pieceIndex += 1) {
    const piece = confettiPieces[pieceIndex];
    const origin = origins[pieceIndex % origins.length];
    const local = mod01(time + piece.offset + origin.phase);
    const progress = local / piece.flight;
    if (progress > 1) continue;

    const eased = easeOutBack(progress);
    const previous = Math.max(0, progress - 0.05);
    const previousEased = easeOutQuad(previous);
    const angle = piece.angle + (origin.spin * 0.2);
    const x = origin.x + (Math.cos(angle) * piece.speed * 0.94 * eased) + (piece.drift * progress);
    const y = origin.y + (Math.sin(angle) * piece.speed * 0.94 * eased) + (piece.gravity * progress * progress * 0.44) - (Math.sin(progress * Math.PI) * 24);
    const previousX = origin.x + (Math.cos(angle) * piece.speed * 0.94 * previousEased) + (piece.drift * previous);
    const previousY = origin.y + (Math.sin(angle) * piece.speed * 0.94 * previousEased) + (piece.gravity * previous * previous * 0.44) - (Math.sin(previous * Math.PI) * 24);
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.9 ? (1 - progress) / 0.1 : 1);
    const rotation = piece.baseRotation + (piece.spin * progress * TAU * origin.spin);

    if (progress > 0.03) {
      drawTrailDots(rgba, previousX, previousY, x, y, 4, Math.max(1.6, piece.height * 0.26), piece.color, alpha * 0.14);
    }

    drawConfettiSprite(rgba, x, y, piece.width, piece.height, rotation, piece.type, piece.color, alpha);
  }

  for (const streamer of confettiStreamers) {
    const local = mod01(time + streamer.offset);
    const progress = local / streamer.flight;
    if (progress > 1) continue;

    const side = streamer.offset > 0.5 ? origins[1] : origins[0];
    const angle = streamer.angle + (side === origins[0] ? -0.12 : 0.12);
    const eased = easeOutBack(progress);
    const x = side.x + (Math.cos(angle) * streamer.speed * 0.82 * eased);
    const y = side.y + (Math.sin(angle) * streamer.speed * 0.82 * eased) + (streamer.gravity * progress * progress * 0.46);
    const wave = Math.sin((progress * TAU * 2.8) + streamer.baseRotation) * streamer.wave;
    const alpha = clamp(1 - (progress * 0.88));
    drawConfettiSprite(
      rgba,
      x + wave,
      y,
      streamer.width * 0.92,
      streamer.height,
      streamer.baseRotation + (streamer.spin * progress),
      "rect",
      streamer.color,
      alpha * 0.9,
    );
  }

  for (const faller of confettiFallers) {
    const progress = mod01((time * (faller.speed * 0.8)) + faller.offset);
    const x = faller.x + (Math.sin((progress * TAU * 1.2) + faller.phase) * faller.sway);
    const y = -48 + (progress * (HEIGHT + 96));
    const alpha = clamp(progress < 0.1 ? progress / 0.1 : progress > 0.94 ? (1 - progress) / 0.06 : 1) * 0.76;
    drawConfettiSprite(
      rgba,
      x,
      y,
      faller.size * 1.14,
      faller.size * 0.46,
      faller.phase + (progress * TAU * faller.spin),
      faller.type,
      faller.color,
      alpha,
    );
  }

  return rgba;
};

const renderNeonStreamerDrop = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const anchors = [WIDTH * 0.16, WIDTH * 0.5, WIDTH * 0.84];

  anchors.forEach((anchor, index) => {
    const glow = 0.42 + (0.58 * Math.sin((time * TAU * 1.2) + index));
    drawSpark(rgba, anchor, 116, 18 + (glow * 10), index === 1 ? hexToRgb("#f5c65b") : sparklePalette[index], 0.2 + (glow * 0.08));
    drawShockwave(rgba, anchor, 110, 62 + (glow * 12), index === 2 ? hexToRgb("#58c7ff") : hexToRgb("#ff4fd8"), 0.08);
  });

  for (let streamerIndex = 0; streamerIndex < confettiStreamers.length; streamerIndex += 1) {
    const streamer = confettiStreamers[streamerIndex];
    const progress = mod01((time * 0.88) + streamer.offset);
    const previous = mod01(((time - 0.032) * 0.88) + streamer.offset);
    const anchor = anchors[streamerIndex % anchors.length];
    const x = anchor + (Math.sin((progress * TAU * 1.1) + streamer.baseRotation) * (18 + streamer.wave));
    const y = -126 + (progress * (HEIGHT + 224));
    const previousX = anchor + (Math.sin((previous * TAU * 1.1) + streamer.baseRotation) * (18 + streamer.wave));
    const previousY = -126 + (previous * (HEIGHT + 224));
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.94 ? (1 - progress) / 0.06 : 1) * 0.9;

    drawCapsule(rgba, previousX, previousY, x, y, Math.max(1.2, streamer.height * 0.2), streamer.color, alpha * 0.18);
    drawConfettiSprite(
      rgba,
      x,
      y,
      streamer.width * 0.76,
      streamer.height * 1.22,
      streamer.baseRotation + (progress * streamer.spin * 1.6),
      "rect",
      streamer.color,
      alpha,
    );
  }

  for (const piece of confettiFallers) {
    const progress = mod01((time * (piece.speed * 1.12)) + piece.offset);
    const x = piece.x + (Math.sin((progress * TAU * 1.6) + piece.phase) * piece.sway * 0.6);
    const y = -36 + (progress * (HEIGHT + 82));
    const alpha = clamp(progress < 0.06 ? progress / 0.06 : progress > 0.95 ? (1 - progress) / 0.05 : 1) * 0.84;
    drawConfettiSprite(
      rgba,
      x,
      y,
      piece.size * 0.96,
      piece.size * 0.42,
      piece.phase + (progress * TAU * piece.spin * 1.2),
      piece.type,
      piece.color,
      alpha,
    );
  }

  for (let sparkIndex = 0; sparkIndex < confettiSparks.length; sparkIndex += 1) {
    const spark = confettiSparks[sparkIndex];
    const progress = mod01((time * 0.96) + spark.offset);
    const column = anchors[sparkIndex % anchors.length];
    const x = column + (Math.sin((progress * TAU * 1.4) + spark.offset) * 46) + (spark.drift * 0.3);
    const y = -24 + (progress * (HEIGHT + 48));
    const alpha = clamp(progress > 0.92 ? (1 - progress) / 0.08 : 1) * 0.48;
    drawTrailDots(rgba, x, y - 18, x, y, 3, spark.size * 0.24, spark.color, alpha * 0.22);
    drawSpark(rgba, x, y, spark.size * 0.82, spark.color, alpha * 0.9);
  }

  return rgba;
};

const renderVelvetHeartPulse = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.44;
  const pulse = 0.5 + (0.5 * Math.sin(time * TAU * 1.16));
  const bloom = 0.5 + (0.5 * Math.sin((time * TAU * 1.04) - 0.36));
  const heartPoint = (param, scale = 8.2) => {
    const heartX = 16 * (Math.sin(param) ** 3);
    const heartY = (13 * Math.cos(param)) - (5 * Math.cos(2 * param)) - (2 * Math.cos(3 * param)) - Math.cos(4 * param);
    return {
      x: heartX * scale,
      y: -heartY * scale * 0.92,
    };
  };

  drawShockwave(rgba, centerX, centerY + 8, 236 + (pulse * 22), hexToRgb("#ff63c7"), 0.1);
  drawShockwave(rgba, centerX, centerY + 8, 316 + (bloom * 28), hexToRgb("#8f5bff"), 0.06);
  drawShockwave(rgba, centerX, centerY + 8, 404 + (bloom * 24), hexToRgb("#fff0d9"), 0.03);

  for (let outline = 0; outline < 78; outline += 1) {
    const param = (outline / 78) * TAU;
    const target = heartPoint(param, 17.6 + ((outline % 4) * 0.8));
    const local = mod01((time * 0.68) + (outline * 0.029));
    const previous = mod01(((time - 0.035) * 0.68) + (outline * 0.029));
    const rise = easeOutCubic(clamp(local / 0.76));
    const previousRise = easeOutCubic(clamp(previous / 0.76));
    const lane = outline % 2 === 0 ? -1 : 1;
    const startX = centerX + (lane * (28 + ((outline % 5) * 26)));
    const startY = HEIGHT + 72 + ((outline % 6) * 18);
    const previousX = mix(startX, centerX + target.x, previousRise) + (Math.sin((previous * TAU * 2.2) + outline) * (1 - previousRise) * 58);
    const previousY = mix(startY, centerY + target.y, previousRise) - (Math.sin(previousRise * Math.PI) * (154 + ((outline % 4) * 18)));
    const x = mix(startX, centerX + target.x, rise) + (Math.sin((local * TAU * 2.2) + outline) * (1 - rise) * 58);
    const y = mix(startY, centerY + target.y, rise) - (Math.sin(rise * Math.PI) * (154 + ((outline % 4) * 18)));
    const settle = clamp((local - 0.76) / 0.24);
    const alpha = clamp(local < 0.08 ? local / 0.08 : 1) * (0.8 + (settle * 0.18));
    const size = 13.6 + ((outline % 3) * 4.6) + (settle * 3.6);
    const rotation = (local * TAU * 2.4) + (outline * 0.58);
    const color = heartPulsePalette[outline % heartPulsePalette.length];

    drawTrailDots(rgba, previousX, previousY, x, y, 5, 2.6, hexToRgb("#fff3dc"), alpha * 0.16);
    drawConfettiSprite(rgba, x, y, size * 1.28, Math.max(4.2, size * 0.72), rotation, outline % 4 === 0 ? "diamond" : "rect", color, alpha);
    if (settle > 0.04) {
      drawSpark(rgba, centerX + target.x, centerY + target.y, 3.2 + ((outline % 2) * 1.2), outline % 5 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#fff8eb"), settle * 0.18);
    }
  }

  for (let fill = 0; fill < 52; fill += 1) {
    const param = (fill / 52) * TAU;
    const target = heartPoint(param, 14.2 + ((fill % 3) * 0.44));
    const local = mod01((time * 0.64) + 0.18 + (fill * 0.032));
    const previous = mod01(((time - 0.032) * 0.64) + 0.18 + (fill * 0.032));
    const rise = easeOutCubic(clamp(local / 0.78));
    const previousRise = easeOutCubic(clamp(previous / 0.78));
    const startX = centerX + (((fill % 2 === 0 ? -1 : 1) * (42 + ((fill % 4) * 20))));
    const startY = HEIGHT + 46 + ((fill % 4) * 18);
    const x = mix(startX, centerX + target.x, rise) + (Math.sin((local * TAU * 1.9) + fill) * (1 - rise) * 34);
    const y = mix(startY, centerY + target.y, rise) - (Math.sin(rise * Math.PI) * (116 + ((fill % 5) * 12)));
    const previousX = mix(startX, centerX + target.x, previousRise) + (Math.sin((previous * TAU * 1.9) + fill) * (1 - previousRise) * 34);
    const previousY = mix(startY, centerY + target.y, previousRise) - (Math.sin(previousRise * Math.PI) * (116 + ((fill % 5) * 12)));
    const settle = clamp((local - 0.72) / 0.28);
    const alpha = clamp(local < 0.1 ? local / 0.1 : 1) * (0.46 + (settle * 0.16));
    const size = 9.6 + ((fill % 3) * 2.8);
    const color = fill % 6 === 0 ? hexToRgb("#f5c65b") : heartPulsePalette[(fill + 2) % heartPulsePalette.length];

    drawTrailDots(rgba, previousX, previousY, x, y, 4, 2, hexToRgb("#fff4e2"), alpha * 0.16);
    drawConfettiSprite(rgba, x, y, size * 1.16, Math.max(3.8, size * 0.7), (local * TAU * 2) + fill, fill % 3 === 0 ? "diamond" : "rect", color, alpha);
  }

  for (let spray = 0; spray < 32; spray += 1) {
    const local = mod01((time * 0.9) + (spray * 0.041));
    const previous = mod01(((time - 0.032) * 0.9) + (spray * 0.041));
    const rise = easeOutCubic(clamp(local / 0.7));
    const previousRise = easeOutCubic(clamp(previous / 0.7));
    const lane = spray % 2 === 0 ? -1 : 1;
    const sway = 22 + ((spray % 4) * 10);
    const startX = centerX + (lane * (10 + ((spray % 4) * 12)));
    const x = startX + (Math.sin((local * TAU * 1.6) + spray) * sway * (1 - rise));
    const previousX = startX + (Math.sin((previous * TAU * 1.6) + spray) * sway * (1 - previousRise));
    const y = HEIGHT - 48 - (rise * 548) - (Math.sin(local * Math.PI) * (42 + ((spray % 5) * 6)));
    const previousY = HEIGHT - 48 - (previousRise * 548) - (Math.sin(previous * Math.PI) * (42 + ((spray % 5) * 6)));
    const alpha = clamp(1 - (rise * 0.26)) * 0.38;
    const color = spray % 5 === 0 ? hexToRgb("#f5c65b") : heartPulsePalette[spray % heartPulsePalette.length];

    drawTrailDots(rgba, previousX, previousY, x, y, 4, 2.2, hexToRgb("#fff1df"), alpha * 0.18);
    drawConfettiSprite(rgba, x, y, 10 + ((spray % 3) * 2), 5 + ((spray % 2) * 1.4), (local * TAU * 2.8) + spray, spray % 3 === 0 ? "diamond" : "rect", color, alpha);
  }

  for (let sparkle = 0; sparkle < 48; sparkle += 1) {
    const param = ((sparkle / 48) * TAU) + (time * TAU * 0.05);
    const point = heartPoint(param, 15.6 + ((sparkle % 4) * 0.46));
    const alpha = 0.1 + (0.08 * Math.sin((time * TAU * 1.2) + sparkle));
    drawSpark(rgba, centerX + point.x, centerY + point.y, 3.4 + ((sparkle % 3) * 0.9), sparkle % 5 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#fff8eb"), clamp(alpha));
  }

  return rgba;
};

const renderCupidSparkDrift = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (const heart of cupidDriftHearts) {
    const progress = mod01((time * heart.speed) + heart.offset);
    const previous = mod01(((time - 0.03) * heart.speed) + heart.offset);
    const x = -120 + (progress * (WIDTH + 240)) + (Math.sin((progress * TAU * 1.3) + heart.startX) * heart.sway);
    const y = heart.startY + (Math.cos((progress * TAU * 0.9) + heart.offset) * 28) - (progress * heart.rise);
    const previousX = -120 + (previous * (WIDTH + 240)) + (Math.sin((previous * TAU * 1.3) + heart.startX) * heart.sway);
    const previousY = heart.startY + (Math.cos((previous * TAU * 0.9) + heart.offset) * 28) - (previous * heart.rise);
    const size = heart.size * heart.depth * (0.92 + (0.08 * Math.sin((progress * TAU * 2) + heart.offset)));
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.92 ? (1 - progress) / 0.08 : 1) * 0.96;

    drawTrailDots(rgba, previousX, previousY, x, y, 4, Math.max(2.2, size * 0.08), hexToRgb("#fff4d4"), alpha * 0.18);
    drawHeartFill(rgba, x, y, size + 8, hexToRgb("#fff0d8"), alpha * 0.08);
    drawGlossyHeart(rgba, x, y, size, heart.color, alpha);
    drawSpark(rgba, x + (size * 0.24), y - (size * 0.18), Math.max(2.8, size * 0.12), hexToRgb("#fff9e4"), alpha * 0.32);
  }

  for (const glint of heartGlints) {
    const progress = mod01((time * 0.72) + glint.offset);
    const x = -24 + (progress * (WIDTH + 48));
    const y = 160 + (Math.sin((progress * TAU) + glint.phase) * 120) + (glint.y * 0.34);
    const alpha = 0.18 + (0.18 * Math.sin((time * TAU * 1.4) + glint.phase));
    drawSpark(rgba, x, y, glint.size * 0.92, luckyPalette[Math.floor(glint.offset * luckyPalette.length) % luckyPalette.length], clamp(alpha));
  }

  return rgba;
};

const renderStarlightRocketPop = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (const burst of rocketBursts) {
    const local = mod01(time + burst.phase);
    const launch = clamp(local / 0.18);
    const burstProgress = clamp((local - 0.1) / 0.64);
    const radius = burst.radius * easeOutBack(burstProgress);
    const alpha = clamp(1 - burstProgress) * 0.98;
    const launchY = mix(HEIGHT - 28, burst.y, launch);

    drawCapsule(rgba, burst.launchX, HEIGHT - 28, burst.x, launchY, 4.2, burst.color, 0.14);
    drawCapsule(rgba, burst.launchX, HEIGHT - 28, burst.x, launchY, 2.2, burst.accent, 0.5);
    drawTrailDots(rgba, burst.launchX, HEIGHT - 28, burst.x, launchY, 5, 3.4, burst.accent, 0.1 + (launch * 0.14));

    if (burstProgress > 0.01) {
      drawBurstRays(rgba, burst.x, burst.y, radius, burst.rayCount, burst.color, burst.accent, alpha, burst.phase * TAU, 1);
      drawShockwave(rgba, burst.x, burst.y, Math.max(24, radius * 0.58), burst.accent, alpha * 0.82);
      drawSpark(rgba, burst.x, burst.y, 18 + (radius * 0.04), burst.accent, alpha * 0.36);
    }
  }

  for (const glint of heartGlints) {
    const pulse = 0.2 + (0.18 * Math.sin((time * TAU * 1.8) + glint.phase));
    drawSpark(rgba, glint.x, glint.y, glint.size * 0.9, luckyPalette[Math.floor(glint.offset * luckyPalette.length) % luckyPalette.length], clamp(pulse));
  }

  return rgba;
};

const renderAuroraMiniFireworks = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (const burst of auroraBursts) {
    const local = mod01(time + burst.phase);
    const launch = clamp(local / 0.16);
    const burstProgress = clamp((local - 0.08) / 0.7);
    const radius = burst.radius * easeOutBack(burstProgress);
    const alpha = clamp(1 - burstProgress) * 0.92;
    const launchY = mix(HEIGHT - 18, burst.y, launch);

    drawCapsule(rgba, burst.launchX, HEIGHT - 18, burst.x, launchY, 3.4, burst.color, 0.08);
    drawCapsule(rgba, burst.launchX, HEIGHT - 18, burst.x, launchY, 1.4, burst.accent, 0.34);

    if (burstProgress > 0.01) {
      drawBurstRays(rgba, burst.x, burst.y, radius, burst.rayCount, burst.color, burst.accent, alpha, burst.phase * TAU, 0.82);
      drawShockwave(rgba, burst.x, burst.y, Math.max(18, radius * 0.52), burst.accent, alpha * 0.58);
      drawSpark(rgba, burst.x, burst.y, 12 + (radius * 0.04), burst.accent, alpha * 0.28);
    }
  }

  for (let streak = 0; streak < 16; streak += 1) {
    const angle = ((streak / 16) * TAU) + (time * TAU * 0.08);
    const radius = 120 + ((streak % 4) * 24);
    drawSpark(rgba, (WIDTH * 0.5) + (Math.cos(angle) * radius), HEIGHT - 184 + (Math.sin(angle) * radius * 0.3), 4.8, luckyPalette[streak % luckyPalette.length], 0.26);
  }

  return rgba;
};

const renderLuckyBallParade = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (const ball of paradeBalls) {
    const progress = mod01((time * ball.speed) + ball.offset);
    const previous = mod01(((time - 0.028) * ball.speed) + ball.offset);
    const x = ball.laneX + (Math.sin((progress * TAU * ball.drift) + ball.phase) * ball.sway);
    const y = HEIGHT + 120 - (progress * ball.rise) + (Math.sin((progress * TAU * 1.8) + ball.phase) * 18);
    const previousX = ball.laneX + (Math.sin((previous * TAU * ball.drift) + ball.phase) * ball.sway);
    const previousY = HEIGHT + 120 - (previous * ball.rise) + (Math.sin((previous * TAU * 1.8) + ball.phase) * 18);
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.92 ? (1 - progress) / 0.08 : 1) * 0.98;

    drawCapsule(rgba, previousX, previousY, x, y, ball.radius * 0.24, ball.body.color, alpha * 0.08);
    drawTrailDots(rgba, previousX, previousY, x, y, 4, ball.radius * 0.14, hexToRgb("#ffffff"), alpha * 0.12);
    drawBingoBall(rgba, x, y, ball.radius, ball.body.color, ball.body.digit, alpha);
    drawSpark(rgba, x + (ball.radius * 0.72), y - (ball.radius * 0.64), 5.2, hexToRgb("#ffffff"), alpha * 0.32);
  }

  for (let spark = 0; spark < 28; spark += 1) {
    const angle = ((spark / 28) * TAU) + (time * TAU * 0.24);
    const radius = 92 + ((spark % 5) * 20);
    drawSpark(rgba, (WIDTH * 0.5) + (Math.cos(angle) * radius), HEIGHT - 152 + (Math.sin(angle) * radius * 0.42), 4.2, luckyPalette[spark % luckyPalette.length], 0.32);
  }

  return rgba;
};

const renderTurboBallBounce = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (const ball of turboBounceBalls) {
    const progress = mod01((time * ball.speed) + ball.phase);
    const previous = mod01(((time - 0.024) * ball.speed) + ball.phase);
    const xOsc = 0.5 + (0.5 * Math.sin((progress * TAU * ball.swing) + (ball.phase * TAU)));
    const previousXOsc = 0.5 + (0.5 * Math.sin((previous * TAU * ball.swing) + (ball.phase * TAU)));
    const x = mix(ball.minX, ball.maxX, xOsc);
    const previousX = mix(ball.minX, ball.maxX, previousXOsc);
    const bounce = Math.abs(Math.sin(progress * TAU * 1.24)) * ball.bounce;
    const previousBounce = Math.abs(Math.sin(previous * TAU * 1.24)) * ball.bounce;
    const y = ball.floorY - bounce + (Math.sin((progress * TAU * 2) + ball.phase) * ball.arc);
    const previousY = ball.floorY - previousBounce + (Math.sin((previous * TAU * 2) + ball.phase) * ball.arc);

    drawCapsule(rgba, previousX, previousY, x, y, ball.radius * 0.28, ball.body.color, 0.08);
    drawTrailDots(rgba, previousX, previousY, x, y, 5, ball.radius * 0.18, hexToRgb("#ffffff"), 0.12);
    drawBingoBall(rgba, x, y, ball.radius, ball.body.color, ball.body.digit, 0.98);

    if (bounce < 12) {
      drawShockwave(rgba, x, ball.floorY + (ball.radius * 0.38), ball.radius * 0.9, hexToRgb("#f5c65b"), 0.28);
      drawSpark(rgba, x, ball.floorY - 6, 12, hexToRgb("#fff3cf"), 0.2);
    }
  }

  for (let ring = 0; ring < 18; ring += 1) {
    const angle = ((ring / 18) * TAU) + (time * TAU * 0.32);
    drawSpark(rgba, (WIDTH * 0.5) + (Math.cos(angle) * 132), HEIGHT - 176 + (Math.sin(angle) * 42), 4.4, sparklePalette[ring % sparklePalette.length], 0.3);
  }

  return rgba;
};

const renderCloverStarfall = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (const clover of cloverField) {
    const progress = mod01((time * clover.speed) + clover.offset);
    const previous = mod01(((time - 0.03) * clover.speed) + clover.offset);
    const x = clover.x + (Math.sin((progress * TAU * 1.3) + clover.phase) * clover.sway);
    const y = -140 + (progress * (HEIGHT + 280));
    const previousX = clover.x + (Math.sin((previous * TAU * 1.3) + clover.phase) * clover.sway);
    const previousY = -140 + (previous * (HEIGHT + 280));
    const alpha = clamp(progress < 0.1 ? progress / 0.1 : progress > 0.92 ? (1 - progress) / 0.08 : 1) * 0.88;

    drawTrailDots(rgba, previousX, previousY, x, y, 4, Math.max(2.4, clover.size * 0.1), hexToRgb("#fff6dd"), alpha * 0.12);
    drawLuckyClover(rgba, x, y, clover.size, clover.color, alpha);
  }

  for (const dust of heartDust) {
    const progress = mod01((time * 0.78) + dust.offset);
    const x = dust.x + (Math.sin((progress * TAU * 1.2) + dust.phase) * dust.drift);
    const y = -30 + (progress * (HEIGHT + 60));
    const alpha = clamp(progress > 0.94 ? (1 - progress) / 0.06 : 1) * 0.4;
    drawSpark(rgba, x, y, dust.size * 0.9, luckyPalette[Math.floor(dust.offset * luckyPalette.length) % luckyPalette.length], alpha);
  }

  return rgba;
};

const renderBonusSparkShower = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const originX = WIDTH * 0.5;
  const originY = 82;
  const pulse = 0.52 + (0.48 * Math.sin(time * TAU * 1.24));

  drawSpark(rgba, originX, originY, 18 + (pulse * 10), hexToRgb("#fff5d8"), 0.28);
  drawShockwave(rgba, originX, originY + 8, 84 + (pulse * 18), hexToRgb("#f5c65b"), 0.16);

  for (const coin of bonusShowerCoins) {
    const local = mod01(time + coin.offset);
    const progress = local / coin.flight;
    if (progress > 1) continue;
    const eased = easeOutQuad(progress);
    const previous = Math.max(0, progress - 0.036);
    const previousEased = easeOutQuad(previous);
    const x = originX + (Math.cos(coin.angle) * coin.speed * eased) + (coin.drift * progress);
    const y = originY + (Math.sin(coin.angle) * coin.speed * eased * 0.42) + (coin.gravity * progress * progress * 0.86);
    const previousX = originX + (Math.cos(coin.angle) * coin.speed * previousEased) + (coin.drift * previous);
    const previousY = originY + (Math.sin(coin.angle) * coin.speed * previousEased * 0.42) + (coin.gravity * previous * previous * 0.86);
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.9 ? (1 - progress) / 0.1 : 1);

    drawTrailDots(rgba, previousX, previousY, x, y, 4, coin.radius * 0.18, hexToRgb("#fff1bc"), alpha * 0.2);
    drawCoin(rgba, x, y, coin.radius, alpha, progress * TAU * coin.spin);
  }

  for (const shard of bonusShowerShards) {
    const local = mod01(time + shard.offset);
    const progress = local / shard.flight;
    if (progress > 1) continue;
    const eased = easeOutQuad(progress);
    const x = originX + (Math.cos(shard.angle) * shard.speed * eased) + (shard.drift * progress);
    const y = originY + (Math.sin(shard.angle) * shard.speed * eased * 0.46) + (shard.gravity * progress * progress * 0.92);
    const alpha = clamp(1 - progress);

    if (shard.type === "diamond") {
      drawDiamond(rgba, x, y, shard.size, progress * TAU, shard.color, alpha * 0.88);
    } else {
      drawSpark(rgba, x, y, shard.size, shard.color, alpha * 0.92);
    }
  }

  for (let sparkIndex = 0; sparkIndex < confettiSparks.length; sparkIndex += 1) {
    const spark = confettiSparks[sparkIndex];
    const progress = mod01((time * 0.92) + spark.offset);
    const x = originX + (Math.sin((progress * TAU * 1.7) + spark.offset) * 204) + (spark.drift * 0.18);
    const y = 24 + (progress * (HEIGHT * 0.72));
    const alpha = clamp(progress > 0.94 ? (1 - progress) / 0.06 : 1) * 0.34;
    drawSpark(rgba, x, y, spark.size * 0.72, luckyPalette[sparkIndex % luckyPalette.length], alpha);
  }

  return rgba;
};

const renderPixelConfettiBloom = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const emitters = [
    { x: WIDTH * 0.22, y: HEIGHT * 0.74, spread: -0.62 },
    { x: WIDTH * 0.5, y: HEIGHT * 0.68, spread: 0 },
    { x: WIDTH * 0.78, y: HEIGHT * 0.74, spread: 0.62 },
  ];
  const pulse = 0.5 + (0.5 * Math.sin(time * TAU * 1.18));

  drawShockwave(rgba, WIDTH * 0.5, HEIGHT * 0.7, 112 + (pulse * 16), hexToRgb("#58c7ff"), 0.08);
  drawShockwave(rgba, WIDTH * 0.5, HEIGHT * 0.7, 164 + (pulse * 22), hexToRgb("#f5c65b"), 0.06);

  for (let emitterIndex = 0; emitterIndex < emitters.length; emitterIndex += 1) {
    const emitter = emitters[emitterIndex];
    drawSpark(rgba, emitter.x, emitter.y - 12, 10 + (pulse * 4), emitterIndex === 1 ? hexToRgb("#fff7de") : confettiPalette[(emitterIndex * 2) % confettiPalette.length], 0.16);

    for (let pieceIndex = 0; pieceIndex < 28; pieceIndex += 1) {
      const seed = confettiPieces[(emitterIndex * 41 + pieceIndex * 5) % confettiPieces.length];
      const progress = mod01((time * 0.84) + seed.offset + (emitterIndex * 0.08));
      const angle = emitter.spread + ((pieceIndex / 27) - 0.5) * 1.02;
      const distance = 48 + (easeOutBack(progress) * (96 + ((pieceIndex % 5) * 32)));
      const previous = Math.max(0, progress - 0.04);
      const previousDistance = 48 + (easeOutQuad(previous) * (96 + ((pieceIndex % 5) * 32)));
      const x = emitter.x + (Math.cos(angle) * distance) + (Math.sin((progress * TAU * 1.4) + pieceIndex) * 8);
      const y = emitter.y + (Math.sin(angle) * distance * 0.76) + (progress * progress * 118);
      const previousX = emitter.x + (Math.cos(angle) * previousDistance) + (Math.sin((previous * TAU * 1.4) + pieceIndex) * 8);
      const previousY = emitter.y + (Math.sin(angle) * previousDistance * 0.76) + (previous * previous * 118);
      const alpha = clamp(1 - progress) * 0.76;
      const size = 10 + ((pieceIndex % 4) * 6);
      drawTrailDots(rgba, previousX, previousY, x, y, 3, 2.4, seed.color, alpha * 0.12);
      drawConfettiSprite(
        rgba,
        x,
        y,
        size,
        pieceIndex % 2 === 0 ? size * 0.64 : size,
        seed.baseRotation + (progress * seed.spin),
        pieceIndex % 3 === 0 ? "diamond" : "rect",
        seed.color,
        alpha,
      );
    }
  }

  for (let rain = 0; rain < 16; rain += 1) {
    const faller = confettiFallers[(rain * 7) % confettiFallers.length];
    const progress = mod01((time * 0.52) + faller.offset);
    const x = faller.x + (Math.sin((progress * TAU) + faller.phase) * faller.sway * 0.28);
    const y = -54 + (progress * (HEIGHT + 120));
    drawConfettiSprite(
      rgba,
      x,
      y,
      8 + ((rain % 3) * 5),
      8 + ((rain % 2) * 2),
      faller.phase + (progress * faller.spin * 0.7),
      rain % 4 === 0 ? "diamond" : "rect",
      confettiPalette[rain % confettiPalette.length],
      0.34,
    );
  }

  return rgba;
};

const renderRibbonNovaBurst = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const anchorX = WIDTH * 0.5;
  const anchorY = 124;
  const flare = 0.5 + (0.5 * Math.sin(time * TAU * 1.2));

  drawSpark(rgba, anchorX, anchorY, 18 + (flare * 8), hexToRgb("#fff7de"), 0.24);
  drawShockwave(rgba, anchorX, anchorY + 10, 72 + (flare * 18), hexToRgb("#8f5bff"), 0.08);

  for (let ribbon = 0; ribbon < 9; ribbon += 1) {
    const progress = mod01((time * 0.72) + (ribbon * 0.1));
    const previous = mod01(((time - 0.03) * 0.72) + (ribbon * 0.1));
    const x = anchorX + (Math.sin((progress * TAU * 1.6) + ribbon) * (78 + (ribbon * 10)));
    const y = -120 + (progress * (HEIGHT + 240));
    const previousX = anchorX + (Math.sin((previous * TAU * 1.6) + ribbon) * (78 + (ribbon * 10)));
    const previousY = -120 + (previous * (HEIGHT + 240));
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.92 ? (1 - progress) / 0.08 : 1) * 0.82;
    const rotation = Math.sin((progress * TAU * 1.4) + ribbon) * 0.46;
    const width = 74 + ((ribbon % 3) * 20);
    const color = ribbon % 3 === 0 ? hexToRgb("#8f5bff") : ribbon % 3 === 1 ? hexToRgb("#58c7ff") : hexToRgb("#ff4fd8");

    drawCapsule(rgba, previousX, previousY, x, y, 2.2, color, alpha * 0.14);
    drawRotatedRect(rgba, x, y, width, 7 + (ribbon % 2), rotation, color, alpha);
    drawRotatedRect(rgba, x, y, width * 0.38, 3.2, rotation, hexToRgb("#ffffff"), alpha * 0.18);
  }

  for (let spark = 0; spark < 24; spark += 1) {
    const angle = ((spark / 24) * TAU) + (time * TAU * 0.08);
    const radius = 48 + ((spark % 4) * 18);
    drawSpark(rgba, anchorX + (Math.cos(angle) * radius), anchorY + 24 + (Math.sin(angle) * radius * 0.72), 5 + (spark % 3), spark % 2 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#fff8e5"), 0.16);
  }

  return rgba;
};

const renderRoseHeartBloom = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.66;
  const pulse = 0.5 + (0.5 * Math.sin(time * TAU * 1.18));

  drawHeartFill(rgba, centerX, centerY, 142 + (pulse * 14), hexToRgb("#ff97df"), 0.16);
  drawGlossyHeart(rgba, centerX, centerY, 110 + (pulse * 10), hexToRgb("#ff63c7"), 0.94);

  for (let petal = 0; petal < 6; petal += 1) {
    const angle = (-Math.PI * 0.5) + ((petal / 6) * TAU) + (Math.sin((time * TAU * 0.8) + petal) * 0.08);
    const x = centerX + (Math.cos(angle) * 84);
    const y = centerY + (Math.sin(angle) * 52) - 16;
    const size = 54 + ((petal % 2) * 10);
    const color = petal % 3 === 0 ? hexToRgb("#f5c65b") : petal % 3 === 1 ? hexToRgb("#fff0d2") : hexToRgb("#ff95dd");
    drawHeartFill(rgba, x, y, size + 10, hexToRgb("#fff1df"), 0.06);
    drawGlossyHeart(rgba, x, y, size, color, 0.66);
  }

  for (let crown = 0; crown < 7; crown += 1) {
    const angle = (-Math.PI * 0.84) + ((crown / 6) * (Math.PI * 0.68));
    const radius = 154 + (Math.sin((time * TAU * 0.82) + crown) * 14);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY - 182 + (Math.sin(angle) * 88);
    const size = 20 + ((crown % 3) * 8);
    drawGlossyHeart(rgba, x, y, size, heartPulsePalette[crown % heartPulsePalette.length], 0.42);
  }

  for (let sparkle = 0; sparkle < 28; sparkle += 1) {
    const angle = ((sparkle / 28) * TAU) + (time * TAU * 0.08);
    const radius = 124 + ((sparkle % 4) * 20);
    drawSpark(rgba, centerX + (Math.cos(angle) * radius), centerY + (Math.sin(angle) * radius * 0.62), 5.2, sparkle % 6 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#fff8e8"), 0.16);
  }

  return rgba;
};

const renderHaloHeartSweep = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const startX = -84;
  const endX = WIDTH + 84;
  const startY = HEIGHT * 0.84;
  const endY = HEIGHT * 0.24;

  drawRing(rgba, WIDTH * 0.34, HEIGHT * 0.54, 112 + (Math.sin(time * TAU * 0.8) * 12), 4, hexToRgb("#8f5bff"), 0.06);
  drawRing(rgba, WIDTH * 0.34, HEIGHT * 0.54, 78 + (Math.sin(time * TAU * 1.1) * 8), 3, hexToRgb("#ff63c7"), 0.05);

  for (let heart = 0; heart < 13; heart += 1) {
    const progress = mod01((time * 0.58) + (heart * 0.08));
    const previous = mod01(((time - 0.03) * 0.58) + (heart * 0.08));
    const x = mix(startX, endX, progress) + (Math.sin((progress * TAU * 1.4) + heart) * 18);
    const y = mix(startY, endY, progress) + (Math.cos((progress * TAU * 1.2) + heart) * 16);
    const previousX = mix(startX, endX, previous) + (Math.sin((previous * TAU * 1.4) + heart) * 18);
    const previousY = mix(startY, endY, previous) + (Math.cos((previous * TAU * 1.2) + heart) * 16);
    const size = 20 + ((heart % 4) * 7);
    const alpha = clamp(progress < 0.08 ? progress / 0.08 : progress > 0.92 ? (1 - progress) / 0.08 : 1) * 0.84;

    drawTrailDots(rgba, previousX, previousY, x, y, 4, 2.6, hexToRgb("#fff1e0"), alpha * 0.12);
    drawGlossyHeart(rgba, x, y, size, heartPulsePalette[heart % heartPulsePalette.length], alpha);
  }

  for (let spark = 0; spark < 22; spark += 1) {
    const progress = mod01((time * 0.66) + (spark * 0.05));
    const x = mix(-40, WIDTH + 40, progress);
    const y = HEIGHT * 0.26 + (Math.sin((progress * TAU * 1.3) + spark) * 34);
    drawSpark(rgba, x, y, 4.4, spark % 5 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#fff8e8"), 0.12);
  }

  return rgba;
};

const renderCometFireworksSweep = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cometHeads = [
    { startX: 92, startY: HEIGHT - 72, endX: 242, endY: 260, color: hexToRgb("#58c7ff"), accent: hexToRgb("#dff6ff"), phase: 0.02 },
    { startX: WIDTH - 96, startY: HEIGHT - 90, endX: WIDTH - 214, endY: 212, color: hexToRgb("#ff8f45"), accent: hexToRgb("#fff0d7"), phase: 0.18 },
    { startX: 168, startY: HEIGHT - 112, endX: 404, endY: 174, color: hexToRgb("#ff4fd8"), accent: hexToRgb("#ffe2f8"), phase: 0.36 },
    { startX: WIDTH - 178, startY: HEIGHT - 118, endX: WIDTH - 362, endY: 196, color: hexToRgb("#f5c65b"), accent: hexToRgb("#fff5d8"), phase: 0.52 },
  ];

  for (let index = 0; index < cometHeads.length; index += 1) {
    const comet = cometHeads[index];
    const progress = mod01((time * 0.58) + comet.phase);
    const eased = easeOutCubic(progress);
    const previous = Math.max(0, progress - 0.04);
    const previousEased = easeOutQuad(previous);
    const x = mix(comet.startX, comet.endX, eased);
    const y = mix(comet.startY, comet.endY, eased);
    const previousX = mix(comet.startX, comet.endX, previousEased);
    const previousY = mix(comet.startY, comet.endY, previousEased);
    const alpha = clamp(1 - progress) * 0.8;
    drawCapsule(rgba, previousX, previousY, x, y, 3.4, comet.color, alpha * 0.16);
    drawTrailDots(rgba, previousX, previousY, x, y, 6, 3.4, comet.accent, alpha * 0.18);
    drawSpark(rgba, x, y, 10 + ((index % 2) * 4), comet.color, alpha);

    if (progress > 0.72) {
      const burstProgress = clamp((progress - 0.72) / 0.28);
      const radius = 28 + (easeOutBack(burstProgress) * 64);
      const burstAlpha = clamp(1 - burstProgress) * 0.72;
      drawBurstRays(rgba, comet.endX, comet.endY, radius, 12 + (index * 2), comet.color, comet.accent, burstAlpha, index * 0.7, 0.8);
      drawShockwave(rgba, comet.endX, comet.endY, radius * 0.54, comet.accent, burstAlpha * 0.58);
    }
  }

  return rgba;
};

const renderSkylineRocketCrown = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const launchers = [
    { x: 86, targetX: 116, targetY: 204, color: hexToRgb("#58c7ff"), accent: hexToRgb("#dff6ff"), phase: 0.02 },
    { x: 188, targetX: 222, targetY: 164, color: hexToRgb("#f5c65b"), accent: hexToRgb("#fff5d6"), phase: 0.14 },
    { x: 290, targetX: 324, targetY: 132, color: hexToRgb("#ff4fd8"), accent: hexToRgb("#ffe2f8"), phase: 0.28 },
    { x: 384, targetX: 384, targetY: 116, color: hexToRgb("#8f5bff"), accent: hexToRgb("#efe5ff"), phase: 0.42 },
    { x: 478, targetX: 444, targetY: 132, color: hexToRgb("#58c7ff"), accent: hexToRgb("#ffffff"), phase: 0.56 },
    { x: 580, targetX: 548, targetY: 164, color: hexToRgb("#ff8f45"), accent: hexToRgb("#fff0d6"), phase: 0.7 },
    { x: 682, targetX: 650, targetY: 204, color: hexToRgb("#12f7d6"), accent: hexToRgb("#dcfff8"), phase: 0.84 },
  ];

  for (const launcher of launchers) {
    const local = mod01(time + launcher.phase);
    const launch = clamp(local / 0.22);
    const burstProgress = clamp((local - 0.14) / 0.62);
    const rocketY = mix(HEIGHT - 22, launcher.targetY, launch);

    drawCapsule(rgba, launcher.x, HEIGHT - 22, launcher.targetX, rocketY, 3.2, launcher.color, 0.16);
    drawCapsule(rgba, launcher.x, HEIGHT - 22, launcher.targetX, rocketY, 1.2, launcher.accent, 0.4);

    if (burstProgress > 0.01) {
      const radius = 32 + (easeOutBack(burstProgress) * 62);
      const alpha = clamp(1 - burstProgress) * 0.8;
      drawBurstRays(rgba, launcher.targetX, launcher.targetY, radius, 14, launcher.color, launcher.accent, alpha, launcher.phase * TAU, 0.74);
      drawSpark(rgba, launcher.targetX, launcher.targetY, 10 + (radius * 0.05), launcher.accent, alpha * 0.22);
    }
  }

  for (let crown = 0; crown < 16; crown += 1) {
    const angle = (-Math.PI * 0.86) + ((crown / 15) * (Math.PI * 0.72));
    const radius = 238;
    drawSpark(rgba, (WIDTH * 0.5) + (Math.cos(angle) * radius), 246 + (Math.sin(angle) * 72), 4.8, crown % 3 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#fff8e7"), 0.14);
  }

  return rgba;
};

const renderOrbitBingoPulse = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.64;
  const pulse = 0.5 + (0.5 * Math.sin(time * TAU));

  drawShockwave(rgba, centerX, centerY + 10, 126 + (pulse * 18), hexToRgb("#58c7ff"), 0.1);
  drawShockwave(rgba, centerX, centerY + 10, 182 + (pulse * 20), hexToRgb("#a7ff5a"), 0.07);
  drawSpark(rgba, centerX, centerY + 8, 14 + (pulse * 6), hexToRgb("#fff8e4"), 0.16);

  for (let index = 0; index < 4; index += 1) {
    const angle = ((index / 4) * TAU) + (time * TAU * 0.22);
    const radiusX = 188;
    const radiusY = 102;
    const body = ballPalette[index % ballPalette.length];
    const size = 46 + ((index % 2) * 10);
    const x = centerX + (Math.cos(angle) * radiusX);
    const y = centerY + (Math.sin(angle) * radiusY) - (Math.sin((time * TAU * 1.2) + index) * 8);
    drawTrailDots(rgba, centerX, centerY, x, y, 4, size * 0.1, hexToRgb("#ffffff"), 0.08);
    drawBingoBall(rgba, x, y, size, body.color, body.digit, 0.94);
  }

  for (let spark = 0; spark < 14; spark += 1) {
    const angle = ((spark / 14) * TAU) - (time * TAU * 0.08);
    drawSpark(rgba, centerX + (Math.cos(angle) * 84), centerY + 10 + (Math.sin(angle) * 48), 4.4, spark % 3 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#fff8e5"), 0.12);
  }

  return rgba;
};

const renderLuckyNumberBounce = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const anchorBalls = [
    { x: WIDTH * 0.34, y: HEIGHT * 0.72, radius: 52, body: ballPalette[0], phase: 0.1 },
    { x: WIDTH * 0.5, y: HEIGHT * 0.6, radius: 58, body: ballPalette[3], phase: 0.4 },
    { x: WIDTH * 0.67, y: HEIGHT * 0.72, radius: 52, body: ballPalette[5], phase: 0.7 },
  ];

  for (const ball of anchorBalls) {
    const lift = Math.abs(Math.sin((time * TAU * 1.1) + (ball.phase * TAU))) * 34;
    const x = ball.x + (Math.sin((time * TAU * 0.9) + ball.phase) * 18);
    const y = ball.y - lift;
    drawShockwave(rgba, x, ball.y + 24, ball.radius * 0.94, hexToRgb("#f5c65b"), 0.08);
    drawBingoBall(rgba, x, y, ball.radius, ball.body.color, ball.body.digit, 0.96);
    drawSpark(rgba, x + (ball.radius * 0.74), y - (ball.radius * 0.72), 5.2, hexToRgb("#ffffff"), 0.28);
  }

  for (let spark = 0; spark < 18; spark += 1) {
    const x = mix(WIDTH * 0.28, WIDTH * 0.72, spark / 17);
    const y = HEIGHT * 0.48 + (Math.sin((time * TAU * 1.3) + spark) * 22);
    drawSpark(rgba, x, y, 4.2, spark % 4 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#fff8e5"), 0.1);
  }

  return rgba;
};

const renderCrownCoinCarousel = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.36;

  drawShockwave(rgba, centerX, centerY, 104 + (Math.sin(time * TAU) * 12), hexToRgb("#f5c65b"), 0.08);
  drawSpark(rgba, centerX, centerY - 18, 12 + (Math.sin(time * TAU * 1.2) * 4), hexToRgb("#fff7de"), 0.18);

  for (let index = 0; index < 11; index += 1) {
    const angle = (-Math.PI * 0.94) + ((index / 10) * (Math.PI * 0.88)) + (time * TAU * 0.12);
    const radius = 154 + (Math.sin((time * TAU * 1.1) + index) * 12);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.44) - 42;
    drawCoin(rgba, x, y, 18 + ((index % 3) * 4), 0.82, angle);
    drawSpark(rgba, x, y - 12, 4.4, hexToRgb("#fff8e2"), 0.16);
  }

  for (let rain = 0; rain < 18; rain += 1) {
    const progress = mod01((time * 0.56) + (rain * 0.06));
    const x = centerX + (Math.sin((progress * TAU * 1.2) + rain) * 74);
    const y = 110 + (progress * (HEIGHT * 0.52));
    drawCircle(rgba, x, y, 5 + ((rain % 3) * 1.6), hexToRgb("#f5c65b"), 0.18);
  }

  return rgba;
};

const renderDiamondLuckyHalo = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.58;

  drawLuckyClover(rgba, centerX, centerY, 54 + (Math.sin(time * TAU * 1.1) * 6), hexToRgb("#12f7d6"), 0.76);
  drawShockwave(rgba, centerX, centerY + 6, 118 + (Math.sin(time * TAU) * 16), hexToRgb("#12f7d6"), 0.08);

  for (let index = 0; index < 12; index += 1) {
    const angle = ((index / 12) * TAU) + (time * TAU * 0.18);
    const radius = 142 + ((index % 3) * 14);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.62);
    drawDiamond(rgba, x, y, 18 + ((index % 3) * 8), angle, index % 2 === 0 ? hexToRgb("#f5c65b") : hexToRgb("#ffffff"), 0.58);
    drawSpark(rgba, x, y, 5.2, hexToRgb("#fff8e5"), 0.14);
  }

  for (let star = 0; star < 14; star += 1) {
    const progress = mod01((time * 0.6) + (star * 0.07));
    const x = 72 + ((star % 7) * 92) + (Math.sin((progress * TAU) + star) * 10);
    const y = -24 + (progress * (HEIGHT + 48));
    drawSpark(rgba, x, y, 4.6, star % 3 === 0 ? hexToRgb("#12f7d6") : hexToRgb("#fff8e8"), 0.16);
  }

  return rgba;
};

const COLOR_GOLD = hexToRgb("#f5c65b");
const COLOR_GOLD_SOFT = hexToRgb("#fff0c8");
const COLOR_HOT = hexToRgb("#ff4fd8");
const COLOR_PINK = hexToRgb("#ff63c7");
const COLOR_CYAN = hexToRgb("#58c7ff");
const COLOR_PURPLE = hexToRgb("#8f5bff");
const COLOR_GREEN = hexToRgb("#12f7d6");
const COLOR_ORANGE = hexToRgb("#ff8f45");
const COLOR_RED = hexToRgb("#ff4a3d");
const COLOR_WHITE = hexToRgb("#ffffff");
const RAINBOW_BALLS = [
  { color: hexToRgb("#ff4fd8"), digit: 7 },
  { color: hexToRgb("#ff8f45"), digit: 8 },
  { color: hexToRgb("#f5c65b"), digit: 3 },
  { color: hexToRgb("#7ee35b"), digit: 9 },
  { color: hexToRgb("#58c7ff"), digit: 2 },
  { color: hexToRgb("#8f5bff"), digit: 5 },
];
const BINGO_DOTS = getTextPixelOffsets("BINGO", 10, 1);

const renderBingoJackpotExplosion = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.42;
  compositeBuffer(rgba, renderJackpotPop(time), 0.28);

  const pulse = 0.7 + (0.3 * Math.sin(time * TAU * 1.4));
  drawShockwave(rgba, centerX, centerY + 40, 148 + (pulse * 34), COLOR_GOLD, 0.18);
  drawTextBlock(rgba, "BINGO!", centerX, centerY, 14 + (pulse * 1.2), COLOR_GOLD, 0.94, COLOR_WHITE);

  for (let index = 0; index < 5; index += 1) {
    const angle = (-Math.PI * 0.86) + ((index / 4) * (Math.PI * 0.72));
    const radius = 88 + (easeOutBack(mod01(time + (index * 0.06))) * 224);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + 24 + (Math.sin(angle) * radius * 0.76);
    const body = ballPalette[index % ballPalette.length];
    drawTrailDots(rgba, centerX, centerY + 26, x, y, 5, 5.4, COLOR_WHITE, 0.14);
    drawBingoBall(rgba, x, y, 28 + ((index % 3) * 8), body.color, body.digit, 0.9);
  }

  for (let coin = 0; coin < 10; coin += 1) {
    const progress = mod01((time * 0.78) + (coin * 0.08));
    const angle = (-Math.PI * 0.92) + ((coin / 9) * (Math.PI * 0.84));
    const radius = 84 + (easeOutCubic(progress) * 220);
    drawCoin(rgba, centerX + (Math.cos(angle) * radius), centerY + 44 + (Math.sin(angle) * radius * 0.54), 12 + ((coin % 3) * 4), 0.74, angle + (progress * TAU));
  }

  return rgba;
};

const renderGoldRainBingo = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (let coin = 0; coin < 44; coin += 1) {
    const progress = mod01((time * (0.42 + ((coin % 5) * 0.04))) + (coin * 0.031));
    const x = 58 + ((coin % 11) * 62) + (Math.sin((progress * TAU * 1.2) + coin) * 18);
    const y = -48 + (progress * (HEIGHT + 96));
    drawCoin(rgba, x, y, 10 + ((coin % 4) * 3), 0.78, progress * TAU);
    drawSpark(rgba, x, y - 12, 4 + ((coin % 2) * 1.6), COLOR_GOLD_SOFT, 0.16);
  }

  for (let star = 0; star < 28; star += 1) {
    const progress = mod01((time * 0.36) + (star * 0.047));
    const x = 70 + ((star % 7) * 92) + (Math.sin((progress * TAU) + star) * 14);
    const y = 70 + (progress * (HEIGHT * 0.72));
    drawCasinoStar(rgba, x, y, 7 + ((star % 3) * 2), star % 4 === 0 ? COLOR_WHITE : COLOR_GOLD, 0.22);
  }

  for (let ball = 0; ball < 3; ball += 1) {
    const progress = mod01((time * 0.34) + (ball * 0.22));
    const x = WIDTH * (0.26 + (ball * 0.24)) + (Math.sin((progress * TAU * 1.2) + ball) * 14);
    const y = HEIGHT * (0.74 - (Math.sin(progress * Math.PI) * 0.08));
    const body = ballPalette[(ball + 2) % ballPalette.length];
    drawBingoBall(rgba, x, y, 32 + (ball * 4), body.color, body.digit, 0.72);
  }

  return rgba;
};

const renderBingoBallChaosForm = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.46;
  const originX = centerX - (BINGO_DOTS.width * 0.5);
  const originY = centerY - (BINGO_DOTS.height * 0.5);
  const form = triangleWave((time * 0.5) + 0.08);

  for (let index = 0; index < BINGO_DOTS.offsets.length; index += 1) {
    const point = BINGO_DOTS.offsets[index];
    const orbitAngle = ((index / BINGO_DOTS.offsets.length) * TAU * 2) + (time * TAU * 1.3);
    const orbitRadius = 240 + ((index % 7) * 16);
    const scatterX = centerX + (Math.cos(orbitAngle) * orbitRadius);
    const scatterY = centerY + (Math.sin(orbitAngle * 1.2) * orbitRadius * 0.52);
    const targetX = originX + point.x + 6;
    const targetY = originY + point.y + 6;
    const x = mix(scatterX, targetX, easeInOutSine(form));
    const y = mix(scatterY, targetY, easeInOutSine(form));
    const body = ballPalette[index % ballPalette.length];
    drawTrailDots(rgba, scatterX, scatterY, x, y, 4, 2.8, COLOR_WHITE, 0.08);
    drawBingoBall(rgba, x, y, 7 + ((index % 2) * 1.4), body.color, body.digit, 0.94);
  }

  drawShockwave(rgba, centerX, centerY + 18, 126 + (form * 88), COLOR_GOLD, 0.1);
  return rgba;
};

const renderSuperJackpot777 = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderFireworkImpact(time), 0.18);
  drawTextBlock(rgba, "777", WIDTH * 0.5, HEIGHT * 0.42, 18 + (Math.sin(time * TAU * 1.2) * 1.4), COLOR_RED, 0.98, COLOR_GOLD);

  for (let chip = 0; chip < 10; chip += 1) {
    const progress = mod01((time * 0.72) + (chip * 0.09));
    const angle = ((chip / 10) * TAU) + (time * TAU * 0.4);
    const radius = 118 + (progress * 182);
    const x = WIDTH * 0.5 + (Math.cos(angle) * radius);
    const y = HEIGHT * 0.45 + (Math.sin(angle) * radius * 0.42);
    drawCasinoChip(rgba, x, y, 20 + ((chip % 2) * 6), chip % 2 === 0 ? COLOR_RED : COLOR_GOLD, COLOR_WHITE, 0.84, angle);
  }

  return rgba;
};

const renderElectricBingoStorm = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderOrbitBingoPulse(time), 0.14);

  const bolts = [
    [{ x: 120, y: 40 }, { x: 208, y: 214 }, { x: 166, y: 382 }, { x: 260, y: 596 }],
    [{ x: 618, y: 64 }, { x: 540, y: 244 }, { x: 584, y: 398 }, { x: 476, y: 612 }],
    [{ x: 360, y: 18 }, { x: 420, y: 168 }, { x: 382, y: 322 }, { x: 444, y: 520 }],
  ];
  for (let index = 0; index < bolts.length; index += 1) {
    drawLightningBolt(rgba, bolts[index], index === 1 ? COLOR_PURPLE : COLOR_CYAN, 0.34 + (0.08 * Math.sin((time * TAU * 1.7) + index)));
  }

  for (let orb = 0; orb < 6; orb += 1) {
    const body = ballPalette[(orb + 1) % ballPalette.length];
    const progress = mod01((time * 0.62) + (orb * 0.13));
    const x = 110 + (orb * 108) + (Math.sin((progress * TAU * 1.9) + orb) * 36);
    const y = 260 + (Math.cos((progress * TAU * 1.4) + orb) * 170);
    drawCapsule(rgba, x - 54, y + 12, x + 54, y - 12, 8, orb % 2 === 0 ? COLOR_CYAN : COLOR_PURPLE, 0.08);
    drawBingoBall(rgba, x, y, 24 + ((orb % 3) * 8), body.color, body.digit, 0.9);
  }

  return rgba;
};

const renderDiamondWinDeluxe = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderDiamondLuckyHalo(time), 0.18);

  for (let gem = 0; gem < 10; gem += 1) {
    const progress = mod01((time * 0.46) + (gem * 0.062));
    const x = 90 + ((gem % 4) * 164) + (Math.sin((progress * TAU) + gem) * 22);
    const y = 120 + ((Math.floor(gem / 4)) * 136) + (Math.cos((progress * TAU * 1.2) + gem) * 18);
    drawDiamondGem(rgba, x, y, 28 + ((gem % 3) * 8), gem % 2 === 0 ? COLOR_CYAN : COLOR_GOLD, 0.74, progress * TAU);
  }

  for (let ball = 0; ball < 3; ball += 1) {
    const body = ballPalette[ball];
    const angle = ((ball / 4) * TAU) - (time * TAU * 0.24);
    drawBingoBall(rgba, (WIDTH * 0.5) + (Math.cos(angle) * 204), (HEIGHT * 0.58) + (Math.sin(angle) * 86), 42, COLOR_GOLD, body.digit, 0.82);
  }

  return rgba;
};

const renderFireBingoInferno = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawTextBlock(rgba, "BINGO!", WIDTH * 0.5, HEIGHT * 0.46, 14 + (Math.sin(time * TAU) * 1.2), COLOR_ORANGE, 0.92, COLOR_GOLD);

  for (let flame = 0; flame < 18; flame += 1) {
    const progress = mod01((time * 0.84) + (flame * 0.056));
    const x = 82 + ((flame % 6) * 120) + (Math.sin((progress * TAU * 1.4) + flame) * 14);
    const y = HEIGHT - 74 - ((Math.sin(progress * Math.PI) * 220) + ((flame % 3) * 24));
    drawFlame(rgba, x, y, 34 + ((flame % 3) * 10), 0.8 - (progress * 0.24));
    drawSpark(rgba, x, y - 44, 5 + ((flame % 2) * 1.8), COLOR_GOLD_SOFT, 0.16);
  }

  for (let ember = 0; ember < 52; ember += 1) {
    const progress = mod01((time * 0.7) + (ember * 0.018));
    const x = 64 + ((ember % 8) * 84) + (Math.sin((progress * TAU * 1.8) + ember) * 22);
    const y = HEIGHT - 40 - (progress * 360);
    drawCircle(rgba, x, y, 3 + ((ember % 3) * 1.2), ember % 4 === 0 ? COLOR_GOLD : COLOR_RED, 0.18);
  }

  return rgba;
};

const renderConfettiMadnessParty = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderConfettiStorm(time), 0.42);
  compositeBuffer(rgba, renderRibbonNovaBurst(mod01(time + 0.22)), 0.24);

  for (let burst = 0; burst < 4; burst += 1) {
    const x = 86 + (burst * 118);
    const y = HEIGHT - 40;
    const angle = -Math.PI * 0.5 + (Math.sin((time * TAU) + burst) * 0.34);
    const tipX = x + (Math.cos(angle) * 120);
    const tipY = y + (Math.sin(angle) * 120);
    drawCapsule(rgba, x, y, tipX, tipY, 8, burst % 2 === 0 ? COLOR_PINK : COLOR_CYAN, 0.1);
  }

  return rgba;
};

const renderLuckySpinCasino = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.48;
  drawRouletteWheel(rgba, centerX, centerY, 138 + (Math.sin(time * TAU * 0.6) * 8), time * TAU, 0.9);

  for (let orb = 0; orb < 8; orb += 1) {
    const angle = ((orb / 8) * TAU) + (time * TAU * 0.52);
    const body = ballPalette[orb % ballPalette.length];
    drawTrailDots(rgba, centerX, centerY, centerX + (Math.cos(angle) * 180), centerY + (Math.sin(angle) * 120), 5, 3.2, COLOR_WHITE, 0.08);
    drawBingoBall(rgba, centerX + (Math.cos(angle) * 180), centerY + (Math.sin(angle) * 120), 24 + ((orb % 3) * 6), body.color, body.digit, 0.9);
  }

  for (let spiral = 0; spiral < 30; spiral += 1) {
    const progress = mod01((time * 0.7) + (spiral * 0.024));
    const angle = (progress * TAU * 2.6) + spiral;
    const radius = 18 + (progress * 240);
    drawSpark(rgba, centerX + (Math.cos(angle) * radius), centerY + (Math.sin(angle) * radius * 0.66), 3.8, spiral % 4 === 0 ? COLOR_GOLD : COLOR_CYAN, 0.14);
  }

  return rgba;
};

const renderMegaWinGoldRush = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderCrownCoinCarousel(mod01(time + 0.12)), 0.18);
  drawTextBlock(rgba, "MEGA\nWIN", WIDTH * 0.5, HEIGHT * 0.42, 12 + (Math.sin(time * TAU * 1.1) * 1.2), COLOR_GOLD, 0.96, COLOR_WHITE);

  for (let stream = 0; stream < 12; stream += 1) {
    const x = 84 + (stream * 54);
    const y = HEIGHT - 30 - (triangleWave((time * 0.62) + (stream * 0.06)) * 420);
    drawCapsule(rgba, x, HEIGHT - 10, x + (Math.sin((time * TAU) + stream) * 24), y, 7 + ((stream % 2) * 2), COLOR_GOLD, 0.12);
  }

  return rgba;
};

const renderNeonBingoBlast = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawTextBlock(rgba, "BINGO", WIDTH * 0.5, HEIGHT * 0.46, 14, COLOR_PINK, 0.86, COLOR_CYAN);
  drawShockwave(rgba, WIDTH * 0.5, HEIGHT * 0.48, 166 + (Math.sin(time * TAU) * 18), COLOR_CYAN, 0.12);
  drawShockwave(rgba, WIDTH * 0.5, HEIGHT * 0.48, 228 + (Math.sin(time * TAU * 1.2) * 18), COLOR_PINK, 0.08);
  for (let ring = 0; ring < 10; ring += 1) {
    const angle = ((ring / 10) * TAU) + (time * TAU * 0.4);
    const radius = 104 + ((ring % 3) * 26);
    drawSpark(rgba, (WIDTH * 0.5) + (Math.cos(angle) * radius), (HEIGHT * 0.48) + (Math.sin(angle) * radius * 0.66), 5 + (ring % 3), ring % 2 === 0 ? COLOR_CYAN : COLOR_PINK, 0.14);
  }
  return rgba;
};

const renderRainbowJackpot = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderConfettiStorm(mod01(time + 0.18)), 0.26);

  for (let burst = 0; burst < 14; burst += 1) {
    const progress = mod01((time * 0.72) + (burst * 0.04));
    const angle = (-Math.PI * 0.96) + ((burst / 13) * (Math.PI * 0.92));
    const radius = 80 + (easeOutBack(progress) * 280);
    const body = RAINBOW_BALLS[burst % RAINBOW_BALLS.length];
    drawBingoBall(rgba, (WIDTH * 0.5) + (Math.cos(angle) * radius), (HEIGHT * 0.46) + (Math.sin(angle) * radius * 0.58), 24 + ((burst % 3) * 6), body.color, body.digit, 0.92);
  }

  for (let glitter = 0; glitter < 64; glitter += 1) {
    const progress = mod01((time * 0.5) + (glitter * 0.017));
    const angle = (glitter / 64) * TAU;
    const radius = 30 + (progress * 280);
    const color = RAINBOW_BALLS[glitter % RAINBOW_BALLS.length].color;
    drawCasinoStar(rgba, (WIDTH * 0.5) + (Math.cos(angle) * radius), (HEIGHT * 0.46) + (Math.sin(angle) * radius * 0.7), 4 + ((glitter % 2) * 1.6), color, 0.12);
  }

  return rgba;
};

const renderGoldStarAvalanche = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let star = 0; star < 96; star += 1) {
    const progress = mod01((time * (0.38 + ((star % 4) * 0.04))) + (star * 0.013));
    const x = 40 + ((star % 12) * 62) + (Math.sin((progress * TAU * 1.2) + star) * 18);
    const y = -40 + (progress * (HEIGHT + 90));
    drawCasinoStar(rgba, x, y, 7 + ((star % 4) * 2.2), star % 5 === 0 ? COLOR_WHITE : COLOR_GOLD, 0.2);
  }
  compositeBuffer(rgba, renderBonusSparkShower(mod01(time + 0.12)), 0.18);
  return rgba;
};

const renderHyperBingoSpin = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.5;
  drawShockwave(rgba, centerX, centerY, 72 + (Math.sin(time * TAU * 1.2) * 12), COLOR_CYAN, 0.08);

  for (let orb = 0; orb < 24; orb += 1) {
    const progress = mod01((time * 0.86) + (orb * 0.04));
    const angle = (progress * TAU * 2.8) + orb;
    const radius = 280 - (progress * 230);
    const body = ballPalette[orb % ballPalette.length];
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.72);
    drawTrailDots(rgba, centerX, centerY, x, y, 5, 3, COLOR_WHITE, 0.08);
    drawBingoBall(rgba, x, y, 14 + ((orb % 3) * 4), body.color, body.digit, 0.86);
  }

  for (let spark = 0; spark < 48; spark += 1) {
    const progress = mod01((time * 0.68) + (spark * 0.018));
    const angle = (progress * TAU * 3.4) + spark;
    const radius = 18 + (progress * 320);
    drawSpark(rgba, centerX + (Math.cos(angle) * radius), centerY + (Math.sin(angle) * radius * 0.72), 3.6, spark % 4 === 0 ? COLOR_GOLD : COLOR_CYAN, 0.12);
  }

  return rgba;
};

const renderRoyalCasinoCelebration = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderDiamondLuckyHalo(mod01(time + 0.18)), 0.14);
  compositeBuffer(rgba, renderCrownCoinCarousel(time), 0.12);
  drawCrown(rgba, WIDTH * 0.5, HEIGHT * 0.24, 260 + (Math.sin(time * TAU) * 14), COLOR_GOLD, 0.88);

  for (let gem = 0; gem < 8; gem += 1) {
    const angle = (-Math.PI * 0.9) + ((gem / 7) * (Math.PI * 0.8));
    drawDiamondGem(rgba, (WIDTH * 0.5) + (Math.cos(angle) * 238), HEIGHT * 0.46 + (Math.sin(angle) * 92), 24 + ((gem % 3) * 6), gem % 2 === 0 ? COLOR_PURPLE : COLOR_GOLD, 0.72, angle);
  }

  for (let coin = 0; coin < 6; coin += 1) {
    const angle = (-Math.PI * 0.86) + ((coin / 5) * (Math.PI * 0.72));
    drawCoin(rgba, (WIDTH * 0.5) + (Math.cos(angle) * 154), HEIGHT * 0.58 + (Math.sin(angle) * 72), 16 + ((coin % 2) * 4), 0.72, angle + (time * TAU * 0.2));
  }

  return rgba;
};

const renderLaserBingoAttack = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const lasers = [
    { fromX: -40, fromY: 210, toX: WIDTH + 40, toY: 520, color: COLOR_CYAN },
    { fromX: WIDTH + 40, fromY: 176, toX: -40, toY: 618, color: COLOR_PINK },
    { fromX: -20, fromY: 770, toX: WIDTH + 20, toY: 290, color: COLOR_GOLD },
  ];
  for (const laser of lasers) {
    drawCapsule(rgba, laser.fromX, laser.fromY, laser.toX, laser.toY, 10, laser.color, 0.08);
    drawCapsule(rgba, laser.fromX, laser.fromY, laser.toX, laser.toY, 3.2, COLOR_WHITE, 0.24);
  }

  for (let blast = 0; blast < 5; blast += 1) {
    const x = 126 + (blast * 128);
    const y = 240 + (Math.sin((time * TAU * 1.2) + blast) * 190);
    const body = ballPalette[blast % ballPalette.length];
    drawBingoBall(rgba, x, y, 28 + ((blast % 2) * 10), body.color, body.digit, 0.9);
    drawBurstRays(rgba, x, y, 54 + (Math.sin((time * TAU) + blast) * 10), 16, blast % 2 === 0 ? COLOR_CYAN : COLOR_PINK, COLOR_WHITE, 0.16, blast, 0.8);
  }

  return rgba;
};

const renderCosmicBingoGalaxy = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.48;

  for (let dust = 0; dust < 84; dust += 1) {
    const progress = mod01((time * 0.34) + (dust * 0.011));
    const angle = (progress * TAU * 2.4) + dust;
    const radius = 30 + (progress * 300);
    drawSpark(rgba, centerX + (Math.cos(angle) * radius), centerY + (Math.sin(angle) * radius * 0.54), 3.4 + ((dust % 3) * 0.8), dust % 4 === 0 ? COLOR_PURPLE : dust % 5 === 0 ? COLOR_CYAN : COLOR_WHITE, 0.12);
  }

  for (let ball = 0; ball < 6; ball += 1) {
    const angle = ((ball / 6) * TAU) + (time * TAU * 0.16);
    const body = ballPalette[ball % ballPalette.length];
    drawBingoBall(rgba, centerX + (Math.cos(angle) * 228), centerY + (Math.sin(angle) * 118), 26 + ((ball % 3) * 8), body.color, body.digit, 0.82);
  }

  return rgba;
};

const renderPartyModeOverload = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderConfettiStorm(time), 0.3);
  compositeBuffer(rgba, renderRibbonNovaBurst(mod01(time + 0.18)), 0.18);

  for (let balloon = 0; balloon < 10; balloon += 1) {
    const progress = mod01((time * 0.32) + (balloon * 0.08));
    const x = 96 + (balloon * 62) + (Math.sin((progress * TAU) + balloon) * 20);
    const y = HEIGHT + 80 - (progress * (HEIGHT + 180));
    const color = balloon % 3 === 0 ? COLOR_PINK : balloon % 3 === 1 ? COLOR_CYAN : COLOR_GOLD;
    drawCircle(rgba, x, y, 20 + ((balloon % 2) * 6), color, 0.72);
    drawCapsule(rgba, x, y + 18, x + (Math.sin(progress * TAU) * 12), y + 58, 1.2, COLOR_WHITE, 0.28);
  }

  return rgba;
};

const renderMoneyStormJackpot = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderJackpotPop(time), 0.18);

  for (let bill = 0; bill < 22; bill += 1) {
    const progress = mod01((time * (0.48 + ((bill % 4) * 0.03))) + (bill * 0.041));
    const x = 70 + ((bill % 6) * 118) + (Math.sin((progress * TAU * 1.3) + bill) * 32);
    const y = -60 + (progress * (HEIGHT + 140));
    drawBill(rgba, x, y, 58, 28, (progress * TAU) + bill, 0.72);
  }

  for (let coin = 0; coin < 24; coin += 1) {
    const progress = mod01((time * 0.62) + (coin * 0.033));
    const x = 84 + ((coin % 8) * 76) + (Math.sin((progress * TAU * 1.2) + coin) * 20);
    const y = 40 + (progress * (HEIGHT * 0.8));
    drawCoin(rgba, x, y, 10 + ((coin % 3) * 3), 0.74, progress * TAU);
  }

  return rgba;
};

const renderUltimateBingoFinale = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  compositeBuffer(rgba, renderConfettiStorm(time), 0.14);
  compositeBuffer(rgba, renderJackpotPop(mod01(time + 0.08)), 0.16);
  compositeBuffer(rgba, renderFireworkImpact(mod01(time + 0.2)), 0.12);
  drawTextBlock(rgba, "BINGO!", WIDTH * 0.5, HEIGHT * 0.42, 16 + (Math.sin(time * TAU * 1.2) * 1.2), COLOR_GOLD, 0.96, COLOR_WHITE);
  drawShockwave(rgba, WIDTH * 0.5, HEIGHT * 0.48, 192 + (Math.sin(time * TAU) * 20), COLOR_GOLD, 0.14);

  const finaleBolts = [
    [{ x: 54, y: 110 }, { x: 192, y: 260 }, { x: 148, y: 454 }, { x: 254, y: 666 }],
    [{ x: 710, y: 88 }, { x: 548, y: 236 }, { x: 604, y: 436 }, { x: 494, y: 676 }],
  ];
  for (let index = 0; index < finaleBolts.length; index += 1) {
    drawLightningBolt(rgba, finaleBolts[index], index === 0 ? COLOR_CYAN : COLOR_PURPLE, 0.22);
  }

  for (let burst = 0; burst < 8; burst += 1) {
    const angle = (-Math.PI * 0.92) + ((burst / 7) * (Math.PI * 0.84));
    const radius = 108 + (easeOutBack(mod01(time + (burst * 0.05))) * 232);
    const body = RAINBOW_BALLS[burst % RAINBOW_BALLS.length];
    drawBingoBall(rgba, (WIDTH * 0.5) + (Math.cos(angle) * radius), (HEIGHT * 0.46) + (Math.sin(angle) * radius * 0.54), 24 + ((burst % 3) * 8), body.color, body.digit, 0.86);
  }

  return rgba;
};

const renderThumbsUpPop = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.58;
  const entrance = easeOutBack(clamp(time * 3.2, 0, 1));
  const pulse = 0.74 + (0.26 * Math.sin(time * TAU * 1.6));
  const heroY = mix(HEIGHT + 180, centerY, entrance) + (Math.sin(time * TAU * 1.2) * 10);
  const heroSize = 220 + (pulse * 18);
  const heroPalette = {
    hand: hexToRgb("#fff4dd"),
    cuff: COLOR_CYAN,
    glow: COLOR_PURPLE,
    outline: COLOR_WHITE,
  };

  drawShockwave(rgba, centerX, centerY + 34, 148 + (pulse * 26), COLOR_CYAN, 0.1);
  drawShockwave(rgba, centerX, centerY + 34, 210 + (pulse * 18), COLOR_HOT, 0.06);
  drawBurstRays(rgba, centerX, centerY + 30, 182 + (pulse * 12), 16, COLOR_PURPLE, COLOR_WHITE, 0.1, time * TAU * 0.05, 0.84);

  drawThumbsUp(rgba, centerX - 116, centerY + 34, 106, {
    hand: hexToRgb("#f3ebff"),
    cuff: COLOR_PURPLE,
    glow: COLOR_CYAN,
    outline: COLOR_WHITE,
  }, 0.26, -0.18);
  drawThumbsUp(rgba, centerX + 122, centerY + 26, 98, {
    hand: hexToRgb("#eaf7ff"),
    cuff: COLOR_HOT,
    glow: COLOR_CYAN,
    outline: COLOR_WHITE,
  }, 0.22, 0.16, true);
  drawThumbsUp(rgba, centerX, heroY, heroSize, heroPalette, 0.98, -0.08);

  for (let streak = 0; streak < 10; streak += 1) {
    const angle = (-Math.PI * 0.78) + ((streak / 9) * (Math.PI * 0.72));
    const radius = 130 + ((streak % 4) * 34);
    const targetX = centerX + (Math.cos(angle) * radius);
    const targetY = centerY + 18 + (Math.sin(angle) * radius * 0.56);
    drawCapsule(rgba, centerX, centerY + 22, targetX, targetY, 6, streak % 2 === 0 ? COLOR_CYAN : COLOR_HOT, 0.08);
    drawCapsule(rgba, centerX, centerY + 22, targetX, targetY, 2.2, COLOR_WHITE, 0.18);
  }

  for (let spark = 0; spark < 22; spark += 1) {
    const angle = (spark / 22) * TAU;
    const radius = 96 + ((spark % 5) * 32) + (Math.sin((time * TAU * 1.2) + spark) * 10);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + 8 + (Math.sin(angle) * radius * 0.58);
    drawSpark(rgba, x, y, 5 + ((spark % 3) * 1.4), spark % 4 === 0 ? COLOR_HOT : spark % 3 === 0 ? COLOR_CYAN : COLOR_WHITE, 0.16);
  }

  return rgba;
};

const renderDoubleLikeRush = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const leftEntrance = easeOutBack(clamp(time * 3, 0, 1));
  const rightEntrance = easeOutBack(clamp((time - 0.06) * 3.1, 0, 1));
  const leftX = mix(-180, WIDTH * 0.34, leftEntrance);
  const rightX = mix(WIDTH + 180, WIDTH * 0.66, rightEntrance);
  const leftY = HEIGHT * 0.58 + (Math.sin((time * TAU * 1.2) + 0.6) * 14);
  const rightY = HEIGHT * 0.5 + (Math.sin((time * TAU * 1.24) + 1.4) * 12);

  drawShockwave(rgba, WIDTH * 0.5, HEIGHT * 0.56, 132 + (Math.sin(time * TAU * 1.4) * 16), COLOR_PURPLE, 0.08);
  drawBurstRays(rgba, WIDTH * 0.5, HEIGHT * 0.54, 164 + (Math.sin(time * TAU) * 10), 14, COLOR_CYAN, COLOR_WHITE, 0.08, time * TAU * 0.04, 0.78);

  drawCapsule(rgba, -40, leftY + 22, leftX - 40, leftY + 8, 10, COLOR_CYAN, 0.08);
  drawCapsule(rgba, WIDTH + 40, rightY + 14, rightX + 42, rightY + 4, 10, COLOR_HOT, 0.08);
  drawCapsule(rgba, -40, leftY + 22, leftX - 40, leftY + 8, 3.2, COLOR_WHITE, 0.14);
  drawCapsule(rgba, WIDTH + 40, rightY + 14, rightX + 42, rightY + 4, 3.2, COLOR_WHITE, 0.14);

  drawThumbsUp(rgba, leftX, leftY, 174, {
    hand: hexToRgb("#fff4dd"),
    cuff: COLOR_CYAN,
    glow: COLOR_PURPLE,
    outline: COLOR_WHITE,
  }, 0.96, -0.16);
  drawThumbsUp(rgba, rightX, rightY, 168, {
    hand: hexToRgb("#f4edff"),
    cuff: COLOR_HOT,
    glow: COLOR_CYAN,
    outline: COLOR_WHITE,
  }, 0.94, 0.16, true);

  for (let echo = 0; echo < 6; echo += 1) {
    const progress = mod01((time * 0.42) + (echo * 0.16));
    const x = WIDTH * (0.26 + ((echo % 3) * 0.24)) + (Math.sin((progress * TAU) + echo) * 16);
    const y = HEIGHT + 70 - (progress * (HEIGHT * 0.74));
    drawThumbsUp(rgba, x, y, 64 + ((echo % 2) * 10), {
      hand: echo % 2 === 0 ? hexToRgb("#fff4dd") : hexToRgb("#eef7ff"),
      cuff: echo % 2 === 0 ? COLOR_PURPLE : COLOR_CYAN,
      glow: echo % 2 === 0 ? COLOR_CYAN : COLOR_HOT,
      outline: COLOR_WHITE,
    }, 0.2, echo % 2 === 0 ? -0.18 : 0.18, echo % 3 === 0);
  }

  for (let spark = 0; spark < 18; spark += 1) {
    const angle = (spark / 18) * TAU;
    const radius = 108 + ((spark % 4) * 28);
    const x = (WIDTH * 0.5) + (Math.cos(angle) * radius);
    const y = HEIGHT * 0.56 + (Math.sin(angle) * radius * 0.46);
    drawSpark(rgba, x, y, 4.8 + ((spark % 3) * 1.2), spark % 2 === 0 ? COLOR_CYAN : COLOR_HOT, 0.14);
  }

  return rgba;
};

const effects = [
  {
    output: "trh-chat-bingo-jackpot-explosion.apng",
    previewOutput: "trh-chat-bingo-jackpot-explosion.png",
    previewFrames: [{ time: 0.12, opacity: 1 }, { time: 0.28, opacity: 0.44 }, { time: 0.62, opacity: 0.2 }],
    render: renderBingoJackpotExplosion,
  },
  {
    output: "trh-chat-gold-rain-bingo.apng",
    previewOutput: "trh-chat-gold-rain-bingo.png",
    previewFrames: [{ time: 0.24, opacity: 1 }, { time: 0.54, opacity: 0.36 }, { time: 0.78, opacity: 0.18 }],
    render: renderGoldRainBingo,
  },
  {
    output: "trh-chat-bingo-ball-chaos.apng",
    previewOutput: "trh-chat-bingo-ball-chaos.png",
    previewFrames: [{ time: 0.42, opacity: 1 }, { time: 0.68, opacity: 0.22 }],
    render: renderBingoBallChaosForm,
  },
  {
    output: "trh-chat-super-jackpot-777.apng",
    previewOutput: "trh-chat-super-jackpot-777.png",
    previewFrames: [{ time: 0.16, opacity: 1 }, { time: 0.34, opacity: 0.5 }, { time: 0.64, opacity: 0.22 }],
    render: renderSuperJackpot777,
  },
  {
    output: "trh-chat-electric-bingo-storm.apng",
    previewOutput: "trh-chat-electric-bingo-storm.png",
    previewFrames: [{ time: 0.18, opacity: 1 }, { time: 0.46, opacity: 0.42 }, { time: 0.72, opacity: 0.18 }],
    render: renderElectricBingoStorm,
  },
  {
    output: "trh-chat-diamond-win-deluxe.apng",
    previewOutput: "trh-chat-diamond-win-deluxe.png",
    previewFrames: [{ time: 0.26, opacity: 1 }, { time: 0.52, opacity: 0.3 }, { time: 0.78, opacity: 0.16 }],
    render: renderDiamondWinDeluxe,
  },
  {
    output: "trh-chat-fire-bingo-inferno.apng",
    previewOutput: "trh-chat-fire-bingo-inferno.png",
    previewFrames: [{ time: 0.14, opacity: 1 }, { time: 0.38, opacity: 0.4 }, { time: 0.66, opacity: 0.18 }],
    render: renderFireBingoInferno,
  },
  {
    output: "trh-chat-confetti-madness-party.apng",
    previewOutput: "trh-chat-confetti-madness-party.png",
    previewFrames: [{ time: 0.1, opacity: 1 }, { time: 0.3, opacity: 0.44 }, { time: 0.58, opacity: 0.2 }],
    render: renderConfettiMadnessParty,
  },
  {
    output: "trh-chat-lucky-spin-casino.apng",
    previewOutput: "trh-chat-lucky-spin-casino.png",
    previewFrames: [{ time: 0.22, opacity: 1 }, { time: 0.48, opacity: 0.34 }, { time: 0.74, opacity: 0.18 }],
    render: renderLuckySpinCasino,
  },
  {
    output: "trh-chat-mega-win-gold-rush.apng",
    previewOutput: "trh-chat-mega-win-gold-rush.png",
    previewFrames: [{ time: 0.14, opacity: 1 }, { time: 0.34, opacity: 0.42 }, { time: 0.6, opacity: 0.22 }],
    render: renderMegaWinGoldRush,
  },
  {
    output: "trh-chat-neon-bingo-blast.apng",
    previewOutput: "trh-chat-neon-bingo-blast.png",
    previewFrames: [{ time: 0.12, opacity: 1 }, { time: 0.4, opacity: 0.34 }, { time: 0.68, opacity: 0.18 }],
    render: renderNeonBingoBlast,
  },
  {
    output: "trh-chat-rainbow-jackpot.apng",
    previewOutput: "trh-chat-rainbow-jackpot.png",
    previewFrames: [{ time: 0.16, opacity: 1 }, { time: 0.42, opacity: 0.38 }, { time: 0.74, opacity: 0.18 }],
    render: renderRainbowJackpot,
  },
  {
    output: "trh-chat-gold-star-avalanche.apng",
    previewOutput: "trh-chat-gold-star-avalanche.png",
    previewFrames: [{ time: 0.26, opacity: 1 }, { time: 0.52, opacity: 0.32 }, { time: 0.82, opacity: 0.16 }],
    render: renderGoldStarAvalanche,
  },
  {
    output: "trh-chat-hyper-bingo-spin.apng",
    previewOutput: "trh-chat-hyper-bingo-spin.png",
    previewFrames: [{ time: 0.18, opacity: 1 }, { time: 0.46, opacity: 0.34 }, { time: 0.76, opacity: 0.16 }],
    render: renderHyperBingoSpin,
  },
  {
    output: "trh-chat-royal-casino-celebration.apng",
    previewOutput: "trh-chat-royal-casino-celebration.png",
    previewFrames: [{ time: 0.22, opacity: 1 }, { time: 0.5, opacity: 0.32 }, { time: 0.78, opacity: 0.16 }],
    render: renderRoyalCasinoCelebration,
  },
  {
    output: "trh-chat-laser-bingo-attack.apng",
    previewOutput: "trh-chat-laser-bingo-attack.png",
    previewFrames: [{ time: 0.12, opacity: 1 }, { time: 0.44, opacity: 0.34 }, { time: 0.7, opacity: 0.18 }],
    render: renderLaserBingoAttack,
  },
  {
    output: "trh-chat-cosmic-bingo-galaxy.apng",
    previewOutput: "trh-chat-cosmic-bingo-galaxy.png",
    previewFrames: [{ time: 0.24, opacity: 1 }, { time: 0.54, opacity: 0.3 }, { time: 0.82, opacity: 0.14 }],
    render: renderCosmicBingoGalaxy,
  },
  {
    output: "trh-chat-party-mode-overload.apng",
    previewOutput: "trh-chat-party-mode-overload.png",
    previewFrames: [{ time: 0.1, opacity: 1 }, { time: 0.32, opacity: 0.42 }, { time: 0.6, opacity: 0.18 }],
    render: renderPartyModeOverload,
  },
  {
    output: "trh-chat-money-storm-jackpot.apng",
    previewOutput: "trh-chat-money-storm-jackpot.png",
    previewFrames: [{ time: 0.14, opacity: 1 }, { time: 0.42, opacity: 0.34 }, { time: 0.72, opacity: 0.18 }],
    render: renderMoneyStormJackpot,
  },
  {
    output: "trh-chat-ultimate-bingo-finale.apng",
    previewOutput: "trh-chat-ultimate-bingo-finale.png",
    previewFrames: [{ time: 0.08, opacity: 1 }, { time: 0.24, opacity: 0.5 }, { time: 0.52, opacity: 0.22 }],
    render: renderUltimateBingoFinale,
  },
  {
    output: "trh-chat-bingo-confetti-storm.apng",
    previewOutput: "trh-chat-bingo-confetti-storm.png",
    previewFrames: [{ time: 0.26, opacity: 1 }, { time: 0.44, opacity: 0.52 }, { time: 0.62, opacity: 0.34 }],
    render: renderConfettiStorm,
  },
  {
    output: "trh-chat-golden-heart-rain.apng",
    previewOutput: "trh-chat-golden-heart-rain.png",
    previewFrames: [{ time: 0.42, opacity: 1 }, { time: 0.16, opacity: 0.56 }, { time: 0.74, opacity: 0.42 }],
    render: renderGoldenHeartRain,
  },
  {
    output: "trh-chat-firework-impact.apng",
    previewOutput: "trh-chat-firework-impact.png",
    previewFrames: [{ time: 0.54, opacity: 1 }, { time: 0.18, opacity: 0.54 }, { time: 0.78, opacity: 0.34 }],
    render: renderFireworkImpact,
  },
  {
    output: "trh-chat-bingo-ball-chaos-classic.apng",
    previewOutput: "trh-chat-bingo-ball-chaos-classic.png",
    previewFrames: [{ time: 0.34, opacity: 1 }, { time: 0.58, opacity: 0.28 }, { time: 0.8, opacity: 0.18 }],
    render: renderBingoBallChaos,
  },
  {
    output: "trh-chat-jackpot-pop.apng",
    previewOutput: "trh-chat-jackpot-pop.png",
    previewFrames: [{ time: 0.24, opacity: 1 }, { time: 0.46, opacity: 0.48 }, { time: 0.7, opacity: 0.28 }],
    render: renderJackpotPop,
  },
  {
    output: "trh-chat-prism-confetti-rush.apng",
    previewOutput: "trh-chat-prism-confetti-rush.png",
    previewFrames: [{ time: 0.22, opacity: 1 }, { time: 0.46, opacity: 0.42 }, { time: 0.72, opacity: 0.24 }],
    render: renderPrismConfettiRush,
  },
  {
    output: "trh-chat-neon-streamer-drop.apng",
    previewOutput: "trh-chat-neon-streamer-drop.png",
    previewFrames: [{ time: 0.18, opacity: 1 }, { time: 0.42, opacity: 0.48 }, { time: 0.68, opacity: 0.26 }],
    render: renderNeonStreamerDrop,
  },
  {
    output: "trh-chat-velvet-heart-pulse.apng",
    previewOutput: "trh-chat-velvet-heart-pulse.png",
    previewFrames: [{ time: 0.68, opacity: 1 }, { time: 0.38, opacity: 0.24 }, { time: 0.86, opacity: 0.12 }],
    render: renderVelvetHeartPulse,
  },
  {
    output: "trh-chat-cupid-spark-drift.apng",
    previewOutput: "trh-chat-cupid-spark-drift.png",
    previewFrames: [{ time: 0.24, opacity: 1 }, { time: 0.48, opacity: 0.46 }, { time: 0.7, opacity: 0.26 }],
    render: renderCupidSparkDrift,
  },
  {
    output: "trh-chat-starlight-rocket-pop.apng",
    previewOutput: "trh-chat-starlight-rocket-pop.png",
    previewFrames: [{ time: 0.36, opacity: 1 }, { time: 0.12, opacity: 0.42 }, { time: 0.58, opacity: 0.3 }],
    render: renderStarlightRocketPop,
  },
  {
    output: "trh-chat-aurora-mini-fireworks.apng",
    previewOutput: "trh-chat-aurora-mini-fireworks.png",
    previewFrames: [{ time: 0.44, opacity: 1 }, { time: 0.18, opacity: 0.44 }, { time: 0.7, opacity: 0.24 }],
    render: renderAuroraMiniFireworks,
  },
  {
    output: "trh-chat-lucky-ball-parade.apng",
    previewOutput: "trh-chat-lucky-ball-parade.png",
    previewFrames: [{ time: 0.26, opacity: 1 }, { time: 0.5, opacity: 0.34 }, { time: 0.76, opacity: 0.22 }],
    render: renderLuckyBallParade,
  },
  {
    output: "trh-chat-turbo-ball-bounce.apng",
    previewOutput: "trh-chat-turbo-ball-bounce.png",
    previewFrames: [{ time: 0.3, opacity: 1 }, { time: 0.54, opacity: 0.3 }, { time: 0.8, opacity: 0.2 }],
    render: renderTurboBallBounce,
  },
  {
    output: "trh-chat-clover-starfall.apng",
    previewOutput: "trh-chat-clover-starfall.png",
    previewFrames: [{ time: 0.34, opacity: 1 }, { time: 0.58, opacity: 0.4 }, { time: 0.82, opacity: 0.22 }],
    render: renderCloverStarfall,
  },
  {
    output: "trh-chat-bonus-spark-shower.apng",
    previewOutput: "trh-chat-bonus-spark-shower.png",
    previewFrames: [{ time: 0.2, opacity: 1 }, { time: 0.46, opacity: 0.44 }, { time: 0.72, opacity: 0.26 }],
    render: renderBonusSparkShower,
  },
  {
    output: "trh-chat-pixel-confetti-bloom.apng",
    previewOutput: "trh-chat-pixel-confetti-bloom.png",
    previewFrames: [{ time: 0.24, opacity: 1 }, { time: 0.52, opacity: 0.38 }, { time: 0.74, opacity: 0.2 }],
    render: renderPixelConfettiBloom,
  },
  {
    output: "trh-chat-ribbon-nova-burst.apng",
    previewOutput: "trh-chat-ribbon-nova-burst.png",
    previewFrames: [{ time: 0.18, opacity: 1 }, { time: 0.46, opacity: 0.42 }, { time: 0.7, opacity: 0.24 }],
    render: renderRibbonNovaBurst,
  },
  {
    output: "trh-chat-rose-heart-bloom.apng",
    previewOutput: "trh-chat-rose-heart-bloom.png",
    previewFrames: [{ time: 0.28, opacity: 1 }, { time: 0.52, opacity: 0.46 }, { time: 0.78, opacity: 0.26 }],
    render: renderRoseHeartBloom,
  },
  {
    output: "trh-chat-halo-heart-sweep.apng",
    previewOutput: "trh-chat-halo-heart-sweep.png",
    previewFrames: [{ time: 0.22, opacity: 1 }, { time: 0.48, opacity: 0.4 }, { time: 0.74, opacity: 0.24 }],
    render: renderHaloHeartSweep,
  },
  {
    output: "trh-chat-comet-fireworks-sweep.apng",
    previewOutput: "trh-chat-comet-fireworks-sweep.png",
    previewFrames: [{ time: 0.34, opacity: 1 }, { time: 0.56, opacity: 0.36 }, { time: 0.78, opacity: 0.22 }],
    render: renderCometFireworksSweep,
  },
  {
    output: "trh-chat-skyline-rocket-crown.apng",
    previewOutput: "trh-chat-skyline-rocket-crown.png",
    previewFrames: [{ time: 0.42, opacity: 1 }, { time: 0.18, opacity: 0.44 }, { time: 0.66, opacity: 0.24 }],
    render: renderSkylineRocketCrown,
  },
  {
    output: "trh-chat-orbit-bingo-pulse.apng",
    previewOutput: "trh-chat-orbit-bingo-pulse.png",
    previewFrames: [{ time: 0.28, opacity: 1 }, { time: 0.52, opacity: 0.34 }, { time: 0.76, opacity: 0.2 }],
    render: renderOrbitBingoPulse,
  },
  {
    output: "trh-chat-lucky-number-bounce.apng",
    previewOutput: "trh-chat-lucky-number-bounce.png",
    previewFrames: [{ time: 0.3, opacity: 1 }, { time: 0.58, opacity: 0.32 }, { time: 0.82, opacity: 0.18 }],
    render: renderLuckyNumberBounce,
  },
  {
    output: "trh-chat-crown-coin-carousel.apng",
    previewOutput: "trh-chat-crown-coin-carousel.png",
    previewFrames: [{ time: 0.18, opacity: 1 }, { time: 0.42, opacity: 0.42 }, { time: 0.68, opacity: 0.22 }],
    render: renderCrownCoinCarousel,
  },
  {
    output: "trh-chat-diamond-lucky-halo.apng",
    previewOutput: "trh-chat-diamond-lucky-halo.png",
    previewFrames: [{ time: 0.26, opacity: 1 }, { time: 0.56, opacity: 0.38 }, { time: 0.8, opacity: 0.2 }],
    render: renderDiamondLuckyHalo,
  },
  {
    output: "trh-chat-thumbs-up-pop.apng",
    previewOutput: "trh-chat-thumbs-up-pop.png",
    previewFrames: [{ time: 0.2, opacity: 1 }, { time: 0.42, opacity: 0.46 }, { time: 0.72, opacity: 0.24 }],
    render: renderThumbsUpPop,
    enhanceOpacity: 0.05,
  },
  {
    output: "trh-chat-double-like-rush.apng",
    previewOutput: "trh-chat-double-like-rush.png",
    previewFrames: [{ time: 0.24, opacity: 1 }, { time: 0.48, opacity: 0.42 }, { time: 0.74, opacity: 0.22 }],
    render: renderDoubleLikeRush,
    enhanceOpacity: 0.05,
  },
];

export const regenerateChatApngs = async (rootDir, options = {}) => {
  const winkDir = path.join(rootDir, "public", "winks", "chat");
  const previewDir = path.join(rootDir, "public", "previews", "chat");
  const only = Array.isArray(options.only) && options.only.length > 0
    ? new Set(options.only.map((entry) => entry.toLowerCase()))
    : null;

  await fs.mkdir(winkDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });

  const exportEffects = only
    ? effects.filter((effect) => only.has(effect.output.toLowerCase()) || only.has(effect.previewOutput.toLowerCase()))
    : effects;

  for (const effect of exportEffects) {
    const enhancementSeed = hashString(effect.output);
    const frames = Array.from({ length: FRAME_COUNT }, (_, frameIndex) => {
      const time = frameIndex / FRAME_COUNT;
      return compressRgba(renderEnhancedChatFrame(effect, time, enhancementSeed));
    });

    await fs.writeFile(path.join(winkDir, effect.output), buildApng(frames));

    await fs.writeFile(path.join(previewDir, effect.previewOutput), buildPng(renderPreviewChatFrame(effect, enhancementSeed)));
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args.slice(onlyIndex + 1).filter(Boolean) : [];
  regenerateChatApngs(process.cwd(), { only });
}
