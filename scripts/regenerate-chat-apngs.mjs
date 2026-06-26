import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const WIDTH = 768;
const HEIGHT = 1024;
const FRAME_COUNT = 54;
const FRAME_DELAY_MS = 58;
const FRAME_START_OFFSET = 0.02;
const TAU = Math.PI * 2;
const EDGE_FADE_RATIO = 0.1;
const EDGE_FULL_DISSOLVE_RATIO = 0.02;

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
const smoothstep = (value) => {
  const t = clamp(value);
  return t * t * (3 - (2 * t));
};
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
const createWinkTimeline = (time) => {
  const progress = clamp(time);
  const intro = easeInOutSine(clamp(progress / 0.1875));
  const formation = easeInOutSine(clamp((progress - 0.1875) / 0.1875));
  const hero = easeInOutSine(clamp((progress - 0.375) / 0.1875));
  const hold = easeInOutSine(clamp((progress - 0.5625) / 0.1875));
  const dissolve = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const exit = dissolve;
  const renderTime = progress;
  const visibleAlpha = clamp((intro * 0.84) + (formation * 0.16)) * (1 - (exit * 0.96));
  const enhancementAlpha = visibleAlpha * (1 - dissolve);
  return {
    progress,
    renderTime,
    intro,
    formation,
    hero,
    hold,
    dissolve,
    exit,
    visibleAlpha,
    enhancementAlpha,
  };
};

const getMessengerBeat = (time, timeline) => {
  const resolvedTimeline = timeline ?? createWinkTimeline(time);
  const pulse = 0.5 + (0.5 * Math.sin((resolvedTimeline.progress - 0.36) * TAU * 1.2));
  const holdWindow = clamp((resolvedTimeline.progress - 0.5) / 0.22);
  const dissolveDrift = easeInOutSine(clamp((resolvedTimeline.progress - 0.72) / 0.28));

  return {
    ...resolvedTimeline,
    heroAlpha: resolvedTimeline.visibleAlpha * (1 - (resolvedTimeline.dissolve * 0.7)),
    pulse,
    holdWindow,
    dissolveDrift,
  };
};

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

const drawFivePointStar = (buffer, cx, cy, outerRadius, innerRadius, rotation, color, alpha = 1) => {
  const points = [];
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation - (Math.PI / 2) + ((point / 10) * TAU);
    points.push({
      x: cx + (Math.cos(angle) * radius),
      y: cy + (Math.sin(angle) * radius),
    });
  }

  const maxRadius = outerRadius + 2;
  const minX = Math.max(0, Math.floor(cx - maxRadius));
  const maxX = Math.min(WIDTH - 1, Math.ceil(cx + maxRadius));
  const minY = Math.max(0, Math.floor(cy - maxRadius));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(cy + maxRadius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let inside = false;
      let minDistance = Infinity;

      for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
        const a = points[previous];
        const b = points[index];
        if (((a.y > y) !== (b.y > y)) && (x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)) {
          inside = !inside;
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segmentLength = (dx * dx) + (dy * dy);
        const t = segmentLength === 0 ? 0 : clamp(((x - a.x) * dx + (y - a.y) * dy) / segmentLength);
        const px = a.x + (dx * t);
        const py = a.y + (dy * t);
        minDistance = Math.min(minDistance, Math.hypot(x - px, y - py));
      }

      if (inside || minDistance < 1.4) {
        const edgeAlpha = inside ? 1 : clamp(1 - (minDistance / 1.4));
        putPixel(buffer, x, y, color, alpha * edgeAlpha);
      }
    }
  }
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
      const ny = (cy - y) / (size * 0.5);
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

const BINGO_BALL_LETTER_STROKES = {
  B: [[[-0.34, -0.5], [-0.34, 0.5]], [[-0.34, -0.5], [0.08, -0.5], [0.3, -0.32], [0.08, -0.12], [-0.34, -0.12]], [[-0.34, -0.12], [0.12, -0.12], [0.34, 0.08], [0.12, 0.5], [-0.34, 0.5]]],
  I: [[[0, -0.5], [0, 0.5]], [[-0.24, -0.5], [0.24, -0.5]], [[-0.24, 0.5], [0.24, 0.5]]],
  N: [[[-0.3, 0.5], [-0.3, -0.5]], [[-0.3, -0.5], [0.3, 0.5]], [[0.3, 0.5], [0.3, -0.5]]],
  G: [[[0.3, -0.34], [0.04, -0.5], [-0.3, -0.34], [-0.36, 0.12], [-0.1, 0.5], [0.32, 0.34]], [[0.32, 0.34], [0.32, 0.08], [0.04, 0.08]]],
  O: [[[0, -0.5], [0.3, -0.36], [0.36, 0], [0.3, 0.36], [0, 0.5], [-0.3, 0.36], [-0.36, 0], [-0.3, -0.36], [0, -0.5]]],
};

const BINGO_BALL_PREVIEW_FONT = {
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
};

const drawPathStroke = (buffer, points, radius, color, alpha = 1) => {
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[index + 1];
    drawCapsule(buffer, ax, ay, bx, by, radius, color, alpha);
  }
};

const drawBingoBallLetter = (buffer, cx, cy, radius, letter, color, alpha = 1) => {
  const glyph = BINGO_BALL_PREVIEW_FONT[String(letter).toUpperCase()] ?? BINGO_BALL_PREVIEW_FONT.O;
  const cell = radius * 0.128;
  const width = glyph[0].length * cell;
  const height = glyph.length * cell;
  const originX = cx - (width * 0.5);
  const originY = cy - (height * 0.5);
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] !== "1") continue;
      drawRotatedRect(buffer, originX + (col * cell) + (cell * 0.5), originY + (row * cell) + (cell * 0.5), cell * 1.06, cell * 1.06, 0, color, alpha * 0.95, cell * 0.08);
    }
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
  if (/^[A-Z]$/i.test(String(digit))) {
    drawBingoBallLetter(buffer, cx, cy, radius, digit, hexToRgb("#141414"), alpha * 0.96);
  } else {
    drawDigit(buffer, cx, cy, radius * 0.92, digit, hexToRgb("#141414"), alpha * 0.9);
  }
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

const drawBalloon = (buffer, cx, cy, size, color, alpha = 1, stringColor = hexToRgb("#fff7ec")) => {
  drawCircle(buffer, cx, cy - (size * 0.02), size * 1.16, color, alpha * 0.08);
  drawCapsule(buffer, cx, cy - (size * 0.38), cx, cy + (size * 0.3), size * 0.5, color, alpha * 0.96);
  drawCircle(buffer, cx, cy - (size * 0.56), size * 0.38, color, alpha * 0.92);
  drawCircle(buffer, cx, cy + (size * 0.26), size * 0.38, color, alpha * 0.74);
  drawDiamond(buffer, cx, cy + (size * 0.76), size * 0.2, 0, color, alpha * 0.88);
  drawCapsule(
    buffer,
    cx,
    cy + (size * 0.8),
    cx + (Math.sin((cy + size) * 0.01) * size * 0.08),
    cy + (size * 1.56),
    size * 0.03,
    stringColor,
    alpha * 0.44,
  );
  drawCircle(buffer, cx - (size * 0.22), cy - (size * 0.32), size * 0.16, hexToRgb("#ffffff"), alpha * 0.22);
  drawCapsule(
    buffer,
    cx - (size * 0.2),
    cy - (size * 0.14),
    cx - (size * 0.06),
    cy - (size * 0.42),
    size * 0.08,
    hexToRgb("#ffffff"),
    alpha * 0.16,
  );
};

const drawBirthdayCake = (buffer, cx, cy, width, palette, alpha = 1, candleProgress = 1) => {
  const bottomWidth = width;
  const topWidth = width * 0.68;
  const plateY = cy + (width * 0.3);
  const glowAlpha = palette.glowAlphaMultiplier ?? 1;

  drawCircle(buffer, cx, cy + (width * 0.02), width * 0.84, palette.glow, alpha * 0.08 * glowAlpha);
  drawCircle(buffer, cx, cy + (width * 0.18), width * 0.58, palette.glow, alpha * 0.06 * glowAlpha);
  drawCapsule(buffer, cx - (bottomWidth * 0.6), plateY, cx + (bottomWidth * 0.6), plateY, width * 0.08, palette.plate, alpha * 0.92);
  drawCapsule(
    buffer,
    cx - (bottomWidth * 0.5),
    plateY - (width * 0.03),
    cx + (bottomWidth * 0.5),
    plateY - (width * 0.03),
    width * 0.03,
    hexToRgb("#ffffff"),
    alpha * 0.2,
  );

  drawRotatedRect(buffer, cx, cy + (width * 0.08), bottomWidth * 0.96, width * 0.34, 0, palette.base, alpha * 0.98, 1.8);
  drawRotatedRect(buffer, cx, cy - (width * 0.12), topWidth, width * 0.22, 0, palette.top, alpha * 0.98, 1.8);
  drawRotatedRect(buffer, cx, cy + (width * 0.1), bottomWidth * 0.74, width * 0.06, 0, palette.icingAccent, alpha * 0.26, 1.1);
  drawRotatedRect(buffer, cx, cy - (width * 0.1), topWidth * 0.64, width * 0.05, 0, hexToRgb("#ffffff"), alpha * 0.16, 1.1);

  const topDrips = [-0.36, -0.18, 0, 0.18, 0.36];
  for (const offset of topDrips) {
    drawCircle(buffer, cx + (offset * topWidth), cy - (width * 0.01), width * 0.082, palette.icing, alpha * 0.94);
    drawCapsule(buffer, cx + (offset * topWidth), cy + (width * 0.02), cx + (offset * topWidth), cy + (width * 0.12), width * 0.03, palette.icing, alpha * 0.82);
  }

  const bottomDots = [-0.28, -0.12, 0.05, 0.22];
  for (const offset of bottomDots) {
    drawCircle(buffer, cx + (offset * bottomWidth), cy + (width * 0.06), width * 0.04, palette.dot, alpha * 0.88);
  }

  const candleOffsets = [-0.24, -0.12, 0, 0.12, 0.24];
  for (let candle = 0; candle < candleOffsets.length; candle += 1) {
    const offset = candleOffsets[candle];
    const lit = clamp((candleProgress - (candle * 0.16)) / 0.24);
    const candleX = cx + (offset * topWidth);
    const candleY = cy - (width * 0.26);
    const candleColor = candle % 2 === 0 ? palette.candleA : palette.candleB;

    drawRotatedRect(buffer, candleX, candleY, width * 0.052, width * 0.22, 0, candleColor, alpha * 0.94, 1.1);
    drawRotatedRect(buffer, candleX, candleY, width * 0.016, width * 0.2, 0, hexToRgb("#ffffff"), alpha * 0.24, 0.9);

    if (lit > 0) {
      drawCircle(buffer, candleX, candleY - (width * 0.15), width * 0.14, palette.flameGlow, alpha * lit * 0.08);
      drawFlame(buffer, candleX, candleY - (width * 0.13), width * 0.11, alpha * lit);
    }
  }
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

const drawGoldenStickerStar = (buffer, cx, cy, size, alpha = 1, rotation = 0) => {
  drawFivePointStar(buffer, cx, cy, size, size * 0.44, rotation, COLOR_GOLD, alpha * 0.96);
  drawFivePointStar(buffer, cx, cy, size * 0.72, size * 0.32, rotation, COLOR_GOLD_SOFT, alpha * 0.34);
  drawFivePointStar(buffer, cx - (size * 0.08), cy - (size * 0.08), size * 0.34, size * 0.16, rotation, COLOR_WHITE, alpha * 0.16);
  drawSpark(buffer, cx + (size * 0.22), cy - (size * 0.28), Math.max(3.2, size * 0.11), COLOR_WHITE, alpha * 0.28);
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

const getEdgeFadeAlpha = (x, y, width = WIDTH, height = HEIGHT) => {
  const xDistanceRatio = Math.min(x, width - 1 - x) / width;
  const yDistanceRatio = Math.min(y, height - 1 - y) / height;
  const edgeRatio = Math.min(xDistanceRatio, yDistanceRatio);
  return smoothstep((edgeRatio - EDGE_FULL_DISSOLVE_RATIO) / (EDGE_FADE_RATIO - EDGE_FULL_DISSOLVE_RATIO));
};

const applyGlobalEdgeFade = (rgba, width = WIDTH, height = HEIGHT) => {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edgeAlpha = getEdgeFadeAlpha(x, y, width, height);
      if (edgeAlpha >= 0.999) continue;

      const index = (y * width + x) * 4;
      const brightness = 0.68 + (edgeAlpha * 0.32);
      rgba[index] = Math.round(rgba[index] * brightness);
      rgba[index + 1] = Math.round(rgba[index + 1] * brightness);
      rgba[index + 2] = Math.round(rgba[index + 2] * brightness);
      rgba[index + 3] = Math.round(rgba[index + 3] * edgeAlpha);
    }
  }

  return rgba;
};

const compressRgbaWithEdgeFade = (rgba) => zlib.deflateSync(buildScanlines(applyGlobalEdgeFade(rgba)), { level: 9 });

const buildPng = (rgba) => {
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  parts.push(chunk("IHDR", ihdr));
  parts.push(chunk("IDAT", compressRgbaWithEdgeFade(rgba)));
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
  actl.writeUInt32BE(1, 4);
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

const scaleBufferAlpha = (buffer, alpha) => {
  if (alpha >= 0.999) return;

  for (let index = 3; index < buffer.length; index += 4) {
    buffer[index] = Math.round(buffer[index] * alpha);
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
  const timeline = createWinkTimeline(time);
  const frame = effect.render(timeline.renderTime, seed, timeline);
  if (timeline.progress < 0.12) {
    const starterAlpha = timeline.intro * (1 - clamp(timeline.progress / 0.12)) * 0.9;
    drawSpark(frame, WIDTH * 0.5, HEIGHT * 0.48, 5.2, COLOR_PINK, starterAlpha);
    drawSpark(frame, WIDTH * 0.46, HEIGHT * 0.5, 3.6, COLOR_WHITE, starterAlpha * 0.6);
    drawSpark(frame, WIDTH * 0.54, HEIGHT * 0.5, 3.6, COLOR_GOLD_SOFT, starterAlpha * 0.5);
  }
  if (enhancementOpacity > 0) {
    compositeBuffer(frame, renderPremiumChatEnhancement(timeline.renderTime, seed), enhancementOpacity * timeline.enhancementAlpha);
  }
  scaleBufferAlpha(frame, effect.disableTimelineAlpha ? 1 : timeline.visibleAlpha);
  return frame;
};

const renderPreviewChatFrame = (effect, seed) => {
  const heroFrame = effect.previewFrames.reduce(
    (best, frame) => (frame.opacity > best.opacity ? frame : best),
    effect.previewFrames[0] ?? { time: 0.2, opacity: 1 },
  );
  return effect.render(heroFrame.time, seed, createWinkTimeline(heroFrame.time));
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

const renderBirthdayCakePop = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const targetY = HEIGHT * 0.58;
  const entrance = easeOutBack(clamp(time * 3.6, 0, 1));
  const glowPulse = 0.74 + (0.26 * Math.sin(time * TAU * 1.18));
  const heroY = mix(HEIGHT + 260, targetY, entrance) + (Math.sin((time * TAU * 1.2) + 0.6) * 10);
  const candleProgress = clamp(time * 4.6, 0, 1);
  const cakePalette = {
    glow: COLOR_PINK,
    plate: hexToRgb("#ffe8fb"),
    base: COLOR_PINK,
    top: hexToRgb("#ff9fd8"),
    icing: hexToRgb("#fff3d9"),
    icingAccent: COLOR_GOLD_SOFT,
    dot: COLOR_CYAN,
    candleA: COLOR_CYAN,
    candleB: COLOR_GOLD,
    flameGlow: COLOR_GOLD,
  };

  drawShockwave(rgba, centerX, targetY + 96, 156 + (glowPulse * 24), COLOR_PINK, 0.08);
  drawShockwave(rgba, centerX, targetY + 92, 224 + (glowPulse * 18), COLOR_GOLD, 0.05);
  drawBurstRays(rgba, centerX, targetY + 22, 176 + (glowPulse * 8), 12, COLOR_PINK, COLOR_WHITE, 0.06, time * TAU * 0.04, 0.72);

  const sideBalloons = [
    { x: WIDTH * 0.22, y: HEIGHT * 0.36, size: 78, color: COLOR_CYAN, phase: 0.12 },
    { x: WIDTH * 0.78, y: HEIGHT * 0.34, size: 88, color: COLOR_GOLD, phase: 0.28 },
    { x: WIDTH * 0.14, y: HEIGHT * 0.58, size: 62, color: COLOR_PINK, phase: 0.44 },
    { x: WIDTH * 0.86, y: HEIGHT * 0.56, size: 66, color: COLOR_PURPLE, phase: 0.56 },
  ];

  for (const balloon of sideBalloons) {
    const drift = mod01((time * 0.18) + balloon.phase);
    const x = balloon.x + (Math.sin((time * TAU * 1.2) + balloon.phase * 7) * 14);
    const y = balloon.y + (Math.cos((time * TAU * 1.05) + balloon.phase * 5) * 18) - (drift * 26);
    drawBalloon(rgba, x, y, balloon.size, balloon.color, 0.54);
  }

  drawBirthdayCake(rgba, centerX, heroY, 270 + (glowPulse * 18), cakePalette, 0.98, candleProgress);

  for (let confetti = 0; confetti < 28; confetti += 1) {
    const angle = (-Math.PI * 0.92) + ((confetti / 27) * (Math.PI * 0.84));
    const burst = easeOutCubic(clamp((time - 0.08) * 2.6, 0, 1));
    const radius = 34 + (burst * (120 + ((confetti % 5) * 24)));
    const x = centerX + (Math.cos(angle) * radius) + (Math.sin(confetti + (time * TAU)) * 8);
    const y = heroY - 88 + (Math.sin(angle) * radius * 0.5) + (burst * 54);
    drawConfettiSprite(
      rgba,
      x,
      y,
      10 + ((confetti % 3) * 3),
      14 + ((confetti % 2) * 4),
      angle + (time * TAU * 0.3),
      confetti % 4 === 0 ? "diamond" : "rect",
      confetti % 4 === 0 ? COLOR_GOLD : confetti % 3 === 0 ? COLOR_CYAN : confetti % 2 === 0 ? COLOR_PINK : COLOR_WHITE,
      0.28,
    );
  }

  for (let sparkle = 0; sparkle < 18; sparkle += 1) {
    const angle = (sparkle / 18) * TAU;
    const radius = 96 + ((sparkle % 4) * 30);
    const x = centerX + (Math.cos(angle) * radius);
    const y = heroY - 18 + (Math.sin(angle) * radius * 0.56);
    drawSpark(rgba, x, y, 4.2 + ((sparkle % 3) * 1.2), sparkle % 2 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, 0.16);
  }

  drawTextBlock(rgba, "HBD", centerX, heroY - 150, 9 + (glowPulse * 0.5), COLOR_GOLD, 0.42, COLOR_WHITE);

  return rgba;
};

const renderBalloonWishBurst = (time) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.54;
  const inflate = easeOutBack(clamp(time * 4.4, 0, 1));
  const pulse = 0.72 + (0.28 * Math.sin((time * TAU * 1.12) + 0.4));
  const palette = [COLOR_PINK, COLOR_CYAN, COLOR_GOLD, COLOR_PURPLE, COLOR_HOT];
  const balloons = [
    { x: WIDTH * 0.18, y: HEIGHT * 0.66, size: 118, color: COLOR_CYAN, phase: 0.04, alpha: 0.72 },
    { x: WIDTH * 0.35, y: HEIGHT * 0.56, size: 156, color: COLOR_PINK, phase: 0.18, alpha: 0.94 },
    { x: WIDTH * 0.5, y: HEIGHT * 0.48, size: 184, color: COLOR_GOLD, phase: 0.32, alpha: 0.98 },
    { x: WIDTH * 0.66, y: HEIGHT * 0.56, size: 150, color: COLOR_PURPLE, phase: 0.46, alpha: 0.92 },
    { x: WIDTH * 0.84, y: HEIGHT * 0.66, size: 112, color: COLOR_HOT, phase: 0.62, alpha: 0.7 },
  ];

  drawShockwave(rgba, centerX, centerY + 42, 148 + (pulse * 28), COLOR_GOLD, 0.06);
  drawShockwave(rgba, centerX, centerY + 42, 214 + (pulse * 20), COLOR_PINK, 0.04);

  for (const balloon of balloons) {
    const rise = mod01((time * 0.22) + balloon.phase);
    const x = balloon.x + (Math.sin((time * TAU * 1.16) + balloon.phase * 8) * 18);
    const y = mix(HEIGHT + 220, balloon.y, inflate) - (rise * 32) + (Math.cos((time * TAU) + balloon.phase * 9) * 10);
    const size = balloon.size + (pulse * 8);
    drawBalloon(rgba, x, y, size, balloon.color, balloon.alpha);
  }

  const confettiWave = easeOutCubic(clamp((time - 0.06) * 3.1, 0, 1));
  for (let piece = 0; piece < 34; piece += 1) {
    const fromLeft = piece % 2 === 0;
    const lane = Math.floor(piece / 2);
    const x = fromLeft
      ? mix(-30, 150 + ((lane % 5) * 102), confettiWave)
      : mix(WIDTH + 30, WIDTH - 150 - ((lane % 5) * 102), confettiWave);
    const y = 180 + ((lane % 7) * 82) + (Math.sin((time * TAU * 1.5) + piece) * 16);
    drawConfettiSprite(
      rgba,
      x,
      y,
      12 + ((piece % 3) * 3),
      16 + ((piece % 2) * 3),
      (fromLeft ? -1 : 1) * (0.34 + (piece * 0.06)) + (time * TAU * 0.24),
      piece % 4 === 0 ? "diamond" : "rect",
      palette[piece % palette.length],
      0.3,
    );
  }

  const ribbonSweep = easeOutCubic(clamp((time - 0.18) * 2.6, 0, 1));
  const ribbons = [
    { fromX: -60, fromY: 244, toX: WIDTH * 0.86, toY: 522, color: COLOR_CYAN },
    { fromX: WIDTH + 60, fromY: 202, toX: WIDTH * 0.16, toY: 592, color: COLOR_PINK },
    { fromX: -40, fromY: 728, toX: WIDTH * 0.82, toY: 322, color: COLOR_GOLD },
  ];
  for (const ribbon of ribbons) {
    const midX = mix(ribbon.fromX, ribbon.toX, ribbonSweep);
    const midY = mix(ribbon.fromY, ribbon.toY, ribbonSweep);
    drawCapsule(rgba, ribbon.fromX, ribbon.fromY, midX, midY, 10, ribbon.color, 0.08);
    drawCapsule(rgba, ribbon.fromX, ribbon.fromY, midX, midY, 3.4, COLOR_WHITE, 0.16);
  }

  drawTextBlock(rgba, "HBD!", centerX, HEIGHT * 0.3, 11 + (pulse * 0.8), COLOR_GOLD, 0.52, COLOR_WHITE);

  for (let sparkle = 0; sparkle < 20; sparkle += 1) {
    const angle = (sparkle / 20) * TAU;
    const radius = 124 + ((sparkle % 4) * 28);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.48);
    drawSpark(rgba, x, y, 4.6 + ((sparkle % 3) * 1.3), sparkle % 2 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, 0.14);
  }

  return rgba;
};

const getHeartCurvePoint = (param, scale = 8.2) => {
  const heartX = 16 * (Math.sin(param) ** 3);
  const heartY = (13 * Math.cos(param)) - (5 * Math.cos(2 * param)) - (2 * Math.cos(3 * param)) - Math.cos(4 * param);
  return {
    x: heartX * scale,
    y: -heartY * scale * 0.92,
  };
};

const CALM_CHAT_PREVIEW_FRAMES = [{ time: 0.56, opacity: 1 }, { time: 0.68, opacity: 0.26 }];
const CALM_HEART_PREVIEW_FRAMES = [{ time: 0.62, opacity: 1 }, { time: 0.72, opacity: 0.24 }];
const CALM_BIRTHDAY_PREVIEW_FRAMES = [{ time: 0.58, opacity: 1 }, { time: 0.7, opacity: 0.22 }];

const renderMessengerCelebrationWink = (time, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.54;
  const heroAlpha = beat.heroAlpha;
  const heroPulse = 0.92 + (beat.pulse * 0.08);
  const dissolveShift = beat.dissolve * 140;

  drawCircle(rgba, centerX, centerY + 80, 164 + (beat.pulse * 18), COLOR_GOLD_SOFT, heroAlpha * 0.04);

  if (variant === "storm") {
    for (let ribbon = 0; ribbon < 3; ribbon += 1) {
      const angle = -0.78 + (ribbon * 0.78);
      const travel = easeInOutSine(clamp((beat.progress - (ribbon * 0.025)) / 0.36));
      const targetX = centerX + (Math.cos(angle) * 224);
      const targetY = centerY - 140 + (Math.sin(angle) * 74);
      const currentX = mix(centerX, targetX, travel);
      const currentY = mix(HEIGHT - 90, targetY, travel) + dissolveShift;
      drawCapsule(rgba, centerX, HEIGHT - 86, currentX, currentY, 8, ribbon === 1 ? COLOR_CYAN : ribbon === 2 ? COLOR_PINK : COLOR_GOLD, heroAlpha * 0.09);
      drawCapsule(rgba, centerX, HEIGHT - 86, currentX, currentY, 2.6, COLOR_WHITE, heroAlpha * 0.18);
    }

    for (let piece = 0; piece < 22; piece += 1) {
      const move = easeInOutSine(clamp((beat.progress - (piece * 0.004)) / 0.42));
      const angle = -1.02 + ((piece / 21) * 2.04);
      const radius = 86 + ((piece % 4) * 28);
      const targetX = centerX + (Math.cos(angle) * radius);
      const targetY = centerY - 34 + (Math.sin(angle) * 112);
      const x = mix(centerX + ((piece % 2 === 0 ? -1 : 1) * (18 + ((piece % 3) * 14))), targetX, move);
      const y = mix(HEIGHT - 90, targetY, move) + dissolveShift;
      const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.88));
      drawConfettiSprite(rgba, x, y, 14 + ((piece % 3) * 3), 8 + ((piece % 2) * 2), angle + (piece * 0.16), piece % 4 === 0 ? "diamond" : "rect", confettiPalette[piece % confettiPalette.length], alpha);
    }
  } else if (variant === "prism") {
    const sweeps = [
      { fromX: -60, fromY: HEIGHT * 0.38, toX: WIDTH * 0.62, toY: centerY + 60, color: COLOR_CYAN },
      { fromX: WIDTH + 60, fromY: HEIGHT * 0.34, toX: WIDTH * 0.38, toY: centerY + 42, color: COLOR_PINK },
    ];

    sweeps.forEach((sweep, index) => {
      const move = easeInOutSine(clamp((beat.progress - (index * 0.04)) / 0.34));
      const midX = mix(sweep.fromX, sweep.toX, move);
      const midY = mix(sweep.fromY, sweep.toY, move) + dissolveShift;
      drawCapsule(rgba, sweep.fromX, sweep.fromY, midX, midY, 10, sweep.color, heroAlpha * 0.08);
      drawCapsule(rgba, sweep.fromX, sweep.fromY, midX, midY, 3, COLOR_WHITE, heroAlpha * 0.18);
    });

    for (let piece = 0; piece < 18; piece += 1) {
      const fromLeft = piece % 2 === 0;
      const move = easeInOutSine(clamp((beat.progress - (piece * 0.006)) / 0.42));
      const targetX = centerX + ((fromLeft ? -1 : 1) * (54 + ((piece % 5) * 18)));
      const targetY = centerY - 120 + ((piece % 6) * 38);
      const startX = fromLeft ? -40 : WIDTH + 40;
      const startY = 180 + ((piece % 6) * 64);
      const x = mix(startX, targetX, move);
      const y = mix(startY, targetY, move) + dissolveShift;
      const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.9));
      drawConfettiSprite(rgba, x, y, 12 + ((piece % 3) * 3), 8, (fromLeft ? -1 : 1) * 0.42 + (piece * 0.1), piece % 3 === 0 ? "diamond" : "rect", confettiPalette[piece % confettiPalette.length], alpha);
    }
  } else {
    const anchors = [WIDTH * 0.22, WIDTH * 0.5, WIDTH * 0.78];

    anchors.forEach((anchor, index) => {
      const travel = easeInOutSine(clamp((beat.progress - (index * 0.035)) / 0.32));
      const endY = centerY - 180 + (index * 28);
      const currentY = mix(-140, endY, travel) + dissolveShift;
      drawCapsule(rgba, anchor, -140, anchor, currentY, 8, index === 1 ? COLOR_GOLD : index === 2 ? COLOR_CYAN : COLOR_PINK, heroAlpha * 0.08);
      drawCapsule(rgba, anchor, -140, anchor, currentY, 2.2, COLOR_WHITE, heroAlpha * 0.18);
    });

    for (let piece = 0; piece < 18; piece += 1) {
      const move = easeInOutSine(clamp((beat.progress - (piece * 0.005)) / 0.4));
      const anchor = anchors[piece % anchors.length];
      const targetX = anchor + Math.sin(piece * 0.8) * 44;
      const targetY = centerY - 134 + ((piece % 6) * 44);
      const x = mix(anchor, targetX, move);
      const y = mix(-70 - ((piece % 4) * 30), targetY, move) + dissolveShift;
      const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.88));
      drawConfettiSprite(rgba, x, y, 12 + ((piece % 3) * 2), 7 + ((piece % 2) * 2), piece * 0.14, piece % 4 === 0 ? "diamond" : "rect", confettiPalette[piece % confettiPalette.length], alpha);
    }
  }

  for (let sparkle = 0; sparkle < 10; sparkle += 1) {
    const angle = -1.1 + ((sparkle / 9) * 2.2);
    const radius = 124 + ((sparkle % 3) * 20);
    drawSpark(
      rgba,
      centerX + (Math.cos(angle) * radius),
      centerY + (Math.sin(angle) * radius * 0.56) + dissolveShift,
      4.6 + ((sparkle % 2) * 1.2),
      sparkle % 2 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE,
      heroAlpha * (0.1 + (beat.holdWindow * 0.08)),
    );
  }

  drawSpark(rgba, centerX, centerY + 18 + dissolveShift, 20 * heroPulse, COLOR_GOLD_SOFT, heroAlpha * 0.16);
  return rgba;
};

const renderMessengerConfettiBurstFormation = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.48;
  const appear = clamp((progress + 0.05) / 0.16);
  const formation = easeOutBack(clamp((progress - 0.18) / 0.19));
  const hold = easeInOutSine(clamp((progress - 0.4) / 0.18));
  const dissolve = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - dissolve);
  const glowPulse = 0.5 + (0.5 * Math.sin(clamp((progress - 0.38) / 0.32) * TAU * 1.45));

  const drawRibbon = (startAngle, color, delay) => {
    const form = easeInOutSine(clamp((progress - 0.16 - delay) / 0.22));
    const alpha = visible * form * (1 - (dissolve * 0.82));
    if (alpha <= 0.01) return;

    const length = 214 + (Math.sin(startAngle * 2.4) * 20);
    const wave = 28 + (Math.cos(startAngle * 1.7) * 8);
    let previous = null;
    for (let step = 0; step <= 10; step += 1) {
      const t = (step / 10) * form;
      const radius = 24 + (length * t) + (dissolve * 120 * t);
      const angle = startAngle + (Math.sin(t * Math.PI * 2) * 0.12);
      const curve = Math.sin(t * Math.PI * 3) * wave * (1 - (dissolve * 0.45));
      const x = centerX + (Math.cos(angle) * radius) + (Math.cos(angle + Math.PI * 0.5) * curve);
      const y = centerY + (Math.sin(angle) * radius * 0.72) + (Math.sin(angle + Math.PI * 0.5) * curve * 0.72);

      if (previous) {
        drawCapsule(rgba, previous.x, previous.y, x, y, 4.8, color, alpha * 0.16);
        drawCapsule(rgba, previous.x, previous.y, x, y, 1.5, COLOR_WHITE, alpha * 0.18);
      }
      previous = { x, y };
    }
  };

  drawRibbon(-2.48, COLOR_PINK, 0);
  drawRibbon(-0.64, COLOR_CYAN, 0.025);
  drawRibbon(0.34, COLOR_GOLD, 0.05);
  drawRibbon(2.3, COLOR_PURPLE, 0.075);

  for (let piece = 0; piece < 68; piece += 1) {
    const delay = (piece % 8) * 0.006;
    const birth = clamp((progress + 0.08 - delay) / 0.12);
    const gather = easeInOutSine(clamp((progress - delay) / 0.2));
    const burst = easeOutBack(clamp((progress - 0.18 - (delay * 0.45)) / 0.19));
    const angle = ((piece / 68) * TAU) + ((piece % 5) * 0.08);
    const layer = piece % 5;
    const targetRadiusX = 76 + (layer * 34) + ((piece % 3) * 8);
    const targetRadiusY = 68 + (layer * 25) + ((piece % 4) * 6);
    const targetX = centerX + (Math.cos(angle) * targetRadiusX);
    const targetY = centerY + (Math.sin(angle) * targetRadiusY);
    const edge = piece % 4;
    const startX = edge === 0 ? 34 : edge === 1 ? WIDTH - 34 : 96 + ((piece * 37) % (WIDTH - 192));
    const startY = edge === 2 ? 44 : edge === 3 ? HEIGHT - 44 : 112 + ((piece * 53) % (HEIGHT - 264));
    const gatherX = centerX + (Math.cos(angle + 0.9) * (20 + ((piece % 4) * 8)));
    const gatherY = centerY + (Math.sin(angle + 0.9) * (16 + ((piece % 3) * 7)));
    const settledX = mix(mix(startX, gatherX, gather), targetX, burst);
    const settledY = mix(mix(startY, gatherY, gather), targetY, burst);
    const exitX = settledX + (Math.cos(angle) * dissolve * (168 + (layer * 20)));
    const exitY = settledY + (Math.sin(angle) * dissolve * (128 + (layer * 16))) + (dissolve * 46);
    const alpha = visible * birth * (0.22 + (gather * 0.34) + (burst * 0.44)) * (1 - (dissolve * 0.68));
    const spin = (progress * TAU * (0.9 + (piece % 4) * 0.18)) + (piece * 0.31);
    const size = 9 + ((piece % 4) * 2.2);

    if (alpha <= 0.01) continue;
    drawConfettiSprite(
      rgba,
      exitX,
      exitY,
      size,
      Math.max(4.6, size * 0.58),
      spin,
      piece % 5 === 0 ? "diamond" : "rect",
      confettiPalette[piece % confettiPalette.length],
      alpha,
    );
  }

  for (let sparkle = 0; sparkle < 12; sparkle += 1) {
    const show = easeInOutSine(clamp((progress - 0.28 - ((sparkle % 4) * 0.025)) / 0.22));
    const angle = -1.04 + ((sparkle / 11) * 2.08);
    const radius = 106 + ((sparkle % 4) * 30) + (dissolve * 82);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.64) - (dissolve * 26);
    const alpha = visible * show * (0.04 + (hold * 0.06) + (glowPulse * hold * 0.026)) * (1 - (dissolve * 0.7));
    drawSpark(rgba, x, y, 3.8 + ((sparkle % 3) * 1.1), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  const glowAlpha = visible * formation * (0.028 + (hold * 0.034) + (glowPulse * hold * 0.016)) * (1 - (dissolve * 0.78));
  if (glowAlpha > 0.004) {
    drawShockwave(rgba, centerX, centerY, 124 + (hold * 18) + (dissolve * 86), COLOR_GOLD_SOFT, glowAlpha);
  }

  return rgba;
};

const renderMessengerPartyHornCelebration = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.5;
  const appear = clamp((progress + 0.04) / 0.16);
  const hornIn = easeOutBack(clamp(progress / 0.2));
  const blast = easeOutCubic(clamp((progress - 0.18) / 0.17));
  const hero = easeInOutSine(clamp((progress - 0.35) / 0.18));
  const hold = easeInOutSine(clamp((progress - 0.5) / 0.12));
  const dissolve = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - dissolve);
  const impactFlash = Math.exp(-(((progress - 0.19) / 0.055) ** 2));
  const pulse = 0.5 + (0.5 * Math.sin(clamp((progress - 0.36) / 0.36) * TAU * 1.65));
  const partyPower = clamp((blast * 0.44) + (hero * 0.32) + (hold * 0.24));

  const hornLength = 236;
  const hornScale = 1.28 + (impactFlash * 0.05) + (pulse * hold * 0.035);
  const leftAngle = -0.1;
  const rightAngle = Math.PI + 0.1;
  const leftX = mix(-186, centerX - 236, hornIn) - (dissolve * 120);
  const rightX = mix(WIDTH + 186, centerX + 236, hornIn) + (dissolve * 120);
  const hornY = centerY + 34 + (Math.sin(progress * TAU * 0.62) * 7 * hero) + (dissolve * 42);

  const getMouth = (cx, cy, angle, scale) => ({
    x: cx + (Math.cos(angle) * hornLength * scale * 0.5),
    y: cy + (Math.sin(angle) * hornLength * scale * 0.5),
  });

  const drawPartyHorn = (cx, cy, angle, bodyColor, accentColor, alpha, scale = 1) => {
    if (alpha <= 0.01) return;

    const length = hornLength * scale;
    const tipWidth = 15 * scale;
    const mouthWidth = 78 * scale * (1 + (impactFlash * 0.12) + (pulse * hold * 0.04));
    const steps = 16;
    const axisX = Math.cos(angle);
    const axisY = Math.sin(angle);
    const tipX = cx - (axisX * length * 0.5);
    const tipY = cy - (axisY * length * 0.5);

    drawCircle(rgba, cx + (axisX * length * 0.24), cy + (axisY * length * 0.24), mouthWidth * 1.25, accentColor, alpha * 0.055);

    for (let step = 0; step < steps; step += 1) {
      const t = step / (steps - 1);
      const x = tipX + (axisX * length * t);
      const y = tipY + (axisY * length * t);
      const strip = length / steps * 1.14;
      const width = mix(tipWidth, mouthWidth, t);
      const color = step % 4 === 1 ? accentColor : step % 4 === 3 ? COLOR_GOLD : bodyColor;
      drawRotatedRect(rgba, x, y, strip, width, angle, color, alpha * (0.72 + (t * 0.22)), 1.5);
      if (step % 3 === 0) {
        drawRotatedRect(rgba, x, y - (width * 0.06), strip * 0.78, width * 0.14, angle, COLOR_WHITE, alpha * 0.18, 1);
      }
    }

    const mouthX = tipX + (axisX * length);
    const mouthY = tipY + (axisY * length);
    drawRing(rgba, mouthX, mouthY, mouthWidth * 0.5, Math.max(3.4, mouthWidth * 0.08), COLOR_WHITE, alpha * 0.56);
    drawRing(rgba, mouthX, mouthY, mouthWidth * 0.55, Math.max(4.4, mouthWidth * 0.1), accentColor, alpha * 0.46);
    drawCircle(rgba, mouthX - (axisX * mouthWidth * 0.12), mouthY - (axisY * mouthWidth * 0.12), mouthWidth * 0.21, COLOR_WHITE, alpha * 0.12);

    for (let stripe = 0; stripe < 5; stripe += 1) {
      const t = 0.2 + (stripe * 0.14);
      const x = tipX + (axisX * length * t);
      const y = tipY + (axisY * length * t);
      drawRotatedRect(rgba, x, y, 8 * scale, mix(tipWidth, mouthWidth, t) * 0.95, angle, COLOR_WHITE, alpha * 0.22, 1);
    }
  };

  const hornAlpha = visible * (0.12 + (hornIn * 0.88)) * (1 - (dissolve * 0.66));
  const leftMouth = getMouth(leftX, hornY, leftAngle, hornScale);
  const rightMouth = getMouth(rightX, hornY, rightAngle, hornScale);

  const flashAlpha = visible * impactFlash * 0.18 * (1 - dissolve);
  if (flashAlpha > 0.004) {
    drawCircle(rgba, centerX, centerY + 10, 120 + (impactFlash * 60), COLOR_GOLD_SOFT, flashAlpha * 0.35);
    drawShockwave(rgba, centerX, centerY + 8, 106 + (impactFlash * 128), COLOR_GOLD_SOFT, flashAlpha);
    drawShockwave(rgba, centerX, centerY + 8, 188 + (impactFlash * 180), COLOR_CYAN, flashAlpha * 0.48);
    drawShockwave(rgba, centerX, centerY + 8, 252 + (impactFlash * 210), COLOR_PINK, flashAlpha * 0.36);
  }

  for (let ribbon = 0; ribbon < 10; ribbon += 1) {
    const side = ribbon % 2 === 0 ? 1 : -1;
    const source = side === 1 ? leftMouth : rightMouth;
    const delay = (ribbon % 5) * 0.012;
    const show = easeOutCubic(clamp((progress - 0.17 - delay) / 0.22));
    const alpha = visible * show * (0.32 + (partyPower * 0.34)) * (1 - (dissolve * 0.78));
    if (alpha <= 0.01) continue;

    const baseAngle = side === 1 ? -0.48 + ((ribbon % 5) * 0.24) : Math.PI + 0.48 - ((ribbon % 5) * 0.24);
    const color = ribbon % 4 === 0 ? COLOR_GOLD : ribbon % 4 === 1 ? COLOR_CYAN : ribbon % 4 === 2 ? COLOR_PINK : COLOR_PURPLE;
    let previous = null;
    for (let step = 0; step <= 18; step += 1) {
      const t = step / 18;
      const travel = t * (230 + ((ribbon % 5) * 32) + (dissolve * 88));
      const wave = Math.sin((t * TAU * 1.8) + ribbon) * (28 + (partyPower * 22));
      const normal = baseAngle + (Math.PI * 0.5);
      const x = source.x + (Math.cos(baseAngle) * travel) + (Math.cos(normal) * wave);
      const y = source.y + (Math.sin(baseAngle) * travel * 0.76) + (Math.sin(normal) * wave * 0.62) + (dissolve * 88 * t);
      if (previous) {
        drawCapsule(rgba, previous.x, previous.y, x, y, 4.7, color, alpha * (0.2 + (t * 0.38)));
        drawCapsule(rgba, previous.x, previous.y, x, y, 1.35, COLOR_WHITE, alpha * 0.23);
      }
      previous = { x, y };
    }
  }

  for (let piece = 0; piece < 150; piece += 1) {
    const side = piece % 2 === 0 ? 1 : -1;
    const source = side === 1 ? leftMouth : rightMouth;
    const delay = (piece % 12) * 0.006 + (Math.floor(piece / 12) % 4) * 0.01;
    const birth = clamp((progress + 0.02 - delay) / 0.16);
    const launch = easeOutCubic(clamp((progress - 0.18 - delay) / 0.24));
    const rain = easeInOutSine(clamp((progress - 0.34 - delay) / 0.26));
    const drift = easeInOutSine(clamp((progress - 0.75 - delay) / 0.22));
    const spread = -0.82 + (((piece * 37) % 100) / 100) * 1.64;
    const baseAngle = side === 1 ? spread : Math.PI - spread;
    const burstDistance = launch * (74 + ((piece * 29) % 360));
    const fillX = 54 + ((piece * 71) % (WIDTH - 108));
    const fillY = 62 + ((piece * 53) % (HEIGHT - 170));
    const burstX = source.x + (Math.cos(baseAngle) * burstDistance);
    const burstY = source.y + (Math.sin(baseAngle) * burstDistance * 0.92);
    const x = mix(burstX, fillX, rain * 0.55) + (Math.sin((progress * TAU * 1.2) + piece) * (8 + (partyPower * 12)));
    const y = mix(burstY, fillY, rain * 0.48) + (drift * (72 + ((piece % 6) * 20)));
    const alpha = visible * birth * (0.22 + (blast * 0.42) + (hero * 0.24) + (hold * 0.16)) * (1 - (dissolve * 0.82));
    if (alpha <= 0.01) continue;

    drawConfettiSprite(
      rgba,
      x,
      y,
      8.8 + ((piece % 4) * 2.3),
      5.2 + ((piece % 3) * 1.4),
      (progress * TAU * (0.7 + ((piece % 5) * 0.06))) + (piece * 0.29),
      piece % 5 === 0 ? "diamond" : "rect",
      confettiPalette[(piece + (side === 1 ? 1 : 4)) % confettiPalette.length],
      alpha,
    );
  }

  const glowAlpha = visible * partyPower * (0.035 + (pulse * hold * 0.025)) * (1 - (dissolve * 0.8));
  if (glowAlpha > 0.004) {
    drawShockwave(rgba, centerX, centerY + 22, 170 + (pulse * 18) + (dissolve * 86), COLOR_GOLD_SOFT, glowAlpha);
    drawShockwave(rgba, centerX, centerY + 22, 278 + (pulse * 24) + (dissolve * 122), COLOR_PINK, glowAlpha * 0.38);
  }

  for (let sparkle = 0; sparkle < 24; sparkle += 1) {
    const show = easeInOutSine(clamp((progress - 0.22 - ((sparkle % 6) * 0.016)) / 0.2));
    const angle = -1.18 + ((sparkle / 23) * 2.36);
    const radius = 96 + ((sparkle % 5) * 32) + (dissolve * 78);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.62) + (dissolve * 38);
    const alpha = visible * show * (0.045 + (partyPower * 0.075)) * (1 - (dissolve * 0.78));
    drawSpark(rgba, x, y, 3.8 + ((sparkle % 3) * 1.2), sparkle % 2 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  drawPartyHorn(leftX, hornY, leftAngle, COLOR_PINK, COLOR_GOLD, hornAlpha, hornScale);
  drawPartyHorn(rightX, hornY + 4, rightAngle, COLOR_CYAN, COLOR_PURPLE, hornAlpha, hornScale);

  return rgba;
};

const renderMessengerHeavyConfettiRain = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.49;
  const appear = clamp((progress + 0.08) / 0.14);
  const prelude = easeInOutSine(clamp(progress / 0.12));
  const explosion = easeOutBack(clamp((progress - 0.105) / 0.12));
  const full = easeInOutSine(clamp((progress - 0.2) / 0.14));
  const peak = easeInOutSine(clamp((progress - 0.42) / 0.16));
  const dissolve = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - dissolve);
  const glowPulse = 0.5 + (0.5 * Math.sin(clamp((progress - 0.18) / 0.5) * TAU * 1.6));
  const stormPower = clamp(0.18 + (prelude * 0.14) + (explosion * 0.3) + (full * 0.25) + (peak * 0.24));

  const flash = Math.sin(clamp((progress - 0.105) / 0.16) * Math.PI) * (1 - dissolve);
  if (flash > 0.01) {
    drawShockwave(rgba, centerX, centerY, 84 + (flash * 260), COLOR_GOLD_SOFT, flash * 0.12);
    drawShockwave(rgba, centerX, centerY, 150 + (flash * 350), COLOR_PINK, flash * 0.055);
    drawSpark(rgba, centerX, centerY, 34 + (flash * 38), COLOR_GOLD_SOFT, flash * 0.32);
  }

  for (let ribbon = 0; ribbon < 10; ribbon += 1) {
    const delay = ribbon * 0.012;
    const sweep = easeOutBack(clamp((progress - 0.1 - delay) / 0.22));
    const alpha = visible * sweep * (0.14 + (stormPower * 0.2)) * (1 - (dissolve * 0.72));
    if (alpha <= 0.01) continue;

    const fromLeft = ribbon % 2 === 0;
    const baseY = 86 + (ribbon * 88);
    let previous = null;
    for (let step = 0; step <= 16; step += 1) {
      const t = step / 16;
      const x = mix(fromLeft ? -58 : WIDTH + 58, fromLeft ? WIDTH + 58 : -58, t);
      const y = baseY + (Math.sin((t * TAU * 1.6) + ribbon) * (28 + ((ribbon % 3) * 8))) + (dissolve * 118);
      const px = mix(centerX, x, sweep);
      const py = mix(centerY - 20, y, sweep);
      if (previous) {
        const color = ribbon % 3 === 0 ? COLOR_PINK : ribbon % 3 === 1 ? COLOR_CYAN : COLOR_GOLD;
        drawCapsule(rgba, previous.x, previous.y, px, py, 3.6 + ((ribbon % 3) * 0.8), color, alpha);
        drawCapsule(rgba, previous.x, previous.y, px, py, 1.1, COLOR_WHITE, alpha * 0.8);
      }
      previous = { x: px, y: py };
    }
  }

  for (let piece = 0; piece < 236; piece += 1) {
    const column = piece % 16;
    const row = Math.floor(piece / 16);
    const delay = (column * 0.0035) + ((row % 7) * 0.006);
    const birth = clamp((progress + 0.09 - delay) / 0.12);
    const blast = easeOutBack(clamp((progress - 0.105 - (delay * 0.45)) / 0.18));
    const fill = easeInOutSine(clamp((progress - 0.18 - (delay * 0.18)) / 0.24));
    const xBase = 24 + (column * ((WIDTH - 48) / 15));
    const startEdge = piece % 5;
    const startX = startEdge === 0 ? 22 : startEdge === 1 ? WIDTH - 22 : xBase + (Math.sin(row * 0.9) * 24);
    const startY = startEdge === 2 ? 28 : startEdge === 3 ? HEIGHT - 42 : 34 + ((row * 23 + column * 11) % 128);
    const targetX = 18 + ((piece * 67) % (WIDTH - 36));
    const targetY = 42 + ((piece * 91) % (HEIGHT - 120));
    const burstAngle = ((piece * 0.61803398875) % 1) * TAU;
    const burstRadius = blast * (80 + ((piece % 9) * 28));
    const blastX = centerX + (Math.cos(burstAngle) * burstRadius);
    const blastY = centerY + (Math.sin(burstAngle) * burstRadius * 0.74);
    const settledX = mix(blastX, targetX, fill);
    const settledY = mix(blastY, targetY, fill);
    const baseX = mix(startX, settledX, Math.max(blast, fill));
    const baseY = mix(startY, settledY, Math.max(blast, fill));
    const sway = Math.sin((progress * TAU * (0.55 + ((piece % 5) * 0.08))) + piece) * (9 + ((piece % 4) * 3));
    const downwardStorm = (full * (42 + ((piece % 6) * 10))) + (peak * (32 + ((piece % 5) * 8)));
    const driftOutX = Math.sin(piece * 0.74) * dissolve * (92 + ((piece % 4) * 26));
    const driftOutY = dissolve * (132 + ((piece % 7) * 24));
    const x = baseX + sway + driftOutX;
    const y = baseY + downwardStorm + driftOutY;
    const alpha = visible * birth * stormPower * (1 - (dissolve * 0.78));

    if (alpha <= 0.01) continue;
    const size = 7.6 + ((piece % 5) * 2.1) + (explosion * ((piece % 3) * 0.7));
    drawConfettiSprite(
      rgba,
      x,
      y,
      size,
      Math.max(4.2, size * 0.58),
      (progress * TAU * (0.8 + ((piece % 6) * 0.12))) + (piece * 0.23),
      piece % 6 === 0 ? "diamond" : "rect",
      confettiPalette[piece % confettiPalette.length],
      alpha,
    );
  }

  for (let burst = 0; burst < 54; burst += 1) {
    const show = easeOutBack(clamp((progress - 0.105 - ((burst % 9) * 0.006)) / 0.18));
    const angle = (burst / 54) * TAU;
    const radius = 38 + (show * (132 + ((burst % 5) * 34))) + (dissolve * 132);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.68) + (dissolve * 56);
    const alpha = visible * show * (0.22 + (peak * 0.2)) * (1 - (dissolve * 0.8));
    if (alpha <= 0.01) continue;
    drawConfettiSprite(
      rgba,
      x,
      y,
      10 + ((burst % 3) * 2.6),
      5.6 + ((burst % 2) * 1.8),
      (progress * TAU * 1.1) + burst,
      burst % 4 === 0 ? "diamond" : "rect",
      confettiPalette[(burst + 2) % confettiPalette.length],
      alpha,
    );
  }

  const glowAlpha = visible * full * (0.03 + (peak * 0.042) + (glowPulse * peak * 0.018)) * (1 - (dissolve * 0.78));
  if (glowAlpha > 0.004) {
    drawShockwave(rgba, centerX, centerY, 150 + (glowPulse * 18) + (dissolve * 132), COLOR_GOLD_SOFT, glowAlpha);
    drawShockwave(rgba, centerX, centerY, 250 + (glowPulse * 28) + (dissolve * 178), COLOR_CYAN, glowAlpha * 0.32);
  }

  for (let sparkle = 0; sparkle < 28; sparkle += 1) {
    const show = easeInOutSine(clamp((progress - 0.14 - ((sparkle % 7) * 0.014)) / 0.24));
    const angle = -1.12 + ((sparkle / 27) * 2.24);
    const radius = 120 + ((sparkle % 5) * 36) + (dissolve * 96);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.62) + (dissolve * 44);
    const alpha = visible * show * (0.044 + (peak * 0.07)) * (1 - (dissolve * 0.72));
    drawSpark(rgba, x, y, 3.4 + ((sparkle % 3) * 1), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  return rgba;
};

const renderMessengerGoldStarRain = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.47;
  const appear = clamp((progress + 0.08) / 0.16);
  const heroForm = easeOutBack(clamp((progress - 0.28) / 0.16));
  const hold = easeInOutSine(clamp((progress - 0.42) / 0.18));
  const dissolve = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - dissolve);
  const glowPulse = 0.5 + (0.5 * Math.sin(clamp((progress - 0.38) / 0.36) * TAU * 1.35));

  const starPoint = (unit, outerRadius = 182, innerRadius = 82) => {
    const segment = Math.floor(unit * 10) % 10;
    const local = (unit * 10) - segment;
    const angleA = -Math.PI / 2 + ((segment / 10) * TAU);
    const angleB = -Math.PI / 2 + (((segment + 1) / 10) * TAU);
    const radiusA = segment % 2 === 0 ? outerRadius : innerRadius;
    const radiusB = (segment + 1) % 2 === 0 ? outerRadius : innerRadius;
    return {
      x: mix(Math.cos(angleA) * radiusA, Math.cos(angleB) * radiusB, local),
      y: mix(Math.sin(angleA) * radiusA, Math.sin(angleB) * radiusB, local),
    };
  };

  for (let index = 0; index < 72; index += 1) {
    const delay = (index % 9) * 0.006 + (Math.floor(index / 9) * 0.004);
    const birth = clamp((progress + 0.08 - delay) / 0.12);
    const gather = easeInOutSine(clamp((progress - 0.04 - delay) / 0.34));
    const unit = ((index * 0.61803398875) % 1);
    const outline = starPoint(unit, 184 - ((index % 3) * 8), 82 - ((index % 2) * 6));
    const startBand = index % 4;
    const startX = startBand === 0 ? 34 + ((index * 41) % (WIDTH - 68)) : startBand === 1 ? 42 : startBand === 2 ? WIDTH - 42 : 70 + ((index * 57) % (WIDTH - 140));
    const startY = startBand === 0 ? 42 : startBand === 3 ? HEIGHT - 52 : 112 + ((index * 67) % (HEIGHT - 250));
    const targetX = centerX + outline.x;
    const targetY = centerY + (outline.y * 0.88);
    const orbit = Math.sin((progress * TAU * 0.42) + index) * (10 + ((index % 4) * 2));
    const driftOutX = Math.cos(unit * TAU) * dissolve * (96 + ((index % 5) * 16));
    const driftOutY = Math.sin(unit * TAU) * dissolve * (70 + ((index % 4) * 12)) - (dissolve * 24);
    const x = mix(startX, targetX, gather) + orbit * (1 - dissolve) + driftOutX;
    const y = mix(startY, targetY, gather) + (Math.cos((progress * TAU * 0.36) + index) * 7 * hold) + driftOutY;
    const alpha = visible * birth * (0.25 + (gather * 0.62) + (heroForm * 0.13)) * (1 - (dissolve * 0.72));
    const size = 5.8 + ((index % 5) * 1.5) + (heroForm * ((index % 3) * 0.7));

    if (alpha <= 0.01) continue;
    if (gather > 0.06 && progress < 0.45) {
      drawTrailDots(rgba, startX, startY, x, y, 3, 1.8, COLOR_GOLD_SOFT, alpha * 0.08);
    }
    drawGoldenStickerStar(rgba, x, y, size, alpha * 0.88, (progress * TAU * (0.18 + ((index % 4) * 0.04))) + index);
  }

  for (let rain = 0; rain < 30; rain += 1) {
    const delay = (rain % 6) * 0.012;
    const fall = easeInOutSine(clamp((progress - delay) / 0.56));
    const birth = clamp((progress + 0.06 - delay) / 0.12);
    const startX = 46 + ((rain * 83) % (WIDTH - 92));
    const startY = 36 + ((rain * 31) % 180);
    const targetY = 188 + ((rain * 73) % 520);
    const x = startX + (Math.sin((progress * TAU * 0.52) + rain) * 18) + (Math.sin(rain) * dissolve * 70);
    const y = mix(startY, targetY, fall) + (dissolve * 96);
    const alpha = visible * birth * (0.12 + (fall * 0.34) + (hold * 0.16)) * (1 - (dissolve * 0.82));
    if (alpha <= 0.01) continue;
    drawGoldenStickerStar(rgba, x, y, 4.5 + ((rain % 4) * 1.1), alpha * 0.74, progress * TAU * 0.32 + rain);
  }

  const heroAlpha = visible * heroForm * (0.88 + (hold * 0.12)) * (1 - (dissolve * 0.82));
  if (heroAlpha > 0.01) {
    drawShockwave(rgba, centerX, centerY, 132 + (glowPulse * 14) + (dissolve * 92), COLOR_GOLD_SOFT, heroAlpha * 0.055);
    drawGoldenStickerStar(rgba, centerX, centerY, 132 + (glowPulse * hold * 7) - (dissolve * 8), heroAlpha, progress * 0.25);
    drawSpark(rgba, centerX, centerY, 38 + (glowPulse * 10), COLOR_GOLD_SOFT, heroAlpha * 0.16);
  }

  for (let sparkle = 0; sparkle < 18; sparkle += 1) {
    const show = easeInOutSine(clamp((progress - 0.32 - ((sparkle % 6) * 0.018)) / 0.24));
    const angle = -1.1 + ((sparkle / 17) * 2.2);
    const radius = 128 + ((sparkle % 5) * 34) + (dissolve * 72);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + (Math.sin(angle) * radius * 0.62) - (dissolve * 22);
    const alpha = visible * show * (0.04 + (hold * 0.06) + (glowPulse * hold * 0.025)) * (1 - (dissolve * 0.76));
    drawSpark(rgba, x, y, 3.6 + ((sparkle % 3) * 1.2), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  return rgba;
};

const renderMessengerGoldenStarPack = (time, _seed, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.46;
  const appear = clamp((progress + 0.06) / 0.14);
  const formation = easeInOutSine(clamp((progress - 0.1) / 0.22));
  const burst = easeOutBack(clamp((progress - 0.2) / 0.18));
  const hold = easeInOutSine(clamp((progress - 0.44) / 0.18));
  const dissolve = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - dissolve);
  const glowPulse = 0.5 + (0.5 * Math.sin(clamp((progress - 0.28) / 0.42) * TAU * 1.45));

  if (variant === "explosion") {
    const impact = Math.exp(-(((progress - 0.25) / 0.07) ** 2));
    if (impact > 0.01) {
      drawCircle(rgba, centerX, centerY, 132 + (impact * 96), COLOR_GOLD_SOFT, visible * impact * 0.05);
      drawShockwave(rgba, centerX, centerY, 82 + (impact * 260), COLOR_GOLD_SOFT, visible * impact * 0.16);
      drawShockwave(rgba, centerX, centerY, 154 + (impact * 330), COLOR_WHITE, visible * impact * 0.06);
    }

    for (let star = 0; star < 92; star += 1) {
      const delay = (star % 11) * 0.006;
      const gather = easeInOutSine(clamp((progress - delay) / 0.2));
      const blast = easeOutBack(clamp((progress - 0.2 - (delay * 0.35)) / 0.28));
      const unit = ((star * 0.61803398875) % 1);
      const angle = (unit * TAU) + (Math.sin(star) * 0.08);
      const startEdge = star % 4;
      const startX = startEdge === 0 ? 28 : startEdge === 1 ? WIDTH - 28 : 70 + ((star * 53) % (WIDTH - 140));
      const startY = startEdge === 2 ? 36 : startEdge === 3 ? HEIGHT - 52 : 130 + ((star * 71) % (HEIGHT - 300));
      const gatherX = centerX + (Math.cos(angle + 0.8) * (24 + ((star % 5) * 8)));
      const gatherY = centerY + (Math.sin(angle + 0.8) * (18 + ((star % 4) * 7)));
      const explodeRadius = blast * (86 + ((star % 8) * 34));
      const x = mix(startX, gatherX, gather) + (Math.cos(angle) * explodeRadius) + (Math.cos(angle) * dissolve * 104);
      const y = mix(startY, gatherY, gather) + (Math.sin(angle) * explodeRadius * 0.78) + (dissolve * (42 + ((star % 5) * 12)));
      const alpha = visible * clamp((progress + 0.06 - delay) / 0.12) * (0.2 + (gather * 0.28) + (blast * 0.44) + (hold * 0.08)) * (1 - (dissolve * 0.82));
      if (alpha <= 0.01) continue;
      if (gather > 0.12 && progress < 0.38) {
        drawTrailDots(rgba, startX, startY, x, y, 3, 2.1, COLOR_GOLD_SOFT, alpha * 0.07);
      }
      drawGoldenStickerStar(rgba, x, y, 6 + ((star % 5) * 2.2) + (burst * ((star % 3) * 0.9)), alpha, progress * TAU * 0.3 + star);
    }

    const heroAlpha = visible * burst * (0.68 + (hold * 0.2)) * (1 - (dissolve * 0.86));
    if (heroAlpha > 0.01) {
      drawGoldenStickerStar(rgba, centerX, centerY, 118 + (glowPulse * hold * 10) - (dissolve * 12), heroAlpha * 0.88, progress * 0.22);
      drawSpark(rgba, centerX, centerY, 42 + (glowPulse * 12), COLOR_GOLD_SOFT, heroAlpha * 0.18);
    }
  } else if (variant === "galaxy") {
    const vortex = easeInOutSine(clamp((progress - 0.08) / 0.34));
    for (let arm = 0; arm < 5; arm += 1) {
      let previous = null;
      const color = arm % 2 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE;
      for (let step = 0; step <= 26; step += 1) {
        const t = step / 26;
        const angle = (arm / 5) * TAU + (t * TAU * 1.38) + (vortex * 1.4) - (dissolve * 0.7);
        const radius = (34 + (t * 330)) * (0.82 + (vortex * 0.18) + (dissolve * 0.28));
        const x = centerX + (Math.cos(angle) * radius);
        const y = centerY + (Math.sin(angle) * radius * 0.72) + (dissolve * 54 * t);
        if (previous && vortex > 0.05) {
          drawCapsule(rgba, previous.x, previous.y, x, y, 2.8, COLOR_GOLD, visible * vortex * (1 - t * 0.45) * 0.08);
          drawCapsule(rgba, previous.x, previous.y, x, y, 0.9, color, visible * vortex * (1 - t * 0.55) * 0.12);
        }
        previous = { x, y };
      }
    }

    for (let star = 0; star < 118; star += 1) {
      const delay = (star % 16) * 0.005;
      const show = easeInOutSine(clamp((progress - delay) / 0.28));
      const unit = ((star * 0.61803398875) % 1);
      const spiral = (unit * TAU * 3.2) + (progress * TAU * 0.28) + (star * 0.07);
      const radius = mix(360 + ((star % 5) * 18), 44 + ((star % 7) * 24), formation * 0.46) + (dissolve * (68 + ((star % 6) * 18)));
      const x = centerX + (Math.cos(spiral) * radius);
      const y = centerY + (Math.sin(spiral) * radius * 0.72) + (dissolve * 48);
      const alpha = visible * show * (0.18 + (formation * 0.34) + (hold * 0.18)) * (1 - (dissolve * 0.78));
      if (alpha <= 0.01) continue;
      drawGoldenStickerStar(rgba, x, y, 4.8 + ((star % 5) * 1.7), alpha * 0.82, spiral + progress);
    }

    const haloAlpha = visible * formation * (0.05 + (hold * 0.05)) * (1 - (dissolve * 0.8));
    if (haloAlpha > 0.004) {
      drawShockwave(rgba, centerX, centerY, 126 + (glowPulse * 22) + (dissolve * 120), COLOR_GOLD_SOFT, haloAlpha);
      drawSpark(rgba, centerX, centerY, 32 + (glowPulse * 12), COLOR_WHITE, haloAlpha * 1.8);
    }
  } else if (variant === "flash") {
    const flashIn = easeOutBack(clamp((progress - 0.08) / 0.16));
    const flashHold = easeInOutSine(clamp((progress - 0.32) / 0.18));
    const stars = [
      { x: centerX, y: centerY, size: 148, delay: 0, rot: 0.04 },
      { x: centerX - 178, y: centerY - 126, size: 86, delay: 0.035, rot: -0.18 },
      { x: centerX + 174, y: centerY - 108, size: 92, delay: 0.055, rot: 0.2 },
      { x: centerX - 146, y: centerY + 152, size: 80, delay: 0.075, rot: 0.32 },
      { x: centerX + 156, y: centerY + 162, size: 84, delay: 0.095, rot: -0.28 },
    ];

    const flashAlpha = visible * Math.sin(clamp((progress - 0.1) / 0.18) * Math.PI) * 0.1;
    if (flashAlpha > 0.002) {
      drawCircle(rgba, centerX, centerY, 230, COLOR_GOLD_SOFT, flashAlpha);
      drawShockwave(rgba, centerX, centerY, 150 + (flashIn * 210), COLOR_WHITE, flashAlpha * 1.2);
    }

    for (let index = 0; index < stars.length; index += 1) {
      const star = stars[index];
      const local = easeOutBack(clamp((progress - star.delay) / 0.19));
      const shrink = easeInOutSine(clamp((progress - 0.68 - star.delay * 0.5) / 0.28));
      const driftX = Math.cos(index * 1.9) * dissolve * (42 + (index * 8));
      const driftY = Math.sin(index * 1.4) * dissolve * 38 + (dissolve * 20);
      const scale = (0.18 + (local * 0.92) + (flashHold * 0.04)) * (1 - (shrink * 0.3));
      const alpha = visible * local * (0.78 + (hold * 0.16)) * (1 - (dissolve * 0.9));
      if (alpha <= 0.01) continue;
      drawGoldenStickerStar(rgba, star.x + driftX, star.y + driftY, star.size * scale, alpha, star.rot + (progress * 0.26));
      drawSpark(rgba, star.x + driftX, star.y + driftY, star.size * 0.22 * scale, COLOR_WHITE, alpha * 0.12);
    }

    for (let streak = 0; streak < 18; streak += 1) {
      const show = easeInOutSine(clamp((progress - 0.16 - ((streak % 6) * 0.012)) / 0.18));
      const angle = -0.9 + ((streak / 17) * 1.8);
      const radius = 78 + ((streak % 5) * 46);
      const x = centerX + (Math.cos(angle) * radius) + (dissolve * Math.cos(angle) * 74);
      const y = centerY + (Math.sin(angle) * radius * 0.64) + (dissolve * 38);
      drawSpark(rgba, x, y, 4.4 + ((streak % 3) * 1.2), streak % 4 === 0 ? COLOR_WHITE : COLOR_GOLD_SOFT, visible * show * (0.045 + hold * 0.05) * (1 - dissolve));
    }
  } else {
    const gather = easeInOutSine(clamp(progress / 0.22));
    const jackpotBurst = easeOutBack(clamp((progress - 0.18) / 0.22));
    const impact = Math.exp(-(((progress - 0.23) / 0.08) ** 2));
    if (impact > 0.01) {
      drawCircle(rgba, centerX, centerY, 160 + (impact * 120), COLOR_GOLD_SOFT, visible * impact * 0.06);
      drawShockwave(rgba, centerX, centerY, 102 + (impact * 270), COLOR_GOLD_SOFT, visible * impact * 0.18);
      drawShockwave(rgba, centerX, centerY, 190 + (impact * 320), COLOR_WHITE, visible * impact * 0.07);
    }

    for (let star = 0; star < 128; star += 1) {
      const delay = (star % 13) * 0.005;
      const birth = clamp((progress + 0.05 - delay) / 0.12);
      const unit = ((star * 0.61803398875) % 1);
      const angle = (unit * TAU) + (Math.sin(star * 0.72) * 0.1);
      const edge = star % 5;
      const startX = edge === 0 ? 32 : edge === 1 ? WIDTH - 32 : 68 + ((star * 47) % (WIDTH - 136));
      const startY = edge === 2 ? 38 : edge === 3 ? HEIGHT - 56 : 118 + ((star * 59) % (HEIGHT - 260));
      const gatherX = centerX + (Math.cos(angle + 0.4) * (30 + ((star % 6) * 8)));
      const gatherY = centerY + (Math.sin(angle + 0.4) * (22 + ((star % 5) * 7)));
      const blastRadius = jackpotBurst * (96 + ((star % 10) * 34));
      const fall = easeInOutSine(clamp((progress - 0.58 - delay) / 0.32));
      const x = mix(startX, gatherX, gather) + (Math.cos(angle) * blastRadius) + (Math.sin(star) * dissolve * 62);
      const y = mix(startY, gatherY, gather) + (Math.sin(angle) * blastRadius * 0.76) + (fall * (70 + ((star % 7) * 18))) + (dissolve * 82);
      const alpha = visible * birth * (0.18 + (gather * 0.24) + (jackpotBurst * 0.44) + (hold * 0.14)) * (1 - (dissolve * 0.84));
      if (alpha <= 0.01) continue;
      if (gather > 0.12 && progress < 0.34) {
        drawTrailDots(rgba, startX, startY, x, y, 3, 2.2, COLOR_GOLD_SOFT, alpha * 0.07);
      }
      drawGoldenStickerStar(rgba, x, y, 5.5 + ((star % 6) * 1.9), alpha, angle + progress);
    }

    const heroAlpha = visible * jackpotBurst * (0.62 + hold * 0.24) * (1 - (dissolve * 0.86));
    if (heroAlpha > 0.01) {
      drawGoldenStickerStar(rgba, centerX, centerY, 136 + (glowPulse * hold * 12) - (dissolve * 16), heroAlpha * 0.82, progress * 0.24);
      drawTextBlock(rgba, "WIN", centerX, centerY + 172, 8.2, COLOR_GOLD_SOFT, heroAlpha * 0.18, COLOR_WHITE);
    }
  }

  return rgba;
};

const renderMessengerHeartWink = (time, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = variant === "golden" ? HEIGHT * 0.45 : HEIGHT * 0.48;
  const baseScale = variant === "golden" ? 15.8 : variant === "drift" ? 16.4 : 17.2;
  const heroScale = baseScale * (0.94 + (beat.pulse * 0.06));
  const heroAlpha = beat.heroAlpha;

  drawHeartFill(rgba, centerX, centerY + 18, heroScale * 3.1, variant === "golden" ? hexToRgb("#f5c65b") : COLOR_PINK, heroAlpha * 0.06);

  for (let index = 0; index < 18; index += 1) {
    const param = (index / 18) * TAU;
    const target = getHeartCurvePoint(param, heroScale);
    const move = easeInOutSine(clamp((beat.progress - (index * 0.006)) / 0.42));
    const driftOut = beat.dissolve * (34 + ((index % 4) * 10));
    let startX = centerX;
    let startY = HEIGHT + 140;
    if (variant === "golden") {
      startX = centerX + (Math.sin(index * 0.9) * 110);
      startY = -120 - ((index % 5) * 28);
    } else if (variant === "drift") {
      startX = -110 - ((index % 3) * 34);
      startY = centerY + ((index % 6) * 34) - 120;
    } else {
      startX = centerX + ((index % 2 === 0 ? -1 : 1) * (44 + ((index % 4) * 20)));
      startY = HEIGHT + 80 + ((index % 5) * 22);
    }

    const x = mix(startX, centerX + target.x, move) + (Math.cos(param) * driftOut);
    const y = mix(startY, centerY + target.y, move) - (Math.sin(param) * driftOut * 0.3) - (beat.dissolve * 18);
    const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.86));
    const size = 18 + ((index % 3) * 5);
    const color = variant === "golden"
      ? goldHeartPalette[index % goldHeartPalette.length]
      : heartPulsePalette[index % heartPulsePalette.length];

    drawGlossyHeart(rgba, x, y, size, color, alpha);
  }

  for (let fill = 0; fill < 8; fill += 1) {
    const param = (fill / 8) * TAU;
    const target = getHeartCurvePoint(param, heroScale * 0.78);
    const move = easeInOutSine(clamp((beat.progress - 0.08 - (fill * 0.01)) / 0.44));
    const startX = variant === "drift" ? WIDTH + 100 : centerX + (Math.cos(param) * 26);
    const startY = variant === "golden" ? -70 : HEIGHT + 60;
    const x = mix(startX, centerX + target.x, move) + (Math.cos(param) * beat.dissolve * 18);
    const y = mix(startY, centerY + target.y, move) - (beat.dissolve * 24);
    const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.9));
    drawGlossyHeart(rgba, x, y, 14 + ((fill % 2) * 4), fill % 3 === 0 ? COLOR_GOLD_SOFT : heartPulsePalette[(fill + 2) % heartPulsePalette.length], alpha * 0.9);
  }

  for (let sparkle = 0; sparkle < 10; sparkle += 1) {
    const param = (sparkle / 10) * TAU;
    const point = getHeartCurvePoint(param, heroScale * 0.92);
    drawSpark(
      rgba,
      centerX + point.x,
      centerY + point.y,
      4 + ((sparkle % 2) * 1.2),
      sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE,
      heroAlpha * (0.12 + (beat.holdWindow * 0.08)),
    );
  }

  return rgba;
};

const renderMessengerBigHeartFormation = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.5;
  const heroScale = 20.4 * (0.98 + (beat.pulse * 0.03));
  const heroAlpha = beat.heroAlpha;
  const outlineCount = 24;
  const fillCount = 14;
  const sparkleCount = 8;

  drawHeartFill(rgba, centerX, centerY + 12, heroScale * 3.25, hexToRgb("#ff7bd4"), heroAlpha * 0.04);
  drawHeartFill(rgba, centerX, centerY + 12, heroScale * 2.5, hexToRgb("#ffffff"), heroAlpha * 0.018);

  for (let index = 0; index < outlineCount; index += 1) {
    const param = (index / outlineCount) * TAU;
    const target = getHeartCurvePoint(param, heroScale);
    const move = easeInOutSine(clamp((beat.progress - (index * 0.004)) / 0.44));
    const edge = index % 4;
    const startX = edge === 0
      ? centerX - 210 - ((index % 3) * 36)
      : edge === 1
        ? centerX + 210 + ((index % 3) * 36)
        : centerX + (Math.sin(index * 0.7) * 82);
    const startY = edge < 2
      ? centerY + 260 - ((index % 5) * 26)
      : HEIGHT + 110 + ((index % 4) * 24);
    const dissolveSpread = beat.dissolve * (34 + ((index % 4) * 8));
    const x = mix(startX, centerX + target.x, move) + (Math.cos(param) * dissolveSpread);
    const y = mix(startY, centerY + target.y, move) - (Math.sin(param) * dissolveSpread * 0.42) - (beat.dissolve * 16);
    const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.9));
    const size = (13 + ((index % 3) * 2.6)) * (0.98 + (beat.holdWindow * 0.04) + (beat.pulse * 0.02));
    const color = index % 5 === 0 ? COLOR_RED : heartPulsePalette[index % heartPulsePalette.length];

    drawGlossyHeart(rgba, x, y, size, color, alpha);
  }

  for (let fill = 0; fill < fillCount; fill += 1) {
    const param = (fill / fillCount) * TAU;
    const target = getHeartCurvePoint(param, heroScale * 0.74);
    const move = easeInOutSine(clamp((beat.progress - 0.08 - (fill * 0.008)) / 0.48));
    const startX = centerX + (Math.cos(param) * 12);
    const startY = HEIGHT + 90 + ((fill % 4) * 18);
    const dissolveSpread = beat.dissolve * (18 + ((fill % 3) * 8));
    const x = mix(startX, centerX + target.x, move) + (Math.cos(param) * dissolveSpread);
    const y = mix(startY, centerY + target.y, move) - (Math.sin(param) * dissolveSpread * 0.35) - (beat.dissolve * 14);
    const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.92));
    const size = (11.4 + ((fill % 2) * 2.4)) * (0.99 + (beat.pulse * 0.018));
    drawGlossyHeart(rgba, x, y, size, fill % 4 === 0 ? COLOR_RED : heartPulsePalette[(fill + 1) % heartPulsePalette.length], alpha * 0.96);
  }

  for (let sparkle = 0; sparkle < sparkleCount; sparkle += 1) {
    const param = (sparkle / sparkleCount) * TAU;
    const point = getHeartCurvePoint(param, heroScale * 0.92);
    drawSpark(
      rgba,
      centerX + point.x,
      centerY + point.y,
      3.8 + ((sparkle % 2) * 1.1),
      sparkle % 3 === 0 ? COLOR_PINK : COLOR_WHITE,
      heroAlpha * (0.06 + (beat.holdWindow * 0.04)),
    );
  }

  return rgba;
};

const renderMessengerHeartOrbitLove = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.44;
  const heroAlpha = beat.heroAlpha;
  const heartReveal = easeInOutSine(clamp((beat.progress - 0.2) / 0.22));
  const heartScale = 138 * (0.97 + (beat.pulse * 0.035));
  const orbitCount = 10;

  drawHeartFill(rgba, centerX, centerY + 12, heartScale * 1.54, hexToRgb("#ff95dd"), heroAlpha * heartReveal * 0.09);
  drawHeartFill(rgba, centerX, centerY + 12, heartScale * 1.2, hexToRgb("#ffffff"), heroAlpha * heartReveal * 0.025);

  for (let index = 0; index < orbitCount; index += 1) {
    const baseAngle = (index / orbitCount) * TAU;
    const orbitAngle = baseAngle + ((beat.progress - 0.38) * TAU * 0.14);
    const move = easeInOutSine(clamp((beat.progress - 0.04 - (index * 0.008)) / 0.48));
    const radiusX = 182 + ((index % 2) * 12);
    const radiusY = 126 + ((index % 3) * 8);
    const targetX = centerX + (Math.cos(orbitAngle) * radiusX);
    const targetY = centerY + 8 + (Math.sin(orbitAngle) * radiusY * 0.74);
    const startEdge = index % 4;
    const startX = startEdge === 0
      ? -100 - ((index % 3) * 24)
      : startEdge === 1
        ? WIDTH + 100 + ((index % 3) * 24)
        : centerX + (Math.cos(baseAngle) * (WIDTH * 0.42));
    const startY = startEdge < 2
      ? centerY - 54 + ((index % 5) * 34)
      : HEIGHT + 90 + ((index % 4) * 22);
    const dissolveSpread = beat.dissolve * (86 + ((index % 4) * 14));
    const x = mix(startX, targetX, move) + (Math.cos(orbitAngle) * dissolveSpread);
    const y = mix(startY, targetY, move) + (Math.sin(orbitAngle) * dissolveSpread * 0.92);
    const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.92));
    const size = (18 + ((index % 3) * 3.2)) * (0.98 + (beat.holdWindow * 0.04));
    const color = index % 4 === 0 ? COLOR_RED : heartPulsePalette[(index + 1) % heartPulsePalette.length];

    drawHeartFill(rgba, x, y, size + 8, hexToRgb("#fff3fb"), alpha * 0.07);
    drawGlossyHeart(rgba, x, y, size, color, alpha);
  }

  if (heartReveal > 0.01) {
    drawGlossyHeart(rgba, centerX, centerY + 10, heartScale, hexToRgb("#ff7bd4"), heroAlpha * heartReveal);
    drawHeartFill(rgba, centerX - 10, centerY - 2, heartScale * 0.6, hexToRgb("#ffffff"), heroAlpha * heartReveal * 0.14);
    drawHeartFill(rgba, centerX, centerY + 10, heartScale + 14, hexToRgb("#ffe3f5"), heroAlpha * heartReveal * 0.1);
  }

  for (let sparkle = 0; sparkle < 8; sparkle += 1) {
    const angle = -1 + ((sparkle / 7) * 2);
    const radius = 144 + ((sparkle % 2) * 26);
    drawSpark(
      rgba,
      centerX + (Math.cos(angle) * radius),
      centerY + 10 + (Math.sin(angle) * radius * 0.76),
      4.4 + ((sparkle % 2) * 1.1),
      sparkle % 2 === 0 ? COLOR_PINK : COLOR_WHITE,
      heroAlpha * (0.04 + (beat.holdWindow * 0.04)),
    );
  }

  return rgba;
};

const renderMessengerHeartRainFormation = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.47;
  const heroAlpha = beat.heroAlpha;
  const heroScale = 18.6 * (0.98 + (beat.pulse * 0.025));
  const outlineCount = 26;
  const fillCount = 12;

  drawHeartFill(rgba, centerX, centerY + 12, heroScale * 3.35, hexToRgb("#ff95dd"), heroAlpha * 0.045);
  drawHeartFill(rgba, centerX, centerY + 12, heroScale * 2.55, hexToRgb("#ffffff"), heroAlpha * 0.014);

  for (let index = 0; index < outlineCount; index += 1) {
    const param = (index / outlineCount) * TAU;
    const target = getHeartCurvePoint(param, heroScale);
    const gather = easeInOutSine(clamp((beat.progress - (index * 0.004)) / 0.46));
    const startX = centerX + (Math.sin(index * 1.18) * (170 + ((index % 3) * 30)));
    const startY = -96 - ((index % 7) * 34);
    const dissolveFall = beat.dissolve * (170 + ((index % 4) * 30));
    const dissolveSpread = beat.dissolve * (26 + ((index % 3) * 8));
    const x = mix(startX, centerX + target.x, gather) + (Math.cos(param) * dissolveSpread);
    const y = mix(startY, centerY + target.y, gather) + dissolveFall;
    const alpha = gather * heroAlpha * (1 - (beat.dissolve * 0.92));
    const size = (13.6 + ((index % 3) * 2.4)) * (0.99 + (beat.holdWindow * 0.035));
    const color = index % 5 === 0 ? COLOR_RED : heartPulsePalette[(index + 1) % heartPulsePalette.length];

    drawGlossyHeart(rgba, x, y, size, color, alpha);
  }

  for (let fill = 0; fill < fillCount; fill += 1) {
    const param = (fill / fillCount) * TAU;
    const target = getHeartCurvePoint(param, heroScale * 0.72);
    const gather = easeInOutSine(clamp((beat.progress - 0.1 - (fill * 0.008)) / 0.48));
    const startX = centerX + (Math.sin(fill * 0.92) * 86);
    const startY = -80 - ((fill % 5) * 42);
    const dissolveFall = beat.dissolve * (142 + ((fill % 3) * 34));
    const x = mix(startX, centerX + target.x, gather) + (Math.cos(param) * beat.dissolve * 18);
    const y = mix(startY, centerY + target.y, gather) + dissolveFall;
    const alpha = gather * heroAlpha * (1 - (beat.dissolve * 0.9));
    const size = (11.6 + ((fill % 2) * 2.2)) * (0.99 + (beat.pulse * 0.012));

    drawGlossyHeart(rgba, x, y, size, fill % 4 === 0 ? COLOR_RED : heartPulsePalette[(fill + 2) % heartPulsePalette.length], alpha * 0.94);
  }

  for (let rain = 0; rain < 7; rain += 1) {
    const fall = easeInOutSine(clamp((beat.progress - 0.02 - (rain * 0.018)) / 0.5));
    const x = centerX - 204 + (rain * 68) + (Math.sin(rain * 1.7) * 18);
    const targetY = centerY - 176 + ((rain % 3) * 42);
    const y = mix(-70 - ((rain % 4) * 30), targetY, fall) + (beat.dissolve * 138);
    const alpha = fall * heroAlpha * 0.46 * (1 - (beat.dissolve * 0.9));
    drawGlossyHeart(rgba, x, y, 9.4 + ((rain % 2) * 2), heartPulsePalette[rain % heartPulsePalette.length], alpha);
  }

  for (let sparkle = 0; sparkle < 6; sparkle += 1) {
    const param = (sparkle / 6) * TAU;
    const point = getHeartCurvePoint(param, heroScale * 0.88);
    drawSpark(
      rgba,
      centerX + point.x,
      centerY + point.y,
      3.6 + ((sparkle % 2) * 1),
      sparkle % 2 === 0 ? COLOR_PINK : COLOR_WHITE,
      heroAlpha * (0.035 + (beat.holdWindow * 0.035)) * (1 - beat.dissolve),
    );
  }

  return rgba;
};

const renderMessengerDoubleHeartPop = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.46;
  const heroAlpha = beat.heroAlpha;
  const merge = easeInOutSine(clamp((beat.progress - 0.04) / 0.38));
  const heroReveal = easeInOutSine(clamp((beat.progress - 0.3) / 0.16));
  const pulse = 1 + (Math.sin(clamp((beat.progress - 0.52) / 0.2) * Math.PI * 2) * 0.035 * beat.holdWindow);
  const mainSize = 136 * pulse;

  const leftX = mix(-96, centerX - 74, merge);
  const rightX = mix(WIDTH + 96, centerX + 74, merge);
  const sideY = centerY + (Math.sin(merge * Math.PI) * -26);
  const sideAlpha = heroAlpha * (1 - (heroReveal * 0.78)) * (1 - (beat.dissolve * 0.9));

  if (sideAlpha > 0.01) {
    drawHeartFill(rgba, leftX, sideY, 96, hexToRgb("#ff95dd"), sideAlpha * 0.08);
    drawGlossyHeart(rgba, leftX, sideY, 72 * (0.96 + (merge * 0.08)), hexToRgb("#ff63c7"), sideAlpha);
    drawHeartFill(rgba, rightX, sideY, 96, hexToRgb("#fff0cc"), sideAlpha * 0.08);
    drawGlossyHeart(rgba, rightX, sideY, 72 * (0.96 + (merge * 0.08)), hexToRgb("#ff4a3d"), sideAlpha);
  }

  if (heroReveal > 0.01) {
    const dissolveAlpha = heroAlpha * heroReveal * (1 - (beat.dissolve * 0.94));
    const driftY = beat.dissolve * 18;
    drawHeartFill(rgba, centerX, centerY + 10 + driftY, mainSize * 1.36, hexToRgb("#ff95dd"), dissolveAlpha * 0.09);
    drawHeartFill(rgba, centerX, centerY + 10 + driftY, mainSize * 1.08, hexToRgb("#ffffff"), dissolveAlpha * 0.025);
    drawGlossyHeart(rgba, centerX, centerY + 10 + driftY, mainSize, hexToRgb("#ff7bd4"), dissolveAlpha);
    drawHeartFill(rgba, centerX - 10, centerY - 2 + driftY, mainSize * 0.58, hexToRgb("#ffffff"), dissolveAlpha * 0.13);
  }

  for (let fragment = 0; fragment < 12; fragment += 1) {
    const angle = (fragment / 12) * TAU;
    const birth = easeInOutSine(clamp((beat.progress - 0.18 - (fragment * 0.006)) / 0.34));
    const dissolve = beat.dissolve;
    const baseRadius = 104 + ((fragment % 3) * 18);
    const holdX = centerX + (Math.cos(angle) * baseRadius);
    const holdY = centerY + 8 + (Math.sin(angle) * baseRadius * 0.64);
    const startX = fragment % 2 === 0 ? leftX : rightX;
    const startY = sideY + ((fragment % 3) * 10);
    const x = mix(startX, holdX, birth) + (Math.cos(angle) * dissolve * 104);
    const y = mix(startY, holdY, birth) + (Math.sin(angle) * dissolve * 82) + (dissolve * 18);
    const alpha = birth * heroAlpha * 0.58 * (1 - (dissolve * 0.94));
    const size = 10 + ((fragment % 3) * 2.5);
    const color = fragment % 4 === 0 ? COLOR_RED : heartPulsePalette[(fragment + 2) % heartPulsePalette.length];

    drawGlossyHeart(rgba, x, y, size, color, alpha);
  }

  for (let sparkle = 0; sparkle < 7; sparkle += 1) {
    const angle = -0.95 + ((sparkle / 6) * 1.9);
    const radius = 132 + ((sparkle % 2) * 24);
    drawSpark(
      rgba,
      centerX + (Math.cos(angle) * radius),
      centerY + 6 + (Math.sin(angle) * radius * 0.72),
      3.8 + ((sparkle % 2) * 1),
      sparkle % 2 === 0 ? COLOR_PINK : COLOR_WHITE,
      heroAlpha * (0.04 + (beat.holdWindow * 0.04)) * (1 - beat.dissolve),
    );
  }

  return rgba;
};

const renderMessengerFireworksWink = (time, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const heroAlpha = beat.heroAlpha;
  const burstConfigs = variant === "impact"
    ? [
      { x: WIDTH * 0.5, y: HEIGHT * 0.38, radius: 170, delay: 0.1, color: COLOR_HOT, accent: COLOR_WHITE, launchX: WIDTH * 0.5 },
      { x: WIDTH * 0.28, y: HEIGHT * 0.28, radius: 96, delay: 0.18, color: COLOR_PURPLE, accent: COLOR_WHITE, launchX: WIDTH * 0.22 },
      { x: WIDTH * 0.72, y: HEIGHT * 0.26, radius: 104, delay: 0.22, color: COLOR_CYAN, accent: COLOR_WHITE, launchX: WIDTH * 0.78 },
    ]
    : variant === "rocket"
      ? [
        { x: WIDTH * 0.22, y: HEIGHT * 0.3, radius: 88, delay: 0.08, color: COLOR_CYAN, accent: COLOR_WHITE, launchX: WIDTH * 0.18 },
        { x: WIDTH * 0.5, y: HEIGHT * 0.22, radius: 140, delay: 0.12, color: COLOR_HOT, accent: COLOR_WHITE, launchX: WIDTH * 0.5 },
        { x: WIDTH * 0.78, y: HEIGHT * 0.3, radius: 92, delay: 0.16, color: COLOR_PINK, accent: COLOR_WHITE, launchX: WIDTH * 0.82 },
      ]
      : [
        { x: WIDTH * 0.2, y: HEIGHT * 0.28, radius: 70, delay: 0.08, color: COLOR_CYAN, accent: COLOR_WHITE, launchX: WIDTH * 0.16 },
        { x: WIDTH * 0.35, y: HEIGHT * 0.2, radius: 78, delay: 0.12, color: COLOR_PINK, accent: COLOR_WHITE, launchX: WIDTH * 0.32 },
        { x: WIDTH * 0.5, y: HEIGHT * 0.16, radius: 90, delay: 0.16, color: COLOR_GOLD, accent: COLOR_WHITE, launchX: WIDTH * 0.5 },
        { x: WIDTH * 0.65, y: HEIGHT * 0.2, radius: 78, delay: 0.2, color: COLOR_PURPLE, accent: COLOR_WHITE, launchX: WIDTH * 0.68 },
        { x: WIDTH * 0.8, y: HEIGHT * 0.28, radius: 70, delay: 0.24, color: COLOR_CYAN, accent: COLOR_WHITE, launchX: WIDTH * 0.84 },
      ];

  for (const burst of burstConfigs) {
    const beaconAlpha = Math.max(0.05, beat.intro * 0.16) * (1 - (beat.dissolve * 0.7));
    drawSpark(rgba, burst.launchX, HEIGHT - 26, 8, burst.color, beaconAlpha);
    drawCircle(rgba, burst.launchX, HEIGHT - 26, 16, burst.color, beaconAlpha * 0.12);
  }

  for (const burst of burstConfigs) {
    const launch = easeInOutSine(clamp((beat.progress - burst.delay) / 0.18));
    const bloom = easeOutCubic(clamp((beat.progress - burst.delay - 0.1) / 0.22));
    const alpha = heroAlpha * clamp(0.22 + (bloom * 0.78)) * (1 - (beat.dissolve * 0.88));
    const currentLaunchY = mix(HEIGHT - 36, burst.y, launch);

    if (launch > 0.01) {
      drawCapsule(rgba, burst.launchX, HEIGHT - 24, burst.x, currentLaunchY, 3.6, burst.color, heroAlpha * 0.1);
      drawCapsule(rgba, burst.launchX, HEIGHT - 24, burst.x, currentLaunchY, 1.4, burst.accent, heroAlpha * 0.22);
    }

    if (bloom > 0.02) {
      const radius = burst.radius * (0.72 + (bloom * 0.34));
      drawBurstRays(rgba, burst.x, burst.y, radius, variant === "aurora" ? 12 : 16, burst.color, burst.accent, alpha, burst.delay * TAU, 0.72);
      drawSpark(rgba, burst.x, burst.y, 12 + (bloom * 10), burst.accent, alpha * 0.24);
      drawShockwave(rgba, burst.x, burst.y, radius * 0.44, burst.accent, alpha * 0.18);
    }
  }

  return rgba;
};

const renderMessengerFireworkCelebrationBlast = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const fade = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = clamp((progress + 0.04) / 0.12) * (1 - fade);
  const peak = easeInOutSine(clamp((progress - 0.34) / 0.24));
  const pulse = 0.5 + (0.5 * Math.sin(clamp((progress - 0.34) / 0.34) * TAU * 1.45));
  const bursts = [
    { x: WIDTH * 0.5, y: HEIGHT * 0.28, radius: 188, launchX: WIDTH * 0.48, launch: 0.0, boom: 0.18, color: COLOR_GOLD, accent: COLOR_WHITE, rays: 22 },
    { x: WIDTH * 0.25, y: HEIGHT * 0.32, radius: 142, launchX: WIDTH * 0.2, launch: 0.03, boom: 0.24, color: COLOR_PINK, accent: COLOR_WHITE, rays: 18 },
    { x: WIDTH * 0.75, y: HEIGHT * 0.31, radius: 148, launchX: WIDTH * 0.8, launch: 0.05, boom: 0.28, color: COLOR_CYAN, accent: COLOR_WHITE, rays: 18 },
    { x: WIDTH * 0.38, y: HEIGHT * 0.49, radius: 156, launchX: WIDTH * 0.36, launch: 0.12, boom: 0.36, color: COLOR_PURPLE, accent: COLOR_GOLD_SOFT, rays: 20 },
    { x: WIDTH * 0.62, y: HEIGHT * 0.52, radius: 164, launchX: WIDTH * 0.64, launch: 0.14, boom: 0.4, color: COLOR_HOT, accent: COLOR_WHITE, rays: 20 },
    { x: WIDTH * 0.18, y: HEIGHT * 0.55, radius: 118, launchX: WIDTH * 0.12, launch: 0.2, boom: 0.46, color: COLOR_CYAN, accent: COLOR_GOLD_SOFT, rays: 16 },
    { x: WIDTH * 0.83, y: HEIGHT * 0.55, radius: 116, launchX: WIDTH * 0.88, launch: 0.22, boom: 0.5, color: COLOR_GOLD, accent: COLOR_WHITE, rays: 16 },
  ];

  const centerFlash = Math.exp(-(((progress - 0.2) / 0.055) ** 2)) + (Math.exp(-(((progress - 0.38) / 0.075) ** 2)) * 0.74);
  if (centerFlash > 0.01) {
    drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.38, 180 + (centerFlash * 90), COLOR_GOLD_SOFT, visible * centerFlash * 0.05);
    drawShockwave(rgba, WIDTH * 0.5, HEIGHT * 0.38, 118 + (centerFlash * 170), COLOR_GOLD_SOFT, visible * centerFlash * 0.13);
    drawShockwave(rgba, WIDTH * 0.5, HEIGHT * 0.38, 210 + (centerFlash * 220), COLOR_CYAN, visible * centerFlash * 0.05);
  }

  for (const burst of bursts) {
    const beaconAlpha = visible * (1 - fade) * 0.12;
    drawSpark(rgba, burst.launchX, HEIGHT - 30, 6.8, burst.color, beaconAlpha);
    drawCircle(rgba, burst.launchX, HEIGHT - 30, 12, burst.color, beaconAlpha * 0.12);
  }

  for (const burst of bursts) {
    const launch = easeInOutSine(clamp((progress - burst.launch) / Math.max(0.01, burst.boom - burst.launch)));
    const afterBoom = clamp((progress - burst.boom) / 0.38);
    const bloom = easeOutCubic(clamp((progress - burst.boom) / 0.2));
    const linger = 1 - easeInOutSine(clamp((progress - 0.62 - (burst.boom * 0.12)) / 0.22));
    const rocketX = mix(burst.launchX, burst.x, launch);
    const rocketY = mix(HEIGHT + 20, burst.y, launch);
    const rocketAlpha = visible * (1 - bloom) * clamp(launch * 1.4) * (1 - fade);

    if (rocketAlpha > 0.01 && progress < burst.boom + 0.03) {
      drawCapsule(rgba, burst.launchX, HEIGHT - 10, rocketX, rocketY, 4.2, burst.color, rocketAlpha * 0.48);
      drawCapsule(rgba, burst.launchX, HEIGHT - 10, rocketX, rocketY, 1.5, burst.accent, rocketAlpha * 0.76);
      drawSpark(rgba, rocketX, rocketY, 8.2, burst.accent, rocketAlpha * 0.74);
    }

    if (bloom > 0.01) {
      const alpha = visible * bloom * (0.42 + (peak * 0.34) + (pulse * peak * 0.12)) * Math.max(0, linger) * (1 - (fade * 0.86));
      const radius = burst.radius * (0.38 + (bloom * 0.72) + (pulse * peak * 0.08));
      drawBurstRays(rgba, burst.x, burst.y, radius, burst.rays, burst.color, burst.accent, alpha, burst.boom * TAU * 1.7, 0.82);
      drawShockwave(rgba, burst.x, burst.y, radius * (0.38 + (afterBoom * 0.16)), burst.accent, alpha * 0.14);
      drawSpark(rgba, burst.x, burst.y, 11 + (bloom * 10), burst.accent, alpha * 0.28);

      for (let particle = 0; particle < 20; particle += 1) {
        const unit = ((particle * 0.61803398875) + (burst.boom * 2.3)) % 1;
        const angle = (unit * TAU) + (Math.sin(particle + burst.boom) * 0.08);
        const spread = radius * (0.24 + (((particle * 17) % 100) / 100) * 0.78);
        const fall = fade * (48 + ((particle % 7) * 16)) + (afterBoom * 18);
        const x = burst.x + (Math.cos(angle) * spread * bloom);
        const y = burst.y + (Math.sin(angle) * spread * 0.86 * bloom) + fall;
        const size = 2.6 + ((particle % 5) * 0.8);
        const alphaDot = alpha * (0.18 + ((particle % 4) * 0.035)) * (1 - (fade * 0.66));
        drawCircle(rgba, x, y, size * 1.8, burst.color, alphaDot * 0.14);
        drawSpark(rgba, x, y, size, particle % 3 === 0 ? burst.accent : burst.color, alphaDot);
      }
    }
  }

  for (let falling = 0; falling < 56; falling += 1) {
    const birthDelay = (falling % 18) * 0.012;
    const born = easeInOutSine(clamp((progress - 0.42 - birthDelay) / 0.18));
    const drift = easeInOutSine(clamp((progress - 0.66 - birthDelay) / 0.3));
    const x = 34 + ((falling * 61) % (WIDTH - 68)) + (Math.sin((progress * TAU * 0.7) + falling) * 16);
    const y = 80 + ((falling * 47) % 560) + (drift * (130 + ((falling % 8) * 20)));
    const color = falling % 5 === 0 ? COLOR_GOLD_SOFT : falling % 5 === 1 ? COLOR_CYAN : falling % 5 === 2 ? COLOR_PINK : falling % 5 === 3 ? COLOR_PURPLE : COLOR_WHITE;
    const alpha = visible * born * (0.045 + (peak * 0.08)) * (1 - (fade * 0.9));
    if (alpha > 0.006) {
      drawSpark(rgba, x, y, 2.8 + ((falling % 4) * 0.7), color, alpha);
    }
  }

  return rgba;
};

const renderMessengerBingoBallWink = (time, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.54;
  const heroAlpha = beat.heroAlpha;
  const configs = variant === "chaos"
    ? [
      { x: centerX - 154, y: centerY + 22, radius: 58, body: ballPalette[0], startX: -130, startY: centerY - 20 },
      { x: centerX - 46, y: centerY - 54, radius: 52, body: ballPalette[1], startX: centerX - 24, startY: HEIGHT + 110 },
      { x: centerX + 62, y: centerY + 10, radius: 72, body: ballPalette[2], startX: WIDTH + 140, startY: centerY + 30 },
      { x: centerX + 168, y: centerY - 60, radius: 56, body: ballPalette[3], startX: WIDTH + 100, startY: centerY - 120 },
      { x: centerX + 8, y: centerY + 110, radius: 46, body: ballPalette[4], startX: centerX + 24, startY: HEIGHT + 180 },
    ]
    : variant === "parade"
      ? [
        { x: centerX - 172, y: centerY + 44, radius: 48, body: ballPalette[0], startX: centerX - 150, startY: HEIGHT + 120 },
        { x: centerX - 82, y: centerY - 8, radius: 56, body: ballPalette[1], startX: centerX - 80, startY: HEIGHT + 160 },
        { x: centerX + 4, y: centerY - 34, radius: 64, body: ballPalette[2], startX: centerX + 8, startY: HEIGHT + 140 },
        { x: centerX + 108, y: centerY - 4, radius: 54, body: ballPalette[3], startX: centerX + 112, startY: HEIGHT + 160 },
        { x: centerX + 196, y: centerY + 42, radius: 46, body: ballPalette[4], startX: centerX + 192, startY: HEIGHT + 120 },
      ]
      : [
        { x: centerX - 118, y: centerY + 20, radius: 62, body: ballPalette[0], startX: -120, startY: centerY + 44 },
        { x: centerX + 2, y: centerY - 48, radius: 78, body: ballPalette[2], startX: centerX, startY: HEIGHT + 180 },
        { x: centerX + 136, y: centerY + 16, radius: 60, body: ballPalette[3], startX: WIDTH + 120, startY: centerY + 40 },
      ];

  if (variant === "chaos") {
    drawTextBlock(rgba, "BINGO", centerX, centerY - 160, 10, COLOR_GOLD, heroAlpha * 0.22, COLOR_WHITE);
  }

  for (let index = 0; index < configs.length; index += 1) {
    const ball = configs[index];
    const move = easeOutBack(clamp((beat.progress - (index * 0.03)) / 0.36));
    const bounce = Math.sin((beat.holdWindow * Math.PI) + index) * (variant === "turbo" ? 14 : 8);
    const dissolveSpread = beat.dissolve * (variant === "chaos" ? 84 : 46);
    const x = mix(ball.startX, ball.x, move) + ((ball.x - centerX) / 220) * dissolveSpread;
    const y = mix(ball.startY, ball.y, move) + bounce + (beat.dissolve * 28);
    const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.88));
    drawBingoBall(rgba, x, y, ball.radius * (0.96 + (beat.pulse * 0.04)), ball.body.color, ball.body.digit, alpha);
  }

  for (let sparkle = 0; sparkle < 10; sparkle += 1) {
    const angle = -0.9 + ((sparkle / 9) * 1.8);
    const radius = 150 + ((sparkle % 3) * 24);
    drawSpark(rgba, centerX + (Math.cos(angle) * radius), centerY + 18 + (Math.sin(angle) * radius * 0.46), 4.8, sparkle % 2 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, heroAlpha * 0.12);
  }

  return rgba;
};

const renderMessengerBingoCollisionReveal = (time, _seed, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.455;
  const configs = {
    classic: {
      textCell: 12.9,
      ringColor: COLOR_GOLD,
      accent: COLOR_GOLD_SOFT,
      collideStart: 0.1,
      collideDuration: 0.14,
      vanishStart: 0.2,
      textStart: 0.25,
      textDuration: 0.12,
      ringScale: 1,
      path: "cross",
      balls: [
        { sx: 72, sy: 178, ox: -232, oy: -118, r: 36, body: ballPalette[0], delay: 0 },
        { sx: WIDTH - 72, sy: 194, ox: 232, oy: -108, r: 36, body: ballPalette[2], delay: 0.018 },
        { sx: 48, sy: 520, ox: -260, oy: 42, r: 38, body: ballPalette[3], delay: 0.036 },
        { sx: WIDTH - 48, sy: 536, ox: 260, oy: 48, r: 38, body: ballPalette[5], delay: 0.054 },
        { sx: 220, sy: HEIGHT - 74, ox: -128, oy: 156, r: 34, body: ballPalette[4], delay: 0.072 },
        { sx: WIDTH - 220, sy: HEIGHT - 74, ox: 128, oy: 156, r: 34, body: ballPalette[1], delay: 0.09 },
      ],
    },
    jackpot: {
      textCell: 13.8,
      ringColor: COLOR_GOLD,
      accent: COLOR_WHITE,
      collideStart: 0.08,
      collideDuration: 0.15,
      vanishStart: 0.19,
      textStart: 0.245,
      textDuration: 0.115,
      ringScale: 1.14,
      path: "bounce",
      balls: [
        { sx: 82, sy: HEIGHT - 136, ox: -274, oy: 96, r: 46, body: ballPalette[0], delay: 0 },
        { sx: WIDTH - 82, sy: HEIGHT - 144, ox: 274, oy: 94, r: 46, body: ballPalette[5], delay: 0.014 },
        { sx: 102, sy: 150, ox: -246, oy: -100, r: 40, body: ballPalette[2], delay: 0.028 },
        { sx: WIDTH - 102, sy: 150, ox: 246, oy: -100, r: 40, body: ballPalette[3], delay: 0.042 },
        { sx: 282, sy: 74, ox: -78, oy: -174, r: 36, body: ballPalette[4], delay: 0.056 },
        { sx: WIDTH - 282, sy: 74, ox: 78, oy: -174, r: 36, body: ballPalette[1], delay: 0.07 },
        { sx: -42, sy: 386, ox: -300, oy: -6, r: 38, body: ballPalette[3], delay: 0.084 },
        { sx: WIDTH + 42, sy: 404, ox: 300, oy: 4, r: 38, body: ballPalette[0], delay: 0.098 },
      ],
    },
    swirl: {
      textCell: 13,
      ringColor: COLOR_CYAN,
      accent: COLOR_GOLD,
      collideStart: 0.12,
      collideDuration: 0.18,
      vanishStart: 0.24,
      textStart: 0.305,
      textDuration: 0.13,
      ringScale: 1.02,
      path: "swirl",
      balls: [
        { sx: centerX - 300, sy: centerY - 254, ox: -258, oy: -92, r: 36, body: ballPalette[2], delay: 0 },
        { sx: centerX + 300, sy: centerY - 246, ox: 258, oy: -92, r: 36, body: ballPalette[5], delay: 0.014 },
        { sx: centerX - 328, sy: centerY + 44, ox: -284, oy: 34, r: 35, body: ballPalette[0], delay: 0.028 },
        { sx: centerX + 328, sy: centerY + 44, ox: 284, oy: 34, r: 35, body: ballPalette[3], delay: 0.042 },
        { sx: centerX - 204, sy: centerY + 292, ox: -138, oy: 156, r: 33, body: ballPalette[1], delay: 0.056 },
        { sx: centerX + 204, sy: centerY + 292, ox: 138, oy: 156, r: 33, body: ballPalette[4], delay: 0.07 },
        { sx: centerX - 44, sy: centerY - 316, ox: -64, oy: -178, r: 32, body: ballPalette[4], delay: 0.084 },
        { sx: centerX + 44, sy: centerY - 316, ox: 64, oy: -178, r: 32, body: ballPalette[1], delay: 0.098 },
      ],
    },
  };
  const config = configs[variant] ?? configs.classic;
  const ballVanish = easeInOutSine(clamp((progress - config.vanishStart) / 0.07));
  const textReveal = easeInOutSine(clamp((progress - config.textStart) / config.textDuration));
  const hold = easeInOutSine(clamp((progress - 0.43) / 0.14));
  const exit = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const textAlpha = textReveal * (1 - exit);
  const pulse = hold > 0 ? 0.5 + (0.5 * Math.sin(clamp((progress - 0.43) / 0.32) * TAU * 1.7)) : 0;

  for (let index = 0; index < config.balls.length; index += 1) {
    const ball = config.balls[index];
    const birth = clamp((progress + 0.12 - ball.delay) / 0.1);
    const move = easeInOutSine(clamp((progress + 0.035 - ball.delay) / 0.17));
    const collision = easeInOutSine(clamp((progress - config.collideStart - (ball.delay * 0.3)) / config.collideDuration));
    const orbitAngle = Math.atan2(ball.oy, ball.ox || 1) + (progress * TAU * (config.path === "swirl" ? 0.92 : 0.2)) + (index * 0.08);
    const orbitBoost = config.path === "swirl" ? 38 * (1 - collision) : 14 * (1 - collision);
    const stageX = centerX + ball.ox + (Math.cos(orbitAngle) * orbitBoost);
    const stageY = centerY + ball.oy + (Math.sin(orbitAngle) * orbitBoost * 0.78);
    const bounce = config.path === "bounce"
      ? Math.sin(clamp(move) * Math.PI * 2.05) * (1 - clamp(move)) * 42
      : Math.sin((progress * TAU * 0.8) + index) * 5 * (1 - collision);
    const impactOffset = index - ((config.balls.length - 1) * 0.5);
    const impactX = centerX + (impactOffset * 4.8);
    const impactY = centerY + (Math.sin(index * 1.66) * 7);
    const x = mix(mix(ball.sx, stageX, move), impactX, collision);
    const y = mix(mix(ball.sy, stageY, move) + bounce, impactY, collision);
    const alpha = birth * (1 - ballVanish);

    if (alpha <= 0.01) continue;
    if (progress < config.vanishStart + 0.04) {
      drawTrailDots(rgba, ball.sx, ball.sy, x, y, 4, 2.4, COLOR_WHITE, alpha * 0.07);
    }
    drawBingoBall(rgba, x, y, ball.r * (1 - (collision * (1 - ballVanish) * 0.1)), ball.body.color, ball.body.digit, alpha);
  }

  const impact = Math.sin(clamp((progress - config.vanishStart) / 0.11) * Math.PI) * (1 - exit);
  if (impact > 0.01) {
    drawShockwave(rgba, centerX, centerY, (70 + (impact * 170)) * config.ringScale, config.accent, impact * 0.14);
    drawSpark(rgba, centerX, centerY, 22 + (impact * 34), COLOR_GOLD_SOFT, impact * 0.2);
  }

  if (textReveal > 0.01) {
    const textScale = config.textCell + (hold * pulse * 0.34) - (exit * 0.26);
    drawShockwave(rgba, centerX, centerY + 8, (166 + (pulse * 12) + (exit * 60)) * config.ringScale, config.ringColor, textAlpha * 0.055);
    drawTextBlock(rgba, "BINGO!", centerX, centerY + 8, textScale + 0.52, COLOR_GOLD_SOFT, textAlpha * 0.16, config.accent);
    drawTextBlock(rgba, "BINGO!", centerX, centerY + 8, textScale, COLOR_GOLD, textAlpha * 0.98, COLOR_WHITE);
  }

  for (let sparkle = 0; sparkle < 9; sparkle += 1) {
    const show = easeInOutSine(clamp((progress - config.textStart - ((sparkle % 4) * 0.02)) / 0.22));
    const angle = -0.86 + ((sparkle / 8) * 1.72);
    const radius = 148 + ((sparkle % 3) * 26) + (exit * 58);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + 18 + (Math.sin(angle) * radius * 0.46) - (exit * 28);
    drawSpark(rgba, x, y, 3.2 + ((sparkle % 3) * 0.8), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, textAlpha * show * 0.06 * (1 - (exit * 0.75)));
  }

  return rgba;
};

const renderMessengerClassicBingoFormation = (time, _seed, timeline) => {
  return renderMessengerBingoCollisionReveal(time, _seed, timeline, "classic");

  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.445;
  const appear = clamp((progress + 0.04) / 0.12);
  const formation = easeInOutSine(clamp(progress / 0.375));
  const textReveal = easeInOutSine(clamp((progress - 0.18) / 0.2));
  const hold = easeInOutSine(clamp((progress - 0.375) / 0.1875));
  const exit = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - exit);
  const glowPulse = 0.5 + (0.5 * Math.sin((progress * TAU * 0.9) + 0.2));
  const textAlpha = visible * textReveal * (1 - (exit * 0.72));
  const ballConfigs = [
    { x: -204, y: -126, sx: 28, sy: 96, r: 34, body: ballPalette[0], delay: 0 },
    { x: -126, y: -174, sx: WIDTH - 52 - centerX, sy: 128, r: 32, body: ballPalette[1], delay: 0.018 },
    { x: -38, y: -198, sx: -88, sy: HEIGHT - 130 - centerY, r: 35, body: ballPalette[2], delay: 0.036 },
    { x: 54, y: -194, sx: 92, sy: HEIGHT - 160 - centerY, r: 34, body: ballPalette[3], delay: 0.054 },
    { x: 142, y: -164, sx: 52 - centerX, sy: 234, r: 33, body: ballPalette[4], delay: 0.072 },
    { x: 212, y: -102, sx: WIDTH - 30 - centerX, sy: 322, r: 34, body: ballPalette[5], delay: 0.09 },
    { x: -210, y: 108, sx: 34, sy: 644 - centerY, r: 32, body: ballPalette[3], delay: 0.108 },
    { x: -112, y: 164, sx: WIDTH - 58 - centerX, sy: 716 - centerY, r: 31, body: ballPalette[2], delay: 0.126 },
    { x: 112, y: 164, sx: 66 - centerX, sy: 764 - centerY, r: 31, body: ballPalette[0], delay: 0.144 },
    { x: 214, y: 108, sx: WIDTH - 38 - centerX, sy: 672 - centerY, r: 32, body: ballPalette[4], delay: 0.162 },
  ];

  if (textAlpha > 0.01) {
    drawShockwave(rgba, centerX, centerY + 2, 176 + (glowPulse * 9), COLOR_GOLD, textAlpha * 0.07);
    drawTextBlock(
      rgba,
      "BINGO!",
      centerX,
      centerY,
      12.8 + (hold * glowPulse * 0.32),
      COLOR_GOLD,
      textAlpha * 0.96,
      COLOR_WHITE,
    );
    drawTextBlock(
      rgba,
      "BINGO!",
      centerX,
      centerY,
      12.8 + (hold * glowPulse * 0.32),
      hexToRgb("#fff1b8"),
      textAlpha * 0.22,
      COLOR_GOLD_SOFT,
    );
  }

  for (let index = 0; index < ballConfigs.length; index += 1) {
    const ball = ballConfigs[index];
    const move = easeInOutSine(clamp((progress - ball.delay) / 0.38));
    const birth = clamp((progress + 0.05 - ball.delay) / 0.12);
    const drift = Math.sin((progress * TAU * 0.42) + index) * 4.5 * (formation + hold) * (1 - exit);
    const targetX = centerX + ball.x;
    const targetY = centerY + ball.y;
    const startX = centerX + ball.sx;
    const startY = centerY + ball.sy;
    const exitSpread = exit * (74 + ((index % 3) * 18));
    const angle = Math.atan2(ball.y, ball.x);
    const x = mix(startX, targetX, move) + (Math.cos(angle) * exitSpread);
    const y = mix(startY, targetY, move) + drift + (Math.sin(angle) * exitSpread * 0.72);
    const alpha = visible * birth * (0.3 + (move * 0.7)) * (1 - (exit * 0.72));

    if (alpha <= 0.01) continue;
    if (move > 0.04 && progress < 0.68) {
      drawTrailDots(rgba, startX, startY, x, y, 4, 2.4, COLOR_WHITE, alpha * 0.08);
    }
    drawBingoBall(rgba, x, y, ball.r * (0.98 + (hold * glowPulse * 0.04)), ball.body.color, ball.body.digit, alpha);
  }

  for (let sparkle = 0; sparkle < 14; sparkle += 1) {
    const delay = 0.26 + ((sparkle % 5) * 0.02);
    const show = easeInOutSine(clamp((progress - delay) / 0.28));
    const angle = -0.96 + ((sparkle / 13) * 1.92);
    const radius = 150 + ((sparkle % 4) * 22) + (exit * 92);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + 14 + (Math.sin(angle) * radius * 0.5) - (exit * 46);
    const alpha = visible * show * (0.035 + (hold * 0.08) + (exit * 0.06)) * (1 - (exit * 0.62));
    drawSpark(rgba, x, y, 3.6 + ((sparkle % 3) * 1.1), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  return rgba;
};

const renderMessengerJackpotBallPop = (time, _seed, timeline) => {
  return renderMessengerBingoCollisionReveal(time, _seed, timeline, "jackpot");

  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.455;
  const appear = clamp((progress + 0.045) / 0.16);
  const textReveal = easeInOutSine(clamp((progress - 0.2) / 0.18));
  const hold = easeInOutSine(clamp((progress - 0.375) / 0.1875));
  const exit = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - exit);
  const holdProgress = clamp((progress - 0.375) / 0.375);
  const pulse = hold > 0 ? Math.max(0, Math.sin(holdProgress * TAU * 2)) : 0;
  const textAlpha = visible * textReveal * (1 - (exit * 0.82));
  const jackpotGlow = textAlpha * (0.11 + (hold * 0.05) + (pulse * 0.04));
  const ballConfigs = [
    { x: -284, y: 24, sx: 34 - centerX, sy: 318 - centerY, r: 43, body: ballPalette[0], delay: 0 },
    { x: -166, y: -92, sx: 96 - centerX, sy: 106 - centerY, r: 36, body: ballPalette[2], delay: 0.024 },
    { x: -58, y: -138, sx: 252 - centerX, sy: HEIGHT + 70 - centerY, r: 34, body: ballPalette[4], delay: 0.048 },
    { x: 58, y: -138, sx: 516 - centerX, sy: HEIGHT + 72 - centerY, r: 34, body: ballPalette[1], delay: 0.072 },
    { x: 166, y: -92, sx: WIDTH - 96 - centerX, sy: 108 - centerY, r: 36, body: ballPalette[3], delay: 0.096 },
    { x: 284, y: 24, sx: WIDTH - 34 - centerX, sy: 322 - centerY, r: 43, body: ballPalette[5], delay: 0.12 },
    { x: -92, y: 128, sx: 188 - centerX, sy: HEIGHT - 52 - centerY, r: 40, body: ballPalette[3], delay: 0.144 },
    { x: 92, y: 128, sx: 580 - centerX, sy: HEIGHT - 58 - centerY, r: 40, body: ballPalette[0], delay: 0.168 },
  ];

  if (jackpotGlow > 0.002) {
    drawShockwave(rgba, centerX, centerY + 10, 150 + (hold * 12) + (pulse * 18) + (exit * 56), COLOR_GOLD, jackpotGlow);
    drawShockwave(rgba, centerX, centerY + 10, 228 + (pulse * 18) + (exit * 96), COLOR_GOLD_SOFT, jackpotGlow * 0.42);
  }

  if (textAlpha > 0.01) {
    const textScale = 13.4 + (hold * 0.22) + (pulse * 0.42) - (exit * 0.35);
    drawTextBlock(rgba, "BINGO!", centerX, centerY + 4, textScale + 0.62, COLOR_GOLD_SOFT, textAlpha * 0.2, COLOR_GOLD);
    drawTextBlock(rgba, "BINGO!", centerX, centerY + 4, textScale, COLOR_GOLD, textAlpha * 0.98, COLOR_WHITE);
  }

  for (let index = 0; index < ballConfigs.length; index += 1) {
    const ball = ballConfigs[index];
    const move = easeOutBack(clamp((progress - ball.delay) / 0.375));
    const birth = clamp((progress + 0.055 - ball.delay) / 0.14);
    const targetX = centerX + ball.x;
    const targetY = centerY + ball.y;
    const startX = centerX + ball.sx;
    const startY = centerY + ball.sy;
    const angle = Math.atan2(ball.y, ball.x || 1);
    const popSpread = exit * (108 + ((index % 4) * 22));
    const settleBounce = Math.sin(clamp(move) * Math.PI * 2.15) * (1 - clamp(move)) * 18;
    const holdFloat = Math.sin((holdProgress * TAU * 1.2) + index) * 4.8 * hold * (1 - exit);
    const x = mix(startX, targetX, move) + (Math.cos(angle) * popSpread);
    const y = mix(startY, targetY, move) + settleBounce + holdFloat + (Math.sin(angle) * popSpread * 0.7);
    const alpha = visible * birth * (0.28 + (clamp(move) * 0.72)) * (1 - (exit * 0.78));

    if (alpha <= 0.01) continue;
    if (move > 0.04 && progress < 0.39) {
      drawTrailDots(rgba, startX, startY, x, y, 4, 2.8, COLOR_WHITE, alpha * 0.08);
    }
    drawBingoBall(rgba, x, y, ball.r * (0.98 + (pulse * 0.035) + (exit * 0.035)), ball.body.color, ball.body.digit, alpha);
  }

  for (let sparkle = 0; sparkle < 14; sparkle += 1) {
    const delay = 0.3 + ((sparkle % 5) * 0.026);
    const show = easeInOutSine(clamp((progress - delay) / 0.22));
    const angle = -1.05 + ((sparkle / 13) * 2.1);
    const radius = 158 + ((sparkle % 4) * 28) + (exit * 78);
    const x = centerX + (Math.cos(angle) * radius);
    const y = centerY + 8 + (Math.sin(angle) * radius * 0.5) - (exit * 34);
    const alpha = visible * show * (0.045 + (hold * 0.055) + (pulse * 0.025)) * (1 - (exit * 0.7));
    drawSpark(rgba, x, y, 3.4 + ((sparkle % 3) * 1.1), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  return rgba;
};

const renderMessengerBingoBallSwirl = (time, _seed, timeline) => {
  return renderMessengerBingoCollisionReveal(time, _seed, timeline, "swirl");

  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.46;
  const appear = clamp((progress + 0.055) / 0.18);
  const spiralIn = easeInOutSine(clamp(progress / 0.375));
  const textReveal = easeInOutSine(clamp((progress - 0.22) / 0.155));
  const hold = easeInOutSine(clamp((progress - 0.375) / 0.1875));
  const exit = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - exit);
  const holdProgress = clamp((progress - 0.375) / 0.375);
  const pulse = hold > 0 ? 0.5 + (0.5 * Math.sin(holdProgress * TAU * 1.55)) : 0;
  const textAlpha = visible * textReveal * (1 - (exit * 0.82));
  const ballTargets = [
    { x: -316, y: -18, r: 38, body: ballPalette[2], delay: 0 },
    { x: -204, y: -124, r: 33, body: ballPalette[0], delay: 0.018 },
    { x: -102, y: -174, r: 31, body: ballPalette[4], delay: 0.036 },
    { x: 22, y: -184, r: 32, body: ballPalette[1], delay: 0.054 },
    { x: 148, y: -150, r: 34, body: ballPalette[3], delay: 0.072 },
    { x: 316, y: -48, r: 38, body: ballPalette[5], delay: 0.09 },
    { x: 284, y: 92, r: 34, body: ballPalette[0], delay: 0.108 },
    { x: 92, y: 168, r: 32, body: ballPalette[2], delay: 0.126 },
    { x: -72, y: 170, r: 32, body: ballPalette[3], delay: 0.144 },
    { x: -284, y: 92, r: 34, body: ballPalette[1], delay: 0.162 },
  ];

  if (textAlpha > 0.006) {
    drawShockwave(rgba, centerX, centerY + 4, 164 + (pulse * 12) + (exit * 52), COLOR_GOLD, textAlpha * 0.075);
    drawShockwave(rgba, centerX, centerY + 4, 232 + (pulse * 10) + (exit * 78), COLOR_CYAN, textAlpha * 0.026);
  }

  for (let index = 0; index < ballTargets.length; index += 1) {
    const ball = ballTargets[index];
    const move = easeInOutSine(clamp((progress - ball.delay) / 0.375));
    const birth = clamp((progress + 0.065 - ball.delay) / 0.15);
    const swirlAngle = ((index / ballTargets.length) * TAU) + (progress * TAU * 1.08) + (index % 2 === 0 ? 0.34 : -0.22);
    const startRadiusX = 292 - (move * 58);
    const startRadiusY = 324 - (move * 96);
    const startX = centerX + (Math.cos(swirlAngle) * startRadiusX);
    const startY = centerY + (Math.sin(swirlAngle) * startRadiusY);
    const targetX = centerX + ball.x;
    const targetY = centerY + ball.y;
    const drift = Math.sin((holdProgress * TAU * 0.9) + index) * 4.2 * hold * (1 - exit);
    const outAngle = Math.atan2(ball.y, ball.x || 1);
    const driftOut = exit * (88 + ((index % 4) * 18));
    const x = mix(startX, targetX, move) + (Math.cos(outAngle) * driftOut);
    const y = mix(startY, targetY, move) + drift + (Math.sin(outAngle) * driftOut * 0.78);
    const alpha = visible * birth * (0.24 + (move * 0.76)) * (1 - (exit * 0.8));

    if (alpha <= 0.01) continue;
    if (progress < 0.42 && move > 0.04) {
      const prevAngle = swirlAngle - 0.2;
      const trailX = centerX + (Math.cos(prevAngle) * (startRadiusX + 14));
      const trailY = centerY + (Math.sin(prevAngle) * (startRadiusY + 14));
      drawTrailDots(rgba, trailX, trailY, x, y, 4, 2.35, COLOR_WHITE, alpha * 0.07);
    }
    drawBingoBall(rgba, x, y, ball.r * (0.98 + (pulse * 0.035)), ball.body.color, ball.body.digit, alpha);
  }

  if (textAlpha > 0.01) {
    const textScale = 12.9 + (hold * pulse * 0.42) - (exit * 0.28);
    drawTextBlock(rgba, "BINGO!", centerX, centerY + 8, textScale + 0.54, COLOR_GOLD_SOFT, textAlpha * 0.18, COLOR_GOLD);
    drawTextBlock(rgba, "BINGO!", centerX, centerY + 8, textScale, COLOR_GOLD, textAlpha * 0.96, COLOR_WHITE);
  }

  for (let sparkle = 0; sparkle < 12; sparkle += 1) {
    const delay = 0.28 + ((sparkle % 4) * 0.026);
    const show = easeInOutSine(clamp((progress - delay) / 0.28));
    const angle = ((sparkle / 12) * TAU) + 0.2;
    const radiusX = 180 + ((sparkle % 3) * 24) + (exit * 70);
    const radiusY = 112 + ((sparkle % 2) * 20) + (exit * 42);
    const x = centerX + (Math.cos(angle) * radiusX);
    const y = centerY + 10 + (Math.sin(angle) * radiusY) - (exit * 30);
    const alpha = visible * show * (0.032 + (hold * 0.052) + (pulse * 0.018)) * (1 - (exit * 0.68));
    drawSpark(rgba, x, y, 3.2 + ((sparkle % 3) * 0.9), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  return rgba;
};

const renderMessengerLuckyWink = (time, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.5;
  const heroAlpha = beat.heroAlpha;

  if (variant === "jackpot") {
    for (let coin = 0; coin < 7; coin += 1) {
      const move = easeOutCubic(clamp((beat.progress - (coin * 0.025)) / 0.4));
      const angle = -0.92 + ((coin / 6) * 1.84);
      const targetX = centerX + (Math.cos(angle) * (92 + ((coin % 2) * 34)));
      const targetY = centerY + (Math.sin(angle) * 84);
      const x = mix(centerX, targetX, move) + (Math.cos(angle) * beat.dissolve * 42);
      const y = mix(HEIGHT - 96, targetY, move) - (beat.dissolve * 14);
      drawCoin(rgba, x, y, 20 + ((coin % 3) * 5), heroAlpha * move * (1 - (beat.dissolve * 0.86)), angle);
    }
    drawSpark(rgba, centerX, centerY + 18, 24 + (beat.pulse * 8), COLOR_GOLD_SOFT, heroAlpha * 0.18);
  } else if (variant === "clover") {
    const clovers = [
      { x: centerX - 84, y: centerY - 10, size: 78, startX: centerX - 120, startY: -80 },
      { x: centerX + 84, y: centerY - 10, size: 78, startX: centerX + 120, startY: -80 },
      { x: centerX - 58, y: centerY + 98, size: 74, startX: centerX - 60, startY: HEIGHT + 80 },
      { x: centerX + 58, y: centerY + 98, size: 74, startX: centerX + 60, startY: HEIGHT + 80 },
      { x: centerX + 12, y: centerY + 162, size: 58, startX: centerX + 12, startY: HEIGHT + 160 },
    ];

    clovers.forEach((clover, index) => {
      const move = easeInOutSine(clamp((beat.progress - (index * 0.025)) / 0.44));
      const x = mix(clover.startX, clover.x, move) + ((clover.x - centerX) / 90) * beat.dissolve * 28;
      const y = mix(clover.startY, clover.y, move) + (beat.dissolve * 12);
      drawLuckyClover(rgba, x, y, clover.size * (0.96 + (beat.pulse * 0.04)), COLOR_GREEN, move * heroAlpha * (1 - (beat.dissolve * 0.88)));
    });
  } else {
    for (let sparkle = 0; sparkle < 20; sparkle += 1) {
      const move = easeInOutSine(clamp((beat.progress - (sparkle * 0.01)) / 0.4));
      const x = 120 + ((sparkle % 5) * 126) + Math.sin(sparkle * 0.7) * 20;
      const targetY = centerY - 110 + (Math.floor(sparkle / 5) * 74);
      const y = mix(HEIGHT + 80, targetY, move) + (beat.dissolve * 48);
      const alpha = move * heroAlpha * (1 - (beat.dissolve * 0.9));
      drawSpark(rgba, x, y, 5 + ((sparkle % 3) * 1.4), sparkle % 4 === 0 ? COLOR_GOLD_SOFT : sparkle % 2 === 0 ? COLOR_CYAN : COLOR_WHITE, alpha * 0.9);
    }
    drawSpark(rgba, centerX, centerY + 28, 26 + (beat.pulse * 10), COLOR_GOLD_SOFT, heroAlpha * 0.18);
  }

  return rgba;
};

const renderMessengerThumbsWink = (time, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.56;
  const heroAlpha = beat.heroAlpha;

  if (variant === "double") {
    const leftMove = easeOutBack(clamp(beat.progress / 0.34));
    const rightMove = easeOutBack(clamp((beat.progress - 0.04) / 0.34));
    drawThumbsUp(rgba, mix(-140, centerX - 104, leftMove), centerY + (Math.sin(beat.holdWindow * Math.PI) * 8), 164, {
      hand: hexToRgb("#fff4dd"),
      cuff: COLOR_CYAN,
      glow: COLOR_PURPLE,
      outline: COLOR_WHITE,
    }, heroAlpha * (1 - (beat.dissolve * 0.88)), -0.14);
    drawThumbsUp(rgba, mix(WIDTH + 140, centerX + 108, rightMove), centerY - 20 + (Math.sin(beat.holdWindow * Math.PI + 1) * 8), 156, {
      hand: hexToRgb("#f4edff"),
      cuff: COLOR_PINK,
      glow: COLOR_CYAN,
      outline: COLOR_WHITE,
    }, heroAlpha * (1 - (beat.dissolve * 0.88)), 0.14, true);
  } else {
    const move = easeOutBack(clamp(beat.progress / 0.38));
    drawThumbsUp(rgba, centerX, mix(HEIGHT + 180, centerY, move), 212 * (0.98 + (beat.pulse * 0.04)), {
      hand: hexToRgb("#fff4dd"),
      cuff: COLOR_CYAN,
      glow: COLOR_PURPLE,
      outline: COLOR_WHITE,
    }, heroAlpha * (1 - (beat.dissolve * 0.88)), -0.08);
  }

  for (let sparkle = 0; sparkle < 8; sparkle += 1) {
    const angle = -1 + ((sparkle / 7) * 2);
    const radius = 132 + ((sparkle % 2) * 24);
    drawSpark(rgba, centerX + (Math.cos(angle) * radius), centerY + (Math.sin(angle) * radius * 0.48), 4.4, sparkle % 2 === 0 ? COLOR_CYAN : COLOR_WHITE, heroAlpha * 0.1);
  }

  return rgba;
};

const renderMessengerBirthdayWink = (time, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.56;
  const heroAlpha = beat.heroAlpha;

  if (variant === "cake") {
    const move = easeOutBack(clamp(beat.progress / 0.4));
    const candleProgress = clamp((beat.progress - 0.18) / 0.24);
    drawBirthdayCake(rgba, centerX, mix(HEIGHT + 180, centerY, move), 250 * (0.98 + (beat.pulse * 0.04)), {
      glow: COLOR_PINK,
      plate: hexToRgb("#ffe8fb"),
      base: COLOR_PINK,
      top: hexToRgb("#ff9fd8"),
      icing: hexToRgb("#fff3d9"),
      icingAccent: COLOR_GOLD_SOFT,
      dot: COLOR_CYAN,
      candleA: COLOR_CYAN,
      candleB: COLOR_GOLD,
      flameGlow: COLOR_GOLD,
    }, heroAlpha * (1 - (beat.dissolve * 0.88)), candleProgress);

    for (let piece = 0; piece < 12; piece += 1) {
      const movePiece = easeInOutSine(clamp((beat.progress - 0.2 - (piece * 0.01)) / 0.32));
      const angle = -1.1 + ((piece / 11) * 2.2);
      const x = centerX + (Math.cos(angle) * (92 + ((piece % 3) * 24)));
      const y = centerY - 80 + (Math.sin(angle) * 74) + (beat.dissolve * 42);
      drawConfettiSprite(rgba, x, y, 10 + ((piece % 2) * 2), 6 + ((piece % 3) * 1.4), angle, piece % 3 === 0 ? "diamond" : "rect", piece % 2 === 0 ? COLOR_GOLD : COLOR_CYAN, movePiece * heroAlpha * 0.36);
    }
  } else {
    const balloons = [
      { x: centerX - 180, y: centerY + 34, size: 108, color: COLOR_CYAN, delay: 0 },
      { x: centerX - 74, y: centerY - 14, size: 132, color: COLOR_PINK, delay: 0.03 },
      { x: centerX + 12, y: centerY - 48, size: 156, color: COLOR_GOLD, delay: 0.06 },
      { x: centerX + 116, y: centerY - 6, size: 128, color: COLOR_PURPLE, delay: 0.09 },
      { x: centerX + 212, y: centerY + 36, size: 104, color: COLOR_HOT, delay: 0.12 },
    ];

    balloons.forEach((balloon, index) => {
      const move = easeOutBack(clamp((beat.progress - balloon.delay) / 0.36));
      const x = balloon.x + (Math.sin((beat.holdWindow * Math.PI * 1.2) + index) * 8);
      const y = mix(HEIGHT + 180, balloon.y, move) - (beat.dissolve * 82);
      drawBalloon(rgba, x, y, balloon.size * (0.98 + (beat.pulse * 0.04)), balloon.color, move * heroAlpha * (1 - (beat.dissolve * 0.9)));
    });

    drawTextBlock(rgba, "HBD", centerX, centerY - 166, 10, COLOR_GOLD, heroAlpha * 0.18, COLOR_WHITE);
  }

  return rgba;
};

const renderMessengerHeartsLoveExplosion = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.455;
  const formationProgress = easeOutCubic(clamp(progress / 0.5));
  const holdProgress = clamp((progress - 0.5) / 0.25);
  const explodeProgress = easeOutCubic(clamp((progress - 0.75) / 0.25));
  const fade = 1 - easeInOutSine(clamp((progress - 0.82) / 0.18));
  const pulseWindow = clamp((progress - 0.5) / 0.25) * (1 - explodeProgress);
  const pulse = pulseWindow * (0.55 + (0.45 * Math.sin((holdProgress * Math.PI * 4) - (Math.PI * 0.5))));
  const heroGlow = clamp(formationProgress * (1 - (explodeProgress * 0.96)));
  const palette = [
    hexToRgb("#ff4a6d"),
    hexToRgb("#ff6ec7"),
    hexToRgb("#ff9fd8"),
    hexToRgb("#f3b08f"),
    hexToRgb("#ffe0d0"),
  ];

  if (heroGlow > 0.02) {
    const glowScale = 1 + (pulse * 0.14);
    drawHeartFill(rgba, centerX, centerY + 14, 290 * glowScale, hexToRgb("#ff63c7"), heroGlow * 0.035 * fade);
    drawHeartFill(rgba, centerX, centerY + 14, 226 * glowScale, hexToRgb("#ffffff"), heroGlow * 0.012 * fade);
  }

  const totalHearts = 82;
  for (let index = 0; index < totalHearts; index += 1) {
    const isFill = index >= 52;
    const localIndex = isFill ? index - 52 : index;
    const count = isFill ? 30 : 52;
    const param = (localIndex / count) * TAU + (isFill ? 0.16 : 0);
    const scale = isFill
      ? 7.2 + ((localIndex % 5) * 1.35)
      : 16.9 + ((localIndex % 4) * 0.42);
    const target = getHeartCurvePoint(param, scale);
    const fillPull = isFill ? 0.56 + ((localIndex % 3) * 0.11) : 1;
    const targetX = centerX + (target.x * fillPull);
    const targetY = centerY + (target.y * fillPull);
    const side = index % 4;
    const startX = side === 0 ? 26 + ((index % 5) * 9)
      : side === 1 ? WIDTH - 26 - ((index % 5) * 9)
        : 78 + ((index * 53) % (WIDTH - 156));
    const startY = side === 2 ? 28 + ((index % 6) * 11)
      : side === 3 ? HEIGHT - 28 - ((index % 6) * 11)
        : 86 + ((index * 71) % (HEIGHT - 172));
    const delay = (index % 18) * 0.006;
    const gather = easeOutBack(clamp((progress - delay) / 0.5));
    const float = Math.sin((progress * TAU * 1.35) + (index * 0.8)) * (1 - Math.min(gather, 1)) * 18;
    const settleBounce = Math.sin(clamp((progress - 0.34) / 0.16) * Math.PI) * (1 - explodeProgress) * 9;
    const explosionAngle = Math.atan2(targetY - centerY, targetX - centerX) + (Math.sin(index * 1.7) * 0.42);
    const explosionDistance = explodeProgress * (180 + ((index % 9) * 34));
    const x = mix(startX, targetX, gather) + float + (Math.cos(explosionAngle) * explosionDistance);
    const y = mix(startY, targetY, gather) - settleBounce + (Math.sin(explosionAngle) * explosionDistance);
    const birth = clamp((progress + 0.035) / 0.12);
    const alpha = birth * (1 - (explodeProgress * 0.38)) * fade * (0.74 + (isFill ? 0.1 : 0.22));
    const pulseScale = 1 + (pulse * (isFill ? 0.13 : 0.09));
    const size = (isFill ? 13.2 + ((index % 4) * 2.1) : 15.6 + ((index % 5) * 2.2)) * pulseScale;
    const color = palette[index % palette.length];

    if (alpha > 0.01) {
      const previousGather = easeOutBack(clamp((progress - 0.018 - delay) / 0.5));
      const previousX = mix(startX, targetX, previousGather);
      const previousY = mix(startY, targetY, previousGather);
      if (progress < 0.54 && gather > 0.08) {
        drawTrailDots(rgba, previousX, previousY, x, y, 4, 2.2, hexToRgb("#ffe5f1"), alpha * 0.12);
      }
      drawHeartFill(rgba, x, y, size * 1.28, hexToRgb("#ff95dd"), alpha * 0.075);
      drawGlossyHeart(rgba, x, y, size, color, alpha);
    }
  }

  for (let sparkle = 0; sparkle < 26; sparkle += 1) {
    const param = (sparkle / 26) * TAU;
    const target = getHeartCurvePoint(param, 18.2 + ((sparkle % 3) * 0.6));
    const formation = easeInOutSine(clamp((progress - 0.22 - ((sparkle % 6) * 0.012)) / 0.35));
    const burst = easeOutCubic(clamp((progress - 0.75) / 0.25));
    const x = centerX + (target.x * formation) + (Math.cos(param) * burst * (160 + ((sparkle % 5) * 22)));
    const y = centerY + (target.y * formation) + (Math.sin(param) * burst * (130 + ((sparkle % 4) * 18)));
    const alpha = formation * (0.14 + (pulse * 0.28) + (burst * 0.24)) * fade;
    drawSpark(rgba, x, y, 4.2 + ((sparkle % 3) * 1.2), sparkle % 3 === 0 ? hexToRgb("#fff4c8") : hexToRgb("#ffffff"), alpha);
  }

  if (pulse > 0.02) {
    drawSpark(rgba, centerX - 76, centerY - 114, 8.6, hexToRgb("#ffffff"), pulse * 0.34 * fade);
    drawSpark(rgba, centerX + 98, centerY - 70, 7.2, hexToRgb("#fff4c8"), pulse * 0.28 * fade);
    drawSpark(rgba, centerX + 12, centerY + 140, 6.6, hexToRgb("#ffffff"), pulse * 0.26 * fade);
  }

  return rgba;
};

const renderMessengerBirthdayCakeFormation = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.55;
  const heroAlpha = beat.heroAlpha;
  const cakeWidth = 258 * (0.98 + (beat.pulse * 0.035));
  const polish = easeInOutSine(clamp((beat.progress - 0.32) / 0.16));
  const candleProgress = clamp((beat.progress - 0.36) / 0.2);
  const dissolve = beat.dissolve;
  const cakePalette = {
    glow: COLOR_PINK,
    plate: hexToRgb("#ffe8fb"),
    base: COLOR_PINK,
    top: hexToRgb("#ff9fd8"),
    icing: hexToRgb("#fff3d9"),
    icingAccent: COLOR_GOLD_SOFT,
    dot: COLOR_CYAN,
    candleA: COLOR_CYAN,
    candleB: COLOR_GOLD,
    flameGlow: COLOR_GOLD,
    glowAlphaMultiplier: 0.18,
  };

  const pieceAlpha = heroAlpha * (1 - (polish * 0.28)) * (1 - (dissolve * 0.88));
  const topWidth = cakeWidth * 0.68;
  const plateY = centerY + (cakeWidth * 0.3);
  const bottomY = centerY + (cakeWidth * 0.08);
  const topY = centerY - (cakeWidth * 0.12);

  drawCircle(rgba, centerX, centerY + (cakeWidth * 0.04), cakeWidth * 0.86, cakePalette.glow, heroAlpha * 0.012 * (1 - dissolve));

  const plateMove = easeInOutSine(clamp((beat.progress - 0.02) / 0.3));
  const plateCurrentY = mix(HEIGHT + 80, plateY, plateMove) + (dissolve * 72);
  drawCapsule(rgba, centerX - (cakeWidth * 0.6), plateCurrentY, centerX + (cakeWidth * 0.6), plateCurrentY, cakeWidth * 0.08, cakePalette.plate, pieceAlpha * plateMove * 0.92);
  drawCapsule(rgba, centerX - (cakeWidth * 0.5), plateCurrentY - (cakeWidth * 0.03), centerX + (cakeWidth * 0.5), plateCurrentY - (cakeWidth * 0.03), cakeWidth * 0.03, COLOR_WHITE, pieceAlpha * plateMove * 0.2);

  const bottomMove = easeInOutSine(clamp((beat.progress - 0.08) / 0.34));
  const bottomX = mix(-180, centerX, bottomMove) - (dissolve * 42);
  drawRotatedRect(rgba, bottomX, bottomY + (Math.sin(bottomMove * Math.PI) * -18) + (dissolve * 48), cakeWidth * 0.96, cakeWidth * 0.34, 0, cakePalette.base, pieceAlpha * bottomMove * 0.98, 1.8);
  drawRotatedRect(rgba, bottomX, bottomY + (cakeWidth * 0.1) + (dissolve * 48), cakeWidth * 0.74, cakeWidth * 0.06, 0, cakePalette.icingAccent, pieceAlpha * bottomMove * 0.24, 1.1);

  const topMove = easeInOutSine(clamp((beat.progress - 0.16) / 0.34));
  const topX = mix(WIDTH + 180, centerX, topMove) + (dissolve * 42);
  drawRotatedRect(rgba, topX, topY + (Math.sin(topMove * Math.PI) * -22) + (dissolve * 28), topWidth, cakeWidth * 0.22, 0, cakePalette.top, pieceAlpha * topMove * 0.98, 1.8);
  drawRotatedRect(rgba, topX, topY + (cakeWidth * 0.02) + (dissolve * 28), topWidth * 0.64, cakeWidth * 0.05, 0, COLOR_WHITE, pieceAlpha * topMove * 0.16, 1.1);

  const icingMove = easeInOutSine(clamp((beat.progress - 0.22) / 0.32));
  for (const offset of [-0.36, -0.18, 0, 0.18, 0.36]) {
    const x = centerX + (offset * topWidth);
    const y = mix(-80, centerY - (cakeWidth * 0.01), icingMove) + (dissolve * 36);
    drawCircle(rgba, x, y, cakeWidth * 0.082, cakePalette.icing, pieceAlpha * icingMove * 0.94);
    drawCapsule(rgba, x, y + (cakeWidth * 0.03), x, y + (cakeWidth * 0.12), cakeWidth * 0.03, cakePalette.icing, pieceAlpha * icingMove * 0.76);
  }

  const candleOffsets = [-0.24, -0.12, 0, 0.12, 0.24];
  for (let candle = 0; candle < candleOffsets.length; candle += 1) {
    const move = easeInOutSine(clamp((beat.progress - 0.28 - (candle * 0.012)) / 0.24));
    const candleX = centerX + (candleOffsets[candle] * topWidth);
    const candleY = mix(-70 - (candle * 16), centerY - (cakeWidth * 0.26), move) - (dissolve * 34);
    const candleColor = candle % 2 === 0 ? cakePalette.candleA : cakePalette.candleB;
    const lit = clamp((candleProgress - (candle * 0.14)) / 0.22);

    drawRotatedRect(rgba, candleX, candleY, cakeWidth * 0.052, cakeWidth * 0.22, 0, candleColor, pieceAlpha * move * 0.94, 1.1);
    drawRotatedRect(rgba, candleX, candleY, cakeWidth * 0.016, cakeWidth * 0.2, 0, COLOR_WHITE, pieceAlpha * move * 0.24, 0.9);
    if (lit > 0) {
      drawCircle(rgba, candleX, candleY - (cakeWidth * 0.15), cakeWidth * 0.14, cakePalette.flameGlow, heroAlpha * lit * (1 - dissolve) * 0.08);
      drawFlame(rgba, candleX, candleY - (cakeWidth * 0.13), cakeWidth * 0.11, heroAlpha * lit * (1 - dissolve));
    }
  }

  if (polish > 0.01) {
    drawBirthdayCake(rgba, centerX, centerY + (dissolve * 26), cakeWidth, cakePalette, heroAlpha * polish * (1 - (dissolve * 0.9)), candleProgress);
  }

  for (let piece = 0; piece < 14; piece += 1) {
    const appear = easeInOutSine(clamp((beat.progress - 0.06 - (piece * 0.01)) / 0.46));
    const angle = -1.12 + ((piece / 13) * 2.24);
    const radius = 96 + ((piece % 3) * 24);
    const x = mix(centerX + (Math.sin(piece * 1.4) * 190), centerX + (Math.cos(angle) * radius), appear) + (Math.cos(angle) * dissolve * 70);
    const y = mix(-80 - ((piece % 5) * 28), centerY - 102 + (Math.sin(angle) * 76), appear) + (dissolve * 98);
    const alpha = appear * heroAlpha * 0.34 * (1 - (dissolve * 0.9));
    drawConfettiSprite(rgba, x, y, 9 + ((piece % 2) * 2), 6 + ((piece % 3) * 1.2), angle, piece % 3 === 0 ? "diamond" : "rect", piece % 4 === 0 ? COLOR_GOLD : piece % 3 === 0 ? COLOR_CYAN : COLOR_PINK, alpha);
  }

  for (let sparkle = 0; sparkle < 8; sparkle += 1) {
    const angle = -0.92 + ((sparkle / 7) * 1.84);
    const radius = 140 + ((sparkle % 2) * 24);
    drawSpark(rgba, centerX + (Math.cos(angle) * radius), centerY - 22 + (Math.sin(angle) * radius * 0.58), 3.8 + ((sparkle % 2) * 1), sparkle % 2 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, heroAlpha * (0.04 + (beat.holdWindow * 0.04)) * (1 - dissolve));
  }

  return rgba;
};

const renderMessengerBirthdayBalloonCelebration = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.475;
  const formation = easeInOutSine(clamp(progress / 0.375));
  const hold = easeInOutSine(clamp((progress - 0.375) / 0.1875));
  const exit = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const appear = clamp((progress + 0.03) / 0.08);
  const visible = appear * (1 - exit);
  const floatPulse = 0.5 + (0.5 * Math.sin((progress * TAU * 0.68) + 0.5));
  const balloons = [
    { x: -142, y: 46, startX: -178, startY: 70, size: 84, color: COLOR_CYAN, phase: 0.12 },
    { x: -86, y: -70, startX: -118, startY: 28, size: 108, color: COLOR_PINK, phase: 0.34 },
    { x: 0, y: -118, startX: -28, startY: 0, size: 128, color: COLOR_GOLD, phase: 0.58 },
    { x: 88, y: -70, startX: 112, startY: 34, size: 106, color: COLOR_PURPLE, phase: 0.82 },
    { x: 146, y: 48, startX: 180, startY: 74, size: 86, color: COLOR_HOT, phase: 0.22 },
    { x: -48, y: 52, startX: -78, startY: 132, size: 96, color: hexToRgb("#ff8fca"), phase: 0.48 },
    { x: 52, y: 54, startX: 82, startY: 142, size: 92, color: hexToRgb("#58c7ff"), phase: 0.68 },
  ];

  drawCircle(rgba, centerX, centerY + 24, 186 + (floatPulse * 12), COLOR_PINK, visible * formation * 0.012);
  drawCircle(rgba, centerX, centerY + 36, 146 + (floatPulse * 8), COLOR_GOLD_SOFT, visible * formation * 0.008);

  for (let index = 0; index < balloons.length; index += 1) {
    const balloon = balloons[index];
    const delay = index * 0.018;
    const gather = easeOutCubic(clamp((progress - delay) / 0.37));
    const settle = easeInOutSine(clamp((progress - 0.32 - (index * 0.006)) / 0.16));
    const targetX = centerX + balloon.x;
    const targetY = centerY + balloon.y;
    const startX = centerX + balloon.startX;
    const startY = HEIGHT - 28 + balloon.startY;
    const driftX = Math.sin((progress * TAU * 0.42) + (balloon.phase * TAU)) * (5 + (index % 3));
    const driftY = Math.cos((progress * TAU * 0.36) + (balloon.phase * TAU)) * (7 + (index % 2));
    const splitAngle = -Math.PI * 0.5 + ((index - 3) * 0.26);
    const exitX = Math.cos(splitAngle) * exit * (64 + ((index % 3) * 22));
    const exitY = -exit * (128 + ((index % 4) * 28));
    const x = mix(startX, targetX, gather) + (driftX * (formation + hold) * (1 - exit)) + exitX;
    const y = mix(startY, targetY, gather) + (driftY * (formation + hold) * (1 - exit)) - (Math.sin(settle * Math.PI) * 10) + exitY;
    const birth = clamp((progress + 0.045 - delay) / 0.12);
    const alpha = visible * birth * (0.22 + (gather * 0.78)) * (0.72 + (settle * 0.24)) * (1 - (exit * 0.72));
    const size = balloon.size * (0.92 + (gather * 0.08) + (floatPulse * 0.018 * (1 - exit)));

    if (alpha <= 0.01) continue;

    drawCapsule(
      rgba,
      x - (size * 0.16),
      y + (size * 0.72),
      x + (Math.sin((progress * TAU * 0.8) + index) * size * 0.18),
      y + (size * 1.42),
      Math.max(1.1, size * 0.018),
      index % 2 === 0 ? hexToRgb("#ffe6f4") : hexToRgb("#fff2c8"),
      alpha * 0.2,
    );
    drawBalloon(rgba, x, y, size, balloon.color, alpha);
  }

  const ribbonReveal = easeInOutSine(clamp((progress - 0.22) / 0.28)) * visible * (1 - (exit * 0.9));
  for (let ribbon = 0; ribbon < 5; ribbon += 1) {
    const angle = -0.9 + (ribbon * 0.45);
    const radius = 112 + ((ribbon % 2) * 24);
    const x1 = centerX + (Math.cos(angle) * radius);
    const y1 = centerY + 148 + (Math.sin((progress * TAU * 0.5) + ribbon) * 8);
    const x2 = x1 + (Math.sin((progress * TAU * 0.62) + ribbon) * 34);
    const y2 = y1 + 54 + (Math.cos((progress * TAU * 0.46) + ribbon) * 10);
    drawCapsule(rgba, x1, y1, x2, y2, 3.4, ribbon % 2 === 0 ? COLOR_PINK : COLOR_CYAN, ribbonReveal * 0.16);
    drawCapsule(rgba, x1, y1, x2, y2, 1.2, COLOR_WHITE, ribbonReveal * 0.24);
  }

  for (let sparkle = 0; sparkle < 14; sparkle += 1) {
    const delay = 0.18 + ((sparkle % 5) * 0.024);
    const sparkleAppear = easeInOutSine(clamp((progress - delay) / 0.28));
    const angle = -1.05 + ((sparkle / 13) * 2.1);
    const radius = 128 + ((sparkle % 4) * 24);
    const exitRadius = exit * (72 + ((sparkle % 3) * 18));
    const x = centerX + (Math.cos(angle) * (radius + exitRadius)) + (Math.sin((progress * TAU * 0.72) + sparkle) * 8);
    const y = centerY + 12 + (Math.sin(angle) * radius * 0.58) - (exit * 84);
    const alpha = visible * sparkleAppear * (0.045 + (hold * 0.08) + (floatPulse * 0.035)) * (1 - (exit * 0.7));
    drawSpark(rgba, x, y, 4 + ((sparkle % 3) * 1.2), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  return rgba;
};

const renderMessengerBirthdayCandleLightWish = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const progress = beat.progress;
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.56;
  const appear = clamp((progress + 0.04) / 0.12);
  const formation = easeInOutSine(clamp(progress / 0.375));
  const cakeReveal = easeInOutSine(clamp((progress - 0.12) / 0.28));
  const hold = easeInOutSine(clamp((progress - 0.375) / 0.1875));
  const exit = easeInOutSine(clamp((progress - 0.75) / 0.25));
  const visible = appear * (1 - exit);
  const flameStrength = visible * (1 - (exit * 0.86));
  const warmPulse = 0.5 + (0.5 * Math.sin((progress * TAU * 1.18) + 0.25));
  const candlePalette = [COLOR_PINK, COLOR_CYAN, COLOR_GOLD, hexToRgb("#ffe8fb"), hexToRgb("#ff9fd8")];
  const candles = [
    { tx: -94, ty: 2, sx: -164, sy: 150, size: 70, color: COLOR_PINK, delay: 0 },
    { tx: -56, ty: -18, sx: -102, sy: 118, size: 76, color: COLOR_CYAN, delay: 0.02 },
    { tx: -18, ty: -30, sx: -38, sy: 94, size: 80, color: COLOR_GOLD, delay: 0.04 },
    { tx: 22, ty: -30, sx: 40, sy: 94, size: 80, color: COLOR_PINK, delay: 0.06 },
    { tx: 60, ty: -18, sx: 104, sy: 118, size: 76, color: COLOR_CYAN, delay: 0.08 },
    { tx: 96, ty: 2, sx: 166, sy: 150, size: 70, color: COLOR_GOLD, delay: 0.1 },
  ];

  const drawWishCandle = (x, y, height, color, alpha, flickerPhase) => {
    const width = height * 0.18;
    const flameSize = height * (0.22 + (Math.sin(flickerPhase) * 0.018));
    drawCircle(rgba, x, y - (height * 0.58), height * 0.36, COLOR_GOLD_SOFT, alpha * flameStrength * (0.06 + (warmPulse * 0.025)));
    drawRotatedRect(rgba, x, y, width, height, 0, color, alpha * 0.94, 1.1);
    drawRotatedRect(rgba, x + (width * 0.16), y, width * 0.32, height * 0.9, 0, COLOR_WHITE, alpha * 0.2, 0.8);
    drawCapsule(rgba, x - (width * 0.44), y - (height * 0.18), x + (width * 0.44), y - (height * 0.18), width * 0.13, COLOR_WHITE, alpha * 0.24);
    drawFlame(rgba, x, y - (height * 0.6), flameSize, alpha * flameStrength * (0.78 + (Math.sin(flickerPhase * 1.3) * 0.12)));
  };

  if (cakeReveal > 0.01) {
    const cakeAlpha = visible * cakeReveal * (1 - (exit * 0.75));
    const cakeY = centerY + 74 + (exit * 46);
    const cakeW = 232 * (0.98 + (hold * warmPulse * 0.015));
    drawCircle(rgba, centerX, cakeY - 72, cakeW * 0.62, COLOR_GOLD_SOFT, cakeAlpha * 0.01);
    drawCapsule(rgba, centerX - (cakeW * 0.58), cakeY + 82, centerX + (cakeW * 0.58), cakeY + 82, 18, hexToRgb("#fff0f8"), cakeAlpha * 0.82);
    drawRotatedRect(rgba, centerX, cakeY + 34, cakeW, 90, 0, hexToRgb("#ff8fca"), cakeAlpha * 0.94, 1.6);
    drawRotatedRect(rgba, centerX, cakeY - 8, cakeW * 0.72, 58, 0, hexToRgb("#ffd2eb"), cakeAlpha * 0.94, 1.6);
    for (let drip = 0; drip < 5; drip += 1) {
      const x = centerX - (cakeW * 0.3) + (drip * cakeW * 0.15);
      drawCircle(rgba, x, cakeY + 2, 14, hexToRgb("#fff6dd"), cakeAlpha * 0.82);
      drawCapsule(rgba, x, cakeY + 10, x, cakeY + 34 + ((drip % 2) * 8), 5, hexToRgb("#fff6dd"), cakeAlpha * 0.62);
    }
    for (let dot = 0; dot < 6; dot += 1) {
      drawCircle(rgba, centerX - 78 + (dot * 31), cakeY + 36 + ((dot % 2) * 8), 5.4, candlePalette[dot % candlePalette.length], cakeAlpha * 0.72);
    }
  }

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const move = easeInOutSine(clamp((progress - candle.delay) / 0.34));
    const settle = easeInOutSine(clamp((progress - 0.25 - candle.delay) / 0.18));
    const birth = clamp((progress + 0.05 - candle.delay) / 0.12);
    const targetX = centerX + candle.tx;
    const targetY = centerY + candle.ty;
    const startX = centerX + candle.sx;
    const startY = HEIGHT - 34 + candle.sy;
    const driftX = Math.sin((progress * TAU * 0.34) + index) * 4.5 * (formation + hold) * (1 - exit);
    const driftY = Math.cos((progress * TAU * 0.42) + index) * 5.5 * (formation + hold) * (1 - exit);
    const x = mix(startX, targetX, move) + driftX + (exit * Math.sign(candle.tx || 1) * (34 + (index * 3)));
    const y = mix(startY, targetY, move) + driftY - (Math.sin(settle * Math.PI) * 12) - (exit * (84 + (index * 10)));
    const alpha = birth * visible * (0.34 + (move * 0.66)) * (1 - (exit * 0.58));
    drawWishCandle(x, y, candle.size, candle.color, alpha, (progress * TAU * (1.5 + (index * 0.09))) + index);
  }

  const ringAlpha = visible * formation * (1 - (exit * 0.9));
  drawRing(rgba, centerX, centerY - 18, 116 + (warmPulse * 7), 3.2, COLOR_GOLD_SOFT, ringAlpha * 0.026);
  drawRing(rgba, centerX, centerY - 18, 150 + (warmPulse * 9), 2.4, COLOR_PINK, ringAlpha * 0.016);

  for (let sparkle = 0; sparkle < 18; sparkle += 1) {
    const rise = easeInOutSine(clamp((progress - 0.42 - ((sparkle % 5) * 0.015)) / 0.54));
    const dissolveRise = easeOutCubic(clamp((progress - 0.72) / 0.28));
    const angle = -1.05 + ((sparkle / 17) * 2.1);
    const radius = 102 + ((sparkle % 4) * 22);
    const x = centerX + (Math.cos(angle) * radius) + (Math.sin((progress * TAU * 0.55) + sparkle) * 9);
    const y = centerY - 20 + (Math.sin(angle) * radius * 0.42) - (rise * 52) - (dissolveRise * 92);
    const alpha = visible * (0.02 + (hold * 0.08) + (rise * 0.05) + (exit * 0.12)) * (1 - (exit * 0.64));
    drawSpark(rgba, x, y, 3.4 + ((sparkle % 3) * 1.1), sparkle % 3 === 0 ? COLOR_GOLD_SOFT : COLOR_WHITE, alpha);
  }

  return rgba;
};

const renderMessengerConfettiStorm = (time, _seed, timeline) => renderMessengerCelebrationWink(time, timeline, "storm");
const renderMessengerPrismConfettiRush = (time, _seed, timeline) => renderMessengerCelebrationWink(time, timeline, "prism");
const renderMessengerNeonStreamerDrop = (time, _seed, timeline) => renderMessengerCelebrationWink(time, timeline, "drop");
const renderMessengerConfettiBurstFormationWink = (time, _seed, timeline) => renderMessengerConfettiBurstFormation(time, _seed, timeline);
const renderMessengerPartyHornCelebrationWink = (time, _seed, timeline) => renderMessengerPartyHornCelebration(time, _seed, timeline);
const renderMessengerHeavyConfettiRainWink = (time, _seed, timeline) => renderMessengerHeavyConfettiRain(time, _seed, timeline);
const renderMessengerCelebrationStormWink = (time, _seed, timeline) => renderMessengerCelebrationWink(time, timeline, "storm");
const renderMessengerGoldStarRainWink = (time, _seed, timeline) => renderMessengerGoldStarRain(time, _seed, timeline);
const renderMessengerStarExplosionBurstWink = (time, _seed, timeline) => renderMessengerGoldenStarPack(time, _seed, timeline, "explosion");
const renderMessengerGalaxyStarStormWink = (time, _seed, timeline) => renderMessengerGoldenStarPack(time, _seed, timeline, "galaxy");
const renderMessengerMegaStarFlashWink = (time, _seed, timeline) => renderMessengerGoldenStarPack(time, _seed, timeline, "flash");
const renderMessengerStarJackpotBlastWink = (time, _seed, timeline) => renderMessengerGoldenStarPack(time, _seed, timeline, "jackpot");
const renderMessengerGoldenHeartRain = (time, _seed, timeline) => renderMessengerHeartWink(time, timeline, "golden");
const renderMessengerVelvetHeartPulse = (time, _seed, timeline) => renderMessengerHeartWink(time, timeline, "pulse");
const renderMessengerCupidSparkDrift = (time, _seed, timeline) => renderMessengerHeartWink(time, timeline, "drift");
const renderMessengerFireworkImpact = (time, _seed, timeline) => renderMessengerFireworksWink(time, timeline, "impact");
const renderMessengerFireworkCelebrationBlastWink = (time, _seed, timeline) => renderMessengerFireworkCelebrationBlast(time, _seed, timeline);
const renderMessengerStarlightRocketPop = (time, _seed, timeline) => renderMessengerFireworksWink(time, timeline, "rocket");
const renderMessengerAuroraMiniFireworks = (time, _seed, timeline) => renderMessengerFireworksWink(time, timeline, "aurora");
const renderMessengerBingoBallChaos = (time, _seed, timeline) => renderMessengerBingoBallWink(time, timeline, "chaos");
const renderMessengerLuckyBallParade = (time, _seed, timeline) => renderMessengerBingoBallWink(time, timeline, "parade");
const renderMessengerTurboBallBounce = (time, _seed, timeline) => renderMessengerBingoBallWink(time, timeline, "turbo");
const renderMessengerJackpotPop = (time, _seed, timeline) => renderMessengerLuckyWink(time, timeline, "jackpot");
const renderMessengerCloverStarfall = (time, _seed, timeline) => renderMessengerLuckyWink(time, timeline, "clover");
const renderMessengerBonusSparkShower = (time, _seed, timeline) => renderMessengerLuckyWink(time, timeline, "shower");
const renderMessengerThumbsUpPop = (time, _seed, timeline) => renderMessengerThumbsWink(time, timeline, "single");
const renderMessengerDoubleLikeRush = (time, _seed, timeline) => renderMessengerThumbsWink(time, timeline, "double");
const renderMessengerBirthdayCakePop = (time, _seed, timeline) => renderMessengerBirthdayWink(time, timeline, "cake");
const renderMessengerBalloonWishBurst = (time, _seed, timeline) => renderMessengerBirthdayWink(time, timeline, "balloons");
const renderMessengerShamrockStorm = (time, _seed, timeline) => renderMessengerLuckyWink(time, timeline, "clover");
const renderMessengerPotOfGoldBurst = (time, _seed, timeline) => renderMessengerLuckyWink(time, timeline, "jackpot");

const drawKissMark = (buffer, cx, cy, size, alpha = 1, tilt = -0.08) => {
  drawCircle(buffer, cx, cy, size * 0.72, COLOR_PINK, alpha * 0.11);
  drawCapsule(buffer, cx - (size * 0.36), cy - (size * 0.12), cx + (size * 0.02), cy - (size * 0.22), size * 0.18, COLOR_RED, alpha, 1.5);
  drawCapsule(buffer, cx - (size * 0.02), cy - (size * 0.22), cx + (size * 0.4), cy - (size * 0.12), size * 0.18, COLOR_HOT, alpha, 1.5);
  drawCapsule(buffer, cx - (size * 0.42), cy + (size * 0.14), cx, cy + (size * 0.24), size * 0.2, COLOR_HOT, alpha * 0.95, 1.5);
  drawCapsule(buffer, cx, cy + (size * 0.24), cx + (size * 0.42), cy + (size * 0.14), size * 0.2, COLOR_RED, alpha * 0.95, 1.5);
  drawRotatedRect(buffer, cx, cy + (size * 0.02), size * 0.68, size * 0.055, tilt, COLOR_WHITE, alpha * 0.28, 1.2);
  drawSpark(buffer, cx + (size * 0.34), cy - (size * 0.32), size * 0.08, COLOR_WHITE, alpha * 0.5);
};

const renderMessengerKissWink = (time, _seed, timeline, variant = "burst") => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.5;
  const reveal = easeOutBack(clamp(beat.progress / 0.38));
  const heroAlpha = beat.heroAlpha * (1 - (beat.dissolve * 0.84));

  if (variant === "storm") {
    for (let index = 0; index < 22; index += 1) {
      const move = easeInOutSine(clamp((beat.progress - ((index % 8) * 0.012)) / 0.48));
      const side = index % 2 === 0 ? -1 : 1;
      const startX = side < 0 ? -80 : WIDTH + 80;
      const targetX = 88 + ((index * 79) % (WIDTH - 176));
      const targetY = 112 + ((index * 113) % (HEIGHT - 224));
      const x = mix(startX, targetX, move) + (Math.sin((beat.progress * TAU) + index) * 18) + (beat.dissolve * side * 90);
      const y = targetY + (Math.cos((beat.progress * TAU * 0.8) + index) * 20) - (beat.dissolve * 54);
      drawKissMark(rgba, x, y, 34 + ((index % 5) * 7), move * heroAlpha * 0.62, (index % 2 === 0 ? -0.16 : 0.12));
    }
  }

  const size = variant === "storm" ? 176 : 236;
  const y = mix(HEIGHT + 160, centerY + 6, reveal) - (beat.dissolve * 58);
  drawShockwave(rgba, centerX, centerY + 8, 126 + (beat.pulse * 20) + (beat.dissolve * 80), COLOR_PINK, heroAlpha * 0.07);
  drawKissMark(rgba, centerX, y, size * (0.98 + (beat.pulse * 0.04)), heroAlpha, -0.08);

  for (let sparkle = 0; sparkle < 14; sparkle += 1) {
    const angle = -1.2 + ((sparkle / 13) * 2.4);
    const radius = 136 + ((sparkle % 4) * 26) + (beat.dissolve * 58);
    drawSpark(rgba, centerX + (Math.cos(angle) * radius), centerY + (Math.sin(angle) * radius * 0.62), 4.8, sparkle % 2 === 0 ? COLOR_PINK : COLOR_WHITE, heroAlpha * 0.12);
  }

  return rgba;
};

const renderMessengerHappyBirthdayReveal = (time, _seed, timeline) => {
  const rgba = renderMessengerBirthdayWink(time, timeline, "balloons");
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.46;
  const textReveal = easeOutBack(clamp((beat.progress - 0.24) / 0.26));
  const textAlpha = beat.heroAlpha * textReveal * (1 - (beat.dissolve * 0.9));
  const lift = (1 - textReveal) * 86;
  drawShockwave(rgba, centerX, centerY + 20, 180 + (beat.pulse * 22) + (beat.dissolve * 76), COLOR_GOLD, textAlpha * 0.08);
  drawTextBlock(rgba, "HAPPY", centerX, centerY - 46 + lift, 9.4 + (beat.pulse * 0.25), COLOR_GOLD_SOFT, textAlpha * 0.98, COLOR_WHITE);
  drawTextBlock(rgba, "BIRTHDAY", centerX, centerY + 58 + lift, 7.8 + (beat.pulse * 0.22), COLOR_PINK, textAlpha * 0.96, COLOR_GOLD_SOFT);
  return rgba;
};

const renderMessengerNeonJackpotGrid = (time, _seed, timeline) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const horizonY = HEIGHT * 0.47;
  const alpha = beat.heroAlpha * (1 - (beat.dissolve * 0.9));
  const build = easeInOutSine(clamp(beat.progress / 0.42));

  for (let row = 0; row < 10; row += 1) {
    const depth = row / 9;
    const y = mix(horizonY + 16, HEIGHT + 120, depth) - ((1 - build) * 120) + (beat.dissolve * 80);
    const lineAlpha = alpha * (0.08 + (depth * 0.1));
    drawCapsule(rgba, 44, y, WIDTH - 44, y, 1.8 + (depth * 1.4), row % 2 === 0 ? COLOR_CYAN : COLOR_PURPLE, lineAlpha);
  }

  for (let line = -7; line <= 7; line += 1) {
    const targetX = centerX + (line * 76);
    drawCapsule(rgba, centerX, horizonY, targetX, HEIGHT + 60, 2.2, line % 2 === 0 ? COLOR_HOT : COLOR_CYAN, alpha * 0.12 * build);
  }

  drawRing(rgba, centerX, horizonY + 80, 146 + (beat.pulse * 18), 4.2, COLOR_CYAN, alpha * 0.08);
  drawRing(rgba, centerX, horizonY + 80, 220 + (beat.pulse * 26), 3.2, COLOR_PURPLE, alpha * 0.055);
  drawTextBlock(rgba, "JACKPOT", centerX, horizonY - 58, 7.6 + (beat.pulse * 0.25), COLOR_CYAN, alpha * 0.54, COLOR_HOT);

  for (let spark = 0; spark < 26; spark += 1) {
    const x = 76 + ((spark * 97) % (WIDTH - 152));
    const y = 84 + ((spark * 131) % (HEIGHT - 260)) + (beat.dissolve * 54);
    drawSpark(rgba, x, y, 3.2 + ((spark % 3) * 1.2), spark % 2 === 0 ? COLOR_CYAN : COLOR_HOT, alpha * (0.05 + ((spark % 4) * 0.012)));
  }

  return rgba;
};

const renderMessengerKissMarkBurst = (time, seed, timeline) => renderMessengerKissWink(time, seed, timeline, "burst");
const renderMessengerKissStorm = (time, seed, timeline) => renderMessengerKissWink(time, seed, timeline, "storm");

const drawCenteredHeroParticles = (rgba, beat, variant, colorA, colorB) => {
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.47;
  const burst = easeOutCubic(clamp((beat.progress - 0.16) / 0.36));
  const settle = easeInOutSine(clamp((beat.progress - 0.38) / 0.22));
  const alphaBase = beat.heroAlpha * (1 - (beat.dissolve * 0.88));
  const total = variant === "clean" ? 34 : 56;

  for (let index = 0; index < total; index += 1) {
    const angle = ((index / total) * TAU) + (Math.sin(index * 1.77) * 0.2);
    const radius = (38 + ((index % 9) * 13) + (burst * (68 + ((index % 5) * 22)))) * (1 - (settle * 0.12));
    const x = centerX + (Math.cos(angle) * (radius + (beat.dissolve * 74)));
    const y = centerY + (Math.sin(angle) * (radius * 0.72 + (beat.dissolve * 46)));
    const alpha = alphaBase * (0.12 + (burst * 0.28) + (settle * 0.08)) * (1 - (beat.dissolve * 0.7));
    const size = 4.2 + ((index % 4) * 1.8);
    const color = index % 3 === 0 ? colorA : index % 3 === 1 ? colorB : COLOR_WHITE;

    if (variant === "confetti") {
      drawConfettiSprite(rgba, x, y, 10 + ((index % 3) * 4), 6 + ((index % 2) * 3), angle + (beat.progress * TAU), index % 2 === 0 ? "rect" : "diamond", color, alpha * 1.6);
    } else if (variant === "stars") {
      drawGoldenStickerStar(rgba, x, y, size * 2.5, alpha * 1.2, angle);
    } else if (variant === "hearts") {
      drawGlossyHeart(rgba, x, y, size * 3.1, color, alpha * 1.15);
    } else if (variant === "kiss") {
      drawKissMark(rgba, x, y, size * 4.2, alpha * 0.8, angle * 0.1);
    } else if (variant === "clover") {
      drawLuckyClover(rgba, x, y, size * 5.2, COLOR_GREEN, alpha * 0.95);
    } else if (variant === "coin") {
      drawCoin(rgba, x, y, size * 2.2, alpha * 1.1, angle);
    } else if (variant === "ball") {
      const ball = ballPalette[index % ballPalette.length];
      drawBingoBall(rgba, x, y, size * 4.1, ball.color, ball.digit, alpha);
    } else if (variant === "balloon") {
      drawBalloon(rgba, x, y, size * 7.5, index % 2 === 0 ? colorA : colorB, alpha * 0.8);
    } else if (variant === "neon") {
      drawCircle(rgba, x, y, size * 1.2, color, alpha * 0.7);
      drawCapsule(rgba, centerX, centerY, x, y, 1.6, color, alpha * 0.28);
    } else {
      drawSpark(rgba, x, y, size, color, alpha);
    }
  }
};

const renderPremiumCenteredChatWink = (time, _seed, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.47;
  const build = easeOutBack(clamp((beat.progress - 0.02) / 0.42));
  const heroAlpha = beat.heroAlpha * (1 - (beat.dissolve * 0.9));
  const pulse = 1 + (beat.pulse * 0.045);
  const exitLift = beat.dissolve * 38;

  const glowColor = variant.includes("neon") ? COLOR_CYAN
    : variant.includes("heart") || variant.includes("kiss") || variant.includes("birthday") ? COLOR_PINK
      : variant.includes("clover") || variant.includes("gold") ? COLOR_GOLD
        : COLOR_GOLD_SOFT;
  drawCircle(rgba, centerX, centerY + 18, 168 * build * pulse, glowColor, heroAlpha * 0.018);
  drawRing(rgba, centerX, centerY + 10, 126 + (beat.pulse * 12) + (beat.dissolve * 44), 3.4, glowColor, heroAlpha * 0.045);
  drawRing(rgba, centerX, centerY + 10, 198 + (beat.pulse * 18) + (beat.dissolve * 68), 2.2, COLOR_WHITE, heroAlpha * 0.018);

  if (variant === "confetti-rain" || variant === "party-horn") {
    drawCenteredHeroParticles(rgba, beat, "confetti", COLOR_HOT, COLOR_CYAN);
    if (variant === "party-horn") {
      drawCapsule(rgba, centerX - 230, centerY + 92, centerX - 132, centerY + 28, 22, COLOR_GOLD, heroAlpha * 0.72);
      drawCapsule(rgba, centerX + 230, centerY + 92, centerX + 132, centerY + 28, 22, COLOR_CYAN, heroAlpha * 0.72);
    }
  } else if (variant === "bingo-reveal" || variant === "bingo-letters") {
    drawCenteredHeroParticles(rgba, beat, "ball", COLOR_GOLD, COLOR_CYAN);
    drawTextBlock(rgba, variant === "bingo-letters" ? "B I N G O" : "BINGO!", centerX, centerY - exitLift, variant === "bingo-letters" ? 8.2 : 10.7, COLOR_GOLD, heroAlpha * build, COLOR_WHITE);
  } else if (variant === "bingo-balls") {
    drawCenteredHeroParticles(rgba, beat, "ball", COLOR_GOLD, COLOR_CYAN);
    drawTextBlock(rgba, "BINGO", centerX, centerY + 150 - exitLift, 7.2, COLOR_CYAN, heroAlpha * 0.42, COLOR_WHITE);
  } else if (variant === "star-rain" || variant === "star-burst") {
    drawCenteredHeroParticles(rgba, beat, "stars", COLOR_GOLD, COLOR_GOLD_SOFT);
    drawGoldenStickerStar(rgba, centerX, centerY - exitLift, variant === "star-burst" ? 112 * build * pulse : 96 * build * pulse, heroAlpha, beat.progress * 0.18);
  } else if (variant === "heart-formation" || variant === "heart-rain") {
    drawCenteredHeroParticles(rgba, beat, "hearts", COLOR_PINK, COLOR_HOT);
    drawGlossyHeart(rgba, centerX, centerY - exitLift, 118 * build * pulse, COLOR_PINK, heroAlpha);
  } else if (variant === "kiss-burst" || variant === "kiss-storm") {
    drawCenteredHeroParticles(rgba, beat, "kiss", COLOR_PINK, COLOR_RED);
    drawKissMark(rgba, centerX, centerY - exitLift, 148 * build * pulse, heroAlpha);
  } else if (variant === "shamrock") {
    drawCenteredHeroParticles(rgba, beat, "clover", COLOR_GREEN, COLOR_GOLD);
    drawLuckyClover(rgba, centerX, centerY - exitLift, 154 * build * pulse, COLOR_GREEN, heroAlpha);
  } else if (variant === "pot-gold") {
    drawCenteredHeroParticles(rgba, beat, "coin", COLOR_GOLD, COLOR_GOLD_SOFT);
    drawCapsule(rgba, centerX - 92, centerY + 28 - exitLift, centerX + 92, centerY + 28 - exitLift, 34 * build, COLOR_GOLD, heroAlpha);
    drawRotatedRect(rgba, centerX, centerY + 80 - exitLift, 174 * build, 82 * build, 0, hexToRgb("#16251a"), heroAlpha * 0.95, 2);
    drawCapsule(rgba, centerX - 92, centerY + 38 - exitLift, centerX + 92, centerY + 38 - exitLift, 13 * build, COLOR_GOLD_SOFT, heroAlpha * 0.55);
  } else if (variant === "birthday-text") {
    drawCenteredHeroParticles(rgba, beat, "confetti", COLOR_PINK, COLOR_GOLD);
    drawTextBlock(rgba, "HAPPY", centerX, centerY - 54 - exitLift, 8.8, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_WHITE);
    drawTextBlock(rgba, "BIRTHDAY", centerX, centerY + 50 - exitLift, 7.2, COLOR_PINK, heroAlpha * build, COLOR_GOLD_SOFT);
  } else if (variant === "birthday-balloons") {
    drawCenteredHeroParticles(rgba, beat, "balloon", COLOR_PINK, COLOR_CYAN);
    drawBalloon(rgba, centerX - 52, centerY - 18 - exitLift, 126 * build * pulse, COLOR_GOLD, heroAlpha);
    drawBalloon(rgba, centerX + 62, centerY + 4 - exitLift, 112 * build * pulse, COLOR_PINK, heroAlpha * 0.9);
  } else if (variant === "birthday-cake") {
    drawCenteredHeroParticles(rgba, beat, "confetti", COLOR_GOLD, COLOR_PINK);
    drawBirthdayCake(rgba, centerX, centerY + 28 - exitLift, 246 * build * pulse, {
      glow: COLOR_PINK,
      plate: hexToRgb("#ffe8fb"),
      base: COLOR_PINK,
      top: hexToRgb("#ff9fd8"),
      icing: hexToRgb("#fff3d9"),
      icingAccent: COLOR_GOLD_SOFT,
      dot: COLOR_CYAN,
      candleA: COLOR_CYAN,
      candleB: COLOR_GOLD,
      flameGlow: COLOR_GOLD,
      glowAlphaMultiplier: 0.14,
    }, heroAlpha, clamp((beat.progress - 0.22) / 0.2));
  } else if (variant === "thumb" || variant === "thumb-storm") {
    drawCenteredHeroParticles(rgba, beat, "neon", COLOR_CYAN, COLOR_PURPLE);
    drawThumbsUp(rgba, centerX, centerY + 28 - exitLift, 184 * build * pulse, {
      hand: hexToRgb("#fff4dd"),
      cuff: COLOR_CYAN,
      glow: COLOR_PURPLE,
      outline: COLOR_WHITE,
    }, heroAlpha, -0.08);
  } else if (variant === "firework") {
    drawCenteredHeroParticles(rgba, beat, "spark", COLOR_CYAN, COLOR_HOT);
    drawBurstRays(rgba, centerX, centerY - exitLift, 178 * build, 18, COLOR_GOLD, COLOR_CYAN, heroAlpha * 0.42, beat.progress * TAU, 1.3);
    drawSpark(rgba, centerX, centerY - exitLift, 34 * build, COLOR_WHITE, heroAlpha * 0.64);
  } else if (variant === "neon-grid") {
    drawCenteredHeroParticles(rgba, beat, "neon", COLOR_CYAN, COLOR_HOT);
    drawTextBlock(rgba, "NEON", centerX, centerY - 20 - exitLift, 9.4, COLOR_CYAN, heroAlpha * build, COLOR_HOT);
    drawTextBlock(rgba, "GRID", centerX, centerY + 82 - exitLift, 8.2, COLOR_PURPLE, heroAlpha * build, COLOR_CYAN);
  }

  return rgba;
};

const renderChatConfettiRainHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "confetti-rain");
const renderChatPartyHornHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "party-horn");
const renderChatBingoRevealHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "bingo-reveal");
const renderChatBingoLettersHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "bingo-letters");
const renderChatBingoBallsHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "bingo-balls");
const renderChatGoldStarRainHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "star-rain");
const renderChatStarBurstHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "star-burst");
const renderChatHeartFormationHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "heart-formation");
const renderChatHeartRainHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "heart-rain");
const renderChatKissBurstHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "kiss-burst");
const renderChatKissStormHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "kiss-storm");
const renderChatShamrockHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "shamrock");
const renderChatPotGoldHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "pot-gold");
const renderChatBirthdayTextHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "birthday-text");
const renderChatBirthdayBalloonsHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "birthday-balloons");
const renderChatBirthdayCakeHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "birthday-cake");
const renderChatThumbHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "thumb");
const renderChatThumbStormHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "thumb-storm");
const renderChatFireworkHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "firework");
const renderChatNeonHero = (time, seed, timeline) => renderPremiumCenteredChatWink(time, seed, timeline, "neon-grid");

const renderPremiumSocialThemeChatWink = (time, _seed, timeline, variant) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const beat = getMessengerBeat(time, timeline);
  const centerX = WIDTH * 0.5;
  const centerY = HEIGHT * 0.47;
  const build = easeOutBack(clamp((beat.progress - 0.03) / 0.4));
  const heroAlpha = beat.heroAlpha * (1 - (beat.dissolve * 0.92));
  const pulse = 1 + (beat.pulse * 0.045);
  const exitLift = beat.dissolve * 38;
  const group = variant.split("-")[0];
  const glowColor = group === "laugh" ? COLOR_GOLD
    : group === "christmas" || group === "snowman" ? COLOR_CYAN
      : group === "bomb" ? COLOR_HOT
        : group === "friendship" || group === "rose" ? COLOR_PINK
          : COLOR_GOLD_SOFT;

  drawCircle(rgba, centerX, centerY + 18, 160 * build * pulse, glowColor, heroAlpha * 0.018);
  drawRing(rgba, centerX, centerY + 8, 116 + (beat.pulse * 10) + (beat.dissolve * 46), 3, glowColor, heroAlpha * 0.05);
  if (!["bingo", "kiss", "lucky"].includes(group)) {
    drawCenteredHeroParticles(
      rgba,
      beat,
      group === "rose" || group === "friendship" ? "hearts"
        : group === "christmas" || group === "snowman" ? "spark"
          : group === "premium" || group === "win" ? "stars"
            : group === "bomb" ? "confetti"
              : "neon",
      glowColor,
      group === "laugh" ? COLOR_PINK : COLOR_GOLD,
    );
  }

  const y = centerY - exitLift;
  if (group === "bingo") {
    const ballLetters = ["B", "I", "N", "G", "O"];
    const ballColors = ["#0278df", "#f70900", "#9610b8", "#36af0a", "#f7c901"];
    for (let ball = 0; ball < 5; ball += 1) {
      drawBingoBall(rgba, centerX - 144 + (ball * 72), y - 86, 30 * build, hexToRgb(ballColors[ball]), ballLetters[ball], heroAlpha * 0.92);
    }
    drawTextBlock(rgba, variant.includes("letters") ? "B I N G O" : "BINGO!", centerX, y + 22, variant.includes("letters") ? 7.6 : 9.6, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_WHITE);
  } else if (group === "kiss") {
    drawKissMark(rgba, centerX, y, 142 * build * pulse, heroAlpha);
  } else if (group === "star") {
    drawCenteredHeroParticles(rgba, beat, "stars", COLOR_GOLD, COLOR_GOLD_SOFT);
    drawGoldenStickerStar(rgba, centerX, y, 122 * build * pulse, heroAlpha, beat.progress * 0.2);
  } else if (group === "lucky") {
    if (variant.includes("pot")) {
      drawRotatedRect(rgba, centerX, y + 54, 166 * build, 76 * build, 0, hexToRgb("#16251a"), heroAlpha * 0.95, 2);
      drawCapsule(rgba, centerX - 82, y + 12, centerX + 82, y + 12, 28 * build, COLOR_GOLD, heroAlpha);
    } else {
      drawLuckyClover(rgba, centerX, y, 150 * build * pulse, COLOR_GREEN, heroAlpha);
    }
  } else if (group === "firework") {
    drawCenteredHeroParticles(rgba, beat, "spark", COLOR_CYAN, COLOR_HOT);
    drawBurstRays(rgba, centerX, y, 178 * build, 18, COLOR_GOLD, COLOR_CYAN, heroAlpha * 0.44, beat.progress * TAU, 1.3);
    drawSpark(rgba, centerX, y, 34 * build, COLOR_WHITE, heroAlpha * 0.66);
  } else if (group === "neon") {
    drawCenteredHeroParticles(rgba, beat, "neon", COLOR_CYAN, COLOR_HOT);
    drawTextBlock(rgba, variant.includes("pulse") ? "PULSE" : "NEON", centerX, y - 18, 7.8, COLOR_CYAN, heroAlpha * build, COLOR_HOT);
    drawTextBlock(rgba, variant.includes("grid") ? "GRID" : "GLOW", centerX, y + 76, 7.4, COLOR_PURPLE, heroAlpha * build, COLOR_CYAN);
  } else if (group === "celebration") {
    drawCenteredHeroParticles(rgba, beat, "confetti", COLOR_HOT, COLOR_CYAN);
    drawTextBlock(rgba, variant.includes("ribbon") ? "RIBBON" : "PARTY", centerX, y + 28, 7.2, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_WHITE);
  } else if (group === "rose") {
    const roseColor = variant.includes("gold") ? COLOR_GOLD : COLOR_PINK;
    for (let petal = 0; petal < 9; petal += 1) {
      const angle = (petal / 9) * TAU + (beat.progress * 0.8);
      drawGlossyHeart(
        rgba,
        centerX + (Math.cos(angle) * 42 * build),
        y + (Math.sin(angle) * 30 * build),
        (48 + ((petal % 3) * 6)) * build * pulse,
        petal % 3 === 0 ? COLOR_RED : roseColor,
        heroAlpha * 0.72,
      );
    }
    drawGlossyHeart(rgba, centerX, y + 8, 96 * build * pulse, roseColor, heroAlpha);
  } else if (group === "applause") {
    drawThumbsUp(rgba, centerX - 62, y + 18, 118 * build * pulse, { hand: hexToRgb("#fff4dd"), cuff: COLOR_GOLD, glow: COLOR_PINK, outline: COLOR_WHITE }, heroAlpha, 0.18, true);
    drawThumbsUp(rgba, centerX + 62, y + 18, 118 * build * pulse, { hand: hexToRgb("#fff4dd"), cuff: COLOR_CYAN, glow: COLOR_GOLD, outline: COLOR_WHITE }, heroAlpha, -0.18);
    drawTextBlock(rgba, variant.includes("bravo") ? "BRAVO" : "CLAP", centerX, y + 140, 6.2, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_WHITE);
  } else if (group === "laugh") {
    const faceAlpha = heroAlpha * build;
    const drawLaughFace = (x, faceY, size, alpha = faceAlpha) => {
      drawCircle(rgba, x, faceY, size, COLOR_GOLD, alpha * 0.82);
      drawCircle(rgba, x - (size * 0.34), faceY - (size * 0.22), size * 0.08, hexToRgb("#34210a"), alpha);
      drawCircle(rgba, x + (size * 0.34), faceY - (size * 0.22), size * 0.08, hexToRgb("#34210a"), alpha);
      drawCircle(rgba, x, faceY + (size * 0.27), size * 0.28, hexToRgb("#34210a"), alpha * 0.95);
      drawCapsule(rgba, x - (size * 0.2), faceY + (size * 0.16), x + (size * 0.2), faceY + (size * 0.16), size * 0.045, COLOR_WHITE, alpha * 0.72);
      drawSpark(rgba, x - (size * 0.54), faceY + (size * 0.04), size * 0.16, COLOR_CYAN, alpha * 0.62);
      drawSpark(rgba, x + (size * 0.54), faceY + (size * 0.04), size * 0.16, COLOR_CYAN, alpha * 0.62);
    };

    if (variant.includes("haha")) {
      for (let index = 0; index < 6; index += 1) {
        const wave = Math.sin((beat.progress * 7) + index * 0.9) * 34;
        const x = centerX - 225 + (index * 90);
        drawTextBlock(rgba, "HA", x, y - 118 + wave, 5.9 * build, index % 2 === 0 ? COLOR_GOLD_SOFT : COLOR_HOT, heroAlpha * build * 0.82, COLOR_WHITE);
      }
      drawRing(rgba, centerX, y + 10, 138 + (beat.pulse * 28), 7, COLOR_HOT, heroAlpha * 0.24);
      drawLaughFace(centerX, y + 2, 92 * build * pulse, heroAlpha * 0.9);
      drawLaughFace(centerX - 118 * build, y + 82, 34 * build, heroAlpha * 0.58);
      drawLaughFace(centerX + 118 * build, y + 82, 34 * build, heroAlpha * 0.58);
      drawTextBlock(rgba, "HAHAHA!", centerX, y + 138, 7.9 * build, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_PINK);
    } else if (variant.includes("emoji")) {
      for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * TAU + beat.progress * 1.4;
        drawLaughFace(centerX + Math.cos(angle) * 122 * build, y + Math.sin(angle) * 106 * build, 28 * build, heroAlpha * 0.66);
      }
      drawLaughFace(centerX, y, 96 * build * pulse, heroAlpha);
      drawTextBlock(rgba, "LOL", centerX, y + 148, 8.4 * build, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_CYAN);
    } else if (variant.includes("rofl")) {
      drawRing(rgba, centerX, y - 10, 168 * build, 7, COLOR_HOT, heroAlpha * 0.28);
      drawBurstRays(rgba, centerX, y - 10, 188 * build, 12, COLOR_HOT, COLOR_GOLD, heroAlpha * 0.32, beat.progress * TAU, 1.2);
      drawLaughFace(centerX - 62 * build, y + 8, 72 * build * pulse, heroAlpha * 0.88);
      drawLaughFace(centerX + 62 * build, y + 8, 72 * build * pulse, heroAlpha * 0.88);
      drawTextBlock(rgba, "ROFL!", centerX, y + 128, 9.2 * build, COLOR_PINK, heroAlpha * build, COLOR_GOLD_SOFT);
    } else if (variant.includes("finale")) {
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * TAU - beat.progress * 1.2;
        drawTextBlock(rgba, index % 2 === 0 ? "HA" : "LOL", centerX + Math.cos(angle) * 150 * build, y + Math.sin(angle) * 122 * build, 4.8 * build, index % 2 === 0 ? COLOR_HOT : COLOR_CYAN, heroAlpha * build * 0.72, COLOR_WHITE);
      }
      drawLaughFace(centerX, y - 8, 82 * build * pulse, heroAlpha * 0.88);
      drawTextBlock(rgba, "LOL!", centerX, y + 130, 9.4 * build, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_PINK);
    } else {
      drawBurstRays(rgba, centerX, y - 12, 168 * build, 14, COLOR_GOLD, COLOR_HOT, heroAlpha * 0.36, beat.progress * TAU, 1.1);
      drawLaughFace(centerX - 118 * build, y - 42, 38 * build, heroAlpha * 0.58);
      drawLaughFace(centerX + 118 * build, y - 42, 38 * build, heroAlpha * 0.58);
      drawTextBlock(rgba, "LOL", centerX, y + 8, 10.8 * build, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_PINK);
      drawLaughFace(centerX, y - 128, 66 * build, heroAlpha * 0.82);
    }
  } else if (group === "win") {
    drawCrown(rgba, centerX, y - 88, 156 * build * pulse, COLOR_GOLD, heroAlpha);
    drawTextBlock(rgba, variant.includes("big") || variant.includes("mega") ? "BIG WIN" : "WIN", centerX, y + 38, variant.includes("big") || variant.includes("mega") ? 6.8 : 10.4, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_WHITE);
  } else if (group === "christmas") {
    drawGoldenStickerStar(rgba, centerX, y - 122, 34 * build, heroAlpha, beat.progress);
    drawRotatedRect(rgba, centerX, y - 60, 158 * build, 74 * build, 0, COLOR_GREEN, heroAlpha, 2.2);
    drawRotatedRect(rgba, centerX, y - 10, 198 * build, 82 * build, 0, COLOR_GREEN, heroAlpha * 0.9, 2.2);
    drawRotatedRect(rgba, centerX, y + 56, 236 * build, 88 * build, 0, COLOR_GREEN, heroAlpha * 0.82, 2.2);
    drawRotatedRect(rgba, centerX, y + 122, 42 * build, 64 * build, 0, hexToRgb("#7a4521"), heroAlpha, 1.4);
    drawTextBlock(rgba, variant.includes("finale") ? "MERRY" : "XMAS", centerX, y + 184, 6.2, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_WHITE);
  } else if (group === "snowman") {
    drawCircle(rgba, centerX, y + 82, 76 * build, COLOR_WHITE, heroAlpha);
    drawCircle(rgba, centerX, y + 8, 58 * build, COLOR_WHITE, heroAlpha);
    drawCircle(rgba, centerX, y - 52, 44 * build, COLOR_WHITE, heroAlpha);
    drawRotatedRect(rgba, centerX, y - 104, 86 * build, 20 * build, 0, hexToRgb("#182331"), heroAlpha, 1.2);
    drawRotatedRect(rgba, centerX, y - 132, 54 * build, 46 * build, 0, hexToRgb("#182331"), heroAlpha, 1.2);
    drawCapsule(rgba, centerX - 10, y - 42, centerX + 34, y - 36, 5 * build, COLOR_HOT, heroAlpha);
    drawTextBlock(rgba, "SNOW", centerX, y + 184, 6.8, COLOR_CYAN, heroAlpha * build, COLOR_WHITE);
  } else if (group === "bomb") {
    drawCircle(rgba, centerX, y, 78 * build * pulse, hexToRgb("#171a24"), heroAlpha);
    drawCircle(rgba, centerX - 18, y - 20, 30 * build, COLOR_WHITE, heroAlpha * 0.1);
    drawCapsule(rgba, centerX + 40, y - 58, centerX + 92, y - 104, 6 * build, COLOR_GOLD, heroAlpha);
    drawBurstRays(rgba, centerX, y, 170 * build, 16, COLOR_HOT, COLOR_GOLD, heroAlpha * 0.45, beat.progress * TAU, 1.2);
    drawTextBlock(rgba, "BOOM", centerX, y + 150, 7.2, COLOR_HOT, heroAlpha * build, COLOR_GOLD_SOFT);
  } else if (group === "friendship") {
    drawGlossyHeart(rgba, centerX, y - 22, 98 * build * pulse, COLOR_PINK, heroAlpha);
    drawThumbsUp(rgba, centerX - 92, y + 48, 96 * build, { hand: hexToRgb("#fff4dd"), cuff: COLOR_CYAN, glow: COLOR_PINK, outline: COLOR_WHITE }, heroAlpha * 0.86, 0.16, true);
    drawThumbsUp(rgba, centerX + 92, y + 48, 96 * build, { hand: hexToRgb("#fff4dd"), cuff: COLOR_GOLD, glow: COLOR_PINK, outline: COLOR_WHITE }, heroAlpha * 0.86, -0.16);
    drawTextBlock(rgba, "FRIENDS", centerX, y + 160, 5.8, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_PINK);
  } else if (group === "premium") {
    if (variant.includes("crown") || variant.includes("vip")) {
      drawCrown(rgba, centerX, y - 22, 184 * build * pulse, COLOR_GOLD, heroAlpha);
      drawTextBlock(rgba, "VIP", centerX, y + 118, 8.2, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_WHITE);
    } else {
      drawDiamondGem(rgba, centerX, y, 164 * build * pulse, variant.includes("gold") ? COLOR_GOLD : COLOR_CYAN, heroAlpha, beat.progress * 0.4);
      drawTextBlock(rgba, variant.includes("finale") ? "LUXURY" : "DIAMOND", centerX, y + 142, variant.includes("finale") ? 5.8 : 5.2, COLOR_GOLD_SOFT, heroAlpha * build, COLOR_WHITE);
    }
  }

  return rgba;
};

const renderChatRoseBloom = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "rose-bloom");
const renderChatRosePetalStorm = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "rose-petal");
const renderChatRoseHeart = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "rose-heart");
const renderChatGoldenRose = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "rose-gold");
const renderChatRoseFinale = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "rose-finale");
const renderChatApplauseClap = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "applause-clap");
const renderChatStandingOvation = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "applause-ovation");
const renderChatGoldenApplause = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "applause-golden");
const renderChatBravoBurst = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "applause-bravo");
const renderChatApplauseFinale = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "applause-finale");
const renderChatLaughLol = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "laugh-lol");
const renderChatLaughEmojiStorm = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "laugh-emoji");
const renderChatLaughHaha = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "laugh-haha");
const renderChatLaughRofl = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "laugh-rofl");
const renderChatLaughFinale = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "laugh-finale");
const renderChatWinReveal = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "win-reveal");
const renderChatBigWinBurst = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "win-big");
const renderChatRoyalCrownWin = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "win-crown");
const renderChatJackpotVictory = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "win-jackpot");
const renderChatMegaWinFinale = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "win-mega");
const renderChatChristmasTree = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "christmas-tree");
const renderChatSnowfallMagic = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "christmas-snow");
const renderChatSantaGift = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "christmas-gift");
const renderChatJingleBells = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "christmas-bells");
const renderChatChristmasFinale = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "christmas-finale");
const renderChatSnowmanBuild = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "snowman-build");
const renderChatSnowstormReveal = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "snowman-storm");
const renderChatTopHatSnowman = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "snowman-hat");
const renderChatSnowmanGift = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "snowman-gift");
const renderChatSnowmanFinale = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "snowman-finale");
const renderChatBombBurst = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "bomb-burst");
const renderChatChainExplosion = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "bomb-chain");
const renderChatElectricBomb = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "bomb-electric");
const renderChatRocketImpact = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "bomb-rocket");
const renderChatMegaExplosion = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "bomb-mega");
const renderChatHandshake = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "friendship-handshake");
const renderChatBestFriends = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "friendship-best");
const renderChatFriendshipHeart = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "friendship-heart");
const renderChatFriendshipStars = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "friendship-stars");
const renderChatFriendshipFinale = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "friendship-finale");
const renderChatDiamondHit = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "premium-diamond");
const renderChatGoldRushPremium = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "premium-gold");
const renderChatCrystalBurstPremium = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "premium-crystal");
const renderChatVipGlowPremium = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "premium-vip");
const renderChatLuxuryJackpotPremium = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "premium-finale");
const renderChatSimpleCelebration = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "celebration-party");
const renderChatSimpleRibbon = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "celebration-ribbon");
const renderChatSimpleBingo = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "bingo-reveal");
const renderChatSimpleBingoLetters = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "bingo-letters");
const renderChatSimpleKiss = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "kiss-simple");
const renderChatSimpleLucky = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "lucky-shamrock");
const renderChatSimpleLuckyPot = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "lucky-pot");
const renderChatSimpleLuckyCoin = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "lucky-coin");
const renderChatSimpleStar = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "star-simple");
const renderChatSimpleFirework = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "firework-simple");
const renderChatSimpleNeon = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "neon-grid");
const renderChatSimpleNeonPulse = (time, seed, timeline) => renderPremiumSocialThemeChatWink(time, seed, timeline, "neon-pulse");

const effects = [
  {
    output: "trh-chat-heavy-confetti-rain.apng",
    previewOutput: "trh-chat-heavy-confetti-rain.png",
    previewFrames: [{ time: 0.28, opacity: 0.86 }, { time: 0.5, opacity: 1 }, { time: 0.7, opacity: 0.24 }],
    render: renderMessengerHeavyConfettiRainWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-party-horn-explosion.apng",
    previewOutput: "trh-chat-party-horn-explosion.png",
    previewFrames: [{ time: 0.22, opacity: 0.82 }, { time: 0.46, opacity: 1 }, { time: 0.68, opacity: 0.22 }],
    render: renderMessengerPartyHornCelebrationWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-celebration-storm.apng",
    previewOutput: "trh-chat-celebration-storm.png",
    previewFrames: [{ time: 0.26, opacity: 0.88 }, { time: 0.56, opacity: 1 }, { time: 0.72, opacity: 0.24 }],
    render: renderMessengerCelebrationStormWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-mega-ribbon-burst.apng",
    previewOutput: "trh-chat-mega-ribbon-burst.png",
    previewFrames: [{ time: 0.3, opacity: 0.8 }, { time: 0.5, opacity: 1 }, { time: 0.7, opacity: 0.24 }],
    render: renderMessengerConfettiBurstFormationWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
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
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerBingoBallChaos,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-gold-star-rain.apng",
    previewOutput: "trh-chat-gold-star-rain.png",
    previewFrames: [{ time: 0.56, opacity: 1 }, { time: 0.7, opacity: 0.22 }],
    render: renderMessengerGoldStarRainWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-star-explosion-burst.apng",
    previewOutput: "trh-chat-star-explosion-burst.png",
    previewFrames: [{ time: 0.28, opacity: 0.76 }, { time: 0.48, opacity: 1 }, { time: 0.7, opacity: 0.24 }],
    render: renderMessengerStarExplosionBurstWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-galaxy-star-storm.apng",
    previewOutput: "trh-chat-galaxy-star-storm.png",
    previewFrames: [{ time: 0.32, opacity: 0.8 }, { time: 0.56, opacity: 1 }, { time: 0.72, opacity: 0.24 }],
    render: renderMessengerGalaxyStarStormWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-mega-star-flash.apng",
    previewOutput: "trh-chat-mega-star-flash.png",
    previewFrames: [{ time: 0.2, opacity: 0.84 }, { time: 0.42, opacity: 1 }, { time: 0.68, opacity: 0.22 }],
    render: renderMessengerMegaStarFlashWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-star-jackpot-blast.apng",
    previewOutput: "trh-chat-star-jackpot-blast.png",
    previewFrames: [{ time: 0.26, opacity: 0.82 }, { time: 0.5, opacity: 1 }, { time: 0.72, opacity: 0.24 }],
    render: renderMessengerStarJackpotBlastWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-firework-celebration-blast.apng",
    previewOutput: "trh-chat-firework-celebration-blast.png",
    previewFrames: [{ time: 0.36, opacity: 0.72 }, { time: 0.56, opacity: 1 }, { time: 0.74, opacity: 0.2 }],
    render: renderMessengerFireworkCelebrationBlastWink,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-classic-bingo-formation.apng",
    previewOutput: "trh-chat-classic-bingo-formation.png",
    previewFrames: [{ time: 0.12, opacity: 1 }, { time: 0.56, opacity: 0.82 }],
    render: renderMessengerClassicBingoFormation,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-jackpot-ball-pop.apng",
    previewOutput: "trh-chat-jackpot-ball-pop.png",
    previewFrames: [{ time: 0.2, opacity: 1 }, { time: 0.56, opacity: 0.82 }],
    render: renderMessengerJackpotBallPop,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-bingo-ball-swirl.apng",
    previewOutput: "trh-chat-bingo-ball-swirl.png",
    previewFrames: [{ time: 0.1, opacity: 1 }, { time: 0.56, opacity: 0.82 }],
    render: renderMessengerBingoBallSwirl,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
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
    output: "trh-chat-big-heart-formation.apng",
    previewOutput: "trh-chat-big-heart-formation.png",
    previewFrames: CALM_HEART_PREVIEW_FRAMES,
    render: renderMessengerBigHeartFormation,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-heart-orbit-love.apng",
    previewOutput: "trh-chat-heart-orbit-love.png",
    previewFrames: [{ time: 0.66, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderMessengerHeartOrbitLove,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-heart-rain-formation.apng",
    previewOutput: "trh-chat-heart-rain-formation.png",
    previewFrames: [{ time: 0.6, opacity: 1 }, { time: 0.72, opacity: 0.22 }],
    render: renderMessengerHeartRainFormation,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-double-heart-pop.apng",
    previewOutput: "trh-chat-double-heart-pop.png",
    previewFrames: [{ time: 0.58, opacity: 1 }, { time: 0.72, opacity: 0.22 }],
    render: renderMessengerDoubleHeartPop,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-hearts-love-explosion.apng",
    previewOutput: "trh-chat-hearts-love-explosion.png",
    previewFrames: [{ time: 0.54, opacity: 1 }, { time: 0.64, opacity: 0.24 }],
    render: renderMessengerHeartsLoveExplosion,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-birthday-cake-formation.apng",
    previewOutput: "trh-chat-birthday-cake-formation.png",
    previewFrames: [{ time: 0.6, opacity: 1 }, { time: 0.72, opacity: 0.22 }],
    render: renderMessengerBirthdayCakeFormation,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-balloon-celebration.apng",
    previewOutput: "trh-chat-balloon-celebration.png",
    previewFrames: [{ time: 0.54, opacity: 1 }, { time: 0.7, opacity: 0.2 }],
    render: renderMessengerBirthdayBalloonCelebration,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-candle-light-wish.apng",
    previewOutput: "trh-chat-candle-light-wish.png",
    previewFrames: [{ time: 0.56, opacity: 1 }, { time: 0.72, opacity: 0.22 }],
    render: renderMessengerBirthdayCandleLightWish,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
    frameStartOffset: 0,
  },
  {
    output: "trh-chat-bingo-confetti-storm.apng",
    previewOutput: "trh-chat-bingo-confetti-storm.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerConfettiStorm,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-golden-heart-rain.apng",
    previewOutput: "trh-chat-golden-heart-rain.png",
    previewFrames: CALM_HEART_PREVIEW_FRAMES,
    render: renderMessengerGoldenHeartRain,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-firework-impact.apng",
    previewOutput: "trh-chat-firework-impact.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerFireworkImpact,
    enhanceOpacity: 0,
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
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerJackpotPop,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-prism-confetti-rush.apng",
    previewOutput: "trh-chat-prism-confetti-rush.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerPrismConfettiRush,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-neon-streamer-drop.apng",
    previewOutput: "trh-chat-neon-streamer-drop.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerNeonStreamerDrop,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-velvet-heart-pulse.apng",
    previewOutput: "trh-chat-velvet-heart-pulse.png",
    previewFrames: CALM_HEART_PREVIEW_FRAMES,
    render: renderMessengerVelvetHeartPulse,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-cupid-spark-drift.apng",
    previewOutput: "trh-chat-cupid-spark-drift.png",
    previewFrames: CALM_HEART_PREVIEW_FRAMES,
    render: renderMessengerCupidSparkDrift,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-starlight-rocket-pop.apng",
    previewOutput: "trh-chat-starlight-rocket-pop.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerStarlightRocketPop,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-aurora-mini-fireworks.apng",
    previewOutput: "trh-chat-aurora-mini-fireworks.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerAuroraMiniFireworks,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-lucky-ball-parade.apng",
    previewOutput: "trh-chat-lucky-ball-parade.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerLuckyBallParade,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-turbo-ball-bounce.apng",
    previewOutput: "trh-chat-turbo-ball-bounce.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerTurboBallBounce,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-clover-starfall.apng",
    previewOutput: "trh-chat-clover-starfall.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerCloverStarfall,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-bonus-spark-shower.apng",
    previewOutput: "trh-chat-bonus-spark-shower.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerBonusSparkShower,
    enhanceOpacity: 0,
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
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerThumbsUpPop,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-double-like-rush.apng",
    previewOutput: "trh-chat-double-like-rush.png",
    previewFrames: CALM_CHAT_PREVIEW_FRAMES,
    render: renderMessengerDoubleLikeRush,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-birthday-cake-pop.apng",
    previewOutput: "trh-chat-birthday-cake-pop.png",
    previewFrames: CALM_BIRTHDAY_PREVIEW_FRAMES,
    render: renderMessengerBirthdayCakePop,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-balloon-wish-burst.apng",
    previewOutput: "trh-chat-balloon-wish-burst.png",
    previewFrames: CALM_BIRTHDAY_PREVIEW_FRAMES,
    render: renderMessengerBalloonWishBurst,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-giant-bingo-reveal.apng",
    previewOutput: "trh-chat-giant-bingo-reveal.png",
    previewFrames: [{ time: 0.18, opacity: 1 }, { time: 0.44, opacity: 0.5 }, { time: 0.68, opacity: 0.22 }],
    render: renderBingoJackpotExplosion,
  },
  {
    output: "trh-chat-giant-kiss-mark-burst.apng",
    previewOutput: "trh-chat-giant-kiss-mark-burst.png",
    previewFrames: [{ time: 0.24, opacity: 0.86 }, { time: 0.48, opacity: 1 }, { time: 0.72, opacity: 0.24 }],
    render: renderMessengerKissMarkBurst,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-kiss-storm.apng",
    previewOutput: "trh-chat-kiss-storm.png",
    previewFrames: [{ time: 0.28, opacity: 0.82 }, { time: 0.52, opacity: 1 }, { time: 0.72, opacity: 0.24 }],
    render: renderMessengerKissStorm,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-shamrock-storm.apng",
    previewOutput: "trh-chat-shamrock-storm.png",
    previewFrames: [{ time: 0.28, opacity: 0.82 }, { time: 0.54, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderMessengerShamrockStorm,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-pot-of-gold-burst.apng",
    previewOutput: "trh-chat-pot-of-gold-burst.png",
    previewFrames: [{ time: 0.24, opacity: 0.86 }, { time: 0.5, opacity: 1 }, { time: 0.74, opacity: 0.24 }],
    render: renderMessengerPotOfGoldBurst,
    enhanceOpacity: 0,
  },
  {
    output: "trh-chat-happy-birthday-reveal.apng",
    previewOutput: "trh-chat-happy-birthday-reveal.png",
    previewFrames: [{ time: 0.34, opacity: 0.9 }, { time: 0.54, opacity: 1 }, { time: 0.72, opacity: 0.24 }],
    render: renderMessengerHappyBirthdayReveal,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-neon-jackpot-grid.apng",
    previewOutput: "trh-chat-neon-jackpot-grid.png",
    previewFrames: [{ time: 0.28, opacity: 0.84 }, { time: 0.52, opacity: 1 }, { time: 0.76, opacity: 0.22 }],
    render: renderMessengerNeonJackpotGrid,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-heavy-confetti-rain.apng",
    previewOutput: "trh-chat-heavy-confetti-rain.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatConfettiRainHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-party-horn-explosion.apng",
    previewOutput: "trh-chat-party-horn-explosion.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatPartyHornHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-giant-bingo-reveal.apng",
    previewOutput: "trh-chat-giant-bingo-reveal.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatBingoRevealHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-classic-bingo-formation.apng",
    previewOutput: "trh-chat-classic-bingo-formation.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatBingoLettersHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-bingo-ball-chaos.apng",
    previewOutput: "trh-chat-bingo-ball-chaos.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatBingoBallsHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-gold-star-rain.apng",
    previewOutput: "trh-chat-gold-star-rain.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatGoldStarRainHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-star-explosion-burst.apng",
    previewOutput: "trh-chat-star-explosion-burst.png",
    previewFrames: [{ time: 0.28, opacity: 0.76 }, { time: 0.48, opacity: 1 }, { time: 0.7, opacity: 0.24 }],
    render: renderChatStarBurstHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-big-heart-formation.apng",
    previewOutput: "trh-chat-big-heart-formation.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatHeartFormationHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-heart-rain-formation.apng",
    previewOutput: "trh-chat-heart-rain-formation.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatHeartRainHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-giant-kiss-mark-burst.apng",
    previewOutput: "trh-chat-giant-kiss-mark-burst.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatKissBurstHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-kiss-storm.apng",
    previewOutput: "trh-chat-kiss-storm.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatKissStormHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-shamrock-storm.apng",
    previewOutput: "trh-chat-shamrock-storm.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatShamrockHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-pot-of-gold-burst.apng",
    previewOutput: "trh-chat-pot-of-gold-burst.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatPotGoldHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-happy-birthday-reveal.apng",
    previewOutput: "trh-chat-happy-birthday-reveal.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatBirthdayTextHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-balloon-celebration.apng",
    previewOutput: "trh-chat-balloon-celebration.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatBirthdayBalloonsHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-birthday-cake-formation.apng",
    previewOutput: "trh-chat-birthday-cake-formation.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatBirthdayCakeHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-thumbs-up-pop.apng",
    previewOutput: "trh-chat-thumbs-up-pop.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatThumbHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-double-like-rush.apng",
    previewOutput: "trh-chat-double-like-rush.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatThumbStormHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-firework-grand-finale.apng",
    previewOutput: "trh-chat-firework-grand-finale.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatFireworkHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
  {
    output: "trh-chat-neon-jackpot-grid.apng",
    previewOutput: "trh-chat-neon-jackpot-grid.png",
    previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
    render: renderChatNeonHero,
    enhanceOpacity: 0,
    disableTimelineAlpha: true,
  },
];

const masterChatPackEffects = [
  ["trh-chat-heavy-confetti-rain.apng", renderChatConfettiRainHero],
  ["trh-chat-party-horn-explosion.apng", renderChatPartyHornHero],
  ["trh-chat-celebration-burst.apng", renderChatSimpleCelebration],
  ["trh-chat-ribbon-celebration.apng", renderChatSimpleRibbon],
  ["trh-chat-firework-celebration.apng", renderChatSimpleFirework],
  ["trh-chat-bingo-ball-bounce.apng", renderChatSimpleBingo],
  ["trh-chat-bingo-formation.apng", renderChatSimpleBingoLetters],
  ["trh-chat-bingo-explosion.apng", renderChatSimpleBingo],
  ["trh-chat-jackpot-bingo-reveal.apng", renderChatSimpleBingo],
  ["trh-chat-mega-bingo-burst.apng", renderChatSimpleBingo],
  ["trh-chat-big-heart-formation.apng", renderMessengerBigHeartFormation],
  ["trh-chat-heart-rain-formation.apng", renderMessengerHeartRainFormation],
  ["trh-chat-double-heart-pop.apng", renderMessengerDoubleHeartPop],
  ["trh-chat-cupid-spark-drift.apng", renderMessengerCupidSparkDrift],
  ["trh-chat-hearts-love-explosion.apng", renderMessengerHeartsLoveExplosion],
  ["trh-chat-giant-kiss-mark-burst.apng", renderMessengerKissMarkBurst],
  ["trh-chat-kiss-storm.apng", renderMessengerKissStorm],
  ["trh-chat-lipstick-explosion.apng", renderChatSimpleKiss],
  ["trh-chat-air-kiss-burst.apng", renderMessengerCupidSparkDrift],
  ["trh-chat-kiss-sparkle-finale.apng", renderChatSimpleKiss],
  ["trh-chat-happy-birthday-reveal.apng", renderMessengerHappyBirthdayReveal],
  ["trh-chat-balloon-celebration.apng", renderMessengerBirthdayBalloonCelebration],
  ["trh-chat-birthday-cake-pop.apng", renderMessengerBirthdayCakePop],
  ["trh-chat-candle-light-wish.apng", renderMessengerBirthdayCandleLightWish],
  ["trh-chat-birthday-finale.apng", renderChatBirthdayTextHero],
  ["trh-chat-thumbs-up-pop.apng", renderMessengerThumbsUpPop],
  ["trh-chat-like-storm.apng", renderMessengerDoubleLikeRush],
  ["trh-chat-mega-approval.apng", renderChatThumbHero],
  ["trh-chat-emoji-bounce.apng", renderChatThumbStormHero],
  ["trh-chat-social-like-finale.apng", renderMessengerDoubleLikeRush],
  ["trh-chat-shamrock-rain.apng", renderChatSimpleLucky],
  ["trh-chat-pot-of-gold-burst.apng", renderChatSimpleLuckyPot],
  ["trh-chat-lucky-coin-explosion.apng", renderChatSimpleLuckyCoin],
  ["trh-chat-rainbow-luck-reveal.apng", renderChatSimpleLucky],
  ["trh-chat-lucky-finale.apng", renderChatSimpleLucky],
  ["trh-chat-gold-star-rain.apng", renderMessengerGoldStarRainWink],
  ["trh-chat-galaxy-stars.apng", renderChatSimpleStar],
  ["trh-chat-star-explosion-burst.apng", renderMessengerStarExplosionBurstWink],
  ["trh-chat-twinkle-formation.apng", renderChatSimpleStar],
  ["trh-chat-golden-star-finale.apng", renderChatSimpleStar],
  ["trh-chat-firework-launch.apng", renderMessengerStarlightRocketPop],
  ["trh-chat-firework-burst.apng", renderChatSimpleFirework],
  ["trh-chat-jackpot-fireworks.apng", renderChatSimpleFirework],
  ["trh-chat-neon-firework-sky.apng", renderChatSimpleFirework],
  ["trh-chat-grand-finale-fireworks.apng", renderChatFireworkHero],
  ["trh-chat-neon-grid.apng", renderChatSimpleNeon],
  ["trh-chat-electric-pulse.apng", renderChatSimpleNeonPulse],
  ["trh-chat-neon-tunnel.apng", renderChatSimpleNeon],
  ["trh-chat-cyber-glow.apng", renderChatSimpleNeon],
  ["trh-chat-neon-jackpot-finale.apng", renderChatSimpleNeon],
  ["trh-chat-rose-bloom.apng", renderChatRoseBloom],
  ["trh-chat-petal-storm.apng", renderChatRosePetalStorm],
  ["trh-chat-rose-heart.apng", renderChatRoseHeart],
  ["trh-chat-golden-rose.apng", renderChatGoldenRose],
  ["trh-chat-rose-finale.apng", renderChatRoseFinale],
  ["trh-chat-giant-clap.apng", renderChatApplauseClap],
  ["trh-chat-standing-ovation.apng", renderChatStandingOvation],
  ["trh-chat-golden-applause.apng", renderChatGoldenApplause],
  ["trh-chat-bravo-burst.apng", renderChatBravoBurst],
  ["trh-chat-applause-finale.apng", renderChatApplauseFinale],
  ["trh-chat-giant-lol.apng", renderChatLaughLol],
  ["trh-chat-emoji-storm.apng", renderChatLaughEmojiStorm],
  ["trh-chat-hahaha-wave.apng", renderChatLaughHaha],
  ["trh-chat-rofl-burst.apng", renderChatLaughRofl],
  ["trh-chat-comedy-finale.apng", renderChatLaughFinale],
  ["trh-chat-win-reveal.apng", renderChatWinReveal],
  ["trh-chat-big-win-burst.apng", renderChatBigWinBurst],
  ["trh-chat-royal-crown-win.apng", renderChatRoyalCrownWin],
  ["trh-chat-jackpot-victory.apng", renderChatJackpotVictory],
  ["trh-chat-mega-win-finale.apng", renderChatMegaWinFinale],
  ["trh-chat-christmas-tree-reveal.apng", renderChatChristmasTree],
  ["trh-chat-snowfall-magic.apng", renderChatSnowfallMagic],
  ["trh-chat-santa-gift-burst.apng", renderChatSantaGift],
  ["trh-chat-jingle-bells.apng", renderChatJingleBells],
  ["trh-chat-christmas-finale.apng", renderChatChristmasFinale],
  ["trh-chat-snowman-build.apng", renderChatSnowmanBuild],
  ["trh-chat-snowstorm-reveal.apng", renderChatSnowstormReveal],
  ["trh-chat-top-hat-pop.apng", renderChatTopHatSnowman],
  ["trh-chat-snowman-gift.apng", renderChatSnowmanGift],
  ["trh-chat-snowman-finale.apng", renderChatSnowmanFinale],
  ["trh-chat-cartoon-bomb-burst.apng", renderChatBombBurst],
  ["trh-chat-chain-explosion.apng", renderChatChainExplosion],
  ["trh-chat-electric-bomb.apng", renderChatElectricBomb],
  ["trh-chat-rocket-impact.apng", renderChatRocketImpact],
  ["trh-chat-mega-explosion-finale.apng", renderChatMegaExplosion],
  ["trh-chat-handshake-reveal.apng", renderChatHandshake],
  ["trh-chat-best-friends-pop.apng", renderChatBestFriends],
  ["trh-chat-friendship-heart.apng", renderChatFriendshipHeart],
  ["trh-chat-friendship-stars.apng", renderChatFriendshipStars],
  ["trh-chat-friendship-finale.apng", renderChatFriendshipFinale],
  ["trh-chat-diamond-hit.apng", renderChatDiamondHit],
  ["trh-chat-gold-rush.apng", renderChatGoldRushPremium],
  ["trh-chat-crystal-burst.apng", renderChatCrystalBurstPremium],
  ["trh-chat-vip-glow.apng", renderChatVipGlowPremium],
  ["trh-chat-luxury-jackpot-finale.apng", renderChatLuxuryJackpotPremium],
].map(([output, render]) => ({
  output,
  previewOutput: output.replace(".apng", ".png"),
  previewFrames: [{ time: 0.34, opacity: 0.86 }, { time: 0.52, opacity: 1 }, { time: 0.74, opacity: 0.22 }],
  render,
  enhanceOpacity: 0,
  disableTimelineAlpha: true,
}));

effects.push(...masterChatPackEffects);

const requestedChatPackOutputs = new Set(masterChatPackEffects.map((effect) => effect.output));

const requestedChatPackPreviews = new Set(
  [...requestedChatPackOutputs].map((output) => output.replace(".apng", ".png")),
);

const writeFileWithRetries = async (filePath, data, attempts = 8) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.writeFile(filePath, data);
      return;
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 + (attempt * 150)));
    }
  }
};

export const regenerateChatApngs = async (rootDir, options = {}) => {
  const winkDir = path.join(rootDir, "public", "winks", "chat");
  const previewDir = path.join(rootDir, "public", "previews", "chat");
  const only = Array.isArray(options.only) && options.only.length > 0
    ? new Set(options.only.map((entry) => entry.toLowerCase()))
    : null;

  await fs.mkdir(winkDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });

  const selectedEffects = only
    ? effects.filter((effect) => only.has(effect.output.toLowerCase()) || only.has(effect.previewOutput.toLowerCase()))
    : effects.filter((effect) => requestedChatPackOutputs.has(effect.output));
  const exportEffectsByOutput = new Map();
  for (const effect of selectedEffects) {
    exportEffectsByOutput.set(effect.output, effect);
  }
  const exportEffects = [...exportEffectsByOutput.values()];

  for (const effect of exportEffects) {
    const enhancementSeed = hashString(effect.output);
    const frameStartOffset = effect.frameStartOffset ?? FRAME_START_OFFSET;
    const frames = Array.from({ length: FRAME_COUNT }, (_, frameIndex) => {
      const time = FRAME_COUNT > 1
        ? mix(frameStartOffset, 1, frameIndex / (FRAME_COUNT - 1))
        : 1;
      return compressRgbaWithEdgeFade(renderEnhancedChatFrame(effect, time, enhancementSeed));
    });

    await writeFileWithRetries(path.join(winkDir, effect.output), buildApng(frames));

    await writeFileWithRetries(path.join(previewDir, effect.previewOutput), buildPng(renderPreviewChatFrame(effect, enhancementSeed)));
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args.slice(onlyIndex + 1).filter(Boolean) : [];
  regenerateChatApngs(process.cwd(), { only });
}
