import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const WIDTH = 1920;
const HEIGHT = 1024;
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

const alphaFromSignedDistance = (signedDistance, feather = 1.25) => {
  if (signedDistance <= -feather) return 1;
  if (signedDistance >= feather) return 0;
  return clamp((feather - signedDistance) / (feather * 2));
};

const drawCircle = (buffer, cx, cy, radius, color, alpha = 1, feather = 1.6) => {
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

const drawRing = (buffer, cx, cy, radius, width, color, alpha = 1, feather = 1.25) => {
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

const drawCapsule = (buffer, ax, ay, bx, by, radius, color, alpha = 1, feather = 1.1) => {
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

const pointInPolygon = (x, y, points) => {
  let inside = false;

  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    const intersects = ((yi > y) !== (yj > y))
      && (x < (((xj - xi) * (y - yi)) / ((yj - yi) || 0.00001)) + xi);

    if (intersects) inside = !inside;
  }

  return inside;
};

const drawPolygon = (buffer, points, color, alpha = 1, feather = 1.1) => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.max(0, Math.floor(Math.min(...xs) - feather));
  const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(...xs) + feather));
  const minY = Math.max(0, Math.floor(Math.min(...ys) - feather));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(...ys) + feather));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let minDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < points.length; index += 1) {
        const [ax, ay] = points[index];
        const [bx, by] = points[(index + 1) % points.length];
        minDistance = Math.min(minDistance, pointToSegmentDistance(x + 0.5, y + 0.5, ax, ay, bx, by));
      }

      const inside = pointInPolygon(x + 0.5, y + 0.5, points);
      const signedDistance = inside ? -minDistance : minDistance;
      const coverage = alphaFromSignedDistance(signedDistance, feather);
      if (coverage > 0) putPixel(buffer, x, y, color, coverage * alpha);
    }
  }
};

const drawDiamond = (buffer, cx, cy, size, angle, color, alpha = 1) => {
  drawRotatedRect(buffer, cx, cy, size, size, angle + (Math.PI / 4), color, alpha);
};

const drawSpark = (buffer, cx, cy, size, color, alpha = 1) => {
  drawCircle(buffer, cx, cy, Math.max(3.2, size * 0.56), color, alpha * 0.1);
  drawCircle(buffer, cx, cy, Math.max(2.4, size * 0.34), color, alpha * 0.14);
  drawCapsule(buffer, cx - size, cy, cx + size, cy, Math.max(1.2, size * 0.14), color, alpha * 0.92);
  drawCapsule(buffer, cx, cy - size, cx, cy + size, Math.max(1.2, size * 0.14), color, alpha * 0.92);
  drawCapsule(
    buffer,
    cx - (size * 0.62),
    cy - (size * 0.62),
    cx + (size * 0.62),
    cy + (size * 0.62),
    Math.max(0.9, size * 0.1),
    color,
    alpha * 0.54,
  );
  drawCapsule(
    buffer,
    cx - (size * 0.62),
    cy + (size * 0.62),
    cx + (size * 0.62),
    cy - (size * 0.62),
    Math.max(0.9, size * 0.1),
    color,
    alpha * 0.54,
  );
  drawCircle(buffer, cx, cy, Math.max(1.4, size * 0.16), color, alpha);
  drawCircle(buffer, cx, cy, Math.max(1.2, size * 0.12), hexToRgb("#fff6d7"), alpha * 0.2);
  drawCircle(buffer, cx, cy, Math.max(0.9, size * 0.08), hexToRgb("#ffffff"), alpha * 0.72);
};

const rotatePoint = (x, y, angle) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [((x * cos) - (y * sin)), ((x * sin) + (y * cos))];
};

const transformPoints = (points, cx, cy, angle) =>
  points.map(([x, y]) => {
    const [rx, ry] = rotatePoint(x, y, angle);
    return [cx + rx, cy + ry];
  });

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
      Math.max(1.4, size * 0.06),
      color,
      alpha,
      1,
    );
  }
};

const drawCoin = (buffer, cx, cy, radius, alpha = 1, rotation = 0) => {
  const gold = hexToRgb("#f5c65b");
  const shadow = hexToRgb("#b98115");
  drawCircle(buffer, cx, cy, radius * 1.46, gold, alpha * 0.1);
  drawCircle(buffer, cx, cy, radius * 1.22, gold, alpha * 0.1);
  drawCircle(buffer, cx, cy, radius, gold, alpha);
  drawRing(buffer, cx, cy, radius * 0.8, Math.max(3, radius * 0.15), shadow, alpha * 0.54);
  drawRing(buffer, cx, cy, radius * 0.94, Math.max(2, radius * 0.08), hexToRgb("#fff2c1"), alpha * 0.72);
  drawCapsule(
    buffer,
    cx - (Math.cos(rotation) * radius * 0.22),
    cy - (Math.sin(rotation) * radius * 0.22),
    cx + (Math.cos(rotation) * radius * 0.22),
    cy + (Math.sin(rotation) * radius * 0.22),
    Math.max(1.4, radius * 0.08),
    shadow,
    alpha * 0.72,
  );
  drawCapsule(
    buffer,
    cx + (Math.sin(rotation) * radius * 0.16),
    cy - (Math.cos(rotation) * radius * 0.16),
    cx - (Math.sin(rotation) * radius * 0.16),
    cy + (Math.cos(rotation) * radius * 0.16),
    Math.max(1.4, radius * 0.08),
    shadow,
    alpha * 0.72,
  );
  drawCircle(buffer, cx - (radius * 0.22), cy - (radius * 0.24), radius * 0.16, hexToRgb("#fff6db"), alpha * 0.42);
  drawCircle(buffer, cx + (radius * 0.18), cy + (radius * 0.12), radius * 0.08, hexToRgb("#fffef1"), alpha * 0.22);
};

const drawBingoBall = (buffer, cx, cy, radius, bodyColor, digit, alpha = 1) => {
  drawCircle(buffer, cx, cy, radius * 1.42, bodyColor, alpha * 0.08);
  drawCircle(buffer, cx, cy, radius * 1.18, bodyColor, alpha * 0.1);
  drawCircle(buffer, cx, cy, radius, bodyColor, alpha);
  drawRing(buffer, cx, cy, radius * 0.92, Math.max(3, radius * 0.08), hexToRgb("#fffdf5"), alpha * 0.65);
  drawCircle(buffer, cx - (radius * 0.22), cy - (radius * 0.24), radius * 0.18, hexToRgb("#ffffff"), alpha * 0.22);
  drawCircle(buffer, cx, cy, radius * 0.44, hexToRgb("#ffffff"), alpha * 0.94);
  drawRing(buffer, cx, cy, radius * 0.44, Math.max(2, radius * 0.06), bodyColor, alpha * 0.6);
  drawDigit(buffer, cx, cy, radius * 0.92, digit, hexToRgb("#151515"), alpha * 0.92);
  drawCircle(buffer, cx + (radius * 0.14), cy + (radius * 0.18), radius * 0.08, hexToRgb("#fffef6"), alpha * 0.16);
};

const drawBingoPlainBall = (buffer, cx, cy, radius, bodyColor, alpha = 1) => {
  drawCircle(buffer, cx, cy, radius * 1.42, bodyColor, alpha * 0.08);
  drawCircle(buffer, cx, cy, radius * 1.18, bodyColor, alpha * 0.1);
  drawCircle(buffer, cx, cy, radius, bodyColor, alpha);
  drawRing(buffer, cx, cy, radius * 0.92, Math.max(3, radius * 0.08), hexToRgb("#fffdf5"), alpha * 0.65);
  drawCircle(buffer, cx - (radius * 0.22), cy - (radius * 0.24), radius * 0.18, hexToRgb("#ffffff"), alpha * 0.22);
  drawCircle(buffer, cx, cy, radius * 0.44, hexToRgb("#ffffff"), alpha * 0.94);
  drawRing(buffer, cx, cy, radius * 0.44, Math.max(2, radius * 0.06), bodyColor, alpha * 0.6);
};

const LETTER_STROKES = {
  B: [[[0.3, -0.5], [0.3, 0.5]], [[0.3, -0.5], [0.0, -0.5], [-0.16, -0.34], [0.0, -0.16], [0.3, -0.16]], [[0.3, -0.16], [0.0, -0.16], [-0.18, 0.02], [0.0, 0.22], [0.3, 0.22]], [[0.3, 0.22], [0.3, 0.5]]],
  I: [[[0, -0.5], [0, 0.5]], [[-0.24, -0.5], [0.24, -0.5]], [[-0.24, 0.5], [0.24, 0.5]]],
  N: [[[-0.28, 0.5], [-0.28, -0.5]], [[-0.28, -0.5], [0.28, 0.5]], [[0.28, 0.5], [0.28, -0.5]]],
  G: [[[0.28, -0.36], [0.04, -0.5], [-0.28, -0.36], [-0.34, 0.16], [-0.1, 0.5], [0.28, 0.38]], [[0.28, 0.38], [0.28, 0.1], [0.02, 0.1]]],
  O: [[[0, -0.5], [0.28, -0.36], [0.34, 0], [0.28, 0.36], [0, 0.5], [-0.28, 0.36], [-0.34, 0], [-0.28, -0.36], [0, -0.5]]],
};

const drawBingoLetter = (buffer, cx, cy, radius, letter, alpha = 1) => {
  const strokes = LETTER_STROKES[letter] ?? LETTER_STROKES.O;
  const size = radius * 0.64;
  for (const stroke of strokes) {
    const points = stroke.map(([x, y]) => [cx + (x * size), cy + (y * size)]);
    drawPolyline(buffer, points, Math.max(2.8, radius * 0.055), hexToRgb("#151515"), alpha * 0.9);
  }
};

const drawBingoLetterBall = (buffer, cx, cy, radius, bodyColor, letter, alpha = 1) => {
  drawBingoPlainBall(buffer, cx, cy, radius, bodyColor, alpha);
  drawBingoLetter(buffer, cx, cy, radius, letter, alpha);
  drawCircle(buffer, cx + (radius * 0.14), cy + (radius * 0.18), radius * 0.08, hexToRgb("#fffef6"), alpha * 0.16);
};

const drawPolyline = (buffer, points, radius, color, alpha = 1) => {
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[index + 1];
    drawCapsule(buffer, ax, ay, bx, by, radius, color, alpha);
  }
};

const drawRibbonTrail = (buffer, points, glowColor, coreColor, alpha = 1) => {
  drawPolyline(buffer, points, 7.8, glowColor, alpha * 0.18);
  drawPolyline(buffer, points, 3.2, coreColor, alpha * 0.9);
  const [tipX, tipY] = points[points.length - 1];
  drawSpark(buffer, tipX, tipY, 10, coreColor, alpha * 0.4);
};

const drawPartyHorn = (buffer, cx, cy, length, angle, bodyColor, stripeColor, accentColor, alpha = 1) => {
  const bodyHeight = length * 0.22;
  const bodyPoints = transformPoints([
    [-(length * 0.52), -(bodyHeight * 0.5)],
    [-(length * 0.1), -(bodyHeight * 0.34)],
    [length * 0.32, -(bodyHeight * 0.18)],
    [length * 0.56, -(bodyHeight * 0.06)],
    [length * 0.64, 0],
    [length * 0.56, bodyHeight * 0.06],
    [length * 0.32, bodyHeight * 0.18],
    [-(length * 0.1), bodyHeight * 0.34],
    [-(length * 0.52), bodyHeight * 0.5],
    [-(length * 0.38), 0],
  ], cx, cy, angle);

  drawPolygon(buffer, bodyPoints, accentColor, alpha * 0.12, 2.2);
  drawPolygon(buffer, bodyPoints, bodyColor, alpha * 0.96, 1.4);

  for (let index = 0; index < bodyPoints.length; index += 1) {
    const [ax, ay] = bodyPoints[index];
    const [bx, by] = bodyPoints[(index + 1) % bodyPoints.length];
    drawCapsule(buffer, ax, ay, bx, by, 2.4, accentColor, alpha * 0.34);
  }

  const mouth = rotatePoint(-(length * 0.5), 0, angle);
  drawCircle(buffer, cx + mouth[0], cy + mouth[1], length * 0.09, hexToRgb("#11182b"), alpha * 0.68);
  drawRing(buffer, cx + mouth[0], cy + mouth[1], length * 0.09, Math.max(3, length * 0.026), accentColor, alpha * 0.36);

  const stripeOffsets = [-(length * 0.18), length * 0.03, length * 0.22];
  for (const offset of stripeOffsets) {
    const [sx, sy] = rotatePoint(offset, 0, angle);
    drawRotatedRect(buffer, cx + sx, cy + sy, length * 0.11, bodyHeight * 0.82, angle - 0.3, stripeColor, alpha * 0.82);
  }

  const tip = rotatePoint(length * 0.6, 0, angle);
  const flareA = [
    [cx + tip[0], cy + tip[1]],
    [cx + tip[0] + (Math.cos(angle - 0.2) * length * 0.18), cy + tip[1] + (Math.sin(angle - 0.2) * length * 0.18)],
    [cx + tip[0] + (Math.cos(angle + 0.12) * length * 0.3), cy + tip[1] + (Math.sin(angle + 0.12) * length * 0.3)],
  ];
  const flareB = [
    [cx + tip[0], cy + tip[1]],
    [cx + tip[0] + (Math.cos(angle + 0.14) * length * 0.15), cy + tip[1] + (Math.sin(angle + 0.14) * length * 0.15)],
    [cx + tip[0] + (Math.cos(angle - 0.08) * length * 0.26), cy + tip[1] + (Math.sin(angle - 0.08) * length * 0.26)],
  ];
  const flareC = [
    [cx + tip[0], cy + tip[1]],
    [cx + tip[0] + (Math.cos(angle + 0.22) * length * 0.12), cy + tip[1] + (Math.sin(angle + 0.22) * length * 0.12)],
    [cx + tip[0] + (Math.cos(angle + 0.02) * length * 0.22), cy + tip[1] + (Math.sin(angle + 0.02) * length * 0.22)],
  ];

  drawRibbonTrail(buffer, flareA, accentColor, stripeColor, alpha * 0.8);
  drawRibbonTrail(buffer, flareB, accentColor, palette.white, alpha * 0.74);
  drawRibbonTrail(buffer, flareC, accentColor, bodyColor, alpha * 0.72);
  drawSpark(buffer, cx + tip[0], cy + tip[1], 12, palette.white, alpha * 0.42);
};

const drawLightning = (buffer, cx, cy, scale, color, accent, rotation = 0, alpha = 1) => {
  const points = [
    [-150, -180],
    [-40, -30],
    [-95, 30],
    [20, 145],
    [-30, 255],
    [120, 90],
    [65, -10],
    [165, -145],
  ].map(([x, y]) => {
    const rx = (x * Math.cos(rotation)) - (y * Math.sin(rotation));
    const ry = (x * Math.sin(rotation)) + (y * Math.cos(rotation));
    return [cx + (rx * scale), cy + (ry * scale)];
  });

  drawPolyline(buffer, points, 7 * scale, accent, alpha * 0.28);
  drawPolyline(buffer, points, 3 * scale, color, alpha * 0.96);
  for (const [x, y] of points) {
    drawCircle(buffer, x, y, 6 * scale, accent, alpha * 0.12);
  }
};

const drawBalloon = (buffer, cx, cy, radius, bodyColor, accentColor, alpha = 1) => {
  drawCircle(buffer, cx, cy - (radius * 0.04), radius * 1.3, accentColor, alpha * 0.08, radius * 0.3);
  drawCircle(buffer, cx, cy, radius, bodyColor, alpha, radius * 0.22);
  drawRing(buffer, cx, cy, radius * 0.9, Math.max(3, radius * 0.08), hexToRgb("#ffffff"), alpha * 0.28);
  drawCircle(buffer, cx - (radius * 0.24), cy - (radius * 0.3), radius * 0.18, hexToRgb("#ffffff"), alpha * 0.24);
  drawDiamond(buffer, cx, cy + (radius * 0.98), radius * 0.26, 0, accentColor, alpha * 0.78);
  drawCapsule(buffer, cx, cy + (radius * 1.08), cx - (radius * 0.06), cy + (radius * 1.52), Math.max(1.4, radius * 0.04), hexToRgb("#ffffff"), alpha * 0.24);
  drawCapsule(buffer, cx - (radius * 0.06), cy + (radius * 1.52), cx + (radius * 0.04), cy + (radius * 1.94), Math.max(1.2, radius * 0.036), accentColor, alpha * 0.16);
};

const drawCandle = (buffer, cx, cy, height, bodyColor, stripeColor, flameColor, alpha = 1) => {
  const width = height * 0.18;
  drawRotatedRect(buffer, cx, cy, width, height, 0, bodyColor, alpha, 1.4);
  drawRotatedRect(buffer, cx - (width * 0.12), cy, width * 0.2, height * 0.88, -0.14, stripeColor, alpha * 0.76, 1.1);
  drawRotatedRect(buffer, cx + (width * 0.1), cy, width * 0.18, height * 0.84, -0.14, stripeColor, alpha * 0.68, 1.1);
  drawCapsule(buffer, cx, cy - (height * 0.52), cx, cy - (height * 0.66), Math.max(1.2, width * 0.08), hexToRgb("#6f4120"), alpha * 0.88);

  const flamePoints = transformPoints([
    [0, -(height * 0.22)],
    [width * 0.16, -(height * 0.08)],
    [width * 0.12, height * 0.06],
    [0, height * 0.18],
    [-(width * 0.12), height * 0.06],
    [-(width * 0.16), -(height * 0.08)],
  ], cx, cy - (height * 0.8), 0);
  const flameCore = transformPoints([
    [0, -(height * 0.12)],
    [width * 0.07, -(height * 0.02)],
    [width * 0.05, height * 0.04],
    [0, height * 0.1],
    [-(width * 0.05), height * 0.04],
    [-(width * 0.07), -(height * 0.02)],
  ], cx, cy - (height * 0.8), 0);

  drawCircle(buffer, cx, cy - (height * 0.8), width * 0.86, flameColor, alpha * 0.18, width * 0.4);
  drawPolygon(buffer, flamePoints, flameColor, alpha * 0.96, 1.2);
  drawPolygon(buffer, flameCore, hexToRgb("#ffffff"), alpha * 0.28, 1.1);
};

const drawBirthdayCake = (buffer, cx, cy, scale = 1, alpha = 1) => {
  const pink = hexToRgb("#ff8fcf");
  const pinkDeep = hexToRgb("#ff63c7");
  const gold = hexToRgb("#f5c65b");
  const icing = hexToRgb("#fff6ea");
  const icingWarm = hexToRgb("#fff0b8");
  const blue = hexToRgb("#9fdcff");

  drawCircle(buffer, cx, cy + (20 * scale), 220 * scale, pinkDeep, alpha * 0.08, 72 * scale);
  drawCircle(buffer, cx + (24 * scale), cy + (6 * scale), 176 * scale, gold, alpha * 0.08, 64 * scale);
  drawCapsule(buffer, cx - (230 * scale), cy + (168 * scale), cx + (230 * scale), cy + (168 * scale), 32 * scale, blue, alpha * 0.94);
  drawCapsule(buffer, cx - (180 * scale), cy + (154 * scale), cx + (180 * scale), cy + (154 * scale), 10 * scale, hexToRgb("#ffffff"), alpha * 0.22);

  drawCapsule(buffer, cx - (205 * scale), cy + (74 * scale), cx + (205 * scale), cy + (74 * scale), 72 * scale, pink, alpha * 0.96);
  drawRotatedRect(buffer, cx - (110 * scale), cy + (52 * scale), 100 * scale, 122 * scale, -0.08, hexToRgb("#ffffff"), alpha * 0.1, 12 * scale);
  const lowerIcing = transformPoints([
    [-(205 * scale), -(16 * scale)],
    [-(150 * scale), -(18 * scale)],
    [-(118 * scale), 12 * scale],
    [-(74 * scale), -(14 * scale)],
    [-(18 * scale), 18 * scale],
    [34 * scale, -(12 * scale)],
    [92 * scale, 16 * scale],
    [148 * scale, -(14 * scale)],
    [205 * scale, -(18 * scale)],
    [205 * scale, 42 * scale],
    [-(205 * scale), 42 * scale],
  ], cx, cy + (10 * scale), 0);
  drawPolygon(buffer, lowerIcing, icing, alpha * 0.98, 1.3);

  drawCapsule(buffer, cx - (143 * scale), cy - (34 * scale), cx + (143 * scale), cy - (34 * scale), 56 * scale, gold, alpha * 0.96);
  drawRotatedRect(buffer, cx - (62 * scale), cy - (44 * scale), 82 * scale, 84 * scale, -0.1, hexToRgb("#ffffff"), alpha * 0.1, 10 * scale);
  const upperIcing = transformPoints([
    [-(144 * scale), -(12 * scale)],
    [-(108 * scale), -(14 * scale)],
    [-(78 * scale), 10 * scale],
    [-(42 * scale), -(8 * scale)],
    [-(8 * scale), 14 * scale],
    [28 * scale, -(10 * scale)],
    [72 * scale, 12 * scale],
    [110 * scale, -(10 * scale)],
    [144 * scale, -(12 * scale)],
    [144 * scale, 32 * scale],
    [-(144 * scale), 32 * scale],
  ], cx, cy - (86 * scale), 0);
  drawPolygon(buffer, upperIcing, icingWarm, alpha * 0.98, 1.3);
  drawCapsule(buffer, cx - (104 * scale), cy - (110 * scale), cx + (104 * scale), cy - (110 * scale), 17 * scale, icingWarm, alpha * 0.96);

  for (let sprinkle = 0; sprinkle < 8; sprinkle += 1) {
    const sx = cx - (132 * scale) + (sprinkle * 34 * scale);
    const sy = cy - (58 * scale) + (((sprinkle % 2) * 18) * scale);
    drawRotatedRect(buffer, sx, sy, 18 * scale, 6 * scale, sprinkle * 0.42, sprinkle % 3 === 0 ? gold : sprinkle % 3 === 1 ? pinkDeep : hexToRgb("#58c7ff"), alpha * 0.84, 1.1);
  }
};

const drawBirthdayHbdAccent = (buffer, cx, cy, scale = 1, color = hexToRgb("#fff7dc"), accent = hexToRgb("#ff63c7"), alpha = 1) => {
  const stroke = (ax, ay, bx, by, glow = 18, core = 8) => {
    drawCapsule(buffer, cx + (ax * scale), cy + (ay * scale), cx + (bx * scale), cy + (by * scale), glow * scale, accent, alpha * 0.1);
    drawCapsule(buffer, cx + (ax * scale), cy + (ay * scale), cx + (bx * scale), cy + (by * scale), core * scale, color, alpha * 0.92);
  };

  const letterSpacing = 128 * scale;

  stroke(-150, -28, -150, 28);
  stroke(-106, -28, -106, 28);
  stroke(-146, 0, -110, 0);

  stroke(-24, -30, -24, 30);
  stroke(-18, -28, 10, -28);
  stroke(10, -28, 22, -14);
  stroke(22, -14, 22, -2);
  stroke(-18, 0, 12, 0);
  stroke(12, 0, 24, 12);
  stroke(24, 12, 24, 26);
  stroke(-18, 30, 10, 30);

  stroke(106, -30, 106, 30);
  stroke(112, -28, 144, -28);
  stroke(144, -28, 162, -12);
  stroke(162, -12, 162, 14);
  stroke(162, 14, 144, 30);
  stroke(112, 30, 144, 30);

  drawSpark(buffer, cx + (212 * scale), cy - (34 * scale), 14 * scale, color, alpha * 0.36);
};

const drawGiftBox = (buffer, cx, cy, size = 260, alpha = 1) => {
  const pink = hexToRgb("#ff63c7");
  const gold = hexToRgb("#f5c65b");
  const white = hexToRgb("#ffffff");
  drawCircle(buffer, cx, cy + size * 0.14, size * 0.9, gold, alpha * 0.08, 80);
  drawRotatedRect(buffer, cx, cy + size * 0.12, size * 1.36, size * 0.86, 0, pink, alpha * 0.96, size * 0.08);
  drawRotatedRect(buffer, cx, cy - size * 0.28, size * 1.5, size * 0.28, 0, pink, alpha * 0.98, size * 0.08);
  drawRotatedRect(buffer, cx, cy + size * 0.08, size * 0.2, size * 1.12, 0, gold, alpha * 0.96, size * 0.03);
  drawRotatedRect(buffer, cx, cy + size * 0.1, size * 1.48, size * 0.18, 0, gold, alpha * 0.96, size * 0.03);
  drawPolygon(buffer, transformPoints([[0, 0], [-size * 0.38, -size * 0.2], [-size * 0.56, size * 0.04], [-size * 0.16, size * 0.13]], cx - size * 0.06, cy - size * 0.48, 0), gold, alpha * 0.94, 1.2);
  drawPolygon(buffer, transformPoints([[0, 0], [size * 0.38, -size * 0.2], [size * 0.56, size * 0.04], [size * 0.16, size * 0.13]], cx + size * 0.06, cy - size * 0.48, 0), gold, alpha * 0.94, 1.2);
  drawRotatedRect(buffer, cx - size * 0.34, cy + size * 0.08, size * 0.24, size * 0.68, -0.08, white, alpha * 0.12, size * 0.06);
  drawSpark(buffer, cx + size * 0.52, cy - size * 0.44, size * 0.1, white, alpha * 0.36);
};

const drawBirthdayCandle = (buffer, cx, cy, height = 150, body = hexToRgb("#ff63c7"), alpha = 1) => {
  const width = height * 0.16;
  drawCircle(buffer, cx, cy - height * 0.64, height * 0.24, hexToRgb("#fff1b4"), alpha * 0.18, 48);
  drawRotatedRect(buffer, cx, cy, width, height, 0, body, alpha * 0.96, width * 0.25);
  drawCapsule(buffer, cx - width * 0.12, cy - height * 0.42, cx + width * 0.12, cy + height * 0.42, width * 0.12, hexToRgb("#ffffff"), alpha * 0.42);
  drawCapsule(buffer, cx, cy - height * 0.52, cx, cy - height * 0.68, width * 0.08, hexToRgb("#6f4120"), alpha * 0.8);
  drawPolygon(buffer, transformPoints([[0, -height * 0.18], [width * 0.38, height * 0.02], [0, height * 0.2], [-width * 0.38, height * 0.02]], cx, cy - height * 0.82, 0), hexToRgb("#f5c65b"), alpha * 0.96, 1.1);
  drawCircle(buffer, cx, cy - height * 0.82, width * 0.14, hexToRgb("#ffffff"), alpha * 0.34);
};

const BIRTHDAY_LETTERS = {
  A: [[[0, -0.5], [-0.32, 0.5]], [[0, -0.5], [0.32, 0.5]], [[-0.18, 0.1], [0.18, 0.1]]],
  B: [[[-0.28, -0.5], [-0.28, 0.5]], [[-0.28, -0.5], [0.12, -0.48], [0.28, -0.26], [0.08, -0.04], [-0.28, -0.04]], [[-0.28, -0.04], [0.14, -0.02], [0.3, 0.22], [0.1, 0.48], [-0.28, 0.5]]],
  D: [[[-0.28, -0.5], [-0.28, 0.5]], [[-0.28, -0.5], [0.18, -0.42], [0.34, 0], [0.18, 0.42], [-0.28, 0.5]]],
  H: [[[-0.32, -0.5], [-0.32, 0.5]], [[0.32, -0.5], [0.32, 0.5]], [[-0.3, 0], [0.3, 0]]],
  I: [[[0, -0.5], [0, 0.5]], [[-0.22, -0.5], [0.22, -0.5]], [[-0.22, 0.5], [0.22, 0.5]]],
  P: [[[-0.28, -0.5], [-0.28, 0.5]], [[-0.28, -0.5], [0.16, -0.48], [0.3, -0.22], [0.08, 0.02], [-0.28, 0.02]]],
  R: [[[-0.28, -0.5], [-0.28, 0.5]], [[-0.28, -0.5], [0.16, -0.48], [0.3, -0.22], [0.08, 0.02], [-0.28, 0.02]], [[-0.02, 0.04], [0.32, 0.5]]],
  T: [[[-0.34, -0.5], [0.34, -0.5]], [[0, -0.5], [0, 0.5]]],
  Y: [[[-0.34, -0.5], [0, -0.04]], [[0.34, -0.5], [0, -0.04]], [[0, -0.04], [0, 0.5]]],
};

const drawStrokeLetter = (buffer, letter, cx, cy, size, color, alpha = 1, width = 5) => {
  for (const stroke of BIRTHDAY_LETTERS[letter] ?? []) {
    const points = stroke.map(([x, y]) => [cx + x * size, cy + y * size]);
    drawPolyline(buffer, points, width, color, alpha);
  }
};

const drawBirthdayHeroText = (buffer, cx, cy, scale = 1, accent = palette.pink) => {
  const gold = palette.goldLight;
  const white = palette.white;
  drawCircle(buffer, cx, cy + 18 * scale, 380 * scale, accent, 0.08, 120 * scale);
  drawCircle(buffer, cx, cy + 28 * scale, 290 * scale, palette.gold, 0.06, 100 * scale);
  const drawWord = (word, y, size, gap) => {
    const total = (word.length - 1) * gap;
    for (let index = 0; index < word.length; index += 1) {
      const x = cx - total * 0.5 + index * gap;
      drawStrokeLetter(buffer, word[index], x, y, size, accent, 0.28, 12 * scale);
      drawStrokeLetter(buffer, word[index], x, y, size, white, 0.82, 5.6 * scale);
      drawStrokeLetter(buffer, word[index], x, y, size, gold, 0.92, 3.2 * scale);
    }
  };
  drawWord("HAPPY", cy - 58 * scale, 96 * scale, 86 * scale);
  drawWord("BIRTHDAY", cy + 62 * scale, 82 * scale, 72 * scale);
  drawRibbonTrail(buffer, [[cx - 360 * scale, cy - 110 * scale], [cx, cy - 12 * scale], [cx + 370 * scale, cy + 100 * scale]], white, gold, 0.34);
  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * TAU;
    const distance = 210 * scale + (i % 4) * 48 * scale;
    drawSpark(buffer, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.55, 7 * scale + (i % 3) * 2, i % 2 === 0 ? white : gold, 0.28);
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

const buildPng = (rgba) => {
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  parts.push(chunk("IHDR", ihdr));
  parts.push(chunk("IDAT", zlib.deflateSync(buildScanlines(rgba), { level: 9 })));
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
};

const drawFirework = (buffer, cx, cy, radius, rayCount, color, accent, alpha = 1) => {
  for (let ray = 0; ray < rayCount; ray += 1) {
    const angle = (ray / rayCount) * TAU;
    const outerX = cx + (Math.cos(angle) * radius);
    const outerY = cy + (Math.sin(angle) * radius);
    drawCapsule(buffer, cx, cy, outerX, outerY, 5.2, color, alpha * 0.46);
    drawCapsule(buffer, cx, cy, outerX, outerY, 1.9, accent, alpha * 0.9);
    drawCapsule(buffer, cx + (Math.cos(angle) * radius * 0.18), cy + (Math.sin(angle) * radius * 0.18), cx + (Math.cos(angle) * radius * 0.72), cy + (Math.sin(angle) * radius * 0.72), 2.5, accent, alpha * 0.34);
    drawCapsule(buffer, cx + (Math.cos(angle) * radius * 0.26), cy + (Math.sin(angle) * radius * 0.26), cx + (Math.cos(angle) * radius * 0.94), cy + (Math.sin(angle) * radius * 0.94), 1.1, hexToRgb("#ffffff"), alpha * 0.16);
    drawCircle(buffer, outerX, outerY, 7, accent, alpha * 0.76);
  }
  drawSpark(buffer, cx, cy, 20, accent, alpha * 0.42);
};

const palette = {
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  orange: hexToRgb("#ff9c36"),
  pink: hexToRgb("#ff4fd8"),
  blue: hexToRgb("#58c7ff"),
  purple: hexToRgb("#8f5bff"),
  white: hexToRgb("#ffffff"),
  green: hexToRgb("#23bf66"),
};

const ballPalette = [
  { color: hexToRgb("#ff6e2e"), digit: 7 },
  { color: hexToRgb("#7a44ff"), digit: 8 },
  { color: hexToRgb("#2f86ff"), digit: 3 },
  { color: hexToRgb("#23bf66"), digit: 9 },
  { color: hexToRgb("#f5c65b"), digit: 1 },
];

const renderMegaJackpot = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(11);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.68;

  for (let beam = 0; beam < 8; beam += 1) {
    const angle = (-0.56 + ((beam / 7) * 1.12));
    const length = 320 + ((beam % 4) * 72);
    drawCapsule(
      rgba,
      originX,
      originY,
      originX + (Math.sin(angle) * 110),
      originY - length,
      10 + (beam % 3),
      [palette.gold, palette.orange, palette.white][beam % 3],
      0.1,
    );
  }

  drawFirework(rgba, 340, 250, 138, 14, palette.pink, palette.white, 0.74);
  drawFirework(rgba, 1580, 260, 148, 14, palette.blue, palette.white, 0.74);

  const heroBalls = [
    [520, 548, 94, ballPalette[4]],
    [1360, 516, 104, ballPalette[0]],
    [960, 602, 88, ballPalette[1]],
  ];

  for (const [x, y, radius, ball] of heroBalls) {
    drawBingoBall(rgba, x, y, radius, ball.color, ball.digit, 0.98);
  }

  for (let coin = 0; coin < 12; coin += 1) {
    const angle = (-Math.PI * 0.74) + (rng() * (Math.PI * 0.48));
    const distance = 240 + (rng() * 520);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY + (Math.sin(angle) * distance * 0.58);
    const radius = 18 + (rng() * 20);
    drawCoin(rgba, x, y, radius, 0.88, rng() * TAU);
  }

  for (let spark = 0; spark < 26; spark += 1) {
    const angle = (spark / 26) * TAU;
    const distance = 130 + ((spark % 5) * 38);
    drawSpark(
      rgba,
      originX + (Math.cos(angle) * distance),
      originY + (Math.sin(angle) * distance * 0.62),
      8 + (spark % 3),
      spark % 2 === 0 ? palette.goldLight : palette.white,
      0.4,
    );
  }

  drawRing(rgba, originX, originY, 200, 12, palette.gold, 0.16);
  drawRing(rgba, originX, originY, 286, 8, palette.white, 0.08);
  drawSpark(rgba, originX, originY, 24, palette.white, 0.5);
  return rgba;
};

const renderGrandFireworks = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawFirework(rgba, 360, 250, 180, 18, palette.blue, palette.white, 0.94);
  drawFirework(rgba, 780, 320, 210, 20, palette.purple, palette.pink, 0.92);
  drawFirework(rgba, 1160, 210, 226, 20, palette.gold, palette.goldLight, 0.96);
  drawFirework(rgba, 1560, 290, 188, 18, palette.pink, palette.white, 0.9);

  const launchers = [
    [340, 980, 360, 440],
    [760, 980, 780, 520],
    [1130, 980, 1160, 430],
    [1520, 980, 1560, 510],
  ];

  for (const [ax, ay, bx, by] of launchers) {
    drawCapsule(rgba, ax, ay, bx, by, 6, palette.gold, 0.42);
    drawCapsule(rgba, ax, ay, bx, by, 2.4, palette.goldLight, 0.78);
  }

  return rgba;
};

const renderGoldenExplosion = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(74);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.5;

  for (let shard = 0; shard < 44; shard += 1) {
    const angle = (shard / 44) * TAU;
    const distance = 120 + (rng() * 660);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY + (Math.sin(angle) * distance * 0.74);
    drawDiamond(rgba, x, y, 26 + (rng() * 28), angle, shard % 2 === 0 ? palette.gold : palette.orange, 0.92);
  }

  for (let beam = 0; beam < 30; beam += 1) {
    const angle = (beam / 30) * TAU;
    const outerX = originX + (Math.cos(angle) * 410);
    const outerY = originY + (Math.sin(angle) * 410 * 0.72);
    drawCapsule(rgba, originX, originY, outerX, outerY, 10, palette.gold, 0.24);
    drawCapsule(rgba, originX, originY, outerX, outerY, 3, palette.goldLight, 0.86);
  }

  for (let coin = 0; coin < 14; coin += 1) {
    const angle = (-Math.PI * 0.96) + (rng() * (Math.PI * 1.92));
    const distance = 160 + (rng() * 580);
    drawCoin(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.74), 18 + (rng() * 22), 0.94, rng() * TAU);
  }

  for (let spark = 0; spark < 54; spark += 1) {
    const angle = (spark / 54) * TAU;
    const distance = 120 + ((spark % 5) * 68);
    drawSpark(
      rgba,
      originX + (Math.cos(angle) * distance),
      originY + (Math.sin(angle) * distance * 0.72),
      12 + (spark % 4),
      spark % 2 === 0 ? palette.goldLight : palette.orange,
      0.56,
    );
  }

  drawCircle(rgba, originX, originY, 48, palette.goldLight, 0.56);
  drawRing(rgba, originX, originY, 164, 10, palette.gold, 0.2);
  drawRing(rgba, originX, originY, 268, 10, palette.orange, 0.1);
  return rgba;
};

const renderBingoStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const placements = [
    [360, 328, 74, ballPalette[0]],
    [750, 580, 92, ballPalette[2]],
    [1180, 380, 78, ballPalette[1]],
    [1480, 270, 70, ballPalette[3]],
    [1660, 676, 56, ballPalette[4]],
    [960, 520, 112, ballPalette[1]],
    [520, 620, 84, ballPalette[2]],
    [1410, 598, 90, ballPalette[3]],
  ];

  for (const [x, y, radius, ball] of placements) {
    drawBingoBall(rgba, x, y, radius, ball.color, ball.digit, 0.98);
    drawSpark(rgba, x + (radius * 0.76), y - (radius * 0.72), 10, palette.white, 0.42);
  }

  drawLightning(rgba, 520, 310, 1.08, palette.white, palette.blue, -0.2, 0.92);
  drawLightning(rgba, 1420, 280, 1.12, palette.white, palette.purple, 0.24, 0.92);
  drawLightning(rgba, 990, 640, 0.82, palette.white, palette.blue, 0.1, 0.72);
  drawLightning(rgba, 340, 560, 0.86, palette.white, palette.blue, -0.28, 0.78);
  drawLightning(rgba, 1590, 560, 0.84, palette.white, palette.purple, 0.22, 0.76);

  drawRing(rgba, 960, 530, 184, 12, palette.blue, 0.18);
  drawRing(rgba, 960, 530, 288, 10, palette.purple, 0.12);

  for (let spark = 0; spark < 44; spark += 1) {
    const angle = (spark / 44) * TAU;
    const distance = 150 + ((spark % 6) * 58);
    drawSpark(
      rgba,
      960 + (Math.cos(angle) * distance),
      530 + (Math.sin(angle) * distance * 0.6),
      10 + (spark % 5),
      spark % 2 === 0 ? palette.blue : palette.pink,
      0.42,
    );
  }

  return rgba;
};

const renderCelebrationFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(109);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.64;

  for (let beam = 0; beam < 18; beam += 1) {
    const angle = -0.86 + ((beam / 17) * 1.72);
    const length = 340 + ((beam % 5) * 118);
    const beamColor = [palette.gold, palette.blue, palette.pink, palette.purple][beam % 4];
    const accent = beam % 2 === 0 ? palette.goldLight : palette.white;
    drawCapsule(
      rgba,
      originX + (Math.sin(angle) * 44),
      originY,
      originX + (Math.sin(angle) * 160),
      originY - length,
      15 + ((beam % 4) * 3),
      beamColor,
      0.12,
    );
    drawCapsule(
      rgba,
      originX + (Math.sin(angle) * 44),
      originY,
      originX + (Math.sin(angle) * 140),
      originY - (length * 0.94),
      4.6,
      accent,
      0.24,
    );
  }

  for (let beam = 0; beam < 10; beam += 1) {
    const angle = -0.78 + ((beam / 9) * 1.56);
    const length = 240 + ((beam % 3) * 96);
    drawCapsule(
      rgba,
      originX,
      originY + 36,
      originX + (Math.sin(angle) * 92),
      originY - length,
      6.4,
      beam % 2 === 0 ? palette.goldLight : palette.blue,
      0.16,
    );
  }

  const bursts = [
    { x: 246, y: 224, radius: 188, color: palette.pink, accent: palette.white },
    { x: 628, y: 284, radius: 168, color: palette.blue, accent: palette.white },
    { x: 960, y: 178, radius: 252, color: palette.gold, accent: palette.goldLight },
    { x: 1318, y: 236, radius: 184, color: palette.orange, accent: palette.goldLight },
    { x: 1682, y: 286, radius: 166, color: palette.purple, accent: palette.white },
  ];

  for (const [index, burst] of bursts.entries()) {
    drawCapsule(rgba, originX, originY, burst.x, burst.y + (burst.radius * 0.24), 7.2, palette.gold, 0.18);
    drawCapsule(rgba, originX, originY, burst.x, burst.y + (burst.radius * 0.24), 2.4, burst.accent, 0.32);
    drawFirework(rgba, burst.x, burst.y, burst.radius, 24, burst.color, burst.accent, 0.98);
    drawFirework(
      rgba,
      burst.x,
      burst.y,
      burst.radius * 0.66,
      16,
      index % 2 === 0 ? burst.accent : palette.goldLight,
      palette.white,
      0.62,
    );
    drawRing(rgba, burst.x, burst.y, burst.radius * 0.46, 8, burst.color, 0.14);

    for (let spark = 0; spark < 12; spark += 1) {
      const angle = (spark / 12) * TAU + (index * 0.12);
      const distance = (burst.radius * 0.34) + ((spark % 4) * (burst.radius * 0.12));
      drawSpark(
        rgba,
        burst.x + (Math.cos(angle) * distance),
        burst.y + (Math.sin(angle) * distance),
        10 + (spark % 4),
        spark % 3 === 0 ? burst.accent : spark % 3 === 1 ? palette.goldLight : burst.color,
        0.54,
      );
    }
  }

  for (let streak = 0; streak < 28; streak += 1) {
    const angle = (streak / 28) * TAU;
    const distance = 180 + ((streak % 6) * 82);
    const outerX = originX + (Math.cos(angle) * distance);
    const outerY = originY + (Math.sin(angle) * distance * 0.62);
    const color = streak % 4 === 0 ? palette.gold : streak % 4 === 1 ? palette.goldLight : streak % 4 === 2 ? palette.blue : palette.pink;
    drawCapsule(rgba, originX, originY, outerX, outerY, 10, color, 0.18);
    drawCapsule(rgba, originX, originY, outerX, outerY, 3.2, palette.white, 0.84);
  }

  drawRing(rgba, originX, originY, 164, 12, palette.gold, 0.18);
  drawRing(rgba, originX, originY, 262, 10, palette.pink, 0.1);
  drawSpark(rgba, originX, originY, 48, palette.white, 0.58);
  drawSpark(rgba, originX, originY, 62, palette.goldLight, 0.36);

  for (let coin = 0; coin < 24; coin += 1) {
    const angle = (-Math.PI * 0.96) + (rng() * (Math.PI * 0.92));
    const distance = 220 + (rng() * 860);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY + (Math.sin(angle) * distance * 0.58);
    const radius = 18 + (rng() * 28);
    drawCoin(rgba, x, y, radius, 0.96, rng() * TAU);
    if (coin % 2 === 0) {
      drawSpark(rgba, x + (radius * 0.7), y - (radius * 0.7), 8 + (coin % 4), palette.goldLight, 0.38);
    }
  }

  for (let confetti = 0; confetti < 56; confetti += 1) {
    const x = 80 + (rng() * (WIDTH - 160));
    const y = 96 + (rng() * 780);
    const width = 14 + (rng() * 28);
    const height = 7 + (rng() * 12);
    const angle = rng() * TAU;
    const color = [palette.gold, palette.pink, palette.blue, palette.purple, palette.orange][confetti % 5];
    drawRotatedRect(rgba, x, y, width, height, angle, color, 0.94);
    if (confetti % 3 === 0) {
      drawCapsule(
        rgba,
        x - (Math.cos(angle) * width * 0.38),
        y - (Math.sin(angle) * width * 0.38),
        x + (Math.cos(angle) * width * 0.38),
        y + (Math.sin(angle) * width * 0.38),
        1.4,
        palette.white,
        0.24,
      );
    }
  }

  for (let glitter = 0; glitter < 36; glitter += 1) {
    const x = 120 + (rng() * (WIDTH - 240));
    const y = 120 + (rng() * 800);
    const length = 14 + (rng() * 22);
    const angle = rng() * TAU;
    const color = glitter % 2 === 0 ? palette.goldLight : glitter % 3 === 0 ? palette.blue : palette.pink;
    drawCapsule(
      rgba,
      x - (Math.cos(angle) * length * 0.5),
      y - (Math.sin(angle) * length * 0.5),
      x + (Math.cos(angle) * length * 0.5),
      y + (Math.sin(angle) * length * 0.5),
      2.6,
      color,
      0.34,
    );
  }

  for (let spark = 0; spark < 42; spark += 1) {
    const angle = (spark / 42) * TAU;
    const distance = 150 + ((spark % 7) * 56);
    drawSpark(
      rgba,
      originX + (Math.cos(angle) * distance),
      originY + (Math.sin(angle) * distance * 0.56),
      10 + (spark % 5),
      spark % 3 === 0 ? palette.goldLight : spark % 3 === 1 ? palette.blue : palette.pink,
      0.5,
    );
  }

  return rgba;
};

const renderPartyBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1201);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.54;

  drawCircle(rgba, originX - 36, originY + 18, 236, palette.pink, 0.08, 76);
  drawCircle(rgba, originX + 42, originY - 16, 282, palette.blue, 0.07, 90);
  drawCircle(rgba, originX, originY, 168, palette.goldLight, 0.08, 64);
  drawRing(rgba, originX, originY, 180, 11, palette.pink, 0.14);
  drawRing(rgba, originX, originY, 296, 8, palette.blue, 0.1);

  for (let ribbon = 0; ribbon < 10; ribbon += 1) {
    const angle = (-Math.PI * 0.94) + ((ribbon / 9) * (Math.PI * 1.88));
    const distance = 180 + ((ribbon % 5) * 62);
    const midDistance = distance * 0.52;
    const endDistance = distance * 1.08;
    const color = ribbon % 3 === 0 ? palette.pink : ribbon % 3 === 1 ? palette.blue : palette.gold;
    const tipColor = ribbon % 2 === 0 ? palette.white : palette.goldLight;
    const points = [
      [originX, originY],
      [
        originX + (Math.cos(angle - 0.16) * midDistance),
        originY + (Math.sin(angle - 0.16) * midDistance * 0.62),
      ],
      [
        originX + (Math.cos(angle + 0.08) * endDistance),
        originY + (Math.sin(angle + 0.08) * endDistance * 0.62),
      ],
    ];
    drawRibbonTrail(rgba, points, color, tipColor, 0.9);
  }

  for (let confetti = 0; confetti < 54; confetti += 1) {
    const angle = (confetti / 54) * TAU;
    const distance = 86 + ((confetti % 7) * 42) + (rng() * 34);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY + (Math.sin(angle) * distance * 0.6);
    const width = 14 + (rng() * 22);
    const height = 7 + (rng() * 10);
    const color = confetti % 4 === 0 ? palette.pink : confetti % 4 === 1 ? palette.blue : confetti % 4 === 2 ? palette.gold : palette.white;
    drawRotatedRect(rgba, x, y, width, height, angle + (rng() * 0.9), color, 0.92);
    if (confetti % 5 === 0) {
      drawRibbonTrail(
        rgba,
        [
          [originX, originY],
          [originX + (Math.cos(angle - 0.08) * (distance * 0.56)), originY + (Math.sin(angle - 0.08) * (distance * 0.56) * 0.64)],
          [x, y],
        ],
        color,
        palette.white,
        0.5,
      );
    }
  }

  drawPartyHorn(rgba, 438, 646, 288, -0.18, palette.purple, palette.blue, palette.goldLight, 0.98);
  drawPartyHorn(rgba, WIDTH - 438, 646, 288, Math.PI + 0.18, palette.pink, palette.blue, palette.goldLight, 0.98);

  for (let confetti = 0; confetti < 64; confetti += 1) {
    const x = 80 + (rng() * (WIDTH - 160));
    const y = 74 + (rng() * 820);
    const width = 12 + (rng() * 24);
    const height = 6 + (rng() * 10);
    const angle = rng() * TAU;
    const color = confetti % 5 === 0 ? palette.gold : confetti % 5 === 1 ? palette.pink : confetti % 5 === 2 ? palette.blue : confetti % 5 === 3 ? palette.goldLight : palette.white;
    drawRotatedRect(rgba, x, y, width, height, angle, color, 0.58 + (rng() * 0.2));
    if (confetti % 7 === 0) {
      const trailLength = 22 + (rng() * 28);
      drawCapsule(
        rgba,
        x - (Math.cos(angle) * trailLength * 0.5),
        y - (Math.sin(angle) * trailLength * 0.5),
        x + (Math.cos(angle) * trailLength * 0.5),
        y + (Math.sin(angle) * trailLength * 0.5),
        2.2,
        palette.white,
        0.18,
      );
    }
  }

  for (let spark = 0; spark < 28; spark += 1) {
    const angle = (spark / 28) * TAU;
    const distance = 120 + ((spark % 6) * 48);
    const color = spark % 3 === 0 ? palette.white : spark % 3 === 1 ? palette.goldLight : spark % 2 === 0 ? palette.blue : palette.pink;
    drawSpark(
      rgba,
      originX + (Math.cos(angle) * distance),
      originY + (Math.sin(angle) * distance * 0.6),
      10 + (spark % 4),
      color,
      0.46,
    );
  }

  drawSpark(rgba, originX, originY, 44, palette.white, 0.42);
  drawSpark(rgba, originX, originY, 58, palette.goldLight, 0.26);

  return rgba;
};

const renderFullscreenFestival = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1227);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.56;

  drawCircle(rgba, originX - 28, originY + 18, 240, palette.purple, 0.08, 82);
  drawCircle(rgba, originX + 48, originY - 20, 280, palette.blue, 0.07, 94);
  drawCircle(rgba, originX, originY, 168, palette.goldLight, 0.08, 70);
  drawRing(rgba, originX, originY, 170, 10, palette.purple, 0.12);
  drawRing(rgba, originX, originY, 278, 8, palette.blue, 0.08);

  const sweepRibbons = [
    {
      points: [[-160, 248], [640, 328], [1380, 248], [WIDTH + 180, 222]],
      glow: palette.purple,
      core: palette.white,
    },
    {
      points: [[WIDTH + 140, 402], [1280, 454], [620, 414], [-160, 370]],
      glow: palette.blue,
      core: palette.goldLight,
    },
    {
      points: [[-140, 690], [620, 628], [1320, 704], [WIDTH + 160, 744]],
      glow: palette.gold,
      core: palette.white,
    },
    {
      points: [[WIDTH + 120, 806], [1260, 718], [760, 774], [-140, 752]],
      glow: palette.pink,
      core: palette.blue,
    },
  ];

  for (const ribbon of sweepRibbons) {
    drawRibbonTrail(rgba, ribbon.points, ribbon.glow, ribbon.core, 0.94);
  }

  for (let confetti = 0; confetti < 40; confetti += 1) {
    const side = confetti % 2 === 0 ? -1 : 1;
    const baseX = side < 0 ? 110 : WIDTH - 110;
    const spread = 140 + ((confetti % 8) * 54);
    const x = baseX + (side * spread);
    const y = 320 + ((confetti % 9) * 42) + (rng() * 22);
    const width = 14 + (rng() * 24);
    const height = 7 + (rng() * 10);
    const angle = side < 0 ? (-0.28 + (rng() * 0.56)) : (Math.PI + (-0.28 + (rng() * 0.56)));
    const color = confetti % 4 === 0 ? palette.purple : confetti % 4 === 1 ? palette.gold : confetti % 4 === 2 ? palette.blue : palette.pink;
    drawRotatedRect(rgba, x, y, width, height, angle, color, 0.86);
    drawCapsule(
      rgba,
      baseX,
      520 + ((confetti % 3) * 18),
      x,
      y,
      2.6,
      confetti % 2 === 0 ? palette.white : palette.goldLight,
      0.14,
    );
  }

  drawPartyHorn(rgba, 364, 690, 246, -0.2, palette.purple, palette.blue, palette.goldLight, 0.98);
  drawPartyHorn(rgba, WIDTH - 364, 690, 246, Math.PI + 0.2, palette.pink, palette.blue, palette.goldLight, 0.98);

  for (let streak = 0; streak < 16; streak += 1) {
    const angle = (streak / 16) * TAU;
    const distance = 120 + ((streak % 4) * 56);
    const color = streak % 3 === 0 ? palette.blue : streak % 3 === 1 ? palette.goldLight : palette.pink;
    const startX = originX + (Math.cos(angle) * 24);
    const startY = originY + (Math.sin(angle) * 24);
    const endX = originX + (Math.cos(angle) * distance);
    const endY = originY + (Math.sin(angle) * distance * 0.6);
    drawCapsule(rgba, startX, startY, endX, endY, 5.6, color, 0.18);
    drawCapsule(rgba, startX, startY, endX, endY, 2, palette.white, 0.74);
  }

  for (let confetti = 0; confetti < 46; confetti += 1) {
    const x = 90 + (rng() * (WIDTH - 180));
    const y = 72 + (rng() * 840);
    const width = 12 + (rng() * 22);
    const height = 6 + (rng() * 10);
    const angle = rng() * TAU;
    const color = confetti % 5 === 0 ? palette.goldLight : confetti % 5 === 1 ? palette.pink : confetti % 5 === 2 ? palette.blue : confetti % 5 === 3 ? palette.purple : palette.gold;
    drawRotatedRect(rgba, x, y, width, height, angle, color, 0.44 + (rng() * 0.18));
  }

  for (let spark = 0; spark < 24; spark += 1) {
    const angle = (spark / 24) * TAU;
    const distance = 110 + ((spark % 6) * 44);
    const color = spark % 2 === 0 ? palette.white : spark % 3 === 0 ? palette.goldLight : spark % 4 === 0 ? palette.blue : palette.pink;
    drawSpark(
      rgba,
      originX + (Math.cos(angle) * distance),
      originY + (Math.sin(angle) * distance * 0.62),
      10 + (spark % 4),
      color,
      0.42,
    );
  }

  drawSpark(rgba, originX, originY, 38, palette.white, 0.34);
  drawSpark(rgba, originX, originY, 52, palette.goldLight, 0.2);

  return rgba;
};

const renderExplodingBingoBalls = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.53;

  drawCircle(rgba, originX - 8, originY + 6, 118, palette.gold, 0.08, 62);
  drawCircle(rgba, originX + 16, originY - 8, 152, palette.blue, 0.035, 76);
  drawCircle(rgba, originX, originY, 94, palette.white, 0.1, 52);

  const burstBalls = [
    { x: originX - 308, y: originY - 132, radius: 68, body: ballPalette[2] },
    { x: originX - 94, y: originY - 234, radius: 58, body: ballPalette[4] },
    { x: originX + 196, y: originY - 188, radius: 64, body: { color: hexToRgb("#ff6548"), digit: 7 } },
    { x: originX + 364, y: originY - 24, radius: 72, body: ballPalette[1] },
    { x: originX + 32, y: originY + 212, radius: 68, body: ballPalette[3] },
    { x: originX - 274, y: originY + 84, radius: 62, body: ballPalette[4] },
  ];

  for (const ball of burstBalls) {
    drawCapsule(rgba, originX, originY, ball.x, ball.y, 6, palette.gold, 0.08);
    drawCapsule(rgba, originX, originY, ball.x, ball.y, 2.2, palette.white, 0.18);
    drawBingoBall(rgba, ball.x, ball.y, ball.radius, ball.body.color, ball.body.digit, 0.98);
    drawSpark(rgba, ball.x + (ball.radius * 0.72), ball.y - (ball.radius * 0.66), 10, palette.white, 0.34);
  }

  const heroBalls = [
    { x: 298, y: 316, radius: 96, body: ballPalette[2] },
    { x: WIDTH - 280, y: 236, radius: 104, body: { color: hexToRgb("#ff6548"), digit: 7 } },
    { x: 1004, y: HEIGHT - 34, radius: 116, body: ballPalette[4] },
  ];

  for (const ball of heroBalls) {
    drawBingoBall(rgba, ball.x, ball.y, ball.radius, ball.body.color, ball.body.digit, 0.98);
    drawSpark(rgba, ball.x + (ball.radius * 0.76), ball.y - (ball.radius * 0.72), 12, palette.white, 0.38);
  }

  for (let streak = 0; streak < 10; streak += 1) {
    const angle = (streak / 10) * TAU;
    const distance = 132 + ((streak % 4) * 58);
    const outerX = originX + (Math.cos(angle) * distance);
    const outerY = originY + (Math.sin(angle) * distance * 0.68);
    const color = streak % 4 === 0 ? palette.gold : streak % 4 === 1 ? palette.goldLight : streak % 4 === 2 ? palette.blue : hexToRgb("#ff6548");
    drawCapsule(rgba, originX, originY, outerX, outerY, 5, color, 0.16);
    drawCapsule(rgba, originX, originY, outerX, outerY, 2.2, palette.white, 0.64);
  }

  drawRing(rgba, originX, originY, 146, 11, palette.gold, 0.18);
  drawRing(rgba, originX, originY, 222, 9, palette.goldLight, 0.08);
  drawBlockText(rgba, "BINGO!", originX, originY - 78, 176, palette.goldLight, palette.gold, 0.98);
  drawSpark(rgba, originX, originY, 24, palette.white, 0.42);

  for (let spark = 0; spark < 12; spark += 1) {
    const angle = (spark / 12) * TAU;
    const distance = 102 + ((spark % 4) * 36);
    const color = spark % 3 === 0 ? palette.goldLight : spark % 3 === 1 ? palette.white : palette.blue;
    drawSpark(
      rgba,
      originX + (Math.cos(angle) * distance),
      originY + (Math.sin(angle) * distance * 0.62),
      8 + (spark % 3),
      color,
      0.32,
    );
  }

  return rgba;
};

const bingoFullscreenBalls = [
  { color: palette.gold, digit: 1 },
  { color: hexToRgb("#2f86ff"), digit: 3 },
  { color: hexToRgb("#ff6548"), digit: 7 },
  { color: hexToRgb("#7a44ff"), digit: 8 },
  { color: palette.green, digit: 9 },
  { color: palette.pink, digit: 6 },
];

const drawBingoMotionTrails = (rgba, centerX, centerY, balls) => {
  for (const ball of balls) {
    drawCapsule(rgba, ball.from[0], ball.from[1], ball.x, ball.y, 6, ball.body.color, 0.1);
    drawCapsule(rgba, ball.from[0], ball.from[1], ball.x, ball.y, 2.3, palette.white, 0.26);
  }
  drawRing(rgba, centerX, centerY, 180, 12, palette.gold, 0.16);
  drawRing(rgba, centerX, centerY, 300, 8, palette.white, 0.09);
};

const renderBingoBallStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 460, palette.blue, 0.055, 150);
  const balls = [
    { from: [-120, 120], x: 360, y: 300, radius: 82, body: bingoFullscreenBalls[1] },
    { from: [WIDTH + 120, 140], x: 1530, y: 320, radius: 88, body: bingoFullscreenBalls[2] },
    { from: [220, -120], x: 640, y: 250, radius: 72, body: bingoFullscreenBalls[3] },
    { from: [1710, -140], x: 1280, y: 260, radius: 76, body: bingoFullscreenBalls[4] },
    { from: [cx, HEIGHT + 120], x: 960, y: 620, radius: 104, body: bingoFullscreenBalls[0] },
    { from: [-120, 760], x: 700, y: 500, radius: 70, body: bingoFullscreenBalls[5] },
    { from: [WIDTH + 120, 790], x: 1220, y: 510, radius: 74, body: bingoFullscreenBalls[1] },
  ];
  drawBingoMotionTrails(rgba, cx, cy, balls);
  for (const ball of balls) {
    drawBingoBall(rgba, ball.x, ball.y, ball.radius, ball.body.color, ball.body.digit, 0.98);
    drawSpark(rgba, ball.x + ball.radius * 0.72, ball.y - ball.radius * 0.62, 11, palette.white, 0.34);
  }
  for (let spark = 0; spark < 46; spark += 1) {
    const angle = (spark / 46) * TAU;
    const distance = 150 + ((spark % 9) * 70);
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 7 + (spark % 5), spark % 2 === 0 ? palette.goldLight : palette.white, 0.24);
  }
  return rgba;
};

const renderJackpotBallExplosion = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 500, palette.goldLight, 0.065, 160);
  drawRing(rgba, cx, cy, 220, 15, palette.gold, 0.2);
  drawRing(rgba, cx, cy, 390, 10, palette.white, 0.12);
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * TAU;
    const distance = 270 + ((index % 3) * 92);
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.58;
    const body = bingoFullscreenBalls[index % bingoFullscreenBalls.length];
    drawCapsule(rgba, cx, cy, x, y, 6, body.color, 0.14);
    drawCapsule(rgba, cx, cy, x, y, 2.4, palette.white, 0.35);
    drawBingoBall(rgba, x, y, 58 + ((index % 4) * 9), body.color, body.digit, 0.98);
  }
  drawSpark(rgba, cx, cy, 70, palette.white, 0.44);
  return rgba;
};

const renderBingoLetterFormation = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 500, palette.gold, 0.06, 150);
  const letters = ["B", "I", "N", "G", "O"];
  for (let index = 0; index < letters.length; index += 1) {
    const x = 560 + index * 200;
    const y = HEIGHT * 0.5;
    const fromX = index % 2 === 0 ? -100 : WIDTH + 100;
    const fromY = 170 + index * 76;
    drawCapsule(rgba, fromX, fromY, x, y, 5.5, bingoFullscreenBalls[index].color, 0.12);
    drawCapsule(rgba, fromX, fromY, x, y, 2.2, palette.white, 0.3);
    drawBingoLetterBall(rgba, x, y, 88, bingoFullscreenBalls[index].color, letters[index], 0.98);
  }
  drawRing(rgba, cx, cy, 310, 11, palette.gold, 0.16);
  drawRing(rgba, cx, cy, 480, 8, palette.blue, 0.1);
  for (let spark = 0; spark < 44; spark += 1) {
    const angle = (spark / 44) * TAU;
    const distance = 160 + ((spark % 7) * 64);
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.5, 7 + (spark % 4), spark % 2 === 0 ? palette.white : palette.goldLight, 0.28);
  }
  return rgba;
};

const renderBingoBallFormationWink = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 540, palette.gold, 0.07, 160);
  drawCircle(rgba, cx, cy, 330, palette.blue, 0.045, 120);
  drawRing(rgba, cx, cy, 210, 15, palette.gold, 0.22);
  drawRing(rgba, cx, cy, 390, 10, palette.white, 0.12);
  const balls = [
    { letter: "B", color: palette.orange, from: [-120, HEIGHT * 0.36], x: 730, y: 470 },
    { letter: "I", color: palette.blue, from: [WIDTH * 0.48, -120], x: 880, y: 420 },
    { letter: "N", color: palette.gold, from: [WIDTH + 120, HEIGHT * 0.34], x: 1038, y: 420 },
    { letter: "G", color: palette.purple, from: [-120, HEIGHT + 120], x: 840, y: 610 },
    { letter: "O", color: palette.green, from: [WIDTH + 120, HEIGHT + 120], x: 1080, y: 610 },
  ];
  for (const ball of balls) {
    drawCapsule(rgba, ball.from[0], ball.from[1], ball.x, ball.y, 6, ball.color, 0.12);
    drawCapsule(rgba, ball.from[0], ball.from[1], ball.x, ball.y, 2.4, palette.white, 0.32);
    drawBingoLetterBall(rgba, ball.x, ball.y, 92, ball.color, ball.letter, 0.98);
  }
  drawSpark(rgba, cx, cy, 74, palette.white, 0.44);
  for (let spark = 0; spark < 68; spark += 1) {
    const angle = (spark / 68) * TAU;
    const distance = 150 + ((spark % 9) * 68);
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.56, 7 + (spark % 5), spark % 3 === 0 ? palette.goldLight : spark % 3 === 1 ? palette.white : palette.blue, 0.25);
  }
  drawBlockText(rgba, "BINGO!", cx, cy + 12, 206, palette.goldLight, palette.gold, 0.86);
  return rgba;
};

const renderImportedBingoAnimation = (variant = "classic") => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  const isElectric = variant === "electric";
  const isFinale = variant === "finale";
  const isSpeed = variant === "speed";
  const isConfetti = variant === "confetti";
  const sourceBalls = [
    { letter: "B", color: hexToRgb("#0278df"), x: isFinale ? 500 : 520, y: isFinale ? 310 : 330, from: [-120, HEIGHT * 0.36] },
    { letter: "I", color: hexToRgb("#f70900"), x: 735, y: isFinale ? 260 : 275, from: [WIDTH * 0.42, -120] },
    { letter: "N", color: hexToRgb("#9610b8"), x: 960, y: isFinale ? 230 : 250, from: [WIDTH + 120, HEIGHT * 0.34] },
    { letter: "G", color: hexToRgb("#36af0a"), x: 1185, y: isFinale ? 260 : 275, from: [WIDTH * 0.28, HEIGHT + 120] },
    { letter: "O", color: hexToRgb("#f7c901"), x: isFinale ? 1420 : 1400, y: isFinale ? 310 : 330, from: [WIDTH + 120, HEIGHT + 120] },
  ];

  drawCircle(rgba, cx, cy, isFinale ? 660 : 580, isElectric ? hexToRgb("#58c7ff") : hexToRgb("#f7c901"), isFinale ? 0.09 : 0.07, 170);
  drawCircle(rgba, cx, cy, isElectric ? 430 : 390, hexToRgb("#0278df"), isElectric ? 0.06 : 0.045, 132);
  drawRing(rgba, cx, cy, isFinale ? 310 : 265, isSpeed ? 22 : 16, isElectric ? hexToRgb("#58c7ff") : hexToRgb("#f7c901"), isFinale ? 0.26 : 0.2);
  drawRing(rgba, cx, cy, isFinale ? 520 : 455, 9, hexToRgb("#ffffff"), 0.12);

  if (isConfetti) {
    const rng = createRng(2323);
    for (let piece = 0; piece < 90; piece += 1) {
      drawSpark(rgba, 80 + rng() * (WIDTH - 160), 60 + rng() * (HEIGHT - 120), 5 + rng() * 10, sourceBalls[piece % sourceBalls.length].color, 0.18 + rng() * 0.18);
    }
  }

  if (isElectric) {
    for (let index = 0; index < sourceBalls.length; index += 1) {
      const a = sourceBalls[index];
      const b = sourceBalls[(index + 1) % sourceBalls.length];
      drawCapsule(rgba, a.x, a.y, b.x, b.y, 8, hexToRgb("#58c7ff"), 0.2);
      drawCapsule(rgba, a.x, a.y, b.x, b.y, 2.6, hexToRgb("#ffffff"), 0.42);
    }
  }

  drawBlockText(rgba, "BINGO!", cx, cy + (isFinale ? 126 : 96), isFinale ? 270 : 230, hexToRgb("#fff4b8"), isElectric ? hexToRgb("#58c7ff") : hexToRgb("#f7c901"), 0.9);

  for (const ball of sourceBalls) {
    drawCapsule(rgba, ball.from[0], ball.from[1], ball.x, ball.y, isSpeed ? 10 : 6, ball.color, isSpeed ? 0.22 : 0.12);
    drawCapsule(rgba, ball.from[0], ball.from[1], ball.x, ball.y, isSpeed ? 3.4 : 2.4, hexToRgb("#ffffff"), isSpeed ? 0.42 : 0.28);
    drawBingoLetterBall(rgba, ball.x, ball.y, isFinale ? 98 : 90, ball.color, ball.letter, 0.98);
  }

  const fireworkColors = ["#FF6B6B", "#FFE66D", "#4ECDC4", "#FF9F43", "#6C5CE7", "#F38181", "#00D2D3", "#FECA57"].map(hexToRgb);
  const sparkCount = isFinale ? 110 : isSpeed ? 92 : 72;
  for (let spark = 0; spark < sparkCount; spark += 1) {
    const angle = (spark / sparkCount) * TAU;
    const distance = 180 + ((spark % 10) * (isFinale ? 76 : 68));
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.56, 7 + (spark % 5), fireworkColors[spark % fireworkColors.length], 0.24);
  }
  drawSpark(rgba, cx, cy + 30, 78, hexToRgb("#ffffff"), 0.44);
  return rgba;
};

const renderBingoBounceHighSpeedCollision = () => renderImportedBingoAnimation("speed");
const renderBingoBounceConfettiCelebration = () => renderImportedBingoAnimation("confetti");
const renderBingoBounceElectricJackpot = () => renderImportedBingoAnimation("electric");
const renderBingoBounceMegaFinale = () => renderImportedBingoAnimation("finale");

const renderGoldenBingoCascade = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1941);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 520, palette.goldLight, 0.06, 160);
  for (let index = 0; index < 12; index += 1) {
    const x = 140 + index * ((WIDTH - 280) / 11);
    const y = 230 + (index % 4) * 110;
    const body = { color: index % 3 === 0 ? palette.goldLight : index % 3 === 1 ? palette.gold : palette.orange, digit: bingoFullscreenBalls[index % bingoFullscreenBalls.length].digit };
    drawCapsule(rgba, x, -80, x + ((index % 3) - 1) * 60, y, 4.5, body.color, 0.16);
    drawBingoBall(rgba, x + ((index % 3) - 1) * 60, y, 50 + ((index % 4) * 8), body.color, body.digit, 0.96);
  }
  for (let spark = 0; spark < 68; spark += 1) {
    drawSpark(rgba, 80 + rng() * (WIDTH - 160), 80 + rng() * (HEIGHT - 120), 6 + rng() * 10, spark % 2 === 0 ? palette.goldLight : palette.white, 0.22 + rng() * 0.16);
  }
  return rgba;
};

const renderMegaBingoBallsFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 560, palette.goldLight, 0.07, 160);
  drawRing(rgba, cx, cy, 230, 15, palette.gold, 0.2);
  drawRing(rgba, cx, cy, 430, 10, palette.blue, 0.12);
  const edgeBalls = [
    { x: 420, y: 310, radius: 76, body: bingoFullscreenBalls[1], from: [-120, 150] },
    { x: 1500, y: 320, radius: 78, body: bingoFullscreenBalls[2], from: [WIDTH + 120, 150] },
    { x: 960, y: 250, radius: 82, body: bingoFullscreenBalls[0], from: [cx, -120] },
    { x: 960, y: 672, radius: 90, body: bingoFullscreenBalls[3], from: [cx, HEIGHT + 120] },
  ];
  drawBingoMotionTrails(rgba, cx, cy, edgeBalls);
  for (const ball of edgeBalls) {
    drawBingoBall(rgba, ball.x, ball.y, ball.radius, ball.body.color, ball.body.digit, 0.94);
  }
  ["B", "I", "N", "G", "O"].forEach((letter, index) => {
    drawBingoLetterBall(rgba, 560 + index * 200, HEIGHT * 0.5, 82, bingoFullscreenBalls[index].color, letter, 0.98);
  });
  for (let spark = 0; spark < 78; spark += 1) {
    const angle = (spark / 78) * TAU;
    const distance = 150 + ((spark % 10) * 64);
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.56, 6 + (spark % 5), spark % 3 === 0 ? palette.goldLight : spark % 3 === 1 ? palette.white : palette.pink, 0.24);
  }
  return rgba;
};

const renderBirthdayCakeCelebration = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(241);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.6;

  drawCircle(rgba, originX - 26, originY + 10, 220, palette.pink, 0.06, 86);
  drawCircle(rgba, originX + 24, originY + 18, 182, palette.gold, 0.06, 74);
  drawCircle(rgba, originX + 38, originY - 10, 214, palette.blue, 0.05, 82);

  drawBirthdayCake(rgba, originX, originY, 1.02, 0.98);

  const candles = [
    { x: originX - 92, y: originY - 164, height: 92, body: palette.blue, stripe: palette.white, flame: palette.goldLight },
    { x: originX - 46, y: originY - 176, height: 100, body: palette.pink, stripe: palette.white, flame: palette.gold },
    { x: originX, y: originY - 182, height: 108, body: palette.gold, stripe: palette.white, flame: palette.goldLight },
    { x: originX + 48, y: originY - 174, height: 100, body: palette.blue, stripe: palette.white, flame: palette.goldLight },
    { x: originX + 92, y: originY - 162, height: 92, body: palette.pink, stripe: palette.white, flame: palette.gold },
  ];

  for (const candle of candles) {
    drawCandle(rgba, candle.x, candle.y, candle.height, candle.body, candle.stripe, candle.flame, 0.98);
  }

  const balloons = [
    { x: originX - 332, y: originY - 272, radius: 74, body: palette.pink, accent: palette.goldLight },
    { x: originX - 214, y: originY - 226, radius: 62, body: palette.blue, accent: palette.white },
    { x: originX + 316, y: originY - 276, radius: 78, body: palette.gold, accent: palette.white },
    { x: originX + 194, y: originY - 214, radius: 60, body: palette.white, accent: palette.pink },
  ];

  for (const balloon of balloons) {
    drawBalloon(rgba, balloon.x, balloon.y, balloon.radius, balloon.body, balloon.accent, 0.96);
  }

  drawRing(rgba, originX, originY + 18, 182, 11, palette.gold, 0.16);
  drawRing(rgba, originX, originY + 18, 248, 9, palette.pink, 0.1);

  for (let confetti = 0; confetti < 26; confetti += 1) {
    const angle = (confetti / 26) * TAU;
    const distance = 124 + ((confetti % 5) * 42) + (rng() * 18);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY - 34 + (Math.sin(angle) * distance * 0.62);
    const width = 14 + (rng() * 16);
    const height = 7 + (rng() * 10);
    const color = confetti % 4 === 0 ? palette.pink : confetti % 4 === 1 ? palette.blue : confetti % 4 === 2 ? palette.gold : palette.white;
    drawRotatedRect(rgba, x, y, width, height, rng() * TAU, color, 0.84);
  }

  for (let spark = 0; spark < 18; spark += 1) {
    const angle = (spark / 18) * TAU;
    const distance = 102 + ((spark % 5) * 34);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY - 48 + (Math.sin(angle) * distance * 0.56);
    const color = spark % 3 === 0 ? palette.goldLight : spark % 3 === 1 ? palette.white : spark % 2 === 0 ? palette.blue : palette.pink;
    drawSpark(rgba, x, y, 8 + (spark % 3), color, 0.32);
  }

  drawSpark(rgba, originX, originY - 32, 26, palette.white, 0.34);
  drawBirthdayHeroText(rgba, originX, HEIGHT * 0.3, 0.92, palette.pink);

  return rgba;
};

const renderBalloonPartyBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(271);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.58;

  drawCircle(rgba, originX - 44, originY + 24, 252, palette.pink, 0.06, 92);
  drawCircle(rgba, originX + 58, originY + 12, 224, palette.blue, 0.05, 86);
  drawCircle(rgba, originX, originY + 44, 188, palette.gold, 0.05, 78);

  drawBirthdayHbdAccent(rgba, originX, originY - 198, 1, palette.white, palette.pink, 0.64);

  const heroBalloons = [
    { x: originX - 236, y: originY + 26, radius: 116, body: palette.pink, accent: palette.goldLight },
    { x: originX - 76, y: originY - 16, radius: 98, body: palette.blue, accent: palette.white },
    { x: originX + 88, y: originY + 4, radius: 106, body: palette.gold, accent: palette.white },
    { x: originX + 246, y: originY + 18, radius: 120, body: palette.purple, accent: hexToRgb("#ff8fcf") },
    { x: originX - 358, y: originY + 116, radius: 84, body: hexToRgb("#ff8fcf"), accent: palette.white },
    { x: originX + 366, y: originY + 108, radius: 88, body: palette.blue, accent: palette.goldLight },
  ];

  for (const balloon of heroBalloons) {
    drawBalloon(rgba, balloon.x, balloon.y, balloon.radius, balloon.body, balloon.accent, 0.96);
  }

  const ribbonSweeps = [
    [
      [originX - 520, originY - 26],
      [originX - 188, originY - 68],
      [originX + 42, originY - 38],
      [originX + 322, originY - 112],
      [originX + 562, originY - 76],
    ],
    [
      [originX + 544, originY + 14],
      [originX + 218, originY + 44],
      [originX - 36, originY + 22],
      [originX - 304, originY + 88],
      [originX - 566, originY + 56],
    ],
    [
      [originX - 440, originY + 146],
      [originX - 146, originY + 102],
      [originX + 114, originY + 118],
      [originX + 422, originY + 66],
    ],
  ];

  drawRibbonTrail(rgba, ribbonSweeps[0], palette.goldLight, palette.pink, 0.82);
  drawRibbonTrail(rgba, ribbonSweeps[1], palette.white, palette.blue, 0.78);
  drawRibbonTrail(rgba, ribbonSweeps[2], hexToRgb("#ff8fcf"), palette.gold, 0.74);

  drawRing(rgba, originX, originY + 16, 182, 11, palette.pink, 0.14);
  drawRing(rgba, originX, originY + 16, 258, 9, palette.blue, 0.08);

  for (let confetti = 0; confetti < 30; confetti += 1) {
    const angle = (confetti / 30) * TAU;
    const distance = 140 + ((confetti % 6) * 42) + (rng() * 20);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY - 18 + (Math.sin(angle) * distance * 0.62);
    const width = 14 + (rng() * 16);
    const height = 7 + (rng() * 10);
    const color = confetti % 5 === 0 ? palette.gold : confetti % 5 === 1 ? palette.pink : confetti % 5 === 2 ? palette.blue : confetti % 5 === 3 ? palette.purple : hexToRgb("#ff8fcf");
    drawRotatedRect(rgba, x, y, width, height, rng() * TAU, color, 0.84);
  }

  for (let spark = 0; spark < 24; spark += 1) {
    const angle = (spark / 24) * TAU;
    const distance = 104 + ((spark % 5) * 34);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY - 34 + (Math.sin(angle) * distance * 0.56);
    const color = spark % 4 === 0 ? palette.goldLight : spark % 4 === 1 ? palette.white : spark % 2 === 0 ? palette.blue : palette.pink;
    drawSpark(rgba, x, y, 8 + (spark % 3), color, 0.3);
  }
  drawBirthdayHeroText(rgba, originX, HEIGHT * 0.28, 0.92, palette.blue);

  return rgba;
};

const renderGiftBoxExplosion = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(281);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.56;
  drawCircle(rgba, cx, cy, 420, palette.pink, 0.06, 130);
  drawCircle(rgba, cx, cy + 28, 320, palette.goldLight, 0.055, 110);
  drawGiftBox(rgba, cx, cy, 300, 0.98);
  const balloons = [
    { x: 480, y: 270, radius: 86, body: palette.pink, accent: palette.goldLight },
    { x: 1440, y: 250, radius: 92, body: palette.blue, accent: palette.goldLight },
  ];
  for (const balloon of balloons) {
    drawBalloon(rgba, balloon.x, balloon.y, balloon.radius, balloon.body, balloon.accent, 0.92);
  }
  for (let i = 0; i < 58; i += 1) {
    const angle = rng() * TAU;
    const distance = 100 + rng() * 720;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.62;
    const color = [palette.pink, palette.blue, palette.gold, palette.goldLight, palette.white][i % 5];
    if (i % 7 === 0) {
      drawRibbonTrail(rgba, [[cx, cy], [cx + Math.cos(angle) * distance * 0.5, cy + Math.sin(angle) * distance * 0.34], [x, y]], color, palette.white, 0.42);
    } else {
      drawRotatedRect(rgba, x, y, 12 + rng() * 22, 6 + rng() * 10, rng() * TAU, color, 0.72);
    }
  }
  drawRing(rgba, cx, cy, 260, 12, palette.gold, 0.16);
  drawSpark(rgba, cx, cy - 80, 42, palette.white, 0.38);
  drawBirthdayHeroText(rgba, cx, HEIGHT * 0.28, 0.9, palette.pink);
  return rgba;
};

const renderCandleWishMoment = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(291);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.56;
  drawCircle(rgba, cx, cy, 500, palette.goldLight, 0.07, 150);
  const colors = [palette.pink, palette.blue, palette.gold, palette.purple, hexToRgb("#ff8fcf"), palette.goldLight, palette.orange];
  for (let i = 0; i < 9; i += 1) {
    const x = WIDTH * 0.22 + i * (WIDTH * 0.56 / 8);
    const y = cy + (i % 2 === 0 ? 34 : -18);
    drawBirthdayCandle(rgba, x, y, 150 + (i % 3) * 18, colors[i % colors.length], 0.96);
  }
  drawRing(rgba, cx, cy, 230, 10, palette.gold, 0.14);
  drawRing(rgba, cx, cy, 390, 8, palette.goldLight, 0.09);
  for (let spark = 0; spark < 64; spark += 1) {
    const x = 160 + rng() * (WIDTH - 320);
    const y = 130 + rng() * (HEIGHT - 260);
    drawSpark(rgba, x, y, 6 + rng() * 12, spark % 3 === 0 ? palette.goldLight : palette.white, 0.22 + rng() * 0.18);
  }
  drawBirthdayHeroText(rgba, cx, HEIGHT * 0.27, 0.88, palette.orange);
  return rgba;
};

const renderHappyBirthdayGrandFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(301);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.6;
  drawCircle(rgba, cx, cy, 540, palette.pink, 0.065, 150);
  drawCircle(rgba, cx, cy + 20, 420, palette.goldLight, 0.055, 130);
  drawBirthdayCake(rgba, cx, cy, 1.02, 0.98);
  const balloons = [
    { x: 360, y: cy - 150, radius: 90, body: palette.pink, accent: palette.goldLight },
    { x: 520, y: cy - 198, radius: 78, body: palette.blue, accent: palette.white },
    { x: 1400, y: cy - 150, radius: 88, body: palette.gold, accent: palette.white },
    { x: 1560, y: cy - 196, radius: 82, body: palette.purple, accent: palette.goldLight },
  ];
  for (const balloon of balloons) {
    drawBalloon(rgba, balloon.x, balloon.y, balloon.radius, balloon.body, balloon.accent, 0.94);
  }
  drawRibbonTrail(rgba, [[-80, 260], [760, 390], [WIDTH + 120, 650]], palette.pink, palette.white, 0.78);
  drawRibbonTrail(rgba, [[WIDTH + 80, 260], [1160, 400], [-120, 660]], palette.blue, palette.goldLight, 0.76);
  for (let i = 0; i < 90; i += 1) {
    const angle = rng() * TAU;
    const distance = 110 + rng() * 840;
    const x = cx + Math.cos(angle) * distance;
    const y = cy - 30 + Math.sin(angle) * distance * 0.6;
    const color = [palette.pink, palette.blue, palette.gold, palette.goldLight, palette.white, palette.purple][i % 6];
    if (i % 9 === 0) {
      drawRibbonTrail(rgba, [[cx, cy - 30], [cx + Math.cos(angle) * distance * 0.48, cy - 30 + Math.sin(angle) * distance * 0.28], [x, y]], color, palette.white, 0.32);
    } else {
      drawRotatedRect(rgba, x, y, 10 + rng() * 24, 5 + rng() * 10, rng() * TAU, color, 0.66);
    }
  }
  drawRing(rgba, cx, cy + 16, 260, 11, palette.gold, 0.16);
  drawSpark(rgba, cx, cy - 40, 54, palette.white, 0.38);
  drawBirthdayHeroText(rgba, cx, HEIGHT * 0.27, 0.94, palette.pink);
  return rgba;
};

const christmasPreview = {
  green: hexToRgb("#23bf66"),
  deepGreen: hexToRgb("#0f8a4a"),
  red: hexToRgb("#ff3f3f"),
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  white: hexToRgb("#ffffff"),
  ice: hexToRgb("#9de8ff"),
};

const drawChristmasTree = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.95, christmasPreview.green, alpha * 0.08, size * 0.36);
  for (let tier = 0; tier < 3; tier += 1) {
    const width = size * (0.85 + tier * 0.38);
    const height = size * 0.52;
    const y = cy - size * 0.42 + tier * size * 0.34;
    drawPolygon(buffer, [[cx, y - height * 0.52], [cx - width * 0.5, y + height * 0.5], [cx + width * 0.5, y + height * 0.5]], tier % 2 === 0 ? christmasPreview.green : christmasPreview.deepGreen, alpha * 0.96, 1.4);
  }
  drawCapsule(buffer, cx, cy + size * 0.48, cx, cy + size * 0.72, size * 0.08, hexToRgb("#8a552a"), alpha * 0.9);
  drawGoldenStar(buffer, cx, cy - size * 0.82, size * 0.13, alpha, 0);
  for (let light = 0; light < 14; light += 1) {
    const x = cx + (light % 2 === 0 ? -1 : 1) * size * (0.12 + (light % 5) * 0.055);
    const y = cy - size * 0.42 + light * size * 0.07;
    const color = [christmasPreview.red, christmasPreview.gold, christmasPreview.ice, christmasPreview.white][light % 4];
    drawCircle(buffer, x, y, size * 0.025, color, alpha * 0.9, size * 0.04);
  }
};

const drawSnowField = (buffer, seed, count, colors = [christmasPreview.white, christmasPreview.ice]) => {
  const rng = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const x = 50 + rng() * (WIDTH - 100);
    const y = 40 + rng() * (HEIGHT - 80);
    const size = 5 + rng() * 16;
    const color = colors[i % colors.length];
    drawSpark(buffer, x, y, size, color, 0.28 + rng() * 0.3);
    if (i % 5 === 0) {
      drawCapsule(buffer, x - size, y, x + size, y, 1.4, color, 0.22);
      drawCapsule(buffer, x, y - size, x, y + size, 1.4, color, 0.22);
    }
  }
};

const drawBell = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.8, christmasPreview.gold, alpha * 0.1, size * 0.28);
  drawPolygon(buffer, [[cx - size * 0.34, cy - size * 0.32], [cx + size * 0.34, cy - size * 0.32], [cx + size * 0.48, cy + size * 0.32], [cx - size * 0.48, cy + size * 0.32]], christmasPreview.gold, alpha * 0.96, 1.3);
  drawCapsule(buffer, cx - size * 0.46, cy + size * 0.34, cx + size * 0.46, cy + size * 0.34, size * 0.06, christmasPreview.goldLight, alpha * 0.9);
  drawCircle(buffer, cx, cy + size * 0.43, size * 0.08, christmasPreview.red, alpha * 0.92);
  drawPolygon(buffer, [[cx, cy - size * 0.44], [cx - size * 0.32, cy - size * 0.58], [cx - size * 0.24, cy - size * 0.28]], christmasPreview.red, alpha * 0.9, 1);
  drawPolygon(buffer, [[cx, cy - size * 0.44], [cx + size * 0.32, cy - size * 0.58], [cx + size * 0.24, cy - size * 0.28]], christmasPreview.red, alpha * 0.9, 1);
};

const drawMerryChristmasText = (buffer, cx, cy, scale = 1) => {
  drawCircle(buffer, cx, cy, 480 * scale, christmasPreview.gold, 0.06, 130 * scale);
  drawBlockText(buffer, "MERRY", cx, cy - 72 * scale, 138 * scale, christmasPreview.goldLight, christmasPreview.white, 0.98);
  drawBlockText(buffer, "CHRISTMAS", cx, cy + 62 * scale, 102 * scale, christmasPreview.goldLight, christmasPreview.red, 0.96);
};

const renderChristmasTreeReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.58;
  drawCircle(rgba, cx, cy, 520, christmasPreview.green, 0.065, 160);
  drawSnowField(rgba, 901, 72);
  drawChristmasTree(rgba, cx, cy, 390, 0.98);
  drawRing(rgba, cx, cy, 360, 9, christmasPreview.gold, 0.13);
  return rgba;
};

const renderSantaGiftBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(911);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.56;
  drawCircle(rgba, cx, cy, 520, christmasPreview.red, 0.06, 150);
  drawGiftBox(rgba, cx, cy, 300, 0.98);
  for (let i = 0; i < 78; i += 1) {
    const angle = rng() * TAU;
    const distance = 130 + rng() * 820;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.58;
    const color = [christmasPreview.red, christmasPreview.gold, christmasPreview.green, christmasPreview.white, christmasPreview.ice][i % 5];
    if (i % 7 === 0) drawRibbonTrail(rgba, [[cx, cy], [cx + Math.cos(angle) * distance * 0.48, cy + Math.sin(angle) * distance * 0.28], [x, y]], color, christmasPreview.white, 0.36);
    else drawSpark(rgba, x, y, 7 + rng() * 16, color, 0.28 + rng() * 0.22);
  }
  drawSnowField(rgba, 912, 34);
  return rgba;
};

const renderSnowfallMagic = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.48;
  drawCircle(rgba, cx, cy, 620, christmasPreview.ice, 0.06, 170);
  drawSnowField(rgba, 921, 150, [christmasPreview.white, christmasPreview.ice, christmasPreview.goldLight]);
  drawRing(rgba, cx, cy, 360, 8, christmasPreview.white, 0.12);
  drawRing(rgba, cx, cy, 540, 6, christmasPreview.ice, 0.1);
  return rgba;
};

const renderJingleBellsBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, christmasPreview.gold, 0.065, 160);
  drawBell(rgba, cx - 130, cy, 240, 0.96);
  drawBell(rgba, cx + 130, cy, 240, 0.96);
  drawRing(rgba, cx, cy, 260, 12, christmasPreview.gold, 0.18);
  drawRing(rgba, cx, cy, 430, 8, christmasPreview.red, 0.12);
  for (let i = 0; i < 60; i += 1) {
    const angle = (i / 60) * TAU;
    const distance = 160 + (i % 8) * 76;
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 7 + (i % 5), i % 2 === 0 ? christmasPreview.goldLight : christmasPreview.white, 0.3);
  }
  return rgba;
};

const renderChristmasGrandFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.6;
  drawCircle(rgba, cx, cy - 60, 660, christmasPreview.green, 0.06, 175);
  drawCircle(rgba, cx, cy - 60, 500, christmasPreview.red, 0.04, 140);
  drawSnowField(rgba, 941, 90);
  drawChristmasTree(rgba, cx, cy + 48, 300, 0.94);
  drawGiftBox(rgba, 520, HEIGHT * 0.75, 150, 0.9);
  drawGiftBox(rgba, 1400, HEIGHT * 0.75, 150, 0.9);
  drawBell(rgba, 350, 300, 110, 0.86);
  drawBell(rgba, WIDTH - 350, 300, 110, 0.86);
  drawMerryChristmasText(rgba, cx, HEIGHT * 0.26, 0.95);
  return rgba;
};

const drawSnowman = (buffer, cx, cy, size, alpha = 1, hasGift = false) => {
  drawCircle(buffer, cx, cy, size * 0.95, christmasPreview.ice, alpha * 0.08, size * 0.34);
  drawCapsule(buffer, cx - size * 0.24, cy - size * 0.1, cx - size * 0.52, cy - size * 0.25, size * 0.018, hexToRgb("#8a552a"), alpha * 0.86);
  drawCapsule(buffer, cx + size * 0.24, cy - size * 0.1, cx + size * 0.52, cy - size * 0.25, size * 0.018, hexToRgb("#8a552a"), alpha * 0.86);
  drawCircle(buffer, cx, cy + size * 0.34, size * 0.36, christmasPreview.white, alpha * 0.96, size * 0.12);
  drawCircle(buffer, cx, cy - size * 0.06, size * 0.28, christmasPreview.white, alpha * 0.97, size * 0.1);
  drawCircle(buffer, cx, cy - size * 0.42, size * 0.22, christmasPreview.white, alpha * 0.98, size * 0.08);
  drawCapsule(buffer, cx - size * 0.28, cy - size * 0.25, cx + size * 0.28, cy - size * 0.25, size * 0.048, christmasPreview.red, alpha * 0.97);
  drawCapsule(buffer, cx + size * 0.16, cy - size * 0.22, cx + size * 0.23, cy + size * 0.07, size * 0.048, christmasPreview.red, alpha * 0.92);
  drawPolygon(buffer, [[cx - size * 0.02, cy - size * 0.455], [cx + size * 0.3, cy - size * 0.405], [cx - size * 0.02, cy - size * 0.36]], christmasPreview.gold, alpha * 0.98, 1);
  drawCircle(buffer, cx - size * 0.105, cy - size * 0.485, size * 0.026, hexToRgb("#111111"), alpha * 0.98);
  drawCircle(buffer, cx + size * 0.105, cy - size * 0.485, size * 0.026, hexToRgb("#111111"), alpha * 0.98);
  for (const dot of [-0.12, -0.06, 0, 0.06, 0.12]) {
    drawCircle(buffer, cx + dot * size, cy - size * (0.38 - Math.abs(dot) * 0.14), size * 0.014, hexToRgb("#111111"), alpha * 0.88);
  }
  for (let i = 0; i < 3; i += 1) {
    drawCircle(buffer, cx, cy - size * 0.07 + i * size * 0.14, size * 0.018, hexToRgb("#111111"), alpha * 0.86);
  }
  drawCapsule(buffer, cx - size * 0.26, cy - size * 0.78, cx + size * 0.26, cy - size * 0.78, size * 0.035, hexToRgb("#171717"), alpha * 0.95);
  drawRotatedRect(buffer, cx, cy - size * 0.9, size * 0.32, size * 0.18, -0.05, hexToRgb("#171717"), alpha * 0.96);
  drawCapsule(buffer, cx - size * 0.16, cy - size * 0.86, cx + size * 0.16, cy - size * 0.86, size * 0.018, christmasPreview.red, alpha * 0.9);
  drawCircle(buffer, cx - size * 0.12, cy - size * 0.53, size * 0.036, hexToRgb("#111111"), alpha);
  drawCircle(buffer, cx + size * 0.12, cy - size * 0.53, size * 0.036, hexToRgb("#111111"), alpha);
  drawPolygon(buffer, [[cx - size * 0.04, cy - size * 0.49], [cx + size * 0.34, cy - size * 0.465], [cx - size * 0.04, cy - size * 0.42]], christmasPreview.gold, alpha, 1);
  for (const dot of [-0.13, -0.065, 0, 0.065, 0.13]) {
    drawCircle(buffer, cx + dot * size, cy - size * (0.405 - Math.abs(dot) * 0.16), size * 0.018, hexToRgb("#111111"), alpha * 0.94);
  }
  if (hasGift) {
    drawGiftBox(buffer, cx + size * 0.43, cy + size * 0.08, size * 0.26, alpha * 0.92);
  }
};

const renderGiantSnowmanReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.58;
  drawCircle(rgba, cx, cy, 620, christmasPreview.ice, 0.065, 170);
  drawSnowField(rgba, 951, 78, [christmasPreview.white, christmasPreview.ice, christmasPreview.goldLight]);
  drawSnowman(rgba, cx, cy + 18, 430, 0.98);
  drawRing(rgba, cx, cy + 18, 360, 9, christmasPreview.white, 0.12);
  return rgba;
};

const renderSnowmanSnowstorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.56;
  drawCircle(rgba, cx, cy, 690, christmasPreview.ice, 0.07, 180);
  drawSnowField(rgba, 961, 168, [christmasPreview.white, christmasPreview.ice, christmasPreview.goldLight]);
  drawRing(rgba, cx, cy, 480, 8, christmasPreview.ice, 0.12);
  drawSnowman(rgba, cx, cy + 28, 370, 0.96);
  return rgba;
};

const renderTopHatSnowmanPop = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(971);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.58;
  drawCircle(rgba, cx, cy, 560, christmasPreview.goldLight, 0.055, 160);
  drawSnowField(rgba, 972, 62);
  drawSnowman(rgba, cx, cy + 24, 390, 0.97);
  drawRotatedRect(rgba, cx - 330, cy - 250, 150, 80, -0.62, hexToRgb("#171717"), 0.78);
  for (let i = 0; i < 60; i += 1) {
    const angle = rng() * TAU;
    const distance = 150 + rng() * 700;
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.55, 8 + rng() * 14, [christmasPreview.ice, christmasPreview.white, christmasPreview.gold][i % 3], 0.24 + rng() * 0.2);
  }
  drawRing(rgba, cx, cy + 24, 320, 10, christmasPreview.gold, 0.13);
  return rgba;
};

const renderChristmasSnowmanGift = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(981);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.58;
  drawCircle(rgba, cx, cy, 610, christmasPreview.green, 0.055, 165);
  drawCircle(rgba, cx + 150, cy + 20, 300, christmasPreview.gold, 0.06, 110);
  drawSnowField(rgba, 982, 72, [christmasPreview.white, christmasPreview.ice, christmasPreview.goldLight]);
  drawSnowman(rgba, cx, cy + 22, 370, 0.97, true);
  for (let i = 0; i < 72; i += 1) {
    const angle = rng() * TAU;
    const distance = 100 + rng() * 760;
    const x = cx + 150 + Math.cos(angle) * distance;
    const y = cy + 20 + Math.sin(angle) * distance * 0.52;
    const color = [christmasPreview.red, christmasPreview.green, christmasPreview.goldLight, christmasPreview.white][i % 4];
    if (i % 8 === 0) drawRibbonTrail(rgba, [[cx + 150, cy + 20], [cx + 150 + Math.cos(angle) * distance * 0.45, cy + 20 + Math.sin(angle) * distance * 0.24], [x, y]], color, christmasPreview.white, 0.3);
    else drawSpark(rgba, x, y, 7 + rng() * 15, color, 0.22 + rng() * 0.22);
  }
  return rgba;
};

const renderSnowmanGrandFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.58;
  drawCircle(rgba, cx, cy, 720, christmasPreview.ice, 0.065, 190);
  drawCircle(rgba, cx, cy, 520, christmasPreview.gold, 0.04, 140);
  drawSnowField(rgba, 991, 152, [christmasPreview.white, christmasPreview.ice, christmasPreview.goldLight]);
  drawGiftBox(rgba, 470, HEIGHT * 0.76, 135, 0.85);
  drawGiftBox(rgba, 1460, HEIGHT * 0.76, 135, 0.85);
  drawSnowman(rgba, cx, cy + 28, 430, 0.98, true);
  drawRing(rgba, cx, cy + 18, 420, 10, christmasPreview.gold, 0.12);
  drawRing(rgba, cx, cy + 18, 580, 7, christmasPreview.ice, 0.1);
  return rgba;
};

const applausePreviewPalette = {
  skin: hexToRgb("#ffd28a"),
  skinWarm: hexToRgb("#ffb86a"),
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  white: hexToRgb("#ffffff"),
  cyan: hexToRgb("#58c7ff"),
};

const drawClapHand = (buffer, cx, cy, size, side = 1, alpha = 1) => {
  drawCircle(buffer, cx, cy + size * 0.08, size * 0.44, applausePreviewPalette.gold, alpha * 0.08, size * 0.18);
  drawRotatedRect(buffer, cx, cy + size * 0.13, size * 0.42, size * 0.56, side * -0.16, applausePreviewPalette.skin, alpha * 0.94);
  for (let i = 0; i < 4; i += 1) {
    drawRotatedRect(buffer, cx + side * ((i - 1.5) * size * 0.105), cy - size * 0.18 - i * size * 0.016, size * 0.11, size * (0.42 - i * 0.018), side * -0.1, applausePreviewPalette.skin, alpha * 0.96);
  }
  drawRotatedRect(buffer, cx + side * size * 0.28, cy + size * 0.02, size * 0.14, size * 0.42, side * -0.72, applausePreviewPalette.skinWarm, alpha * 0.94);
  drawSpark(buffer, cx - side * size * 0.14, cy - size * 0.18, size * 0.08, applausePreviewPalette.white, alpha * 0.34);
};

const drawClappingHands = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.95, applausePreviewPalette.gold, alpha * 0.09, size * 0.34);
  drawClapHand(buffer, cx - size * 0.2, cy, size, -1, alpha);
  drawClapHand(buffer, cx + size * 0.2, cy, size, 1, alpha);
  drawSpark(buffer, cx, cy - size * 0.18, size * 0.18, applausePreviewPalette.white, alpha * 0.42);
};

const drawApplauseSparkField = (buffer, seed, count, cx, cy, radiusX, radiusY, colors = [applausePreviewPalette.gold, applausePreviewPalette.goldLight, applausePreviewPalette.white]) => {
  const rng = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng()) * 1;
    const x = cx + Math.cos(angle) * radiusX * distance;
    const y = cy + Math.sin(angle) * radiusY * distance;
    const color = colors[i % colors.length];
    if (i % 8 === 0) drawClappingHands(buffer, x, y, 44 + rng() * 34, 0.34);
    else drawSpark(buffer, x, y, 7 + rng() * 17, color, 0.22 + rng() * 0.24);
  }
};

const drawApplauseText = (buffer, text, cx, cy, scale = 1, accent = applausePreviewPalette.gold) => {
  drawCircle(buffer, cx, cy + 8, 470 * scale, accent, 0.06, 140 * scale);
  drawBlockText(buffer, text, cx + 8 * scale, cy + 8 * scale, 210 * scale, accent, accent, 0.42);
  drawBlockText(buffer, text, cx, cy, 210 * scale, applausePreviewPalette.goldLight, applausePreviewPalette.white, 0.98);
  drawCapsule(buffer, cx - 380 * scale, cy - 82 * scale, cx + 380 * scale, cy + 70 * scale, 6 * scale, applausePreviewPalette.white, 0.32);
};

const renderGiantClapBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 620, applausePreviewPalette.gold, 0.065, 170);
  drawRing(rgba, cx, cy, 300, 10, applausePreviewPalette.goldLight, 0.14);
  drawRing(rgba, cx, cy, 470, 8, applausePreviewPalette.white, 0.1);
  drawApplauseSparkField(rgba, 1101, 86, cx, cy, 850, 380);
  drawClappingHands(rgba, cx, cy + 20, 430, 0.98);
  return rgba;
};

const renderStandingOvation = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 650, applausePreviewPalette.goldLight, 0.065, 180);
  drawApplauseSparkField(rgba, 1111, 70, cx, cy, 900, 390, [applausePreviewPalette.gold, applausePreviewPalette.cyan, applausePreviewPalette.white]);
  drawClappingHands(rgba, cx - 420, cy + 120, 140, 0.56);
  drawClappingHands(rgba, cx + 420, cy + 120, 140, 0.56);
  drawApplauseText(rgba, "BRAVO!", cx, cy - 10, 0.95, applausePreviewPalette.gold);
  return rgba;
};

const renderGoldenApplauseRain = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1121);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 700, applausePreviewPalette.gold, 0.055, 180);
  for (let i = 0; i < 92; i += 1) {
    const x = 70 + rng() * (WIDTH - 140);
    const y = 30 + rng() * (HEIGHT - 60);
    if (i % 4 === 0) drawClappingHands(rgba, x, y, 70 + rng() * 42, 0.42);
    else drawSpark(rgba, x, y, 7 + rng() * 17, [applausePreviewPalette.gold, applausePreviewPalette.goldLight, applausePreviewPalette.white][i % 3], 0.24 + rng() * 0.24);
  }
  drawClappingHands(rgba, cx, cy + 20, 300, 0.86);
  drawRing(rgba, cx, cy + 20, 390, 8, applausePreviewPalette.goldLight, 0.1);
  return rgba;
};

const renderChampionApplause = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.55;
  drawCircle(rgba, cx, cy, 650, applausePreviewPalette.cyan, 0.055, 170);
  drawCircle(rgba, cx, cy, 480, applausePreviewPalette.gold, 0.045, 140);
  drawApplauseSparkField(rgba, 1131, 76, cx, cy, 880, 380, [applausePreviewPalette.gold, applausePreviewPalette.cyan, applausePreviewPalette.white]);
  drawClappingHands(rgba, cx, cy + 100, 330, 0.92);
  drawApplauseText(rgba, "WINNER!", cx, HEIGHT * 0.3, 0.86, applausePreviewPalette.cyan);
  drawRing(rgba, cx, cy + 70, 430, 10, applausePreviewPalette.gold, 0.14);
  return rgba;
};

const renderApplauseGrandFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 720, applausePreviewPalette.gold, 0.07, 190);
  drawCircle(rgba, cx, cy, 520, applausePreviewPalette.cyan, 0.035, 150);
  drawApplauseSparkField(rgba, 1141, 110, cx, cy, 920, 410, [applausePreviewPalette.gold, applausePreviewPalette.goldLight, applausePreviewPalette.skin, applausePreviewPalette.white, applausePreviewPalette.cyan]);
  drawRing(rgba, cx, cy, 360, 11, applausePreviewPalette.goldLight, 0.15);
  drawRing(rgba, cx, cy, 560, 8, applausePreviewPalette.white, 0.1);
  drawClappingHands(rgba, cx, cy + 22, 430, 0.98);
  return rgba;
};

const thanksPreviewPalette = {
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  warm: hexToRgb("#ffcf8a"),
  pink: hexToRgb("#ff8fcf"),
  white: hexToRgb("#ffffff"),
  cyan: hexToRgb("#58c7ff"),
};

const drawThanksHeroText = (buffer, cx, cy, scale = 1, accent = thanksPreviewPalette.gold) => {
  drawCircle(buffer, cx, cy + 8, 430 * scale, accent, 0.07, 130 * scale);
  drawCircle(buffer, cx, cy + 12, 300 * scale, thanksPreviewPalette.goldLight, 0.055, 100 * scale);
  drawBlockText(buffer, "THANKS", cx + (8 * scale), cy + (8 * scale), 228 * scale, accent, accent, 0.46);
  drawBlockText(buffer, "THANKS", cx, cy, 228 * scale, thanksPreviewPalette.goldLight, thanksPreviewPalette.white, 0.98);
  drawCapsule(buffer, cx - (390 * scale), cy - (92 * scale), cx + (390 * scale), cy + (72 * scale), 7 * scale, thanksPreviewPalette.white, 0.38);
  drawSpark(buffer, cx + (404 * scale), cy + (78 * scale), 18 * scale, thanksPreviewPalette.white, 0.42);
};

const drawThanksSparkField = (buffer, seed, count, cx, cy, radiusX, radiusY, colors = [thanksPreviewPalette.goldLight, thanksPreviewPalette.white, thanksPreviewPalette.gold]) => {
  const rng = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    const x = cx + Math.cos(angle) * radiusX * distance;
    const y = cy + Math.sin(angle) * radiusY * distance;
    const color = colors[i % colors.length];
    drawSpark(buffer, x, y, 6 + rng() * 15, color, 0.2 + rng() * 0.28);
  }
};

const renderGiantThanksReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, thanksPreviewPalette.gold, 0.065, 160);
  drawCircle(rgba, cx, cy + 18, 380, thanksPreviewPalette.pink, 0.04, 120);
  drawThanksSparkField(rgba, 471, 72, cx, cy, 820, 360);
  drawThanksHeroText(rgba, cx, cy - 10, 1, thanksPreviewPalette.gold);
  return rgba;
};

const renderGoldenGratitudeBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(481);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 520, thanksPreviewPalette.warm, 0.075, 150);
  for (let beam = 0; beam < 22; beam += 1) {
    const angle = (beam / 22) * TAU;
    const length = 250 + ((beam % 5) * 90);
    drawCapsule(rgba, cx + Math.cos(angle) * 70, cy + Math.sin(angle) * 40, cx + Math.cos(angle) * length, cy + Math.sin(angle) * length * 0.58, 10, beam % 2 === 0 ? thanksPreviewPalette.goldLight : thanksPreviewPalette.gold, 0.18);
    drawCapsule(rgba, cx + Math.cos(angle) * 96, cy + Math.sin(angle) * 54, cx + Math.cos(angle) * (length * 0.82), cy + Math.sin(angle) * length * 0.48, 3, thanksPreviewPalette.white, 0.34);
  }
  drawThanksSparkField(rgba, 482, 60, cx, cy, 760, 340, [thanksPreviewPalette.gold, thanksPreviewPalette.goldLight, thanksPreviewPalette.warm, thanksPreviewPalette.white]);
  drawThanksHeroText(rgba, cx, cy - 4, 0.98, thanksPreviewPalette.warm);
  drawSpark(rgba, cx - 390 + rng() * 780, cy - 170 + rng() * 340, 28, thanksPreviewPalette.white, 0.34);
  return rgba;
};

const renderSparkleThankYou = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.48;
  drawCircle(rgba, cx, cy, 430, thanksPreviewPalette.white, 0.045, 140);
  drawThanksSparkField(rgba, 491, 96, cx, cy, 880, 380, [thanksPreviewPalette.white, thanksPreviewPalette.goldLight, thanksPreviewPalette.gold]);
  const trail = [
    [cx - 490, cy + 72],
    [cx - 280, cy + 20],
    [cx - 70, cy + 78],
    [cx + 132, cy + 18],
    [cx + 316, cy + 66],
    [cx + 492, cy + 30],
  ];
  drawRibbonTrail(rgba, trail, thanksPreviewPalette.white, thanksPreviewPalette.goldLight, 0.58);
  drawThanksHeroText(rgba, cx, cy, 0.96, thanksPreviewPalette.white);
  return rgba;
};

const renderThanksGiftPop = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(501);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.58;
  drawCircle(rgba, cx, cy, 440, thanksPreviewPalette.gold, 0.06, 140);
  drawCircle(rgba, cx, cy + 30, 320, thanksPreviewPalette.pink, 0.05, 110);
  drawGiftBox(rgba, cx, cy + 42, 280, 0.98);
  for (let i = 0; i < 54; i += 1) {
    const angle = rng() * TAU;
    const distance = 120 + rng() * 700;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.58;
    const color = [thanksPreviewPalette.gold, thanksPreviewPalette.goldLight, thanksPreviewPalette.pink, thanksPreviewPalette.white][i % 4];
    if (i % 7 === 0) {
      drawRibbonTrail(rgba, [[cx, cy], [cx + Math.cos(angle) * distance * 0.45, cy + Math.sin(angle) * distance * 0.28], [x, y]], color, thanksPreviewPalette.white, 0.34);
    } else {
      drawSpark(rgba, x, y, 7 + rng() * 14, color, 0.24 + rng() * 0.2);
    }
  }
  drawThanksHeroText(rgba, cx, HEIGHT * 0.34, 0.88, thanksPreviewPalette.pink);
  return rgba;
};

const renderThanksGrandFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(511);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, thanksPreviewPalette.gold, 0.075, 160);
  drawCircle(rgba, cx, cy + 24, 420, thanksPreviewPalette.warm, 0.055, 130);
  for (let i = 0; i < 76; i += 1) {
    const angle = rng() * TAU;
    const distance = 110 + rng() * 820;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.6;
    if (i % 4 === 0) {
      drawGoldenStar(rgba, x, y, 16 + rng() * 34, 0.54 + rng() * 0.28, rng() * TAU);
    } else {
      drawSpark(rgba, x, y, 8 + rng() * 16, [thanksPreviewPalette.goldLight, thanksPreviewPalette.white, thanksPreviewPalette.warm][i % 3], 0.22 + rng() * 0.22);
    }
  }
  drawThanksHeroText(rgba, cx, cy - 6, 1, thanksPreviewPalette.gold);
  drawSpark(rgba, cx, cy - 152, 48, thanksPreviewPalette.white, 0.38);
  return rgba;
};

const winPreviewPalette = {
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  warm: hexToRgb("#ffcf8a"),
  pink: hexToRgb("#ff4fd8"),
  white: hexToRgb("#ffffff"),
  blue: hexToRgb("#58c7ff"),
};

const drawWinHeroText = (buffer, text, cx, cy, scale = 1, accent = winPreviewPalette.gold) => {
  const size = text.length > 3 ? 178 * scale : 280 * scale;
  const glowRadius = text.length > 3 ? 520 * scale : 390 * scale;
  drawCircle(buffer, cx, cy + 8, glowRadius, accent, 0.075, 135 * scale);
  drawCircle(buffer, cx, cy + 12, glowRadius * 0.62, winPreviewPalette.goldLight, 0.055, 100 * scale);
  drawBlockText(buffer, text, cx + (8 * scale), cy + (8 * scale), size, accent, accent, 0.5);
  drawBlockText(buffer, text, cx, cy, size, winPreviewPalette.goldLight, winPreviewPalette.white, 0.98);
  drawCapsule(buffer, cx - (390 * scale), cy - (86 * scale), cx + (390 * scale), cy + (70 * scale), 8 * scale, winPreviewPalette.white, 0.4);
  drawSpark(buffer, cx + (410 * scale), cy + (78 * scale), 18 * scale, winPreviewPalette.white, 0.44);
};

const drawWinSparkField = (buffer, seed, count, cx, cy, radiusX, radiusY, colors = [winPreviewPalette.goldLight, winPreviewPalette.white, winPreviewPalette.gold]) => {
  const rng = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    const x = cx + Math.cos(angle) * radiusX * distance;
    const y = cy + Math.sin(angle) * radiusY * distance;
    const color = colors[i % colors.length];
    if (i % 7 === 0) {
      drawGoldenStar(buffer, x, y, 14 + rng() * 26, 0.46 + rng() * 0.28, rng() * TAU);
    } else {
      drawSpark(buffer, x, y, 7 + rng() * 16, color, 0.22 + rng() * 0.24);
    }
  }
};

const drawWinBeams = (buffer, cx, cy, count = 22) => {
  for (let beam = 0; beam < count; beam += 1) {
    const angle = (beam / count) * TAU;
    const length = 270 + ((beam % 5) * 92);
    const color = beam % 2 === 0 ? winPreviewPalette.goldLight : winPreviewPalette.gold;
    drawCapsule(buffer, cx + Math.cos(angle) * 66, cy + Math.sin(angle) * 38, cx + Math.cos(angle) * length, cy + Math.sin(angle) * length * 0.58, 10, color, 0.18);
    drawCapsule(buffer, cx + Math.cos(angle) * 92, cy + Math.sin(angle) * 52, cx + Math.cos(angle) * (length * 0.82), cy + Math.sin(angle) * length * 0.48, 3, winPreviewPalette.white, 0.34);
  }
};

const renderGiantWinReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 500, winPreviewPalette.gold, 0.07, 155);
  drawCircle(rgba, cx, cy + 18, 300, winPreviewPalette.white, 0.04, 110);
  drawWinSparkField(rgba, 521, 68, cx, cy, 780, 350);
  drawWinHeroText(rgba, "WIN", cx, cy - 8, 1, winPreviewPalette.gold);
  return rgba;
};

const renderBigWinJackpot = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, winPreviewPalette.warm, 0.075, 160);
  drawWinBeams(rgba, cx, cy, 24);
  drawWinSparkField(rgba, 531, 72, cx, cy, 850, 360, [winPreviewPalette.gold, winPreviewPalette.goldLight, winPreviewPalette.warm, winPreviewPalette.white]);
  drawWinHeroText(rgba, "BIG WIN", cx, cy - 4, 1, winPreviewPalette.warm);
  return rgba;
};

const renderRoyalWinCrown = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.54;
  drawCircle(rgba, cx, cy, 500, winPreviewPalette.gold, 0.065, 150);
  drawCircle(rgba, cx, cy - 190, 250, winPreviewPalette.goldLight, 0.06, 90);
  drawCrown(rgba, cx, cy - 190, 210, 0.98);
  drawWinSparkField(rgba, 541, 56, cx, cy - 60, 760, 340);
  drawWinHeroText(rgba, "WIN", cx, cy + 78, 0.92, winPreviewPalette.gold);
  return rgba;
};

const renderWinConfettiBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(551);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 510, winPreviewPalette.gold, 0.065, 150);
  for (let i = 0; i < 90; i += 1) {
    const angle = rng() * TAU;
    const distance = 110 + rng() * 860;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.66;
    const color = [winPreviewPalette.gold, winPreviewPalette.goldLight, winPreviewPalette.pink, winPreviewPalette.blue, winPreviewPalette.white][i % 5];
    if (i % 6 === 0) {
      drawRibbonTrail(rgba, [[cx, cy], [cx + Math.cos(angle) * distance * 0.48, cy + Math.sin(angle) * distance * 0.32], [x, y]], color, winPreviewPalette.white, 0.36);
    } else {
      drawRotatedRect(rgba, x, y, 10 + rng() * 22, 5 + rng() * 10, rng() * TAU, color, 0.66);
    }
  }
  drawWinHeroText(rgba, "WIN", cx, cy - 8, 0.98, winPreviewPalette.pink);
  return rgba;
};

const renderMegaWinFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 590, winPreviewPalette.gold, 0.08, 165);
  drawCircle(rgba, cx, cy, 420, winPreviewPalette.warm, 0.055, 130);
  drawWinBeams(rgba, cx, cy, 26);
  drawRing(rgba, cx, cy, 270, 12, winPreviewPalette.gold, 0.18);
  drawRing(rgba, cx, cy, 410, 10, winPreviewPalette.goldLight, 0.12);
  drawCrown(rgba, cx, cy - 208, 142, 0.82);
  drawWinSparkField(rgba, 561, 86, cx, cy, 900, 380, [winPreviewPalette.goldLight, winPreviewPalette.white, winPreviewPalette.gold, winPreviewPalette.pink]);
  drawWinHeroText(rgba, "MEGA WIN", cx, cy - 2, 1, winPreviewPalette.gold);
  return rgba;
};

const friendshipPreviewPalette = {
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  warm: hexToRgb("#ffcf8a"),
  yellow: hexToRgb("#ffd85a"),
  blue: hexToRgb("#58c7ff"),
  pink: hexToRgb("#ff8fcf"),
  white: hexToRgb("#ffffff"),
};

const drawFriendshipText = (buffer, text, cx, cy, scale = 1, accent = friendshipPreviewPalette.warm) => {
  const size = text.length > 8 ? 146 * scale : 176 * scale;
  drawCircle(buffer, cx, cy + 8, 520 * scale, accent, 0.055, 130 * scale);
  drawBlockText(buffer, text, cx + 6 * scale, cy + 7 * scale, size, accent, accent, 0.44);
  drawBlockText(buffer, text, cx, cy, size, friendshipPreviewPalette.goldLight, friendshipPreviewPalette.white, 0.96);
  drawCapsule(buffer, cx - 360 * scale, cy - 68 * scale, cx + 360 * scale, cy + 66 * scale, 7 * scale, friendshipPreviewPalette.white, 0.28);
};

const drawFriendIcon = (buffer, cx, cy, size, color, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.74, color, alpha * 0.08, size * 0.28);
  drawCircle(buffer, cx, cy - size * 0.34, size * 0.23, friendshipPreviewPalette.white, alpha * 0.9);
  drawRing(buffer, cx, cy - size * 0.34, size * 0.24, size * 0.03, color, alpha * 0.7);
  drawRotatedRect(buffer, cx, cy + size * 0.18, size * 0.72, size * 0.72, 0, color, alpha * 0.86, size * 0.16);
  drawSpark(buffer, cx + size * 0.28, cy - size * 0.45, size * 0.1, friendshipPreviewPalette.white, alpha * 0.36);
};

const drawHandshake = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.72, friendshipPreviewPalette.gold, alpha * 0.08, size * 0.24);
  drawRotatedRect(buffer, cx - size * 0.42, cy + size * 0.08, size * 0.62, size * 0.28, 0.22, friendshipPreviewPalette.blue, alpha * 0.8, size * 0.08);
  drawRotatedRect(buffer, cx + size * 0.42, cy + size * 0.08, size * 0.62, size * 0.28, -0.22, friendshipPreviewPalette.pink, alpha * 0.8, size * 0.08);
  drawRotatedRect(buffer, cx - size * 0.14, cy, size * 0.58, size * 0.3, 0.22, friendshipPreviewPalette.warm, alpha * 0.95, size * 0.1);
  drawRotatedRect(buffer, cx + size * 0.14, cy, size * 0.58, size * 0.3, -0.22, friendshipPreviewPalette.gold, alpha * 0.95, size * 0.1);
  drawRotatedRect(buffer, cx, cy, size * 0.36, size * 0.26, 0, friendshipPreviewPalette.goldLight, alpha * 0.9, size * 0.09);
  drawSpark(buffer, cx, cy - size * 0.38, size * 0.13, friendshipPreviewPalette.white, alpha * 0.42);
};

const drawFriendSparkField = (buffer, seed, count, cx, cy, radiusX, radiusY) => {
  const rng = createRng(seed);
  const colors = [friendshipPreviewPalette.goldLight, friendshipPreviewPalette.white, friendshipPreviewPalette.warm, friendshipPreviewPalette.yellow, friendshipPreviewPalette.blue];
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    const x = cx + Math.cos(angle) * radiusX * distance;
    const y = cy + Math.sin(angle) * radiusY * distance;
    const color = colors[i % colors.length];
    if (i % 6 === 0) {
      drawGoldenStar(buffer, x, y, 13 + rng() * 24, 0.42 + rng() * 0.25, rng() * TAU);
    } else {
      drawSpark(buffer, x, y, 7 + rng() * 15, color, 0.2 + rng() * 0.24);
    }
  }
};

const renderFriendshipHandshakeReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 540, friendshipPreviewPalette.warm, 0.065, 150);
  drawFriendSparkField(rgba, 571, 64, cx, cy, 820, 360);
  drawHandshake(rgba, cx, cy, 330, 0.98);
  return rgba;
};

const renderBestFriendsPop = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 520, friendshipPreviewPalette.blue, 0.055, 145);
  drawFriendIcon(rgba, cx - 150, cy + 48, 220, friendshipPreviewPalette.blue, 0.96);
  drawFriendIcon(rgba, cx + 150, cy + 48, 220, friendshipPreviewPalette.pink, 0.96);
  drawFriendSparkField(rgba, 581, 54, cx, cy, 760, 330);
  drawFriendshipText(rgba, "BEST FRIENDS", cx, HEIGHT * 0.28, 0.9, friendshipPreviewPalette.blue);
  return rgba;
};

const renderFriendshipHeartBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(591);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 540, friendshipPreviewPalette.yellow, 0.065, 150);
  for (let i = 0; i < 70; i += 1) {
    const angle = rng() * TAU;
    const distance = 120 + rng() * 820;
    drawHeart(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 22 + rng() * 36, i % 2 === 0 ? friendshipPreviewPalette.yellow : friendshipPreviewPalette.goldLight, 0.36 + rng() * 0.32, rng() * 0.5 - 0.25);
  }
  drawHeart(rgba, cx, cy, 330, friendshipPreviewPalette.yellow, 0.88);
  drawSpark(rgba, cx + 160, cy - 140, 28, friendshipPreviewPalette.white, 0.38);
  return rgba;
};

const renderFriendshipStarCircle = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 540, friendshipPreviewPalette.gold, 0.06, 150);
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * TAU;
    drawGoldenStar(rgba, cx + Math.cos(angle) * 390, cy + Math.sin(angle) * 220, 30 + (i % 3) * 5, 0.82, angle);
  }
  drawRing(rgba, cx, cy, 390, 9, friendshipPreviewPalette.goldLight, 0.14);
  drawFriendshipText(rgba, "FRIENDSHIP", cx, cy, 0.92, friendshipPreviewPalette.gold);
  return rgba;
};

const renderFriendshipGrandFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(611);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 570, friendshipPreviewPalette.warm, 0.07, 160);
  for (let i = 0; i < 82; i += 1) {
    const angle = rng() * TAU;
    const distance = 110 + rng() * 850;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.62;
    if (i % 3 === 0) {
      drawHeart(rgba, x, y, 18 + rng() * 30, friendshipPreviewPalette.yellow, 0.4 + rng() * 0.28, rng() * 0.6 - 0.3);
    } else if (i % 3 === 1) {
      drawGoldenStar(rgba, x, y, 14 + rng() * 26, 0.42 + rng() * 0.28, rng() * TAU);
    } else {
      drawSpark(rgba, x, y, 7 + rng() * 14, friendshipPreviewPalette.white, 0.22 + rng() * 0.22);
    }
  }
  drawFriendIcon(rgba, cx - 150, cy + 110, 172, friendshipPreviewPalette.blue, 0.92);
  drawFriendIcon(rgba, cx + 150, cy + 110, 172, friendshipPreviewPalette.pink, 0.92);
  drawFriendshipText(rgba, "FRIENDSHIP", cx, HEIGHT * 0.3, 0.92, friendshipPreviewPalette.warm);
  return rgba;
};

const casinoEmotionPreviewPalette = {
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  white: hexToRgb("#ffffff"),
  pink: hexToRgb("#ff4fd8"),
  cyan: hexToRgb("#58c7ff"),
  green: hexToRgb("#23bf66"),
  orange: hexToRgb("#ff7a1a"),
  red: hexToRgb("#ff3f35"),
  purple: hexToRgb("#8f5bff"),
};

const drawCasinoEmotionText = (buffer, text, cx, cy, scale = 1, accent = casinoEmotionPreviewPalette.gold) => {
  const size = text.length > 9 ? 150 * scale : text.length > 6 ? 182 * scale : 230 * scale;
  drawCircle(buffer, cx, cy + 6, 560 * scale, accent, 0.06, 145 * scale);
  drawCircle(buffer, cx, cy + 10, 330 * scale, casinoEmotionPreviewPalette.goldLight, 0.04, 110 * scale);
  drawBlockText(buffer, text, cx + 7 * scale, cy + 8 * scale, size, accent, accent, 0.45);
  drawBlockText(buffer, text, cx, cy, size, casinoEmotionPreviewPalette.goldLight, casinoEmotionPreviewPalette.white, 0.98);
  drawCapsule(buffer, cx - 420 * scale, cy - 76 * scale, cx + 420 * scale, cy + 72 * scale, 8 * scale, casinoEmotionPreviewPalette.white, 0.3);
};

const drawCasinoSparkField = (buffer, seed, count, cx, cy, radiusX, radiusY, colors = [casinoEmotionPreviewPalette.gold, casinoEmotionPreviewPalette.goldLight, casinoEmotionPreviewPalette.white]) => {
  const rng = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    const x = cx + Math.cos(angle) * radiusX * distance;
    const y = cy + Math.sin(angle) * radiusY * distance;
    const color = colors[i % colors.length];
    if (i % 8 === 0) {
      drawGoldenStar(buffer, x, y, 14 + rng() * 26, 0.42 + rng() * 0.28, rng() * TAU);
    } else {
      drawSpark(buffer, x, y, 7 + rng() * 16, color, 0.2 + rng() * 0.25);
    }
  }
};

const drawCasinoBeams = (buffer, cx, cy, count = 24, color = casinoEmotionPreviewPalette.gold) => {
  for (let beam = 0; beam < count; beam += 1) {
    const angle = (beam / count) * TAU;
    const length = 270 + ((beam % 5) * 90);
    drawCapsule(buffer, cx + Math.cos(angle) * 68, cy + Math.sin(angle) * 40, cx + Math.cos(angle) * length, cy + Math.sin(angle) * length * 0.58, 10, color, 0.16);
    drawCapsule(buffer, cx + Math.cos(angle) * 96, cy + Math.sin(angle) * 54, cx + Math.cos(angle) * (length * 0.82), cy + Math.sin(angle) * length * 0.48, 3, casinoEmotionPreviewPalette.white, 0.32);
  }
};

const drawDicePreview = (buffer, cx, cy, size, accent, rotation = 0, alpha = 1) => {
  drawRotatedRect(buffer, cx, cy, size * 1.08, size * 1.08, rotation, accent, alpha * 0.12, size * 0.18);
  drawRotatedRect(buffer, cx, cy, size, size, rotation, casinoEmotionPreviewPalette.white, alpha * 0.92, size * 0.15);
  drawRotatedRect(buffer, cx, cy, size, size, rotation, accent, alpha * 0.18, size * 0.15);
  const pips = [[-0.25, -0.25], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25], [0, 0]];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (const [px, py] of pips) {
    const x = cx + ((px * size) * cos) - ((py * size) * sin);
    const y = cy + ((px * size) * sin) + ((py * size) * cos);
    drawCircle(buffer, x, y, size * 0.065, hexToRgb("#151428"), alpha * 0.88);
  }
};

const drawFlamePreview = (buffer, cx, cy, size, color, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.65, color, alpha * 0.08, size * 0.28);
  drawPolygon(buffer, [
    [cx, cy - size * 0.62],
    [cx + size * 0.28, cy - size * 0.12],
    [cx + size * 0.2, cy + size * 0.34],
    [cx, cy + size * 0.62],
    [cx - size * 0.22, cy + size * 0.32],
    [cx - size * 0.28, cy - size * 0.12],
  ], color, alpha * 0.9, 1.2);
  drawPolygon(buffer, [
    [cx, cy - size * 0.24],
    [cx + size * 0.13, cy + size * 0.12],
    [cx, cy + size * 0.4],
    [cx - size * 0.13, cy + size * 0.1],
  ], casinoEmotionPreviewPalette.goldLight, alpha * 0.55, 1);
};

const drawDevilPreview = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.72, casinoEmotionPreviewPalette.purple, alpha * 0.12, size * 0.28);
  drawPolygon(buffer, [[cx - size * 0.34, cy - size * 0.32], [cx - size * 0.52, cy - size * 0.72], [cx - size * 0.16, cy - size * 0.46]], casinoEmotionPreviewPalette.purple, alpha * 0.9, 1.2);
  drawPolygon(buffer, [[cx + size * 0.34, cy - size * 0.32], [cx + size * 0.52, cy - size * 0.72], [cx + size * 0.16, cy - size * 0.46]], casinoEmotionPreviewPalette.purple, alpha * 0.9, 1.2);
  drawCircle(buffer, cx, cy, size * 0.48, casinoEmotionPreviewPalette.red, alpha * 0.94);
  drawCapsule(buffer, cx - size * 0.28, cy - size * 0.12, cx - size * 0.1, cy - size * 0.04, size * 0.04, casinoEmotionPreviewPalette.white, alpha * 0.88);
  drawCapsule(buffer, cx + size * 0.28, cy - size * 0.12, cx + size * 0.1, cy - size * 0.04, size * 0.04, casinoEmotionPreviewPalette.white, alpha * 0.88);
  drawCapsule(buffer, cx - size * 0.2, cy + size * 0.2, cx, cy + size * 0.3, size * 0.035, casinoEmotionPreviewPalette.white, alpha * 0.82);
  drawCapsule(buffer, cx, cy + size * 0.3, cx + size * 0.2, cy + size * 0.2, size * 0.035, casinoEmotionPreviewPalette.white, alpha * 0.82);
  drawSpark(buffer, cx + size * 0.34, cy - size * 0.5, size * 0.12, casinoEmotionPreviewPalette.white, alpha * 0.38);
};

const renderJackpotFever = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 590, casinoEmotionPreviewPalette.gold, 0.075, 165);
  drawCasinoBeams(rgba, cx, cy, 26, casinoEmotionPreviewPalette.gold);
  drawCasinoSparkField(rgba, 621, 82, cx, cy, 900, 380);
  drawCasinoEmotionText(rgba, "JACKPOT!", cx, cy, 1, casinoEmotionPreviewPalette.gold);
  return rgba;
};

const renderBingoShock = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 540, casinoEmotionPreviewPalette.cyan, 0.06, 150);
  drawRing(rgba, cx, cy, 240, 14, casinoEmotionPreviewPalette.cyan, 0.18);
  drawRing(rgba, cx, cy, 410, 10, casinoEmotionPreviewPalette.gold, 0.12);
  drawBingoBall(rgba, 430, 320, 86, ballPalette[1].color, ballPalette[1].digit, 0.9);
  drawBingoBall(rgba, 1510, 340, 92, ballPalette[2].color, ballPalette[2].digit, 0.9);
  drawBingoBall(rgba, 700, 650, 76, ballPalette[4].color, ballPalette[4].digit, 0.82);
  drawBingoBall(rgba, 1260, 650, 82, ballPalette[0].color, ballPalette[0].digit, 0.86);
  drawCasinoSparkField(rgba, 631, 48, cx, cy, 800, 350, [casinoEmotionPreviewPalette.cyan, casinoEmotionPreviewPalette.goldLight, casinoEmotionPreviewPalette.white]);
  drawCasinoEmotionText(rgba, "BINGO!", cx, cy - 8, 1, casinoEmotionPreviewPalette.cyan);
  return rgba;
};

const renderOmgBigWin = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 530, casinoEmotionPreviewPalette.pink, 0.07, 150);
  drawRing(rgba, cx, cy, 220, 14, casinoEmotionPreviewPalette.pink, 0.2);
  drawRing(rgba, cx, cy, 360, 10, casinoEmotionPreviewPalette.gold, 0.14);
  drawCasinoSparkField(rgba, 641, 72, cx, cy, 850, 360, [casinoEmotionPreviewPalette.pink, casinoEmotionPreviewPalette.goldLight, casinoEmotionPreviewPalette.white]);
  drawCasinoEmotionText(rgba, "OMG!", cx, cy, 1.04, casinoEmotionPreviewPalette.pink);
  return rgba;
};

const renderHotStreak = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(651);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 560, casinoEmotionPreviewPalette.orange, 0.075, 160);
  for (let i = 0; i < 26; i += 1) {
    const angle = rng() * TAU;
    const distance = 180 + rng() * 760;
    drawFlamePreview(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 52 + rng() * 44, i % 2 === 0 ? casinoEmotionPreviewPalette.orange : casinoEmotionPreviewPalette.red, 0.42 + rng() * 0.3);
  }
  drawCasinoSparkField(rgba, 652, 46, cx, cy, 800, 330, [casinoEmotionPreviewPalette.orange, casinoEmotionPreviewPalette.red, casinoEmotionPreviewPalette.goldLight]);
  drawCasinoEmotionText(rgba, "HOT STREAK!", cx, cy - 4, 0.96, casinoEmotionPreviewPalette.orange);
  return rgba;
};

const renderLuckyDiamondHit = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 540, casinoEmotionPreviewPalette.cyan, 0.065, 150);
  drawCasinoBeams(rgba, cx, cy, 22, casinoEmotionPreviewPalette.cyan);
  drawCasinoSparkField(rgba, 661, 64, cx, cy, 860, 360, [casinoEmotionPreviewPalette.cyan, casinoEmotionPreviewPalette.white, casinoEmotionPreviewPalette.goldLight]);
  drawPremiumDiamond(rgba, cx, cy, 245, 0.98);
  return rgba;
};

const renderLuckyRoll = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.54;
  drawCircle(rgba, cx, cy, 520, casinoEmotionPreviewPalette.green, 0.065, 150);
  drawDicePreview(rgba, cx - 210, cy + 60, 180, casinoEmotionPreviewPalette.green, -0.22, 0.96);
  drawDicePreview(rgba, cx + 210, cy + 58, 180, casinoEmotionPreviewPalette.gold, 0.24, 0.96);
  drawCasinoSparkField(rgba, 671, 54, cx, cy, 780, 330, [casinoEmotionPreviewPalette.green, casinoEmotionPreviewPalette.goldLight, casinoEmotionPreviewPalette.white]);
  drawCasinoEmotionText(rgba, "LUCKY!", cx, HEIGHT * 0.32, 0.92, casinoEmotionPreviewPalette.green);
  return rgba;
};

const renderElectricWinPulse = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, casinoEmotionPreviewPalette.cyan, 0.07, 160);
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * TAU;
    drawLightning(rgba, cx + Math.cos(angle) * 360, cy + Math.sin(angle) * 180, 0.72 + (i % 3) * 0.12, casinoEmotionPreviewPalette.white, casinoEmotionPreviewPalette.cyan, angle, 0.78);
  }
  drawRing(rgba, cx, cy, 220, 15, casinoEmotionPreviewPalette.cyan, 0.2);
  drawRing(rgba, cx, cy, 390, 10, casinoEmotionPreviewPalette.white, 0.12);
  drawCasinoSparkField(rgba, 681, 46, cx, cy, 760, 330, [casinoEmotionPreviewPalette.cyan, casinoEmotionPreviewPalette.white]);
  return rgba;
};

const renderMoneyRush = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(691);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 570, casinoEmotionPreviewPalette.gold, 0.07, 160);
  for (let i = 0; i < 60; i += 1) {
    const angle = rng() * TAU;
    const distance = 110 + rng() * 860;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.6;
    if (i % 3 === 0) drawMoneySymbol(rgba, x, y, 38 + rng() * 34, i % 2 === 0 ? casinoEmotionPreviewPalette.gold : casinoEmotionPreviewPalette.green, 0.62);
    else drawSpark(rgba, x, y, 8 + rng() * 16, casinoEmotionPreviewPalette.goldLight, 0.24 + rng() * 0.22);
  }
  drawCasinoEmotionText(rgba, "BIG WIN!", cx, cy, 0.98, casinoEmotionPreviewPalette.green);
  return rgba;
};

const renderTrollWin = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 520, casinoEmotionPreviewPalette.purple, 0.065, 150);
  drawDevilPreview(rgba, cx, cy + 54, 250, 0.96);
  drawRing(rgba, cx, cy, 230, 13, casinoEmotionPreviewPalette.purple, 0.18);
  drawCasinoSparkField(rgba, 701, 50, cx, cy, 760, 330, [casinoEmotionPreviewPalette.purple, casinoEmotionPreviewPalette.red, casinoEmotionPreviewPalette.white]);
  drawCasinoEmotionText(rgba, "HAHA!", cx, HEIGHT * 0.3, 0.9, casinoEmotionPreviewPalette.purple);
  return rgba;
};

const renderMiracleHit = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 590, casinoEmotionPreviewPalette.goldLight, 0.075, 165);
  drawCasinoBeams(rgba, cx, cy, 26, casinoEmotionPreviewPalette.goldLight);
  drawCasinoSparkField(rgba, 711, 86, cx, cy, 900, 380, [casinoEmotionPreviewPalette.goldLight, casinoEmotionPreviewPalette.white, casinoEmotionPreviewPalette.gold]);
  drawCasinoEmotionText(rgba, "MIRACLE!", cx, cy, 1, casinoEmotionPreviewPalette.goldLight);
  return rgba;
};

const laughterPreviewPalette = {
  yellow: hexToRgb("#ffd85a"),
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  orange: hexToRgb("#ff9c36"),
  pink: hexToRgb("#ff4fd8"),
  cyan: hexToRgb("#58c7ff"),
  white: hexToRgb("#ffffff"),
  dark: hexToRgb("#24130a"),
};

const drawLaughterText = (buffer, text, cx, cy, scale = 1, accent = laughterPreviewPalette.orange) => {
  const size = text.length > 7 ? 172 * scale : text.length > 4 ? 210 * scale : 280 * scale;
  drawCircle(buffer, cx, cy + 6, 540 * scale, accent, 0.06, 140 * scale);
  drawBlockText(buffer, text, cx + 7 * scale, cy + 8 * scale, size, accent, accent, 0.46);
  drawBlockText(buffer, text, cx, cy, size, laughterPreviewPalette.goldLight, laughterPreviewPalette.white, 0.98);
  drawCapsule(buffer, cx - 390 * scale, cy - 78 * scale, cx + 390 * scale, cy + 70 * scale, 8 * scale, laughterPreviewPalette.white, 0.3);
};

const drawLaughEmoji = (buffer, cx, cy, size, alpha = 1, rotation = 0) => {
  drawCircle(buffer, cx, cy, size * 0.62, laughterPreviewPalette.yellow, alpha * 0.12, size * 0.2);
  drawCircle(buffer, cx, cy, size * 0.5, laughterPreviewPalette.yellow, alpha * 0.96);
  drawCapsule(buffer, cx - size * 0.26, cy - size * 0.08, cx - size * 0.08, cy - size * 0.14, size * 0.035, laughterPreviewPalette.dark, alpha * 0.9);
  drawCapsule(buffer, cx + size * 0.26, cy - size * 0.08, cx + size * 0.08, cy - size * 0.14, size * 0.035, laughterPreviewPalette.dark, alpha * 0.9);
  drawCircle(buffer, cx, cy + size * 0.18, size * 0.19, laughterPreviewPalette.dark, alpha * 0.86);
  drawCapsule(buffer, cx - size * 0.12, cy + size * 0.1, cx + size * 0.12, cy + size * 0.1, size * 0.035, laughterPreviewPalette.white, alpha * 0.34);
  drawCircle(buffer, cx - size * 0.36, cy + size * 0.06, size * 0.055, laughterPreviewPalette.cyan, alpha * 0.82);
  drawCircle(buffer, cx + size * 0.36, cy + size * 0.06, size * 0.055, laughterPreviewPalette.cyan, alpha * 0.82);
  drawSpark(buffer, cx + Math.cos(rotation) * size * 0.4, cy - size * 0.42, size * 0.1, laughterPreviewPalette.white, alpha * 0.34);
};

const drawLaughSparkField = (buffer, seed, count, cx, cy, radiusX, radiusY) => {
  const rng = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    const x = cx + Math.cos(angle) * radiusX * distance;
    const y = cy + Math.sin(angle) * radiusY * distance;
    if (i % 5 === 0) {
      drawLaughEmoji(buffer, x, y, 34 + rng() * 42, 0.38 + rng() * 0.32, rng() * TAU);
    } else {
      drawSpark(buffer, x, y, 7 + rng() * 15, [laughterPreviewPalette.goldLight, laughterPreviewPalette.white, laughterPreviewPalette.orange][i % 3], 0.22 + rng() * 0.24);
    }
  }
};

const renderGiantLolBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, laughterPreviewPalette.yellow, 0.07, 155);
  drawRing(rgba, cx, cy, 240, 14, laughterPreviewPalette.orange, 0.18);
  drawRing(rgba, cx, cy, 400, 10, laughterPreviewPalette.white, 0.1);
  drawLaughSparkField(rgba, 721, 68, cx, cy, 850, 360);
  drawLaughterText(rgba, "LOL", cx, cy, 1, laughterPreviewPalette.orange);
  return rgba;
};

const renderLaughingEmojiStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 540, laughterPreviewPalette.yellow, 0.065, 150);
  drawLaughSparkField(rgba, 731, 82, cx, cy, 900, 380);
  drawLaughEmoji(rgba, cx, cy, 330, 0.98);
  return rgba;
};

const renderHahahaTextWave = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(741);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, laughterPreviewPalette.orange, 0.065, 150);
  for (let i = 0; i < 12; i += 1) {
    const x = 120 + i * 160;
    const y = HEIGHT * 0.24 + Math.sin(i * 0.75) * 90;
    drawBlockText(rgba, "HA", x, y, 78 + rng() * 18, i % 2 === 0 ? laughterPreviewPalette.goldLight : laughterPreviewPalette.orange, laughterPreviewPalette.white, 0.44);
  }
  drawRing(rgba, cx, cy, 290, 11, laughterPreviewPalette.orange, 0.14);
  drawLaughSparkField(rgba, 742, 42, cx, cy, 760, 330);
  drawLaughterText(rgba, "HAHAHA!", cx, cy + 20, 0.94, laughterPreviewPalette.orange);
  return rgba;
};

const renderRoflJackpot = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 550, laughterPreviewPalette.pink, 0.07, 155);
  drawRing(rgba, cx, cy, 230, 14, laughterPreviewPalette.pink, 0.2);
  drawRing(rgba, cx, cy, 390, 10, laughterPreviewPalette.yellow, 0.12);
  drawLaughSparkField(rgba, 751, 62, cx, cy, 820, 350);
  drawLaughterText(rgba, "ROFL!", cx, cy, 1, laughterPreviewPalette.pink);
  return rgba;
};

const renderLaughterGrandFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 590, laughterPreviewPalette.yellow, 0.075, 165);
  drawLaughSparkField(rgba, 761, 92, cx, cy, 900, 390);
  for (let i = 0; i < 8; i += 1) {
    drawBlockText(rgba, "HAHA", 160 + i * 230, 190 + (i % 3) * 86, 62, laughterPreviewPalette.orange, laughterPreviewPalette.white, 0.36);
  }
  drawLaughterText(rgba, "LOL!", cx, cy + 10, 1, laughterPreviewPalette.orange);
  return rgba;
};

const renderJackpotParadeBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(171);
  const originX = WIDTH * 0.5;
  const originY = 620;

  for (let beam = 0; beam < 16; beam += 1) {
    const angle = -0.86 + ((beam / 15) * 1.72);
    const length = 300 + ((beam % 5) * 120);
    const color = [palette.gold, palette.orange, palette.pink, palette.blue][beam % 4];
    drawCapsule(rgba, originX, originY, originX + (Math.sin(angle) * 140), originY - length, 14 + (beam % 3), color, 0.14);
  }

  drawRing(rgba, originX, originY, 180, 12, palette.gold, 0.22);
  drawRing(rgba, originX, originY, 280, 10, palette.pink, 0.14);
  drawRing(rgba, originX, originY, 372, 10, palette.blue, 0.1);

  const heroBalls = [
    { x: 420, y: 566, radius: 110, body: ballPalette[4] },
    { x: 1504, y: 520, radius: 118, body: ballPalette[0] },
    { x: 960, y: 548, radius: 126, body: ballPalette[1] },
    { x: 548, y: 404, radius: 96, body: ballPalette[2] },
    { x: 1388, y: 388, radius: 106, body: ballPalette[3] },
  ];

  for (const ball of heroBalls) {
    drawBingoBall(rgba, ball.x, ball.y, ball.radius, ball.body.color, ball.body.digit, 0.98);
    drawSpark(rgba, ball.x + (ball.radius * 0.74), ball.y - (ball.radius * 0.74), 10, palette.white, 0.36);
  }

  drawFirework(rgba, 286, 228, 188, 18, palette.pink, palette.white, 0.92);
  drawFirework(rgba, 1624, 246, 196, 18, palette.blue, palette.white, 0.92);

  for (let coin = 0; coin < 22; coin += 1) {
    const angle = (-Math.PI * 0.92) + (rng() * (Math.PI * 0.84));
    const distance = 240 + (rng() * 900);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY + (Math.sin(angle) * distance * 0.6);
    drawCoin(rgba, x, y, 18 + (rng() * 30), 0.94, rng() * TAU);
  }

  for (let confetti = 0; confetti < 52; confetti += 1) {
    const x = 90 + (rng() * (WIDTH - 180));
    const y = 90 + (rng() * 780);
    const width = 14 + (rng() * 24);
    const height = 7 + (rng() * 12);
    const angle = rng() * TAU;
    const color = [palette.gold, palette.pink, palette.blue, palette.white][confetti % 4];
    drawRotatedRect(rgba, x, y, width, height, angle, color, 0.92);
  }

  for (let spark = 0; spark < 36; spark += 1) {
    const angle = (spark / 36) * TAU;
    const distance = 140 + ((spark % 6) * 64);
    drawSpark(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.62), 10 + (spark % 4), spark % 2 === 0 ? palette.goldLight : palette.blue, 0.5);
  }

  return rgba;
};

const renderRoyalBingoFireworks = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(191);
  const originX = WIDTH * 0.5;
  const originY = 570;

  const bursts = [
    { x: 218, y: 236, radius: 172, color: palette.blue, accent: palette.white },
    { x: 520, y: 294, radius: 148, color: palette.pink, accent: palette.white },
    { x: 960, y: 176, radius: 258, color: palette.gold, accent: palette.goldLight },
    { x: 1388, y: 256, radius: 176, color: palette.orange, accent: palette.goldLight },
    { x: 1714, y: 226, radius: 188, color: palette.purple, accent: palette.white },
  ];

  for (const burst of bursts) {
    drawCapsule(rgba, originX, originY, burst.x, burst.y + (burst.radius * 0.22), 6, palette.gold, 0.18);
    drawFirework(rgba, burst.x, burst.y, burst.radius, 22, burst.color, burst.accent, 0.96);
  }

  drawRing(rgba, originX, originY, 180, 12, palette.gold, 0.18);
  drawRing(rgba, originX, originY, 286, 10, palette.purple, 0.12);

  for (const [index, x] of [540, 960, 1380].entries()) {
    const body = [ballPalette[1], ballPalette[4], ballPalette[3]][index];
    drawBingoBall(rgba, x, 646, 88 + (index * 6), body.color, body.digit, 0.98);
  }

  for (let shard = 0; shard < 26; shard += 1) {
    const angle = (shard / 26) * TAU;
    const distance = 160 + ((shard % 5) * 84);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY + (Math.sin(angle) * distance * 0.7);
    const color = [palette.gold, palette.orange, palette.blue, palette.pink][shard % 4];
    drawDiamond(rgba, x, y, 28 + ((shard % 4) * 8), rng() * TAU, color, 0.92);
  }

  for (let spark = 0; spark < 32; spark += 1) {
    const x = 160 + (rng() * (WIDTH - 320));
    const y = 120 + (rng() * 760);
    drawSpark(rgba, x, y, 8 + (spark % 4), spark % 2 === 0 ? palette.goldLight : palette.white, 0.42);
  }

  return rgba;
};

const renderLuckyNumberRush = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const originX = WIDTH * 0.5;
  const originY = 520;

  drawRing(rgba, originX, originY, 180, 12, palette.blue, 0.2);
  drawRing(rgba, originX, originY, 278, 10, palette.purple, 0.14);
  drawRing(rgba, originX, originY, 368, 10, palette.green, 0.1);

  const balls = [
    { x: 418, y: 380, radius: 120, body: ballPalette[2] },
    { x: 1500, y: 396, radius: 112, body: ballPalette[3] },
    { x: 960, y: 536, radius: 126, body: ballPalette[1] },
    { x: 520, y: 596, radius: 96, body: ballPalette[0] },
    { x: 1404, y: 562, radius: 104, body: ballPalette[4] },
    { x: 716, y: 492, radius: 86, body: { color: palette.green, digit: 6 } },
  ];

  for (const ball of balls) {
    drawBingoBall(rgba, ball.x, ball.y, ball.radius, ball.body.color, ball.body.digit, 0.98);
    drawCapsule(rgba, ball.x - (ball.radius * 2), ball.y + (ball.radius * 0.2), ball.x - (ball.radius * 0.46), ball.y + (ball.radius * 0.08), 8, palette.white, 0.14);
    drawCapsule(rgba, ball.x - (ball.radius * 2), ball.y + (ball.radius * 0.2), ball.x - (ball.radius * 0.46), ball.y + (ball.radius * 0.08), 2.4, ball.body.color, 0.54);
  }

  for (let streak = 0; streak < 24; streak += 1) {
    const angle = (streak / 24) * TAU;
    const distance = 180 + ((streak % 6) * 94);
    const x2 = originX + (Math.cos(angle) * distance);
    const y2 = originY + (Math.sin(angle) * distance * 0.72);
    const color = [palette.blue, palette.purple, palette.green, palette.white][streak % 4];
    drawCapsule(rgba, originX, originY, x2, y2, 7, color, 0.16);
    drawCapsule(rgba, originX, originY, x2, y2, 2.2, palette.white, 0.76);
  }

  for (let spark = 0; spark < 28; spark += 1) {
    const angle = (spark / 28) * TAU;
    const distance = 120 + ((spark % 7) * 54);
    drawSpark(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.62), 10 + (spark % 5), spark % 3 === 0 ? palette.blue : spark % 3 === 1 ? palette.purple : palette.green, 0.48);
  }

  return rgba;
};

const renderVegasGoldCascade = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(219);
  const originX = WIDTH * 0.5;
  const originY = 420;

  for (let beam = 0; beam < 12; beam += 1) {
    const angle = -0.72 + ((beam / 11) * 1.44);
    const length = 320 + ((beam % 4) * 110);
    drawCapsule(rgba, originX, originY + 140, originX + (Math.sin(angle) * 110), originY - length, 12 + (beam % 3), beam % 2 === 0 ? palette.gold : palette.orange, 0.12);
  }

  drawRing(rgba, originX, originY, 180, 12, palette.gold, 0.22);
  drawRing(rgba, originX, originY, 284, 10, palette.orange, 0.12);

  for (let coin = 0; coin < 36; coin += 1) {
    const x = 100 + (rng() * (WIDTH - 200));
    const y = 48 + (rng() * 860);
    drawCoin(rgba, x, y, 18 + (rng() * 28), 0.96, rng() * TAU);
  }

  for (let shard = 0; shard < 26; shard += 1) {
    const x = 120 + (rng() * (WIDTH - 240));
    const y = 60 + (rng() * 820);
    drawDiamond(rgba, x, y, 24 + (rng() * 24), rng() * TAU, shard % 2 === 0 ? palette.goldLight : palette.orange, 0.9);
  }

  drawBingoBall(rgba, 540, 252, 88, ballPalette[4].color, ballPalette[4].digit, 0.98);
  drawBingoBall(rgba, 960, 224, 96, ballPalette[0].color, ballPalette[0].digit, 0.98);
  drawBingoBall(rgba, 1380, 252, 92, ballPalette[1].color, ballPalette[1].digit, 0.98);

  for (let spark = 0; spark < 30; spark += 1) {
    const angle = (spark / 30) * TAU;
    const distance = 120 + ((spark % 6) * 58);
    drawSpark(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.64), 10 + (spark % 4), spark % 2 === 0 ? palette.goldLight : palette.white, 0.42);
  }

  return rgba;
};

const renderShowtimeBingoFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(243);
  const originX = WIDTH * 0.5;
  const originY = 596;

  for (let beam = 0; beam < 18; beam += 1) {
    const angle = -0.9 + ((beam / 17) * 1.8);
    const length = 320 + ((beam % 5) * 118);
    const color = [palette.gold, palette.blue, palette.pink, palette.purple][beam % 4];
    drawCapsule(rgba, originX, originY, originX + (Math.sin(angle) * 150), originY - length, 14 + (beam % 4), color, 0.12);
  }

  const bursts = [
    { x: 220, y: 220, radius: 178, color: palette.blue, accent: palette.white },
    { x: 620, y: 274, radius: 156, color: palette.pink, accent: palette.white },
    { x: 960, y: 166, radius: 278, color: palette.gold, accent: palette.goldLight },
    { x: 1320, y: 242, radius: 188, color: palette.orange, accent: palette.goldLight },
    { x: 1708, y: 254, radius: 192, color: palette.purple, accent: palette.white },
  ];

  for (const burst of bursts) {
    drawCapsule(rgba, originX, originY, burst.x, burst.y + (burst.radius * 0.22), 6.4, palette.gold, 0.18);
    drawFirework(rgba, burst.x, burst.y, burst.radius, 22, burst.color, burst.accent, 0.98);
  }

  drawRing(rgba, originX, originY, 174, 12, palette.gold, 0.18);
  drawRing(rgba, originX, originY, 272, 10, palette.pink, 0.1);

  const heroBalls = [
    { x: 380, y: 560, radius: 108, body: ballPalette[2] },
    { x: 1540, y: 556, radius: 112, body: ballPalette[3] },
    { x: 960, y: 590, radius: 118, body: ballPalette[1] },
    { x: 520, y: 380, radius: 96, body: ballPalette[0] },
    { x: 1408, y: 400, radius: 104, body: ballPalette[4] },
  ];

  for (const ball of heroBalls) {
    drawBingoBall(rgba, ball.x, ball.y, ball.radius, ball.body.color, ball.body.digit, 0.98);
  }

  drawLightning(rgba, 520, 320, 1.04, palette.white, palette.blue, -0.22, 0.92);
  drawLightning(rgba, 1420, 300, 1.08, palette.white, palette.purple, 0.24, 0.92);
  drawLightning(rgba, 980, 620, 0.76, palette.white, palette.blue, 0.08, 0.7);

  for (let coin = 0; coin < 26; coin += 1) {
    const angle = (-Math.PI * 0.96) + (rng() * (Math.PI * 0.92));
    const distance = 220 + (rng() * 940);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY + (Math.sin(angle) * distance * 0.58);
    drawCoin(rgba, x, y, 18 + (rng() * 28), 0.96, rng() * TAU);
  }

  for (let confetti = 0; confetti < 62; confetti += 1) {
    const x = 80 + (rng() * (WIDTH - 160));
    const y = 96 + (rng() * 790);
    const width = 14 + (rng() * 28);
    const height = 7 + (rng() * 12);
    const angle = rng() * TAU;
    const color = [palette.gold, palette.pink, palette.blue, palette.purple, palette.orange][confetti % 5];
    drawRotatedRect(rgba, x, y, width, height, angle, color, 0.94);
  }

  for (let spark = 0; spark < 44; spark += 1) {
    const angle = (spark / 44) * TAU;
    const distance = 150 + ((spark % 7) * 58);
    drawSpark(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.56), 10 + (spark % 5), spark % 3 === 0 ? palette.goldLight : spark % 3 === 1 ? palette.blue : palette.pink, 0.48);
  }

  return rgba;
};

const renderPremiumFullscreenOverlay = (seed) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(seed);
  const centerX = WIDTH * (0.46 + (((seed >>> 3) % 4) * 0.04));
  const centerY = HEIGHT * (0.58 + (((seed >>> 1) % 3) * 0.03));
  const colors = [palette.gold, palette.goldLight, palette.blue, palette.pink, palette.purple, palette.orange, palette.green, palette.white];
  const pick = (offset) => colors[(offset + (seed % colors.length)) % colors.length];

  drawCircle(rgba, centerX, centerY, 188, pick(0), 0.05, 64);
  drawCircle(rgba, centerX - 52, centerY + 20, 296, pick(2), 0.032, 92);
  drawCircle(rgba, centerX + 40, centerY - 12, 224, pick(3), 0.028, 80);
  drawRing(rgba, centerX, centerY, 190, 10, pick(0), 0.14);
  drawRing(rgba, centerX, centerY, 312, 8, pick(3), 0.09);
  drawRing(rgba, centerX, centerY, 430, 7, pick(2), 0.04);

  for (let dust = 0; dust < 48; dust += 1) {
    const x = 70 + (rng() * (WIDTH - 140));
    const y = 70 + (rng() * (HEIGHT - 140));
    const size = 4 + (rng() * 9);
    const color = pick(dust % 6);
    drawCircle(rgba, x, y, size, color, 0.07 + (rng() * 0.06));
    if (dust % 2 === 0) {
      drawSpark(rgba, x, y, size * 0.9, pick(7), 0.16 + (rng() * 0.08));
    }
  }

  for (let streak = 0; streak < 18; streak += 1) {
    const angle = -1.14 + ((streak / 17) * 2.28);
    const length = 140 + ((streak % 4) * 90);
    const x2 = centerX + (Math.cos(angle) * length);
    const y2 = centerY + (Math.sin(angle) * length * 0.76);
    drawCapsule(rgba, centerX, centerY, x2, y2, 7, pick((streak + 2) % 6), 0.14);
    drawCapsule(rgba, centerX, centerY, x2, y2, 2.6, palette.white, 0.4);
  }

  for (let confetti = 0; confetti < 42; confetti += 1) {
    const x = 60 + (rng() * (WIDTH - 120));
    const y = 50 + (rng() * (HEIGHT - 100));
    const width = 12 + (rng() * 24);
    const height = 6 + (rng() * 12);
    drawRotatedRect(rgba, x, y, width, height, rng() * TAU, pick(confetti % 6), 0.56);
  }

  for (let objectIndex = 0; objectIndex < 18; objectIndex += 1) {
    const x = 90 + (rng() * (WIDTH - 180));
    const y = 60 + (rng() * (HEIGHT - 120));
    if (objectIndex % 3 === 0) {
      drawCoin(rgba, x, y, 16 + (rng() * 20), 0.32 + (rng() * 0.16), rng() * TAU);
    } else if (objectIndex % 3 === 1) {
      drawDiamond(rgba, x, y, 22 + (rng() * 20), rng() * TAU, pick(objectIndex % 6), 0.38 + (rng() * 0.18));
    } else {
      drawSpark(rgba, x, y, 12 + (rng() * 12), pick(objectIndex % 6), 0.28 + (rng() * 0.14));
    }
  }

  for (let foreground = 0; foreground < 10; foreground += 1) {
    const x = foreground % 2 === 0 ? -140 + (foreground * 54) : WIDTH + 140 - (foreground * 48);
    const y = 120 + ((foreground % 5) * 150);
    const x2 = foreground % 2 === 0 ? WIDTH + 120 : -120;
    drawCapsule(rgba, x, y, x2, y + 42, 10 + (foreground % 3) * 2, pick((foreground + 2) % 6), 0.06);
    drawCapsule(rgba, x + 24, y + 4, x2 - 24, y + 36, 3.4, palette.white, 0.1);
  }

  return rgba;
};

const starPolygonPoints = (cx, cy, outerRadius, innerRadius, rotation = -Math.PI / 2) => {
  const points = [];
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation + ((point / 10) * TAU);
    points.push([cx + (Math.cos(angle) * radius), cy + (Math.sin(angle) * radius)]);
  }
  return points;
};

const drawGoldenStar = (buffer, cx, cy, size, alpha = 1, rotation = 0) => {
  drawPolygon(buffer, starPolygonPoints(cx, cy, size * 1.22, size * 0.54, rotation - (Math.PI / 2)), palette.gold, alpha * 0.12, 2.4);
  drawPolygon(buffer, starPolygonPoints(cx, cy, size, size * 0.44, rotation - (Math.PI / 2)), palette.gold, alpha * 0.96, 1.3);
  drawPolygon(buffer, starPolygonPoints(cx, cy, size * 0.62, size * 0.28, rotation - (Math.PI / 2)), palette.goldLight, alpha * 0.48, 1.1);
  drawSpark(buffer, cx + (Math.cos(rotation - 0.72) * size * 0.34), cy + (Math.sin(rotation - 0.72) * size * 0.34), Math.max(6, size * 0.13), palette.white, alpha * 0.36);
};

const renderGoldStarJackpotRain = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(711);

  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.44, 360, palette.goldLight, 0.055, 96);
  drawRing(rgba, WIDTH * 0.5, HEIGHT * 0.5, 320, 12, palette.gold, 0.1);

  for (let trail = 0; trail < 24; trail += 1) {
    const x = 90 + (trail * 76) + ((rng() - 0.5) * 44);
    const y = 40 + (rng() * 680);
    drawCapsule(rgba, x - 30, y - 86, x + 16, y + 52, 5.5, palette.gold, 0.12);
    drawCapsule(rgba, x - 18, y - 58, x + 10, y + 36, 2.2, palette.white, 0.24);
  }

  for (let star = 0; star < 58; star += 1) {
    const x = 44 + (rng() * (WIDTH - 88));
    const y = 52 + (rng() * (HEIGHT - 112));
    const size = 18 + (rng() * 54) + (star % 7 === 0 ? 26 : 0);
    drawGoldenStar(rgba, x, y, size, 0.5 + (rng() * 0.38), rng() * TAU);
  }

  for (let spark = 0; spark < 38; spark += 1) {
    drawSpark(rgba, 36 + (rng() * (WIDTH - 72)), 42 + (rng() * (HEIGHT - 84)), 7 + (rng() * 13), spark % 2 === 0 ? palette.goldLight : palette.white, 0.22 + (rng() * 0.16));
  }

  return rgba;
};

const renderMegaStarExplosion = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(712);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.5;

  drawCircle(rgba, originX, originY, 330, palette.goldLight, 0.075, 108);
  drawRing(rgba, originX, originY, 230, 14, palette.gold, 0.18);
  drawRing(rgba, originX, originY, 365, 10, palette.goldLight, 0.11);

  for (let ray = 0; ray < 34; ray += 1) {
    const angle = (ray / 34) * TAU;
    const distance = 300 + ((ray % 5) * 90);
    const x2 = originX + (Math.cos(angle) * distance);
    const y2 = originY + (Math.sin(angle) * distance * 0.66);
    drawCapsule(rgba, originX, originY, x2, y2, 8, palette.gold, 0.14);
    drawCapsule(rgba, originX, originY, x2, y2, 2.5, ray % 2 === 0 ? palette.white : palette.goldLight, 0.46);
    if (ray % 2 === 0) {
      drawGoldenStar(rgba, x2, y2, 20 + (rng() * 34), 0.72, angle);
    }
  }

  drawGoldenStar(rgba, originX, originY, 190, 0.98, 0.12);
  drawSpark(rgba, originX, originY, 72, palette.white, 0.32);

  for (let dust = 0; dust < 44; dust += 1) {
    const angle = rng() * TAU;
    const distance = 140 + (rng() * 620);
    drawSpark(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.64), 6 + (rng() * 12), dust % 3 === 0 ? palette.white : palette.goldLight, 0.22 + (rng() * 0.14));
  }

  return rgba;
};

const renderGoldenGalaxySpiral = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(713);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.5;

  drawCircle(rgba, originX, originY, 380, palette.goldLight, 0.055, 120);

  for (let arm = 0; arm < 3; arm += 1) {
    const offset = (arm / 3) * TAU;
    for (let dot = 0; dot < 34; dot += 1) {
      const progress = dot / 33;
      const angle = offset + (progress * TAU * 1.35);
      const distance = 80 + (progress * 720);
      const x = originX + (Math.cos(angle) * distance);
      const y = originY + (Math.sin(angle) * distance * 0.48);
      const nextX = originX + (Math.cos(angle + 0.18) * (distance + 36));
      const nextY = originY + (Math.sin(angle + 0.18) * (distance + 36) * 0.48);
      drawCapsule(rgba, x, y, nextX, nextY, 4.8, palette.gold, 0.15 + (progress * 0.06));
      drawCapsule(rgba, x, y, nextX, nextY, 1.8, palette.white, 0.22);
      if (dot % 3 === 0) {
        drawGoldenStar(rgba, x, y, 13 + (progress * 32), 0.54 + (progress * 0.26), angle);
      }
    }
  }

  drawRing(rgba, originX, originY, 210, 10, palette.gold, 0.13);
  drawRing(rgba, originX, originY, 335, 8, palette.goldLight, 0.08);
  drawGoldenStar(rgba, originX, originY, 108, 0.92, 0);

  for (let spark = 0; spark < 48; spark += 1) {
    const angle = rng() * TAU;
    const distance = 170 + (rng() * 660);
    drawSpark(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.55), 6 + (rng() * 10), spark % 2 === 0 ? palette.goldLight : palette.white, 0.2 + (rng() * 0.14));
  }

  return rgba;
};

const renderStarFlashReward = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const stars = [
    { x: 330, y: 290, size: 104, angle: -0.32 },
    { x: 720, y: 565, size: 134, angle: 0.18 },
    { x: 960, y: 330, size: 182, angle: -0.08 },
    { x: 1240, y: 610, size: 126, angle: 0.3 },
    { x: 1605, y: 315, size: 116, angle: -0.22 },
  ];

  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.48, 390, palette.goldLight, 0.06, 112);
  for (let flash = 0; flash < 16; flash += 1) {
    const angle = (flash / 16) * TAU;
    drawCapsule(rgba, WIDTH * 0.5, HEIGHT * 0.5, WIDTH * 0.5 + (Math.cos(angle) * 730), HEIGHT * 0.5 + (Math.sin(angle) * 330), 12, palette.gold, 0.08);
    drawCapsule(rgba, WIDTH * 0.5, HEIGHT * 0.5, WIDTH * 0.5 + (Math.cos(angle) * 650), HEIGHT * 0.5 + (Math.sin(angle) * 300), 3, palette.white, 0.18);
  }

  for (const star of stars) {
    drawRing(rgba, star.x, star.y, star.size * 0.92, 8, palette.goldLight, 0.1);
    drawGoldenStar(rgba, star.x, star.y, star.size, 0.96, star.angle);
  }

  for (let spark = 0; spark < 46; spark += 1) {
    const x = 60 + ((spark * 43) % (WIDTH - 120));
    const y = 90 + (((spark * 97) % 780));
    drawSpark(rgba, x, y, 7 + (spark % 5), spark % 2 === 0 ? palette.white : palette.goldLight, 0.22);
  }

  return rgba;
};

const renderGoldenStarFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(714);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.52;

  drawCircle(rgba, originX, originY, 430, palette.goldLight, 0.065, 128);
  drawRing(rgba, originX, originY, 250, 14, palette.gold, 0.16);
  drawRing(rgba, originX, originY, 392, 10, palette.goldLight, 0.09);

  for (let ray = 0; ray < 30; ray += 1) {
    const angle = (ray / 30) * TAU;
    const x2 = originX + (Math.cos(angle) * (260 + ((ray % 6) * 82)));
    const y2 = originY + (Math.sin(angle) * (170 + ((ray % 5) * 42)));
    drawCapsule(rgba, originX, originY, x2, y2, 7, palette.gold, 0.12);
    drawCapsule(rgba, originX, originY, x2, y2, 2.4, palette.white, 0.42);
  }

  for (let rain = 0; rain < 36; rain += 1) {
    const x = 50 + (rng() * (WIDTH - 100));
    const y = 40 + (rng() * (HEIGHT - 90));
    drawCapsule(rgba, x - 18, y - 52, x + 8, y + 34, 2.8, palette.white, 0.18);
    drawGoldenStar(rgba, x, y, 17 + (rng() * 42), 0.42 + (rng() * 0.34), rng() * TAU);
  }

  drawGoldenStar(rgba, originX, originY, 172, 0.98, 0.1);
  drawSpark(rgba, originX, originY, 72, palette.white, 0.3);

  for (let spark = 0; spark < 52; spark += 1) {
    const angle = rng() * TAU;
    const distance = 120 + (rng() * 720);
    drawSpark(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.58), 6 + (rng() * 11), spark % 3 === 0 ? palette.white : palette.goldLight, 0.2 + (rng() * 0.15));
  }

  return rgba;
};

const starryPreviewColors = {
  blue: hexToRgb("#58c7ff"),
  cyan: hexToRgb("#9de8ff"),
  purple: hexToRgb("#8f5bff"),
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  white: hexToRgb("#ffffff"),
};

const drawStarryField = (buffer, seed, count, colors, options = {}) => {
  const rng = createRng(seed);
  for (let star = 0; star < count; star += 1) {
    const x = 50 + rng() * (WIDTH - 100);
    const y = 52 + rng() * (HEIGHT - 120);
    const size = (options.minSize ?? 6) + rng() * ((options.maxSize ?? 22) - (options.minSize ?? 6));
    const color = colors[star % colors.length];
    const alpha = 0.35 + rng() * 0.5;
    if (options.goldStars && star % 5 === 0) {
      drawGoldenStar(buffer, x, y, size * 1.2, alpha, rng() * TAU);
    } else {
      drawSpark(buffer, x, y, size, color, alpha);
      drawCircle(buffer, x, y, size * 1.8, color, alpha * 0.08, size);
    }
    if (star % 9 === 0) {
      drawSpark(buffer, x + 18 - rng() * 36, y + 16 - rng() * 32, size * 0.55, starryPreviewColors.white, alpha * 0.42);
    }
  }
};

const drawShootingStarPreview = (buffer, fromX, fromY, toX, toY, color, alpha = 0.9) => {
  drawCapsule(buffer, fromX, fromY, toX, toY, 8, color, alpha * 0.16);
  drawCapsule(buffer, fromX + (toX - fromX) * 0.22, fromY + (toY - fromY) * 0.22, toX, toY, 3, starryPreviewColors.white, alpha * 0.54);
  drawSpark(buffer, toX, toY, 24, starryPreviewColors.white, alpha * 0.6);
};

const renderMagicStarrySky = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.44, 560, starryPreviewColors.purple, 0.055, 160);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.48, 420, starryPreviewColors.blue, 0.04, 130);
  drawStarryField(rgba, 801, 118, [starryPreviewColors.white, starryPreviewColors.cyan, starryPreviewColors.purple], { minSize: 5, maxSize: 22 });
  drawRing(rgba, WIDTH * 0.5, HEIGHT * 0.5, 360, 8, starryPreviewColors.cyan, 0.08);
  return rgba;
};

const renderGoldenTwinkleSky = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.45, 590, starryPreviewColors.goldLight, 0.06, 165);
  drawStarryField(rgba, 811, 126, [starryPreviewColors.gold, starryPreviewColors.goldLight, starryPreviewColors.white], { minSize: 6, maxSize: 25, goldStars: true });
  drawRing(rgba, WIDTH * 0.5, HEIGHT * 0.5, 410, 8, starryPreviewColors.gold, 0.11);
  return rgba;
};

const renderShootingStarNight = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.46, 560, starryPreviewColors.blue, 0.055, 160);
  drawStarryField(rgba, 821, 96, [starryPreviewColors.white, starryPreviewColors.cyan, starryPreviewColors.purple], { minSize: 5, maxSize: 21 });
  drawShootingStarPreview(rgba, 70, 230, 760, 420, starryPreviewColors.cyan, 0.92);
  drawShootingStarPreview(rgba, WIDTH - 120, 180, 1040, 410, starryPreviewColors.goldLight, 0.86);
  drawShootingStarPreview(rgba, 280, 70, 1240, 520, starryPreviewColors.white, 0.74);
  return rgba;
};

const renderStarlightPulse = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, starryPreviewColors.goldLight, 0.055, 160);
  drawRing(rgba, cx, cy, 210, 11, starryPreviewColors.white, 0.13);
  drawRing(rgba, cx, cy, 360, 8, starryPreviewColors.cyan, 0.1);
  drawRing(rgba, cx, cy, 520, 6, starryPreviewColors.goldLight, 0.08);
  drawStarryField(rgba, 831, 112, [starryPreviewColors.goldLight, starryPreviewColors.white, starryPreviewColors.cyan], { minSize: 6, maxSize: 24 });
  return rgba;
};

const renderGrandStarryFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 620, starryPreviewColors.blue, 0.06, 170);
  drawCircle(rgba, cx, cy, 430, starryPreviewColors.goldLight, 0.04, 130);
  drawStarryField(rgba, 841, 134, [starryPreviewColors.white, starryPreviewColors.cyan, starryPreviewColors.goldLight, starryPreviewColors.purple], { minSize: 5, maxSize: 25, goldStars: true });
  drawShootingStarPreview(rgba, 80, 240, 820, 420, starryPreviewColors.cyan, 0.88);
  drawShootingStarPreview(rgba, WIDTH - 90, 220, 940, 500, starryPreviewColors.goldLight, 0.82);
  drawRing(rgba, cx, cy, 300, 9, starryPreviewColors.white, 0.1);
  drawRing(rgba, cx, cy, 500, 7, starryPreviewColors.goldLight, 0.08);
  return rgba;
};

const drawSevenSegmentDigit = (buffer, cx, cy, digit, size, color, accent, alpha = 1) => {
  const segments = {
    a: [[-0.24, -0.46], [0.24, -0.46]],
    b: [[0.3, -0.38], [0.3, -0.06]],
    c: [[0.3, 0.06], [0.3, 0.38]],
    d: [[-0.24, 0.46], [0.24, 0.46]],
    e: [[-0.3, 0.06], [-0.3, 0.38]],
    f: [[-0.3, -0.38], [-0.3, -0.06]],
    g: [[-0.22, 0], [0.22, 0]],
  };
  const map = {
    1: ["b", "c"],
    2: ["a", "b", "g", "e", "d"],
    3: ["a", "b", "g", "c", "d"],
  };
  for (const key of map[digit] ?? map[3]) {
    const [from, to] = segments[key];
    drawCapsule(buffer, cx + (from[0] * size), cy + (from[1] * size), cx + (to[0] * size), cy + (to[1] * size), size * 0.09, accent, alpha * 0.34);
    drawCapsule(buffer, cx + (from[0] * size), cy + (from[1] * size), cx + (to[0] * size), cy + (to[1] * size), size * 0.052, color, alpha * 0.96);
  }
};

const glyphSegments = {
  B: [
    [[0, 0], [0, 1]],
    [[0, 0], [0.52, 0.08]],
    [[0.52, 0.08], [0.58, 0.43]],
    [[0.58, 0.43], [0, 0.5]],
    [[0, 0.5], [0.6, 0.58]],
    [[0.6, 0.58], [0.54, 0.92]],
    [[0.54, 0.92], [0, 1]],
  ],
  I: [
    [[0.1, 0], [0.58, 0]],
    [[0.34, 0], [0.34, 1]],
    [[0.1, 1], [0.58, 1]],
  ],
  N: [
    [[0, 1], [0, 0]],
    [[0, 0], [0.62, 1]],
    [[0.62, 1], [0.62, 0]],
  ],
  G: [
    [[0.62, 0.12], [0.18, 0]],
    [[0.18, 0], [0, 0.18]],
    [[0, 0.18], [0, 0.84]],
    [[0, 0.84], [0.18, 1]],
    [[0.18, 1], [0.62, 0.9]],
    [[0.62, 0.9], [0.62, 0.58]],
    [[0.62, 0.58], [0.34, 0.58]],
  ],
  O: [
    [[0.16, 0], [0.5, 0]],
    [[0.5, 0], [0.66, 0.18]],
    [[0.66, 0.18], [0.66, 0.82]],
    [[0.66, 0.82], [0.5, 1]],
    [[0.5, 1], [0.16, 1]],
    [[0.16, 1], [0, 0.82]],
    [[0, 0.82], [0, 0.18]],
    [[0, 0.18], [0.16, 0]],
  ],
  "!": [
    [[0.2, 0], [0.2, 0.68]],
    [[0.2, 0.93], [0.2, 1]],
  ],
};

const drawBlockText = (buffer, text, cx, cy, size, color, accent, alpha = 1) => {
  const widths = [...text].map((char) => (char === "I" || char === "!" ? 0.42 : 0.76));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) * size + (text.length - 1) * size * 0.14;
  let cursor = cx - (totalWidth / 2);

  [...text].forEach((char, index) => {
    const glyph = glyphSegments[char];
    const glyphWidth = widths[index] * size;
    if (glyph) {
      for (const [from, to] of glyph) {
        const ax = cursor + (from[0] * size);
        const ay = cy - (size * 0.5) + (from[1] * size);
        const bx = cursor + (to[0] * size);
        const by = cy - (size * 0.5) + (to[1] * size);
        drawCapsule(buffer, ax, ay, bx, by, size * 0.09, accent, alpha * 0.34);
        drawCapsule(buffer, ax, ay, bx, by, size * 0.048, color, alpha * 0.95);
      }
    }
    cursor += glyphWidth + (size * 0.14);
  });
};

const drawCountdownBingoScene = ({ seed, mode = "classic", gold = false }) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(seed);
  const originX = WIDTH * 0.5;
  const originY = HEIGHT * 0.52;
  const main = gold ? palette.goldLight : palette.white;
  const accent = gold ? palette.gold : palette.blue;

  drawCircle(rgba, originX, originY, 390, gold ? palette.goldLight : palette.blue, gold ? 0.055 : 0.04, 120);
  drawRing(rgba, originX, originY, 210, 13, palette.gold, 0.16);
  drawRing(rgba, originX, originY, 340, 10, gold ? palette.orange : palette.pink, 0.1);

  if (mode === "letters") {
    drawBlockText(rgba, "BINGO!", originX, originY - 78, 188, palette.goldLight, palette.pink, 0.98);
    drawBlockText(rgba, "B", 350, 328, 112, palette.white, palette.gold, 0.44);
    drawBlockText(rgba, "I", 640, 286, 112, palette.white, palette.blue, 0.5);
    drawBlockText(rgba, "N", 1280, 292, 112, palette.white, palette.pink, 0.5);
    drawBlockText(rgba, "O", 1580, 342, 112, palette.white, palette.gold, 0.44);
  } else {
    drawSevenSegmentDigit(rgba, originX - 430, 324, 3, 210, main, accent, 0.46);
    drawSevenSegmentDigit(rgba, originX, 286, 2, 230, main, gold ? palette.orange : palette.pink, 0.52);
    drawSevenSegmentDigit(rgba, originX + 420, 340, 1, 250, palette.goldLight, palette.gold, 0.62);
    drawBlockText(rgba, "BINGO!", originX, originY + 30, mode === "mega" ? 198 : 178, gold ? palette.goldLight : palette.white, mode === "detonation" ? palette.orange : palette.gold, 0.98);
  }

  for (let ray = 0; ray < (mode === "detonation" ? 36 : 24); ray += 1) {
    const angle = (ray / (mode === "detonation" ? 36 : 24)) * TAU;
    const distance = 280 + ((ray % 6) * 94);
    drawCapsule(rgba, originX, originY + 72, originX + (Math.cos(angle) * distance), originY + 72 + (Math.sin(angle) * distance * 0.56), 7, palette.gold, 0.12);
    drawCapsule(rgba, originX, originY + 72, originX + (Math.cos(angle) * distance), originY + 72 + (Math.sin(angle) * distance * 0.56), 2.2, palette.white, 0.34);
  }

  for (let ball = 0; ball < 16; ball += 1) {
    const angle = (ball / 16) * TAU + (rng() * 0.2);
    const distance = 260 + (rng() * 520);
    const x = originX + (Math.cos(angle) * distance);
    const y = originY + 80 + (Math.sin(angle) * distance * 0.58);
    const body = ballPalette[ball % ballPalette.length];
    drawBingoBall(rgba, x, y, 36 + (rng() * 26), body.color, body.digit, 0.92);
  }

  for (let spark = 0; spark < 46; spark += 1) {
    const angle = rng() * TAU;
    const distance = 120 + (rng() * 780);
    drawSpark(rgba, originX + (Math.cos(angle) * distance), originY + (Math.sin(angle) * distance * 0.62), 7 + (rng() * 12), spark % 3 === 0 ? palette.white : spark % 3 === 1 ? palette.goldLight : palette.blue, 0.2 + (rng() * 0.16));
  }

  return rgba;
};

const renderClassicCountdownBingo = () => drawCountdownBingoScene({ seed: 901, mode: "classic" });
const renderBingoLetterBuild = () => drawCountdownBingoScene({ seed: 902, mode: "letters" });
const renderGoldJackpotCountdown = () => drawCountdownBingoScene({ seed: 903, mode: "gold", gold: true });
const renderFinalCountdownDetonation = () => drawCountdownBingoScene({ seed: 904, mode: "detonation", gold: true });
const renderMegaBingoImpact = () => drawCountdownBingoScene({ seed: 905, mode: "mega", gold: true });

const renderGiantBingoReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(2301);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 470, palette.goldLight, 0.06, 150);
  drawRing(rgba, cx, cy, 220, 13, palette.gold, 0.16);
  drawRing(rgba, cx, cy, 380, 9, palette.blue, 0.1);
  drawBlockText(rgba, "BINGO!", cx, cy, 220, palette.goldLight, palette.gold, 0.98);
  for (let ball = 0; ball < 18; ball += 1) {
    const angle = (ball / 18) * TAU;
    const distance = 260 + rng() * 520;
    const body = ballPalette[ball % ballPalette.length];
    drawBingoBall(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 38 + rng() * 28, body.color, body.digit, 0.92);
  }
  drawNeonParticles(rgba, 2302, 58, cx, cy, 860, 430, [palette.goldLight, palette.white, palette.blue]);
  return rgba;
};

const renderFullscreenBingoLetterBuild = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 470, palette.pink, 0.052, 140);
  drawBlockText(rgba, "BINGO!", cx, cy - 40, 208, palette.goldLight, palette.pink, 0.98);
  drawBlockText(rgba, "B", 340, 308, 120, palette.white, palette.gold, 0.52);
  drawBlockText(rgba, "I", 610, 270, 120, palette.white, palette.blue, 0.56);
  drawBlockText(rgba, "N", 1320, 284, 120, palette.white, palette.pink, 0.56);
  drawBlockText(rgba, "O", 1600, 342, 120, palette.white, palette.gold, 0.52);
  drawRing(rgba, cx, cy + 38, 260, 11, palette.gold, 0.14);
  drawNeonParticles(rgba, 2312, 52, cx, cy, 820, 410, [palette.goldLight, palette.white, palette.pink]);
  return rgba;
};

const renderGoldenBingoJackpot = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(2321);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 540, palette.goldLight, 0.07, 160);
  drawBlockText(rgba, "BINGO!", cx, cy - 8, 224, palette.goldLight, palette.gold, 0.98);
  drawRing(rgba, cx, cy, 260, 14, palette.gold, 0.18);
  for (let beam = 0; beam < 14; beam += 1) {
    const angle = -0.9 + beam * 0.14;
    drawCapsule(rgba, cx, cy + 60, cx + Math.sin(angle) * 520, cy - 360 - (beam % 5) * 55, 7, beam % 2 === 0 ? palette.gold : palette.goldLight, 0.12);
  }
  for (let ball = 0; ball < 14; ball += 1) {
    const angle = rng() * TAU;
    const distance = 270 + rng() * 560;
    drawBingoBall(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 40 + rng() * 24, ball % 2 === 0 ? palette.gold : palette.goldLight, ballPalette[ball % ballPalette.length].digit, 0.88);
  }
  return rgba;
};

const renderMegaBingoFinaleFullscreen = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(2331);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 580, palette.pink, 0.06, 170);
  drawRing(rgba, cx, cy, 230, 15, palette.gold, 0.2);
  drawRing(rgba, cx, cy, 430, 10, palette.blue, 0.12);
  drawBlockText(rgba, "BINGO!", cx, cy - 8, 238, palette.goldLight, palette.pink, 0.98);
  const heroBalls = [
    { x: 260, y: 260, r: 78, body: ballPalette[1] },
    { x: 1640, y: 250, r: 84, body: ballPalette[0] },
    { x: 960, y: 122, r: 78, body: ballPalette[4] },
    { x: 960, y: 850, r: 92, body: ballPalette[2] },
  ];
  for (const ball of heroBalls) {
    drawBingoBall(rgba, ball.x, ball.y, ball.r, ball.body.color, ball.body.digit, 0.94);
  }
  for (let spark = 0; spark < 78; spark += 1) {
    const angle = rng() * TAU;
    const distance = 130 + rng() * 860;
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 7 + rng() * 12, spark % 3 === 0 ? palette.goldLight : spark % 3 === 1 ? palette.white : palette.blue, 0.22 + rng() * 0.16);
  }
  return rgba;
};

const floralColors = {
  rose: hexToRgb("#ff6fb7"),
  roseLight: hexToRgb("#ffd1e6"),
  sakura: hexToRgb("#ff9fd0"),
  sakuraLight: hexToRgb("#fff1f7"),
  coral: hexToRgb("#ff7f95"),
  lavender: hexToRgb("#c58bff"),
  red: hexToRgb("#e94765"),
  gold: hexToRgb("#ffe28a"),
  white: hexToRgb("#ffffff"),
};

const rotatedPetalPoints = (cx, cy, width, height, rotation = 0, segments = 18) => {
  const points = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * TAU;
    const px = Math.cos(angle) * width * 0.5;
    const py = Math.sin(angle) * height * 0.5;
    points.push([
      cx + (px * cos) - (py * sin),
      cy + (px * sin) + (py * cos),
    ]);
  }
  return points;
};

const drawPetal = (buffer, cx, cy, width, height, rotation, color, alpha = 1) => {
  drawPolygon(buffer, rotatedPetalPoints(cx, cy, width * 1.32, height * 1.32, rotation), color, alpha * 0.12, 2.4);
  drawPolygon(buffer, rotatedPetalPoints(cx, cy, width, height, rotation), color, alpha * 0.92, 1.4);
  const hx = cx + (Math.cos(rotation - 1.4) * width * 0.12);
  const hy = cy + (Math.sin(rotation - 1.4) * height * 0.12);
  drawPolygon(buffer, rotatedPetalPoints(hx, hy, width * 0.26, height * 0.52, rotation - 0.18), floralColors.white, alpha * 0.2, 1.2);
};

const drawFlower = (buffer, cx, cy, radius, petalColor, centerColor = floralColors.gold, alpha = 1, petals = 8, rotation = 0) => {
  drawCircle(buffer, cx, cy, radius * 1.42, petalColor, alpha * 0.08, radius * 0.38);
  for (let index = 0; index < petals; index += 1) {
    const angle = rotation + ((index / petals) * TAU);
    drawPetal(
      buffer,
      cx + (Math.cos(angle) * radius * 0.32),
      cy + (Math.sin(angle) * radius * 0.32),
      radius * 0.5,
      radius * 1.08,
      angle,
      petalColor,
      alpha,
    );
  }
  drawCircle(buffer, cx, cy, radius * 0.28, centerColor, alpha * 0.9);
  drawCircle(buffer, cx - (radius * 0.08), cy - (radius * 0.08), radius * 0.08, floralColors.white, alpha * 0.34);
};

const drawRose = (buffer, cx, cy, radius, alpha = 1) => {
  drawCircle(buffer, cx, cy, radius * 1.45, floralColors.red, alpha * 0.1, radius * 0.42);
  for (let index = 0; index < 16; index += 1) {
    const progress = index / 15;
    const angle = progress * TAU * 2.4;
    const distance = radius * (0.08 + (progress * 0.58));
    const size = radius * (0.42 - (progress * 0.1));
    drawPetal(
      buffer,
      cx + (Math.cos(angle) * distance),
      cy + (Math.sin(angle) * distance * 0.72),
      size * 0.7,
      size * 1.18,
      angle + 0.8,
      index % 2 === 0 ? floralColors.red : floralColors.rose,
      alpha * (0.78 + (progress * 0.18)),
    );
  }
  drawCircle(buffer, cx, cy, radius * 0.16, floralColors.roseLight, alpha * 0.42);
};

const drawGoldenRose = (buffer, cx, cy, radius, alpha = 1) => {
  drawCircle(buffer, cx, cy, radius * 1.48, floralColors.gold, alpha * 0.12, radius * 0.42);
  for (let index = 0; index < 16; index += 1) {
    const progress = index / 15;
    const angle = progress * TAU * 2.45;
    const distance = radius * (0.08 + (progress * 0.58));
    const size = radius * (0.42 - (progress * 0.1));
    drawPetal(
      buffer,
      cx + (Math.cos(angle) * distance),
      cy + (Math.sin(angle) * distance * 0.72),
      size * 0.7,
      size * 1.18,
      angle + 0.8,
      index % 2 === 0 ? floralColors.gold : floralColors.roseLight,
      alpha * (0.78 + (progress * 0.18)),
    );
  }
  drawCircle(buffer, cx, cy, radius * 0.16, floralColors.white, alpha * 0.5);
};

const drawFloralSparkles = (buffer, seed, centerX = WIDTH * 0.5, centerY = HEIGHT * 0.5, count = 42) => {
  const rng = createRng(seed);
  for (let spark = 0; spark < count; spark += 1) {
    const angle = rng() * TAU;
    const distance = 80 + (rng() * 760);
    drawSpark(
      buffer,
      centerX + (Math.cos(angle) * distance),
      centerY + (Math.sin(angle) * distance * 0.58),
      6 + (rng() * 10),
      spark % 3 === 0 ? floralColors.white : spark % 3 === 1 ? floralColors.roseLight : floralColors.gold,
      0.16 + (rng() * 0.16),
    );
  }
};

const renderPetalStormBloom = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1101);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;

  drawCircle(rgba, cx, cy, 360, floralColors.rose, 0.05, 120);
  drawRing(rgba, cx, cy, 260, 10, floralColors.roseLight, 0.13);

  for (let petal = 0; petal < 62; petal += 1) {
    const angle = rng() * TAU;
    const distance = 120 + (rng() * 820);
    const color = [floralColors.rose, floralColors.sakura, floralColors.roseLight][petal % 3];
    drawPetal(rgba, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.58), 20 + (rng() * 28), 44 + (rng() * 54), angle + (rng() * 1.4), color, 0.44 + (rng() * 0.36));
  }

  drawFlower(rgba, cx, cy, 188, floralColors.rose, floralColors.gold, 0.95, 12, 0.12);
  drawFloralSparkles(rgba, 1102, cx, cy, 36);
  return rgba;
};

const renderSakuraJackpotBlossom = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1111);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;

  drawCircle(rgba, cx, cy, 350, floralColors.sakuraLight, 0.055, 116);
  for (let petal = 0; petal < 58; petal += 1) {
    const x = 40 + (rng() * (WIDTH - 80));
    const y = 40 + (rng() * (HEIGHT - 100));
    drawPetal(rgba, x, y, 18 + (rng() * 24), 42 + (rng() * 52), -0.8 + (rng() * 1.6), petal % 2 === 0 ? floralColors.sakura : floralColors.sakuraLight, 0.38 + (rng() * 0.34));
  }

  drawFlower(rgba, cx, cy + 10, 178, floralColors.sakura, floralColors.gold, 0.96, 10, 0.2);
  drawSpark(rgba, cx, cy, 54, floralColors.white, 0.24);
  drawFloralSparkles(rgba, 1112, cx, cy, 34);
  return rgba;
};

const renderRoseSwirlReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1121);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;

  drawCircle(rgba, cx, cy, 360, floralColors.red, 0.045, 120);
  for (let arm = 0; arm < 3; arm += 1) {
    const offset = (arm / 3) * TAU;
    for (let petal = 0; petal < 22; petal += 1) {
      const progress = petal / 21;
      const angle = offset + (progress * TAU * 1.25);
      const distance = 80 + (progress * 760);
      const x = cx + (Math.cos(angle) * distance);
      const y = cy + (Math.sin(angle) * distance * 0.5);
      drawCapsule(rgba, cx, cy, x, y, 2.4, floralColors.roseLight, 0.12);
      drawPetal(rgba, x, y, 16 + (progress * 22), 38 + (progress * 46), angle + 0.8, petal % 2 === 0 ? floralColors.red : floralColors.rose, 0.42 + (progress * 0.32));
    }
  }

  drawRose(rgba, cx, cy, 205, 0.98);
  drawFloralSparkles(rgba, 1122, cx, cy, 32);
  return rgba;
};

const renderFloralHeartBloom = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;

  drawCircle(rgba, cx, cy, 360, floralColors.rose, 0.04, 120);
  drawRing(rgba, cx, cy, 300, 9, floralColors.roseLight, 0.1);
  for (let index = 0; index < 28; index += 1) {
    const t = (index / 28) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    const color = [floralColors.rose, floralColors.sakura, floralColors.lavender][index % 3];
    drawFlower(rgba, cx + (x * 25), cy + (y * 21), 36 + ((index % 4) * 6), color, floralColors.gold, 0.9, 6, index * 0.3);
  }
  drawFloralSparkles(rgba, 1131, cx, cy, 38);
  return rgba;
};

const renderBloomBurstFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1141);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;

  drawCircle(rgba, cx, cy, 410, floralColors.sakuraLight, 0.05, 128);
  const blooms = [
    [350, 300, 92, floralColors.sakura],
    [680, 650, 106, floralColors.lavender],
    [960, 430, 172, floralColors.rose],
    [1240, 640, 104, floralColors.coral],
    [1580, 310, 96, floralColors.sakuraLight],
  ];
  for (const [x, y, radius, color] of blooms) {
    drawFlower(rgba, x, y, radius, color, floralColors.gold, 0.94, 9, rng() * TAU);
  }
  for (let petal = 0; petal < 42; petal += 1) {
    const angle = rng() * TAU;
    const distance = 140 + (rng() * 780);
    drawPetal(rgba, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.6), 18 + (rng() * 24), 44 + (rng() * 46), angle, [floralColors.rose, floralColors.sakura, floralColors.lavender, floralColors.sakuraLight][petal % 4], 0.4 + (rng() * 0.3));
  }
  drawFloralSparkles(rgba, 1142, cx, cy, 42);
  return rgba;
};

const renderGiantRoseReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1151);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 390, floralColors.red, 0.055, 128);
  drawRing(rgba, cx, cy, 300, 10, floralColors.roseLight, 0.12);
  for (let petal = 0; petal < 58; petal += 1) {
    const angle = rng() * TAU;
    const distance = 130 + (rng() * 780);
    drawPetal(rgba, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.58), 18 + (rng() * 28), 42 + (rng() * 54), angle + 0.7, [floralColors.red, floralColors.rose, floralColors.roseLight][petal % 3], 0.42 + (rng() * 0.34));
  }
  drawRose(rgba, cx, cy, 248, 0.98);
  drawFloralSparkles(rgba, 1152, cx, cy, 42);
  return rgba;
};

const renderRosePetalStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1161);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 420, floralColors.rose, 0.05, 132);
  for (let petal = 0; petal < 92; petal += 1) {
    const angle = rng() * TAU;
    const distance = 80 + (rng() * 900);
    const sweep = angle + (petal % 2 === 0 ? 0.9 : -0.7);
    const x = cx + (Math.cos(angle) * distance);
    const y = cy + (Math.sin(angle) * distance * 0.62);
    drawCapsule(rgba, x - (Math.cos(sweep) * 54), y - (Math.sin(sweep) * 24), x, y, 2.2, floralColors.roseLight, 0.08);
    drawPetal(rgba, x, y, 14 + (rng() * 24), 36 + (rng() * 50), sweep, [floralColors.red, floralColors.rose, floralColors.sakura, floralColors.roseLight][petal % 4], 0.36 + (rng() * 0.34));
  }
  drawRose(rgba, cx, cy, 198, 0.66);
  drawFloralSparkles(rgba, 1162, cx, cy, 34);
  return rgba;
};

const renderRoseHeartBloom = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 390, floralColors.rose, 0.05, 128);
  drawRing(rgba, cx, cy, 330, 9, floralColors.roseLight, 0.1);
  for (let index = 0; index < 34; index += 1) {
    const t = (index / 34) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    drawPetal(rgba, cx + (x * 29), cy + (y * 24), 34 + ((index % 3) * 6), 76 + ((index % 4) * 6), t + 1.1, index % 2 === 0 ? floralColors.red : floralColors.rose, 0.9);
  }
  drawRose(rgba, cx, cy + 10, 138, 0.96);
  drawFloralSparkles(rgba, 1171, cx, cy, 40);
  return rgba;
};

const renderGoldenRoseJackpot = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1181);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 390, floralColors.gold, 0.07, 132);
  drawCapsule(rgba, cx, cy + 240, cx, cy + 40, 14, floralColors.gold, 0.36);
  drawCapsule(rgba, cx, cy + 240, cx, cy + 40, 5, floralColors.white, 0.28);
  for (let ray = 0; ray < 26; ray += 1) {
    const angle = (ray / 26) * TAU;
    const distance = 240 + ((ray % 5) * 70);
    drawCapsule(rgba, cx, cy, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.56), 4, floralColors.gold, 0.12);
  }
  for (let spark = 0; spark < 46; spark += 1) {
    const angle = rng() * TAU;
    const distance = 130 + (rng() * 780);
    drawSpark(rgba, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.58), 7 + (rng() * 14), spark % 2 === 0 ? floralColors.gold : floralColors.white, 0.18 + (rng() * 0.18));
  }
  drawGoldenRose(rgba, cx, cy - 68, 226, 0.98);
  return rgba;
};

const renderRoseGrandFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1191);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 450, floralColors.rose, 0.05, 138);
  const roses = [
    [410, 320, 116],
    [960, 430, 216],
    [1500, 330, 122],
    [660, 690, 108],
    [1280, 670, 106],
  ];
  for (const [x, y, radius] of roses) drawRose(rgba, x, y, radius, 0.92);
  for (let petal = 0; petal < 74; petal += 1) {
    const angle = rng() * TAU;
    const distance = 110 + (rng() * 900);
    drawPetal(rgba, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.64), 16 + (rng() * 26), 40 + (rng() * 54), angle + (rng() * 1.2), [floralColors.red, floralColors.rose, floralColors.sakura, floralColors.gold, floralColors.roseLight][petal % 5], 0.34 + (rng() * 0.34));
  }
  drawFloralSparkles(rgba, 1192, cx, cy, 54);
  return rgba;
};

const luckyColors = {
  emerald: hexToRgb("#22c55e"),
  emeraldLight: hexToRgb("#86efac"),
  deepGreen: hexToRgb("#15803d"),
  mint: hexToRgb("#bbf7d0"),
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  orange: hexToRgb("#ff9c36"),
  white: hexToRgb("#ffffff"),
  red: hexToRgb("#ff5f5f"),
  blue: hexToRgb("#58c7ff"),
  purple: hexToRgb("#8f5bff"),
};

const drawShamrock = (buffer, cx, cy, size, color = luckyColors.emerald, alpha = 1, rotation = 0) => {
  const transform = (x, y) => {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return [cx + (x * cos) - (y * sin), cy + (x * sin) + (y * cos)];
  };

  drawCircle(buffer, cx, cy, size * 1.18, color, alpha * 0.08, size * 0.42);
  for (const [x, y, sx, sy] of [
    [0, -0.35, 0.55, 0.48],
    [-0.36, 0.04, 0.56, 0.48],
    [0.36, 0.04, 0.56, 0.48],
  ]) {
    const [px, py] = transform(x * size, y * size);
    drawPolygon(buffer, rotatedPetalPoints(px, py, size * sx, size * sy, rotation + (x * 0.9), 18), color, alpha * 0.94, 1.4);
    drawPolygon(buffer, rotatedPetalPoints(px - (size * 0.04), py - (size * 0.04), size * sx * 0.34, size * sy * 0.5, rotation + (x * 0.9), 14), luckyColors.white, alpha * 0.18, 1.2);
  }
  const [sx, sy] = transform(0, size * 0.24);
  const [ex, ey] = transform(-size * 0.22, size * 0.9);
  drawCapsule(buffer, sx, sy, ex, ey, Math.max(2, size * 0.055), luckyColors.deepGreen, alpha * 0.82);
  drawSpark(buffer, cx + (size * 0.38), cy - (size * 0.44), size * 0.18, luckyColors.goldLight, alpha * 0.32);
};

const drawPotOfGold = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy - (size * 0.42), size * 0.8, luckyColors.gold, alpha * 0.14, size * 0.34);
  drawCapsule(buffer, cx - (size * 0.68), cy - (size * 0.32), cx + (size * 0.68), cy - (size * 0.32), size * 0.22, luckyColors.gold, alpha * 0.94);
  for (let coin = 0; coin < 9; coin += 1) {
    const x = cx + ((coin - 4) * size * 0.16);
    const y = cy - (size * (0.48 + ((coin % 3) * 0.08)));
    drawCoin(buffer, x, y, size * 0.11, alpha * 0.95, coin * 0.4);
  }
  drawPolygon(buffer, [
    [cx - (size * 0.72), cy - (size * 0.22)],
    [cx + (size * 0.72), cy - (size * 0.22)],
    [cx + (size * 0.52), cy + (size * 0.54)],
    [cx - (size * 0.52), cy + (size * 0.54)],
  ], hexToRgb("#151515"), alpha * 0.96, 1.4);
  drawCapsule(buffer, cx - (size * 0.76), cy - (size * 0.18), cx + (size * 0.76), cy - (size * 0.18), size * 0.12, hexToRgb("#242424"), alpha * 0.96);
  drawCapsule(buffer, cx - (size * 0.38), cy + (size * 0.58), cx + (size * 0.38), cy + (size * 0.58), size * 0.07, hexToRgb("#111111"), alpha * 0.9);
  drawRing(buffer, cx, cy - (size * 0.18), size * 0.78, size * 0.035, luckyColors.emeraldLight, alpha * 0.24);
};

const drawRainbowArc = (buffer, cx, cy, radius, width, alpha = 1) => {
  const bands = [
    luckyColors.red,
    luckyColors.orange,
    luckyColors.gold,
    luckyColors.emeraldLight,
    luckyColors.blue,
    luckyColors.purple,
  ];

  for (let band = 0; band < bands.length; band += 1) {
    const r = radius - (band * width * 0.88);
    const color = bands[band];
    let last = null;
    for (let index = 0; index <= 32; index += 1) {
      const progress = index / 32;
      const angle = Math.PI * (1.04 - (progress * 1.08));
      const point = [cx + (Math.cos(angle) * r), cy - (Math.sin(angle) * r * 0.56)];
      if (last) {
        drawCapsule(buffer, last[0], last[1], point[0], point[1], width * 0.34, color, alpha * 0.78);
      }
      last = point;
    }
  }
};

const drawLuckyDust = (buffer, seed, centerX, centerY, count = 42) => {
  const rng = createRng(seed);
  for (let spark = 0; spark < count; spark += 1) {
    const angle = rng() * TAU;
    const distance = 110 + (rng() * 820);
    const color = [luckyColors.gold, luckyColors.goldLight, luckyColors.emeraldLight, luckyColors.white][spark % 4];
    drawSpark(buffer, centerX + (Math.cos(angle) * distance), centerY + (Math.sin(angle) * distance * 0.6), 7 + (rng() * 13), color, 0.2 + (rng() * 0.18));
  }
};

const renderLuckyShamrockStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1201);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 380, luckyColors.emerald, 0.055, 120);
  drawRing(rgba, cx, cy, 300, 10, luckyColors.gold, 0.12);
  for (let clover = 0; clover < 54; clover += 1) {
    const angle = rng() * TAU;
    const distance = 110 + (rng() * 820);
    drawShamrock(rgba, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.58), 30 + (rng() * 42), clover % 4 === 0 ? luckyColors.gold : clover % 3 === 0 ? luckyColors.emeraldLight : luckyColors.emerald, 0.42 + (rng() * 0.34), rng() * TAU);
  }
  drawShamrock(rgba, cx, cy, 185, luckyColors.emerald, 0.96, -0.08);
  drawLuckyDust(rgba, 1202, cx, cy, 36);
  return rgba;
};

const renderPotOfGoldBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1211);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.6;
  drawCircle(rgba, cx, cy - 70, 370, luckyColors.gold, 0.06, 128);
  drawPotOfGold(rgba, cx, cy, 205, 0.98);
  for (let clover = 0; clover < 22; clover += 1) {
    const angle = rng() * TAU;
    const distance = 180 + (rng() * 640);
    drawShamrock(rgba, cx + (Math.cos(angle) * distance), cy - 80 + (Math.sin(angle) * distance * 0.56), 28 + (rng() * 28), clover % 2 === 0 ? luckyColors.emerald : luckyColors.emeraldLight, 0.58, rng() * TAU);
  }
  drawLuckyDust(rgba, 1212, cx, cy - 70, 42);
  return rgba;
};

const renderRainbowLuckyArc = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1221);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.76;
  drawCircle(rgba, cx, HEIGHT * 0.52, 360, luckyColors.emeraldLight, 0.035, 120);
  drawRainbowArc(rgba, cx, cy, 720, 26, 0.92);
  for (let clover = 0; clover < 26; clover += 1) {
    const x = 160 + (rng() * (WIDTH - 320));
    const y = 220 + (rng() * 470);
    drawShamrock(rgba, x, y, 26 + (rng() * 32), clover % 3 === 0 ? luckyColors.gold : luckyColors.emerald, 0.5 + (rng() * 0.24), rng() * TAU);
  }
  drawLuckyDust(rgba, 1222, cx, HEIGHT * 0.52, 34);
  return rgba;
};

const renderLeprechaunGoldRush = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1231);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 390, luckyColors.gold, 0.055, 128);
  for (let ray = 0; ray < 28; ray += 1) {
    const angle = (ray / 28) * TAU;
    const distance = 300 + ((ray % 6) * 90);
    drawCapsule(rgba, cx, cy, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.58), 7, ray % 2 === 0 ? luckyColors.gold : luckyColors.emerald, 0.14);
    drawCapsule(rgba, cx, cy, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.58), 2.4, luckyColors.white, 0.3);
  }
  for (let item = 0; item < 38; item += 1) {
    const angle = rng() * TAU;
    const distance = 160 + (rng() * 760);
    const x = cx + (Math.cos(angle) * distance);
    const y = cy + (Math.sin(angle) * distance * 0.58);
    if (item % 3 === 0) drawCoin(rgba, x, y, 22 + (rng() * 20), 0.86, rng() * TAU);
    else drawShamrock(rgba, x, y, 26 + (rng() * 30), item % 2 === 0 ? luckyColors.emerald : luckyColors.emeraldLight, 0.66, rng() * TAU);
  }
  drawShamrock(rgba, cx, cy, 150, luckyColors.emerald, 0.94);
  drawLuckyDust(rgba, 1232, cx, cy, 42);
  return rgba;
};

const renderMegaLuckyFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1241);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.56;
  drawRainbowArc(rgba, cx, HEIGHT * 0.78, 560, 22, 0.62);
  drawCircle(rgba, cx, cy, 420, luckyColors.emeraldLight, 0.045, 128);
  drawShamrock(rgba, cx, cy - 160, 126, luckyColors.emerald, 0.88);
  drawPotOfGold(rgba, cx, cy + 92, 172, 0.96);
  for (let clover = 0; clover < 30; clover += 1) {
    const angle = rng() * TAU;
    const distance = 180 + (rng() * 760);
    drawShamrock(rgba, cx + (Math.cos(angle) * distance), cy + (Math.sin(angle) * distance * 0.56), 24 + (rng() * 34), clover % 4 === 0 ? luckyColors.gold : luckyColors.emerald, 0.48 + (rng() * 0.24), rng() * TAU);
  }
  drawLuckyDust(rgba, 1242, cx, cy, 46);
  return rgba;
};

const premiumColors = {
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  white: hexToRgb("#ffffff"),
  diamond: hexToRgb("#dff8ff"),
  cyan: hexToRgb("#58c7ff"),
  blue: hexToRgb("#2f86ff"),
  purple: hexToRgb("#8f5bff"),
  emerald: hexToRgb("#23bf66"),
};

const drawPremiumDiamond = (buffer, cx, cy, size, alpha = 1) => {
  drawDiamond(buffer, cx, cy, size * 1.28, 0, premiumColors.cyan, alpha * 0.12);
  drawDiamond(buffer, cx, cy, size, 0, premiumColors.diamond, alpha * 0.94);
  drawCapsule(buffer, cx - size * 0.36, cy, cx, cy + size * 0.5, 5, premiumColors.white, alpha * 0.42);
  drawCapsule(buffer, cx + size * 0.36, cy, cx, cy + size * 0.5, 5, premiumColors.white, alpha * 0.28);
  drawSpark(buffer, cx + size * 0.44, cy - size * 0.42, size * 0.16, premiumColors.white, alpha * 0.44);
};

const drawCrown = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.86, premiumColors.gold, alpha * 0.1, size * 0.36);
  drawPolygon(buffer, [
    [cx - size * 0.86, cy + size * 0.32],
    [cx - size * 0.72, cy - size * 0.25],
    [cx - size * 0.32, cy + size * 0.02],
    [cx, cy - size * 0.52],
    [cx + size * 0.32, cy + size * 0.02],
    [cx + size * 0.72, cy - size * 0.25],
    [cx + size * 0.86, cy + size * 0.32],
  ], premiumColors.gold, alpha * 0.96, 1.4);
  drawCapsule(buffer, cx - size * 0.82, cy + size * 0.34, cx + size * 0.82, cy + size * 0.34, size * 0.12, premiumColors.goldLight, alpha * 0.92);
  for (const [jx, jy, color] of [[-0.72, -0.25, premiumColors.purple], [0, -0.5, premiumColors.cyan], [0.72, -0.25, premiumColors.purple]]) {
    drawCircle(buffer, cx + jx * size, cy + jy * size, size * 0.09, color, alpha * 0.92);
  }
  drawSpark(buffer, cx, cy - size * 0.7, size * 0.18, premiumColors.white, alpha * 0.44);
};

const drawMoneySymbol = (buffer, cx, cy, size, color = premiumColors.gold, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.62, color, alpha * 0.08);
  drawCapsule(buffer, cx + size * 0.22, cy - size * 0.36, cx - size * 0.22, cy - size * 0.34, size * 0.08, color, alpha * 0.9);
  drawCapsule(buffer, cx - size * 0.22, cy - size * 0.34, cx - size * 0.28, cy - size * 0.04, size * 0.08, color, alpha * 0.9);
  drawCapsule(buffer, cx - size * 0.28, cy - size * 0.04, cx + size * 0.24, cy + size * 0.04, size * 0.08, color, alpha * 0.9);
  drawCapsule(buffer, cx + size * 0.24, cy + size * 0.04, cx + size * 0.26, cy + size * 0.36, size * 0.08, color, alpha * 0.9);
  drawCapsule(buffer, cx + size * 0.26, cy + size * 0.36, cx - size * 0.26, cy + size * 0.34, size * 0.08, color, alpha * 0.9);
  drawCapsule(buffer, cx, cy - size * 0.56, cx, cy + size * 0.56, size * 0.045, premiumColors.goldLight, alpha * 0.9);
};

const drawTrophy = (buffer, cx, cy, size, alpha = 1) => {
  drawCircle(buffer, cx, cy, size * 0.82, premiumColors.gold, alpha * 0.1, size * 0.34);
  drawPolygon(buffer, [
    [cx - size * 0.54, cy - size * 0.46],
    [cx + size * 0.54, cy - size * 0.46],
    [cx + size * 0.38, cy + size * 0.24],
    [cx, cy + size * 0.44],
    [cx - size * 0.38, cy + size * 0.24],
  ], premiumColors.gold, alpha * 0.96, 1.4);
  drawCapsule(buffer, cx - size * 0.54, cy - size * 0.25, cx - size * 0.86, cy - size * 0.12, size * 0.07, premiumColors.goldLight, alpha * 0.88);
  drawCapsule(buffer, cx + size * 0.54, cy - size * 0.25, cx + size * 0.86, cy - size * 0.12, size * 0.07, premiumColors.goldLight, alpha * 0.88);
  drawCapsule(buffer, cx, cy + size * 0.44, cx, cy + size * 0.82, size * 0.1, premiumColors.gold, alpha * 0.92);
  drawCapsule(buffer, cx - size * 0.42, cy + size * 0.88, cx + size * 0.42, cy + size * 0.88, size * 0.12, premiumColors.goldLight, alpha * 0.92);
  drawSpark(buffer, cx + size * 0.42, cy - size * 0.48, size * 0.16, premiumColors.white, alpha * 0.44);
};

const renderDiamondJackpotBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1301);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 380, premiumColors.cyan, 0.055, 128);
  drawRing(rgba, cx, cy, 290, 10, premiumColors.white, 0.13);
  for (let shard = 0; shard < 42; shard += 1) {
    const angle = rng() * TAU;
    const distance = 130 + rng() * 820;
    drawDiamond(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.6, 22 + rng() * 34, rng() * TAU, shard % 3 === 0 ? premiumColors.diamond : shard % 3 === 1 ? premiumColors.cyan : premiumColors.goldLight, 0.52 + rng() * 0.28);
  }
  drawPremiumDiamond(rgba, cx, cy, 230, 0.98);
  drawLuckyDust(rgba, 1302, cx, cy, 34);
  return rgba;
};

const renderRoyalGoldCrown = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1311);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.46;
  drawCircle(rgba, cx, cy, 380, premiumColors.gold, 0.06, 128);
  drawCrown(rgba, cx, cy, 230, 0.98);
  for (let spark = 0; spark < 44; spark += 1) {
    const angle = rng() * TAU;
    const distance = 120 + rng() * 820;
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 8 + rng() * 12, spark % 2 === 0 ? premiumColors.goldLight : premiumColors.white, 0.22 + rng() * 0.16);
  }
  return rgba;
};

const renderMoneyWinCascade = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1321);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 390, premiumColors.gold, 0.05, 128);
  for (let item = 0; item < 46; item += 1) {
    const x = 60 + rng() * (WIDTH - 120);
    const y = 40 + rng() * (HEIGHT - 100);
    if (item % 3 === 0) drawCoin(rgba, x, y, 20 + rng() * 24, 0.78, rng() * TAU);
    else drawMoneySymbol(rgba, x, y, 44 + rng() * 34, item % 2 === 0 ? premiumColors.gold : premiumColors.emerald, 0.62);
  }
  drawMoneySymbol(rgba, cx, cy, 255, premiumColors.gold, 0.95);
  drawLuckyDust(rgba, 1322, cx, cy, 38);
  return rgba;
};

const renderElectricPremiumBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 390, premiumColors.cyan, 0.07, 128);
  for (const [x, y, scale, rotation] of [[500, 310, 1.1, -0.22], [1420, 310, 1.1, 0.22], [960, 520, 1.35, 0], [340, 610, 0.88, -0.4], [1580, 610, 0.88, 0.4]]) {
    drawLightning(rgba, x, y, scale, premiumColors.white, premiumColors.cyan, rotation, 0.92);
  }
  drawRing(rgba, cx, cy, 210, 14, premiumColors.cyan, 0.2);
  drawRing(rgba, cx, cy, 360, 10, premiumColors.blue, 0.13);
  drawLuckyDust(rgba, 1331, cx, cy, 38);
  return rgba;
};

const renderTrophyWinMoment = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1341);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 380, premiumColors.gold, 0.06, 128);
  drawTrophy(rgba, cx, cy, 220, 0.98);
  for (let spark = 0; spark < 44; spark += 1) {
    const angle = rng() * TAU;
    const distance = 120 + rng() * 800;
    drawSpark(rgba, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.58, 8 + rng() * 12, spark % 2 === 0 ? premiumColors.goldLight : premiumColors.white, 0.22 + rng() * 0.16);
  }
  return rgba;
};

const confettiSceneColors = [palette.pink, palette.blue, palette.gold, palette.purple, palette.orange, palette.white, palette.goldLight];

const drawConfettiCloud = (buffer, seed, centerX, centerY, count, radiusX = 780, radiusY = 430) => {
  const rng = createRng(seed);
  for (let confetti = 0; confetti < count; confetti += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    const x = centerX + (Math.cos(angle) * radiusX * distance);
    const y = centerY + (Math.sin(angle) * radiusY * distance);
    const width = 10 + (rng() * 30);
    const height = 6 + (rng() * 12);
    const color = confettiSceneColors[confetti % confettiSceneColors.length];
    drawRotatedRect(buffer, x, y, width, height, rng() * TAU, color, 0.56 + (rng() * 0.34));
    if (confetti % 8 === 0) {
      drawRibbonTrail(buffer, [
        [centerX, centerY],
        [centerX + (Math.cos(angle - 0.12) * radiusX * distance * 0.55), centerY + (Math.sin(angle - 0.12) * radiusY * distance * 0.55)],
        [x, y],
      ], color, palette.white, 0.32);
    }
  }
};

const renderMegaConfettiCannon = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.54;
  drawCircle(rgba, cx, cy, 390, palette.pink, 0.055, 128);
  drawPartyHorn(rgba, 360, 700, 292, -0.18, palette.purple, palette.blue, palette.goldLight, 0.98);
  drawPartyHorn(rgba, WIDTH - 360, 700, 292, Math.PI + 0.18, palette.pink, palette.blue, palette.goldLight, 0.98);
  drawConfettiCloud(rgba, 1401, 330, 680, 62, 700, 360);
  drawConfettiCloud(rgba, 1402, WIDTH - 330, 680, 62, 700, 360);
  drawConfettiCloud(rgba, 1403, cx, cy, 42, 760, 430);
  return rgba;
};

const renderConfettiJackpotBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 410, palette.goldLight, 0.06, 128);
  drawRing(rgba, cx, cy, 210, 14, palette.gold, 0.18);
  drawRing(rgba, cx, cy, 340, 10, palette.pink, 0.1);
  drawConfettiCloud(rgba, 1411, cx, cy, 118, 820, 450);
  drawSpark(rgba, cx, cy, 58, palette.white, 0.44);
  return rgba;
};

const renderConfettiRainStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1421);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.46, 420, palette.blue, 0.035, 128);
  for (let confetti = 0; confetti < 120; confetti += 1) {
    const x = 40 + (rng() * (WIDTH - 80));
    const y = 20 + (rng() * (HEIGHT - 60));
    const color = confettiSceneColors[confetti % confettiSceneColors.length];
    drawRotatedRect(rgba, x, y, 10 + (rng() * 26), 6 + (rng() * 10), rng() * TAU, color, 0.46 + (rng() * 0.32));
    if (confetti % 9 === 0) {
      drawCapsule(rgba, x - 10, y - 34, x + 8, y + 28, 2.2, palette.white, 0.16);
    }
  }
  return rgba;
};

const renderRibbonConfettiBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 360, palette.purple, 0.05, 120);
  const sweeps = [
    [[-80, 190], [760, 390], [WIDTH + 120, 720], palette.pink, palette.white],
    [[WIDTH + 80, 170], [1120, 410], [-120, 750], palette.blue, palette.goldLight],
    [[-80, 770], [900, 500], [WIDTH + 120, 280], palette.gold, palette.white],
    [[WIDTH + 80, 770], [980, 470], [-120, 260], palette.purple, palette.white],
  ];
  for (const [pointsA, pointsB, pointsC, glow, core] of sweeps) {
    drawRibbonTrail(rgba, [pointsA, pointsB, pointsC], glow, core, 0.9);
  }
  drawConfettiCloud(rgba, 1431, cx, cy, 84, 760, 420);
  return rgba;
};

const renderGrandConfettiFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 440, palette.goldLight, 0.055, 128);
  drawPartyHorn(rgba, 320, 710, 250, -0.2, palette.purple, palette.blue, palette.goldLight, 0.86);
  drawPartyHorn(rgba, WIDTH - 320, 710, 250, Math.PI + 0.2, palette.pink, palette.blue, palette.goldLight, 0.86);
  drawConfettiCloud(rgba, 1441, 300, 690, 42, 620, 350);
  drawConfettiCloud(rgba, 1442, WIDTH - 300, 690, 42, 620, 350);
  drawConfettiCloud(rgba, 1443, cx, cy, 110, 850, 460);
  drawRibbonTrail(rgba, [[-80, 250], [780, 380], [WIDTH + 120, 650]], palette.pink, palette.white, 0.74);
  drawRibbonTrail(rgba, [[WIDTH + 80, 250], [1120, 380], [-120, 650]], palette.blue, palette.goldLight, 0.74);
  return rgba;
};

const premiumConfettiSceneColors = [palette.gold, palette.goldLight, palette.orange, palette.white, palette.blue, palette.pink];
const rainbowConfettiSceneColors = [palette.pink, palette.orange, palette.gold, palette.green, palette.blue, palette.purple, palette.white];
const goldenLuxuryConfettiSceneColors = [palette.gold, palette.goldLight, palette.orange, palette.white];

const drawPremiumConfettiCloud = (buffer, seed, centerX, centerY, count, radiusX = 850, radiusY = 470, colors = premiumConfettiSceneColors) => {
  const rng = createRng(seed);
  for (let confetti = 0; confetti < count; confetti += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    const x = centerX + (Math.cos(angle) * radiusX * distance);
    const y = centerY + (Math.sin(angle) * radiusY * distance);
    const color = colors[confetti % colors.length];
    if (confetti % 6 === 0) {
      drawRibbonTrail(buffer, [
        [centerX + (Math.cos(angle) * 80), centerY + (Math.sin(angle) * 50)],
        [centerX + (Math.cos(angle - 0.15) * radiusX * distance * 0.55), centerY + (Math.sin(angle - 0.15) * radiusY * distance * 0.55)],
        [x, y],
      ], color, palette.white, 0.42);
    } else {
      drawRotatedRect(buffer, x, y, 12 + (rng() * 34), 6 + (rng() * 14), rng() * TAU, color, 0.58 + (rng() * 0.32));
      if (confetti % 11 === 0) {
        drawSpark(buffer, x, y, 5 + (rng() * 10), palette.white, 0.26);
      }
    }
  }
};

const drawPremiumConfettiRain = (buffer, seed, count, colors = premiumConfettiSceneColors) => {
  const rng = createRng(seed);
  for (let piece = 0; piece < count; piece += 1) {
    const x = 50 + (rng() * (WIDTH - 100));
    const y = 20 + (rng() * (HEIGHT - 40));
    const color = colors[piece % colors.length];
    if (piece % 7 === 0) {
      drawRibbonTrail(buffer, [[x - 20, y - 60], [x + 18, y - 8], [x - 6, y + 54]], color, palette.white, 0.35);
    } else {
      drawRotatedRect(buffer, x, y, 10 + (rng() * 28), 6 + (rng() * 12), rng() * TAU, color, 0.48 + (rng() * 0.28));
    }
  }
};

const renderLuxuryConfettiBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 470, palette.goldLight, 0.07, 150);
  drawRing(rgba, cx, cy, 250, 14, palette.gold, 0.18);
  drawRing(rgba, cx, cy, 420, 8, palette.white, 0.1);
  drawPremiumConfettiCloud(rgba, 1861, cx, cy, 142, 900, 490);
  drawRibbonTrail(rgba, [[-80, 260], [780, 400], [WIDTH + 120, 670]], palette.gold, palette.white, 0.82);
  drawRibbonTrail(rgba, [[WIDTH + 80, 250], [1120, 390], [-120, 690]], palette.goldLight, palette.pink, 0.78);
  drawSpark(rgba, cx, cy, 62, palette.white, 0.46);
  return rgba;
};

const renderGoldenConfettiStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.45, 520, palette.goldLight, 0.055, 150);
  drawPremiumConfettiRain(rgba, 1871, 152, [palette.gold, palette.goldLight, palette.orange, palette.white]);
  drawPremiumConfettiCloud(rgba, 1872, WIDTH * 0.5, HEIGHT * 0.42, 62, 840, 360, [palette.gold, palette.goldLight, palette.orange, palette.white]);
  return rgba;
};

const renderConfettiShockwave = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 480, palette.blue, 0.055, 150);
  drawRing(rgba, cx, cy, 230, 16, palette.white, 0.2);
  drawRing(rgba, cx, cy, 390, 11, palette.gold, 0.15);
  drawRing(rgba, cx, cy, 570, 7, palette.pink, 0.1);
  drawPremiumConfettiCloud(rgba, 1881, cx, cy, 148, 930, 430, rainbowConfettiSceneColors);
  drawSpark(rgba, cx, cy, 70, palette.white, 0.4);
  return rgba;
};

const renderRainbowConfettiCascade = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.48, 500, palette.purple, 0.05, 150);
  drawPremiumConfettiRain(rgba, 1891, 130, rainbowConfettiSceneColors);
  drawRibbonTrail(rgba, [[-80, 180], [700, 330], [WIDTH + 120, 620]], palette.pink, palette.white, 0.76);
  drawRibbonTrail(rgba, [[WIDTH + 80, 210], [1180, 350], [-120, 650]], palette.blue, palette.white, 0.76);
  drawRibbonTrail(rgba, [[-80, 720], [840, 500], [WIDTH + 120, 260]], palette.gold, palette.white, 0.7);
  drawRibbonTrail(rgba, [[WIDTH + 80, 740], [1060, 500], [-120, 280]], palette.green, palette.goldLight, 0.7);
  drawPremiumConfettiCloud(rgba, 1892, WIDTH * 0.5, HEIGHT * 0.5, 70, 820, 420, rainbowConfettiSceneColors);
  return rgba;
};

const renderGrandPremiumConfettiFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 560, palette.goldLight, 0.07, 160);
  drawPartyHorn(rgba, 300, 710, 270, -0.18, palette.gold, palette.pink, palette.white, 0.94);
  drawPartyHorn(rgba, WIDTH - 300, 710, 270, Math.PI + 0.18, palette.blue, palette.pink, palette.white, 0.94);
  drawPremiumConfettiCloud(rgba, 1901, 300, HEIGHT * 0.68, 70, 680, 350, rainbowConfettiSceneColors);
  drawPremiumConfettiCloud(rgba, 1902, WIDTH - 300, HEIGHT * 0.68, 70, 680, 350, rainbowConfettiSceneColors);
  drawPremiumConfettiCloud(rgba, 1903, cx, cy, 150, 930, 490, premiumConfettiSceneColors);
  drawPremiumConfettiRain(rgba, 1904, 82, rainbowConfettiSceneColors);
  drawRibbonTrail(rgba, [[-80, 230], [760, 380], [WIDTH + 120, 670]], palette.gold, palette.white, 0.82);
  drawRibbonTrail(rgba, [[WIDTH + 80, 230], [1160, 390], [-120, 680]], palette.pink, palette.white, 0.78);
  drawRibbonTrail(rgba, [[-80, 790], [850, 520], [WIDTH + 120, 300]], palette.blue, palette.goldLight, 0.72);
  return rgba;
};

const renderGoldenConfettiJackpotBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 540, palette.goldLight, 0.075, 160);
  drawRing(rgba, cx, cy, 280, 16, palette.gold, 0.22);
  drawRing(rgba, cx, cy, 470, 9, palette.white, 0.12);
  drawPremiumConfettiCloud(rgba, 2001, cx, cy, 160, 950, 500, goldenLuxuryConfettiSceneColors);
  drawRibbonTrail(rgba, [[-80, 250], [780, 390], [WIDTH + 120, 670]], palette.gold, palette.white, 0.86);
  drawRibbonTrail(rgba, [[WIDTH + 80, 250], [1120, 390], [-120, 690]], palette.goldLight, palette.orange, 0.8);
  drawSpark(rgba, cx, cy, 76, palette.white, 0.5);
  return rgba;
};

const renderVipGoldConfettiRain = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.44, 560, palette.goldLight, 0.06, 150);
  drawPremiumConfettiRain(rgba, 2011, 188, goldenLuxuryConfettiSceneColors);
  drawPremiumConfettiCloud(rgba, 2012, WIDTH * 0.5, HEIGHT * 0.42, 72, 860, 370, goldenLuxuryConfettiSceneColors);
  drawRing(rgba, WIDTH * 0.5, HEIGHT * 0.44, 390, 9, palette.gold, 0.12);
  return rgba;
};

const renderTrophyGoldConfettiBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 520, palette.goldLight, 0.07, 160);
  drawRing(rgba, cx, cy, 350, 10, palette.gold, 0.16);
  drawPremiumConfettiCloud(rgba, 2021, cx, cy, 132, 920, 470, goldenLuxuryConfettiSceneColors);
  drawTrophy(rgba, cx, cy, 210, 0.95);
  drawSpark(rgba, cx + 170, cy - 160, 48, palette.white, 0.44);
  drawSpark(rgba, cx - 190, cy - 120, 34, palette.goldLight, 0.38);
  return rgba;
};

const renderGoldRibbonConfettiStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 540, palette.goldLight, 0.065, 150);
  drawPremiumConfettiCloud(rgba, 2031, cx, cy, 118, 900, 460, goldenLuxuryConfettiSceneColors);
  drawPremiumConfettiRain(rgba, 2032, 94, goldenLuxuryConfettiSceneColors);
  drawRibbonTrail(rgba, [[-80, 160], [700, 330], [WIDTH + 120, 630]], palette.gold, palette.white, 0.84);
  drawRibbonTrail(rgba, [[WIDTH + 80, 190], [1180, 340], [-120, 650]], palette.goldLight, palette.gold, 0.8);
  drawRibbonTrail(rgba, [[-80, 800], [820, 520], [WIDTH + 120, 290]], palette.orange, palette.white, 0.72);
  drawRibbonTrail(rgba, [[WIDTH + 80, 790], [1050, 520], [-120, 300]], palette.gold, palette.goldLight, 0.72);
  return rgba;
};

const renderRoyalGoldConfettiFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 600, palette.goldLight, 0.075, 170);
  drawCrown(rgba, cx, HEIGHT * 0.34, 190, 0.94);
  drawRing(rgba, cx, HEIGHT * 0.36, 370, 10, palette.gold, 0.14);
  drawPremiumConfettiCloud(rgba, 2041, cx, cy, 172, 980, 510, goldenLuxuryConfettiSceneColors);
  drawPremiumConfettiRain(rgba, 2042, 118, goldenLuxuryConfettiSceneColors);
  drawRibbonTrail(rgba, [[-80, 240], [760, 390], [WIDTH + 120, 670]], palette.gold, palette.white, 0.86);
  drawRibbonTrail(rgba, [[WIDTH + 80, 245], [1160, 390], [-120, 680]], palette.goldLight, palette.orange, 0.82);
  drawSpark(rgba, cx, cy, 82, palette.white, 0.46);
  return rgba;
};

const heartSceneColors = {
  red: hexToRgb("#ff3f6e"),
  pink: hexToRgb("#ff6ec7"),
  hotPink: hexToRgb("#ff4fd8"),
  rose: hexToRgb("#ff9fdb"),
  white: hexToRgb("#ffffff"),
  goldLight: hexToRgb("#fff1b4"),
};

const heartShapePoints = (cx, cy, size, rotation = 0) => {
  const points = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  for (let index = 0; index < 40; index += 1) {
    const t = (index / 40) * TAU;
    const x = 16 * Math.sin(t) ** 3 * size * 0.033;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * size * 0.033;
    points.push([cx + x * cos - y * sin, cy + x * sin + y * cos]);
  }
  return points;
};

const drawHeart = (buffer, cx, cy, size, color = heartSceneColors.red, alpha = 1, rotation = 0) => {
  drawPolygon(buffer, heartShapePoints(cx, cy, size * 1.18, rotation), color, alpha * 0.12, 2.4);
  drawPolygon(buffer, heartShapePoints(cx, cy, size, rotation), color, alpha * 0.94, 1.35);
  drawCircle(buffer, cx - size * 0.14, cy - size * 0.16, size * 0.06, heartSceneColors.white, alpha * 0.25);
};

const drawHeartCloud = (buffer, seed, cx, cy, count, radiusX = 820, radiusY = 450) => {
  const rng = createRng(seed);
  const colors = [heartSceneColors.red, heartSceneColors.pink, heartSceneColors.hotPink, heartSceneColors.rose];
  for (let heart = 0; heart < count; heart += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    drawHeart(buffer, cx + Math.cos(angle) * radiusX * distance, cy + Math.sin(angle) * radiusY * distance, 28 + rng() * 48, colors[heart % colors.length], 0.46 + rng() * 0.34, rng() * 0.7 - 0.35);
  }
};

const drawCupidArrow = (buffer, x1, y1, x2, y2, alpha = 1) => {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  drawCapsule(buffer, x1, y1, x2, y2, 6, heartSceneColors.white, alpha * 0.86);
  drawCapsule(buffer, x1, y1, x2, y2, 14, heartSceneColors.pink, alpha * 0.22);
  const head = 44;
  const left = angle + Math.PI - 0.45;
  const right = angle + Math.PI + 0.45;
  drawPolygon(buffer, [[x2, y2], [x2 + Math.cos(left) * head, y2 + Math.sin(left) * head], [x2 + Math.cos(right) * head, y2 + Math.sin(right) * head]], heartSceneColors.white, alpha * 0.9, 1.2);
  drawPolygon(buffer, [[x1, y1], [x1 - Math.cos(angle) * 56 + Math.cos(angle + 1.1) * 36, y1 - Math.sin(angle) * 56 + Math.sin(angle + 1.1) * 36], [x1 - Math.cos(angle) * 26, y1 - Math.sin(angle) * 26]], heartSceneColors.pink, alpha * 0.82, 1.2);
  drawPolygon(buffer, [[x1, y1], [x1 - Math.cos(angle) * 56 + Math.cos(angle - 1.1) * 36, y1 - Math.sin(angle) * 56 + Math.sin(angle - 1.1) * 36], [x1 - Math.cos(angle) * 26, y1 - Math.sin(angle) * 26]], heartSceneColors.pink, alpha * 0.82, 1.2);
};

const renderGiantHeartFormation = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 420, heartSceneColors.pink, 0.055, 128);
  for (let index = 0; index < 70; index += 1) {
    const t = (index / 70) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    drawHeart(rgba, cx + x * 24, cy + y * 21, 32 + (index % 5) * 5, index % 3 === 0 ? heartSceneColors.red : index % 3 === 1 ? heartSceneColors.pink : heartSceneColors.hotPink, 0.86);
  }
  drawHeart(rgba, cx, cy, 360, heartSceneColors.red, 0.32);
  drawLuckyDust(rgba, 1501, cx, cy, 34);
  return rgba;
};

const renderHeartRainExplosion = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(1511);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 390, heartSceneColors.hotPink, 0.05, 128);
  for (let heart = 0; heart < 90; heart += 1) {
    const x = 40 + rng() * (WIDTH - 80);
    const y = 20 + rng() * (HEIGHT - 80);
    const colors = [heartSceneColors.red, heartSceneColors.pink, heartSceneColors.hotPink, heartSceneColors.rose];
    drawHeart(rgba, x, y, 24 + rng() * 42, colors[heart % colors.length], 0.44 + rng() * 0.28, rng() * 0.5 - 0.25);
  }
  drawHeart(rgba, cx, cy, 230, heartSceneColors.hotPink, 0.88);
  drawHeartCloud(rgba, 1512, cx, cy, 32, 760, 400);
  return rgba;
};

const renderCupidHeartBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 390, heartSceneColors.pink, 0.05, 128);
  drawCupidArrow(rgba, 320, cy - 120, 1280, cy + 40, 0.92);
  drawHeartCloud(rgba, 1521, cx, cy, 58, 820, 420);
  drawHeart(rgba, cx, cy, 250, heartSceneColors.red, 0.9);
  drawSpark(rgba, cx, cy, 54, heartSceneColors.white, 0.34);
  return rgba;
};

const renderDoubleHeartMerge = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 380, heartSceneColors.rose, 0.045, 128);
  drawHeart(rgba, cx - 150, cy, 220, heartSceneColors.red, 0.8, -0.08);
  drawHeart(rgba, cx + 150, cy, 220, heartSceneColors.pink, 0.8, 0.08);
  drawHeart(rgba, cx, cy, 320, heartSceneColors.hotPink, 0.58);
  drawHeartCloud(rgba, 1531, cx, cy, 36, 720, 380);
  return rgba;
};

const renderHeartJackpotFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 430, heartSceneColors.pink, 0.06, 128);
  drawHeartCloud(rgba, 1541, cx, cy, 88, 860, 470);
  drawHeart(rgba, cx, cy, 340, heartSceneColors.red, 0.9);
  drawSpark(rgba, cx, cy, 60, heartSceneColors.white, 0.34);
  drawLuckyDust(rgba, 1542, cx, cy, 34);
  return rgba;
};

const thumbColors = {
  blue: hexToRgb("#2f86ff"),
  cyan: hexToRgb("#58c7ff"),
  lightBlue: hexToRgb("#d8ecff"),
  white: hexToRgb("#ffffff"),
};

const drawThumbsUp = (buffer, cx, cy, size, color = thumbColors.blue, alpha = 1, rotation = 0) => {
  const transform = (x, y) => {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return [cx + x * cos - y * sin, cy + x * sin + y * cos];
  };
  drawCircle(buffer, cx, cy, size * 0.9, color, alpha * 0.1, size * 0.3);
  const [px, py] = transform(size * 0.05, size * 0.18);
  drawRotatedRect(buffer, px, py, size * 0.62, size * 0.68, rotation - 0.06, color, alpha * 0.94, size * 0.12);
  const [tx, ty] = transform(-size * 0.27, -size * 0.2);
  drawRotatedRect(buffer, tx, ty, size * 0.32, size * 0.78, rotation - 0.6, color, alpha * 0.94, size * 0.12);
  for (let finger = 0; finger < 4; finger += 1) {
    const [fx, fy] = transform(size * 0.32, -size * 0.16 + finger * size * 0.18);
    drawRotatedRect(buffer, fx, fy, size * (0.52 - finger * 0.035), size * 0.17, rotation, color, alpha * 0.94, size * 0.07);
  }
  const [wx, wy] = transform(-size * 0.18, size * 0.6);
  drawRotatedRect(buffer, wx, wy, size * 0.34, size * 0.34, rotation, thumbColors.lightBlue, alpha * 0.86, size * 0.07);
  drawSpark(buffer, cx + size * 0.42, cy - size * 0.42, size * 0.11, thumbColors.white, alpha * 0.36);
};

const drawThumbCloud = (buffer, seed, cx, cy, count, radiusX = 820, radiusY = 440) => {
  const rng = createRng(seed);
  const colors = [thumbColors.blue, thumbColors.cyan, thumbColors.lightBlue, thumbColors.white];
  for (let thumb = 0; thumb < count; thumb += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    drawThumbsUp(buffer, cx + Math.cos(angle) * radiusX * distance, cy + Math.sin(angle) * radiusY * distance, 34 + rng() * 56, colors[thumb % colors.length], 0.44 + rng() * 0.34, rng() * 0.7 - 0.35);
  }
};

const renderGiantLikePop = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 410, thumbColors.cyan, 0.06, 128);
  drawRing(rgba, cx, cy, 240, 14, thumbColors.blue, 0.18);
  drawRing(rgba, cx, cy, 380, 10, thumbColors.white, 0.1);
  drawThumbsUp(rgba, cx, cy, 330, thumbColors.blue, 0.96);
  drawLuckyDust(rgba, 1601, cx, cy, 34);
  return rgba;
};

const renderThumbsUpStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 390, thumbColors.blue, 0.045, 128);
  drawThumbCloud(rgba, 1611, cx, cy, 58, 860, 460);
  drawThumbsUp(rgba, cx, cy, 250, thumbColors.blue, 0.9);
  return rgba;
};

const renderMegaApprovalBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 420, thumbColors.cyan, 0.065, 128);
  drawRing(rgba, cx, cy, 210, 16, thumbColors.cyan, 0.22);
  drawRing(rgba, cx, cy, 360, 11, thumbColors.blue, 0.14);
  drawThumbCloud(rgba, 1621, cx, cy, 34, 780, 420);
  drawThumbsUp(rgba, cx, cy, 300, thumbColors.cyan, 0.94);
  return rgba;
};

const renderEmojiLikeBounce = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 380, thumbColors.blue, 0.045, 128);
  drawCapsule(rgba, 240, 240, 560, 690, 4, thumbColors.white, 0.12);
  drawCapsule(rgba, 560, 690, 860, 280, 4, thumbColors.white, 0.12);
  drawCapsule(rgba, 860, 280, cx, cy, 4, thumbColors.white, 0.12);
  drawThumbsUp(rgba, 330, 250, 80, thumbColors.lightBlue, 0.38, -0.2);
  drawThumbsUp(rgba, 650, 660, 126, thumbColors.cyan, 0.5, 0.14);
  drawThumbsUp(rgba, cx, cy, 300, thumbColors.blue, 0.94);
  drawThumbCloud(rgba, 1631, cx, cy, 24, 680, 360);
  return rgba;
};

const renderThumbsUpFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 430, thumbColors.cyan, 0.06, 128);
  drawRing(rgba, cx, cy, 260, 14, thumbColors.blue, 0.18);
  drawRing(rgba, cx, cy, 430, 10, thumbColors.white, 0.1);
  drawThumbCloud(rgba, 1641, cx, cy, 52, 860, 460);
  drawThumbsUp(rgba, cx, cy, 320, thumbColors.blue, 0.96);
  drawLuckyDust(rgba, 1642, cx, cy, 34);
  return rgba;
};

const kissColors = {
  red: hexToRgb("#ff315f"),
  lipstick: hexToRgb("#d81b60"),
  pink: hexToRgb("#ff6ec7"),
  rose: hexToRgb("#ff9fdb"),
  white: hexToRgb("#ffffff"),
};

const drawKissMark = (buffer, cx, cy, size, color = kissColors.lipstick, alpha = 1, rotation = 0) => {
  const transform = (x, y) => {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return [cx + x * cos - y * sin, cy + x * sin + y * cos];
  };
  drawCircle(buffer, cx, cy, size * 0.72, color, alpha * 0.1, size * 0.24);
  for (const [x, y, w, h, r] of [
    [-0.22, -0.13, 0.58, 0.25, -0.22],
    [0.22, -0.13, 0.58, 0.25, 0.22],
    [0, 0.14, 1.02, 0.34, -0.04],
  ]) {
    const [px, py] = transform(x * size, y * size);
    drawPolygon(buffer, rotatedPetalPoints(px, py, size * w, size * h, rotation + r, 18), color, alpha * 0.94, 1.35);
  }
  const [gx, gy] = transform(0, size * 0.02);
  drawPolygon(buffer, rotatedPetalPoints(gx, gy, size * 0.82, size * 0.1, rotation - 0.04, 16), hexToRgb("#230313"), alpha * 0.36, 1.1);
  const [hx, hy] = transform(-size * 0.28, -size * 0.18);
  drawCircle(buffer, hx, hy, size * 0.045, kissColors.white, alpha * 0.28);
};

const drawKissCloud = (buffer, seed, cx, cy, count, radiusX = 820, radiusY = 440) => {
  const rng = createRng(seed);
  const colors = [kissColors.red, kissColors.lipstick, kissColors.pink, kissColors.rose];
  for (let kiss = 0; kiss < count; kiss += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    drawKissMark(buffer, cx + Math.cos(angle) * radiusX * distance, cy + Math.sin(angle) * radiusY * distance, 42 + rng() * 60, colors[kiss % colors.length], 0.42 + rng() * 0.34, rng() * 0.7 - 0.35);
  }
};

const renderGiantKissMarkBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 410, kissColors.pink, 0.06, 128);
  drawRing(rgba, cx, cy, 250, 14, kissColors.red, 0.17);
  drawRing(rgba, cx, cy, 390, 10, kissColors.white, 0.1);
  drawKissMark(rgba, cx, cy, 410, kissColors.lipstick, 0.96, -0.04);
  drawLuckyDust(rgba, 1701, cx, cy, 34);
  return rgba;
};

const renderKissStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 410, kissColors.rose, 0.055, 128);
  drawKissCloud(rgba, 1711, cx, cy, 82, 880, 470);
  drawKissMark(rgba, cx, cy, 300, kissColors.red, 0.88);
  return rgba;
};

const renderAirKissExplosion = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 390, kissColors.pink, 0.05, 128);
  drawCapsule(rgba, 220, cy - 120, cx, cy, 5, kissColors.white, 0.16);
  drawKissMark(rgba, 300, cy - 130, 120, kissColors.pink, 0.6, -0.12);
  drawKissCloud(rgba, 1721, cx, cy, 42, 760, 410);
  drawHeartCloud(rgba, 1722, cx, cy, 28, 720, 380);
  drawKissMark(rgba, cx, cy, 260, kissColors.lipstick, 0.9);
  return rgba;
};

const renderGlamourKissReveal = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 410, kissColors.red, 0.055, 128);
  drawRibbonTrail(rgba, [[-80, 300], [760, 390], [WIDTH + 120, 620]], kissColors.red, kissColors.white, 0.7);
  drawRibbonTrail(rgba, [[WIDTH + 80, 280], [1120, 420], [-120, 650]], kissColors.pink, kissColors.white, 0.7);
  drawKissMark(rgba, cx, cy, 390, kissColors.red, 0.96, -0.04);
  drawLuckyDust(rgba, 1731, cx, cy, 40);
  return rgba;
};

const renderKissJackpotFinale = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 430, kissColors.pink, 0.06, 128);
  drawKissCloud(rgba, 1741, cx, cy, 70, 860, 460);
  drawHeartCloud(rgba, 1742, cx, cy, 44, 820, 430);
  drawKissMark(rgba, cx, cy, 390, kissColors.lipstick, 0.96);
  drawSpark(rgba, cx, cy, 60, kissColors.white, 0.34);
  return rgba;
};

const fireworkPreviewBursts = {
  mega: [
    { x: 340, y: 252, radius: 126, rays: 18, color: palette.pink, accent: palette.white },
    { x: 1570, y: 250, radius: 136, rays: 18, color: palette.blue, accent: palette.white },
    { x: 740, y: 248, radius: 158, rays: 22, color: palette.gold, accent: palette.goldLight },
    { x: 1180, y: 292, radius: 162, rays: 22, color: palette.orange, accent: palette.white },
    { x: 960, y: 402, radius: 232, rays: 28, color: palette.gold, accent: palette.white },
  ],
  jackpot: [
    { x: 300, y: 230, radius: 136, rays: 20, color: palette.gold, accent: palette.goldLight },
    { x: 620, y: 320, radius: 164, rays: 22, color: palette.orange, accent: palette.white },
    { x: 960, y: 220, radius: 196, rays: 24, color: palette.gold, accent: palette.white },
    { x: 1300, y: 330, radius: 168, rays: 22, color: palette.goldLight, accent: palette.white },
    { x: 1620, y: 250, radius: 142, rays: 20, color: palette.orange, accent: palette.goldLight },
  ],
  chaos: [
    { x: 240, y: 318, radius: 112, rays: 16, color: palette.blue, accent: palette.white },
    { x: 520, y: 206, radius: 132, rays: 18, color: palette.pink, accent: palette.white },
    { x: 760, y: 370, radius: 154, rays: 20, color: palette.purple, accent: palette.pink },
    { x: 1020, y: 246, radius: 170, rays: 22, color: palette.gold, accent: palette.white },
    { x: 1260, y: 394, radius: 150, rays: 20, color: palette.blue, accent: palette.white },
    { x: 1540, y: 244, radius: 138, rays: 18, color: palette.orange, accent: palette.goldLight },
    { x: 960, y: 520, radius: 198, rays: 24, color: palette.pink, accent: palette.white },
  ],
  galaxy: [
    { x: 410, y: 280, radius: 148, rays: 20, color: palette.purple, accent: palette.blue },
    { x: 740, y: 216, radius: 168, rays: 22, color: palette.blue, accent: palette.white },
    { x: 1090, y: 285, radius: 192, rays: 24, color: palette.pink, accent: palette.white },
    { x: 1420, y: 220, radius: 156, rays: 22, color: palette.gold, accent: palette.goldLight },
    { x: 960, y: 462, radius: 230, rays: 28, color: palette.purple, accent: palette.blue },
  ],
  grand: [
    { x: 260, y: 250, radius: 150, rays: 20, color: palette.gold, accent: palette.white },
    { x: 560, y: 350, radius: 166, rays: 22, color: palette.pink, accent: palette.white },
    { x: 860, y: 210, radius: 188, rays: 24, color: palette.blue, accent: palette.white },
    { x: 1160, y: 370, radius: 172, rays: 22, color: palette.orange, accent: palette.goldLight },
    { x: 1500, y: 242, radius: 164, rays: 22, color: palette.purple, accent: palette.blue },
    { x: 960, y: 442, radius: 260, rays: 30, color: palette.gold, accent: palette.white },
  ],
};

const drawFireworkPreviewScene = (seed, bursts, options = {}) => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(seed);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.48;

  bursts.forEach((burst, index) => {
    const fromX = options.sideLaunches && index > 1 ? (index % 2 === 0 ? -80 : WIDTH + 80) : burst.x + (index % 2 === 0 ? -190 : 190);
    const fromY = options.sideLaunches && index > 1 ? HEIGHT * (0.52 + ((index % 3) * 0.1)) : HEIGHT + 80;
    drawCapsule(rgba, fromX, fromY, burst.x, burst.y, 5.8, burst.color, 0.2);
    drawCapsule(rgba, fromX, fromY, burst.x, burst.y, 1.9, burst.accent, 0.56);
  });

  bursts.forEach((burst, index) => {
    drawFirework(rgba, burst.x, burst.y, burst.radius, burst.rays, burst.color, burst.accent, index === bursts.length - 1 ? 1 : 0.88);
  });

  for (let i = 0; i < (options.sparkCount ?? 130); i += 1) {
    const spreadX = rng() * WIDTH;
    const spreadY = 130 + (rng() * 700);
    const color = [palette.gold, palette.goldLight, palette.orange, palette.pink, palette.blue, palette.purple, palette.white][Math.floor(rng() * 7)];
    drawSpark(rgba, spreadX, spreadY, 5 + (rng() * 12), color, 0.22 + (rng() * 0.28));
  }

  for (let i = 0; i < (options.rainCount ?? 54); i += 1) {
    const x = 80 + (rng() * (WIDTH - 160));
    const y = 420 + (rng() * 520);
    const len = 22 + (rng() * 64);
    const color = [palette.gold, palette.goldLight, palette.orange, palette.white][Math.floor(rng() * 4)];
    drawCapsule(rgba, x, y, x + ((rng() - 0.5) * 36), y + len, 1.7 + (rng() * 1.6), color, 0.28);
  }

  return rgba;
};

const renderMegaFireworkDetonation = () => drawFireworkPreviewScene(9811, fireworkPreviewBursts.mega, {
  glow: palette.gold,
  glowRadius: 760,
  sparkCount: 128,
});

const renderJackpotSkyBlast = () => drawFireworkPreviewScene(9821, fireworkPreviewBursts.jackpot, {
  glow: palette.goldLight,
  glowRadius: 800,
  rings: 8,
  sparkCount: 148,
  rainCount: 72,
});

const renderFireworkChaosStorm = () => drawFireworkPreviewScene(9831, fireworkPreviewBursts.chaos, {
  glow: palette.purple,
  glowRadius: 820,
  sideLaunches: true,
  rings: 9,
  sparkCount: 168,
  rainCount: 60,
});

const renderGalaxyFireworkFinale = () => drawFireworkPreviewScene(9841, fireworkPreviewBursts.galaxy, {
  glow: palette.purple,
  glowRadius: 780,
  sideLaunches: true,
  rings: 7,
  sparkCount: 150,
  rainCount: 48,
});

const renderGrandJackpotFinale = () => drawFireworkPreviewScene(9851, fireworkPreviewBursts.grand, {
  glow: palette.gold,
  glowRadius: 900,
  sideLaunches: true,
  rings: 10,
  sparkCount: 188,
  rainCount: 84,
});

const neonSceneColors = {
  cyan: hexToRgb("#58e5ff"),
  blue: hexToRgb("#2f86ff"),
  magenta: hexToRgb("#ff4fd8"),
  purple: hexToRgb("#8f5bff"),
  gold: hexToRgb("#f5c65b"),
  white: hexToRgb("#ffffff"),
};

const drawNeonGridPreview = (buffer, horizonY = 430, floorY = HEIGHT + 70, colorA = neonSceneColors.cyan, colorB = neonSceneColors.magenta) => {
  const vanishX = WIDTH * 0.5;
  for (let idx = 0; idx < 11; idx += 1) {
    const x = -120 + idx * ((WIDTH + 240) / 10);
    const color = idx % 2 === 0 ? colorA : colorB;
    drawCapsule(buffer, x, floorY, vanishX, horizonY, 4.8, color, 0.18);
    drawCapsule(buffer, x, floorY, vanishX, horizonY, 1.7, neonSceneColors.white, 0.46);
  }
  for (let idx = 0; idx < 7; idx += 1) {
    const y = horizonY + Math.pow(idx / 6, 1.7) * (floorY - horizonY);
    const width = 260 + idx * 250;
    const color = idx % 2 === 0 ? colorB : colorA;
    drawCapsule(buffer, (WIDTH - width) * 0.5, y, (WIDTH + width) * 0.5, y, 4.2, color, 0.18);
    drawCapsule(buffer, (WIDTH - width) * 0.5, y, (WIDTH + width) * 0.5, y, 1.5, neonSceneColors.white, 0.42);
  }
};

const drawNeonParticles = (buffer, seed, count, cx, cy, radiusX = 820, radiusY = 420, colors = Object.values(neonSceneColors)) => {
  const rng = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * TAU;
    const distance = Math.sqrt(rng());
    const x = cx + Math.cos(angle) * radiusX * distance;
    const y = cy + Math.sin(angle) * radiusY * distance;
    const color = colors[i % colors.length];
    drawSpark(buffer, x, y, 5 + rng() * 11, color, 0.22 + rng() * 0.18);
  }
};

const drawNeonLightningPreview = (buffer, points, color, alpha = 1) => {
  for (let idx = 0; idx < points.length - 1; idx += 1) {
    drawCapsule(buffer, points[idx][0], points[idx][1], points[idx + 1][0], points[idx + 1][1], 7, color, alpha * 0.2);
    drawCapsule(buffer, points[idx][0], points[idx][1], points[idx + 1][0], points[idx + 1][1], 2.2, neonSceneColors.white, alpha * 0.78);
  }
};

const renderNeonGalaxyGrid = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 590, neonSceneColors.purple, 0.052, 160);
  drawNeonGridPreview(rgba);
  drawNeonParticles(rgba, 1961, 88, cx, HEIGHT * 0.42, 880, 380, [neonSceneColors.cyan, neonSceneColors.purple, neonSceneColors.magenta, neonSceneColors.white]);
  drawRing(rgba, cx, cy, 260, 8, neonSceneColors.cyan, 0.13);
  drawRing(rgba, cx, cy, 430, 7, neonSceneColors.magenta, 0.09);
  return rgba;
};

const renderElectricNeonStorm = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 540, neonSceneColors.cyan, 0.06, 160);
  drawNeonLightningPreview(rgba, [[-80, 210], [360, 280], [620, 350], [980, 300], [WIDTH + 80, 230]], neonSceneColors.cyan, 0.95);
  drawNeonLightningPreview(rgba, [[WIDTH + 80, 320], [1370, 360], [1120, 450], [700, 500], [-90, 620]], neonSceneColors.magenta, 0.9);
  drawNeonLightningPreview(rgba, [[240, HEIGHT + 80], [600, 690], [870, 510], [1210, 300], [1600, -80]], neonSceneColors.purple, 0.76);
  drawRing(rgba, cx, cy, 220, 12, neonSceneColors.white, 0.18);
  drawRing(rgba, cx, cy, 390, 10, neonSceneColors.cyan, 0.12);
  drawNeonParticles(rgba, 1972, 96, cx, cy, 880, 430, [neonSceneColors.cyan, neonSceneColors.magenta, neonSceneColors.white]);
  return rgba;
};

const renderNeonRibbonTunnel = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 600, neonSceneColors.magenta, 0.052, 160);
  drawRibbonTrail(rgba, [[-80, 170], [720, 340], [WIDTH + 120, 640]], neonSceneColors.cyan, neonSceneColors.white, 0.8);
  drawRibbonTrail(rgba, [[WIDTH + 80, 180], [1180, 350], [-120, 650]], neonSceneColors.magenta, neonSceneColors.white, 0.78);
  drawRibbonTrail(rgba, [[-80, 830], [820, 560], [WIDTH + 120, 280]], neonSceneColors.purple, neonSceneColors.cyan, 0.72);
  drawRibbonTrail(rgba, [[WIDTH + 80, 820], [1080, 560], [-120, 300]], neonSceneColors.blue, neonSceneColors.magenta, 0.72);
  for (let ring = 0; ring < 7; ring += 1) {
    drawRing(rgba, cx, cy, 170 + ring * 56, 6, [neonSceneColors.cyan, neonSceneColors.magenta, neonSceneColors.purple][ring % 3], 0.13 - ring * 0.01);
  }
  drawNeonParticles(rgba, 1982, 58, cx, cy, 780, 420);
  return rgba;
};

const renderLuxuryNeonPulse = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 520, neonSceneColors.gold, 0.058, 160);
  for (let ring = 0; ring < 9; ring += 1) {
    drawRing(rgba, cx, cy, 140 + ring * 52, 7 + (ring % 3), [neonSceneColors.gold, neonSceneColors.cyan, neonSceneColors.white][ring % 3], 0.16 - ring * 0.011);
  }
  for (let beam = 0; beam < 10; beam += 1) {
    const angle = -0.9 + beam * 0.2;
    const x = cx + Math.sin(angle) * 420;
    drawCapsule(rgba, cx, cy, x, cy - 360 - (beam % 4) * 42, 5, [neonSceneColors.gold, neonSceneColors.cyan, neonSceneColors.white][beam % 3], 0.13);
  }
  drawNeonParticles(rgba, 1993, 52, cx, cy, 760, 390, [neonSceneColors.gold, neonSceneColors.cyan, neonSceneColors.white]);
  return rgba;
};

const renderMegaNeonJackpot = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 650, neonSceneColors.magenta, 0.065, 180);
  drawNeonGridPreview(rgba, 420, HEIGHT + 70, neonSceneColors.cyan, neonSceneColors.purple);
  drawRibbonTrail(rgba, [[-90, 210], [760, 370], [WIDTH + 130, 690]], neonSceneColors.cyan, neonSceneColors.white, 0.78);
  drawRibbonTrail(rgba, [[WIDTH + 90, 230], [1160, 390], [-130, 700]], neonSceneColors.magenta, neonSceneColors.white, 0.78);
  drawNeonLightningPreview(rgba, [[-80, 440], [390, 390], [650, 420], [1120, 360], [WIDTH + 90, 300]], neonSceneColors.cyan, 0.78);
  drawNeonLightningPreview(rgba, [[WIDTH + 80, 510], [1410, 530], [1120, 470], [720, 420], [-90, 320]], neonSceneColors.magenta, 0.76);
  for (let ring = 0; ring < 8; ring += 1) {
    drawRing(rgba, cx, cy, 160 + ring * 62, 7, [neonSceneColors.cyan, neonSceneColors.magenta, neonSceneColors.gold, neonSceneColors.white][ring % 4], 0.16 - ring * 0.012);
  }
  drawNeonParticles(rgba, 2002, 112, cx, cy, 920, 470);
  return rgba;
};

const ultimatePreviewColors = {
  cyan: hexToRgb("#58e5ff"),
  blue: hexToRgb("#2f86ff"),
  magenta: hexToRgb("#ff4fd8"),
  purple: hexToRgb("#8f5bff"),
  gold: hexToRgb("#f5c65b"),
  goldLight: hexToRgb("#fff1b4"),
  orange: hexToRgb("#ff9c36"),
  red: hexToRgb("#ff315f"),
  white: hexToRgb("#ffffff"),
};

const renderEnergyShockwave = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 580, ultimatePreviewColors.cyan, 0.06, 170);
  drawRing(rgba, cx, cy, 210, 15, ultimatePreviewColors.white, 0.2);
  drawRing(rgba, cx, cy, 380, 12, ultimatePreviewColors.cyan, 0.16);
  drawRing(rgba, cx, cy, 560, 8, ultimatePreviewColors.blue, 0.1);
  drawNeonLightningPreview(rgba, [[-80, 250], [360, 300], [650, 390], [1120, 340], [WIDTH + 80, 280]], ultimatePreviewColors.cyan, 0.88);
  drawNeonLightningPreview(rgba, [[WIDTH + 80, 610], [1380, 520], [1180, 460], [720, 420], [-80, 390]], ultimatePreviewColors.blue, 0.74);
  drawNeonParticles(rgba, 2102, 86, cx, cy, 900, 450, [ultimatePreviewColors.cyan, ultimatePreviewColors.blue, ultimatePreviewColors.white]);
  return rgba;
};

const renderCosmicPortalOpening = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 560, ultimatePreviewColors.purple, 0.065, 170);
  for (let ring = 0; ring < 8; ring += 1) {
    drawRing(rgba, cx, cy, 150 + ring * 38, 7 + (ring % 3), [ultimatePreviewColors.purple, ultimatePreviewColors.cyan, ultimatePreviewColors.magenta][ring % 3], 0.17 - ring * 0.012);
  }
  drawNeonParticles(rgba, 2112, 108, cx, cy, 780, 420, [ultimatePreviewColors.purple, ultimatePreviewColors.cyan, ultimatePreviewColors.magenta, ultimatePreviewColors.white]);
  drawSpark(rgba, cx, cy, 70, ultimatePreviewColors.white, 0.36);
  return rgba;
};

const renderCrystalShardExplosion = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(2122);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 520, ultimatePreviewColors.goldLight, 0.06, 160);
  drawRing(rgba, cx, cy, 250, 12, ultimatePreviewColors.gold, 0.16);
  for (let shard = 0; shard < 74; shard += 1) {
    const angle = (shard / 74) * TAU;
    const distance = 110 + rng() * 900;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.6;
    const color = [ultimatePreviewColors.white, ultimatePreviewColors.goldLight, ultimatePreviewColors.cyan, ultimatePreviewColors.gold][shard % 4];
    drawDiamond(rgba, x, y, 18 + rng() * 34, angle, color, 0.52 + rng() * 0.28);
  }
  drawNeonParticles(rgba, 2123, 48, cx, cy, 820, 430, [ultimatePreviewColors.white, ultimatePreviewColors.goldLight, ultimatePreviewColors.cyan]);
  return rgba;
};

const renderAlertImpactBlast = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(2132);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 540, ultimatePreviewColors.red, 0.062, 170);
  drawRing(rgba, cx, cy, 200, 17, ultimatePreviewColors.red, 0.22);
  drawRing(rgba, cx, cy, 370, 12, ultimatePreviewColors.orange, 0.16);
  drawRing(rgba, cx, cy, 550, 8, ultimatePreviewColors.white, 0.1);
  for (let beam = 0; beam < 18; beam += 1) {
    const angle = rng() * TAU;
    drawCapsule(rgba, cx + Math.cos(angle) * 110, cy + Math.sin(angle) * 70, cx + Math.cos(angle) * 850, cy + Math.sin(angle) * 460, 5, beam % 2 === 0 ? ultimatePreviewColors.red : ultimatePreviewColors.orange, 0.18);
  }
  drawNeonParticles(rgba, 2133, 58, cx, cy, 850, 430, [ultimatePreviewColors.red, ultimatePreviewColors.orange, ultimatePreviewColors.white]);
  return rgba;
};

const renderCelestialStarfall = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(2141);
  drawCircle(rgba, WIDTH * 0.5, HEIGHT * 0.44, 560, ultimatePreviewColors.purple, 0.052, 170);
  for (let star = 0; star < 92; star += 1) {
    const x = 70 + rng() * (WIDTH - 140);
    const y = 30 + rng() * (HEIGHT - 80);
    const color = [ultimatePreviewColors.goldLight, ultimatePreviewColors.white, ultimatePreviewColors.cyan, ultimatePreviewColors.purple][star % 4];
    drawSpark(rgba, x, y, 8 + rng() * 18, color, 0.28 + rng() * 0.28);
    if (star % 4 === 0) {
      drawCapsule(rgba, x - 18, y - 58, x + 12, y + 28, 1.8, color, 0.18);
    }
  }
  return rgba;
};

const renderJackpotCoreDetonation = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 560, ultimatePreviewColors.gold, 0.07, 170);
  drawRing(rgba, cx, cy, 230, 16, ultimatePreviewColors.gold, 0.22);
  drawRing(rgba, cx, cy, 420, 11, ultimatePreviewColors.orange, 0.14);
  drawSpark(rgba, cx, cy, 78, ultimatePreviewColors.white, 0.48);
  drawNeonParticles(rgba, 2152, 118, cx, cy, 940, 470, [ultimatePreviewColors.gold, ultimatePreviewColors.goldLight, ultimatePreviewColors.orange, ultimatePreviewColors.white]);
  return rgba;
};

const renderPrismLightCascade = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const rng = createRng(2161);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.52;
  drawCircle(rgba, cx, cy, 580, ultimatePreviewColors.white, 0.04, 170);
  for (let beam = 0; beam < 18; beam += 1) {
    const x = 100 + rng() * (WIDTH - 200);
    const color = [ultimatePreviewColors.magenta, ultimatePreviewColors.orange, ultimatePreviewColors.gold, ultimatePreviewColors.cyan, ultimatePreviewColors.purple, ultimatePreviewColors.white][beam % 6];
    drawCapsule(rgba, x - 220, 120, x + 220, HEIGHT - 70, 8, color, 0.11);
  }
  drawRibbonTrail(rgba, [[-80, 260], [760, 390], [WIDTH + 120, 650]], ultimatePreviewColors.cyan, ultimatePreviewColors.white, 0.78);
  drawRibbonTrail(rgba, [[WIDTH + 80, 270], [1160, 410], [-120, 660]], ultimatePreviewColors.magenta, ultimatePreviewColors.white, 0.76);
  drawNeonParticles(rgba, 2162, 58, cx, cy, 860, 430, [ultimatePreviewColors.magenta, ultimatePreviewColors.gold, ultimatePreviewColors.cyan, ultimatePreviewColors.white]);
  return rgba;
};

const renderHyperBoostBurst = () => {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const cx = WIDTH * 0.5;
  const cy = HEIGHT * 0.5;
  drawCircle(rgba, cx, cy, 600, ultimatePreviewColors.cyan, 0.06, 170);
  for (let line = 0; line < 30; line += 1) {
    const angle = (line / 30) * TAU;
    const innerX = cx + Math.cos(angle) * 120;
    const innerY = cy + Math.sin(angle) * 68;
    const outerX = cx + Math.cos(angle) * 960;
    const outerY = cy + Math.sin(angle) * 540;
    const color = line % 3 === 0 ? ultimatePreviewColors.cyan : line % 3 === 1 ? ultimatePreviewColors.magenta : ultimatePreviewColors.white;
    drawCapsule(rgba, innerX, innerY, outerX, outerY, 4.2, color, 0.2);
    drawCapsule(rgba, innerX, innerY, outerX, outerY, 1.4, ultimatePreviewColors.white, 0.42);
  }
  drawRing(rgba, cx, cy, 190, 12, ultimatePreviewColors.cyan, 0.16);
  drawRing(rgba, cx, cy, 320, 9, ultimatePreviewColors.magenta, 0.1);
  drawNeonParticles(rgba, 2172, 62, cx, cy, 840, 420, [ultimatePreviewColors.cyan, ultimatePreviewColors.magenta, ultimatePreviewColors.white]);
  return rgba;
};

const renderEnhancedFullscreenPreview = (effect) => {
  const preview = effect.render();
  if (effect.overlay !== false && effect.output !== "trh-full-mega-jackpot.png") {
    compositeBuffer(preview, renderPremiumFullscreenOverlay(hashString(effect.output)));
  }
  return preview;
};

const effects = [
  { output: "trh-full-energy-shockwave.png", render: renderEnergyShockwave, overlay: false },
  { output: "trh-full-cosmic-portal-opening.png", render: renderCosmicPortalOpening, overlay: false },
  { output: "trh-full-crystal-shard-explosion.png", render: renderCrystalShardExplosion, overlay: false },
  { output: "trh-full-alert-impact-blast.png", render: renderAlertImpactBlast, overlay: false },
  { output: "trh-full-celestial-starfall.png", render: renderCelestialStarfall, overlay: false },
  { output: "trh-full-jackpot-core-detonation.png", render: renderJackpotCoreDetonation, overlay: false },
  { output: "trh-full-prism-light-cascade.png", render: renderPrismLightCascade, overlay: false },
  { output: "trh-full-hyper-boost-burst.png", render: renderHyperBoostBurst, overlay: false },
  { output: "trh-full-neon-galaxy-grid.png", render: renderNeonGalaxyGrid, overlay: false },
  { output: "trh-full-electric-neon-storm.png", render: renderElectricNeonStorm, overlay: false },
  { output: "trh-full-neon-ribbon-tunnel.png", render: renderNeonRibbonTunnel, overlay: false },
  { output: "trh-full-luxury-neon-pulse.png", render: renderLuxuryNeonPulse, overlay: false },
  { output: "trh-full-mega-neon-jackpot.png", render: renderMegaNeonJackpot, overlay: false },
  { output: "trh-full-mega-firework-detonation.png", render: renderMegaFireworkDetonation, overlay: false },
  { output: "trh-full-jackpot-sky-blast.png", render: renderJackpotSkyBlast, overlay: false },
  { output: "trh-full-firework-chaos-storm.png", render: renderFireworkChaosStorm, overlay: false },
  { output: "trh-full-galaxy-firework-finale.png", render: renderGalaxyFireworkFinale, overlay: false },
  { output: "trh-full-grand-jackpot-finale.png", render: renderGrandJackpotFinale, overlay: false },
  { output: "trh-full-giant-kiss-mark-burst.png", render: renderGiantKissMarkBurst, overlay: false },
  { output: "trh-full-kiss-storm.png", render: renderKissStorm, overlay: false },
  { output: "trh-full-air-kiss-explosion.png", render: renderAirKissExplosion, overlay: false },
  { output: "trh-full-glamour-kiss-reveal.png", render: renderGlamourKissReveal, overlay: false },
  { output: "trh-full-kiss-jackpot-finale.png", render: renderKissJackpotFinale, overlay: false },
  { output: "trh-full-giant-like-pop.png", render: renderGiantLikePop, overlay: false },
  { output: "trh-full-thumbs-up-storm.png", render: renderThumbsUpStorm, overlay: false },
  { output: "trh-full-mega-approval-blast.png", render: renderMegaApprovalBlast, overlay: false },
  { output: "trh-full-emoji-like-bounce.png", render: renderEmojiLikeBounce, overlay: false },
  { output: "trh-full-thumbs-up-finale.png", render: renderThumbsUpFinale, overlay: false },
  { output: "trh-full-giant-heart-formation.png", render: renderGiantHeartFormation, overlay: false },
  { output: "trh-full-heart-rain-explosion.png", render: renderHeartRainExplosion, overlay: false },
  { output: "trh-full-cupid-heart-blast.png", render: renderCupidHeartBlast, overlay: false },
  { output: "trh-full-double-heart-merge.png", render: renderDoubleHeartMerge, overlay: false },
  { output: "trh-full-heart-jackpot-finale.png", render: renderHeartJackpotFinale, overlay: false },
  { output: "trh-full-mega-confetti-cannon.png", render: renderMegaConfettiCannon, overlay: false },
  { output: "trh-full-confetti-jackpot-blast.png", render: renderConfettiJackpotBlast, overlay: false },
  { output: "trh-full-confetti-rain-storm.png", render: renderConfettiRainStorm, overlay: false },
  { output: "trh-full-ribbon-confetti-burst.png", render: renderRibbonConfettiBurst, overlay: false },
  { output: "trh-full-grand-confetti-finale.png", render: renderGrandConfettiFinale, overlay: false },
  { output: "trh-full-luxury-confetti-blast.png", render: renderLuxuryConfettiBlast, overlay: false },
  { output: "trh-full-golden-confetti-storm.png", render: renderGoldenConfettiStorm, overlay: false },
  { output: "trh-full-confetti-shockwave.png", render: renderConfettiShockwave, overlay: false },
  { output: "trh-full-rainbow-confetti-cascade.png", render: renderRainbowConfettiCascade, overlay: false },
  { output: "trh-full-grand-premium-confetti-finale.png", render: renderGrandPremiumConfettiFinale, overlay: false },
  { output: "trh-full-golden-confetti-jackpot-blast.png", render: renderGoldenConfettiJackpotBlast, overlay: false },
  { output: "trh-full-vip-gold-confetti-rain.png", render: renderVipGoldConfettiRain, overlay: false },
  { output: "trh-full-trophy-gold-confetti-burst.png", render: renderTrophyGoldConfettiBurst, overlay: false },
  { output: "trh-full-gold-ribbon-confetti-storm.png", render: renderGoldRibbonConfettiStorm, overlay: false },
  { output: "trh-full-royal-gold-confetti-finale.png", render: renderRoyalGoldConfettiFinale, overlay: false },
  { output: "trh-full-diamond-jackpot-burst.png", render: renderDiamondJackpotBurst, overlay: false },
  { output: "trh-full-royal-gold-crown.png", render: renderRoyalGoldCrown, overlay: false },
  { output: "trh-full-money-win-cascade.png", render: renderMoneyWinCascade, overlay: false },
  { output: "trh-full-electric-premium-blast.png", render: renderElectricPremiumBlast, overlay: false },
  { output: "trh-full-trophy-win-moment.png", render: renderTrophyWinMoment, overlay: false },
  { output: "trh-full-lucky-shamrock-storm.png", render: renderLuckyShamrockStorm, overlay: false },
  { output: "trh-full-pot-of-gold-burst.png", render: renderPotOfGoldBurst, overlay: false },
  { output: "trh-full-rainbow-lucky-arc.png", render: renderRainbowLuckyArc, overlay: false },
  { output: "trh-full-leprechaun-gold-rush.png", render: renderLeprechaunGoldRush, overlay: false },
  { output: "trh-full-mega-lucky-finale.png", render: renderMegaLuckyFinale, overlay: false },
  { output: "trh-full-petal-storm-bloom.png", render: renderPetalStormBloom, overlay: false },
  { output: "trh-full-sakura-jackpot-blossom.png", render: renderSakuraJackpotBlossom, overlay: false },
  { output: "trh-full-rose-swirl-reveal.png", render: renderRoseSwirlReveal, overlay: false },
  { output: "trh-full-floral-heart-bloom.png", render: renderFloralHeartBloom, overlay: false },
  { output: "trh-full-bloom-burst-finale.png", render: renderBloomBurstFinale, overlay: false },
  { output: "trh-full-giant-rose-reveal.png", render: renderGiantRoseReveal, overlay: false },
  { output: "trh-full-rose-petal-storm.png", render: renderRosePetalStorm, overlay: false },
  { output: "trh-full-rose-heart-bloom.png", render: renderRoseHeartBloom, overlay: false },
  { output: "trh-full-golden-rose-jackpot.png", render: renderGoldenRoseJackpot, overlay: false },
  { output: "trh-full-rose-grand-finale.png", render: renderRoseGrandFinale, overlay: false },
  { output: "trh-full-classic-countdown-bingo.png", render: renderClassicCountdownBingo, overlay: false },
  { output: "trh-full-bingo-letter-build.png", render: renderBingoLetterBuild, overlay: false },
  { output: "trh-full-gold-jackpot-countdown.png", render: renderGoldJackpotCountdown, overlay: false },
  { output: "trh-full-final-countdown-detonation.png", render: renderFinalCountdownDetonation, overlay: false },
  { output: "trh-full-mega-bingo-impact.png", render: renderMegaBingoImpact, overlay: false },
  { output: "trh-full-bingo-ball-storm.png", render: renderBingoBallStorm, overlay: false },
  { output: "trh-full-jackpot-ball-explosion.png", render: renderJackpotBallExplosion, overlay: false },
  { output: "trh-full-bingo-letter-formation.png", render: renderBingoLetterFormation, overlay: false },
  { output: "trh-full-golden-bingo-cascade.png", render: renderGoldenBingoCascade, overlay: false },
  { output: "trh-full-mega-bingo-balls-finale.png", render: renderMegaBingoBallsFinale, overlay: false },
  { output: "trh-full-gold-star-jackpot-rain.png", render: renderGoldStarJackpotRain, overlay: false },
  { output: "trh-full-mega-star-explosion.png", render: renderMegaStarExplosion, overlay: false },
  { output: "trh-full-golden-galaxy-spiral.png", render: renderGoldenGalaxySpiral, overlay: false },
  { output: "trh-full-star-flash-reward.png", render: renderStarFlashReward, overlay: false },
  { output: "trh-full-golden-star-finale.png", render: renderGoldenStarFinale, overlay: false },
  { output: "trh-full-magic-starry-sky.png", render: renderMagicStarrySky, overlay: false },
  { output: "trh-full-golden-twinkle-sky.png", render: renderGoldenTwinkleSky, overlay: false },
  { output: "trh-full-shooting-star-night.png", render: renderShootingStarNight, overlay: false },
  { output: "trh-full-starlight-pulse.png", render: renderStarlightPulse, overlay: false },
  { output: "trh-full-grand-starry-finale.png", render: renderGrandStarryFinale, overlay: false },
  { output: "trh-full-party-blast.png", render: renderPartyBlast, overlay: false },
  { output: "trh-full-fullscreen-festival.png", render: renderFullscreenFestival, overlay: false },
  { output: "trh-full-giant-bingo-reveal.png", render: renderGiantBingoReveal, overlay: false },
  { output: "trh-full-exploding-bingo-balls.png", render: renderExplodingBingoBalls, overlay: false },
  { output: "trh-full-bingo-letter-jackpot-build.png", render: renderFullscreenBingoLetterBuild, overlay: false },
  { output: "trh-full-golden-bingo-jackpot.png", render: renderGoldenBingoJackpot, overlay: false },
  { output: "trh-full-mega-bingo-finale.png", render: renderMegaBingoFinaleFullscreen, overlay: false },
  { output: "trh-full-birthday-cake-celebration.png", render: renderBirthdayCakeCelebration, overlay: false },
  { output: "trh-full-balloon-party-burst.png", render: renderBalloonPartyBurst, overlay: false },
  { output: "trh-full-gift-box-explosion.png", render: renderGiftBoxExplosion, overlay: false },
  { output: "trh-full-candle-wish-moment.png", render: renderCandleWishMoment, overlay: false },
  { output: "trh-full-happy-birthday-grand-finale.png", render: renderHappyBirthdayGrandFinale, overlay: false },
  { output: "trh-full-christmas-tree-reveal.png", render: renderChristmasTreeReveal, overlay: false },
  { output: "trh-full-santa-gift-burst.png", render: renderSantaGiftBurst, overlay: false },
  { output: "trh-full-snowfall-magic.png", render: renderSnowfallMagic, overlay: false },
  { output: "trh-full-jingle-bells-blast.png", render: renderJingleBellsBlast, overlay: false },
  { output: "trh-full-christmas-grand-finale.png", render: renderChristmasGrandFinale, overlay: false },
  { output: "trh-full-giant-snowman-reveal.png", render: renderGiantSnowmanReveal, overlay: false },
  { output: "trh-full-snowman-snowstorm.png", render: renderSnowmanSnowstorm, overlay: false },
  { output: "trh-full-top-hat-snowman-pop.png", render: renderTopHatSnowmanPop, overlay: false },
  { output: "trh-full-christmas-snowman-gift.png", render: renderChristmasSnowmanGift, overlay: false },
  { output: "trh-full-snowman-grand-finale.png", render: renderSnowmanGrandFinale, overlay: false },
  { output: "trh-full-giant-clap-burst.png", render: renderGiantClapBurst, overlay: false },
  { output: "trh-full-standing-ovation.png", render: renderStandingOvation, overlay: false },
  { output: "trh-full-golden-applause-rain.png", render: renderGoldenApplauseRain, overlay: false },
  { output: "trh-full-champion-applause.png", render: renderChampionApplause, overlay: false },
  { output: "trh-full-applause-grand-finale.png", render: renderApplauseGrandFinale, overlay: false },
  { output: "trh-full-giant-thanks-reveal.png", render: renderGiantThanksReveal, overlay: false },
  { output: "trh-full-golden-gratitude-burst.png", render: renderGoldenGratitudeBurst, overlay: false },
  { output: "trh-full-sparkle-thank-you.png", render: renderSparkleThankYou, overlay: false },
  { output: "trh-full-thanks-gift-pop.png", render: renderThanksGiftPop, overlay: false },
  { output: "trh-full-thanks-grand-finale.png", render: renderThanksGrandFinale, overlay: false },
  { output: "trh-full-giant-win-reveal.png", render: renderGiantWinReveal, overlay: false },
  { output: "trh-full-big-win-jackpot.png", render: renderBigWinJackpot, overlay: false },
  { output: "trh-full-royal-win-crown.png", render: renderRoyalWinCrown, overlay: false },
  { output: "trh-full-win-confetti-blast.png", render: renderWinConfettiBlast, overlay: false },
  { output: "trh-full-mega-win-finale.png", render: renderMegaWinFinale, overlay: false },
  { output: "trh-full-friendship-handshake-reveal.png", render: renderFriendshipHandshakeReveal, overlay: false },
  { output: "trh-full-best-friends-pop.png", render: renderBestFriendsPop, overlay: false },
  { output: "trh-full-friendship-heart-burst.png", render: renderFriendshipHeartBurst, overlay: false },
  { output: "trh-full-friendship-star-circle.png", render: renderFriendshipStarCircle, overlay: false },
  { output: "trh-full-friendship-grand-finale.png", render: renderFriendshipGrandFinale, overlay: false },
  { output: "trh-full-jackpot-fever.png", render: renderJackpotFever, overlay: false },
  { output: "trh-full-bingo-shock.png", render: renderBingoShock, overlay: false },
  { output: "trh-full-bingo-ball-formation-wink.png", render: renderBingoBallFormationWink, overlay: false },
  { output: "trh-full-imported-bingo-animation.png", render: renderImportedBingoAnimation, overlay: false },
  { output: "trh-full-bingo-bounce-high-speed-collision.png", render: renderBingoBounceHighSpeedCollision, overlay: false },
  { output: "trh-full-bingo-bounce-confetti-celebration.png", render: renderBingoBounceConfettiCelebration, overlay: false },
  { output: "trh-full-bingo-bounce-electric-jackpot.png", render: renderBingoBounceElectricJackpot, overlay: false },
  { output: "trh-full-bingo-bounce-mega-finale.png", render: renderBingoBounceMegaFinale, overlay: false },
  { output: "trh-full-omg-big-win.png", render: renderOmgBigWin, overlay: false },
  { output: "trh-full-hot-streak.png", render: renderHotStreak, overlay: false },
  { output: "trh-full-lucky-diamond-hit.png", render: renderLuckyDiamondHit, overlay: false },
  { output: "trh-full-lucky-roll.png", render: renderLuckyRoll, overlay: false },
  { output: "trh-full-electric-win-pulse.png", render: renderElectricWinPulse, overlay: false },
  { output: "trh-full-money-rush.png", render: renderMoneyRush, overlay: false },
  { output: "trh-full-troll-win.png", render: renderTrollWin, overlay: false },
  { output: "trh-full-miracle-hit.png", render: renderMiracleHit, overlay: false },
  { output: "trh-full-giant-lol-burst.png", render: renderGiantLolBurst, overlay: false },
  { output: "trh-full-laughing-emoji-storm.png", render: renderLaughingEmojiStorm, overlay: false },
  { output: "trh-full-hahaha-text-wave.png", render: renderHahahaTextWave, overlay: false },
  { output: "trh-full-rofl-jackpot.png", render: renderRoflJackpot, overlay: false },
  { output: "trh-full-laughter-grand-finale.png", render: renderLaughterGrandFinale, overlay: false },
];

export const regenerateFullscreenPreviews = async (rootDir) => {
  const targetDir = path.join(rootDir, "public", "previews", "fullscreen");
  await fs.mkdir(targetDir, { recursive: true });

  for (const effect of effects) {
    const rgba = renderEnhancedFullscreenPreview(effect);
    await fs.writeFile(path.join(targetDir, effect.output), buildPng(rgba));
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  regenerateFullscreenPreviews(process.cwd());
}
