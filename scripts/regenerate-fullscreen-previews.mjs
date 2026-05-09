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
  drawRing(buffer, cx, cy, radius * 0.56, 6, color, alpha * 0.16);
  drawRing(buffer, cx, cy, radius * 0.82, 5, accent, alpha * 0.08);
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

const renderEnhancedFullscreenPreview = (effect) => {
  const preview = effect.render();
  if (effect.overlay !== false && effect.output !== "trh-full-mega-jackpot.png") {
    compositeBuffer(preview, renderPremiumFullscreenOverlay(hashString(effect.output)));
  }
  return preview;
};

const effects = [
  { output: "trh-full-party-blast.png", render: renderPartyBlast, overlay: false },
  { output: "trh-full-fullscreen-festival.png", render: renderFullscreenFestival, overlay: false },
  { output: "trh-full-exploding-bingo-balls.png", render: renderExplodingBingoBalls, overlay: false },
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
