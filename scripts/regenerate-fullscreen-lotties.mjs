import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1920;
const HEIGHT = 1024;
const FRAME_RATE = 36;
const DURATION_FRAMES = 180;
const LAST_FRAME = DURATION_FRAMES - 1;

const clampFrame = (value) => Math.max(0, Math.min(LAST_FRAME, value));

const rgb = (hex) => {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
    1,
  ];
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

const still = (value) => ({ a: 0, k: value });
const linearEaseAxis = (dimensions, value) => Array.from({ length: dimensions }, () => value);
const keyframes = (frames) => {
  if (frames.length <= 1) {
    return still(frames[0]?.s ?? [0]);
  }

  return {
    a: 1,
    k: frames.map(({ t, s }, index) => {
      if (index === frames.length - 1) {
        return { t, s };
      }

      const next = frames[index + 1];
      const dimensions = Array.isArray(s) ? s.length : 1;

      return {
        t,
        s,
        e: next.s,
        i: {
          x: linearEaseAxis(dimensions, 0.78),
          y: linearEaseAxis(dimensions, 1),
        },
        o: {
          x: linearEaseAxis(dimensions, 0.22),
          y: linearEaseAxis(dimensions, 0),
        },
      };
    }),
  };
};

const transformNode = ({
  position = [0, 0],
  anchor = [0, 0],
  scale = [100, 100],
  rotation = 0,
  opacity = 100,
} = {}) => ({
  ty: "tr",
  p: still(position),
  a: still(anchor),
  s: still(scale),
  r: still(rotation),
  o: still(opacity),
  sk: still(0),
  sa: still(0),
});

const group = (name, items, transform = {}) => ({
  ty: "gr",
  nm: name,
  it: [...items, transformNode(transform)],
});

const ellipseShape = (name, width, height) => ({
  ty: "el",
  p: still([0, 0]),
  s: still([width, height]),
  nm: name,
});

const rectShape = (name, width, height, radius = 14) => ({
  ty: "rc",
  p: still([0, 0]),
  s: still([width, height]),
  r: still(radius),
  nm: name,
});

const fillNode = (name, color, opacity = 100) => ({
  ty: "fl",
  c: still(color),
  o: still(opacity),
  r: 1,
  nm: name,
});

const strokeNode = (name, color, width, opacity = 100) => ({
  ty: "st",
  c: still(color),
  o: still(opacity),
  w: still(width),
  lc: 2,
  lj: 2,
  ml: 4,
  nm: name,
});

const pathValue = (points, closed = false) => ({
  i: points.map(() => [0, 0]),
  o: points.map(() => [0, 0]),
  v: points,
  c: closed,
});

const pathShape = (name, points, closed = false) => ({
  ty: "sh",
  ks: still(pathValue(points, closed)),
  nm: name,
});

const lineStrokeGroup = (name, points, glowColor, glowWidth, coreColor, coreWidth, glowOpacity = 28, coreOpacity = 100) =>
  group(name, [
    pathShape(`${name} Path`, points, false),
    strokeNode(`${name} Glow`, glowColor, glowWidth, glowOpacity),
    strokeNode(`${name} Core`, coreColor, coreWidth, coreOpacity),
  ]);

const polygonPoints = (sides, radius, rotation = -Math.PI / 2) =>
  Array.from({ length: sides }, (_, index) => {
    const angle = rotation + ((index / sides) * Math.PI * 2);
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });

const diamondPoints = (width, height) => [
  [0, -(height * 0.5)],
  [width * 0.5, 0],
  [0, height * 0.5],
  [-(width * 0.5), 0],
];

const sparkleGroup = (name, size, color, accent) =>
  group(name, [
    pathShape("Spark H", [[-size, 0], [size, 0]], false),
    pathShape("Spark V", [[0, -size], [0, size]], false),
    pathShape("Spark D1", [[-(size * 0.55), -(size * 0.55)], [size * 0.55, size * 0.55]], false),
    pathShape("Spark D2", [[-(size * 0.55), size * 0.55], [size * 0.55, -(size * 0.55)]], false),
    strokeNode("Spark Glow", accent, Math.max(2.5, size * 0.26), 26),
    strokeNode("Spark Core", color, Math.max(1.25, size * 0.12), 96),
    group("Spark Core Dot", [
      ellipseShape("Core Dot Path", size * 0.45, size * 0.45),
      fillNode("Core Dot Fill", color, 98),
    ]),
  ]);

const beamGroup = (name, width, height, color, accent) =>
  group(name, [
    group("Beam Glow", [
      rectShape("Glow Rect", width * 2.3, height, width * 0.55),
      fillNode("Glow Fill", accent, 12),
    ]),
    group("Beam Sheen", [
      rectShape("Sheen Rect", width * 1.28, height * 0.42, width * 0.26),
      fillNode("Sheen Fill", rgb("#ffffff"), 16),
    ], {
      position: [0, -(height * 0.18)],
      rotation: -2,
    }),
    group("Beam Core", [
      rectShape("Core Rect", width, height, width * 0.4),
      fillNode("Core Fill", color, 38),
    ]),
    group("Beam Spine", [
      pathShape("Spine Path", [[0, -(height * 0.48)], [0, height * 0.48]], false),
      strokeNode("Spine Glow", accent, Math.max(3, width * 0.18), 18),
      strokeNode("Spine Core", rgb("#ffffff"), Math.max(1.2, width * 0.06), 34),
    ]),
  ]);

const fireworkGroup = (name, innerRadius, outerRadius, rayCount, color, accent) => {
  const rays = [];
  const secondaryRays = [];
  for (let ray = 0; ray < rayCount; ray += 1) {
    const angle = (ray / rayCount) * Math.PI * 2;
    const innerX = Math.cos(angle) * innerRadius;
    const innerY = Math.sin(angle) * innerRadius;
    const outerX = Math.cos(angle) * outerRadius;
    const outerY = Math.sin(angle) * outerRadius;
    rays.push(pathShape(`Ray ${ray}`, [[innerX, innerY], [outerX, outerY]], false));

    if (ray % 2 === 0) {
      const subInner = Math.cos(angle + 0.06) * (innerRadius * 1.9);
      const subInnerY = Math.sin(angle + 0.06) * (innerRadius * 1.9);
      const subOuter = Math.cos(angle + 0.06) * (outerRadius * 0.68);
      const subOuterY = Math.sin(angle + 0.06) * (outerRadius * 0.68);
      secondaryRays.push(pathShape(`Sub Ray ${ray}`, [[subInner, subInnerY], [subOuter, subOuterY]], false));
    }
  }

  const tips = [];
  for (let tip = 0; tip < rayCount; tip += 1) {
    const angle = (tip / rayCount) * Math.PI * 2;
    tips.push(
      group(`Tip ${tip}`, [
        ellipseShape("Tip Path", 14, 14),
        fillNode("Tip Fill", accent, 88),
      ], {
        position: [Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius],
      }),
    );
  }

  return group(name, [
    ...rays,
    ...secondaryRays,
    strokeNode("Ray Glow", accent, Math.max(5, outerRadius * 0.05), 22),
    strokeNode("Ray Core", color, Math.max(2, outerRadius * 0.022), 96),
    group("Outer Ring", [
      ellipseShape("Outer Ring Path", outerRadius * 1.32, outerRadius * 1.32),
      strokeNode("Outer Ring Stroke", accent, Math.max(4, outerRadius * 0.05), 18),
    ]),
    group("Inner Ring", [
      ellipseShape("Inner Ring Path", outerRadius * 0.78, outerRadius * 0.78),
      strokeNode("Inner Ring Stroke", color, Math.max(3, outerRadius * 0.034), 22),
    ]),
    ...tips,
    group("Firework Core", [
      ellipseShape("Core Path", 18, 18),
      fillNode("Core Fill", accent, 96),
    ]),
    group("Firework Core Glow", [
      ellipseShape("Core Glow Path", 40, 40),
      fillNode("Core Glow Fill", accent, 18),
    ]),
    sparkleGroup("Core Spark", Math.max(9, outerRadius * 0.08), rgb("#ffffff"), accent),
  ]);
};

const coinGroup = (name, radius, faceColor, rimColor) =>
  group(name, [
    group("Coin Base", [
      ellipseShape("Base Path", radius * 2, radius * 2),
      fillNode("Base Fill", faceColor, 94),
    ]),
    group("Coin Rim", [
      ellipseShape("Rim Path", radius * 1.82, radius * 1.82),
      strokeNode("Rim Stroke", rimColor, Math.max(4, radius * 0.16), 88),
    ]),
    group("Coin Rim Glow", [
      ellipseShape("Rim Glow Path", radius * 2.04, radius * 2.04),
      strokeNode("Rim Glow Stroke", rgb("#fff1b4"), Math.max(5, radius * 0.22), 16),
    ]),
    group("Coin Inner Ring", [
      ellipseShape("Inner Ring Path", radius * 1.25, radius * 1.25),
      strokeNode("Inner Ring Stroke", rgb("#c98a11"), Math.max(2, radius * 0.09), 56),
    ]),
    group("Coin Mark", [
      pathShape("Mark H", [[-(radius * 0.18), 0], [radius * 0.18, 0]], false),
      pathShape("Mark V", [[0, -(radius * 0.18)], [0, radius * 0.18]], false),
      strokeNode("Mark Stroke", rgb("#b56d07"), Math.max(2, radius * 0.08), 82),
    ]),
    group("Coin Shine", [
      ellipseShape("Shine Path", radius * 0.32, radius * 0.2),
      fillNode("Shine Fill", rgb("#fff5cd"), 40),
    ], {
      position: [-(radius * 0.22), -(radius * 0.24)],
      rotation: -18,
    }),
    group("Coin Edge Flash", [
      rectShape("Edge Flash Path", radius * 0.34, radius * 1.32, Math.max(4, radius * 0.12)),
      fillNode("Edge Flash Fill", rgb("#ffffff"), 18),
    ], {
      position: [radius * 0.32, 0],
      rotation: 18,
    }),
  ]);

const SEGMENTS = {
  a: [[-0.18, -0.48], [0.18, -0.48]],
  b: [[0.23, -0.38], [0.23, -0.04]],
  c: [[0.23, 0.04], [0.23, 0.38]],
  d: [[-0.18, 0.48], [0.18, 0.48]],
  e: [[-0.23, 0.04], [-0.23, 0.38]],
  f: [[-0.23, -0.38], [-0.23, -0.04]],
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

const digitGroups = (digit, size, color) => {
  const activeSegments = DIGIT_SEGMENTS[digit] ?? DIGIT_SEGMENTS[8];
  return activeSegments.map((segmentName, index) => {
    const [from, to] = SEGMENTS[segmentName];
    return lineStrokeGroup(
      `Digit ${digit}-${index}`,
      [
        [from[0] * size, from[1] * size],
        [to[0] * size, to[1] * size],
      ],
      color,
      Math.max(3.5, size * 0.16),
      color,
      Math.max(1.4, size * 0.1),
      24,
      94,
    );
  });
};

const bingoBallGroup = (name, radius, bodyColor, digit) =>
  group(name, [
    group("Ball Glow", [
      ellipseShape("Ball Glow Path", radius * 2.28, radius * 2.28),
      fillNode("Ball Glow Fill", bodyColor, 12),
    ]),
    group("Ball Base", [
      ellipseShape("Ball Base Path", radius * 2, radius * 2),
      fillNode("Ball Base Fill", bodyColor, 96),
    ]),
    group("Ball Rim", [
      ellipseShape("Ball Rim Path", radius * 1.86, radius * 1.86),
      strokeNode("Ball Rim Stroke", rgb("#ffffff"), Math.max(4, radius * 0.1), 86),
    ]),
    group("Ball Shine", [
      ellipseShape("Ball Shine Path", radius * 0.42, radius * 0.26),
      fillNode("Ball Shine Fill", rgb("#ffffff"), 20),
    ], {
      position: [-(radius * 0.22), -(radius * 0.26)],
      rotation: -20,
    }),
    group("Disc", [
      ellipseShape("Disc Path", radius * 0.9, radius * 0.9),
      fillNode("Disc Fill", rgb("#ffffff"), 98),
    ]),
    group("Disc Rim", [
      ellipseShape("Disc Rim Path", radius * 0.9, radius * 0.9),
      strokeNode("Disc Rim Stroke", bodyColor, Math.max(3, radius * 0.08), 58),
    ]),
    group("Spec Arc", [
      pathShape("Spec Arc Path", [[-(radius * 0.42), -(radius * 0.08)], [radius * 0.04, -(radius * 0.34)], [radius * 0.42, -(radius * 0.12)]], false),
      strokeNode("Spec Arc Stroke", rgb("#ffffff"), Math.max(2, radius * 0.06), 28),
    ]),
    ...digitGroups(digit, radius * 0.94, rgb("#171717")),
  ]);

const shardGroup = (name, width, height, fillColor, strokeColor) =>
  group(name, [
    group("Shard Fill", [
      pathShape("Shard Path", diamondPoints(width, height), true),
      fillNode("Shard Fill Node", fillColor, 94),
    ]),
    group("Shard Stroke", [
      pathShape("Shard Stroke Path", diamondPoints(width, height), true),
      strokeNode("Shard Stroke Node", strokeColor, Math.max(2, width * 0.06), 54),
    ]),
    lineStrokeGroup(
      "Shard Cut",
      [[0, -(height * 0.36)], [0, height * 0.36]],
      strokeColor,
      Math.max(2.8, width * 0.08),
      strokeColor,
      Math.max(1.2, width * 0.04),
      18,
      42,
    ),
  ]);

const confettiGroup = (name, width, height, fillColor, accentColor) =>
  group(name, [
    group("Confetti Base", [
      rectShape("Confetti Rect", width, height, Math.max(4, width * 0.18)),
      fillNode("Confetti Fill", fillColor, 96),
    ]),
    group("Confetti Shine", [
      rectShape("Confetti Shine Rect", width * 0.32, height * 0.82, Math.max(2, width * 0.08)),
      fillNode("Confetti Shine Fill", accentColor, 34),
    ], {
      position: [-(width * 0.14), 0],
      rotation: -10,
    }),
    lineStrokeGroup(
      "Confetti Cut",
      [[-(width * 0.24), -(height * 0.28)], [width * 0.24, height * 0.28]],
      accentColor,
      Math.max(1.8, width * 0.12),
      rgb("#ffffff"),
      Math.max(0.8, width * 0.05),
      18,
      40,
    ),
  ]);

const ribbonGroup = (name, length, color, accent) =>
  group(name, [
    pathShape(
      "Ribbon Path",
      [
        [-(length * 0.46), -(length * 0.18)],
        [-(length * 0.14), length * 0.08],
        [length * 0.08, -(length * 0.04)],
        [length * 0.28, length * 0.2],
        [length * 0.5, length * 0.04],
      ],
      false,
    ),
    strokeNode("Ribbon Glow", accent, Math.max(8, length * 0.16), 24),
    strokeNode("Ribbon Core", color, Math.max(3.2, length * 0.08), 94),
    sparkleGroup("Ribbon Spark", Math.max(8, length * 0.1), rgb("#ffffff"), accent),
  ]);

const partyHornGroup = (name, length, bodyColor, stripeColor, accentColor) => {
  const bodyHeight = length * 0.22;
  const bodyPoints = [
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
  ];

  return group(name, [
    group("Horn Glow", [
      pathShape("Horn Glow Path", bodyPoints, true),
      fillNode("Horn Glow Fill", accentColor, 14),
    ]),
    group("Horn Body", [
      pathShape("Horn Body Path", bodyPoints, true),
      fillNode("Horn Body Fill", bodyColor, 96),
    ]),
    group("Horn Outline", [
      pathShape("Horn Outline Path", bodyPoints, true),
      strokeNode("Horn Outline Stroke", accentColor, Math.max(4, length * 0.03), 42),
    ]),
    group("Horn Mouth", [
      ellipseShape("Horn Mouth Path", length * 0.18, bodyHeight * 0.94),
      fillNode("Horn Mouth Fill", rgb("#11182b"), 62),
    ], {
      position: [-(length * 0.5), 0],
    }),
    group("Horn Mouth Rim", [
      ellipseShape("Horn Mouth Rim Path", length * 0.18, bodyHeight * 0.94),
      strokeNode("Horn Mouth Rim Stroke", accentColor, Math.max(3, length * 0.024), 50),
    ], {
      position: [-(length * 0.5), 0],
    }),
    group("Horn Stripe A", [
      rectShape("Horn Stripe A Path", length * 0.11, bodyHeight * 0.78, Math.max(4, bodyHeight * 0.14)),
      fillNode("Horn Stripe A Fill", stripeColor, 88),
    ], {
      position: [-(length * 0.18), 0],
      rotation: -18,
    }),
    group("Horn Stripe B", [
      rectShape("Horn Stripe B Path", length * 0.11, bodyHeight * 0.82, Math.max(4, bodyHeight * 0.14)),
      fillNode("Horn Stripe B Fill", stripeColor, 82),
    ], {
      position: [length * 0.03, 0],
      rotation: -18,
    }),
    group("Horn Stripe C", [
      rectShape("Horn Stripe C Path", length * 0.1, bodyHeight * 0.76, Math.max(4, bodyHeight * 0.14)),
      fillNode("Horn Stripe C Fill", stripeColor, 76),
    ], {
      position: [length * 0.22, 0],
      rotation: -18,
    }),
    group("Horn Ribbon A", [
      pathShape("Horn Ribbon A Path", [[0, 0], [length * 0.18, -(length * 0.08)], [length * 0.3, length * 0.06]], false),
      strokeNode("Horn Ribbon A Glow", accentColor, Math.max(7, length * 0.04), 20),
      strokeNode("Horn Ribbon A Core", stripeColor, Math.max(2.2, length * 0.02), 88),
    ], {
      position: [length * 0.58, -(bodyHeight * 0.12)],
      rotation: -18,
    }),
    group("Horn Ribbon B", [
      pathShape("Horn Ribbon B Path", [[0, 0], [length * 0.15, length * 0.1], [length * 0.26, -(length * 0.04)]], false),
      strokeNode("Horn Ribbon B Glow", accentColor, Math.max(7, length * 0.04), 18),
      strokeNode("Horn Ribbon B Core", rgb("#ffffff"), Math.max(2, length * 0.018), 82),
    ], {
      position: [length * 0.6, bodyHeight * 0.04],
      rotation: 14,
    }),
    group("Horn Ribbon C", [
      pathShape("Horn Ribbon C Path", [[0, 0], [length * 0.1, -(length * 0.12)], [length * 0.22, -(length * 0.02)]], false),
      strokeNode("Horn Ribbon C Glow", accentColor, Math.max(6, length * 0.032), 16),
      strokeNode("Horn Ribbon C Core", bodyColor, Math.max(1.8, length * 0.016), 86),
    ], {
      position: [length * 0.58, bodyHeight * 0.16],
      rotation: -4,
    }),
    sparkleGroup("Horn Spark", Math.max(10, length * 0.07), rgb("#ffffff"), accentColor),
  ]);
};

const lightningGroup = (name, width, height, color, accent) => {
  const points = [
    [-(width * 0.5), -(height * 0.5)],
    [-(width * 0.18), -(height * 0.12)],
    [-(width * 0.34), height * 0.04],
    [-(width * 0.02), height * 0.22],
    [-(width * 0.16), height * 0.5],
    [width * 0.2, height * 0.16],
    [width * 0.04, -0.02 * height],
    [width * 0.38, -(height * 0.24)],
    [width * 0.14, -(height * 0.5)],
  ];

  return group(name, [
    pathShape("Lightning Path", points, false),
    strokeNode("Lightning Halo", accent, Math.max(16, width * 0.14), 12),
    strokeNode("Lightning Glow", accent, Math.max(8, width * 0.08), 22),
    strokeNode("Lightning Core", color, Math.max(3, width * 0.03), 94),
    sparkleGroup("Lightning Flash", Math.max(10, width * 0.06), rgb("#ffffff"), accent),
  ]);
};

const ringGroup = (name, radius, strokeColor, accentColor, width) =>
  group(name, [
    group("Ring Glow", [
      ellipseShape("Ring Glow Path", radius * 2.02, radius * 2.02),
      strokeNode("Ring Glow Stroke", accentColor, width * 1.8, 18),
    ]),
    group("Ring Core", [
      ellipseShape("Ring Core Path", radius * 2, radius * 2),
      strokeNode("Ring Core Stroke", strokeColor, width, 84),
    ]),
  ]);

const buildLayer = ({
  index,
  name,
  shapes,
  positionFrames,
  scaleFrames,
  opacityFrames,
  rotationFrames,
  inFrame = 0,
  outFrame = DURATION_FRAMES,
}) => ({
  ddd: 0,
  ind: index,
  ty: 4,
  nm: name,
  sr: 1,
  ks: {
    o: opacityFrames ? keyframes(opacityFrames) : still(100),
    r: rotationFrames ? keyframes(rotationFrames) : still(0),
    p: positionFrames ? keyframes(positionFrames) : still([WIDTH / 2, HEIGHT / 2, 0]),
    a: still([0, 0, 0]),
    s: scaleFrames ? keyframes(scaleFrames) : still([100, 100, 100]),
  },
  ao: 0,
  shapes,
  ip: inFrame,
  op: outFrame,
  st: 0,
  bm: 0,
});

const buildRadialBurstLayers = (startIndex, options) => {
  const {
    seed,
    count,
    center,
    minRadius,
    maxRadius,
    startFrame,
    duration,
    palette,
    sizeRange,
    shapeFactory,
    scaleFrom = 55,
    scaleTo = 128,
    travelYScale = 0.82,
    rotationRange = [-180, 180],
  } = options;

  const rng = createRng(seed);
  const layers = [];

  for (let idx = 0; idx < count; idx += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = minRadius + (rng() * (maxRadius - minRadius));
    const size = sizeRange[0] + (rng() * (sizeRange[1] - sizeRange[0]));
    const color = palette[Math.floor(rng() * palette.length)];
    const inFrame = clampFrame(startFrame + Math.floor(rng() * 20));
    const popFrame = clampFrame(inFrame + Math.floor(duration * 0.06));
    const settleFrame = clampFrame(inFrame + Math.floor(duration * 0.12));
    const midFrame = clampFrame(inFrame + Math.floor(duration * 0.42));
    const fadeFrame = clampFrame(inFrame + Math.floor(duration * 0.74));
    const endFrame = clampFrame(inFrame + duration);
    const tangentX = -Math.sin(angle);
    const tangentY = Math.cos(angle);
    const arcOffset = ((rng() - 0.5) * radius) * 0.2;
    const midRadius = radius * (0.48 + (rng() * 0.16));
    const x2 = center[0] + (Math.cos(angle) * radius);
    const y2 = center[1] + (Math.sin(angle) * radius * travelYScale);
    const xMid = center[0] + (Math.cos(angle) * midRadius) + (tangentX * arcOffset);
    const yMid = center[1] + (Math.sin(angle) * midRadius * travelYScale) + (tangentY * arcOffset * 0.42) - (radius * 0.05);
    const rotationEnd = rotationRange[0] + (rng() * (rotationRange[1] - rotationRange[0]));
    const shapes = shapeFactory({
      size,
      color,
      index: idx,
      rng,
    });

    layers.push(
      buildLayer({
        index: startIndex + layers.length,
        name: `Burst ${seed}-${idx}`,
        shapes,
        positionFrames: [
          { t: inFrame, s: [center[0], center[1], 0] },
          { t: midFrame, s: [xMid, yMid, 0] },
          { t: endFrame, s: [x2, y2, 0] },
        ],
        scaleFrames: [
          { t: inFrame, s: [scaleFrom, scaleFrom, 100] },
          { t: popFrame, s: [148, 148, 100] },
          { t: settleFrame, s: [94, 94, 100] },
          { t: midFrame, s: [108, 108, 100] },
          { t: endFrame, s: [scaleTo, scaleTo, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: inFrame, s: [0] },
          { t: popFrame, s: [100] },
          { t: midFrame, s: [98] },
          { t: fadeFrame, s: [62] },
          { t: endFrame, s: [0] },
        ],
        rotationFrames: [
          { t: inFrame, s: [0] },
          { t: midFrame, s: [rotationEnd * 0.52] },
          { t: endFrame, s: [rotationEnd] },
        ],
        inFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
  }

  return layers;
};

const buildFallingLayers = (startIndex, options) => {
  const {
    seed,
    count,
    startY = -120,
    endY = HEIGHT + 120,
    xRange = [80, WIDTH - 80],
    palette,
    sizeRange,
    shapeFactory,
  } = options;

  const rng = createRng(seed);
  const layers = [];

  for (let idx = 0; idx < count; idx += 1) {
    const x = xRange[0] + (rng() * (xRange[1] - xRange[0]));
    const x2 = x + ((rng() - 0.5) * 280);
    const xMid = x + ((rng() - 0.5) * 420);
    const size = sizeRange[0] + (rng() * (sizeRange[1] - sizeRange[0]));
    const color = palette[Math.floor(rng() * palette.length)];
    const inFrame = clampFrame(Math.floor(rng() * 70));
    const popFrame = clampFrame(inFrame + 10 + Math.floor(rng() * 6));
    const midFrame = clampFrame(inFrame + 38 + Math.floor(rng() * 16));
    const endFrame = clampFrame(inFrame + 110 + Math.floor(rng() * 40));
    const rotationEnd = -180 + (rng() * 360);
    const shapes = shapeFactory({ size, color, index: idx, rng });

    layers.push(
      buildLayer({
        index: startIndex + layers.length,
        name: `Fall ${seed}-${idx}`,
        shapes,
        positionFrames: [
          { t: inFrame, s: [x, startY, 0] },
          { t: midFrame, s: [xMid, ((startY + endY) * 0.5) - 90, 0] },
          { t: endFrame, s: [x2, endY, 0] },
        ],
        scaleFrames: [
          { t: inFrame, s: [42, 42, 100] },
          { t: popFrame, s: [136, 136, 100] },
          { t: midFrame, s: [100, 100, 100] },
          { t: endFrame, s: [154, 154, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: inFrame, s: [0] },
          { t: popFrame, s: [98] },
          { t: midFrame, s: [96] },
          { t: clampFrame(endFrame - 10), s: [96] },
          { t: endFrame, s: [0] },
        ],
        rotationFrames: [
          { t: inFrame, s: [0] },
          { t: midFrame, s: [rotationEnd * 0.46] },
          { t: endFrame, s: [rotationEnd] },
        ],
        inFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
  }

  return layers;
};

const buildBeamLayers = (startIndex, options) => {
  const { seed, count, xRange, yBase, palette, accentPalette, widthRange, heightRange, rotationRange } = options;
  const rng = createRng(seed);
  const layers = [];

  for (let idx = 0; idx < count; idx += 1) {
    const x = xRange[0] + (rng() * (xRange[1] - xRange[0]));
    const width = widthRange[0] + (rng() * (widthRange[1] - widthRange[0]));
    const height = heightRange[0] + (rng() * (heightRange[1] - heightRange[0]));
    const color = palette[Math.floor(rng() * palette.length)];
    const accent = accentPalette[Math.floor(rng() * accentPalette.length)];
    const phase = Math.floor(rng() * 40);
    const t1 = clampFrame(34 + phase);
    const t2 = clampFrame(86 + phase);
    const t3 = clampFrame(142 + phase);
    const t4 = clampFrame(164 + phase);

    layers.push(
      buildLayer({
        index: startIndex + layers.length,
        name: `Beam ${seed}-${idx}`,
        shapes: [beamGroup("Beam", width, height, color, accent)],
        positionFrames: [{ t: 0, s: [x, yBase, 0] }],
        scaleFrames: [
          { t: 0, s: [76, 56, 100] },
          { t: t1, s: [136, 144, 100] },
          { t: t2, s: [98, 92, 100] },
          { t: t3, s: [142, 126, 100] },
          { t: t4, s: [104, 94, 100] },
          { t: LAST_FRAME, s: [76, 56, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: clampFrame(8 + phase), s: [78] },
          { t: t1, s: [92] },
          { t: t2, s: [98] },
          { t: t3, s: [84] },
          { t: t4, s: [62] },
          { t: LAST_FRAME, s: [0] },
        ],
        rotationFrames: [{ t: 0, s: [rotationRange[0] + (rng() * (rotationRange[1] - rotationRange[0]))] }],
      }),
    );
  }

  return layers;
};

const buildOrbitBallLayers = (startIndex, options) => {
  const { seed, count, center, radiusRange, sizeRange, palette } = options;
  const rng = createRng(seed);
  const layers = [];

  for (let idx = 0; idx < count; idx += 1) {
    const angle = rng() * Math.PI * 2;
    const startRadius = radiusRange[0] + (rng() * (radiusRange[1] - radiusRange[0]));
    const midRadius = startRadius + 120 + (rng() * 180);
    const endRadius = startRadius + 260 + (rng() * 380);
    const inFrame = clampFrame(Math.floor(rng() * 30));
    const popFrame = clampFrame(inFrame + 12 + Math.floor(rng() * 6));
    const midFrame = clampFrame(inFrame + 50 + Math.floor(rng() * 18));
    const endFrame = clampFrame(inFrame + 132);
    const size = sizeRange[0] + (rng() * (sizeRange[1] - sizeRange[0]));
    const body = palette[Math.floor(rng() * palette.length)];
    const x1 = center[0] + (Math.cos(angle) * startRadius);
    const y1 = center[1] + (Math.sin(angle) * startRadius * 0.56);
    const xMid = center[0] + (Math.cos(angle + 0.92) * midRadius);
    const yMid = center[1] + (Math.sin(angle + 0.92) * midRadius * 0.68);
    const x2 = center[0] + (Math.cos(angle + 2.5) * endRadius);
    const y2 = center[1] + (Math.sin(angle + 2.5) * endRadius * 0.76);

    layers.push(
      buildLayer({
        index: startIndex + layers.length,
        name: `Orbit Ball ${seed}-${idx}`,
        shapes: [bingoBallGroup("Bingo Ball", size, body.color, body.digit)],
        positionFrames: [
          { t: inFrame, s: [x1, y1, 0] },
          { t: midFrame, s: [xMid, yMid, 0] },
          { t: endFrame, s: [x2, y2, 0] },
        ],
        scaleFrames: [
          { t: inFrame, s: [44, 44, 100] },
          { t: popFrame, s: [142, 142, 100] },
          { t: midFrame, s: [104, 104, 100] },
          { t: endFrame, s: [160, 160, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: inFrame, s: [0] },
          { t: popFrame, s: [100] },
          { t: clampFrame(endFrame - 10), s: [96] },
          { t: endFrame, s: [0] },
        ],
        rotationFrames: [
          { t: inFrame, s: [0] },
          { t: midFrame, s: [132] },
          { t: endFrame, s: [330] },
        ],
        inFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
  }

  return layers;
};

const buildRingPulseLayers = (startIndex, options) => {
  const {
    seed,
    count,
    center,
    radiusRange,
    widthRange,
    palette,
    accentPalette = [rgb("#ffffff")],
    startFrame = 0,
    durationRange = [70, 110],
    scaleFrom = 30,
    scaleTo = 170,
  } = options;

  const rng = createRng(seed);
  const layers = [];

  for (let idx = 0; idx < count; idx += 1) {
    const radius = radiusRange[0] + (rng() * (radiusRange[1] - radiusRange[0]));
    const width = widthRange[0] + (rng() * (widthRange[1] - widthRange[0]));
    const color = palette[Math.floor(rng() * palette.length)];
    const accent = accentPalette[Math.floor(rng() * accentPalette.length)];
    const inFrame = clampFrame(startFrame + Math.floor(rng() * 28));
    const impactFrame = clampFrame(inFrame + 10 + Math.floor(rng() * 6));
    const midFrame = clampFrame(inFrame + 18 + Math.floor(rng() * 10));
    const endFrame = clampFrame(inFrame + durationRange[0] + Math.floor(rng() * (durationRange[1] - durationRange[0])));

    layers.push(
      buildLayer({
        index: startIndex + layers.length,
        name: `Ring Pulse ${seed}-${idx}`,
        shapes: [ringGroup("Pulse Ring", radius, color, accent, width)],
        positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
        scaleFrames: [
          { t: inFrame, s: [scaleFrom, scaleFrom, 100] },
          { t: impactFrame, s: [132, 132, 100] },
          { t: midFrame, s: [108, 108, 100] },
          { t: endFrame, s: [scaleTo, scaleTo, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: inFrame, s: [0] },
          { t: impactFrame, s: [100] },
          { t: midFrame, s: [74] },
          { t: endFrame, s: [0] },
        ],
        inFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
  }

  return layers;
};

const buildFireworkDisplayLayers = (startIndex, bursts) => {
  const layers = [];

  for (const [idx, burst] of bursts.entries()) {
    layers.push(
      buildLayer({
        index: startIndex + layers.length,
        name: `Display Firework ${idx}`,
        shapes: [fireworkGroup("Display Firework", burst.inner ?? Math.max(26, burst.outer * 0.18), burst.outer, burst.rays ?? 22, burst.color, burst.accent)],
        positionFrames: [{ t: 0, s: [burst.center[0], burst.center[1], 0] }],
        scaleFrames: [
          { t: burst.start, s: [20, 20, 100] },
          { t: clampFrame(burst.start + 8), s: [138, 138, 100] },
          { t: clampFrame(burst.start + 18), s: [98, 98, 100] },
          { t: clampFrame(burst.start + 84), s: [166, 166, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: burst.start, s: [0] },
          { t: clampFrame(burst.start + 6), s: [100] },
          { t: clampFrame(burst.start + 20), s: [92] },
          { t: clampFrame(burst.start + 84), s: [0] },
        ],
        inFrame: burst.start,
        outFrame: clampFrame(burst.start + 85) + 1,
      }),
    );
  }

  return layers;
};

const buildHeroBallRushLayers = (startIndex, configs) => {
  const layers = [];

  for (const [idx, config] of configs.entries()) {
    const midFrame = config.midFrame ?? clampFrame(config.startFrame + 42);
    const endFrame = config.endFrame ?? clampFrame(config.startFrame + 126);

    layers.push(
      buildLayer({
        index: startIndex + layers.length,
        name: `Hero Ball ${idx}`,
        shapes: [bingoBallGroup("Hero Ball", config.radius, config.color, config.digit)],
        positionFrames: [
          { t: config.startFrame, s: [config.from[0], config.from[1], 0] },
          { t: midFrame, s: [config.mid[0], config.mid[1], 0] },
          { t: endFrame, s: [config.to[0], config.to[1], 0] },
        ],
        scaleFrames: [
          { t: config.startFrame, s: [46, 46, 100] },
          { t: clampFrame(config.startFrame + 9), s: [142, 142, 100] },
          { t: midFrame, s: [108, 108, 100] },
          { t: endFrame, s: [160, 160, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: config.startFrame, s: [0] },
          { t: clampFrame(config.startFrame + 6), s: [100] },
          { t: clampFrame(endFrame - 14), s: [94] },
          { t: endFrame, s: [0] },
        ],
        rotationFrames: [
          { t: config.startFrame, s: [config.rotationStart ?? -48] },
          { t: midFrame, s: [config.rotationMid ?? 108] },
          { t: endFrame, s: [config.rotationEnd ?? 246] },
        ],
        inFrame: config.startFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
  }

  return layers;
};

const buildPremiumDepthOverlayLayers = (startIndex, seed, center = [WIDTH * 0.5, HEIGHT * 0.58]) => {
  let nextIndex = startIndex;
  const layers = [];
  const palette = [
    rgb("#f5c65b"),
    rgb("#fff1b4"),
    rgb("#58c7ff"),
    rgb("#ff4fd8"),
    rgb("#8f5bff"),
    rgb("#ff9c36"),
    rgb("#23bf66"),
    rgb("#ffffff"),
  ];
  const pick = (offset) => palette[(offset + (seed % palette.length)) % palette.length];

  const backgroundBeams = buildBeamLayers(nextIndex, {
    seed: seed + 11,
    count: 12,
    xRange: [100, WIDTH - 100],
    yBase: HEIGHT * 0.74,
    palette: [pick(0), pick(2), pick(4)],
    accentPalette: [pick(1), pick(7)],
    widthRange: [12, 32],
    heightRange: [280, 640],
    rotationRange: [-34, 34],
  });
  layers.push(...backgroundBeams);
  nextIndex += backgroundBeams.length;

  const backgroundRings = buildRingPulseLayers(nextIndex, {
    seed: seed + 17,
    count: 6,
    center,
    radiusRange: [170, 460],
    widthRange: [10, 22],
    palette: [pick(0), pick(2), pick(3), pick(4)],
    accentPalette: [pick(1), pick(7)],
    startFrame: 0,
    durationRange: [98, 150],
    scaleFrom: 18,
    scaleTo: 242,
  });
  layers.push(...backgroundRings);
  nextIndex += backgroundRings.length;

  const midSparks = buildRadialBurstLayers(nextIndex, {
    seed: seed + 23,
    count: 34,
    center,
    minRadius: 90,
    maxRadius: 1080,
    startFrame: 0,
    duration: 164,
    palette: [pick(1), pick(2), pick(3), pick(7)],
    sizeRange: [7, 18],
    shapeFactory: ({ size, color }) => [sparkleGroup("Premium Spark", size, color, pick(7))],
    scaleFrom: 14,
    scaleTo: 218,
    travelYScale: 0.8,
    rotationRange: [-180, 180],
  });
  layers.push(...midSparks);
  nextIndex += midSparks.length;

  const lightStreaks = buildRadialBurstLayers(nextIndex, {
    seed: seed + 29,
    count: 22,
    center,
    minRadius: 180,
    maxRadius: 1220,
    startFrame: 0,
    duration: 124,
    palette: [pick(0), pick(2), pick(3), pick(5)],
    sizeRange: [20, 48],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Premium Streak",
        [[0, 0], [size * 4.2, 0]],
        color,
        Math.max(6, size * 0.24),
        rgb("#ffffff"),
        Math.max(1.8, size * 0.08),
        24,
        96,
      ),
    ],
    scaleFrom: 12,
    scaleTo: 198,
    travelYScale: 0.74,
    rotationRange: [-180, 180],
  });
  layers.push(...lightStreaks);
  nextIndex += lightStreaks.length;

  const confetti = buildFallingLayers(nextIndex, {
    seed: seed + 31,
    count: 30,
    startY: -100,
    endY: HEIGHT + 130,
    xRange: [60, WIDTH - 60],
    palette: [pick(0), pick(2), pick(3), pick(4), pick(5), pick(7)],
    sizeRange: [14, 32],
    shapeFactory: ({ size, color }) => [confettiGroup("Premium Confetti", size * 0.9, size * 0.5, color, rgb("#ffffff"))],
  });
  layers.push(...confetti);
  nextIndex += confetti.length;

  const foregroundObjects = buildFallingLayers(nextIndex, {
    seed: seed + 37,
    count: 18,
    startY: -120,
    endY: HEIGHT + 110,
    xRange: [90, WIDTH - 90],
    palette: [pick(0), pick(1), pick(2), pick(5)],
    sizeRange: [22, 48],
    shapeFactory: ({ size, color, index }) => {
      if (index % 3 === 0) {
        return [coinGroup("Premium Coin", size, color, rgb("#fff1b4"))];
      }
      if (index % 3 === 1) {
        return [shardGroup("Premium Shard", size * 0.82, size * 1.18, color, rgb("#fff0b7"))];
      }
      return [sparkleGroup("Premium Float Spark", size * 0.58, color, rgb("#ffffff"))];
    },
  });
  layers.push(...foregroundObjects);

  return layers;
};

const decoratePremiumFullscreenAnimation = (animation, effectKey) => {
  const seed = hashString(effectKey);
  const maxIndex = animation.layers.reduce((highest, layer) => Math.max(highest, typeof layer.ind === "number" ? layer.ind : 0), 0);
  const decoratedLayers = [
    ...animation.layers,
    ...buildPremiumDepthOverlayLayers(maxIndex + 1, seed),
  ];

  return {
    ...animation,
    layers: decoratedLayers,
  };
};

const makeAnimation = (name, layers) => ({
  v: "5.7.6",
  fr: FRAME_RATE,
  ip: 0,
  op: DURATION_FRAMES,
  w: WIDTH,
  h: HEIGHT,
  nm: name,
  ddd: 0,
  assets: [],
  layers,
});

const buildMegaJackpot = () => {
  let nextIndex = 1;
  const layers = [];

  const beams = buildBeamLayers(nextIndex, {
    seed: 11,
    count: 8,
    xRange: [360, 1560],
    yBase: 664,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ff9c36")],
    accentPalette: [rgb("#ffb22d"), rgb("#ffffff")],
    widthRange: [18, 46],
    heightRange: [280, 520],
    rotationRange: [-18, 18],
  });
  layers.push(...beams);
  nextIndex += beams.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 15,
    count: 3,
    center: [960, 648],
    radiusRange: [140, 290],
    widthRange: [10, 18],
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ff9c36")],
    accentPalette: [rgb("#fff1b4"), rgb("#ffffff")],
    startFrame: 4,
    durationRange: [74, 110],
    scaleFrom: 26,
    scaleTo: 160,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const heroBalls = buildHeroBallRushLayers(nextIndex, [
    { startFrame: 4, radius: 96, color: rgb("#f5c65b"), digit: 1, from: [-120, 720], mid: [520, 548], to: [1420, 268], rotationEnd: 168 },
    { startFrame: 14, radius: 112, color: rgb("#ff6e2e"), digit: 7, from: [2040, 760], mid: [1360, 510], to: [360, 286], rotationStart: 42, rotationEnd: -168 },
    { startFrame: 22, radius: 92, color: rgb("#7a44ff"), digit: 8, from: [960, 1160], mid: [960, 618], to: [960, 218], rotationEnd: 122 },
  ]);
  layers.push(...heroBalls);
  nextIndex += heroBalls.length;

  const coins = buildRadialBurstLayers(nextIndex, {
    seed: 19,
    count: 14,
    center: [960, 648],
    minRadius: 320,
    maxRadius: 820,
    startFrame: 16,
    duration: 112,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    sizeRange: [20, 42],
    shapeFactory: ({ size, color }) => [coinGroup("Coin", size, color, rgb("#fff1b4"))],
    scaleFrom: 68,
    scaleTo: 118,
    travelYScale: 0.54,
    rotationRange: [-160, 160],
  });
  layers.push(...coins);
  nextIndex += coins.length;

  const streaks = buildRadialBurstLayers(nextIndex, {
    seed: 21,
    count: 10,
    center: [960, 646],
    minRadius: 240,
    maxRadius: 720,
    startFrame: 10,
    duration: 100,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffffff")],
    sizeRange: [16, 28],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Streak",
        [[0, 0], [size * 2.8, 0]],
        color,
        Math.max(6, size * 0.28),
        rgb("#ffffff"),
        Math.max(1.8, size * 0.08),
        22,
        92,
      ),
    ],
    scaleFrom: 32,
    scaleTo: 108,
    travelYScale: 0.56,
    rotationRange: [-74, 74],
  });
  layers.push(...streaks);
  nextIndex += streaks.length;

  const fireworks = buildFireworkDisplayLayers(nextIndex, [
    { center: [330, 248], start: 28, outer: 142, color: rgb("#ff4fd8"), accent: rgb("#ffd2ef"), rays: 14 },
    { center: [1590, 258], start: 38, outer: 152, color: rgb("#58c7ff"), accent: rgb("#dff5ff"), rays: 14 },
  ]);
  layers.push(...fireworks);
  nextIndex += fireworks.length;

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 23,
    count: 28,
    center: [960, 628],
    minRadius: 180,
    maxRadius: 640,
    startFrame: 8,
    duration: 102,
    palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffffff"), rgb("#ff9c36")],
    sizeRange: [8, 16],
    shapeFactory: ({ size, color }) => [sparkleGroup("Spark", size, color, rgb("#fff8de"))],
    scaleFrom: 46,
    scaleTo: 116,
    travelYScale: 0.58,
    rotationRange: [-120, 120],
  });
  layers.push(...sparks);

  return makeAnimation("Mega Jackpot", layers);
};

const buildGrandFireworks = () => {
  let nextIndex = 1;
  const layers = [];
  const bursts = [
    { center: [300, 236], start: 8, outer: 236, color: rgb("#ff4fd8"), accent: rgb("#ffd2ef") },
    { center: [662, 316], start: 24, outer: 188, color: rgb("#8f5bff"), accent: rgb("#d7c4ff") },
    { center: [970, 188], start: 16, outer: 252, color: rgb("#f5c65b"), accent: rgb("#fff1b4") },
    { center: [1320, 248], start: 28, outer: 220, color: rgb("#ff9c36"), accent: rgb("#ffe8c0") },
    { center: [1626, 286], start: 40, outer: 210, color: rgb("#58c7ff"), accent: rgb("#dff5ff") },
  ];

  for (const [idx, burst] of bursts.entries()) {
    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Firework Burst ${nextIndex}`,
        shapes: [fireworkGroup("Firework", 10, burst.outer, 24, burst.color, burst.accent)],
        positionFrames: [{ t: 0, s: [burst.center[0], burst.center[1], 0] }],
        scaleFrames: [
          { t: burst.start, s: [24, 24, 100] },
          { t: clampFrame(burst.start + 16), s: [112, 112, 100] },
          { t: clampFrame(burst.start + 30), s: [100, 100, 100] },
          { t: clampFrame(burst.start + 82), s: [142, 142, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: burst.start, s: [0] },
          { t: clampFrame(burst.start + 8), s: [96] },
          { t: clampFrame(burst.start + 26), s: [84] },
          { t: clampFrame(burst.start + 82), s: [0] },
        ],
        rotationFrames: [{ t: 0, s: [0] }],
        inFrame: burst.start,
        outFrame: clampFrame(burst.start + 83) + 1,
      }),
    );
    nextIndex += 1;

    const pulses = buildRingPulseLayers(nextIndex, {
      seed: 140 + idx,
      count: 2,
      center: burst.center,
      radiusRange: [80, 160],
      widthRange: [10, 18],
      palette: [burst.color],
      accentPalette: [burst.accent],
      startFrame: burst.start + 2,
      durationRange: [54, 72],
      scaleFrom: 22,
      scaleTo: 162,
    });
    layers.push(...pulses);
    nextIndex += pulses.length;
  }

  for (const [idx, burst] of bursts.entries()) {
    const sparks = buildRadialBurstLayers(nextIndex, {
      seed: 50 + idx,
      count: 28,
      center: burst.center,
      minRadius: 90,
      maxRadius: burst.outer * 1.18,
      startFrame: burst.start + 4,
      duration: 86,
      palette: [burst.color, burst.accent, rgb("#ff9c36"), rgb("#58c7ff")],
      sizeRange: [7, 16],
      shapeFactory: ({ size, color }) => [sparkleGroup("Spark", size, color, burst.accent)],
      scaleFrom: 36,
      scaleTo: 170,
      travelYScale: 0.82,
      rotationRange: [-180, 180],
    });
    layers.push(...sparks);
    nextIndex += sparks.length;
  }

  return makeAnimation("Grand Fireworks", layers);
};

const buildGoldenExplosion = () => {
  let nextIndex = 1;
  const layers = [];

  const beams = buildBeamLayers(nextIndex, {
    seed: 71,
    count: 18,
    xRange: [320, 1600],
    yBase: 520,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    accentPalette: [rgb("#fff1b4"), rgb("#8f5bff"), rgb("#ffffff")],
    widthRange: [16, 56],
    heightRange: [300, 620],
    rotationRange: [-54, 54],
  });
  layers.push(...beams);
  nextIndex += beams.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 72,
    count: 6,
    center: [960, 520],
    radiusRange: [96, 280],
    widthRange: [10, 24],
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    accentPalette: [rgb("#fff1b4")],
    startFrame: 2,
    durationRange: [58, 92],
    scaleFrom: 16,
    scaleTo: 194,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const shards = buildRadialBurstLayers(nextIndex, {
    seed: 74,
    count: 52,
    center: [960, 520],
    minRadius: 120,
    maxRadius: 1100,
    startFrame: 2,
    duration: 132,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    sizeRange: [20, 58],
    shapeFactory: ({ size, color }) => [shardGroup("Shard", size * 0.82, size * 1.2, color, rgb("#fff0b7"))],
    scaleFrom: 34,
    scaleTo: 156,
    travelYScale: 0.82,
    rotationRange: [-240, 240],
  });
  layers.push(...shards);
  nextIndex += shards.length;

  const coins = buildRadialBurstLayers(nextIndex, {
    seed: 75,
    count: 16,
    center: [960, 520],
    minRadius: 180,
    maxRadius: 920,
    startFrame: 2,
    duration: 122,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    sizeRange: [20, 46],
    shapeFactory: ({ size, color }) => [coinGroup("Gold Coin", size, color, rgb("#fff1b4"))],
    scaleFrom: 48,
    scaleTo: 144,
    travelYScale: 0.78,
    rotationRange: [-240, 240],
  });
  layers.push(...coins);
  nextIndex += coins.length;

  const streaks = buildRadialBurstLayers(nextIndex, {
    seed: 76,
    count: 22,
    center: [960, 520],
    minRadius: 180,
    maxRadius: 920,
    startFrame: 2,
    duration: 104,
    palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ff9c36")],
    sizeRange: [20, 44],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Explosion Streak",
        [[0, 0], [size * 3.2, 0]],
        color,
        Math.max(6, size * 0.28),
        rgb("#ffffff"),
        Math.max(1.8, size * 0.08),
        20,
        92,
      ),
    ],
    scaleFrom: 18,
    scaleTo: 160,
    travelYScale: 0.8,
    rotationRange: [-120, 120],
  });
  layers.push(...streaks);
  nextIndex += streaks.length;

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 78,
    count: 60,
    center: [960, 520],
    minRadius: 90,
    maxRadius: 980,
    startFrame: 2,
    duration: 120,
    palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ff9c36")],
    sizeRange: [8, 18],
    shapeFactory: ({ size, color }) => [sparkleGroup("Spark", size, color, rgb("#fff8df"))],
    scaleFrom: 32,
    scaleTo: 178,
    travelYScale: 0.86,
    rotationRange: [-180, 180],
  });
  layers.push(...sparks);

  return makeAnimation("Golden Explosion", layers);
};

const buildBingoStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const ballPalette = [
    { color: rgb("#ff6e2e"), digit: 7 },
    { color: rgb("#7a44ff"), digit: 8 },
    { color: rgb("#2f86ff"), digit: 3 },
    { color: rgb("#23bf66"), digit: 9 },
    { color: rgb("#f5c65b"), digit: 1 },
  ];

  const orbitBalls = buildOrbitBallLayers(nextIndex, {
    seed: 81,
    count: 28,
    center: [960, 530],
    radiusRange: [120, 520],
    sizeRange: [24, 62],
    palette: ballPalette,
  });
  layers.push(...orbitBalls);
  nextIndex += orbitBalls.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 83,
    count: 6,
    center: [960, 530],
    radiusRange: [110, 320],
    widthRange: [12, 24],
    palette: [rgb("#58c7ff"), rgb("#8f5bff"), rgb("#f5c65b")],
    accentPalette: [rgb("#ffffff"), rgb("#dff5ff")],
    startFrame: 4,
    durationRange: [72, 104],
    scaleFrom: 20,
    scaleTo: 188,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const heroBalls = buildHeroBallRushLayers(nextIndex, [
    { startFrame: 0, radius: 98, color: rgb("#2f86ff"), digit: 3, from: [-180, 320], mid: [360, 420], to: [1780, 720], rotationEnd: 286 },
    { startFrame: 10, radius: 108, color: rgb("#23bf66"), digit: 9, from: [2100, 320], mid: [1540, 430], to: [120, 740], rotationStart: 52, rotationEnd: -282 },
    { startFrame: 20, radius: 112, color: rgb("#7a44ff"), digit: 8, from: [960, 1160], mid: [960, 560], to: [960, 120], rotationEnd: 192 },
  ]);
  layers.push(...heroBalls);
  nextIndex += heroBalls.length;

  const lightningConfigs = [
    { position: [520, 336], rotation: -18, width: 420, height: 360 },
    { position: [1420, 318], rotation: 20, width: 460, height: 340 },
    { position: [860, 250], rotation: -6, width: 320, height: 260 },
    { position: [1180, 640], rotation: 12, width: 300, height: 220 },
    { position: [312, 520], rotation: -24, width: 300, height: 260 },
    { position: [1620, 542], rotation: 18, width: 320, height: 250 },
  ];

  lightningConfigs.forEach((config, idx) => {
    const start = 10 + (idx * 14);
    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Lightning ${idx}`,
        shapes: [lightningGroup("Lightning", config.width, config.height, rgb("#d8ecff"), rgb("#58c7ff"))],
        positionFrames: [{ t: 0, s: [config.position[0], config.position[1], 0] }],
        scaleFrames: [
          { t: 0, s: [92, 92, 100] },
          { t: clampFrame(start + 18), s: [108, 108, 100] },
          { t: clampFrame(start + 54), s: [96, 96, 100] },
          { t: LAST_FRAME, s: [92, 92, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: start, s: [0] },
          { t: clampFrame(start + 6), s: [88] },
          { t: clampFrame(start + 16), s: [30] },
          { t: clampFrame(start + 24), s: [80] },
          { t: clampFrame(start + 34), s: [0] },
        ],
        rotationFrames: [{ t: 0, s: [config.rotation] }],
        inFrame: start,
        outFrame: clampFrame(start + 35) + 1,
      }),
    );
    nextIndex += 1;
  });

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 89,
    count: 56,
    center: [960, 530],
    minRadius: 90,
    maxRadius: 980,
    startFrame: 4,
    duration: 128,
    palette: [rgb("#8f5bff"), rgb("#58c7ff"), rgb("#f5c65b"), rgb("#ff4fd8")],
    sizeRange: [7, 17],
    shapeFactory: ({ size, color }) => [sparkleGroup("Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 32,
    scaleTo: 174,
    travelYScale: 0.78,
    rotationRange: [-180, 180],
  });
  layers.push(...sparks);
  nextIndex += sparks.length;

  const streaks = buildRadialBurstLayers(nextIndex, {
    seed: 91,
    count: 22,
    center: [960, 530],
    minRadius: 160,
    maxRadius: 920,
    startFrame: 4,
    duration: 110,
    palette: [rgb("#58c7ff"), rgb("#8f5bff"), rgb("#f5c65b")],
    sizeRange: [18, 40],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Storm Streak",
        [[0, 0], [size * 3.1, 0]],
        color,
        Math.max(6, size * 0.28),
        rgb("#ffffff"),
        Math.max(1.8, size * 0.08),
        22,
        92,
      ),
    ],
    scaleFrom: 18,
    scaleTo: 166,
    travelYScale: 0.78,
    rotationRange: [-180, 180],
  });
  layers.push(...streaks);

  return makeAnimation("Bingo Storm", layers);
};

const buildCelebrationFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [960, 646];

  const beams = buildBeamLayers(nextIndex, {
    seed: 101,
    count: 18,
    xRange: [90, 1830],
    yBase: 724,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#58c7ff"), rgb("#8f5bff")],
    accentPalette: [rgb("#fff1b4"), rgb("#dff5ff"), rgb("#ffd2ef")],
    widthRange: [20, 66],
    heightRange: [360, 760],
    rotationRange: [-34, 34],
  });
  layers.push(...beams);
  nextIndex += beams.length;

  const accentBeams = buildBeamLayers(nextIndex, {
    seed: 102,
    count: 8,
    xRange: [160, 1760],
    yBase: 776,
    palette: [rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#fff1b4")],
    accentPalette: [rgb("#ffffff"), rgb("#fff1b4")],
    widthRange: [12, 34],
    heightRange: [220, 520],
    rotationRange: [-24, 24],
  });
  layers.push(...accentBeams);
  nextIndex += accentBeams.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 103,
    count: 6,
    center,
    radiusRange: [120, 320],
    widthRange: [12, 28],
    palette: [rgb("#f5c65b"), rgb("#58c7ff"), rgb("#ff4fd8"), rgb("#8f5bff")],
    accentPalette: [rgb("#ffffff"), rgb("#fff1b4")],
    startFrame: 4,
    durationRange: [60, 94],
    scaleFrom: 18,
    scaleTo: 210,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Finale Core Burst",
      shapes: [fireworkGroup("Finale Core Firework", 12, 340, 30, rgb("#f5c65b"), rgb("#fff1b4"))],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 4, s: [18, 18, 100] },
        { t: 18, s: [116, 116, 100] },
        { t: 32, s: [98, 98, 100] },
        { t: 92, s: [150, 150, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 4, s: [0] },
        { t: 12, s: [100] },
        { t: 30, s: [88] },
        { t: 92, s: [0] },
      ],
      inFrame: 4,
      outFrame: 93,
    }),
  );
  nextIndex += 1;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Finale Halo Burst",
      shapes: [fireworkGroup("Finale Halo Firework", 40, 228, 18, rgb("#ff4fd8"), rgb("#58c7ff"))],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 12, s: [24, 24, 100] },
        { t: 26, s: [112, 112, 100] },
        { t: 40, s: [94, 94, 100] },
        { t: 98, s: [144, 144, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 12, s: [0] },
        { t: 20, s: [82] },
        { t: 38, s: [70] },
        { t: 98, s: [0] },
      ],
      inFrame: 12,
      outFrame: 99,
    }),
  );
  nextIndex += 1;

  const finaleBursts = [
    { center: [246, 224], start: 8, outer: 228, color: rgb("#ff4fd8"), accent: rgb("#ffd2ef") },
    { center: [628, 284], start: 18, outer: 188, color: rgb("#58c7ff"), accent: rgb("#dff5ff") },
    { center: [960, 178], start: 14, outer: 304, color: rgb("#f5c65b"), accent: rgb("#fff1b4") },
    { center: [1318, 236], start: 24, outer: 214, color: rgb("#ff9c36"), accent: rgb("#ffe8c0") },
    { center: [1682, 286], start: 30, outer: 198, color: rgb("#8f5bff"), accent: rgb("#e6dbff") },
  ];

  for (const [idx, burst] of finaleBursts.entries()) {
    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Finale Firework ${nextIndex}`,
        shapes: [fireworkGroup("Finale Firework", 10, burst.outer, 28, burst.color, burst.accent)],
        positionFrames: [{ t: 0, s: [burst.center[0], burst.center[1], 0] }],
        scaleFrames: [
          { t: burst.start, s: [20, 20, 100] },
          { t: clampFrame(burst.start + 16), s: [118, 118, 100] },
          { t: clampFrame(burst.start + 30), s: [98, 98, 100] },
          { t: clampFrame(burst.start + 84), s: [148, 148, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: burst.start, s: [0] },
          { t: clampFrame(burst.start + 8), s: [98] },
          { t: clampFrame(burst.start + 26), s: [84] },
          { t: clampFrame(burst.start + 84), s: [0] },
        ],
        inFrame: burst.start,
        outFrame: clampFrame(burst.start + 85) + 1,
      }),
    );
    nextIndex += 1;

    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Finale Firework Secondary ${nextIndex}`,
        shapes: [fireworkGroup("Finale Firework Secondary", 30, burst.outer * 0.66, 18, burst.accent, rgb("#ffffff"))],
        positionFrames: [{ t: 0, s: [burst.center[0], burst.center[1], 0] }],
        scaleFrames: [
          { t: clampFrame(burst.start + 6), s: [18, 18, 100] },
          { t: clampFrame(burst.start + 18), s: [108, 108, 100] },
          { t: clampFrame(burst.start + 32), s: [90, 90, 100] },
          { t: clampFrame(burst.start + 76), s: [134, 134, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: clampFrame(burst.start + 6), s: [0] },
          { t: clampFrame(burst.start + 12), s: [84] },
          { t: clampFrame(burst.start + 30), s: [68] },
          { t: clampFrame(burst.start + 76), s: [0] },
        ],
        inFrame: clampFrame(burst.start + 6),
        outFrame: clampFrame(burst.start + 77) + 1,
      }),
    );
    nextIndex += 1;

    const burstRings = buildRingPulseLayers(nextIndex, {
      seed: 140 + idx,
      count: 2,
      center: burst.center,
      radiusRange: [80, 176],
      widthRange: [10, 18],
      palette: [burst.color, burst.accent],
      accentPalette: [rgb("#ffffff")],
      startFrame: burst.start + 2,
      durationRange: [48, 72],
      scaleFrom: 22,
      scaleTo: 168,
    });
    layers.push(...burstRings);
    nextIndex += burstRings.length;

    const burstStreaks = buildRadialBurstLayers(nextIndex, {
      seed: 150 + idx,
      count: 3,
      center: burst.center,
      minRadius: 110,
      maxRadius: burst.outer * 1.16,
      startFrame: burst.start + 4,
      duration: 82,
      palette: [burst.color, burst.accent, rgb("#fff1b4")],
      sizeRange: [18, 34],
      shapeFactory: ({ size, color }) => [
        lineStrokeGroup(
          "Finale Burst Streak",
          [[0, 0], [size * 4.2, 0]],
          color,
          Math.max(6, size * 0.28),
          rgb("#ffffff"),
          Math.max(1.8, size * 0.08),
          24,
          96,
        ),
      ],
      scaleFrom: 18,
      scaleTo: 164,
      travelYScale: 0.78,
      rotationRange: [-160, 160],
    });
    layers.push(...burstStreaks);
    nextIndex += burstStreaks.length;

    const burstSparks = buildRadialBurstLayers(nextIndex, {
      seed: 160 + idx,
      count: 8,
      center: burst.center,
      minRadius: 84,
      maxRadius: burst.outer * 1.22,
      startFrame: burst.start + 4,
      duration: 90,
      palette: [burst.color, burst.accent, rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff4fd8")],
      sizeRange: [8, 18],
      shapeFactory: ({ size, color }) => [sparkleGroup("Finale Burst Spark", size, color, rgb("#ffffff"))],
      scaleFrom: 30,
      scaleTo: 176,
      travelYScale: 0.82,
      rotationRange: [-180, 180],
    });
    layers.push(...burstSparks);
    nextIndex += burstSparks.length;
  }

  const coins = buildRadialBurstLayers(nextIndex, {
    seed: 109,
    count: 16,
    center,
    minRadius: 260,
    maxRadius: 1120,
    startFrame: 6,
    duration: 136,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    sizeRange: [24, 60],
    shapeFactory: ({ size, color }) => [coinGroup("Finale Coin", size, color, rgb("#fff1b4"))],
    scaleFrom: 58,
    scaleTo: 148,
    travelYScale: 0.72,
    rotationRange: [-260, 260],
  });
  layers.push(...coins);
  nextIndex += coins.length;

  const streaks = buildRadialBurstLayers(nextIndex, {
    seed: 113,
    count: 16,
    center,
    minRadius: 220,
    maxRadius: 980,
    startFrame: 2,
    duration: 116,
    palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff4fd8")],
    sizeRange: [20, 44],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Finale Streak",
        [[0, 0], [size * 3.8, 0]],
        color,
        Math.max(6, size * 0.26),
        rgb("#ffffff"),
        Math.max(1.8, size * 0.08),
        24,
        96,
      ),
    ],
    scaleFrom: 16,
    scaleTo: 168,
    travelYScale: 0.78,
    rotationRange: [-150, 150],
  });
  layers.push(...streaks);
  nextIndex += streaks.length;

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 117,
    count: 34,
    center,
    minRadius: 120,
    maxRadius: 980,
    startFrame: 4,
    duration: 128,
    palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff4fd8"), rgb("#8f5bff")],
    sizeRange: [8, 22],
    shapeFactory: ({ size, color }) => [sparkleGroup("Finale Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 28,
    scaleTo: 184,
    travelYScale: 0.84,
    rotationRange: [-180, 180],
  });
  layers.push(...sparks);
  nextIndex += sparks.length;

  const confetti = buildFallingLayers(nextIndex, {
    seed: 121,
    count: 40,
    startY: -90,
    endY: HEIGHT + 140,
    xRange: [60, WIDTH - 60],
    palette: [rgb("#f5c65b"), rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#8f5bff"), rgb("#ff9c36")],
    sizeRange: [14, 34],
    shapeFactory: ({ size, color }) => [confettiGroup("Finale Confetti", size * 0.92, size * 0.48, color, rgb("#ffffff"))],
  });
  layers.push(...confetti);
  nextIndex += confetti.length;

  const glitter = buildFallingLayers(nextIndex, {
    seed: 125,
    count: 24,
    startY: -90,
    endY: HEIGHT + 100,
    xRange: [100, WIDTH - 100],
    palette: [rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff4fd8"), rgb("#f5c65b")],
    sizeRange: [8, 18],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Finale Glitter",
        [[0, 0], [size * 1.8, 0]],
        color,
        Math.max(4, size * 0.2),
        rgb("#ffffff"),
        Math.max(1.2, size * 0.08),
        18,
        88,
      ),
    ],
  });
  layers.push(...glitter);

  return makeAnimation("Celebration Finale", layers);
};

const buildJackpotParadeBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [960, 620];

  const beams = buildBeamLayers(nextIndex, {
    seed: 171,
    count: 14,
    xRange: [160, 1760],
    yBase: 700,
    palette: [rgb("#f5c65b"), rgb("#ff9c36"), rgb("#ff4fd8")],
    accentPalette: [rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ffffff")],
    widthRange: [28, 74],
    heightRange: [360, 760],
    rotationRange: [-26, 26],
  });
  layers.push(...beams);
  nextIndex += beams.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 175,
    count: 6,
    center,
    radiusRange: [120, 320],
    widthRange: [12, 28],
    palette: [rgb("#f5c65b"), rgb("#ff4fd8"), rgb("#58c7ff")],
    accentPalette: [rgb("#fff1b4"), rgb("#ffffff")],
    startFrame: 4,
    durationRange: [68, 102],
    scaleFrom: 18,
    scaleTo: 210,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const heroBalls = buildHeroBallRushLayers(nextIndex, [
    { startFrame: 0, radius: 104, color: rgb("#f5c65b"), digit: 1, from: [-180, 810], mid: [460, 560], to: [1580, 190], rotationEnd: 220 },
    { startFrame: 8, radius: 114, color: rgb("#ff6e2e"), digit: 7, from: [2100, 760], mid: [1480, 520], to: [260, 220], rotationStart: 38, rotationEnd: -210 },
    { startFrame: 4, radius: 122, color: rgb("#7a44ff"), digit: 8, from: [960, 1180], mid: [960, 560], to: [960, 120], rotationStart: -20, rotationEnd: 184 },
    { startFrame: 16, radius: 98, color: rgb("#2f86ff"), digit: 3, from: [-140, 300], mid: [500, 420], to: [1840, 720], rotationEnd: 256 },
    { startFrame: 22, radius: 108, color: rgb("#23bf66"), digit: 9, from: [2060, 250], mid: [1420, 380], to: [120, 730], rotationStart: 56, rotationEnd: -190 },
  ]);
  layers.push(...heroBalls);
  nextIndex += heroBalls.length;

  const fireworks = buildFireworkDisplayLayers(nextIndex, [
    { center: [286, 228], start: 12, outer: 192, color: rgb("#ff4fd8"), accent: rgb("#ffd2ef"), rays: 20 },
    { center: [1624, 246], start: 24, outer: 204, color: rgb("#58c7ff"), accent: rgb("#dff5ff"), rays: 20 },
  ]);
  layers.push(...fireworks);
  nextIndex += fireworks.length;

  const coins = buildRadialBurstLayers(nextIndex, {
    seed: 179,
    count: 18,
    center,
    minRadius: 260,
    maxRadius: 980,
    startFrame: 6,
    duration: 134,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    sizeRange: [22, 54],
    shapeFactory: ({ size, color }) => [coinGroup("Parade Coin", size, color, rgb("#fff1b4"))],
    scaleFrom: 52,
    scaleTo: 148,
    travelYScale: 0.72,
    rotationRange: [-260, 260],
  });
  layers.push(...coins);
  nextIndex += coins.length;

  const confetti = buildFallingLayers(nextIndex, {
    seed: 183,
    count: 26,
    startY: -90,
    endY: HEIGHT + 120,
    xRange: [80, WIDTH - 80],
    palette: [rgb("#f5c65b"), rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#ffffff")],
    sizeRange: [14, 32],
    shapeFactory: ({ size, color }) => [confettiGroup("Parade Confetti", size * 0.9, size * 0.5, color, rgb("#ffffff"))],
  });
  layers.push(...confetti);
  nextIndex += confetti.length;

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 187,
    count: 24,
    center,
    minRadius: 110,
    maxRadius: 880,
    startFrame: 4,
    duration: 120,
    palette: [rgb("#fff1b4"), rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#8f5bff")],
    sizeRange: [8, 20],
    shapeFactory: ({ size, color }) => [sparkleGroup("Parade Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 180,
    travelYScale: 0.8,
    rotationRange: [-180, 180],
  });
  layers.push(...sparks);

  return makeAnimation("Jackpot Parade Blast", layers);
};

const buildRoyalBingoFireworks = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [960, 560];

  const beams = buildBeamLayers(nextIndex, {
    seed: 191,
    count: 10,
    xRange: [220, 1700],
    yBase: 692,
    palette: [rgb("#8f5bff"), rgb("#58c7ff"), rgb("#f5c65b")],
    accentPalette: [rgb("#ffffff"), rgb("#ffd2ef"), rgb("#fff1b4")],
    widthRange: [24, 64],
    heightRange: [340, 700],
    rotationRange: [-22, 22],
  });
  layers.push(...beams);
  nextIndex += beams.length;

  const fireworks = buildFireworkDisplayLayers(nextIndex, [
    { center: [218, 236], start: 8, outer: 172, color: rgb("#58c7ff"), accent: rgb("#dff5ff"), rays: 18 },
    { center: [520, 294], start: 18, outer: 148, color: rgb("#ff4fd8"), accent: rgb("#ffd2ef"), rays: 18 },
    { center: [960, 176], start: 12, outer: 264, color: rgb("#f5c65b"), accent: rgb("#fff1b4"), rays: 26 },
    { center: [1388, 256], start: 22, outer: 176, color: rgb("#ff9c36"), accent: rgb("#ffe8c0"), rays: 18 },
    { center: [1714, 226], start: 30, outer: 188, color: rgb("#8f5bff"), accent: rgb("#e6dbff"), rays: 18 },
  ]);
  layers.push(...fireworks);
  nextIndex += fireworks.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 195,
    count: 4,
    center,
    radiusRange: [120, 280],
    widthRange: [10, 24],
    palette: [rgb("#f5c65b"), rgb("#8f5bff"), rgb("#58c7ff")],
    accentPalette: [rgb("#ffffff"), rgb("#fff1b4")],
    startFrame: 12,
    durationRange: [60, 94],
    scaleFrom: 24,
    scaleTo: 188,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const heroBalls = buildHeroBallRushLayers(nextIndex, [
    { startFrame: 10, radius: 88, color: rgb("#7a44ff"), digit: 8, from: [300, 1120], mid: [540, 640], to: [760, 220], rotationEnd: 180 },
    { startFrame: 18, radius: 82, color: rgb("#23bf66"), digit: 9, from: [1620, 1120], mid: [1360, 620], to: [1180, 250], rotationStart: 42, rotationEnd: -176 },
    { startFrame: 28, radius: 92, color: rgb("#f5c65b"), digit: 1, from: [960, 1160], mid: [960, 660], to: [960, 240], rotationEnd: 142 },
  ]);
  layers.push(...heroBalls);
  nextIndex += heroBalls.length;

  const shards = buildRadialBurstLayers(nextIndex, {
    seed: 199,
    count: 22,
    center,
    minRadius: 180,
    maxRadius: 880,
    startFrame: 10,
    duration: 124,
    palette: [rgb("#f5c65b"), rgb("#ff9c36"), rgb("#58c7ff"), rgb("#ff4fd8")],
    sizeRange: [18, 40],
    shapeFactory: ({ size, color }) => [shardGroup("Royal Shard", size * 0.82, size * 1.18, color, rgb("#fff0b7"))],
    scaleFrom: 28,
    scaleTo: 164,
    travelYScale: 0.78,
    rotationRange: [-220, 220],
  });
  layers.push(...shards);
  nextIndex += shards.length;

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 203,
    count: 26,
    center,
    minRadius: 120,
    maxRadius: 760,
    startFrame: 6,
    duration: 118,
    palette: [rgb("#ffffff"), rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff4fd8")],
    sizeRange: [8, 18],
    shapeFactory: ({ size, color }) => [sparkleGroup("Royal Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 22,
    scaleTo: 174,
    travelYScale: 0.82,
    rotationRange: [-180, 180],
  });
  layers.push(...sparks);

  return makeAnimation("Royal Bingo Fireworks", layers);
};

const buildLuckyNumberRush = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [960, 520];

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 207,
    count: 5,
    center,
    radiusRange: [110, 300],
    widthRange: [10, 24],
    palette: [rgb("#58c7ff"), rgb("#8f5bff"), rgb("#23bf66")],
    accentPalette: [rgb("#dff5ff"), rgb("#ffffff")],
    startFrame: 0,
    durationRange: [56, 92],
    scaleFrom: 18,
    scaleTo: 196,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const heroBalls = buildHeroBallRushLayers(nextIndex, [
    { startFrame: 0, radius: 120, color: rgb("#2f86ff"), digit: 3, from: [-220, 260], mid: [420, 380], to: [1840, 760], rotationEnd: 320 },
    { startFrame: 6, radius: 112, color: rgb("#23bf66"), digit: 9, from: [2140, 260], mid: [1500, 400], to: [60, 760], rotationStart: 52, rotationEnd: -320 },
    { startFrame: 12, radius: 126, color: rgb("#7a44ff"), digit: 8, from: [960, 1140], mid: [960, 540], to: [960, 60], rotationEnd: 198 },
    { startFrame: 18, radius: 96, color: rgb("#ff6e2e"), digit: 7, from: [-180, 760], mid: [520, 580], to: [1780, 180], rotationEnd: 280 },
    { startFrame: 24, radius: 104, color: rgb("#f5c65b"), digit: 1, from: [2100, 760], mid: [1400, 560], to: [140, 170], rotationStart: 64, rotationEnd: -264 },
    { startFrame: 30, radius: 88, color: rgb("#23bf66"), digit: 6, from: [-180, 540], mid: [620, 500], to: [1940, 420], rotationEnd: 210 },
  ]);
  layers.push(...heroBalls);
  nextIndex += heroBalls.length;

  const streaks = buildRadialBurstLayers(nextIndex, {
    seed: 211,
    count: 18,
    center,
    minRadius: 180,
    maxRadius: 980,
    startFrame: 2,
    duration: 116,
    palette: [rgb("#58c7ff"), rgb("#8f5bff"), rgb("#23bf66"), rgb("#ffffff")],
    sizeRange: [18, 40],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Rush Streak",
        [[0, 0], [size * 4.2, 0]],
        color,
        Math.max(6, size * 0.24),
        rgb("#ffffff"),
        Math.max(1.8, size * 0.08),
        22,
        96,
      ),
    ],
    scaleFrom: 18,
    scaleTo: 172,
    travelYScale: 0.76,
    rotationRange: [-160, 160],
  });
  layers.push(...streaks);
  nextIndex += streaks.length;

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 215,
    count: 24,
    center,
    minRadius: 100,
    maxRadius: 720,
    startFrame: 4,
    duration: 108,
    palette: [rgb("#dff5ff"), rgb("#58c7ff"), rgb("#8f5bff"), rgb("#23bf66")],
    sizeRange: [8, 18],
    shapeFactory: ({ size, color }) => [sparkleGroup("Rush Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 22,
    scaleTo: 168,
    travelYScale: 0.82,
    rotationRange: [-180, 180],
  });
  layers.push(...sparks);

  return makeAnimation("Lucky Number Rush", layers);
};

const buildVegasGoldCascade = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [960, 420];

  const beams = buildBeamLayers(nextIndex, {
    seed: 219,
    count: 12,
    xRange: [180, 1740],
    yBase: 640,
    palette: [rgb("#f5c65b"), rgb("#ff9c36")],
    accentPalette: [rgb("#fff1b4"), rgb("#ffffff")],
    widthRange: [24, 62],
    heightRange: [340, 760],
    rotationRange: [-20, 20],
  });
  layers.push(...beams);
  nextIndex += beams.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 223,
    count: 4,
    center,
    radiusRange: [120, 260],
    widthRange: [12, 24],
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ff9c36")],
    accentPalette: [rgb("#fff1b4"), rgb("#ffffff")],
    startFrame: 6,
    durationRange: [62, 96],
    scaleFrom: 24,
    scaleTo: 188,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const coins = buildFallingLayers(nextIndex, {
    seed: 227,
    count: 28,
    startY: -120,
    endY: HEIGHT + 140,
    xRange: [70, WIDTH - 70],
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    sizeRange: [22, 58],
    shapeFactory: ({ size, color }) => [coinGroup("Cascade Coin", size, color, rgb("#fff1b4"))],
  });
  layers.push(...coins);
  nextIndex += coins.length;

  const shards = buildFallingLayers(nextIndex, {
    seed: 231,
    count: 20,
    startY: -90,
    endY: HEIGHT + 120,
    xRange: [120, WIDTH - 120],
    palette: [rgb("#f5c65b"), rgb("#ff9c36"), rgb("#fff1b4")],
    sizeRange: [18, 36],
    shapeFactory: ({ size, color }) => [shardGroup("Cascade Shard", size * 0.82, size * 1.18, color, rgb("#fff0b7"))],
  });
  layers.push(...shards);
  nextIndex += shards.length;

  const confetti = buildFallingLayers(nextIndex, {
    seed: 235,
    count: 16,
    startY: -80,
    endY: HEIGHT + 120,
    xRange: [100, WIDTH - 100],
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffffff")],
    sizeRange: [14, 28],
    shapeFactory: ({ size, color }) => [confettiGroup("Cascade Confetti", size * 0.9, size * 0.48, color, rgb("#ffffff"))],
  });
  layers.push(...confetti);
  nextIndex += confetti.length;

  const heroBalls = buildHeroBallRushLayers(nextIndex, [
    { startFrame: 8, radius: 88, color: rgb("#f5c65b"), digit: 1, from: [260, -180], mid: [520, 260], to: [680, 720], rotationEnd: 196 },
    { startFrame: 18, radius: 82, color: rgb("#ff6e2e"), digit: 7, from: [1660, -180], mid: [1400, 260], to: [1240, 700], rotationStart: 44, rotationEnd: -190 },
    { startFrame: 30, radius: 94, color: rgb("#7a44ff"), digit: 8, from: [960, -220], mid: [960, 240], to: [960, 780], rotationEnd: 154 },
  ]);
  layers.push(...heroBalls);
  nextIndex += heroBalls.length;

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 239,
    count: 18,
    center,
    minRadius: 90,
    maxRadius: 720,
    startFrame: 2,
    duration: 110,
    palette: [rgb("#fff1b4"), rgb("#ffffff"), rgb("#ff9c36")],
    sizeRange: [8, 18],
    shapeFactory: ({ size, color }) => [sparkleGroup("Cascade Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 24,
    scaleTo: 166,
    travelYScale: 0.8,
    rotationRange: [-180, 180],
  });
  layers.push(...sparks);

  return makeAnimation("Vegas Gold Cascade", layers);
};

const buildShowtimeBingoFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [960, 596];

  const beams = buildBeamLayers(nextIndex, {
    seed: 243,
    count: 16,
    xRange: [120, 1800],
    yBase: 706,
    palette: [rgb("#f5c65b"), rgb("#58c7ff"), rgb("#ff4fd8"), rgb("#8f5bff")],
    accentPalette: [rgb("#ffffff"), rgb("#fff1b4"), rgb("#dff5ff")],
    widthRange: [24, 74],
    heightRange: [360, 780],
    rotationRange: [-28, 28],
  });
  layers.push(...beams);
  nextIndex += beams.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 247,
    count: 6,
    center,
    radiusRange: [120, 320],
    widthRange: [12, 26],
    palette: [rgb("#f5c65b"), rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#8f5bff")],
    accentPalette: [rgb("#ffffff"), rgb("#fff1b4")],
    startFrame: 4,
    durationRange: [64, 104],
    scaleFrom: 18,
    scaleTo: 208,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const fireworks = buildFireworkDisplayLayers(nextIndex, [
    { center: [220, 220], start: 8, outer: 180, color: rgb("#58c7ff"), accent: rgb("#dff5ff"), rays: 18 },
    { center: [620, 274], start: 16, outer: 156, color: rgb("#ff4fd8"), accent: rgb("#ffd2ef"), rays: 18 },
    { center: [960, 166], start: 12, outer: 286, color: rgb("#f5c65b"), accent: rgb("#fff1b4"), rays: 26 },
    { center: [1320, 242], start: 22, outer: 188, color: rgb("#ff9c36"), accent: rgb("#ffe8c0"), rays: 18 },
    { center: [1708, 254], start: 30, outer: 192, color: rgb("#8f5bff"), accent: rgb("#e6dbff"), rays: 18 },
  ]);
  layers.push(...fireworks);
  nextIndex += fireworks.length;

  const heroBalls = buildHeroBallRushLayers(nextIndex, [
    { startFrame: 0, radius: 108, color: rgb("#2f86ff"), digit: 3, from: [-220, 760], mid: [380, 560], to: [1720, 260], rotationEnd: 288 },
    { startFrame: 8, radius: 112, color: rgb("#23bf66"), digit: 9, from: [2140, 760], mid: [1540, 560], to: [180, 250], rotationStart: 58, rotationEnd: -276 },
    { startFrame: 16, radius: 118, color: rgb("#7a44ff"), digit: 8, from: [960, 1180], mid: [960, 592], to: [960, 110], rotationEnd: 176 },
    { startFrame: 24, radius: 96, color: rgb("#ff6e2e"), digit: 7, from: [-180, 260], mid: [520, 380], to: [1840, 690], rotationEnd: 230 },
    { startFrame: 32, radius: 104, color: rgb("#f5c65b"), digit: 1, from: [2080, 280], mid: [1400, 400], to: [120, 710], rotationStart: 50, rotationEnd: -220 },
  ]);
  layers.push(...heroBalls);
  nextIndex += heroBalls.length;

  [
    { position: [520, 320], width: 340, height: 420, rotation: -14, start: 18, accent: rgb("#58c7ff") },
    { position: [1420, 300], width: 320, height: 440, rotation: 18, start: 28, accent: rgb("#8f5bff") },
    { position: [980, 614], width: 220, height: 300, rotation: 6, start: 40, accent: rgb("#58c7ff") },
  ].forEach((config, idx) => {
    layers.push(
      buildLayer({
        index: nextIndex + idx,
        name: `Showtime Lightning ${idx}`,
        shapes: [lightningGroup("Showtime Lightning", config.width, config.height, rgb("#d8ecff"), config.accent)],
        positionFrames: [{ t: 0, s: [config.position[0], config.position[1], 0] }],
        scaleFrames: [
          { t: config.start, s: [26, 26, 100] },
          { t: clampFrame(config.start + 12), s: [112, 112, 100] },
          { t: clampFrame(config.start + 26), s: [96, 96, 100] },
          { t: clampFrame(config.start + 44), s: [128, 128, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: config.start, s: [0] },
          { t: clampFrame(config.start + 6), s: [92] },
          { t: clampFrame(config.start + 16), s: [26] },
          { t: clampFrame(config.start + 24), s: [84] },
          { t: clampFrame(config.start + 44), s: [0] },
        ],
        rotationFrames: [{ t: 0, s: [config.rotation] }],
        inFrame: config.start,
        outFrame: clampFrame(config.start + 45) + 1,
      }),
    );
  });
  nextIndex += 3;

  const coins = buildRadialBurstLayers(nextIndex, {
    seed: 251,
    count: 16,
    center,
    minRadius: 240,
    maxRadius: 1020,
    startFrame: 6,
    duration: 128,
    palette: [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#ffb22d")],
    sizeRange: [22, 56],
    shapeFactory: ({ size, color }) => [coinGroup("Showtime Coin", size, color, rgb("#fff1b4"))],
    scaleFrom: 54,
    scaleTo: 148,
    travelYScale: 0.74,
    rotationRange: [-260, 260],
  });
  layers.push(...coins);
  nextIndex += coins.length;

  const confetti = buildFallingLayers(nextIndex, {
    seed: 255,
    count: 34,
    startY: -90,
    endY: HEIGHT + 130,
    xRange: [60, WIDTH - 60],
    palette: [rgb("#f5c65b"), rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#8f5bff"), rgb("#ff9c36")],
    sizeRange: [14, 34],
    shapeFactory: ({ size, color }) => [confettiGroup("Showtime Confetti", size * 0.9, size * 0.48, color, rgb("#ffffff"))],
  });
  layers.push(...confetti);
  nextIndex += confetti.length;

  const sparks = buildRadialBurstLayers(nextIndex, {
    seed: 259,
    count: 28,
    center,
    minRadius: 110,
    maxRadius: 900,
    startFrame: 4,
    duration: 124,
    palette: [rgb("#ffffff"), rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff4fd8"), rgb("#8f5bff")],
    sizeRange: [8, 20],
    shapeFactory: ({ size, color }) => [sparkleGroup("Showtime Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 184,
    travelYScale: 0.82,
    rotationRange: [-180, 180],
  });
  layers.push(...sparks);

  return makeAnimation("Showtime Bingo Finale", layers);
};

const buildPartyBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.54];
  const festivePalette = [rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffffff")];

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Party Glow Base",
      shapes: [
        group("Party Glow Magenta", [
          ellipseShape("Party Glow Magenta Path", 420, 420),
          fillNode("Party Glow Magenta Fill", rgb("#ff4fd8"), 14),
        ], {
          position: [-34, 20],
        }),
        group("Party Glow Cyan", [
          ellipseShape("Party Glow Cyan Path", 520, 520),
          fillNode("Party Glow Cyan Fill", rgb("#58c7ff"), 11),
        ], {
          position: [40, -22],
        }),
        group("Party Glow Gold", [
          ellipseShape("Party Glow Gold Path", 280, 280),
          fillNode("Party Glow Gold Fill", rgb("#fff1b4"), 12),
        ]),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 0, s: [58, 58, 100] },
        { t: 10, s: [132, 132, 100] },
        { t: 42, s: [118, 118, 100] },
        { t: 132, s: [106, 106, 100] },
        { t: 176, s: [96, 96, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 4, s: [0] },
        { t: 10, s: [78] },
        { t: 132, s: [62] },
        { t: 176, s: [0] },
      ],
      inFrame: 0,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  const burstConfetti = buildRadialBurstLayers(nextIndex, {
    seed: 701,
    count: 28,
    center,
    minRadius: 24,
    maxRadius: 440,
    startFrame: 0,
    duration: 82,
    palette: festivePalette,
    sizeRange: [18, 40],
    shapeFactory: ({ size, color, index }) =>
      index % 5 === 0
        ? [ribbonGroup("Party Burst Ribbon", size * 2.2, color, rgb("#ffffff"))]
        : [confettiGroup("Party Burst Confetti", size * 0.9, size * (index % 2 === 0 ? 0.56 : 0.38), color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 164,
    travelYScale: 0.68,
    rotationRange: [-220, 220],
  });
  layers.push(...burstConfetti);
  nextIndex += burstConfetti.length;

  const celebrationStreamers = buildRadialBurstLayers(nextIndex, {
    seed: 702,
    count: 12,
    center,
    minRadius: 36,
    maxRadius: 620,
    startFrame: 0,
    duration: 104,
    palette: [rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#f5c65b"), rgb("#ffffff")],
    sizeRange: [34, 68],
    shapeFactory: ({ size, color }) => [ribbonGroup("Party Streamer", size * 1.24, color, rgb("#fff1b4"))],
    scaleFrom: 14,
    scaleTo: 156,
    travelYScale: 0.62,
    rotationRange: [-200, 200],
  });
  layers.push(...celebrationStreamers);
  nextIndex += celebrationStreamers.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Left Party Horn",
      shapes: [partyHornGroup("Left Horn Shape", 280, rgb("#8f5bff"), rgb("#58c7ff"), rgb("#fff1b4"))],
      positionFrames: [
        { t: 10, s: [-280, 650, 0] },
        { t: 20, s: [516, 650, 0] },
        { t: 26, s: [394, 636, 0] },
        { t: 34, s: [438, 646, 0] },
      ],
      scaleFrames: [
        { t: 10, s: [72, 72, 100] },
        { t: 22, s: [118, 118, 100] },
        { t: 34, s: [100, 100, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 10, s: [0] },
        { t: 16, s: [100] },
        { t: 160, s: [100] },
        { t: 179, s: [0] },
      ],
      rotationFrames: [
        { t: 10, s: [-26] },
        { t: 22, s: [8] },
        { t: 34, s: [-8] },
        { t: 120, s: [-4] },
      ],
      inFrame: 10,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Right Party Horn",
      shapes: [partyHornGroup("Right Horn Shape", 280, rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#fff1b4"))],
      positionFrames: [
        { t: 10, s: [WIDTH + 280, 650, 0] },
        { t: 20, s: [WIDTH - 516, 650, 0] },
        { t: 26, s: [WIDTH - 394, 636, 0] },
        { t: 34, s: [WIDTH - 438, 646, 0] },
      ],
      scaleFrames: [
        { t: 10, s: [72, 72, 100] },
        { t: 22, s: [118, 118, 100] },
        { t: 34, s: [100, 100, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 10, s: [0] },
        { t: 16, s: [100] },
        { t: 160, s: [100] },
        { t: 179, s: [0] },
      ],
      rotationFrames: [
        { t: 10, s: [206] },
        { t: 22, s: [172] },
        { t: 34, s: [188] },
        { t: 120, s: [184] },
      ],
      inFrame: 10,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  const confettiRain = buildFallingLayers(nextIndex, {
    seed: 703,
    count: 34,
    startY: -120,
    endY: HEIGHT + 150,
    xRange: [90, WIDTH - 90],
    palette: [rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffffff")],
    sizeRange: [14, 30],
    shapeFactory: ({ size, color, index }) =>
      index % 6 === 0
        ? [ribbonGroup("Party Fall Ribbon", size * 1.45, color, rgb("#ffffff"))]
        : [confettiGroup("Party Fall Confetti", size * 0.92, size * (index % 2 === 0 ? 0.52 : 0.36), color, rgb("#ffffff"))],
  });
  layers.push(...confettiRain);
  nextIndex += confettiRain.length;

  const foregroundRibbons = buildFallingLayers(nextIndex, {
    seed: 704,
    count: 12,
    startY: -160,
    endY: HEIGHT + 180,
    xRange: [110, WIDTH - 110],
    palette: [rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#f5c65b")],
    sizeRange: [42, 76],
    shapeFactory: ({ size, color }) => [ribbonGroup("Party Foreground Ribbon", size * 1.3, color, rgb("#ffffff"))],
  });
  layers.push(...foregroundRibbons);
  nextIndex += foregroundRibbons.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Celebration Pulse",
      shapes: [
        ringGroup("Celebration Pulse Ring A", 220, rgb("#ff4fd8"), rgb("#fff1b4"), 14),
        ringGroup("Celebration Pulse Ring B", 330, rgb("#58c7ff"), rgb("#ffffff"), 10),
        sparkleGroup("Celebration Pulse Spark", 36, rgb("#ffffff"), rgb("#fff1b4")),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 34, s: [18, 18, 100] },
        { t: 46, s: [138, 138, 100] },
        { t: 60, s: [104, 104, 100] },
        { t: 112, s: [154, 154, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 34, s: [0] },
        { t: 40, s: [100] },
        { t: 62, s: [66] },
        { t: 112, s: [0] },
      ],
      inFrame: 34,
      outFrame: 113,
    }),
  );
  nextIndex += 1;

  const lingeringSparks = buildRadialBurstLayers(nextIndex, {
    seed: 705,
    count: 20,
    center,
    minRadius: 120,
    maxRadius: 760,
    startFrame: 22,
    duration: 146,
    palette: [rgb("#ffffff"), rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff4fd8")],
    sizeRange: [10, 18],
    shapeFactory: ({ size, color }) => [sparkleGroup("Party Lingering Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 148,
    travelYScale: 0.78,
    rotationRange: [-180, 180],
  });
  layers.push(...lingeringSparks);

  return makeAnimation("Party Blast", layers);
};

const buildFullscreenFestival = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.56];
  const palette = [rgb("#8f5bff"), rgb("#f5c65b"), rgb("#58c7ff"), rgb("#ff9fdb"), rgb("#ffffff")];

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Festival Glow Base",
      shapes: [
        group("Festival Glow Purple", [
          ellipseShape("Festival Glow Purple Path", 560, 360),
          fillNode("Festival Glow Purple Fill", rgb("#8f5bff"), 12),
        ]),
        group("Festival Glow Cyan", [
          ellipseShape("Festival Glow Cyan Path", 460, 320),
          fillNode("Festival Glow Cyan Fill", rgb("#58c7ff"), 10),
        ], {
          position: [54, -18],
        }),
        group("Festival Glow Gold", [
          ellipseShape("Festival Glow Gold Path", 320, 240),
          fillNode("Festival Glow Gold Fill", rgb("#fff1b4"), 10),
        ], {
          position: [-36, 24],
        }),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 0, s: [54, 54, 100] },
        { t: 12, s: [116, 116, 100] },
        { t: 44, s: [110, 110, 100] },
        { t: 132, s: [98, 98, 100] },
        { t: 176, s: [90, 90, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 4, s: [0] },
        { t: 10, s: [74] },
        { t: 150, s: [62] },
        { t: 176, s: [0] },
      ],
      inFrame: 0,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  const ribbonSweeps = [
    {
      name: "Festival Sweep A",
      start: 0,
      length: 268,
      from: [-420, 254],
      mid: [824, 328],
      to: [WIDTH + 380, 230],
      rotation: [-10, 8, 18],
      color: rgb("#8f5bff"),
      accent: rgb("#ffffff"),
    },
    {
      name: "Festival Sweep B",
      start: 2,
      length: 236,
      from: [WIDTH + 340, 412],
      mid: [1086, 456],
      to: [-360, 380],
      rotation: [188, 176, 164],
      color: rgb("#58c7ff"),
      accent: rgb("#fff1b4"),
    },
    {
      name: "Festival Sweep C",
      start: 4,
      length: 252,
      from: [-360, 666],
      mid: [760, 624],
      to: [WIDTH + 420, 742],
      rotation: [12, -6, -18],
      color: rgb("#f5c65b"),
      accent: rgb("#ffffff"),
    },
    {
      name: "Festival Sweep D",
      start: 8,
      length: 228,
      from: [WIDTH + 360, 792],
      mid: [1160, 700],
      to: [-340, 760],
      rotation: [196, 184, 168],
      color: rgb("#ff9fdb"),
      accent: rgb("#58c7ff"),
    },
  ];

  for (const sweep of ribbonSweeps) {
    layers.push(
      buildLayer({
        index: nextIndex,
        name: sweep.name,
        shapes: [ribbonGroup(`${sweep.name} Shape`, sweep.length, sweep.color, sweep.accent)],
        positionFrames: [
          { t: sweep.start, s: [sweep.from[0], sweep.from[1], 0] },
          { t: clampFrame(sweep.start + 16), s: [sweep.mid[0], sweep.mid[1], 0] },
          { t: clampFrame(sweep.start + 74), s: [sweep.to[0], sweep.to[1], 0] },
        ],
        scaleFrames: [
          { t: sweep.start, s: [74, 74, 100] },
          { t: clampFrame(sweep.start + 14), s: [122, 122, 100] },
          { t: clampFrame(sweep.start + 30), s: [104, 104, 100] },
          { t: clampFrame(sweep.start + 74), s: [92, 92, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: sweep.start, s: [0] },
          { t: clampFrame(sweep.start + 4), s: [98] },
          { t: clampFrame(sweep.start + 42), s: [82] },
          { t: clampFrame(sweep.start + 74), s: [0] },
        ],
        rotationFrames: [
          { t: sweep.start, s: [sweep.rotation[0]] },
          { t: clampFrame(sweep.start + 16), s: [sweep.rotation[1]] },
          { t: clampFrame(sweep.start + 74), s: [sweep.rotation[2]] },
        ],
        inFrame: sweep.start,
        outFrame: clampFrame(sweep.start + 75) + 1,
      }),
    );
    nextIndex += 1;
  }

  const leftConfettiWave = buildRadialBurstLayers(nextIndex, {
    seed: 811,
    count: 18,
    center: [150, HEIGHT * 0.54],
    minRadius: 120,
    maxRadius: 760,
    startFrame: 8,
    duration: 94,
    palette,
    sizeRange: [16, 34],
    shapeFactory: ({ size, color, index }) =>
      index % 4 === 0
        ? [ribbonGroup("Festival Side Ribbon", size * 1.38, color, rgb("#ffffff"))]
        : [confettiGroup("Festival Side Confetti", size * 0.92, size * (index % 2 === 0 ? 0.56 : 0.38), color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 142,
    travelYScale: 0.26,
    rotationRange: [-120, 120],
  });
  layers.push(...leftConfettiWave);
  nextIndex += leftConfettiWave.length;

  const rightConfettiWave = buildRadialBurstLayers(nextIndex, {
    seed: 812,
    count: 18,
    center: [WIDTH - 150, HEIGHT * 0.54],
    minRadius: 120,
    maxRadius: 760,
    startFrame: 8,
    duration: 94,
    palette,
    sizeRange: [16, 34],
    shapeFactory: ({ size, color, index }) =>
      index % 4 === 0
        ? [ribbonGroup("Festival Side Ribbon", size * 1.38, color, rgb("#ffffff"))]
        : [confettiGroup("Festival Side Confetti", size * 0.92, size * (index % 2 === 0 ? 0.56 : 0.38), color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 142,
    travelYScale: 0.26,
    rotationRange: [-120, 120],
  });
  layers.push(...rightConfettiWave);
  nextIndex += rightConfettiWave.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Festival Left Horn",
      shapes: [partyHornGroup("Festival Left Horn Shape", 246, rgb("#8f5bff"), rgb("#58c7ff"), rgb("#fff1b4"))],
      positionFrames: [
        { t: 18, s: [-220, 690, 0] },
        { t: 28, s: [420, 690, 0] },
        { t: 34, s: [332, 678, 0] },
        { t: 42, s: [366, 686, 0] },
      ],
      scaleFrames: [
        { t: 18, s: [72, 72, 100] },
        { t: 30, s: [120, 120, 100] },
        { t: 42, s: [100, 100, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 18, s: [0] },
        { t: 24, s: [100] },
        { t: 156, s: [100] },
        { t: 179, s: [0] },
      ],
      rotationFrames: [
        { t: 18, s: [-24] },
        { t: 30, s: [4] },
        { t: 42, s: [-10] },
        { t: 120, s: [-6] },
      ],
      inFrame: 18,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Festival Right Horn",
      shapes: [partyHornGroup("Festival Right Horn Shape", 246, rgb("#ff9fdb"), rgb("#58c7ff"), rgb("#fff1b4"))],
      positionFrames: [
        { t: 18, s: [WIDTH + 220, 690, 0] },
        { t: 28, s: [WIDTH - 420, 690, 0] },
        { t: 34, s: [WIDTH - 332, 678, 0] },
        { t: 42, s: [WIDTH - 366, 686, 0] },
      ],
      scaleFrames: [
        { t: 18, s: [72, 72, 100] },
        { t: 30, s: [120, 120, 100] },
        { t: 42, s: [100, 100, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 18, s: [0] },
        { t: 24, s: [100] },
        { t: 156, s: [100] },
        { t: 179, s: [0] },
      ],
      rotationFrames: [
        { t: 18, s: [204] },
        { t: 30, s: [176] },
        { t: 42, s: [190] },
        { t: 120, s: [184] },
      ],
      inFrame: 18,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  const glowPulseStreaks = buildRadialBurstLayers(nextIndex, {
    seed: 813,
    count: 14,
    center,
    minRadius: 60,
    maxRadius: 520,
    startFrame: 28,
    duration: 92,
    palette: [rgb("#58c7ff"), rgb("#fff1b4"), rgb("#ff9fdb"), rgb("#8f5bff")],
    sizeRange: [22, 48],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Festival Glow Streak",
        [[0, 0], [size * 3.5, 0]],
        color,
        Math.max(6, size * 0.22),
        rgb("#ffffff"),
        Math.max(1.8, size * 0.08),
        24,
        92,
      ),
    ],
    scaleFrom: 18,
    scaleTo: 138,
    travelYScale: 0.68,
    rotationRange: [-180, 180],
  });
  layers.push(...glowPulseStreaks);
  nextIndex += glowPulseStreaks.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Festival Center Pulse",
      shapes: [
        ringGroup("Festival Center Ring A", 190, rgb("#8f5bff"), rgb("#ffffff"), 12),
        ringGroup("Festival Center Ring B", 286, rgb("#58c7ff"), rgb("#fff1b4"), 10),
        sparkleGroup("Festival Center Spark", 32, rgb("#ffffff"), rgb("#fff1b4")),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 28, s: [18, 18, 100] },
        { t: 40, s: [132, 132, 100] },
        { t: 54, s: [102, 102, 100] },
        { t: 106, s: [146, 146, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 28, s: [0] },
        { t: 34, s: [98] },
        { t: 58, s: [68] },
        { t: 106, s: [0] },
      ],
      inFrame: 28,
      outFrame: 107,
    }),
  );
  nextIndex += 1;

  const festivalSparkles = buildRadialBurstLayers(nextIndex, {
    seed: 814,
    count: 18,
    center,
    minRadius: 110,
    maxRadius: 780,
    startFrame: 30,
    duration: 140,
    palette: [rgb("#ffffff"), rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff9fdb")],
    sizeRange: [10, 18],
    shapeFactory: ({ size, color }) => [sparkleGroup("Festival Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 146,
    travelYScale: 0.76,
    rotationRange: [-180, 180],
  });
  layers.push(...festivalSparkles);
  nextIndex += festivalSparkles.length;

  const lingeringConfetti = buildFallingLayers(nextIndex, {
    seed: 815,
    count: 22,
    startY: -120,
    endY: HEIGHT + 160,
    xRange: [100, WIDTH - 100],
    palette,
    sizeRange: [14, 26],
    shapeFactory: ({ size, color }) => [confettiGroup("Festival Lingering Confetti", size * 0.9, size * 0.46, color, rgb("#ffffff"))],
  });
  layers.push(...lingeringConfetti);

  return makeAnimation("Fullscreen Festival", layers);
};

const buildExplodingBingoBalls = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.53];
  const ballPalette = [
    { color: rgb("#f5c65b"), digit: 1 },
    { color: rgb("#2f86ff"), digit: 3 },
    { color: rgb("#ff6548"), digit: 7 },
    { color: rgb("#7a44ff"), digit: 8 },
    { color: rgb("#23bf66"), digit: 9 },
  ];

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Bingo Core Glow",
      shapes: [
        group("Bingo Gold Glow", [
          ellipseShape("Bingo Gold Glow Path", 240, 240),
          fillNode("Bingo Gold Glow Fill", rgb("#f5c65b"), 16),
        ]),
        group("Bingo Blue Glow", [
          ellipseShape("Bingo Blue Glow Path", 260, 260),
          fillNode("Bingo Blue Glow Fill", rgb("#58c7ff"), 6),
        ], {
          position: [18, -18],
        }),
        group("Bingo White Hotspot", [
          ellipseShape("Bingo White Hotspot Path", 136, 136),
          fillNode("Bingo White Hotspot Fill", rgb("#ffffff"), 14),
        ]),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 0, s: [78, 78, 100] },
        { t: 8, s: [58, 58, 100] },
        { t: 18, s: [126, 126, 100] },
        { t: 48, s: [98, 98, 100] },
        { t: 160, s: [90, 90, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 2, s: [82] },
        { t: 20, s: [94] },
        { t: 136, s: [44] },
        { t: 179, s: [0] },
      ],
      inFrame: 0,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  const clusterConfigs = [
    { offset: [-64, -28], target: [-380, -176], radius: 64, ball: ballPalette[1], rotation: [-16, 18, 172] },
    { offset: [-12, -62], target: [-102, -282], radius: 58, ball: ballPalette[0], rotation: [-8, 18, 154] },
    { offset: [50, -36], target: [248, -236], radius: 62, ball: ballPalette[2], rotation: [14, -12, 168] },
    { offset: [72, 12], target: [418, -36], radius: 68, ball: ballPalette[3], rotation: [18, -8, 184] },
    { offset: [14, 64], target: [40, 250], radius: 66, ball: ballPalette[4], rotation: [0, 14, 162] },
    { offset: [-58, 44], target: [-334, 108], radius: 60, ball: ballPalette[0], rotation: [-14, 8, 168] },
  ];

  for (const [index, config] of clusterConfigs.entries()) {
    const start = [center[0] + config.offset[0], center[1] + config.offset[1], 0];
    const compressed = [center[0] + (config.offset[0] * 0.3), center[1] + (config.offset[1] * 0.3), 0];
    const burst = [center[0] + config.target[0], center[1] + config.target[1], 0];
    const settle = [center[0] + (config.target[0] * 0.92), center[1] + (config.target[1] * 0.92), 0];

    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Bingo Cluster Ball ${index + 1}`,
        shapes: [bingoBallGroup("Bingo Cluster Ball Shape", config.radius, config.ball.color, config.ball.digit)],
        positionFrames: [
          { t: 0, s: start },
          { t: 8, s: compressed },
          { t: 20, s: burst },
          { t: 42, s: settle },
        ],
        scaleFrames: [
          { t: 0, s: [98, 98, 100] },
          { t: 8, s: [74, 74, 100] },
          { t: 20, s: [138, 138, 100] },
          { t: 34, s: [102, 102, 100] },
          { t: 42, s: [108, 108, 100] },
          { t: 150, s: [104, 104, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [100] },
          { t: 132, s: [100] },
          { t: 168, s: [38] },
          { t: 179, s: [0] },
        ],
        rotationFrames: [
          { t: 0, s: [config.rotation[0]] },
          { t: 8, s: [config.rotation[1]] },
          { t: 20, s: [config.rotation[2]] },
          { t: 42, s: [config.rotation[2] + 42] },
        ],
        inFrame: 0,
        outFrame: DURATION_FRAMES,
      }),
    );
    nextIndex += 1;
  }

  const impactStreaks = buildRadialBurstLayers(nextIndex, {
    seed: 901,
    count: 8,
    center,
    minRadius: 70,
    maxRadius: 420,
    startFrame: 10,
    duration: 72,
    palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#58c7ff"), rgb("#ff6548")],
    sizeRange: [20, 34],
    shapeFactory: ({ size, color }) => [
      lineStrokeGroup(
        "Bingo Impact Streak",
        [[0, 0], [size * 3.2, 0]],
        color,
        Math.max(5, size * 0.18),
        rgb("#ffffff"),
        Math.max(1.6, size * 0.06),
        24,
        92,
      ),
    ],
    scaleFrom: 18,
    scaleTo: 134,
    travelYScale: 0.72,
    rotationRange: [-180, 180],
  });
  layers.push(...impactStreaks);
  nextIndex += impactStreaks.length;

  const shockwaves = buildRingPulseLayers(nextIndex, {
    seed: 902,
    count: 2,
    center,
    radiusRange: [156, 264],
    widthRange: [10, 16],
    palette: [rgb("#f5c65b"), rgb("#fff1b4")],
    accentPalette: [rgb("#ffffff")],
    startFrame: 12,
    durationRange: [48, 70],
    scaleFrom: 24,
    scaleTo: 176,
  });
  layers.push(...shockwaves);
  nextIndex += shockwaves.length;

  const heroBallRush = buildHeroBallRushLayers(nextIndex, [
    {
      startFrame: 24,
      from: [center[0] - 24, center[1] + 18],
      mid: [398, 372],
      to: [-198, 288],
      radius: 84,
      color: rgb("#2f86ff"),
      digit: 3,
      rotationStart: -36,
      rotationMid: 124,
      rotationEnd: 248,
      endFrame: 122,
    },
    {
      startFrame: 26,
      from: [center[0] + 20, center[1] - 8],
      mid: [1498, 320],
      to: [WIDTH + 212, 228],
      radius: 88,
      color: rgb("#ff6548"),
      digit: 7,
      rotationStart: 24,
      rotationMid: -96,
      rotationEnd: -218,
      endFrame: 126,
    },
    {
      startFrame: 30,
      from: [center[0] + 2, center[1] + 34],
      mid: [1002, 790],
      to: [1044, HEIGHT + 182],
      radius: 94,
      color: rgb("#f5c65b"),
      digit: 1,
      rotationStart: -12,
      rotationMid: 88,
      rotationEnd: 204,
      endFrame: 132,
    },
  ]);
  layers.push(...heroBallRush);
  nextIndex += heroBallRush.length;

  const jackpotSparkles = buildRadialBurstLayers(nextIndex, {
    seed: 903,
    count: 12,
    center,
    minRadius: 92,
    maxRadius: 220,
    startFrame: 20,
    duration: 104,
    palette: [rgb("#ffffff"), rgb("#fff1b4"), rgb("#f5c65b"), rgb("#58c7ff")],
    sizeRange: [10, 16],
    shapeFactory: ({ size, color }) => [sparkleGroup("Bingo Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 110,
    travelYScale: 0.76,
    rotationRange: [-180, 180],
  });
  layers.push(...jackpotSparkles);
  nextIndex += jackpotSparkles.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Bingo Afterglow",
      shapes: [
        group("Bingo Afterglow Gold", [
          ellipseShape("Bingo Afterglow Gold Path", 360, 360),
          fillNode("Bingo Afterglow Gold Fill", rgb("#f5c65b"), 8),
        ]),
        group("Bingo Afterglow White", [
          ellipseShape("Bingo Afterglow White Path", 180, 180),
          fillNode("Bingo Afterglow White Fill", rgb("#ffffff"), 6),
        ]),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 44, s: [92, 92, 100] },
        { t: 92, s: [104, 104, 100] },
        { t: 154, s: [114, 114, 100] },
        { t: 179, s: [122, 122, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 40, s: [24] },
        { t: 118, s: [16] },
        { t: 179, s: [0] },
      ],
      inFrame: 40,
      outFrame: DURATION_FRAMES,
    }),
  );

  return makeAnimation("Exploding Bingo Balls", layers);
};

const effects = [
  { output: "trh-full-party-blast.json", build: buildPartyBlast, decorate: false },
  { output: "trh-full-fullscreen-festival.json", build: buildFullscreenFestival, decorate: false },
  { output: "trh-full-exploding-bingo-balls.json", build: buildExplodingBingoBalls, decorate: false },
];

export const regenerateFullscreenLotties = async (rootDir) => {
  const targetDir = path.join(rootDir, "public", "winks", "fullscreen");
  await fs.mkdir(targetDir, { recursive: true });

  for (const effect of effects) {
    const animation = effect.decorate === false
      ? effect.build()
      : decoratePremiumFullscreenAnimation(effect.build(), effect.output);
    await fs.writeFile(path.join(targetDir, effect.output), `${JSON.stringify(animation)}\n`, "utf8");
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  regenerateFullscreenLotties(process.cwd());
}
