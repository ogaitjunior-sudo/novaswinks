import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1920;
const HEIGHT = 1024;
const FRAME_RATE = 30;
const DURATION_FRAMES = 180;
const LAST_FRAME = DURATION_FRAMES - 1;
const TARGET_WINK_FRAMES = 300;

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

const bingoLetterBallGroup = (name, radius, accentColor) =>
  group(name, [
    group("Letter Ball Glow", [
      ellipseShape("Letter Ball Glow Path", radius * 2.32, radius * 2.32),
      fillNode("Letter Ball Glow Fill", accentColor, 12),
    ]),
    group("Letter Ball Base", [
      ellipseShape("Letter Ball Base Path", radius * 2, radius * 2),
      fillNode("Letter Ball Base Fill", rgb("#ffffff"), 96),
    ]),
    group("Letter Ball Edge Tint", [
      ellipseShape("Letter Ball Edge Tint Path", radius * 1.9, radius * 1.9),
      strokeNode("Letter Ball Edge Tint Stroke", accentColor, Math.max(6, radius * 0.12), 82),
    ]),
    group("Letter Ball Inner Disc", [
      ellipseShape("Letter Ball Inner Disc Path", radius * 0.98, radius * 0.98),
      fillNode("Letter Ball Inner Disc Fill", rgb("#fff7d7"), 94),
      strokeNode("Letter Ball Inner Disc Stroke", accentColor, Math.max(4, radius * 0.075), 58),
    ]),
    group("Letter Ball Shine", [
      ellipseShape("Letter Ball Shine Path", radius * 0.52, radius * 0.28),
      fillNode("Letter Ball Shine Fill", rgb("#ffffff"), 30),
    ], {
      position: [-(radius * 0.25), -(radius * 0.34)],
      rotation: -20,
    }),
    group("Letter Ball Spec Arc", [
      pathShape("Letter Ball Spec Arc Path", [[-(radius * 0.48), -(radius * 0.12)], [radius * 0.02, -(radius * 0.4)], [radius * 0.48, -(radius * 0.16)]], false),
      strokeNode("Letter Ball Spec Arc Stroke", rgb("#ffffff"), Math.max(3, radius * 0.055), 32),
    ]),
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

const teardropPoints = (width, height) => [
  [0, -(height * 0.5)],
  [width * 0.24, -(height * 0.14)],
  [width * 0.2, height * 0.18],
  [0, height * 0.5],
  [-(width * 0.2), height * 0.18],
  [-(width * 0.24), -(height * 0.14)],
];

const balloonGroup = (name, radius, bodyColor, accentColor, stringColor = rgb("#ffffff")) =>
  group(name, [
    group("Balloon Glow", [
      ellipseShape("Balloon Glow Path", radius * 2.36, radius * 2.7),
      fillNode("Balloon Glow Fill", accentColor, 10),
    ], {
      position: [0, -(radius * 0.08)],
    }),
    group("Balloon Body", [
      ellipseShape("Balloon Body Path", radius * 2, radius * 2.28),
      fillNode("Balloon Body Fill", bodyColor, 96),
    ], {
      position: [0, -(radius * 0.06)],
    }),
    group("Balloon Shine", [
      ellipseShape("Balloon Shine Path", radius * 0.48, radius * 0.74),
      fillNode("Balloon Shine Fill", rgb("#ffffff"), 22),
    ], {
      position: [-(radius * 0.28), -(radius * 0.44)],
      rotation: -18,
    }),
    group("Balloon Rim", [
      ellipseShape("Balloon Rim Path", radius * 1.82, radius * 2.08),
      strokeNode("Balloon Rim Stroke", rgb("#ffffff"), Math.max(4, radius * 0.08), 34),
    ], {
      position: [0, -(radius * 0.06)],
    }),
    group("Balloon Knot", [
      pathShape("Balloon Knot Path", diamondPoints(radius * 0.22, radius * 0.3), true),
      fillNode("Balloon Knot Fill", accentColor, 88),
    ], {
      position: [0, radius * 1.08],
    }),
    lineStrokeGroup(
      "Balloon String",
      [
        [0, radius * 1.16],
        [-(radius * 0.08), radius * 1.56],
        [radius * 0.06, radius * 1.92],
      ],
      accentColor,
      Math.max(5, radius * 0.12),
      stringColor,
      Math.max(1.8, radius * 0.04),
      18,
      84,
    ),
  ]);

const candleGroup = (name, height, bodyColor, stripeColor, flameColor, accentColor) => {
  const width = height * 0.18;
  return group(name, [
    group("Candle Glow", [
      ellipseShape("Candle Glow Path", width * 3.4, height * 1.42),
      fillNode("Candle Glow Fill", accentColor, 10),
    ], {
      position: [0, -(height * 0.56)],
    }),
    group("Candle Body", [
      rectShape("Candle Body Path", width, height, Math.max(5, width * 0.3)),
      fillNode("Candle Body Fill", bodyColor, 96),
    ]),
    group("Stripe A", [
      rectShape("Stripe A Path", width * 0.2, height * 0.88, Math.max(3, width * 0.1)),
      fillNode("Stripe A Fill", stripeColor, 84),
    ], {
      position: [-(width * 0.16), 0],
      rotation: -8,
    }),
    group("Stripe B", [
      rectShape("Stripe B Path", width * 0.18, height * 0.84, Math.max(3, width * 0.1)),
      fillNode("Stripe B Fill", stripeColor, 72),
    ], {
      position: [width * 0.1, 0],
      rotation: -8,
    }),
    lineStrokeGroup(
      "Wick",
      [[0, -(height * 0.52)], [0, -(height * 0.66)]],
      accentColor,
      Math.max(4, width * 0.2),
      rgb("#6f4120"),
      Math.max(1.2, width * 0.08),
      14,
      88,
    ),
    group("Flame Glow", [
      ellipseShape("Flame Glow Path", width * 2.2, height * 0.68),
      fillNode("Flame Glow Fill", accentColor, 18),
    ], {
      position: [0, -(height * 0.82)],
    }),
    group("Flame Body", [
      pathShape("Flame Body Path", teardropPoints(width * 0.72, height * 0.42), true),
      fillNode("Flame Body Fill", flameColor, 96),
    ], {
      position: [0, -(height * 0.82)],
    }),
    group("Flame Core", [
      pathShape("Flame Core Path", teardropPoints(width * 0.34, height * 0.22), true),
      fillNode("Flame Core Fill", rgb("#ffffff"), 42),
    ], {
      position: [0, -(height * 0.8)],
    }),
  ]);
};

const birthdayCakeGroup = (name, colors) =>
  group(name, [
    group("Cake Glow", [
      ellipseShape("Cake Glow Path", 520, 250),
      fillNode("Cake Glow Fill", colors.accent, 10),
    ], {
      position: [0, 22],
    }),
    group("Cake Plate Glow", [
      ellipseShape("Cake Plate Glow Path", 520, 84),
      fillNode("Cake Plate Glow Fill", colors.plateAccent, 12),
    ], {
      position: [0, 170],
    }),
    group("Cake Plate", [
      ellipseShape("Cake Plate Path", 460, 62),
      fillNode("Cake Plate Fill", colors.plate, 96),
    ], {
      position: [0, 168],
    }),
    group("Cake Plate Rim", [
      ellipseShape("Cake Plate Rim Path", 360, 24),
      fillNode("Cake Plate Rim Fill", rgb("#ffffff"), 22),
    ], {
      position: [0, 154],
    }),
    group("Lower Cake Body", [
      rectShape("Lower Cake Body Path", 410, 146, 28),
      fillNode("Lower Cake Body Fill", colors.base, 96),
    ], {
      position: [0, 74],
    }),
    group("Lower Cake Sheen", [
      rectShape("Lower Cake Sheen Path", 104, 126, 26),
      fillNode("Lower Cake Sheen Fill", rgb("#ffffff"), 12),
    ], {
      position: [-108, 54],
      rotation: -6,
    }),
    group("Lower Icing", [
      pathShape("Lower Icing Path", [
        [-205, -16],
        [-150, -18],
        [-118, 12],
        [-74, -14],
        [-18, 18],
        [34, -12],
        [92, 16],
        [148, -14],
        [205, -18],
        [205, 42],
        [-205, 42],
      ], true),
      fillNode("Lower Icing Fill", colors.icing, 96),
    ], {
      position: [0, 10],
    }),
    group("Upper Cake Body", [
      rectShape("Upper Cake Body Path", 286, 112, 24),
      fillNode("Upper Cake Body Fill", colors.baseSecondary, 96),
    ], {
      position: [0, -34],
    }),
    group("Upper Cake Sheen", [
      rectShape("Upper Cake Sheen Path", 78, 88, 18),
      fillNode("Upper Cake Sheen Fill", rgb("#ffffff"), 12),
    ], {
      position: [-66, -42],
      rotation: -8,
    }),
    group("Upper Icing", [
      pathShape("Upper Icing Path", [
        [-144, -12],
        [-108, -14],
        [-78, 10],
        [-42, -8],
        [-8, 14],
        [28, -10],
        [72, 12],
        [110, -10],
        [144, -12],
        [144, 32],
        [-144, 32],
      ], true),
      fillNode("Upper Icing Fill", colors.icingWarm, 96),
    ], {
      position: [0, -86],
    }),
    group("Cake Top", [
      ellipseShape("Cake Top Path", 206, 34),
      fillNode("Cake Top Fill", colors.icingWarm, 94),
    ], {
      position: [0, -110],
    }),
  ]);

const birthdayHbdAccentGroup = (name, color, accent) =>
  group(name, [
    group("Letter H", [
      lineStrokeGroup("H Left", [[-22, -28], [-22, 28]], accent, 18, color, 8, 18, 94),
      lineStrokeGroup("H Right", [[22, -28], [22, 28]], accent, 18, color, 8, 18, 94),
      lineStrokeGroup("H Cross", [[-20, 0], [20, 0]], accent, 16, color, 7, 16, 92),
    ], {
      position: [-128, 0],
    }),
    group("Letter B", [
      lineStrokeGroup("B Stem", [[-24, -30], [-24, 30]], accent, 18, color, 8, 18, 94),
      lineStrokeGroup("B Top", [[-20, -28], [12, -28], [20, -18], [20, -6], [12, 0], [-20, 0]], accent, 16, color, 7, 16, 92),
      lineStrokeGroup("B Bottom", [[-20, 0], [12, 0], [22, 10], [22, 24], [10, 30], [-20, 30]], accent, 16, color, 7, 16, 92),
    ]),
    group("Letter D", [
      lineStrokeGroup("D Stem", [[-24, -30], [-24, 30]], accent, 18, color, 8, 18, 94),
      lineStrokeGroup("D Curve", [[-18, -28], [10, -28], [22, -14], [22, 14], [10, 30], [-18, 30]], accent, 16, color, 7, 16, 92),
    ], {
      position: [128, 0],
    }),
    group("Accent Spark", [
      ellipseShape("Accent Spark Path", 18, 18),
      fillNode("Accent Spark Fill", rgb("#ffffff"), 84),
    ], {
      position: [212, -34],
    }),
  ]);

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

const buildTextLayer = ({
  index,
  name,
  text,
  fontSize,
  fillColor = rgb("#ffffff"),
  strokeColor = rgb("#f5c65b"),
  strokeWidth = 6,
  positionFrames,
  scaleFrames,
  opacityFrames,
  rotationFrames,
  inFrame = 0,
  outFrame = DURATION_FRAMES,
}) => ({
  ddd: 0,
  ind: index,
  ty: 5,
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
  t: {
    d: {
      k: [
        {
          s: {
            sz: [WIDTH, fontSize * 1.3],
            ps: [-WIDTH / 2, -(fontSize * 0.66)],
            s: fontSize,
            f: "Arial-BoldMT",
            t: text,
            j: 2,
            tr: -10,
            lh: fontSize * 1.08,
            fc: fillColor.slice(0, 3),
            sc: strokeColor.slice(0, 3),
            sw: strokeWidth,
            of: true,
          },
          t: 0,
        },
      ],
    },
    p: {},
    m: {
      g: 1,
      a: { a: 0, k: [0, 0] },
    },
    a: [],
  },
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
  fonts: {
    list: [
      {
        fName: "Arial-BoldMT",
        fFamily: "Arial",
        fStyle: "Bold",
        ascent: 75,
      },
    ],
  },
  layers,
});

const retimeFrame = (frame, targetFrames = TARGET_WINK_FRAMES) => {
  const normalized = Math.max(0, Math.min(DURATION_FRAMES, frame)) / DURATION_FRAMES;
  return Number((normalized * targetFrames).toFixed(3));
};

const retimeAnimatedProperty = (property, targetFrames = TARGET_WINK_FRAMES) => {
  if (!property || property.a !== 1 || !Array.isArray(property.k)) {
    return property;
  }

  return {
    ...property,
    k: property.k.map((keyframe) => ({
      ...keyframe,
      t: retimeFrame(keyframe.t ?? 0, targetFrames),
    })),
  };
};

const retimeFullscreenWink = (animation, targetFrames = TARGET_WINK_FRAMES) => ({
  ...animation,
  ip: 0,
  op: targetFrames,
  layers: (animation.layers ?? []).map((layer) => ({
    ...layer,
    ip: Math.max(0, retimeFrame(layer.ip ?? 0, targetFrames)),
    op: Math.max(
      Math.max(1, retimeFrame((layer.ip ?? 0) + 1, targetFrames)),
      retimeFrame(layer.op ?? DURATION_FRAMES, targetFrames),
    ),
    ks: layer.ks
      ? Object.fromEntries(
        Object.entries(layer.ks).map(([key, property]) => [key, retimeAnimatedProperty(property, targetFrames)]),
      )
      : layer.ks,
  })),
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
  nextIndex += 1;

  nextIndex = addBingoHeroLayer(layers, nextIndex, {
    start: 58,
    peak: 92,
    end: 166,
    color: countdownPalette.goldLight,
    accent: countdownPalette.gold,
    fontSize: 270,
    strokeWidth: 10,
  });

  return makeAnimation("Exploding Bingo Balls", layers);
};

const fullscreenBingoBallPalette = [
  { color: rgb("#f5c65b"), digit: 1 },
  { color: rgb("#2f86ff"), digit: 3 },
  { color: rgb("#ff6548"), digit: 7 },
  { color: rgb("#7a44ff"), digit: 8 },
  { color: rgb("#23bf66"), digit: 9 },
  { color: rgb("#ff4fd8"), digit: 6 },
];

const buildBingoBallsGlowLayer = (index, name, color = rgb("#f5c65b"), center = [WIDTH / 2, HEIGHT * 0.52]) =>
  buildLayer({
    index,
    name,
    shapes: [
      group("Bingo Balls Glow Field", [
        ellipseShape("Gold Glow", 900, 420),
        fillNode("Gold Glow Fill", color, 9),
      ]),
      group("Bingo Balls Core Flash", [
        ellipseShape("White Core", 260, 140),
        fillNode("White Core Fill", rgb("#ffffff"), 10),
      ]),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [
      { t: 0, s: [20, 20, 100] },
      { t: 68, s: [112, 112, 100] },
      { t: 112, s: [116, 116, 100] },
      { t: 179, s: [134, 134, 100] },
    ],
    opacityFrames: [
      { t: 0, s: [0] },
      { t: 18, s: [58] },
      { t: 82, s: [78] },
      { t: 135, s: [34] },
      { t: 179, s: [0] },
    ],
  });

const buildBingoBallMotionLayers = (startIndex, configs) => {
  const layers = [];
  for (const [index, config] of configs.entries()) {
    const startFrame = config.startFrame ?? 0;
    const impactFrame = config.impactFrame ?? 68;
    const holdFrame = config.holdFrame ?? 112;
    const endFrame = config.endFrame ?? 179;
    const ball = config.ball ?? fullscreenBingoBallPalette[index % fullscreenBingoBallPalette.length];
    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Fullscreen Bingo Ball ${index + 1}`,
      shapes: [bingoBallGroup("Fullscreen Bingo Ball Shape", config.radius, ball.color, ball.digit)],
      positionFrames: [
        { t: startFrame, s: [config.from[0], config.from[1], 0] },
        { t: impactFrame, s: [config.mid[0], config.mid[1], 0] },
        { t: holdFrame, s: [config.hold[0], config.hold[1], 0] },
        { t: endFrame, s: [config.to[0], config.to[1], 0] },
      ],
      scaleFrames: [
        { t: startFrame, s: [42, 42, 100] },
        { t: clampFrame(impactFrame + 8), s: [132, 132, 100] },
        { t: holdFrame, s: [104, 104, 100] },
        { t: endFrame, s: [82, 82, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: startFrame, s: [0] },
        { t: clampFrame(startFrame + 8), s: [100] },
        { t: clampFrame(endFrame - 18), s: [88] },
        { t: endFrame, s: [0] },
      ],
      rotationFrames: [
        { t: startFrame, s: [config.rotationStart ?? 0] },
        { t: impactFrame, s: [config.rotationMid ?? 120] },
        { t: endFrame, s: [config.rotationEnd ?? 260] },
      ],
      inFrame: startFrame,
      outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
    }));
  }
  return layers;
};

const buildBingoLetterBallLayers = (startIndex, configs) => {
  const layers = [];
  for (const [index, config] of configs.entries()) {
    const startFrame = config.startFrame ?? (index * 10);
    const impactFrame = config.impactFrame ?? (34 + (index * 10));
    const holdFrame = config.holdFrame ?? 112;
    const endFrame = config.endFrame ?? 176;
    const ball = config.ball ?? fullscreenBingoBallPalette[index % fullscreenBingoBallPalette.length];
    const scaleFrames = [
      { t: startFrame, s: [40, 40, 100] },
      { t: clampFrame(impactFrame + 8), s: [136, 136, 100] },
      { t: holdFrame, s: [108, 108, 100] },
      { t: endFrame, s: [74, 74, 100] },
    ];
    const opacityFrames = [
      { t: 0, s: [0] },
      { t: startFrame, s: [0] },
      { t: clampFrame(startFrame + 8), s: [100] },
      { t: clampFrame(endFrame - 18), s: [92] },
      { t: endFrame, s: [0] },
    ];
    const positionFrames = [
      { t: startFrame, s: [config.from[0], config.from[1], 0] },
      { t: impactFrame, s: [config.target[0], config.target[1], 0] },
      { t: holdFrame, s: [config.target[0], config.target[1], 0] },
      { t: endFrame, s: [config.to[0], config.to[1], 0] },
    ];

    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `BINGO Letter Ball ${config.letter}`,
      shapes: [bingoBallGroup("BINGO Letter Ball Shape", config.radius, ball.color, ball.digit)],
      positionFrames,
      scaleFrames,
      opacityFrames,
      rotationFrames: [{ t: startFrame, s: [config.rotationStart ?? -40] }, { t: impactFrame, s: [0] }, { t: endFrame, s: [config.rotationEnd ?? 160] }],
      inFrame: startFrame,
      outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
    }));
    layers.push(buildTextLayer({
      index: startIndex + layers.length,
      name: `BINGO Letter ${config.letter}`,
      text: config.letter,
      fontSize: config.radius * 0.86,
      fillColor: rgb("#151515"),
      strokeColor: rgb("#151515"),
      strokeWidth: 0,
      positionFrames,
      scaleFrames,
      opacityFrames,
      inFrame: startFrame,
      outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
    }));
  }
  return layers;
};

const buildBingoBallStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildBingoBallsGlowLayer(nextIndex, "Bingo Ball Storm Glow", rgb("#58c7ff"), center));
  nextIndex += 1;
  const balls = buildBingoBallMotionLayers(nextIndex, [
    { startFrame: 0, from: [-160, 140], mid: [420, 300], hold: [360, 300], to: [-220, 220], radius: 82, ball: fullscreenBingoBallPalette[1], rotationStart: -90, rotationMid: 140, rotationEnd: 320 },
    { startFrame: 4, from: [WIDTH + 160, 160], mid: [1480, 280], hold: [1530, 320], to: [WIDTH + 220, 240], radius: 88, ball: fullscreenBingoBallPalette[2], rotationStart: 80, rotationMid: -150, rotationEnd: -340 },
    { startFrame: 8, from: [220, -160], mid: [660, 240], hold: [640, 250], to: [260, -220], radius: 72, ball: fullscreenBingoBallPalette[3], rotationStart: -30, rotationMid: 120, rotationEnd: 280 },
    { startFrame: 12, from: [1710, -180], mid: [1240, 250], hold: [1280, 260], to: [1680, -220], radius: 76, ball: fullscreenBingoBallPalette[4], rotationStart: 40, rotationMid: -110, rotationEnd: -260 },
    { startFrame: 18, from: [WIDTH / 2, HEIGHT + 190], mid: [960, 666], hold: [960, 620], to: [WIDTH / 2, HEIGHT + 220], radius: 102, ball: fullscreenBingoBallPalette[0], rotationStart: 0, rotationMid: 160, rotationEnd: 360 },
    { startFrame: 22, from: [-180, HEIGHT * 0.74], mid: [700, 520], hold: [700, 500], to: [-220, HEIGHT * 0.82], radius: 70, ball: fullscreenBingoBallPalette[5], rotationStart: -70, rotationMid: 130, rotationEnd: 300 },
    { startFrame: 24, from: [WIDTH + 180, HEIGHT * 0.78], mid: [1220, 540], hold: [1220, 510], to: [WIDTH + 220, HEIGHT * 0.84], radius: 74, ball: fullscreenBingoBallPalette[1], rotationStart: 60, rotationMid: -140, rotationEnd: -300 },
  ]);
  layers.push(...balls);
  nextIndex += balls.length;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9911, 50, 30, center));
  nextIndex += 50;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 9912, count: 5, center, radiusRange: [160, 440], widthRange: [6, 13], palette: [rgb("#58c7ff"), rgb("#f5c65b"), rgb("#ffffff")], accentPalette: [rgb("#ffffff")], startFrame: 38, durationRange: [78, 118], scaleFrom: 28, scaleTo: 190 }));
  return makeAnimation("Bingo Ball Storm", layers);
};

const buildJackpotBallExplosion = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildBingoBallsGlowLayer(nextIndex, "Jackpot Ball Explosion Charge", rgb("#f5c65b"), center));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 9921, count: 7, center, radiusRange: [150, 520], widthRange: [7, 15], palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffffff")], accentPalette: [rgb("#ffffff")], startFrame: 28, durationRange: [86, 126], scaleFrom: 22, scaleTo: 210 }));
  nextIndex += 7;
  const configs = Array.from({ length: 10 }, (_, index) => {
    const angle = (index / 10) * Math.PI * 2;
    const holdRadius = 260 + ((index % 3) * 92);
    const exitRadius = 1080;
    return {
      startFrame: 24 + (index % 3) * 4,
      from: [center[0], center[1]],
      mid: [center[0] + Math.cos(angle) * holdRadius, center[1] + Math.sin(angle) * holdRadius * 0.58],
      hold: [center[0] + Math.cos(angle) * holdRadius * 1.08, center[1] + Math.sin(angle) * holdRadius * 0.62],
      to: [center[0] + Math.cos(angle) * exitRadius, center[1] + Math.sin(angle) * exitRadius * 0.72],
      radius: 58 + ((index % 4) * 9),
      ball: fullscreenBingoBallPalette[index % fullscreenBingoBallPalette.length],
      rotationStart: -30,
      rotationMid: 120 + (index * 30),
      rotationEnd: 260 + (index * 44),
    };
  });
  const balls = buildBingoBallMotionLayers(nextIndex, configs);
  layers.push(...balls);
  nextIndex += balls.length;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9922, 64, 30, center));
  return makeAnimation("Jackpot Ball Explosion", layers);
};

const buildBingoLetterFormation = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildBingoBallsGlowLayer(nextIndex, "BINGO Formation Glow", rgb("#f5c65b"), center));
  nextIndex += 1;
  const letters = ["B", "I", "N", "G", "O"];
  const targets = [560, 760, 960, 1160, 1360].map((x) => [x, HEIGHT * 0.5]);
  const balls = buildBingoLetterBallLayers(nextIndex, letters.map((letter, index) => ({
    letter,
    startFrame: index * 12,
    impactFrame: 34 + (index * 12),
    from: index % 2 === 0 ? [-150, 170 + (index * 80)] : [WIDTH + 150, 190 + (index * 70)],
    target: targets[index],
    to: [targets[index][0] + ((index - 2) * 220), index % 2 === 0 ? -220 : HEIGHT + 220],
    radius: 86,
    ball: fullscreenBingoBallPalette[index],
    rotationStart: index % 2 === 0 ? -80 : 80,
    rotationEnd: index % 2 === 0 ? 240 : -240,
  })));
  layers.push(...balls);
  nextIndex += balls.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 9931, count: 4, center, radiusRange: [190, 460], widthRange: [7, 14], palette: [rgb("#f5c65b"), rgb("#58c7ff"), rgb("#ffffff")], accentPalette: [rgb("#ffffff")], startFrame: 68, durationRange: [78, 112], scaleFrom: 32, scaleTo: 182 }));
  nextIndex += 4;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9932, 48, 48, center));
  return makeAnimation("B...I...N...G...O Formation", layers);
};

const buildBingoBallFormationWink = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  const letters = [
    { letter: "B", accent: rgb("#ff6548"), from: [-180, HEIGHT * 0.36], bounceA: [500, HEIGHT * 0.34], bounceB: [660, HEIGHT * 0.58], preImpact: [770, HEIGHT * 0.48], spin: 190 },
    { letter: "I", accent: rgb("#58c7ff"), from: [WIDTH * 0.48, -180], bounceA: [850, HEIGHT * 0.25], bounceB: [1020, HEIGHT * 0.4], preImpact: [900, HEIGHT * 0.43], spin: -160 },
    { letter: "N", accent: rgb("#f5c65b"), from: [WIDTH + 180, HEIGHT * 0.34], bounceA: [1420, HEIGHT * 0.35], bounceB: [1260, HEIGHT * 0.6], preImpact: [1030, HEIGHT * 0.48], spin: -210 },
    { letter: "G", accent: rgb("#7a44ff"), from: [-150, HEIGHT + 160], bounceA: [620, HEIGHT * 0.76], bounceB: [770, HEIGHT * 0.64], preImpact: [860, HEIGHT * 0.58], spin: 220 },
    { letter: "O", accent: rgb("#23bf66"), from: [WIDTH + 150, HEIGHT + 160], bounceA: [1310, HEIGHT * 0.76], bounceB: [1130, HEIGHT * 0.64], preImpact: [1060, HEIGHT * 0.58], spin: -220 },
  ];

  layers.push(buildBingoBallsGlowLayer(nextIndex, "BINGO Ball Formation Jackpot Pull", rgb("#f5c65b"), center));
  nextIndex += 1;

  const ballOpacity = [
    { t: 0, s: [0] },
    { t: 8, s: [100] },
    { t: 72, s: [100] },
    { t: 79, s: [96] },
    { t: 86, s: [0] },
  ];

  for (const [index, config] of letters.entries()) {
    const positionFrames = [
      { t: 0, s: [config.from[0], config.from[1], 0] },
      { t: 20 + index * 2, s: [config.bounceA[0], config.bounceA[1], 0] },
      { t: 40 + index * 2, s: [config.bounceB[0], config.bounceB[1], 0] },
      { t: 63, s: [config.preImpact[0], config.preImpact[1], 0] },
      { t: 79, s: [center[0], center[1], 0] },
      { t: 86, s: [center[0], center[1], 0] },
    ];
    const scaleFrames = [
      { t: 0, s: [42, 42, 100] },
      { t: 18 + index * 2, s: [118, 118, 100] },
      { t: 26 + index * 2, s: [94, 94, 100] },
      { t: 42 + index * 2, s: [108, 108, 100] },
      { t: 63, s: [104, 104, 100] },
      { t: 79, s: [118, 118, 100] },
      { t: 86, s: [18, 18, 100] },
    ];
    layers.push(buildLayer({
      index: nextIndex,
      name: `BINGO Bounce Ball ${config.letter}`,
      shapes: [bingoLetterBallGroup(`Glossy Letter Ball ${config.letter}`, 96, config.accent)],
      positionFrames,
      scaleFrames,
      opacityFrames: ballOpacity,
      rotationFrames: [
        { t: 0, s: [index % 2 === 0 ? -34 : 28] },
        { t: 40 + index * 2, s: [config.spin] },
        { t: 79, s: [0] },
        { t: 86, s: [90 * (index - 2)] },
      ],
      inFrame: 0,
      outFrame: 88,
    }));
    nextIndex += 1;
    layers.push(buildTextLayer({
      index: nextIndex,
      name: `BINGO Bounce Letter ${config.letter}`,
      text: config.letter,
      fontSize: 96,
      fillColor: rgb("#141414"),
      strokeColor: config.accent,
      strokeWidth: 2,
      positionFrames,
      scaleFrames,
      opacityFrames: ballOpacity,
      inFrame: 0,
      outFrame: 88,
    }));
    nextIndex += 1;
  }

  const impactRings = buildRingPulseLayers(nextIndex, {
    seed: 15091,
    count: 5,
    center,
    radiusRange: [130, 360],
    widthRange: [8, 18],
    palette: [rgb("#f5c65b"), rgb("#58c7ff"), rgb("#ffffff")],
    accentPalette: [rgb("#ffffff"), rgb("#fff1b4")],
    startFrame: 78,
    durationRange: [58, 86],
    scaleFrom: 22,
    scaleTo: 210,
  });
  layers.push(...impactRings);
  nextIndex += impactRings.length;

  layers.push(buildHeroFlowerLayer(nextIndex, "BINGO Collision Flash", [
    ringGroup("Collision Gold Ring", 260, rgb("#f5c65b"), rgb("#ffffff"), 18),
    sparkleGroup("Collision White Flash", 70, rgb("#ffffff"), rgb("#fff1b4")),
  ], 76, 84, 122, center));
  nextIndex += 1;

  layers.push(...buildCountdownSparkLayers(nextIndex, 15092, 74, 78, center));
  nextIndex += 74;

  nextIndex = addBingoHeroLayer(layers, nextIndex, {
    start: 88,
    peak: 102,
    end: 166,
    color: countdownPalette.goldLight,
    accent: countdownPalette.gold,
    fontSize: 320,
    strokeWidth: 13,
  });

  return makeAnimation("BINGO Ball Formation Wink", layers);
};

const buildGoldenBingoCascade = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildBingoBallsGlowLayer(nextIndex, "Golden Bingo Cascade Glow", rgb("#fff1b4"), center));
  nextIndex += 1;
  const configs = Array.from({ length: 12 }, (_, index) => {
    const x = 140 + (index * ((WIDTH - 280) / 11));
    const holdX = x + ((index % 3) - 1) * 70;
    const holdY = 250 + ((index % 4) * 105);
    return {
      startFrame: index * 4,
      impactFrame: 46 + (index % 4) * 7,
      holdFrame: 114,
      from: [x, -180 - ((index % 3) * 110)],
      mid: [holdX, holdY],
      hold: [holdX, holdY + ((index % 2) * 28)],
      to: [holdX + ((index % 2 === 0 ? -1 : 1) * 170), HEIGHT + 220],
      radius: 52 + ((index % 4) * 8),
      ball: { color: index % 3 === 0 ? rgb("#fff1b4") : index % 3 === 1 ? rgb("#f5c65b") : rgb("#ff9c36"), digit: fullscreenBingoBallPalette[index % fullscreenBingoBallPalette.length].digit },
      rotationStart: -60,
      rotationMid: 120 + index * 18,
      rotationEnd: 320 + index * 28,
    };
  });
  const rain = buildBingoBallMotionLayers(nextIndex, configs);
  layers.push(...rain);
  nextIndex += rain.length;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9941, 58, 30, center));
  return makeAnimation("Golden Bingo Cascade", layers);
};

const buildMegaBingoBallsFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildBingoBallsGlowLayer(nextIndex, "Mega Bingo Finale Glow", rgb("#f5c65b"), center));
  nextIndex += 1;
  const storm = buildBingoBallMotionLayers(nextIndex, [
    { startFrame: 0, from: [-160, 150], mid: [430, 300], hold: [420, 310], to: [-220, 210], radius: 76, ball: fullscreenBingoBallPalette[1], rotationStart: -80, rotationMid: 140, rotationEnd: 340 },
    { startFrame: 4, from: [WIDTH + 160, 150], mid: [1490, 310], hold: [1500, 320], to: [WIDTH + 220, 220], radius: 78, ball: fullscreenBingoBallPalette[2], rotationStart: 80, rotationMid: -140, rotationEnd: -340 },
    { startFrame: 8, from: [WIDTH / 2, -180], mid: [960, 230], hold: [960, 250], to: [WIDTH / 2, -220], radius: 82, ball: fullscreenBingoBallPalette[0], rotationStart: -20, rotationMid: 120, rotationEnd: 300 },
    { startFrame: 12, from: [WIDTH / 2, HEIGHT + 180], mid: [960, 720], hold: [960, 672], to: [WIDTH / 2, HEIGHT + 220], radius: 90, ball: fullscreenBingoBallPalette[3], rotationStart: 20, rotationMid: -120, rotationEnd: -300 },
  ]);
  layers.push(...storm);
  nextIndex += storm.length;
  const letters = buildBingoLetterBallLayers(nextIndex, ["B", "I", "N", "G", "O"].map((letter, index) => ({
    letter,
    startFrame: 30 + index * 5,
    impactFrame: 64 + index * 5,
    holdFrame: 116,
    from: [WIDTH / 2, HEIGHT * 0.52],
    target: [560 + index * 200, HEIGHT * 0.5],
    to: [560 + index * 200 + ((index - 2) * 190), index % 2 === 0 ? -220 : HEIGHT + 220],
    radius: 82,
    ball: fullscreenBingoBallPalette[index],
  })));
  layers.push(...letters);
  nextIndex += letters.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 9951, count: 7, center, radiusRange: [150, 540], widthRange: [7, 15], palette: [rgb("#f5c65b"), rgb("#58c7ff"), rgb("#ff4fd8"), rgb("#ffffff")], accentPalette: [rgb("#ffffff")], startFrame: 36, durationRange: [88, 126], scaleFrom: 24, scaleTo: 212 }));
  nextIndex += 7;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9952, 78, 32, center));
  return makeAnimation("Mega Bingo Finale", layers);
};

const buildBirthdayCakeCelebration = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.58];
  const palette = [rgb("#ff63c7"), rgb("#58c7ff"), rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffffff")];
  const cakeColors = {
    base: rgb("#ff8fcf"),
    baseSecondary: rgb("#f7c768"),
    icing: rgb("#fff6ea"),
    icingWarm: rgb("#fff0b8"),
    plate: rgb("#9fdcff"),
    plateAccent: rgb("#ff63c7"),
    accent: rgb("#ff63c7"),
  };

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Birthday Atmosphere",
      shapes: [
        group("Birthday Pink Glow", [
          ellipseShape("Birthday Pink Glow Path", 620, 340),
          fillNode("Birthday Pink Glow Fill", rgb("#ff63c7"), 10),
        ], {
          position: [-20, 18],
        }),
        group("Birthday Gold Glow", [
          ellipseShape("Birthday Gold Glow Path", 480, 260),
          fillNode("Birthday Gold Glow Fill", rgb("#f5c65b"), 10),
        ], {
          position: [0, 30],
        }),
        group("Birthday Blue Glow", [
          ellipseShape("Birthday Blue Glow Path", 540, 300),
          fillNode("Birthday Blue Glow Fill", rgb("#58c7ff"), 8),
        ], {
          position: [34, -10],
        }),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 0, s: [72, 72, 100] },
        { t: 18, s: [112, 112, 100] },
        { t: 54, s: [100, 100, 100] },
        { t: 128, s: [110, 110, 100] },
        { t: 179, s: [96, 96, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 4, s: [72] },
        { t: 38, s: [84] },
        { t: 136, s: [42] },
        { t: 179, s: [0] },
      ],
      inFrame: 0,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Birthday Cake Hero",
      shapes: [birthdayCakeGroup("Birthday Cake", cakeColors)],
      positionFrames: [
        { t: 0, s: [center[0], center[1] + 126, 0] },
        { t: 8, s: [center[0], center[1] - 24, 0] },
        { t: 18, s: [center[0], center[1] + 8, 0] },
        { t: 28, s: [center[0], center[1], 0] },
      ],
      scaleFrames: [
        { t: 0, s: [24, 24, 100] },
        { t: 8, s: [154, 154, 100] },
        { t: 18, s: [94, 94, 100] },
        { t: 28, s: [100, 100, 100] },
        { t: 128, s: [102, 102, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 2, s: [100] },
        { t: 152, s: [100] },
        { t: 179, s: [0] },
      ],
      inFrame: 0,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  const candleConfigs = [
    { offset: [-92, -164], height: 92, body: rgb("#58c7ff"), stripe: rgb("#ffffff"), flame: rgb("#fff1b4"), accent: rgb("#ff63c7"), rotation: -8 },
    { offset: [-46, -176], height: 100, body: rgb("#ff63c7"), stripe: rgb("#ffffff"), flame: rgb("#f5c65b"), accent: rgb("#fff1b4"), rotation: -4 },
    { offset: [0, -182], height: 108, body: rgb("#f5c65b"), stripe: rgb("#ffffff"), flame: rgb("#fff1b4"), accent: rgb("#ff9c36"), rotation: 0 },
    { offset: [48, -174], height: 100, body: rgb("#58c7ff"), stripe: rgb("#ffffff"), flame: rgb("#fff1b4"), accent: rgb("#ff63c7"), rotation: 4 },
    { offset: [92, -162], height: 92, body: rgb("#ff63c7"), stripe: rgb("#ffffff"), flame: rgb("#f5c65b"), accent: rgb("#fff1b4"), rotation: 8 },
  ];

  for (const [idx, candle] of candleConfigs.entries()) {
    const inFrame = 10 + (idx * 4);
    const popFrame = inFrame + 8;
    const settleFrame = inFrame + 16;
    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Birthday Candle ${idx + 1}`,
        shapes: [candleGroup(`Birthday Candle Shape ${idx + 1}`, candle.height, candle.body, candle.stripe, candle.flame, candle.accent)],
        positionFrames: [
          { t: inFrame, s: [center[0] + candle.offset[0], center[1] + candle.offset[1] + 12, 0] },
          { t: popFrame, s: [center[0] + candle.offset[0], center[1] + candle.offset[1] - 6, 0] },
          { t: settleFrame, s: [center[0] + candle.offset[0], center[1] + candle.offset[1], 0] },
        ],
        scaleFrames: [
          { t: inFrame, s: [36, 36, 100] },
          { t: popFrame, s: [132, 132, 100] },
          { t: settleFrame, s: [100, 100, 100] },
          { t: 88, s: [106, 106, 100] },
          { t: 132, s: [98, 98, 100] },
          { t: 168, s: [104, 104, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: inFrame, s: [0] },
          { t: popFrame, s: [100] },
          { t: 158, s: [100] },
          { t: 179, s: [0] },
        ],
        rotationFrames: [
          { t: inFrame, s: [candle.rotation * 0.4] },
          { t: settleFrame, s: [candle.rotation] },
          { t: 104, s: [candle.rotation * 0.78] },
          { t: 158, s: [candle.rotation * 1.08] },
        ],
        inFrame,
        outFrame: DURATION_FRAMES,
      }),
    );
    nextIndex += 1;
  }

  const balloonConfigs = [
    { color: rgb("#ff63c7"), accent: rgb("#fff1b4"), startFrame: 20, from: [center[0] - 340, center[1] + 88], mid: [center[0] - 356, center[1] - 138], to: [center[0] - 328, center[1] - 286], radius: 74, rotation: -12 },
    { color: rgb("#58c7ff"), accent: rgb("#ffffff"), startFrame: 24, from: [center[0] - 208, center[1] + 96], mid: [center[0] - 232, center[1] - 102], to: [center[0] - 214, center[1] - 238], radius: 62, rotation: 10 },
    { color: rgb("#f5c65b"), accent: rgb("#ffffff"), startFrame: 22, from: [center[0] + 318, center[1] + 92], mid: [center[0] + 336, center[1] - 126], to: [center[0] + 314, center[1] - 282], radius: 78, rotation: 12 },
    { color: rgb("#fff1b4"), accent: rgb("#ff63c7"), startFrame: 28, from: [center[0] + 184, center[1] + 102], mid: [center[0] + 212, center[1] - 96], to: [center[0] + 192, center[1] - 226], radius: 60, rotation: -8 },
  ];

  for (const [idx, balloon] of balloonConfigs.entries()) {
    const popFrame = balloon.startFrame + 10;
    const settleFrame = balloon.startFrame + 24;
    const endFrame = 166 + (idx * 2);
    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Birthday Balloon ${idx + 1}`,
        shapes: [balloonGroup(`Birthday Balloon Shape ${idx + 1}`, balloon.radius, balloon.color, balloon.accent)],
        positionFrames: [
          { t: balloon.startFrame, s: [balloon.from[0], balloon.from[1], 0] },
          { t: settleFrame, s: [balloon.mid[0], balloon.mid[1], 0] },
          { t: endFrame, s: [balloon.to[0], balloon.to[1], 0] },
        ],
        scaleFrames: [
          { t: balloon.startFrame, s: [54, 54, 100] },
          { t: popFrame, s: [122, 122, 100] },
          { t: settleFrame, s: [100, 100, 100] },
          { t: endFrame, s: [112, 112, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: balloon.startFrame, s: [0] },
          { t: popFrame, s: [96] },
          { t: endFrame - 12, s: [92] },
          { t: endFrame, s: [0] },
        ],
        rotationFrames: [
          { t: balloon.startFrame, s: [balloon.rotation] },
          { t: settleFrame, s: [balloon.rotation * -0.5] },
          { t: endFrame, s: [balloon.rotation * 0.72] },
        ],
        inFrame: balloon.startFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
    nextIndex += 1;
  }

  const confettiBurst = buildRadialBurstLayers(nextIndex, {
    seed: 931,
    count: 14,
    center: [center[0], center[1] - 16],
    minRadius: 120,
    maxRadius: 320,
    startFrame: 18,
    duration: 92,
    palette,
    sizeRange: [18, 28],
    shapeFactory: ({ size, color }) => [confettiGroup("Birthday Burst Confetti", size * 0.92, size * 0.52, color, rgb("#ffffff"))],
    scaleFrom: 28,
    scaleTo: 118,
    travelYScale: 0.64,
    rotationRange: [-120, 120],
  });
  layers.push(...confettiBurst);
  nextIndex += confettiBurst.length;

  const confettiFloat = buildFallingLayers(nextIndex, {
    seed: 932,
    count: 10,
    startY: 220,
    endY: HEIGHT + 80,
    xRange: [360, WIDTH - 360],
    palette,
    sizeRange: [14, 22],
    shapeFactory: ({ size, color }) => [confettiGroup("Birthday Floating Confetti", size * 0.9, size * 0.48, color, rgb("#ffffff"))],
  });
  layers.push(...confettiFloat);
  nextIndex += confettiFloat.length;

  const warmPulse = buildRingPulseLayers(nextIndex, {
    seed: 933,
    count: 2,
    center: [center[0], center[1] + 18],
    radiusRange: [170, 250],
    widthRange: [10, 16],
    palette: [rgb("#f5c65b"), rgb("#ff63c7")],
    accentPalette: [rgb("#ffffff"), rgb("#fff1b4")],
    startFrame: 28,
    durationRange: [52, 74],
    scaleFrom: 24,
    scaleTo: 164,
  });
  layers.push(...warmPulse);
  nextIndex += warmPulse.length;

  const sparkles = buildRadialBurstLayers(nextIndex, {
    seed: 934,
    count: 10,
    center: [center[0], center[1] - 48],
    minRadius: 96,
    maxRadius: 216,
    startFrame: 34,
    duration: 94,
    palette,
    sizeRange: [10, 16],
    shapeFactory: ({ size, color }) => [sparkleGroup("Birthday Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 108,
    travelYScale: 0.66,
    rotationRange: [-180, 180],
  });
  layers.push(...sparkles);
  nextIndex += sparkles.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Birthday Afterglow",
      shapes: [
        group("Afterglow Pink", [
          ellipseShape("Afterglow Pink Path", 420, 240),
          fillNode("Afterglow Pink Fill", rgb("#ff63c7"), 8),
        ]),
        group("Afterglow Gold", [
          ellipseShape("Afterglow Gold Path", 300, 180),
          fillNode("Afterglow Gold Fill", rgb("#f5c65b"), 8),
        ], {
          position: [0, 18],
        }),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1] + 14, 0] }],
      scaleFrames: [
        { t: 38, s: [84, 84, 100] },
        { t: 92, s: [104, 104, 100] },
        { t: 154, s: [116, 116, 100] },
        { t: 179, s: [126, 126, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 34, s: [22] },
        { t: 120, s: [14] },
        { t: 179, s: [0] },
      ],
      inFrame: 34,
      outFrame: DURATION_FRAMES,
    }),
  );

  const heroText = buildHappyBirthdayHeroTextLayers(nextIndex, { center: [WIDTH / 2, HEIGHT * 0.3], start: 58, peak: 82, hold: 120, end: 160, accent: rgb("#ff63c7"), fill: rgb("#fff1b4"), fontSize: 150 });
  layers.push(...heroText);
  nextIndex += heroText.length;

  return makeAnimation("Birthday Cake Celebration", layers);
};

const buildBalloonPartyBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.56];
  const palette = [rgb("#ff63c7"), rgb("#58c7ff"), rgb("#f5c65b"), rgb("#8f5bff"), rgb("#ff8fcf"), rgb("#ffffff")];

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Birthday Balloon Atmosphere",
      shapes: [
        group("Balloon Atmosphere Magenta", [
          ellipseShape("Balloon Atmosphere Magenta Path", 760, 360),
          fillNode("Balloon Atmosphere Magenta Fill", rgb("#ff63c7"), 10),
        ], {
          position: [-46, 10],
        }),
        group("Balloon Atmosphere Cyan", [
          ellipseShape("Balloon Atmosphere Cyan Path", 660, 320),
          fillNode("Balloon Atmosphere Cyan Fill", rgb("#58c7ff"), 8),
        ], {
          position: [48, -4],
        }),
        group("Balloon Atmosphere Gold", [
          ellipseShape("Balloon Atmosphere Gold Path", 520, 250),
          fillNode("Balloon Atmosphere Gold Fill", rgb("#f5c65b"), 8),
        ], {
          position: [0, 42],
        }),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 0, s: [64, 64, 100] },
        { t: 14, s: [112, 112, 100] },
        { t: 48, s: [100, 100, 100] },
        { t: 122, s: [108, 108, 100] },
        { t: 179, s: [96, 96, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 3, s: [74] },
        { t: 34, s: [86] },
        { t: 142, s: [38] },
        { t: 179, s: [0] },
      ],
      inFrame: 0,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Birthday HBD Accent",
      shapes: [birthdayHbdAccentGroup("Birthday HBD", rgb("#fff7dc"), rgb("#ff63c7"))],
      positionFrames: [
        { t: 12, s: [center[0], center[1] - 186, 0] },
        { t: 40, s: [center[0], center[1] - 178, 0] },
        { t: 124, s: [center[0], center[1] - 170, 0] },
      ],
      scaleFrames: [
        { t: 12, s: [54, 54, 100] },
        { t: 22, s: [118, 118, 100] },
        { t: 40, s: [100, 100, 100] },
        { t: 124, s: [104, 104, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 12, s: [0] },
        { t: 22, s: [76] },
        { t: 144, s: [46] },
        { t: 179, s: [0] },
      ],
      inFrame: 12,
      outFrame: DURATION_FRAMES,
    }),
  );
  nextIndex += 1;

  const balloonConfigs = [
    { startFrame: 0, from: [center[0] - 214, HEIGHT + 210], settle: [center[0] - 232, center[1] + 34], to: [center[0] - 246, center[1] - 216], radius: 116, color: rgb("#ff63c7"), accent: rgb("#fff1b4"), rotation: -14 },
    { startFrame: 2, from: [center[0] - 68, HEIGHT + 210], settle: [center[0] - 74, center[1] - 18], to: [center[0] - 82, center[1] - 246], radius: 98, color: rgb("#58c7ff"), accent: rgb("#ffffff"), rotation: -6 },
    { startFrame: 4, from: [center[0] + 74, HEIGHT + 216], settle: [center[0] + 88, center[1] + 4], to: [center[0] + 110, center[1] - 238], radius: 106, color: rgb("#f5c65b"), accent: rgb("#ffffff"), rotation: 8 },
    { startFrame: 6, from: [center[0] + 218, HEIGHT + 214], settle: [center[0] + 236, center[1] + 28], to: [center[0] + 254, center[1] - 202], radius: 120, color: rgb("#8f5bff"), accent: rgb("#ff8fcf"), rotation: 14 },
    { startFrame: 8, from: [center[0] - 346, HEIGHT + 240], settle: [center[0] - 354, center[1] + 96], to: [center[0] - 368, center[1] - 98], radius: 84, color: rgb("#ff8fcf"), accent: rgb("#ffffff"), rotation: -16 },
    { startFrame: 10, from: [center[0] + 346, HEIGHT + 242], settle: [center[0] + 360, center[1] + 86], to: [center[0] + 376, center[1] - 112], radius: 88, color: rgb("#58c7ff"), accent: rgb("#fff1b4"), rotation: 16 },
  ];

  for (const [idx, balloon] of balloonConfigs.entries()) {
    const inflateFrame = balloon.startFrame + 8;
    const settleFrame = balloon.startFrame + 18;
    const endFrame = 168 + idx;
    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Birthday Burst Balloon ${idx + 1}`,
        shapes: [balloonGroup(`Birthday Burst Balloon Shape ${idx + 1}`, balloon.radius, balloon.color, balloon.accent)],
        positionFrames: [
          { t: balloon.startFrame, s: [balloon.from[0], balloon.from[1], 0] },
          { t: settleFrame, s: [balloon.settle[0], balloon.settle[1], 0] },
          { t: endFrame, s: [balloon.to[0], balloon.to[1], 0] },
        ],
        scaleFrames: [
          { t: balloon.startFrame, s: [16, 16, 100] },
          { t: inflateFrame, s: [148, 148, 100] },
          { t: settleFrame, s: [100, 100, 100] },
          { t: 86, s: [106, 106, 100] },
          { t: endFrame, s: [112, 112, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: balloon.startFrame, s: [0] },
          { t: inflateFrame, s: [98] },
          { t: endFrame - 12, s: [94] },
          { t: endFrame, s: [0] },
        ],
        rotationFrames: [
          { t: balloon.startFrame, s: [balloon.rotation * 0.4] },
          { t: settleFrame, s: [balloon.rotation] },
          { t: endFrame, s: [balloon.rotation * -0.4] },
        ],
        inFrame: balloon.startFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
    nextIndex += 1;
  }

  const confettiBurst = buildRadialBurstLayers(nextIndex, {
    seed: 941,
    count: 18,
    center: [center[0], center[1] - 10],
    minRadius: 136,
    maxRadius: 420,
    startFrame: 8,
    duration: 88,
    palette,
    sizeRange: [18, 30],
    shapeFactory: ({ size, color }) => [confettiGroup("Balloon Burst Confetti", size * 0.92, size * 0.5, color, rgb("#ffffff"))],
    scaleFrom: 28,
    scaleTo: 120,
    travelYScale: 0.68,
    rotationRange: [-180, 180],
  });
  layers.push(...confettiBurst);
  nextIndex += confettiBurst.length;

  const ribbonSweeps = [
    { inFrame: 18, start: [-220, center[1] - 24], end: [WIDTH + 220, center[1] - 110], rotationStart: -12, rotationEnd: 16, length: 250, color: rgb("#ff63c7"), accent: rgb("#fff1b4") },
    { inFrame: 22, start: [WIDTH + 220, center[1] + 26], end: [-220, center[1] - 36], rotationStart: 172, rotationEnd: 196, length: 240, color: rgb("#58c7ff"), accent: rgb("#ffffff") },
    { inFrame: 26, start: [-180, center[1] + 142], end: [WIDTH + 180, center[1] + 62], rotationStart: -8, rotationEnd: 14, length: 220, color: rgb("#f5c65b"), accent: rgb("#ff8fcf") },
    { inFrame: 30, start: [WIDTH + 180, center[1] + 172], end: [-180, center[1] + 106], rotationStart: 180, rotationEnd: 206, length: 228, color: rgb("#8f5bff"), accent: rgb("#ffffff") },
  ];

  for (const [idx, ribbon] of ribbonSweeps.entries()) {
    const midFrame = ribbon.inFrame + 22;
    const endFrame = ribbon.inFrame + 72;
    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Birthday Ribbon Sweep ${idx + 1}`,
        shapes: [ribbonGroup(`Birthday Ribbon ${idx + 1}`, ribbon.length, ribbon.color, ribbon.accent)],
        positionFrames: [
          { t: ribbon.inFrame, s: [ribbon.start[0], ribbon.start[1], 0] },
          { t: midFrame, s: [center[0], center[1] + ((idx % 2 === 0 ? -1 : 1) * 24), 0] },
          { t: endFrame, s: [ribbon.end[0], ribbon.end[1], 0] },
        ],
        scaleFrames: [
          { t: ribbon.inFrame, s: [74, 74, 100] },
          { t: midFrame, s: [118, 118, 100] },
          { t: endFrame, s: [94, 94, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: ribbon.inFrame, s: [0] },
          { t: ribbon.inFrame + 8, s: [88] },
          { t: midFrame, s: [94] },
          { t: endFrame, s: [0] },
        ],
        rotationFrames: [
          { t: ribbon.inFrame, s: [ribbon.rotationStart] },
          { t: midFrame, s: [0] },
          { t: endFrame, s: [ribbon.rotationEnd] },
        ],
        inFrame: ribbon.inFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
    nextIndex += 1;
  }

  const confettiFloat = buildFallingLayers(nextIndex, {
    seed: 942,
    count: 12,
    startY: 180,
    endY: HEIGHT + 80,
    xRange: [240, WIDTH - 240],
    palette,
    sizeRange: [14, 22],
    shapeFactory: ({ size, color }) => [confettiGroup("Balloon Floating Confetti", size * 0.9, size * 0.48, color, rgb("#ffffff"))],
  });
  layers.push(...confettiFloat);
  nextIndex += confettiFloat.length;

  const sparkles = buildRadialBurstLayers(nextIndex, {
    seed: 943,
    count: 12,
    center: [center[0], center[1] - 36],
    minRadius: 108,
    maxRadius: 242,
    startFrame: 24,
    duration: 104,
    palette,
    sizeRange: [10, 16],
    shapeFactory: ({ size, color }) => [sparkleGroup("Balloon Birthday Spark", size, color, rgb("#ffffff"))],
    scaleFrom: 18,
    scaleTo: 112,
    travelYScale: 0.62,
    rotationRange: [-180, 180],
  });
  layers.push(...sparkles);
  nextIndex += sparkles.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Balloon Birthday Pulse",
      shapes: [
        group("Pulse Magenta", [
          ellipseShape("Pulse Magenta Path", 520, 260),
          fillNode("Pulse Magenta Fill", rgb("#ff63c7"), 8),
        ]),
        group("Pulse Cyan", [
          ellipseShape("Pulse Cyan Path", 420, 220),
          fillNode("Pulse Cyan Fill", rgb("#58c7ff"), 8),
        ], {
          position: [28, -8],
        }),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1] + 12, 0] }],
      scaleFrames: [
        { t: 24, s: [72, 72, 100] },
        { t: 42, s: [120, 120, 100] },
        { t: 84, s: [102, 102, 100] },
        { t: 152, s: [116, 116, 100] },
        { t: 179, s: [126, 126, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 24, s: [0] },
        { t: 42, s: [24] },
        { t: 126, s: [16] },
        { t: 179, s: [0] },
      ],
      inFrame: 24,
      outFrame: DURATION_FRAMES,
    }),
  );

  const heroText = buildHappyBirthdayHeroTextLayers(nextIndex, { center: [WIDTH / 2, HEIGHT * 0.28], start: 56, peak: 84, hold: 120, end: 162, accent: rgb("#58c7ff"), fill: rgb("#fff1b4"), fontSize: 150 });
  layers.push(...heroText);
  nextIndex += heroText.length;

  return makeAnimation("Balloon Party Burst", layers);
};

const giftBoxGroup = (name, size, boxColor, ribbonColor, accentColor) =>
  group(name, [
    group("Gift Glow", [
      ellipseShape("Gift Glow Path", size * 1.8, size * 1.15),
      fillNode("Gift Glow Fill", accentColor, 12),
    ], {
      position: [0, size * 0.2],
    }),
    group("Gift Body", [
      rectShape("Gift Body Path", size * 1.36, size * 0.86, size * 0.08),
      fillNode("Gift Body Fill", boxColor, 96),
    ], {
      position: [0, size * 0.18],
    }),
    group("Gift Lid", [
      rectShape("Gift Lid Path", size * 1.48, size * 0.28, size * 0.08),
      fillNode("Gift Lid Fill", boxColor, 98),
    ], {
      position: [0, -(size * 0.28)],
    }),
    group("Gift Vertical Ribbon", [
      rectShape("Gift Vertical Ribbon Path", size * 0.2, size * 1.08, size * 0.04),
      fillNode("Gift Vertical Ribbon Fill", ribbonColor, 96),
    ], {
      position: [0, size * 0.08],
    }),
    group("Gift Horizontal Ribbon", [
      rectShape("Gift Horizontal Ribbon Path", size * 1.48, size * 0.18, size * 0.04),
      fillNode("Gift Horizontal Ribbon Fill", ribbonColor, 96),
    ], {
      position: [0, size * 0.1],
    }),
    group("Gift Bow Left", [
      pathShape("Gift Bow Left Path", [[0, 0], [-(size * 0.38), -(size * 0.2)], [-(size * 0.56), size * 0.04], [-(size * 0.16), size * 0.13]], true),
      fillNode("Gift Bow Left Fill", ribbonColor, 94),
    ], {
      position: [-(size * 0.06), -(size * 0.48)],
    }),
    group("Gift Bow Right", [
      pathShape("Gift Bow Right Path", [[0, 0], [(size * 0.38), -(size * 0.2)], [(size * 0.56), size * 0.04], [(size * 0.16), size * 0.13]], true),
      fillNode("Gift Bow Right Fill", ribbonColor, 94),
    ], {
      position: [size * 0.06, -(size * 0.48)],
    }),
    group("Gift Shine", [
      rectShape("Gift Shine Path", size * 0.24, size * 0.72, size * 0.08),
      fillNode("Gift Shine Fill", rgb("#ffffff"), 13),
    ], {
      position: [-(size * 0.34), size * 0.13],
      rotation: -8,
    }),
  ]);

const birthdayPalette = [rgb("#ff63c7"), rgb("#58c7ff"), rgb("#f5c65b"), rgb("#8f5bff"), rgb("#ff8fcf"), rgb("#ffffff")];

function buildHappyBirthdayHeroTextLayers(startIndex, options = {}) {
  const center = options.center ?? [WIDTH / 2, HEIGHT * 0.34];
  const start = options.start ?? 58;
  const peak = options.peak ?? 84;
  const hold = options.hold ?? 118;
  const end = options.end ?? 160;
  const accent = options.accent ?? rgb("#ff63c7");
  const fill = options.fill ?? rgb("#fff1b4");
  const stroke = options.stroke ?? rgb("#ffffff");
  const glow = options.glow ?? rgb("#f5c65b");
  const layers = [];

  layers.push(buildLayer({
    index: startIndex + layers.length,
    name: "Happy Birthday Text Bloom",
    shapes: [
      group("Birthday Text Pink Bloom", [ellipseShape("Birthday Text Pink Bloom Path", 1040, 290), fillNode("Birthday Text Pink Bloom Fill", accent, 12)]),
      group("Birthday Text Gold Bloom", [ellipseShape("Birthday Text Gold Bloom Path", 820, 210), fillNode("Birthday Text Gold Bloom Fill", glow, 11)], { position: [0, 18] }),
      group("Birthday Text White Hotspot", [ellipseShape("Birthday Text White Hotspot Path", 560, 120), fillNode("Birthday Text White Hotspot Fill", rgb("#ffffff"), 8)], { position: [0, 6] }),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1] + 34, 0] }],
    scaleFrames: [{ t: start, s: [34, 34, 100] }, { t: peak, s: [118, 118, 100] }, { t: hold, s: [108, 108, 100] }, { t: end, s: [88, 88, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [78] }, { t: hold, s: [70] }, { t: end, s: [0] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, end + 1),
  }));

  const textFrames = {
    positionFrames: [
      { t: start, s: [center[0], center[1], 0] },
      { t: peak, s: [center[0], center[1] - 6, 0] },
      { t: hold, s: [center[0], center[1] - 6, 0] },
      { t: end, s: [center[0], center[1] - 34, 0] },
    ],
    scaleFrames: [{ t: start, s: [46, 46, 100] }, { t: peak, s: [112, 112, 100] }, { t: hold, s: [102, 102, 100] }, { t: end, s: [78, 78, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [100] }, { t: hold, s: [100] }, { t: end, s: [0] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, end + 1),
  };

  layers.push(buildTextLayer({
    index: startIndex + layers.length,
    name: "Happy Birthday Hero Shadow",
    text: "HAPPY\nBIRTHDAY",
    fontSize: options.fontSize ?? 156,
    fillColor: accent,
    strokeColor: accent,
    strokeWidth: 18,
    ...textFrames,
  }));
  layers.push(buildTextLayer({
    index: startIndex + layers.length,
    name: "Happy Birthday Hero Text",
    text: "HAPPY\nBIRTHDAY",
    fontSize: options.fontSize ?? 156,
    fillColor: fill,
    strokeColor: stroke,
    strokeWidth: 7,
    ...textFrames,
  }));
  layers.push(buildLayer({
    index: startIndex + layers.length,
    name: "Happy Birthday Shine Sweep",
    shapes: [lineStrokeGroup("Birthday Shine Sweep", [[-420, 0], [420, 0]], rgb("#ffffff"), 20, glow, 5, 18, 88)],
    positionFrames: [{ t: start, s: [center[0] - 480, center[1] - 62, 0] }, { t: peak, s: [center[0] + 480, center[1] + 92, 0] }, { t: hold, s: [center[0] + 620, center[1] + 120, 0] }],
    scaleFrames: [{ t: start, s: [58, 58, 100] }, { t: peak, s: [116, 116, 100] }, { t: hold, s: [96, 96, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [86] }, { t: hold, s: [0] }],
    rotationFrames: [{ t: start, s: [12] }, { t: hold, s: [12] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, hold + 1),
  }));

  return layers;
}

const buildGiftBoxExplosion = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.56];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Gift Box Warm Glow",
    shapes: [
      group("Gift Pink Glow", [ellipseShape("Gift Pink Glow Path", 760, 360), fillNode("Gift Pink Glow Fill", rgb("#ff63c7"), 10)]),
      group("Gift Gold Glow", [ellipseShape("Gift Gold Glow Path", 540, 280), fillNode("Gift Gold Glow Fill", rgb("#f5c65b"), 10)], { position: [0, 38] }),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [26, 26, 100] }, { t: 68, s: [112, 112, 100] }, { t: 112, s: [110, 110, 100] }, { t: 179, s: [132, 132, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [70] }, { t: 108, s: [68] }, { t: 179, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Birthday Gift Hero",
    shapes: [giftBoxGroup("Birthday Gift Box", 300, rgb("#ff63c7"), rgb("#f5c65b"), rgb("#fff1b4"))],
    positionFrames: [{ t: 0, s: [center[0], center[1] + 90, 0] }, { t: 26, s: [center[0], center[1], 0] }, { t: 112, s: [center[0], center[1] - 4, 0] }, { t: 174, s: [center[0], center[1] + 70, 0] }],
    scaleFrames: [{ t: 0, s: [28, 28, 100] }, { t: 26, s: [116, 116, 100] }, { t: 42, s: [96, 96, 100] }, { t: 112, s: [102, 102, 100] }, { t: 174, s: [72, 72, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 12, s: [100] }, { t: 146, s: [96] }, { t: 174, s: [0] }],
    rotationFrames: [{ t: 0, s: [-6] }, { t: 26, s: [5] }, { t: 42, s: [0] }, { t: 112, s: [0] }, { t: 174, s: [8] }],
  }));
  nextIndex += 1;
  const burst = buildRadialBurstLayers(nextIndex, {
    seed: 10201,
    count: 34,
    center,
    minRadius: 140,
    maxRadius: 680,
    startFrame: 38,
    duration: 122,
    palette: birthdayPalette,
    sizeRange: [16, 34],
    shapeFactory: ({ size, color, index }) => index % 5 === 0 ? [ribbonGroup("Gift Burst Ribbon", size * 1.7, color, rgb("#ffffff"))] : [confettiGroup("Gift Burst Confetti", size * 0.9, size * 0.5, color, rgb("#ffffff"))],
    scaleFrom: 24,
    scaleTo: 132,
    travelYScale: 0.64,
    rotationRange: [-180, 180],
  });
  layers.push(...burst);
  nextIndex += burst.length;
  const balloons = buildBingoBallMotionLayers(nextIndex, [
    { startFrame: 40, from: center, mid: [520, 350], hold: [480, 270], to: [420, -160], radius: 70, ball: { color: rgb("#ff63c7"), digit: 8 } },
    { startFrame: 44, from: center, mid: [1400, 360], hold: [1440, 250], to: [1500, -160], radius: 74, ball: { color: rgb("#58c7ff"), digit: 3 } },
  ]).map((layer, index) => ({
    ...layer,
    nm: `Gift Balloon Pop ${index + 1}`,
    shapes: [balloonGroup(`Gift Balloon Shape ${index + 1}`, index === 0 ? 86 : 92, index === 0 ? rgb("#ff63c7") : rgb("#58c7ff"), rgb("#fff1b4"))],
  }));
  layers.push(...balloons);
  nextIndex += balloons.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10202, count: 4, center, radiusRange: [160, 420], widthRange: [8, 15], palette: [rgb("#f5c65b"), rgb("#ff63c7"), rgb("#ffffff")], accentPalette: [rgb("#ffffff")], startFrame: 36, durationRange: [72, 108], scaleFrom: 24, scaleTo: 176 }));
  nextIndex += 4;
  const heroText = buildHappyBirthdayHeroTextLayers(nextIndex, { center: [WIDTH / 2, HEIGHT * 0.28], start: 58, peak: 86, hold: 122, end: 164, accent: rgb("#ff63c7"), fill: rgb("#fff1b4"), fontSize: 148 });
  layers.push(...heroText);
  return makeAnimation("Gift Box Explosion", layers);
};

const buildCandleWishMoment = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.55];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Candle Wish Warm Glow",
    shapes: [group("Candle Wish Glow", [ellipseShape("Candle Wish Glow Path", 980, 430), fillNode("Candle Wish Glow Fill", rgb("#f5c65b"), 11)])],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [20, 20, 100] }, { t: 68, s: [110, 110, 100] }, { t: 132, s: [112, 112, 100] }, { t: 179, s: [126, 126, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 20, s: [70] }, { t: 112, s: [80] }, { t: 179, s: [0] }],
  }));
  nextIndex += 1;
  const candleColors = [rgb("#ff63c7"), rgb("#58c7ff"), rgb("#f5c65b"), rgb("#8f5bff"), rgb("#ff8fcf"), rgb("#fff1b4"), rgb("#ff9c36")];
  for (let index = 0; index < 9; index += 1) {
    const x = WIDTH * 0.22 + index * (WIDTH * 0.56 / 8);
    const y = center[1] + (index % 2 === 0 ? 34 : -18);
    const start = 8 + index * 5;
    layers.push(buildLayer({
      index: nextIndex,
      name: `Wish Candle ${index + 1}`,
      shapes: [candleGroup(`Wish Candle Shape ${index + 1}`, 150 + (index % 3) * 18, candleColors[index % candleColors.length], rgb("#ffffff"), rgb("#fff1b4"), rgb("#ff9c36"))],
      positionFrames: [{ t: start, s: [x, HEIGHT + 120, 0] }, { t: start + 24, s: [x, y, 0] }, { t: 132, s: [x, y - 6, 0] }, { t: 178, s: [x, y - 120, 0] }],
      scaleFrames: [{ t: start, s: [48, 48, 100] }, { t: start + 24, s: [112, 112, 100] }, { t: 132, s: [104, 104, 100] }, { t: 178, s: [76, 76, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: start + 12, s: [100] }, { t: 154, s: [94] }, { t: 178, s: [0] }],
      rotationFrames: [{ t: start, s: [-6 + index] }, { t: 112, s: [4 - index * 0.6] }, { t: 178, s: [8] }],
      inFrame: start,
      outFrame: DURATION_FRAMES,
    }));
    nextIndex += 1;
  }
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10211, count: 5, center, radiusRange: [160, 520], widthRange: [5, 12], palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ff63c7")], accentPalette: [rgb("#ffffff")], startFrame: 42, durationRange: [86, 126], scaleFrom: 26, scaleTo: 180 }));
  nextIndex += 5;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 10212, count: 44, center: [center[0], center[1] - 70], minRadius: 120, maxRadius: 680, startFrame: 34, duration: 136, palette: [rgb("#fff1b4"), rgb("#ffffff"), rgb("#f5c65b")], sizeRange: [8, 18], shapeFactory: ({ size, color }) => [sparkleGroup("Candle Wish Spark", size, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 116, travelYScale: 0.5, rotationRange: [-180, 180] }));
  nextIndex += 44;
  const heroText = buildHappyBirthdayHeroTextLayers(nextIndex, { center: [WIDTH / 2, HEIGHT * 0.27], start: 62, peak: 88, hold: 126, end: 166, accent: rgb("#ff9c36"), fill: rgb("#fff1b4"), fontSize: 146 });
  layers.push(...heroText);
  return makeAnimation("Candle Wish Moment", layers);
};

const buildHappyBirthdayGrandFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.57];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Birthday Finale Glow",
    shapes: [group("Finale Pink Glow", [ellipseShape("Finale Pink Glow Path", 980, 440), fillNode("Finale Pink Glow Fill", rgb("#ff63c7"), 10)]), group("Finale Gold Glow", [ellipseShape("Finale Gold Glow Path", 700, 330), fillNode("Finale Gold Glow Fill", rgb("#f5c65b"), 10)], { position: [0, 20] })],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [20, 20, 100] }, { t: 68, s: [112, 112, 100] }, { t: 112, s: [112, 112, 100] }, { t: 179, s: [134, 134, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [78] }, { t: 112, s: [82] }, { t: 179, s: [0] }],
  }));
  nextIndex += 1;
  const cakeColors = { base: rgb("#ff8fcf"), baseSecondary: rgb("#f7c768"), icing: rgb("#fff6ea"), icingWarm: rgb("#fff0b8"), plate: rgb("#9fdcff"), plateAccent: rgb("#ff63c7"), accent: rgb("#ff63c7") };
  layers.push(buildLayer({
    index: nextIndex,
    name: "Grand Finale Cake",
    shapes: [birthdayCakeGroup("Grand Finale Cake Shape", cakeColors)],
    positionFrames: [{ t: 16, s: [center[0], center[1] + 130, 0] }, { t: 58, s: [center[0], center[1], 0] }, { t: 132, s: [center[0], center[1], 0] }, { t: 178, s: [center[0], center[1] + 90, 0] }],
    scaleFrames: [{ t: 16, s: [32, 32, 100] }, { t: 58, s: [108, 108, 100] }, { t: 112, s: [104, 104, 100] }, { t: 178, s: [72, 72, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [0] }, { t: 42, s: [100] }, { t: 150, s: [98] }, { t: 178, s: [0] }],
  }));
  nextIndex += 1;
  const balloonSpecs = [
    { x: 360, color: rgb("#ff63c7"), r: 90 }, { x: 520, color: rgb("#58c7ff"), r: 78 }, { x: 1400, color: rgb("#f5c65b"), r: 88 }, { x: 1560, color: rgb("#8f5bff"), r: 82 },
  ];
  for (const [index, balloon] of balloonSpecs.entries()) {
    const start = 10 + index * 5;
    layers.push(buildLayer({
      index: nextIndex,
      name: `Finale Balloon ${index + 1}`,
      shapes: [balloonGroup(`Finale Balloon Shape ${index + 1}`, balloon.r, balloon.color, rgb("#fff1b4"))],
      positionFrames: [{ t: start, s: [balloon.x, HEIGHT + 140, 0] }, { t: 58, s: [balloon.x, center[1] - 120 - (index % 2) * 42, 0] }, { t: 178, s: [balloon.x + (index < 2 ? -90 : 90), -160, 0] }],
      scaleFrames: [{ t: start, s: [28, 28, 100] }, { t: 58, s: [108, 108, 100] }, { t: 132, s: [102, 102, 100] }, { t: 178, s: [86, 86, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: start + 12, s: [96] }, { t: 158, s: [92] }, { t: 178, s: [0] }],
      rotationFrames: [{ t: start, s: [index < 2 ? -10 : 10] }, { t: 132, s: [index < 2 ? 8 : -8] }],
    }));
    nextIndex += 1;
  }
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 34, from: [-170, 260], mid: [760, 390], to: [WIDTH + 170, 650], length: 360, color: rgb("#ff63c7"), accent: rgb("#ffffff"), rotation: -18, spin: 112 },
    { start: 38, from: [WIDTH + 170, 260], mid: [1160, 400], to: [-170, 660], length: 360, color: rgb("#58c7ff"), accent: rgb("#fff1b4"), rotation: 198, spin: -112 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 10221, count: 52, center: [center[0], center[1] - 30], minRadius: 160, maxRadius: 860, startFrame: 42, duration: 130, palette: birthdayPalette, sizeRange: [14, 30], shapeFactory: ({ size, color, index }) => index % 6 === 0 ? [ribbonGroup("Birthday Finale Ribbon", size * 1.7, color, rgb("#ffffff"))] : [confettiGroup("Birthday Finale Confetti", size * 0.9, size * 0.48, color, rgb("#ffffff"))], scaleFrom: 24, scaleTo: 136, travelYScale: 0.64, rotationRange: [-180, 180] }));
  nextIndex += 52;
  const heroText = buildHappyBirthdayHeroTextLayers(nextIndex, { center: [WIDTH / 2, HEIGHT * 0.27], start: 56, peak: 84, hold: 124, end: 166, accent: rgb("#ff63c7"), fill: rgb("#fff1b4"), fontSize: 154 });
  layers.push(...heroText);
  return makeAnimation("Happy Birthday Grand Finale", layers);
};

const christmasPalette = {
  green: rgb("#23bf66"),
  deepGreen: rgb("#0f8a4a"),
  red: rgb("#ff3f3f"),
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  white: rgb("#ffffff"),
  ice: rgb("#9de8ff"),
};

const christmasTreeGroup = (name, size) =>
  group(name, [
    group("Tree Glow", [ellipseShape("Tree Glow Path", size * 1.9, size * 2.35), fillNode("Tree Glow Fill", christmasPalette.green, 12)]),
    ...[0, 1, 2].map((tier) => {
      const width = size * (0.78 + tier * 0.36);
      const height = size * 0.55;
      return group(`Tree Tier ${tier + 1}`, [
        pathShape("Tree Tier Path", [[0, -height * 0.56], [-width * 0.5, height * 0.48], [width * 0.5, height * 0.48]], true),
        fillNode("Tree Tier Fill", tier % 2 === 0 ? christmasPalette.green : christmasPalette.deepGreen, 96),
        strokeNode("Tree Tier Snow Shine", christmasPalette.white, Math.max(3, size * 0.016), 24),
      ], { position: [0, -size * 0.35 + tier * size * 0.36] });
    }),
    group("Tree Trunk", [rectShape("Tree Trunk Path", size * 0.18, size * 0.34, size * 0.03), fillNode("Tree Trunk Fill", rgb("#8a552a"), 94)], { position: [0, size * 0.64] }),
    ...Array.from({ length: 11 }, (_, index) => {
      const x = (index % 2 === 0 ? -1 : 1) * (size * (0.14 + (index % 4) * 0.07));
      const y = -size * 0.22 + index * size * 0.085;
      const color = [christmasPalette.red, christmasPalette.gold, christmasPalette.ice, christmasPalette.white][index % 4];
      return group(`Tree Light ${index + 1}`, [ellipseShape("Tree Light Path", size * 0.055, size * 0.055), fillNode("Tree Light Fill", color, 95), strokeNode("Tree Light Glow", color, Math.max(2, size * 0.018), 34)], { position: [x, y] });
    }),
    goldenStarGroup("Tree Star Topper", size * 0.12, christmasPalette.white),
  ]);

const snowflakeGroup = (name, size, color = christmasPalette.white) =>
  group(name, Array.from({ length: 6 }, (_, index) =>
    lineStrokeGroup(`Snowflake Arm ${index + 1}`, [[0, -size * 0.5], [0, size * 0.5]], color, Math.max(2, size * 0.08), christmasPalette.white, Math.max(1, size * 0.028), 18, 88),
  ).map((arm, index) => group(`Snowflake Rotated Arm ${index + 1}`, [arm], { rotation: index * 30 })));

const bellGroup = (name, size) =>
  group(name, [
    group("Bell Glow", [ellipseShape("Bell Glow Path", size * 1.55, size * 1.45), fillNode("Bell Glow Fill", christmasPalette.gold, 12)]),
    group("Bell Body", [
      pathShape("Bell Body Path", [[-size * 0.35, -size * 0.3], [size * 0.35, -size * 0.3], [size * 0.48, size * 0.34], [-size * 0.48, size * 0.34]], true),
      fillNode("Bell Body Fill", christmasPalette.gold, 96),
      strokeNode("Bell Shine Stroke", christmasPalette.goldLight, Math.max(4, size * 0.045), 76),
    ]),
    group("Bell Rim", [ellipseShape("Bell Rim Path", size * 0.95, size * 0.22), fillNode("Bell Rim Fill", christmasPalette.goldLight, 86)], { position: [0, size * 0.34] }),
    group("Bell Clapper", [ellipseShape("Bell Clapper Path", size * 0.16, size * 0.16), fillNode("Bell Clapper Fill", christmasPalette.red, 94)], { position: [0, size * 0.43] }),
    group("Bell Bow", [
      pathShape("Left Bow Path", [[0, 0], [-size * 0.32, -size * 0.18], [-size * 0.28, size * 0.14]], true),
      fillNode("Left Bow Fill", christmasPalette.red, 92),
      pathShape("Right Bow Path", [[0, 0], [size * 0.32, -size * 0.18], [size * 0.28, size * 0.14]], true),
      fillNode("Right Bow Fill", christmasPalette.red, 92),
    ], { position: [0, -size * 0.43] }),
  ]);

const buildChristmasSnowLayers = (startIndex, seed, count, palette = [christmasPalette.white, christmasPalette.ice]) => {
  const rng = createRng(seed);
  const layers = [];
  for (let index = 0; index < count; index += 1) {
    const x = 60 + rng() * (WIDTH - 120);
    const start = Math.floor(rng() * 38);
    const size = 10 + rng() * 22;
    const color = palette[index % palette.length];
    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Christmas Snow ${seed}-${index}`,
      shapes: [index % 4 === 0 ? snowflakeGroup("Snowflake Shape", size, color) : sparkleGroup("Snow Spark", size, color, christmasPalette.white)],
      positionFrames: [{ t: start, s: [x, -70, 0] }, { t: 96, s: [x + (rng() - 0.5) * 120, 360 + rng() * 280, 0] }, { t: 179, s: [x + (rng() - 0.5) * 220, HEIGHT + 100, 0] }],
      scaleFrames: [{ t: start, s: [50, 50, 100] }, { t: 82, s: [110, 110, 100] }, { t: 179, s: [70, 70, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: start + 14, s: [68] }, { t: 128, s: [52] }, { t: 179, s: [0] }],
      rotationFrames: [{ t: start, s: [rng() * 90] }, { t: 179, s: [rng() * 280] }],
      inFrame: 0,
      outFrame: DURATION_FRAMES,
    }));
  }
  return layers;
};

const buildMerryChristmasTextLayers = (startIndex, center = [WIDTH / 2, HEIGHT * 0.28], start = 66, peak = 92, hold = 128, end = 166) => [
  buildLayer({
    index: startIndex,
    name: "Merry Christmas Text Glow",
    shapes: [group("Christmas Text Glow", [ellipseShape("Christmas Text Glow Path", 1120, 270), fillNode("Christmas Text Glow Fill", christmasPalette.gold, 12)]), group("Christmas Text Red Glow", [ellipseShape("Christmas Text Red Glow Path", 800, 190), fillNode("Christmas Text Red Glow Fill", christmasPalette.red, 8)])],
    positionFrames: [{ t: start, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: start, s: [30, 30, 100] }, { t: peak, s: [114, 114, 100] }, { t: hold, s: [106, 106, 100] }, { t: end, s: [88, 88, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [78] }, { t: hold, s: [70] }, { t: end, s: [0] }],
  }),
  buildTextLayer({
    index: startIndex + 1,
    name: "Merry Christmas Hero Text",
    text: "MERRY\nCHRISTMAS",
    fontSize: 150,
    fillColor: christmasPalette.goldLight,
    strokeColor: christmasPalette.white,
    strokeWidth: 7,
    positionFrames: [{ t: start, s: [center[0], center[1] + 24, 0] }, { t: peak, s: [center[0], center[1], 0] }, { t: hold, s: [center[0], center[1], 0] }, { t: end, s: [center[0], center[1] - 38, 0] }],
    scaleFrames: [{ t: start, s: [42, 42, 100] }, { t: peak, s: [110, 110, 100] }, { t: hold, s: [104, 104, 100] }, { t: end, s: [78, 78, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [100] }, { t: hold, s: [100] }, { t: end, s: [0] }],
  }),
];

const buildChristmasTreeReveal = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.57];
  layers.push(buildNeonGlowLayer(nextIndex, "Christmas Tree Reveal Glow", christmasPalette.green, center, [980, 520]));
  nextIndex += 1;
  const snow = buildChristmasSnowLayers(nextIndex, 17001, 54);
  layers.push(...snow);
  nextIndex += snow.length;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Christmas Tree Hero",
    shapes: [christmasTreeGroup("Christmas Tree Shape", 330)],
    positionFrames: [{ t: 12, s: [center[0], center[1] + 120, 0] }, { t: 66, s: [center[0], center[1], 0] }, { t: 132, s: [center[0], center[1], 0] }, { t: 178, s: [center[0], center[1] - 60, 0] }],
    scaleFrames: [{ t: 12, s: [18, 18, 100] }, { t: 66, s: [112, 112, 100] }, { t: 96, s: [102, 102, 100] }, { t: 132, s: [106, 106, 100] }, { t: 178, s: [68, 68, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 24, s: [0] }, { t: 66, s: [100] }, { t: 148, s: [98] }, { t: 178, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 17002, count: 4, center, radiusRange: [180, 520], widthRange: [6, 12], palette: [christmasPalette.gold, christmasPalette.green, christmasPalette.white], accentPalette: [christmasPalette.white], startFrame: 56, durationRange: [80, 116], scaleFrom: 22, scaleTo: 184 }));
  return makeAnimation("Christmas Tree Reveal", layers);
};

const buildSantaGiftBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.56];
  layers.push(buildNeonGlowLayer(nextIndex, "Santa Gift Burst Glow", christmasPalette.red, center, [1020, 500]));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Santa Gift Hero",
    shapes: [giftBoxGroup("Santa Gift Box", 300, christmasPalette.red, christmasPalette.gold, christmasPalette.goldLight)],
    positionFrames: [{ t: 0, s: [center[0], center[1] + 120, 0] }, { t: 34, s: [center[0], center[1], 0] }, { t: 112, s: [center[0], center[1], 0] }, { t: 176, s: [center[0], center[1] + 90, 0] }],
    scaleFrames: [{ t: 0, s: [30, 30, 100] }, { t: 34, s: [116, 116, 100] }, { t: 48, s: [98, 98, 100] }, { t: 112, s: [102, 102, 100] }, { t: 176, s: [62, 62, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 16, s: [100] }, { t: 146, s: [94] }, { t: 176, s: [0] }],
    rotationFrames: [{ t: 0, s: [-7] }, { t: 34, s: [6] }, { t: 48, s: [0] }, { t: 176, s: [10] }],
  }));
  nextIndex += 1;
  const burst = buildRadialBurstLayers(nextIndex, { seed: 17011, count: 64, center, minRadius: 130, maxRadius: 860, startFrame: 38, duration: 130, palette: [christmasPalette.red, christmasPalette.gold, christmasPalette.green, christmasPalette.white, christmasPalette.ice], sizeRange: [12, 30], shapeFactory: ({ size, color, index }) => index % 4 === 0 ? [snowflakeGroup("Gift Snowflake", size, christmasPalette.white)] : index % 5 === 0 ? [giftBoxGroup("Tiny Christmas Present", size * 1.7, color, christmasPalette.gold, christmasPalette.white)] : [sparkleGroup("Gift Magic Spark", size, color, christmasPalette.white)], scaleFrom: 18, scaleTo: 122, travelYScale: 0.62, rotationRange: [-200, 200] });
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(...buildChristmasSnowLayers(nextIndex, 17012, 34));
  return makeAnimation("Santa Gift Burst", layers);
};

const buildSnowfallMagic = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.48];
  layers.push(buildNeonGlowLayer(nextIndex, "Snowfall Magic Icy Glow", christmasPalette.ice, center, [1120, 520]));
  nextIndex += 1;
  const snow = buildChristmasSnowLayers(nextIndex, 17021, 110, [christmasPalette.white, christmasPalette.ice, christmasPalette.goldLight]);
  layers.push(...snow);
  nextIndex += snow.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 17022, count: 5, center, radiusRange: [170, 540], widthRange: [5, 11], palette: [christmasPalette.ice, christmasPalette.white, christmasPalette.goldLight], accentPalette: [christmasPalette.white], startFrame: 56, durationRange: [90, 126], scaleFrom: 24, scaleTo: 190 }));
  return makeAnimation("Snowfall Magic", layers);
};

const buildJingleBellsBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildNeonGlowLayer(nextIndex, "Jingle Bells Gold Glow", christmasPalette.gold, center, [1020, 480]));
  nextIndex += 1;
  [-120, 120].forEach((offset, index) => {
    layers.push(buildLayer({
      index: nextIndex,
      name: `Jingle Bell Hero ${index + 1}`,
      shapes: [bellGroup(`Jingle Bell Shape ${index + 1}`, 220)],
      positionFrames: [{ t: 0, s: [center[0] + offset * 2.4, -140, 0] }, { t: 48, s: [center[0] + offset, center[1], 0] }, { t: 128, s: [center[0] + offset, center[1], 0] }, { t: 178, s: [center[0] + offset * 1.4, center[1] - 80, 0] }],
      scaleFrames: [{ t: 0, s: [40, 40, 100] }, { t: 48, s: [108, 108, 100] }, { t: 128, s: [104, 104, 100] }, { t: 178, s: [72, 72, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 20, s: [100] }, { t: 150, s: [96] }, { t: 178, s: [0] }],
      rotationFrames: [{ t: 0, s: [index === 0 ? -28 : 28] }, { t: 58, s: [index === 0 ? 16 : -16] }, { t: 92, s: [index === 0 ? -10 : 10] }, { t: 128, s: [0] }, { t: 178, s: [index === 0 ? -20 : 20] }],
    }));
    nextIndex += 1;
  });
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 17031, count: 7, center, radiusRange: [140, 560], widthRange: [6, 14], palette: [christmasPalette.gold, christmasPalette.red, christmasPalette.white], accentPalette: [christmasPalette.white], startFrame: 42, durationRange: [70, 112], scaleFrom: 22, scaleTo: 196 }));
  nextIndex += 7;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 17032, count: 52, center, minRadius: 160, maxRadius: 820, startFrame: 36, duration: 130, palette: [christmasPalette.gold, christmasPalette.red, christmasPalette.white], sizeRange: [8, 20], shapeFactory: ({ size, color }) => [sparkleGroup("Bell Spark", size, color, christmasPalette.white)], scaleFrom: 18, scaleTo: 118, travelYScale: 0.58, rotationRange: [-180, 180] }));
  return makeAnimation("Jingle Bells Blast", layers);
};

const buildChristmasGrandFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.6];
  layers.push(buildNeonGlowLayer(nextIndex, "Christmas Grand Finale Glow", christmasPalette.green, [WIDTH / 2, HEIGHT * 0.52], [1180, 560]));
  nextIndex += 1;
  const snow = buildChristmasSnowLayers(nextIndex, 17041, 72);
  layers.push(...snow);
  nextIndex += snow.length;
  layers.push(buildLayer({ index: nextIndex, name: "Finale Christmas Tree", shapes: [christmasTreeGroup("Finale Christmas Tree Shape", 260)], positionFrames: [{ t: 22, s: [center[0], center[1] + 80, 0] }, { t: 70, s: [center[0], center[1], 0] }, { t: 132, s: [center[0], center[1], 0] }, { t: 178, s: [center[0], center[1] - 70, 0] }], scaleFrames: [{ t: 22, s: [24, 24, 100] }, { t: 70, s: [104, 104, 100] }, { t: 132, s: [100, 100, 100] }, { t: 178, s: [66, 66, 100] }], opacityFrames: [{ t: 0, s: [0] }, { t: 34, s: [0] }, { t: 70, s: [100] }, { t: 150, s: [96] }, { t: 178, s: [0] }] }));
  nextIndex += 1;
  layers.push(buildLayer({ index: nextIndex, name: "Finale Gift Left", shapes: [giftBoxGroup("Finale Gift Left Shape", 130, christmasPalette.red, christmasPalette.gold, christmasPalette.white)], positionFrames: [{ t: 32, s: [520, HEIGHT + 90, 0] }, { t: 80, s: [520, HEIGHT * 0.75, 0] }, { t: 178, s: [450, HEIGHT + 90, 0] }], scaleFrames: [{ t: 32, s: [40, 40, 100] }, { t: 80, s: [100, 100, 100] }, { t: 178, s: [70, 70, 100] }], opacityFrames: [{ t: 0, s: [0] }, { t: 46, s: [100] }, { t: 150, s: [96] }, { t: 178, s: [0] }] }));
  nextIndex += 1;
  layers.push(buildLayer({ index: nextIndex, name: "Finale Gift Right", shapes: [giftBoxGroup("Finale Gift Right Shape", 130, christmasPalette.green, christmasPalette.red, christmasPalette.white)], positionFrames: [{ t: 36, s: [1400, HEIGHT + 90, 0] }, { t: 84, s: [1400, HEIGHT * 0.75, 0] }, { t: 178, s: [1470, HEIGHT + 90, 0] }], scaleFrames: [{ t: 36, s: [40, 40, 100] }, { t: 84, s: [100, 100, 100] }, { t: 178, s: [70, 70, 100] }], opacityFrames: [{ t: 0, s: [0] }, { t: 50, s: [100] }, { t: 150, s: [96] }, { t: 178, s: [0] }] }));
  nextIndex += 1;
  const text = buildMerryChristmasTextLayers(nextIndex, [WIDTH / 2, HEIGHT * 0.25], 62, 92, 130, 168);
  layers.push(...text);
  nextIndex += text.length;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 17042, count: 76, center: [WIDTH / 2, HEIGHT * 0.52], minRadius: 140, maxRadius: 900, startFrame: 48, duration: 126, palette: [christmasPalette.red, christmasPalette.green, christmasPalette.gold, christmasPalette.white], sizeRange: [10, 24], shapeFactory: ({ size, color, index }) => index % 6 === 0 ? [snowflakeGroup("Finale Snowflake", size, christmasPalette.white)] : [sparkleGroup("Finale Christmas Spark", size, color, christmasPalette.white)], scaleFrom: 18, scaleTo: 120, travelYScale: 0.58, rotationRange: [-200, 200] }));
  return makeAnimation("Christmas Grand Finale", layers);
};

const snowmanGroup = (name, size, hasGift = false) =>
  group(name, [
    group("Always Front Face Overlay", [
      ...[-0.12, 0.12].map((x, index) => group(`Overlay Eye ${index + 1}`, [
        ellipseShape("Overlay Eye Path", size * 0.082, size * 0.082),
        fillNode("Overlay Eye Fill", rgb("#050505"), 100),
      ], { position: [x * size, -size * 0.53] })),
      ...[-0.13, -0.065, 0, 0.065, 0.13].map((x, index) => group(`Overlay Smile ${index + 1}`, [
        ellipseShape("Overlay Smile Dot Path", size * 0.038, size * 0.038),
        fillNode("Overlay Smile Dot Fill", rgb("#050505"), 98),
      ], { position: [x * size, -size * (0.405 - Math.abs(x) * 0.16)] })),
      group("Overlay Carrot Nose", [
        pathShape("Overlay Carrot Nose Path", [[-size * 0.04, -size * 0.05], [size * 0.38, size * 0.01], [-size * 0.04, size * 0.075]], true),
        fillNode("Overlay Carrot Nose Fill", rgb("#ff8a1f"), 100),
        strokeNode("Overlay Carrot Nose Rim", rgb("#fff1b4"), Math.max(2, size * 0.016), 48),
      ], { position: [0, -size * 0.475] }),
    ]),
    group("Snowman Glow", [ellipseShape("Snowman Glow Path", size * 1.45, size * 2.0), fillNode("Snowman Glow Fill", christmasPalette.ice, 12)]),
    group("Left Arm Back", [lineStrokeGroup("Left Twig Back", [[-size * 0.28, -size * 0.12], [-size * 0.64, -size * 0.28]], rgb("#8a552a"), size * 0.035, rgb("#8a552a"), size * 0.018, 40, 88)], { rotation: -8 }),
    group("Right Arm Back", [lineStrokeGroup("Right Twig Back", [[size * 0.28, -size * 0.12], [size * 0.64, -size * 0.28]], rgb("#8a552a"), size * 0.035, rgb("#8a552a"), size * 0.018, 40, 88)], { rotation: 8 }),
    group("Snowman Bottom", [ellipseShape("Snowman Bottom Path", size * 0.86, size * 0.72), fillNode("Snowman Bottom Fill", christmasPalette.white, 96), strokeNode("Snowman Bottom Ice Stroke", christmasPalette.ice, Math.max(4, size * 0.025), 42)], { position: [0, size * 0.35] }),
    group("Snowman Middle", [ellipseShape("Snowman Middle Path", size * 0.66, size * 0.58), fillNode("Snowman Middle Fill", christmasPalette.white, 97), strokeNode("Snowman Middle Ice Stroke", christmasPalette.ice, Math.max(4, size * 0.022), 40)], { position: [0, -size * 0.1] }),
    group("Snowman Head", [ellipseShape("Snowman Head Path", size * 0.48, size * 0.45), fillNode("Snowman Head Fill", christmasPalette.white, 98), strokeNode("Snowman Head Ice Stroke", christmasPalette.ice, Math.max(3, size * 0.018), 42)], { position: [0, -size * 0.48] }),
    group("Top Hat", [
      group("Hat Crown", [rectShape("Hat Top Path", size * 0.38, size * 0.2, size * 0.025), fillNode("Hat Top Fill", rgb("#171717"), 96), strokeNode("Hat Top Shine", christmasPalette.white, Math.max(2, size * 0.012), 16)], { position: [0, -size * 0.05] }),
      group("Hat Brim", [rectShape("Hat Brim Path", size * 0.62, size * 0.08, size * 0.02), fillNode("Hat Brim Fill", rgb("#171717"), 96)], { position: [0, size * 0.08] }),
      group("Hat Band", [rectShape("Hat Band Path", size * 0.36, size * 0.045, size * 0.01), fillNode("Hat Band Fill", christmasPalette.red, 94)], { position: [0, size * 0.02] }),
    ], { position: [0, -size * 0.86], rotation: -3 }),
    group("Scarf", [
      rectShape("Scarf Wrap Path", size * 0.62, size * 0.095, size * 0.035),
      fillNode("Scarf Wrap Fill", christmasPalette.red, 97),
      strokeNode("Scarf Front Shine", christmasPalette.white, Math.max(2, size * 0.012), 20),
    ], { position: [0, -size * 0.29], rotation: -2 }),
    group("Scarf Tail", [
      rectShape("Scarf Tail Path", size * 0.13, size * 0.31, size * 0.025),
      fillNode("Scarf Tail Fill", christmasPalette.red, 94),
      strokeNode("Scarf Tail Shine", christmasPalette.white, Math.max(2, size * 0.01), 16),
    ], { position: [size * 0.18, -size * 0.16], rotation: -7 }),
    ...[0, 1, 2].map((button) => group(`Snowman Button ${button + 1}`, [ellipseShape("Button Path", size * 0.04, size * 0.04), fillNode("Button Fill", rgb("#111111"), 90)], { position: [0, -size * 0.06 + button * size * 0.16] })),
    ...(hasGift ? [group("Snowman Gift", [giftBoxGroup("Tiny Snowman Gift Shape", size * 0.22, christmasPalette.green, christmasPalette.red, christmasPalette.white)], { position: [size * 0.42, size * 0.02], rotation: 8 })] : []),
    group("Front Face", [
      ...[-0.12, 0.12].map((x, index) => group(`Front Eye ${index + 1}`, [
        ellipseShape("Front Eye Path", size * 0.07, size * 0.07),
        fillNode("Front Eye Fill", rgb("#111111"), 100),
      ], { position: [x * size, -size * 0.53] })),
      ...[-0.13, -0.065, 0, 0.065, 0.13].map((x, index) => group(`Front Smile ${index + 1}`, [
        ellipseShape("Front Smile Dot Path", size * 0.032, size * 0.032),
        fillNode("Front Smile Dot Fill", rgb("#111111"), 94),
      ], { position: [x * size, -size * (0.405 - Math.abs(x) * 0.16)] })),
      group("Front Carrot Nose", [
        pathShape("Front Carrot Nose Path", [[-size * 0.04, -size * 0.045], [size * 0.34, size * 0.01], [-size * 0.04, size * 0.065]], true),
        fillNode("Front Carrot Nose Fill", rgb("#ff9c36"), 100),
        strokeNode("Front Carrot Nose Rim", rgb("#fff1b4"), Math.max(2, size * 0.014), 36),
      ], { position: [0, -size * 0.475] }),
    ]),
  ]);

const buildSnowmanHeroLayer = (index, name, center, size, start = 32, peak = 72, hold = 128, end = 178, hasGift = false) =>
  buildLayer({
    index,
    name,
    shapes: [snowmanGroup(`${name} Shape`, size, hasGift)],
    positionFrames: [{ t: start, s: [center[0], center[1] + 140, 0] }, { t: peak, s: [center[0], center[1], 0] }, { t: hold, s: [center[0], center[1], 0] }, { t: end, s: [center[0], center[1] - 70, 0] }],
    scaleFrames: [{ t: start, s: [26, 26, 100] }, { t: peak, s: [112, 112, 100] }, { t: peak + 16, s: [98, 98, 100] }, { t: hold, s: [104, 104, 100] }, { t: end, s: [66, 66, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [100] }, { t: 150, s: [96] }, { t: end, s: [0] }],
    rotationFrames: [{ t: start, s: [-4] }, { t: peak, s: [2] }, { t: hold, s: [-2] }, { t: end, s: [5] }],
  });

const buildGiantSnowmanReveal = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.57];
  layers.push(buildNeonGlowLayer(nextIndex, "Giant Snowman Reveal Icy Glow", christmasPalette.ice, center, [1040, 560]));
  nextIndex += 1;
  const snow = buildChristmasSnowLayers(nextIndex, 18001, 70, [christmasPalette.white, christmasPalette.ice]);
  layers.push(...snow);
  nextIndex += snow.length;
  layers.push(buildSnowmanHeroLayer(nextIndex, "Giant Snowman Hero", center, 360, 20, 68, 132, 178));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 18002, count: 4, center, radiusRange: [180, 560], widthRange: [6, 12], palette: [christmasPalette.ice, christmasPalette.white, christmasPalette.goldLight], accentPalette: [christmasPalette.white], startFrame: 58, durationRange: [80, 116], scaleFrom: 22, scaleTo: 184 }));
  return makeAnimation("Giant Snowman Reveal", layers);
};

const buildSnowmanSnowstorm = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.56];
  layers.push(buildNeonGlowLayer(nextIndex, "Snowman Snowstorm Frost Glow", christmasPalette.ice, center, [1160, 560]));
  nextIndex += 1;
  const snow = buildChristmasSnowLayers(nextIndex, 18011, 132, [christmasPalette.white, christmasPalette.ice, christmasPalette.goldLight]);
  layers.push(...snow);
  nextIndex += snow.length;
  layers.push(buildSnowmanHeroLayer(nextIndex, "Storm Snowman Hero", center, 315, 42, 82, 132, 176));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 18012, count: 42, center, minRadius: 160, maxRadius: 800, startFrame: 58, duration: 118, palette: [christmasPalette.ice, christmasPalette.white], sizeRange: [8, 18], shapeFactory: ({ size, color }) => [snowflakeGroup("Storm Frost Spark", size, color)], scaleFrom: 18, scaleTo: 110, travelYScale: 0.5, rotationRange: [-160, 160] }));
  return makeAnimation("Snowman Snowstorm", layers);
};

const buildTopHatSnowmanPop = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.58];
  layers.push(buildNeonGlowLayer(nextIndex, "Top Hat Snowman Pop Glow", christmasPalette.goldLight, center, [980, 520]));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Flying Top Hat",
    shapes: [group("Flying Hat Shape", [rectShape("Flying Hat Top", 170, 90, 12), fillNode("Flying Hat Top Fill", rgb("#171717"), 96), rectShape("Flying Hat Brim", 250, 34, 10), fillNode("Flying Hat Brim Fill", rgb("#171717"), 96), rectShape("Flying Hat Band", 170, 22, 4), fillNode("Flying Hat Band Fill", christmasPalette.red, 94)])],
    positionFrames: [{ t: 0, s: [-120, 160, 0] }, { t: 42, s: [center[0], center[1] - 310, 0] }, { t: 66, s: [center[0], center[1] - 255, 0] }, { t: 138, s: [center[0], center[1] - 255, 0] }, { t: 176, s: [WIDTH + 160, 120, 0] }],
    scaleFrames: [{ t: 0, s: [42, 42, 100] }, { t: 42, s: [112, 112, 100] }, { t: 66, s: [94, 94, 100] }, { t: 176, s: [60, 60, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 10, s: [100] }, { t: 150, s: [96] }, { t: 176, s: [0] }],
    rotationFrames: [{ t: 0, s: [-220] }, { t: 42, s: [34] }, { t: 66, s: [-8] }, { t: 176, s: [180] }],
  }));
  nextIndex += 1;
  layers.push(buildSnowmanHeroLayer(nextIndex, "Pop Snowman Hero", center, 320, 34, 72, 132, 178));
  nextIndex += 1;
  layers.push(...buildChristmasSnowLayers(nextIndex, 18021, 52));
  nextIndex += 52;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 18022, count: 5, center, radiusRange: [160, 520], widthRange: [6, 13], palette: [christmasPalette.goldLight, christmasPalette.ice, christmasPalette.white], accentPalette: [christmasPalette.white], startFrame: 54, durationRange: [74, 112], scaleFrom: 20, scaleTo: 190 }));
  return makeAnimation("Top Hat Snowman Pop", layers);
};

const buildChristmasSnowmanGift = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.57];
  layers.push(buildNeonGlowLayer(nextIndex, "Christmas Snowman Gift Warm Glow", christmasPalette.green, center, [1060, 540]));
  nextIndex += 1;
  layers.push(buildSnowmanHeroLayer(nextIndex, "Gift Snowman Hero", center, 315, 22, 66, 132, 178, true));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 18031, count: 62, center: [center[0] + 130, center[1]], minRadius: 100, maxRadius: 780, startFrame: 48, duration: 126, palette: [christmasPalette.red, christmasPalette.green, christmasPalette.gold, christmasPalette.white, christmasPalette.ice], sizeRange: [10, 24], shapeFactory: ({ size, color, index }) => index % 5 === 0 ? [snowflakeGroup("Gift Snowflake", size, christmasPalette.white)] : [sparkleGroup("Gift Spark", size, color, christmasPalette.white)], scaleFrom: 18, scaleTo: 118, travelYScale: 0.58, rotationRange: [-180, 180] }));
  nextIndex += 62;
  layers.push(...buildChristmasSnowLayers(nextIndex, 18032, 42));
  return makeAnimation("Christmas Snowman Gift", layers);
};

const buildSnowmanGrandFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.58];
  layers.push(buildNeonGlowLayer(nextIndex, "Snowman Grand Finale Glow", christmasPalette.ice, center, [1180, 580]));
  nextIndex += 1;
  const snow = buildChristmasSnowLayers(nextIndex, 18041, 118, [christmasPalette.white, christmasPalette.ice, christmasPalette.goldLight]);
  layers.push(...snow);
  nextIndex += snow.length;
  layers.push(buildSnowmanHeroLayer(nextIndex, "Finale Snowman Hero", center, 350, 34, 78, 136, 178, true));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 18042, count: 6, center, radiusRange: [170, 600], widthRange: [6, 14], palette: [christmasPalette.ice, christmasPalette.goldLight, christmasPalette.white], accentPalette: [christmasPalette.white], startFrame: 52, durationRange: [82, 122], scaleFrom: 22, scaleTo: 200 }));
  nextIndex += 6;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 18043, count: 70, center, minRadius: 140, maxRadius: 900, startFrame: 54, duration: 126, palette: [christmasPalette.ice, christmasPalette.white, christmasPalette.goldLight], sizeRange: [8, 22], shapeFactory: ({ size, color, index }) => index % 4 === 0 ? [snowflakeGroup("Finale Snowflake", size, color)] : [sparkleGroup("Finale Snow Dust", size, color, christmasPalette.white)], scaleFrom: 18, scaleTo: 116, travelYScale: 0.56, rotationRange: [-200, 200] }));
  return makeAnimation("Snowman Grand Finale", layers);
};

const applausePalette = {
  skin: rgb("#ffd28a"),
  skinWarm: rgb("#ffb86a"),
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  white: rgb("#ffffff"),
  cyan: rgb("#58c7ff"),
};

const applauseHandGroup = (name, size, side = 1, color = applausePalette.skin, accent = applausePalette.white) =>
  group(name, [
    group("Palm Glow", [ellipseShape("Palm Glow Path", size * 0.9, size * 1.0), fillNode("Palm Glow Fill", applausePalette.gold, 10)], { position: [0, size * 0.1] }),
    group("Palm", [ellipseShape("Palm Path", size * 0.46, size * 0.6), fillNode("Palm Fill", color, 96), strokeNode("Palm Shine", accent, Math.max(3, size * 0.025), 26)], { position: [0, size * 0.12], rotation: side * -10 }),
    ...Array.from({ length: 4 }, (_, index) => group(`Finger ${index + 1}`, [rectShape("Finger Path", size * 0.12, size * (0.42 - index * 0.018), size * 0.06), fillNode("Finger Fill", color, 96), strokeNode("Finger Shine", accent, Math.max(2, size * 0.014), 22)], { position: [(-size * 0.18) + index * size * 0.12, -size * 0.2 - index * size * 0.02], rotation: side * (-8 + index * 2) })),
    group("Thumb", [rectShape("Thumb Path", size * 0.16, size * 0.42, size * 0.07), fillNode("Thumb Fill", applausePalette.skinWarm, 96), strokeNode("Thumb Shine", accent, Math.max(2, size * 0.014), 22)], { position: [side * size * 0.3, size * 0.04], rotation: side * -42 }),
    sparkleGroup("Hand Spark", Math.max(10, size * 0.06), accent, applausePalette.goldLight),
  ], { scale: [side * 100, 100], rotation: side * -18 });

const clappingHandsGroup = (name, size, color = applausePalette.skin) =>
  group(name, [
    group("Clap Center Glow", [ellipseShape("Clap Center Glow Path", size * 1.75, size * 1.2), fillNode("Clap Center Glow Fill", applausePalette.gold, 13)]),
    applauseHandGroup("Left Clap Hand", size, -1, color, applausePalette.white),
    applauseHandGroup("Right Clap Hand", size, 1, color, applausePalette.white),
    sparkleGroup("Clap Flash", Math.max(20, size * 0.12), applausePalette.white, applausePalette.goldLight),
  ]);

const applauseIconGroup = (name, size, color = applausePalette.goldLight) =>
  group(name, [clappingHandsGroup("Tiny Clap Hands", size, color)]);

const buildApplauseGlow = (index, name, center, color = applausePalette.gold) =>
  buildNeonGlowLayer(index, name, color, center, [1180, 560]);

const buildApplauseSparkBurst = (startIndex, seed, center, count = 58, palette = [applausePalette.gold, applausePalette.goldLight, applausePalette.white]) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 150,
    maxRadius: 960,
    startFrame: 38,
    duration: 132,
    palette,
    sizeRange: [10, 28],
    shapeFactory: ({ size, color, index }) => index % 6 === 0 ? [applauseIconGroup("Applause Clap Particle", size * 1.8, color)] : [sparkleGroup("Applause Spark", size, color, applausePalette.white)],
    scaleFrom: 18,
    scaleTo: 130,
    travelYScale: 0.62,
    rotationRange: [-190, 190],
  });

const buildApplauseRainLayers = (startIndex, seed, count) =>
  buildFallingLayers(startIndex, {
    seed,
    count,
    startY: -160,
    endY: HEIGHT + 170,
    xRange: [70, WIDTH - 70],
    palette: [applausePalette.gold, applausePalette.goldLight, applausePalette.white, applausePalette.skin],
    sizeRange: [22, 58],
    shapeFactory: ({ size, color, index }) => index % 3 === 0 ? [applauseIconGroup("Golden Clap Rain Icon", size, color)] : [sparkleGroup("Golden Clap Rain Spark", size * 0.42, color, applausePalette.white)],
  });

const buildGiantClapBurst = () => {
  let nextIndex = 1;
  const center = [WIDTH / 2, HEIGHT / 2];
  const layers = [buildApplauseGlow(nextIndex, "Giant Clap Burst Golden Glow", center)];
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Giant Clapping Hands Hero", [clappingHandsGroup("Hero Clapping Hands", 360)], 24, 82, 166, center));
  nextIndex += 1;
  const rings = buildRingPulseLayers(nextIndex, { seed: 18101, count: 5, center, radiusRange: [150, 520], widthRange: [7, 15], palette: [applausePalette.gold, applausePalette.goldLight, applausePalette.white], accentPalette: [applausePalette.white], startFrame: 50, durationRange: [78, 112], scaleFrom: 22, scaleTo: 176 });
  layers.push(...rings);
  nextIndex += rings.length;
  layers.push(...buildApplauseSparkBurst(nextIndex, 18102, center, 68));
  return makeAnimation("Giant Clap Burst", layers);
};

const buildStandingOvation = () => {
  let nextIndex = 1;
  const center = [WIDTH / 2, HEIGHT * 0.5];
  const layers = [buildApplauseGlow(nextIndex, "Standing Ovation Spotlight Glow", center, applausePalette.goldLight)];
  nextIndex += 1;
  const rain = buildApplauseRainLayers(nextIndex, 18111, 42);
  layers.push(...rain);
  nextIndex += rain.length;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "BRAVO!", center, start: 54, peak: 84, hold: 126, end: 166, accent: applausePalette.gold, fill: applausePalette.goldLight, fontSize: 270 }));
  nextIndex += 3;
  layers.push(...buildApplauseSparkBurst(nextIndex, 18112, center, 44, [applausePalette.gold, applausePalette.goldLight, applausePalette.white, applausePalette.cyan]));
  return makeAnimation("Standing Ovation", layers);
};

const buildGoldenApplauseRain = () => {
  let nextIndex = 1;
  const center = [WIDTH / 2, HEIGHT * 0.5];
  const layers = [buildApplauseGlow(nextIndex, "Golden Applause Rain VIP Glow", center, applausePalette.gold)];
  nextIndex += 1;
  const rainA = buildApplauseRainLayers(nextIndex, 18121, 70);
  layers.push(...rainA);
  nextIndex += rainA.length;
  const rainB = buildApplauseRainLayers(nextIndex, 18122, 46);
  layers.push(...rainB);
  nextIndex += rainB.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Golden Applause Center Hands", [clappingHandsGroup("Golden Center Applause", 250, applausePalette.goldLight)], 58, 96, 166, center));
  return makeAnimation("Golden Applause Rain", layers);
};

const buildChampionApplause = () => {
  let nextIndex = 1;
  const center = [WIDTH / 2, HEIGHT * 0.52];
  const layers = [buildApplauseGlow(nextIndex, "Champion Applause Victory Glow", center, applausePalette.cyan)];
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Champion Clapping Hands", [clappingHandsGroup("Champion Hands", 300)], 42, 86, 166, [center[0], center[1] + 76]));
  nextIndex += 1;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "WINNER!", center: [center[0], HEIGHT * 0.32], start: 54, peak: 84, hold: 122, end: 164, accent: applausePalette.cyan, fill: applausePalette.goldLight, fontSize: 230 }));
  nextIndex += 3;
  const rings = buildRingPulseLayers(nextIndex, { seed: 18131, count: 5, center, radiusRange: [160, 540], widthRange: [7, 14], palette: [applausePalette.cyan, applausePalette.gold, applausePalette.white], accentPalette: [applausePalette.white], startFrame: 52, durationRange: [80, 112], scaleFrom: 22, scaleTo: 182 });
  layers.push(...rings);
  nextIndex += rings.length;
  layers.push(...buildApplauseSparkBurst(nextIndex, 18132, center, 58, [applausePalette.gold, applausePalette.cyan, applausePalette.white, applausePalette.goldLight]));
  return makeAnimation("Champion Applause", layers);
};

const buildApplauseGrandFinale = () => {
  let nextIndex = 1;
  const center = [WIDTH / 2, HEIGHT / 2];
  const layers = [buildApplauseGlow(nextIndex, "Applause Grand Finale Cinematic Glow", center, applausePalette.gold)];
  nextIndex += 1;
  const rain = buildApplauseRainLayers(nextIndex, 18141, 58);
  layers.push(...rain);
  nextIndex += rain.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Applause Finale Hero Hands", [clappingHandsGroup("Finale Hero Clap", 340)], 50, 88, 166, center));
  nextIndex += 1;
  const burst = buildApplauseSparkBurst(nextIndex, 18142, center, 80, [applausePalette.gold, applausePalette.goldLight, applausePalette.skin, applausePalette.white, applausePalette.cyan]);
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 18143, count: 4, center, radiusRange: [190, 610], widthRange: [8, 16], palette: [applausePalette.gold, applausePalette.goldLight, applausePalette.white], accentPalette: [applausePalette.white], startFrame: 58, durationRange: [88, 120], scaleFrom: 22, scaleTo: 190 }));
  return makeAnimation("Applause Grand Finale", layers);
};

const thanksPalette = [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffcf8a"), rgb("#ffffff"), rgb("#ff8fcf")];

function buildThanksHeroTextLayers(startIndex, options = {}) {
  const center = options.center ?? [WIDTH / 2, HEIGHT * 0.46];
  const start = options.start ?? 52;
  const peak = options.peak ?? 82;
  const hold = options.hold ?? 124;
  const end = options.end ?? 166;
  const accent = options.accent ?? rgb("#f5c65b");
  const fill = options.fill ?? rgb("#fff1b4");
  const stroke = options.stroke ?? rgb("#ffffff");
  const glow = options.glow ?? rgb("#ffcf8a");
  const fontSize = options.fontSize ?? 300;
  const layers = [];

  layers.push(buildLayer({
    index: startIndex + layers.length,
    name: "Thanks Text Warm Bloom",
    shapes: [
      group("Thanks Gold Bloom", [ellipseShape("Thanks Gold Bloom Path", 1060, 300), fillNode("Thanks Gold Bloom Fill", accent, 13)]),
      group("Thanks Pink Bloom", [ellipseShape("Thanks Pink Bloom Path", 780, 220), fillNode("Thanks Pink Bloom Fill", rgb("#ff8fcf"), 7)], { position: [0, 20] }),
      group("Thanks White Hotspot", [ellipseShape("Thanks White Hotspot Path", 560, 120), fillNode("Thanks White Hotspot Fill", rgb("#ffffff"), 8)], { position: [0, 4] }),
    ],
    positionFrames: [{ t: start, s: [center[0], center[1] + 24, 0] }],
    scaleFrames: [{ t: start, s: [32, 32, 100] }, { t: peak, s: [118, 118, 100] }, { t: hold, s: [108, 108, 100] }, { t: end, s: [88, 88, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [78] }, { t: hold, s: [70] }, { t: end, s: [0] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, end + 1),
  }));

  const textFrames = {
    positionFrames: [
      { t: start, s: [center[0], center[1], 0] },
      { t: peak, s: [center[0], center[1] - 8, 0] },
      { t: hold, s: [center[0], center[1] - 8, 0] },
      { t: end, s: [center[0], center[1] - 42, 0] },
    ],
    scaleFrames: [{ t: start, s: [44, 44, 100] }, { t: peak, s: [112, 112, 100] }, { t: hold, s: [102, 102, 100] }, { t: end, s: [76, 76, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [100] }, { t: hold, s: [100] }, { t: end, s: [0] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, end + 1),
  };

  layers.push(buildTextLayer({
    index: startIndex + layers.length,
    name: "Thanks Hero Shadow",
    text: "THANKS",
    fontSize,
    fillColor: accent,
    strokeColor: accent,
    strokeWidth: 18,
    ...textFrames,
  }));
  layers.push(buildTextLayer({
    index: startIndex + layers.length,
    name: "Thanks Hero Text",
    text: "THANKS",
    fontSize,
    fillColor: fill,
    strokeColor: stroke,
    strokeWidth: 7,
    ...textFrames,
  }));
  layers.push(buildLayer({
    index: startIndex + layers.length,
    name: "Thanks Shine Sweep",
    shapes: [lineStrokeGroup("Thanks Shine Sweep Path", [[-440, 0], [440, 0]], rgb("#ffffff"), 22, glow, 5, 18, 88)],
    positionFrames: [{ t: start, s: [center[0] - 500, center[1] - 72, 0] }, { t: peak, s: [center[0] + 500, center[1] + 76, 0] }, { t: hold, s: [center[0] + 640, center[1] + 104, 0] }],
    scaleFrames: [{ t: start, s: [58, 58, 100] }, { t: peak, s: [116, 116, 100] }, { t: hold, s: [96, 96, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [88] }, { t: hold, s: [0] }],
    rotationFrames: [{ t: start, s: [10] }, { t: hold, s: [10] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, hold + 1),
  }));

  return layers;
}

const buildGiantThanksReveal = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Giant Thanks Warm Glow",
    shapes: [
      group("Thanks Wide Glow", [ellipseShape("Thanks Wide Glow Path", 1180, 420), fillNode("Thanks Wide Glow Fill", rgb("#f5c65b"), 10)]),
      group("Thanks Soft Pink Glow", [ellipseShape("Thanks Soft Pink Glow Path", 720, 250), fillNode("Thanks Soft Pink Glow Fill", rgb("#ff8fcf"), 6)], { position: [0, 24] }),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [20, 20, 100] }, { t: 68, s: [112, 112, 100] }, { t: 126, s: [110, 110, 100] }, { t: 179, s: [128, 128, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [72] }, { t: 126, s: [76] }, { t: 179, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12101, count: 56, center, minRadius: 120, maxRadius: 820, startFrame: 16, duration: 150, palette: thanksPalette, sizeRange: [8, 22], shapeFactory: ({ size, color }) => [sparkleGroup("Thanks Reveal Spark", size, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 118, travelYScale: 0.58, rotationRange: [-180, 180] }));
  nextIndex += 56;
  layers.push(...buildThanksHeroTextLayers(nextIndex, { center: [center[0], center[1] - 10], start: 54, peak: 82, hold: 126, end: 166, accent: rgb("#f5c65b"), fill: rgb("#fff1b4"), fontSize: 318 }));
  return makeAnimation("Giant Thanks Reveal", layers);
};

const buildGoldenGratitudeBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  for (let beam = 0; beam < 18; beam += 1) {
    const angle = (beam / 18) * 360;
    layers.push(buildLayer({
      index: nextIndex,
      name: `Gratitude Beam ${beam + 1}`,
      shapes: [lineStrokeGroup(`Gratitude Beam Stroke ${beam + 1}`, [[0, -40], [0, -470 - ((beam % 4) * 44)]], rgb("#fff1b4"), 12, rgb("#f5c65b"), 5, 16, 76)],
      positionFrames: [{ t: 22, s: [center[0], center[1], 0] }],
      scaleFrames: [{ t: 22, s: [22, 22, 100] }, { t: 72, s: [108, 108, 100] }, { t: 132, s: [112, 112, 100] }, { t: 176, s: [132, 132, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 28, s: [0] }, { t: 70, s: [86] }, { t: 132, s: [58] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: 22, s: [angle] }, { t: 176, s: [angle + 12] }],
      inFrame: 22,
      outFrame: DURATION_FRAMES,
    }));
    nextIndex += 1;
  }
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12111, count: 48, center, minRadius: 130, maxRadius: 760, startFrame: 32, duration: 136, palette: thanksPalette, sizeRange: [10, 26], shapeFactory: ({ size, color }) => [sparkleGroup("Gratitude Burst Spark", size, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 132, travelYScale: 0.54, rotationRange: [-180, 180] }));
  nextIndex += 48;
  layers.push(...buildThanksHeroTextLayers(nextIndex, { center: [center[0], center[1] - 8], start: 56, peak: 82, hold: 128, end: 166, accent: rgb("#ffcf8a"), fill: rgb("#fff1b4"), fontSize: 310 }));
  return makeAnimation("Golden Gratitude Burst", layers);
};

const buildSparkleThankYou = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.48];
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12121, count: 68, center, minRadius: 40, maxRadius: 900, startFrame: 8, duration: 154, palette: [rgb("#ffffff"), rgb("#fff1b4"), rgb("#f5c65b")], sizeRange: [7, 18], shapeFactory: ({ size, color }) => [sparkleGroup("Writing Sparkle", size, color, rgb("#ffffff"))], scaleFrom: 12, scaleTo: 106, travelYScale: 0.42, rotationRange: [-90, 90] }));
  nextIndex += 68;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Sparkle Thanks Writing Trail",
    shapes: [lineStrokeGroup("Sparkle Thanks Trail", [[-460, 0], [-270, -48], [-92, 34], [130, -38], [320, 26], [470, -14]], rgb("#fff1b4"), 12, rgb("#ffffff"), 5, 22, 82)],
    positionFrames: [{ t: 28, s: [center[0], center[1] + 56, 0] }, { t: 90, s: [center[0], center[1] - 4, 0] }, { t: 150, s: [center[0], center[1] - 44, 0] }],
    scaleFrames: [{ t: 28, s: [40, 40, 100] }, { t: 90, s: [112, 112, 100] }, { t: 150, s: [100, 100, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 30, s: [0] }, { t: 78, s: [86] }, { t: 132, s: [52] }, { t: 170, s: [0] }],
    inFrame: 28,
    outFrame: DURATION_FRAMES,
  }));
  nextIndex += 1;
  layers.push(...buildThanksHeroTextLayers(nextIndex, { center, start: 58, peak: 88, hold: 128, end: 168, accent: rgb("#ffffff"), fill: rgb("#fff1b4"), glow: rgb("#ffffff"), fontSize: 300 }));
  return makeAnimation("Sparkle Thank You", layers);
};

const buildThanksGiftPop = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.58];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Thanks Gift Warm Glow",
    shapes: [
      group("Thanks Gift Gold Glow", [ellipseShape("Thanks Gift Gold Glow Path", 760, 340), fillNode("Thanks Gift Gold Glow Fill", rgb("#f5c65b"), 10)]),
      group("Thanks Gift Pink Glow", [ellipseShape("Thanks Gift Pink Glow Path", 560, 260), fillNode("Thanks Gift Pink Glow Fill", rgb("#ff8fcf"), 8)], { position: [0, 30] }),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [24, 24, 100] }, { t: 70, s: [112, 112, 100] }, { t: 122, s: [108, 108, 100] }, { t: 178, s: [126, 126, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [70] }, { t: 126, s: [70] }, { t: 178, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Thanks Gift Box",
    shapes: [giftBoxGroup("Thanks Gift Box Shape", 280, rgb("#ff8fcf"), rgb("#f5c65b"), rgb("#fff1b4"))],
    positionFrames: [{ t: 0, s: [center[0], center[1] + 110, 0] }, { t: 32, s: [center[0], center[1] + 40, 0] }, { t: 112, s: [center[0], center[1] + 44, 0] }, { t: 174, s: [center[0], center[1] + 120, 0] }],
    scaleFrames: [{ t: 0, s: [26, 26, 100] }, { t: 32, s: [112, 112, 100] }, { t: 48, s: [96, 96, 100] }, { t: 112, s: [100, 100, 100] }, { t: 174, s: [70, 70, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 14, s: [100] }, { t: 146, s: [96] }, { t: 174, s: [0] }],
    rotationFrames: [{ t: 0, s: [-6] }, { t: 32, s: [5] }, { t: 48, s: [0] }, { t: 112, s: [0] }, { t: 174, s: [8] }],
  }));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12131, count: 42, center: [center[0], center[1] + 12], minRadius: 120, maxRadius: 720, startFrame: 42, duration: 126, palette: thanksPalette, sizeRange: [12, 28], shapeFactory: ({ size, color, index }) => index % 5 === 0 ? [ribbonGroup("Thanks Gift Ribbon", size * 1.7, color, rgb("#ffffff"))] : [sparkleGroup("Thanks Gift Spark", size * 0.8, color, rgb("#ffffff"))], scaleFrom: 22, scaleTo: 132, travelYScale: 0.58, rotationRange: [-180, 180] }));
  nextIndex += 42;
  layers.push(...buildThanksHeroTextLayers(nextIndex, { center: [WIDTH / 2, HEIGHT * 0.34], start: 56, peak: 84, hold: 124, end: 166, accent: rgb("#ff8fcf"), fill: rgb("#fff1b4"), fontSize: 284 }));
  return makeAnimation("Thanks Gift Pop", layers);
};

const buildThanksGrandFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Thanks Finale Glow",
    shapes: [
      group("Thanks Finale Gold Glow", [ellipseShape("Thanks Finale Gold Glow Path", 1160, 430), fillNode("Thanks Finale Gold Glow Fill", rgb("#f5c65b"), 11)]),
      group("Thanks Finale Warm Glow", [ellipseShape("Thanks Finale Warm Glow Path", 820, 300), fillNode("Thanks Finale Warm Glow Fill", rgb("#ffcf8a"), 10)], { position: [0, 28] }),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [18, 18, 100] }, { t: 68, s: [114, 114, 100] }, { t: 124, s: [112, 112, 100] }, { t: 179, s: [136, 136, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [80] }, { t: 126, s: [82] }, { t: 179, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12141, count: 58, center, minRadius: 140, maxRadius: 860, startFrame: 24, duration: 140, palette: thanksPalette, sizeRange: [12, 34], shapeFactory: ({ size, color, index }) => index % 4 === 0 ? [goldenStarGroup("Thanks Finale Star", size * 1.05, rgb("#ffffff"))] : [sparkleGroup("Thanks Finale Spark", size * 0.75, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 138, travelYScale: 0.6, rotationRange: [-180, 180] }));
  nextIndex += 58;
  layers.push(...buildThanksHeroTextLayers(nextIndex, { center: [center[0], center[1] - 8], start: 54, peak: 82, hold: 126, end: 166, accent: rgb("#f5c65b"), fill: rgb("#fff1b4"), fontSize: 318 }));
  return makeAnimation("Thanks Grand Finale", layers);
};

const winPalette = [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffcf8a"), rgb("#ffffff"), rgb("#ff4fd8"), rgb("#58c7ff")];

function buildWinHeroTextLayers(startIndex, options = {}) {
  const center = options.center ?? [WIDTH / 2, HEIGHT * 0.48];
  const start = options.start ?? 52;
  const peak = options.peak ?? 82;
  const hold = options.hold ?? 124;
  const end = options.end ?? 166;
  const text = options.text ?? "WIN";
  const accent = options.accent ?? rgb("#f5c65b");
  const fill = options.fill ?? rgb("#fff1b4");
  const stroke = options.stroke ?? rgb("#ffffff");
  const glow = options.glow ?? rgb("#ffcf8a");
  const fontSize = options.fontSize ?? (text.length > 3 ? 250 : 350);
  const layers = [];

  layers.push(buildLayer({
    index: startIndex + layers.length,
    name: `${text} Victory Bloom`,
    shapes: [
      group("Win Gold Bloom", [ellipseShape("Win Gold Bloom Path", text.length > 3 ? 1180 : 900, 330), fillNode("Win Gold Bloom Fill", accent, 14)]),
      group("Win Hot Core", [ellipseShape("Win Hot Core Path", text.length > 3 ? 760 : 540, 160), fillNode("Win Hot Core Fill", rgb("#ffffff"), 9)], { position: [0, 4] }),
      group("Win Pink Accent Bloom", [ellipseShape("Win Pink Accent Bloom Path", 640, 220), fillNode("Win Pink Accent Bloom Fill", rgb("#ff4fd8"), 5)], { position: [0, 26] }),
    ],
    positionFrames: [{ t: start, s: [center[0], center[1] + 24, 0] }],
    scaleFrames: [{ t: start, s: [30, 30, 100] }, { t: peak, s: [120, 120, 100] }, { t: hold, s: [108, 108, 100] }, { t: end, s: [88, 88, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [82] }, { t: hold, s: [72] }, { t: end, s: [0] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, end + 1),
  }));

  const textFrames = {
    positionFrames: [
      { t: start, s: [center[0], center[1], 0] },
      { t: peak, s: [center[0], center[1] - 8, 0] },
      { t: hold, s: [center[0], center[1] - 8, 0] },
      { t: end, s: [center[0], center[1] - 42, 0] },
    ],
    scaleFrames: [{ t: start, s: [42, 42, 100] }, { t: peak, s: [114, 114, 100] }, { t: hold, s: [103, 103, 100] }, { t: end, s: [76, 76, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [100] }, { t: hold, s: [100] }, { t: end, s: [0] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, end + 1),
  };

  layers.push(buildTextLayer({
    index: startIndex + layers.length,
    name: `${text} Victory Shadow`,
    text,
    fontSize,
    fillColor: accent,
    strokeColor: accent,
    strokeWidth: 20,
    ...textFrames,
  }));
  layers.push(buildTextLayer({
    index: startIndex + layers.length,
    name: `${text} Victory Text`,
    text,
    fontSize,
    fillColor: fill,
    strokeColor: stroke,
    strokeWidth: 8,
    ...textFrames,
  }));
  layers.push(buildLayer({
    index: startIndex + layers.length,
    name: `${text} Victory Shine Sweep`,
    shapes: [lineStrokeGroup("Win Shine Sweep Path", [[-460, 0], [460, 0]], rgb("#ffffff"), 24, glow, 5, 18, 90)],
    positionFrames: [{ t: start, s: [center[0] - 520, center[1] - 82, 0] }, { t: peak, s: [center[0] + 520, center[1] + 80, 0] }, { t: hold, s: [center[0] + 660, center[1] + 108, 0] }],
    scaleFrames: [{ t: start, s: [58, 58, 100] }, { t: peak, s: [118, 118, 100] }, { t: hold, s: [96, 96, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: peak, s: [90] }, { t: hold, s: [0] }],
    rotationFrames: [{ t: start, s: [10] }, { t: hold, s: [10] }],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, hold + 1),
  }));

  return layers;
}

const buildVictoryBeamLayers = (startIndex, seed, center, count = 20) => {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * 360;
    const length = 360 + rng() * 210;
    return buildLayer({
      index: startIndex + index,
      name: `Victory Beam ${index + 1}`,
      shapes: [lineStrokeGroup(`Victory Beam Stroke ${index + 1}`, [[0, -50], [0, -length]], rgb("#fff1b4"), 12, rgb("#f5c65b"), 5, 16, 78)],
      positionFrames: [{ t: 24, s: [center[0], center[1], 0] }],
      scaleFrames: [{ t: 24, s: [18, 18, 100] }, { t: 74, s: [108, 108, 100] }, { t: 128, s: [110, 110, 100] }, { t: 176, s: [132, 132, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 28, s: [0] }, { t: 72, s: [82] }, { t: 128, s: [56] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: 24, s: [angle] }, { t: 176, s: [angle + 10] }],
      inFrame: 24,
      outFrame: DURATION_FRAMES,
    });
  });
};

const buildGiantWinReveal = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Giant Win Jackpot Glow",
    shapes: [
      group("Win Wide Gold Glow", [ellipseShape("Win Wide Gold Glow Path", 980, 410), fillNode("Win Wide Gold Glow Fill", rgb("#f5c65b"), 11)]),
      group("Win White Flash", [ellipseShape("Win White Flash Path", 400, 150), fillNode("Win White Flash Fill", rgb("#ffffff"), 9)]),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [18, 18, 100] }, { t: 68, s: [114, 114, 100] }, { t: 126, s: [110, 110, 100] }, { t: 179, s: [130, 130, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 16, s: [74] }, { t: 126, s: [78] }, { t: 179, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12201, count: 58, center, minRadius: 120, maxRadius: 820, startFrame: 14, duration: 152, palette: winPalette, sizeRange: [8, 24], shapeFactory: ({ size, color }) => [sparkleGroup("Win Reveal Spark", size, color, rgb("#ffffff"))], scaleFrom: 16, scaleTo: 122, travelYScale: 0.56, rotationRange: [-180, 180] }));
  nextIndex += 58;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "WIN", center: [center[0], center[1] - 8], start: 54, peak: 82, hold: 126, end: 166, fontSize: 365 }));
  return makeAnimation("Giant Win Reveal", layers);
};

const buildBigWinJackpot = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(...buildVictoryBeamLayers(nextIndex, 12211, center, 22));
  nextIndex += 22;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12212, count: 62, center, minRadius: 140, maxRadius: 880, startFrame: 28, duration: 138, palette: winPalette, sizeRange: [10, 28], shapeFactory: ({ size, color }) => [sparkleGroup("Big Win Spark", size, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 136, travelYScale: 0.54, rotationRange: [-180, 180] }));
  nextIndex += 62;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "BIG WIN", center: [center[0], center[1] - 4], start: 56, peak: 82, hold: 128, end: 166, accent: rgb("#ffcf8a"), fill: rgb("#fff1b4"), fontSize: 244 }));
  return makeAnimation("Big Win Jackpot", layers);
};

const buildRoyalWinCrown = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.53];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Royal Win Glow",
    shapes: [
      group("Royal Win Gold Glow", [ellipseShape("Royal Win Gold Glow Path", 900, 440), fillNode("Royal Win Gold Glow Fill", rgb("#f5c65b"), 10)]),
      group("Royal Win Crown Aura", [ellipseShape("Royal Win Crown Aura Path", 520, 220), fillNode("Royal Win Crown Aura Fill", rgb("#fff1b4"), 10)], { position: [0, -170] }),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [22, 22, 100] }, { t: 70, s: [112, 112, 100] }, { t: 128, s: [110, 110, 100] }, { t: 178, s: [130, 130, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [74] }, { t: 128, s: [74] }, { t: 178, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Royal Win Crown Hero",
    shapes: [crownGroup("Royal Win Crown Shape", 210)],
    positionFrames: [{ t: 18, s: [center[0], center[1] - 230, 0] }, { t: 68, s: [center[0], center[1] - 190, 0] }, { t: 128, s: [center[0], center[1] - 194, 0] }, { t: 176, s: [center[0], center[1] - 260, 0] }],
    scaleFrames: [{ t: 18, s: [28, 28, 100] }, { t: 68, s: [112, 112, 100] }, { t: 128, s: [104, 104, 100] }, { t: 176, s: [70, 70, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 24, s: [0] }, { t: 58, s: [100] }, { t: 148, s: [96] }, { t: 176, s: [0] }],
    rotationFrames: [{ t: 18, s: [-8] }, { t: 68, s: [0] }, { t: 128, s: [0] }, { t: 176, s: [8] }],
  }));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12221, count: 44, center: [center[0], center[1] - 70], minRadius: 100, maxRadius: 720, startFrame: 34, duration: 132, palette: winPalette, sizeRange: [9, 24], shapeFactory: ({ size, color }) => [sparkleGroup("Royal Win Dust", size, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 126, travelYScale: 0.56, rotationRange: [-180, 180] }));
  nextIndex += 44;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "WIN", center: [center[0], center[1] + 70], start: 58, peak: 84, hold: 128, end: 166, fontSize: 330 }));
  return makeAnimation("Royal Win Crown", layers);
};

const buildWinConfettiBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12231, count: 72, center, minRadius: 120, maxRadius: 920, startFrame: 32, duration: 140, palette: winPalette, sizeRange: [12, 34], shapeFactory: ({ size, color, index }) => index % 4 === 0 ? [ribbonGroup("Win Confetti Ribbon", size * 1.8, color, rgb("#ffffff"))] : [confettiGroup("Win Confetti Piece", size * 0.9, size * 0.5, color, rgb("#ffffff"))], scaleFrom: 20, scaleTo: 140, travelYScale: 0.68, rotationRange: [-220, 220] }));
  nextIndex += 72;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "WIN", center: [center[0], center[1] - 8], start: 54, peak: 82, hold: 124, end: 166, accent: rgb("#ff4fd8"), fill: rgb("#fff1b4"), fontSize: 350 }));
  return makeAnimation("Win Confetti Blast", layers);
};

const buildMegaWinFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(...buildVictoryBeamLayers(nextIndex, 12241, center, 24));
  nextIndex += 24;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 12242, count: 4, center, radiusRange: [170, 520], widthRange: [8, 16], palette: [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffffff")], accentPalette: [rgb("#ffffff")], startFrame: 42, durationRange: [90, 126], scaleFrom: 24, scaleTo: 190 }));
  nextIndex += 4;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Mega Win Crown Flash",
    shapes: [crownGroup("Mega Win Crown Flash Shape", 140)],
    positionFrames: [{ t: 42, s: [center[0], center[1] - 220, 0] }, { t: 86, s: [center[0], center[1] - 198, 0] }, { t: 152, s: [center[0], center[1] - 210, 0] }],
    scaleFrames: [{ t: 42, s: [28, 28, 100] }, { t: 86, s: [94, 94, 100] }, { t: 152, s: [74, 74, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 48, s: [0] }, { t: 82, s: [90] }, { t: 148, s: [58] }, { t: 172, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12243, count: 76, center, minRadius: 140, maxRadius: 900, startFrame: 28, duration: 146, palette: winPalette, sizeRange: [10, 30], shapeFactory: ({ size, color, index }) => index % 5 === 0 ? [goldenStarGroup("Mega Win Star", size, rgb("#ffffff"))] : [sparkleGroup("Mega Win Spark", size * 0.8, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 140, travelYScale: 0.58, rotationRange: [-220, 220] }));
  nextIndex += 76;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "MEGA WIN", center: [center[0], center[1] - 2], start: 56, peak: 84, hold: 128, end: 166, fontSize: 226 }));
  return makeAnimation("Mega Win Finale", layers);
};

const friendshipPalette = [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffcf8a"), rgb("#ffffff"), rgb("#58c7ff"), rgb("#ffd85a")];

const friendshipHandshakeGroup = (name, size, leftColor = rgb("#ffcf8a"), rightColor = rgb("#f5c65b"), accent = rgb("#ffffff")) =>
  group(name, [
    group("Handshake Glow", [
      ellipseShape("Handshake Glow Path", size * 2.5, size * 1.25),
      fillNode("Handshake Glow Fill", rgb("#f5c65b"), 12),
    ]),
    group("Left Sleeve", [
      rectShape("Left Sleeve Path", size * 0.62, size * 0.34, size * 0.09),
      fillNode("Left Sleeve Fill", rgb("#58c7ff"), 86),
    ], {
      position: [-(size * 0.58), size * 0.1],
      rotation: 12,
    }),
    group("Right Sleeve", [
      rectShape("Right Sleeve Path", size * 0.62, size * 0.34, size * 0.09),
      fillNode("Right Sleeve Fill", rgb("#ff8fcf"), 86),
    ], {
      position: [size * 0.58, size * 0.1],
      rotation: -12,
    }),
    group("Left Hand", [
      rectShape("Left Palm Path", size * 0.72, size * 0.32, size * 0.13),
      fillNode("Left Palm Fill", leftColor, 96),
      strokeNode("Left Palm Stroke", accent, Math.max(3, size * 0.025), 36),
    ], {
      position: [-(size * 0.18), 0],
      rotation: 14,
    }),
    group("Right Hand", [
      rectShape("Right Palm Path", size * 0.72, size * 0.32, size * 0.13),
      fillNode("Right Palm Fill", rightColor, 96),
      strokeNode("Right Palm Stroke", accent, Math.max(3, size * 0.025), 36),
    ], {
      position: [size * 0.18, 0],
      rotation: -14,
    }),
    group("Hand Clasp", [
      rectShape("Clasp Path", size * 0.42, size * 0.3, size * 0.12),
      fillNode("Clasp Fill", rgb("#fff1b4"), 90),
      strokeNode("Clasp Stroke", accent, Math.max(3, size * 0.03), 42),
    ]),
    sparkleGroup("Handshake Shine", Math.max(12, size * 0.08), accent, rgb("#f5c65b")),
  ]);

const friendIconGroup = (name, size, bodyColor = rgb("#58c7ff"), accent = rgb("#ffffff")) =>
  group(name, [
    group("Friend Icon Glow", [
      ellipseShape("Friend Icon Glow Path", size * 1.55, size * 1.8),
      fillNode("Friend Icon Glow Fill", bodyColor, 10),
    ]),
    group("Friend Head", [
      ellipseShape("Friend Head Path", size * 0.45, size * 0.45),
      fillNode("Friend Head Fill", accent, 92),
      strokeNode("Friend Head Stroke", bodyColor, Math.max(3, size * 0.04), 70),
    ], {
      position: [0, -(size * 0.34)],
    }),
    group("Friend Body", [
      rectShape("Friend Body Path", size * 0.72, size * 0.74, size * 0.22),
      fillNode("Friend Body Fill", bodyColor, 90),
      strokeNode("Friend Body Stroke", accent, Math.max(3, size * 0.035), 34),
    ], {
      position: [0, size * 0.2],
    }),
    group("Friend Shine", [
      ellipseShape("Friend Shine Path", size * 0.18, size * 0.11),
      fillNode("Friend Shine Fill", accent, 28),
    ], {
      position: [-(size * 0.15), -(size * 0.4)],
      rotation: -18,
    }),
  ]);

const buildFriendshipGlowLayer = (index, name, center, color = rgb("#ffcf8a")) =>
  buildLayer({
    index,
    name,
    shapes: [
      group("Friendship Wide Glow", [ellipseShape("Friendship Wide Glow Path", 1080, 440), fillNode("Friendship Wide Glow Fill", color, 10)]),
      group("Friendship Core Glow", [ellipseShape("Friendship Core Glow Path", 620, 250), fillNode("Friendship Core Glow Fill", rgb("#fff1b4"), 8)]),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [18, 18, 100] }, { t: 68, s: [112, 112, 100] }, { t: 126, s: [110, 110, 100] }, { t: 179, s: [130, 130, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 16, s: [74] }, { t: 126, s: [74] }, { t: 179, s: [0] }],
  });

const buildFriendshipHandshakeReveal = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildFriendshipGlowLayer(nextIndex, "Friendship Handshake Glow", center));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Friendship Handshake Hero",
    shapes: [friendshipHandshakeGroup("Friendship Handshake Shape", 330)],
    positionFrames: [{ t: 8, s: [center[0] - 760, center[1], 0] }, { t: 66, s: [center[0], center[1], 0] }, { t: 128, s: [center[0], center[1], 0] }, { t: 176, s: [center[0] + 40, center[1] - 80, 0] }],
    scaleFrames: [{ t: 8, s: [46, 46, 100] }, { t: 66, s: [112, 112, 100] }, { t: 128, s: [106, 106, 100] }, { t: 176, s: [74, 74, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 14, s: [0] }, { t: 50, s: [100] }, { t: 150, s: [96] }, { t: 176, s: [0] }],
    rotationFrames: [{ t: 8, s: [-5] }, { t: 66, s: [0] }, { t: 128, s: [0] }, { t: 176, s: [8] }],
  }));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12301, count: 56, center, minRadius: 120, maxRadius: 820, startFrame: 20, duration: 146, palette: friendshipPalette, sizeRange: [8, 22], shapeFactory: ({ size, color }) => [sparkleGroup("Friendship Handshake Spark", size, color, rgb("#ffffff"))], scaleFrom: 16, scaleTo: 120, travelYScale: 0.54, rotationRange: [-180, 180] }));
  return makeAnimation("Friendship Handshake Reveal", layers);
};

const buildBestFriendsPop = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildFriendshipGlowLayer(nextIndex, "Best Friends Glow", center, rgb("#58c7ff")));
  nextIndex += 1;
  const friends = [
    { x: center[0] - 150, color: rgb("#58c7ff"), start: 10 },
    { x: center[0] + 150, color: rgb("#ff8fcf"), start: 16 },
  ];
  for (const [index, friend] of friends.entries()) {
    layers.push(buildLayer({
      index: nextIndex,
      name: `Best Friend Icon ${index + 1}`,
      shapes: [friendIconGroup(`Best Friend Shape ${index + 1}`, 220, friend.color, rgb("#ffffff"))],
      positionFrames: [{ t: friend.start, s: [friend.x, HEIGHT + 130, 0] }, { t: 64, s: [friend.x, center[1] + 30, 0] }, { t: 128, s: [friend.x, center[1] + 24, 0] }, { t: 176, s: [friend.x + (index === 0 ? -90 : 90), center[1] - 120, 0] }],
      scaleFrames: [{ t: friend.start, s: [28, 28, 100] }, { t: 64, s: [112, 112, 100] }, { t: 82, s: [96, 96, 100] }, { t: 128, s: [104, 104, 100] }, { t: 176, s: [70, 70, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: friend.start, s: [0] }, { t: friend.start + 14, s: [100] }, { t: 150, s: [96] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: friend.start, s: [index === 0 ? -8 : 8] }, { t: 64, s: [0] }, { t: 176, s: [index === 0 ? -10 : 10] }],
    }));
    nextIndex += 1;
  }
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12311, count: 44, center, minRadius: 100, maxRadius: 760, startFrame: 32, duration: 136, palette: friendshipPalette, sizeRange: [8, 22], shapeFactory: ({ size, color }) => [sparkleGroup("Best Friends Spark", size, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 126, travelYScale: 0.56, rotationRange: [-180, 180] }));
  nextIndex += 44;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "BEST FRIENDS", center: [WIDTH / 2, HEIGHT * 0.28], start: 56, peak: 84, hold: 124, end: 166, accent: rgb("#58c7ff"), fill: rgb("#fff1b4"), fontSize: 150 }));
  return makeAnimation("Best Friends Pop", layers);
};

const buildFriendshipHeartBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildFriendshipGlowLayer(nextIndex, "Friendship Heart Glow", center, rgb("#ffd85a")));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12321, count: 62, center, minRadius: 90, maxRadius: 820, startFrame: 12, duration: 150, palette: [rgb("#ffd85a"), rgb("#fff1b4"), rgb("#ffcf8a")], sizeRange: [14, 34], shapeFactory: ({ size, color, index }) => [heartGroup(`Friendship Yellow Heart ${index}`, size, color, rgb("#ffffff"))], scaleFrom: 16, scaleTo: 124, travelYScale: 0.56, rotationRange: [-120, 120] }));
  nextIndex += 62;
  layers.push(buildHeroFlowerLayer(nextIndex, "Friendship Giant Heart", [heartGroup("Friendship Hero Heart", 330, rgb("#ffd85a"), rgb("#ffffff"))], 58, 96, 168, center));
  return makeAnimation("Friendship Heart Burst", layers);
};

const buildFriendshipStarCircle = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildFriendshipGlowLayer(nextIndex, "Friendship Star Badge Glow", center, rgb("#f5c65b")));
  nextIndex += 1;
  const starCount = 22;
  for (let index = 0; index < starCount; index += 1) {
    const angle = (index / starCount) * Math.PI * 2;
    const target = [center[0] + Math.cos(angle) * 390, center[1] + Math.sin(angle) * 220];
    const from = [center[0] + Math.cos(angle) * 980, center[1] + Math.sin(angle) * 520];
    const end = [center[0] + Math.cos(angle) * 760, center[1] + Math.sin(angle) * 390];
    layers.push(buildLayer({
      index: nextIndex,
      name: `Friendship Badge Star ${index + 1}`,
      shapes: [goldenStarGroup(`Friendship Badge Star Shape ${index + 1}`, 34 + (index % 3) * 5, rgb("#ffffff"))],
      positionFrames: [{ t: 8 + (index % 5), s: [from[0], from[1], 0] }, { t: 70, s: [target[0], target[1], 0] }, { t: 128, s: [target[0], target[1], 0] }, { t: 176, s: [end[0], end[1], 0] }],
      scaleFrames: [{ t: 8, s: [24, 24, 100] }, { t: 70, s: [112, 112, 100] }, { t: 128, s: [104, 104, 100] }, { t: 176, s: [70, 70, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 16 + (index % 5), s: [0] }, { t: 66, s: [96] }, { t: 150, s: [92] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: 8, s: [index * 18] }, { t: 128, s: [index * 18 + 80] }, { t: 176, s: [index * 18 + 150] }],
    }));
    nextIndex += 1;
  }
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "FRIENDSHIP", center, start: 58, peak: 86, hold: 126, end: 166, accent: rgb("#f5c65b"), fill: rgb("#fff1b4"), fontSize: 170 }));
  return makeAnimation("Friendship Star Circle", layers);
};

const buildFriendshipGrandFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildFriendshipGlowLayer(nextIndex, "Friendship Finale Warm Glow", center, rgb("#ffcf8a")));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12341, count: 72, center, minRadius: 120, maxRadius: 880, startFrame: 22, duration: 144, palette: friendshipPalette, sizeRange: [10, 30], shapeFactory: ({ size, color, index }) => index % 3 === 0 ? [heartGroup("Friendship Finale Heart", size, rgb("#ffd85a"), rgb("#ffffff"))] : index % 3 === 1 ? [goldenStarGroup("Friendship Finale Star", size, rgb("#ffffff"))] : [sparkleGroup("Friendship Finale Spark", size, color, rgb("#ffffff"))], scaleFrom: 18, scaleTo: 136, travelYScale: 0.58, rotationRange: [-180, 180] }));
  nextIndex += 72;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Friendship Finale Icons",
    shapes: [
      group("Friendship Finale Left Friend", [friendIconGroup("Finale Left Friend Shape", 170, rgb("#58c7ff"), rgb("#ffffff"))], { position: [-150, 52] }),
      group("Friendship Finale Right Friend", [friendIconGroup("Finale Right Friend Shape", 170, rgb("#ff8fcf"), rgb("#ffffff"))], { position: [150, 52] }),
    ],
    positionFrames: [{ t: 28, s: [center[0], HEIGHT + 160, 0] }, { t: 72, s: [center[0], center[1] + 90, 0] }, { t: 128, s: [center[0], center[1] + 82, 0] }, { t: 176, s: [center[0], center[1] - 40, 0] }],
    scaleFrames: [{ t: 28, s: [28, 28, 100] }, { t: 72, s: [110, 110, 100] }, { t: 128, s: [102, 102, 100] }, { t: 176, s: [72, 72, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 34, s: [0] }, { t: 64, s: [100] }, { t: 150, s: [94] }, { t: 176, s: [0] }],
  }));
  nextIndex += 1;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "FRIENDSHIP", center: [WIDTH / 2, HEIGHT * 0.3], start: 58, peak: 86, hold: 126, end: 166, accent: rgb("#ffcf8a"), fill: rgb("#fff1b4"), fontSize: 168 }));
  return makeAnimation("Friendship Grand Finale", layers);
};

const casinoEmotionPalette = {
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  white: rgb("#ffffff"),
  pink: rgb("#ff4fd8"),
  cyan: rgb("#58c7ff"),
  green: rgb("#23bf66"),
  orange: rgb("#ff7a1a"),
  red: rgb("#ff3f35"),
  purple: rgb("#8f5bff"),
};

const diceGroup = (name, size, body = rgb("#ffffff"), pip = rgb("#151428"), accent = rgb("#23bf66")) => {
  const pipRadius = size * 0.07;
  const pipAt = (label, x, y) => group(label, [
    ellipseShape(`${label} Path`, pipRadius * 2, pipRadius * 2),
    fillNode(`${label} Fill`, pip, 92),
  ], { position: [x * size, y * size] });

  return group(name, [
    group("Dice Glow", [
      rectShape("Dice Glow Path", size * 1.28, size * 1.28, size * 0.22),
      fillNode("Dice Glow Fill", accent, 10),
    ]),
    group("Dice Body", [
      rectShape("Dice Body Path", size, size, size * 0.16),
      fillNode("Dice Body Fill", body, 94),
      strokeNode("Dice Rim", accent, Math.max(4, size * 0.05), 72),
    ]),
    group("Dice Shine", [
      ellipseShape("Dice Shine Path", size * 0.28, size * 0.16),
      fillNode("Dice Shine Fill", rgb("#ffffff"), 30),
    ], { position: [-(size * 0.22), -(size * 0.28)], rotation: -18 }),
    pipAt("Pip One", -0.25, -0.25),
    pipAt("Pip Two", 0.25, 0.25),
    pipAt("Pip Three", 0.25, -0.25),
    pipAt("Pip Four", -0.25, 0.25),
    pipAt("Pip Center", 0, 0),
  ]);
};

const devilFaceGroup = (name, size, face = rgb("#ff3f35"), accent = rgb("#8f5bff")) =>
  group(name, [
    group("Devil Glow", [
      ellipseShape("Devil Glow Path", size * 1.55, size * 1.35),
      fillNode("Devil Glow Fill", accent, 14),
    ]),
    group("Left Horn", [
      pathShape("Left Horn Path", [[-(size * 0.36), -(size * 0.38)], [-(size * 0.52), -(size * 0.76)], [-(size * 0.18), -(size * 0.52)]], true),
      fillNode("Left Horn Fill", accent, 94),
    ]),
    group("Right Horn", [
      pathShape("Right Horn Path", [[size * 0.36, -(size * 0.38)], [size * 0.52, -(size * 0.76)], [size * 0.18, -(size * 0.52)]], true),
      fillNode("Right Horn Fill", accent, 94),
    ]),
    group("Face", [
      ellipseShape("Devil Face Path", size, size * 0.88),
      fillNode("Devil Face Fill", face, 94),
      strokeNode("Devil Face Rim", rgb("#ffffff"), Math.max(3, size * 0.035), 36),
    ]),
    group("Left Eye", [
      pathShape("Left Eye Path", [[-(size * 0.28), -(size * 0.12)], [-(size * 0.1), -(size * 0.05)]], false),
      strokeNode("Left Eye Stroke", rgb("#ffffff"), Math.max(4, size * 0.045), 92),
    ]),
    group("Right Eye", [
      pathShape("Right Eye Path", [[size * 0.28, -(size * 0.12)], [size * 0.1, -(size * 0.05)]], false),
      strokeNode("Right Eye Stroke", rgb("#ffffff"), Math.max(4, size * 0.045), 92),
    ]),
    lineStrokeGroup("Cheeky Smile", [[-(size * 0.24), size * 0.18], [0, size * 0.3], [size * 0.24, size * 0.18]], rgb("#ffffff"), Math.max(4, size * 0.045), accent, Math.max(1.5, size * 0.018), 18, 86),
    sparkleGroup("Devil Spark", Math.max(12, size * 0.08), rgb("#ffffff"), accent),
  ]);

const flameGroup = (name, size, color = rgb("#ff7a1a"), accent = rgb("#fff1b4")) =>
  group(name, [
    group("Flame Glow", [
      ellipseShape("Flame Glow Path", size * 1.2, size * 1.6),
      fillNode("Flame Glow Fill", color, 13),
    ]),
    group("Flame Body", [
      pathShape("Flame Body Path", teardropPoints(size * 0.75, size * 1.25), true),
      fillNode("Flame Body Fill", color, 92),
    ]),
    group("Flame Core", [
      pathShape("Flame Core Path", teardropPoints(size * 0.36, size * 0.72), true),
      fillNode("Flame Core Fill", accent, 60),
    ], { position: [0, size * 0.08] }),
    sparkleGroup("Flame Spark", Math.max(7, size * 0.1), accent, color),
  ]);

const buildCasinoEmotionGlow = (index, name, center, color = casinoEmotionPalette.gold) =>
  buildLayer({
    index,
    name,
    shapes: [
      group("Emotion Wide Glow", [ellipseShape("Emotion Wide Glow Path", 1120, 440), fillNode("Emotion Wide Glow Fill", color, 10)]),
      group("Emotion Core Glow", [ellipseShape("Emotion Core Glow Path", 580, 220), fillNode("Emotion Core Glow Fill", rgb("#ffffff"), 8)]),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [18, 18, 100] }, { t: 70, s: [114, 114, 100] }, { t: 128, s: [110, 110, 100] }, { t: 179, s: [132, 132, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [78] }, { t: 128, s: [74] }, { t: 179, s: [0] }],
  });

const buildCasinoSparkBurst = (startIndex, seed, center, count = 58, palette = [casinoEmotionPalette.gold, casinoEmotionPalette.goldLight, casinoEmotionPalette.white]) =>
  buildRadialBurstLayers(startIndex, { seed, count, center, minRadius: 120, maxRadius: 840, startFrame: 24, duration: 142, palette, sizeRange: [8, 24], shapeFactory: ({ size, color }) => [sparkleGroup("Casino Emotion Spark", size, color, rgb("#ffffff"))], scaleFrom: 16, scaleTo: 128, travelYScale: 0.56, rotationRange: [-180, 180] });

const buildJackpotFever = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildCasinoEmotionGlow(nextIndex, "Jackpot Fever Glow", center, casinoEmotionPalette.gold));
  nextIndex += 1;
  layers.push(...buildVictoryBeamLayers(nextIndex, 12401, center, 24));
  nextIndex += 24;
  layers.push(...buildCasinoSparkBurst(nextIndex, 12402, center, 68));
  nextIndex += 68;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "JACKPOT!", center, start: 54, peak: 84, hold: 128, end: 166, accent: casinoEmotionPalette.gold, fill: casinoEmotionPalette.goldLight, fontSize: 210 }));
  return makeAnimation("Jackpot Fever", layers);
};

const buildBingoShock = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildBingoBallsGlowLayer(nextIndex, "Bingo Shock Charge", casinoEmotionPalette.cyan, center));
  nextIndex += 1;
  const balls = buildBingoBallMotionLayers(nextIndex, [
    { startFrame: 4, from: [-160, 160], mid: [480, 300], hold: [410, 310], to: [-220, 240], radius: 78, ball: fullscreenBingoBallPalette[1] },
    { startFrame: 8, from: [WIDTH + 160, 170], mid: [1450, 300], hold: [1510, 330], to: [WIDTH + 220, 250], radius: 84, ball: fullscreenBingoBallPalette[2] },
    { startFrame: 12, from: [300, -150], mid: [710, 260], hold: [690, 270], to: [240, -220], radius: 70, ball: fullscreenBingoBallPalette[4] },
    { startFrame: 16, from: [1600, HEIGHT + 170], mid: [1240, 640], hold: [1270, 600], to: [1700, HEIGHT + 220], radius: 86, ball: fullscreenBingoBallPalette[0] },
  ]);
  layers.push(...balls);
  nextIndex += balls.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 12411, count: 5, center, radiusRange: [150, 500], widthRange: [8, 16], palette: [casinoEmotionPalette.cyan, casinoEmotionPalette.gold, casinoEmotionPalette.white], accentPalette: [casinoEmotionPalette.white], startFrame: 42, durationRange: [84, 126], scaleFrom: 24, scaleTo: 190 }));
  nextIndex += 5;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "BINGO!", center: [center[0], center[1] - 8], start: 56, peak: 86, hold: 126, end: 166, accent: casinoEmotionPalette.cyan, fill: casinoEmotionPalette.goldLight, fontSize: 285 }));
  return makeAnimation("Bingo Shock", layers);
};

const buildOmgBigWin = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildCasinoEmotionGlow(nextIndex, "OMG Big Win Glow", center, casinoEmotionPalette.pink));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 12421, count: 6, center, radiusRange: [140, 480], widthRange: [7, 15], palette: [casinoEmotionPalette.pink, casinoEmotionPalette.gold, casinoEmotionPalette.white], accentPalette: [casinoEmotionPalette.white], startFrame: 28, durationRange: [88, 130], scaleFrom: 22, scaleTo: 170 }));
  nextIndex += 6;
  layers.push(...buildCasinoSparkBurst(nextIndex, 12422, center, 62, [casinoEmotionPalette.pink, casinoEmotionPalette.goldLight, casinoEmotionPalette.white]));
  nextIndex += 62;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "OMG!", center, start: 50, peak: 80, hold: 124, end: 166, accent: casinoEmotionPalette.pink, fill: casinoEmotionPalette.goldLight, fontSize: 320 }));
  return makeAnimation("OMG Big Win", layers);
};

const buildHotStreak = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildCasinoEmotionGlow(nextIndex, "Hot Streak Glow", center, casinoEmotionPalette.orange));
  nextIndex += 1;
  for (let index = 0; index < 16; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const y = 130 + (index % 8) * 96;
    layers.push(buildLayer({
      index: nextIndex,
      name: `Hot Streak Flame ${index + 1}`,
      shapes: [flameGroup(`Hot Streak Flame Shape ${index + 1}`, 70 + (index % 4) * 12, index % 3 === 0 ? casinoEmotionPalette.red : casinoEmotionPalette.orange, casinoEmotionPalette.goldLight)],
      positionFrames: [{ t: 8 + index, s: [side < 0 ? -120 : WIDTH + 120, y, 0] }, { t: 64, s: [center[0] + side * (180 + (index % 5) * 70), center[1] + (index % 4 - 1.5) * 80, 0] }, { t: 128, s: [center[0] + side * (200 + (index % 5) * 70), center[1] + (index % 4 - 1.5) * 80, 0] }, { t: 176, s: [center[0] + side * 760, y, 0] }],
      scaleFrames: [{ t: 8 + index, s: [28, 28, 100] }, { t: 64, s: [112, 112, 100] }, { t: 128, s: [100, 100, 100] }, { t: 176, s: [70, 70, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 18 + index, s: [0] }, { t: 62, s: [92] }, { t: 150, s: [80] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: 8 + index, s: [side * -24] }, { t: 128, s: [side * 12] }],
    }));
    nextIndex += 1;
  }
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "HOT STREAK!", center: [center[0], center[1] - 6], start: 56, peak: 86, hold: 128, end: 166, accent: casinoEmotionPalette.orange, fill: casinoEmotionPalette.goldLight, fontSize: 170 }));
  return makeAnimation("Hot Streak", layers);
};

const buildLuckyDiamondHit = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildCasinoEmotionGlow(nextIndex, "Lucky Diamond Hit Glow", center, casinoEmotionPalette.cyan));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12441, count: 46, center, minRadius: 120, maxRadius: 820, startFrame: 18, duration: 146, palette: [casinoEmotionPalette.cyan, casinoEmotionPalette.white, casinoEmotionPalette.goldLight], sizeRange: [12, 34], shapeFactory: ({ size, color }) => [shardGroup("Lucky Diamond Shard", size, color, casinoEmotionPalette.white)], scaleFrom: 18, scaleTo: 132, travelYScale: 0.54, rotationRange: [-220, 220] }));
  nextIndex += 46;
  layers.push(buildHeroFlowerLayer(nextIndex, "Lucky Diamond Hero", [diamondHeroGroup("Lucky Diamond Shape", 240)], 50, 94, 168, center));
  return makeAnimation("Lucky Diamond Hit", layers);
};

const buildLuckyRoll = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.54];
  layers.push(buildCasinoEmotionGlow(nextIndex, "Lucky Roll Glow", center, casinoEmotionPalette.green));
  nextIndex += 1;
  const dice = [
    { from: [-160, 270], hold: [center[0] - 190, center[1] + 30], to: [-220, 380], color: casinoEmotionPalette.green, rot: 360 },
    { from: [WIDTH + 160, 300], hold: [center[0] + 190, center[1] + 34], to: [WIDTH + 220, 390], color: casinoEmotionPalette.gold, rot: -360 },
  ];
  for (const [index, die] of dice.entries()) {
    layers.push(buildLayer({
      index: nextIndex,
      name: `Lucky Roll Dice ${index + 1}`,
      shapes: [diceGroup(`Lucky Roll Dice Shape ${index + 1}`, 170, casinoEmotionPalette.white, rgb("#151428"), die.color)],
      positionFrames: [{ t: 4 + index * 6, s: [die.from[0], die.from[1], 0] }, { t: 70, s: [die.hold[0], die.hold[1], 0] }, { t: 128, s: [die.hold[0], die.hold[1] - 8, 0] }, { t: 176, s: [die.to[0], die.to[1], 0] }],
      scaleFrames: [{ t: 4 + index * 6, s: [32, 32, 100] }, { t: 70, s: [112, 112, 100] }, { t: 128, s: [104, 104, 100] }, { t: 176, s: [72, 72, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 14 + index * 6, s: [0] }, { t: 62, s: [100] }, { t: 150, s: [94] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: 4 + index * 6, s: [0] }, { t: 70, s: [die.rot] }, { t: 176, s: [die.rot * 1.3] }],
    }));
    nextIndex += 1;
  }
  layers.push(...buildCasinoSparkBurst(nextIndex, 12451, center, 44, [casinoEmotionPalette.green, casinoEmotionPalette.goldLight, casinoEmotionPalette.white]));
  nextIndex += 44;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "LUCKY!", center: [center[0], HEIGHT * 0.32], start: 58, peak: 86, hold: 124, end: 166, accent: casinoEmotionPalette.green, fill: casinoEmotionPalette.goldLight, fontSize: 250 }));
  return makeAnimation("Lucky Roll", layers);
};

const buildElectricWinPulse = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildCasinoEmotionGlow(nextIndex, "Electric Win Pulse Glow", center, casinoEmotionPalette.cyan));
  nextIndex += 1;
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2;
    layers.push(buildLayer({
      index: nextIndex,
      name: `Electric Win Arc ${index + 1}`,
      shapes: [lightningGroup(`Electric Win Arc Shape ${index + 1}`, 70 + (index % 3) * 12, 250 + (index % 4) * 42, casinoEmotionPalette.white, casinoEmotionPalette.cyan)],
      positionFrames: [{ t: 16, s: [center[0] + Math.cos(angle) * 620, center[1] + Math.sin(angle) * 300, 0] }, { t: 70, s: [center[0] + Math.cos(angle) * 250, center[1] + Math.sin(angle) * 130, 0] }, { t: 138, s: [center[0] + Math.cos(angle) * 290, center[1] + Math.sin(angle) * 150, 0] }, { t: 176, s: [center[0] + Math.cos(angle) * 820, center[1] + Math.sin(angle) * 400, 0] }],
      scaleFrames: [{ t: 16, s: [30, 30, 100] }, { t: 70, s: [106, 106, 100] }, { t: 138, s: [96, 96, 100] }, { t: 176, s: [62, 62, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 24, s: [0] }, { t: 66, s: [92] }, { t: 138, s: [68] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: 16, s: [(angle * 180) / Math.PI] }, { t: 176, s: [(angle * 180) / Math.PI + 60] }],
    }));
    nextIndex += 1;
  }
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 12461, count: 5, center, radiusRange: [120, 480], widthRange: [8, 16], palette: [casinoEmotionPalette.cyan, casinoEmotionPalette.white], accentPalette: [casinoEmotionPalette.white], startFrame: 36, durationRange: [82, 120], scaleFrom: 22, scaleTo: 180 }));
  return makeAnimation("Electric Win Pulse", layers);
};

const buildMoneyRush = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildCasinoEmotionGlow(nextIndex, "Money Rush Glow", center, casinoEmotionPalette.gold));
  nextIndex += 1;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12471, count: 64, center, minRadius: 120, maxRadius: 900, startFrame: 18, duration: 148, palette: [casinoEmotionPalette.gold, casinoEmotionPalette.goldLight, casinoEmotionPalette.green], sizeRange: [16, 42], shapeFactory: ({ size, color, index }) => index % 3 === 0 ? [coinGroup("Money Rush Coin", size * 0.5, casinoEmotionPalette.gold, casinoEmotionPalette.goldLight)] : [moneySymbolGroup("Money Rush Symbol", size, color)], scaleFrom: 18, scaleTo: 138, travelYScale: 0.62, rotationRange: [-180, 180] }));
  nextIndex += 64;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "BIG WIN!", center, start: 56, peak: 86, hold: 126, end: 166, accent: casinoEmotionPalette.green, fill: casinoEmotionPalette.goldLight, fontSize: 230 }));
  return makeAnimation("Money Rush", layers);
};

const buildTrollWin = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildCasinoEmotionGlow(nextIndex, "Troll Win Glow", center, casinoEmotionPalette.purple));
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Troll Win Face Hero", [devilFaceGroup("Troll Win Face Shape", 230, casinoEmotionPalette.red, casinoEmotionPalette.purple)], 34, 84, 166, [center[0], center[1] + 40]));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 12481, count: 5, center, radiusRange: [150, 420], widthRange: [7, 14], palette: [casinoEmotionPalette.purple, casinoEmotionPalette.red, casinoEmotionPalette.white], accentPalette: [casinoEmotionPalette.white], startFrame: 32, durationRange: [84, 122], scaleFrom: 22, scaleTo: 170 }));
  nextIndex += 5;
  layers.push(...buildCasinoSparkBurst(nextIndex, 12482, center, 44, [casinoEmotionPalette.purple, casinoEmotionPalette.red, casinoEmotionPalette.white]));
  nextIndex += 44;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "HAHA!", center: [center[0], HEIGHT * 0.3], start: 56, peak: 84, hold: 124, end: 166, accent: casinoEmotionPalette.purple, fill: casinoEmotionPalette.goldLight, fontSize: 260 }));
  return makeAnimation("Troll Win", layers);
};

const buildMiracleHit = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildCasinoEmotionGlow(nextIndex, "Miracle Hit Divine Glow", center, casinoEmotionPalette.goldLight));
  nextIndex += 1;
  layers.push(...buildVictoryBeamLayers(nextIndex, 12491, center, 24));
  nextIndex += 24;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 12492, count: 70, center, minRadius: 120, maxRadius: 880, startFrame: 18, duration: 148, palette: [casinoEmotionPalette.goldLight, casinoEmotionPalette.white, casinoEmotionPalette.gold], sizeRange: [10, 32], shapeFactory: ({ size, index }) => index % 3 === 0 ? [goldenStarGroup("Miracle Star", size, casinoEmotionPalette.white)] : [sparkleGroup("Miracle Spark", size * 0.8, casinoEmotionPalette.goldLight, casinoEmotionPalette.white)], scaleFrom: 16, scaleTo: 136, travelYScale: 0.54, rotationRange: [-180, 180] }));
  nextIndex += 70;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "MIRACLE!", center, start: 56, peak: 86, hold: 126, end: 166, accent: casinoEmotionPalette.goldLight, fill: casinoEmotionPalette.white, fontSize: 210 }));
  return makeAnimation("Miracle Hit", layers);
};

const laughterPalette = {
  yellow: rgb("#ffd85a"),
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  orange: rgb("#ff9c36"),
  pink: rgb("#ff4fd8"),
  cyan: rgb("#58c7ff"),
  white: rgb("#ffffff"),
  dark: rgb("#24130a"),
};

const laughingEmojiGroup = (name, size, face = laughterPalette.yellow, accent = laughterPalette.white) =>
  group(name, [
    group("Laugh Emoji Glow", [
      ellipseShape("Laugh Emoji Glow Path", size * 1.35, size * 1.35),
      fillNode("Laugh Emoji Glow Fill", face, 12),
    ]),
    group("Laugh Emoji Face", [
      ellipseShape("Laugh Emoji Face Path", size, size),
      fillNode("Laugh Emoji Face Fill", face, 96),
      strokeNode("Laugh Emoji Rim", accent, Math.max(3, size * 0.035), 36),
    ]),
    group("Left Laugh Eye", [
      pathShape("Left Laugh Eye Path", [[-(size * 0.28), -(size * 0.1)], [-(size * 0.16), -(size * 0.2)], [-(size * 0.04), -(size * 0.1)]], false),
      strokeNode("Left Laugh Eye Stroke", laughterPalette.dark, Math.max(4, size * 0.045), 90),
    ]),
    group("Right Laugh Eye", [
      pathShape("Right Laugh Eye Path", [[size * 0.28, -(size * 0.1)], [size * 0.16, -(size * 0.2)], [size * 0.04, -(size * 0.1)]], false),
      strokeNode("Right Laugh Eye Stroke", laughterPalette.dark, Math.max(4, size * 0.045), 90),
    ]),
    group("Laugh Mouth", [
      ellipseShape("Laugh Mouth Path", size * 0.48, size * 0.34),
      fillNode("Laugh Mouth Fill", laughterPalette.dark, 88),
    ], { position: [0, size * 0.18] }),
    group("Laugh Mouth Shine", [
      ellipseShape("Laugh Mouth Shine Path", size * 0.28, size * 0.11),
      fillNode("Laugh Mouth Shine Fill", accent, 36),
    ], { position: [0, size * 0.09] }),
    group("Left Tear", [
      ellipseShape("Left Tear Path", size * 0.12, size * 0.22),
      fillNode("Left Tear Fill", laughterPalette.cyan, 86),
    ], { position: [-(size * 0.34), size * 0.04], rotation: 18 }),
    group("Right Tear", [
      ellipseShape("Right Tear Path", size * 0.12, size * 0.22),
      fillNode("Right Tear Fill", laughterPalette.cyan, 86),
    ], { position: [size * 0.34, size * 0.04], rotation: -18 }),
    sparkleGroup("Laugh Emoji Spark", Math.max(8, size * 0.07), accent, face),
  ]);

const buildLaughterGlow = (index, name, center, color = laughterPalette.yellow) =>
  buildLayer({
    index,
    name,
    shapes: [
      group("Laughter Wide Glow", [ellipseShape("Laughter Wide Glow Path", 1120, 430), fillNode("Laughter Wide Glow Fill", color, 10)]),
      group("Laughter Core Glow", [ellipseShape("Laughter Core Glow Path", 580, 220), fillNode("Laughter Core Glow Fill", laughterPalette.goldLight, 8)]),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [18, 18, 100] }, { t: 68, s: [114, 114, 100] }, { t: 128, s: [110, 110, 100] }, { t: 179, s: [132, 132, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 18, s: [78] }, { t: 128, s: [74] }, { t: 179, s: [0] }],
  });

const buildLaughEmojiBurst = (startIndex, seed, count, center) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 120,
    maxRadius: 860,
    startFrame: 22,
    duration: 144,
    palette: [laughterPalette.yellow, laughterPalette.goldLight, laughterPalette.orange],
    sizeRange: [18, 42],
    shapeFactory: ({ size, index }) => index % 3 === 0
      ? [laughingEmojiGroup("Laugh Emoji Particle", size * 1.8, laughterPalette.yellow, laughterPalette.white)]
      : [sparkleGroup("Laugh Spark", size, index % 2 === 0 ? laughterPalette.goldLight : laughterPalette.orange, laughterPalette.white)],
    scaleFrom: 18,
    scaleTo: 136,
    travelYScale: 0.6,
    rotationRange: [-180, 180],
  });

const buildGiantLolBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildLaughterGlow(nextIndex, "Giant LOL Glow", center));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 12501, count: 6, center, radiusRange: [130, 460], widthRange: [7, 15], palette: [laughterPalette.yellow, laughterPalette.orange, laughterPalette.white], accentPalette: [laughterPalette.white], startFrame: 30, durationRange: [82, 126], scaleFrom: 22, scaleTo: 176 }));
  nextIndex += 6;
  layers.push(...buildLaughEmojiBurst(nextIndex, 12502, 54, center));
  nextIndex += 54;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "LOL", center, start: 50, peak: 80, hold: 124, end: 166, accent: laughterPalette.orange, fill: laughterPalette.goldLight, fontSize: 350 }));
  return makeAnimation("Giant LOL Burst", layers);
};

const buildLaughingEmojiStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildLaughterGlow(nextIndex, "Laughing Emoji Storm Glow", center));
  nextIndex += 1;
  layers.push(...buildLaughEmojiBurst(nextIndex, 12511, 72, center));
  nextIndex += 72;
  layers.push(buildHeroFlowerLayer(nextIndex, "Laughing Emoji Hero", [laughingEmojiGroup("Laughing Emoji Hero Shape", 300, laughterPalette.yellow, laughterPalette.white)], 54, 92, 168, center));
  return makeAnimation("Laughing Emoji Storm", layers);
};

const buildHahahaTextWave = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildLaughterGlow(nextIndex, "HAHAHA Text Wave Glow", center, laughterPalette.orange));
  nextIndex += 1;
  for (let index = 0; index < 10; index += 1) {
    const start = 8 + index * 5;
    const y = HEIGHT * 0.28 + Math.sin(index * 0.8) * 110;
    layers.push(buildTextLayer({
      index: nextIndex,
      name: `HAHA Wave Small ${index + 1}`,
      text: "HA",
      fontSize: 110,
      fillColor: index % 2 === 0 ? laughterPalette.goldLight : laughterPalette.orange,
      strokeColor: laughterPalette.white,
      strokeWidth: 4,
      positionFrames: [{ t: start, s: [-140, y, 0] }, { t: 74, s: [260 + index * 150, y + Math.sin(index) * 40, 0] }, { t: 140, s: [430 + index * 150, y + 40, 0] }, { t: 176, s: [WIDTH + 160, y + 90, 0] }],
      scaleFrames: [{ t: start, s: [40, 40, 100] }, { t: 74, s: [106, 106, 100] }, { t: 140, s: [96, 96, 100] }, { t: 176, s: [60, 60, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: start + 10, s: [92] }, { t: 150, s: [76] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: start, s: [-12 + index * 3] }, { t: 176, s: [18] }],
    }));
    nextIndex += 1;
  }
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 12521, count: 4, center, radiusRange: [150, 420], widthRange: [7, 13], palette: [laughterPalette.orange, laughterPalette.yellow, laughterPalette.white], accentPalette: [laughterPalette.white], startFrame: 40, durationRange: [84, 120], scaleFrom: 22, scaleTo: 170 }));
  nextIndex += 4;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "HAHAHA!", center, start: 58, peak: 86, hold: 126, end: 166, accent: laughterPalette.orange, fill: laughterPalette.goldLight, fontSize: 220 }));
  return makeAnimation("HAHAHA Text Wave", layers);
};

const buildRoflJackpot = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildLaughterGlow(nextIndex, "ROFL Jackpot Glow", center, laughterPalette.pink));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 12531, count: 6, center, radiusRange: [130, 480], widthRange: [7, 15], palette: [laughterPalette.pink, laughterPalette.yellow, laughterPalette.white], accentPalette: [laughterPalette.white], startFrame: 28, durationRange: [84, 128], scaleFrom: 22, scaleTo: 178 }));
  nextIndex += 6;
  layers.push(...buildLaughEmojiBurst(nextIndex, 12532, 50, center));
  nextIndex += 50;
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "ROFL!", center, start: 52, peak: 82, hold: 126, end: 166, accent: laughterPalette.pink, fill: laughterPalette.goldLight, fontSize: 280 }));
  return makeAnimation("ROFL Jackpot", layers);
};

const buildLaughterGrandFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildLaughterGlow(nextIndex, "Laughter Finale Glow", center));
  nextIndex += 1;
  layers.push(...buildLaughEmojiBurst(nextIndex, 12541, 76, center));
  nextIndex += 76;
  for (let index = 0; index < 8; index += 1) {
    layers.push(buildTextLayer({
      index: nextIndex,
      name: `Finale HAHA Wave ${index + 1}`,
      text: "HAHA",
      fontSize: 92,
      fillColor: index % 2 === 0 ? laughterPalette.goldLight : laughterPalette.orange,
      strokeColor: laughterPalette.white,
      strokeWidth: 3,
      positionFrames: [{ t: 24 + index * 3, s: [-140, HEIGHT * 0.26 + index * 58, 0] }, { t: 90, s: [360 + index * 150, HEIGHT * 0.24 + index * 48, 0] }, { t: 176, s: [WIDTH + 180, HEIGHT * 0.3 + index * 50, 0] }],
      scaleFrames: [{ t: 24 + index * 3, s: [34, 34, 100] }, { t: 90, s: [96, 96, 100] }, { t: 176, s: [58, 58, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 34 + index * 3, s: [82] }, { t: 148, s: [62] }, { t: 176, s: [0] }],
      rotationFrames: [{ t: 24, s: [-10] }, { t: 176, s: [14] }],
    }));
    nextIndex += 1;
  }
  layers.push(...buildWinHeroTextLayers(nextIndex, { text: "LOL!", center, start: 54, peak: 84, hold: 128, end: 166, accent: laughterPalette.orange, fill: laughterPalette.goldLight, fontSize: 330 }));
  return makeAnimation("Laughter Grand Finale", layers);
};

const starPoints = (outerRadius, innerRadius, rotation = -Math.PI / 2) =>
  Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation + ((index / 10) * Math.PI * 2);
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });

const goldenStarGroup = (name, size, accent = rgb("#fff6d6")) =>
  group(name, [
    group("Star Glow", [
      pathShape("Star Glow Path", starPoints(size * 1.14, size * 0.52), true),
      fillNode("Star Glow Fill", rgb("#f5c65b"), 18),
    ]),
    group("Star Body", [
      pathShape("Star Body Path", starPoints(size, size * 0.44), true),
      fillNode("Star Body Fill", rgb("#f5c65b"), 96),
    ]),
    group("Star Inner Shine", [
      pathShape("Star Inner Shine Path", starPoints(size * 0.62, size * 0.28), true),
      fillNode("Star Inner Shine Fill", rgb("#fff1b4"), 48),
    ]),
    group("Star Edge", [
      pathShape("Star Edge Path", starPoints(size, size * 0.44), true),
      strokeNode("Star Edge Stroke", accent, Math.max(3, size * 0.04), 74),
    ]),
    sparkleGroup("Star Glint", Math.max(7, size * 0.12), rgb("#ffffff"), accent),
  ]);

const goldPalette = [rgb("#f5c65b"), rgb("#ffde8b"), rgb("#fff1b4"), rgb("#ffffff")];

const buildGoldenStarRainFullscreen = () => {
  let nextIndex = 1;
  const layers = [];

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Gold Jackpot Atmosphere",
      shapes: [
        group("Gold Glow Wide", [
          ellipseShape("Gold Glow Wide Path", 1080, 480),
          fillNode("Gold Glow Wide Fill", rgb("#f5c65b"), 10),
        ]),
        group("Gold Glow Hot", [
          ellipseShape("Gold Glow Hot Path", 620, 280),
          fillNode("Gold Glow Hot Fill", rgb("#fff1b4"), 8),
        ]),
      ],
      positionFrames: [{ t: 0, s: [WIDTH * 0.5, HEIGHT * 0.44, 0] }],
      scaleFrames: [
        { t: 0, s: [60, 60, 100] },
        { t: 34, s: [100, 100, 100] },
        { t: 101, s: [116, 116, 100] },
        { t: 179, s: [128, 128, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 16, s: [42] },
        { t: 101, s: [72] },
        { t: 135, s: [38] },
        { t: 179, s: [0] },
      ],
    }),
  );
  nextIndex += 1;

  const rain = buildFallingLayers(nextIndex, {
    seed: 1201,
    count: 34,
    startY: -170,
    endY: HEIGHT + 190,
    xRange: [60, WIDTH - 60],
    palette: goldPalette,
    sizeRange: [22, 54],
    shapeFactory: ({ size, index }) => [goldenStarGroup(`Rain Star ${index}`, size)],
  });
  layers.push(...rain);
  nextIndex += rain.length;

  const heroSparkles = buildRadialBurstLayers(nextIndex, {
    seed: 1202,
    count: 22,
    center: [WIDTH * 0.5, HEIGHT * 0.48],
    minRadius: 160,
    maxRadius: 540,
    startFrame: 44,
    duration: 96,
    palette: goldPalette,
    sizeRange: [12, 24],
    shapeFactory: ({ size, color }) => [sparkleGroup("Gold Rain Sparkle", size, color, rgb("#fff6d6"))],
    scaleFrom: 28,
    scaleTo: 112,
    travelYScale: 0.6,
  });
  layers.push(...heroSparkles);
  nextIndex += heroSparkles.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 1203,
    count: 3,
    center: [WIDTH * 0.5, HEIGHT * 0.5],
    radiusRange: [220, 440],
    widthRange: [8, 15],
    palette: [rgb("#f5c65b"), rgb("#fff1b4")],
    accentPalette: [rgb("#ffffff"), rgb("#ffde8b")],
    startFrame: 54,
    durationRange: [54, 86],
    scaleFrom: 18,
    scaleTo: 180,
  });
  layers.push(...rings);

  return makeAnimation("Gold Star Jackpot Rain", layers);
};

const buildMegaStarExplosionFullscreen = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.5];

  const gather = buildRadialBurstLayers(nextIndex, {
    seed: 1211,
    count: 30,
    center,
    minRadius: 90,
    maxRadius: 230,
    startFrame: 0,
    duration: 70,
    palette: goldPalette,
    sizeRange: [10, 24],
    shapeFactory: ({ size, index }) => [goldenStarGroup(`Gather Star ${index}`, size)],
    scaleFrom: 18,
    scaleTo: 24,
    travelYScale: 0.72,
  });
  layers.push(...gather);
  nextIndex += gather.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Mega Hero Star",
      shapes: [goldenStarGroup("Mega Hero Star Shape", 188)],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 0, s: [0, 0, 100] },
        { t: 34, s: [42, 42, 100] },
        { t: 68, s: [128, 128, 100] },
        { t: 86, s: [90, 90, 100] },
        { t: 112, s: [104, 104, 100] },
        { t: 154, s: [96, 96, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 20, s: [92] },
        { t: 112, s: [100] },
        { t: 152, s: [48] },
        { t: 179, s: [0] },
      ],
      rotationFrames: [
        { t: 0, s: [-18] },
        { t: 68, s: [0] },
        { t: 179, s: [18] },
      ],
    }),
  );
  nextIndex += 1;

  const burst = buildRadialBurstLayers(nextIndex, {
    seed: 1212,
    count: 42,
    center,
    minRadius: 220,
    maxRadius: 930,
    startFrame: 60,
    duration: 100,
    palette: goldPalette,
    sizeRange: [18, 46],
    shapeFactory: ({ size, index }) => [goldenStarGroup(`Burst Star ${index}`, size)],
    scaleFrom: 20,
    scaleTo: 126,
    travelYScale: 0.58,
    rotationRange: [-240, 240],
  });
  layers.push(...burst);
  nextIndex += burst.length;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 1213,
    count: 4,
    center,
    radiusRange: [160, 520],
    widthRange: [9, 18],
    palette: [rgb("#f5c65b"), rgb("#ffffff")],
    accentPalette: [rgb("#fff1b4"), rgb("#ffde8b")],
    startFrame: 62,
    durationRange: [44, 86],
    scaleFrom: 14,
    scaleTo: 210,
  });
  layers.push(...rings);

  return makeAnimation("Mega Star Explosion", layers);
};

const buildGoldenGalaxySpiralFullscreen = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.49];

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Galaxy Core Glow",
      shapes: [
        group("Galaxy Glow", [
          ellipseShape("Galaxy Glow Path", 900, 380),
          fillNode("Galaxy Glow Fill", rgb("#f5c65b"), 10),
        ]),
        group("Galaxy Core", [
          ellipseShape("Galaxy Core Path", 280, 140),
          fillNode("Galaxy Core Fill", rgb("#fff1b4"), 12),
        ]),
      ],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 0, s: [22, 22, 100] },
        { t: 34, s: [64, 64, 100] },
        { t: 68, s: [100, 100, 100] },
        { t: 112, s: [100, 100, 100] },
        { t: 135, s: [108, 108, 100] },
        { t: 179, s: [126, 126, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 18, s: [24] },
        { t: 68, s: [72] },
        { t: 112, s: [72] },
        { t: 135, s: [38] },
        { t: 179, s: [0] },
      ],
      rotationFrames: [
        { t: 0, s: [-10] },
        { t: 68, s: [0] },
        { t: 112, s: [0] },
        { t: 179, s: [18] },
      ],
    }),
  );
  nextIndex += 1;

  const rng = createRng(1221);
  const armCount = 5;
  const starsPerArm = 13;

  for (let arm = 0; arm < armCount; arm += 1) {
    const trailPoints = [];
    for (let step = 0; step < starsPerArm; step += 1) {
      const progress = step / (starsPerArm - 1);
      const angle = (arm / armCount) * Math.PI * 2 + 0.42 + (progress * Math.PI * 1.72);
      const radius = 86 + (progress * 640);
      trailPoints.push([
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.48,
      ]);
    }

    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Completed Galaxy Arm ${arm + 1}`,
        shapes: [
          lineStrokeGroup(
            `Galaxy Arm Trail ${arm + 1}`,
            trailPoints,
            rgb("#f5c65b"),
            13,
            rgb("#fff1b4"),
            3.2,
            14,
            46,
          ),
        ],
        positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
        scaleFrames: [
          { t: 0, s: [76, 76, 100] },
          { t: 34, s: [90, 90, 100] },
          { t: 68, s: [100, 100, 100] },
          { t: 112, s: [100, 100, 100] },
          { t: 135, s: [104, 104, 100] },
          { t: 179, s: [116, 116, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: 34, s: [0] },
          { t: 68, s: [62] },
          { t: 112, s: [62] },
          { t: 135, s: [26] },
          { t: 179, s: [0] },
        ],
        rotationFrames: [
          { t: 0, s: [0] },
          { t: 68, s: [0] },
          { t: 112, s: [0] },
          { t: 179, s: [12] },
        ],
      }),
    );
    nextIndex += 1;
  }

  for (let index = 0; index < armCount * starsPerArm; index += 1) {
    const arm = index % armCount;
    const step = Math.floor(index / armCount);
    const progress = step / (starsPerArm - 1);
    const finalAngle = (arm / armCount) * Math.PI * 2 + 0.42 + (progress * Math.PI * 1.72);
    const finalRadius = 86 + (progress * 640);
    const finalX = center[0] + (Math.cos(finalAngle) * finalRadius);
    const finalY = center[1] + (Math.sin(finalAngle) * finalRadius * 0.48);
    const edgeAngle = finalAngle - 1.35 + ((rng() - 0.5) * 0.36);
    const edgeRadius = 960 + (rng() * 260);
    const midAngle = finalAngle - 0.62;
    const midRadius = 320 + (progress * 360);
    const driftAngle = finalAngle + 0.34 + ((rng() - 0.5) * 0.24);
    const driftRadius = finalRadius + 150 + (rng() * 270);
    const exitRadius = finalRadius + 480 + (rng() * 360);
    const size = 13 + ((1 - Math.abs(progress - 0.45)) * 26) + (rng() * 9);
    const appearFrame = Math.floor(rng() * 18);
    const buildFrame = 34 + Math.floor(progress * 16);
    const formedFrame = 68;
    const holdFrame = 112;
    const loosenFrame = 135;
    const endFrame = 179;

    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Galaxy Star ${index + 1}`,
        shapes: [goldenStarGroup(`Galaxy Star Shape ${index + 1}`, size)],
        positionFrames: [
          { t: appearFrame, s: [center[0] + Math.cos(edgeAngle) * edgeRadius, center[1] + Math.sin(edgeAngle) * edgeRadius * 0.58, 0] },
          { t: buildFrame, s: [center[0] + Math.cos(midAngle) * midRadius, center[1] + Math.sin(midAngle) * midRadius * 0.54, 0] },
          { t: formedFrame, s: [finalX, finalY, 0] },
          { t: holdFrame, s: [finalX, finalY, 0] },
          { t: loosenFrame, s: [center[0] + Math.cos(driftAngle) * driftRadius, center[1] + Math.sin(driftAngle) * driftRadius * 0.52, 0] },
          { t: endFrame, s: [center[0] + Math.cos(driftAngle) * exitRadius, center[1] + Math.sin(driftAngle) * exitRadius * 0.62, 0] },
        ],
        scaleFrames: [
          { t: appearFrame, s: [18, 18, 100] },
          { t: buildFrame, s: [78, 78, 100] },
          { t: formedFrame, s: [108, 108, 100] },
          { t: holdFrame, s: [108, 108, 100] },
          { t: loosenFrame, s: [96, 96, 100] },
          { t: endFrame, s: [58, 58, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: appearFrame, s: [0] },
          { t: clampFrame(appearFrame + 10), s: [44] },
          { t: formedFrame, s: [96] },
          { t: holdFrame, s: [96] },
          { t: loosenFrame, s: [54] },
          { t: endFrame, s: [0] },
        ],
        rotationFrames: [
          { t: appearFrame, s: [finalAngle * 40] },
          { t: formedFrame, s: [finalAngle * 40 + 140] },
          { t: holdFrame, s: [finalAngle * 40 + 140] },
          { t: endFrame, s: [finalAngle * 40 + 260] },
        ],
        inFrame: appearFrame,
        outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
      }),
    );
    nextIndex += 1;
  }

  for (const [haloIndex, radius] of [240, 420, 610].entries()) {
    layers.push(
      buildLayer({
        index: nextIndex + haloIndex,
        name: `Completed Galaxy Halo ${haloIndex + 1}`,
        shapes: [ringGroup("Galaxy Hero Halo", radius, haloIndex % 2 === 0 ? rgb("#f5c65b") : rgb("#fff1b4"), rgb("#ffffff"), haloIndex === 0 ? 8 : 5)],
        positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
        scaleFrames: [
          { t: 0, s: [84, 84, 100] },
          { t: 68, s: [100, 100, 100] },
          { t: 112, s: [100, 100, 100] },
          { t: 135, s: [104, 104, 100] },
          { t: 179, s: [118, 118, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: 56, s: [0] },
          { t: 68, s: [haloIndex === 0 ? 28 : 18] },
          { t: 112, s: [haloIndex === 0 ? 28 : 18] },
          { t: 135, s: [10] },
          { t: 179, s: [0] },
        ],
      }),
    );
  }

  return makeAnimation("Golden Galaxy Spiral", layers);
};

const buildStarFlashRewardFullscreen = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.5];

  const heroStars = [
    { pos: [center[0], center[1]], size: 210, inFrame: 8, rot: 0 },
    { pos: [center[0] - 470, center[1] - 190], size: 130, inFrame: 18, rot: -18 },
    { pos: [center[0] + 470, center[1] - 165], size: 142, inFrame: 24, rot: 20 },
    { pos: [center[0] - 360, center[1] + 230], size: 118, inFrame: 30, rot: 26 },
    { pos: [center[0] + 370, center[1] + 225], size: 126, inFrame: 36, rot: -24 },
  ];

  for (const [index, star] of heroStars.entries()) {
    layers.push(
      buildLayer({
        index: nextIndex,
        name: `Reward Hero Star ${index + 1}`,
        shapes: [goldenStarGroup(`Reward Hero Star Shape ${index + 1}`, star.size)],
        positionFrames: [
          { t: star.inFrame, s: [star.pos[0], star.pos[1] + 44, 0] },
          { t: star.inFrame + 14, s: [star.pos[0], star.pos[1] - 8, 0] },
          { t: 112, s: [star.pos[0], star.pos[1], 0] },
          { t: 168, s: [star.pos[0], star.pos[1] + 24, 0] },
        ],
        scaleFrames: [
          { t: star.inFrame, s: [0, 0, 100] },
          { t: star.inFrame + 12, s: [138, 138, 100] },
          { t: star.inFrame + 24, s: [100, 100, 100] },
          { t: 112, s: [108, 108, 100] },
          { t: 168, s: [62, 62, 100] },
        ],
        opacityFrames: [
          { t: 0, s: [0] },
          { t: star.inFrame, s: [0] },
          { t: star.inFrame + 10, s: [100] },
          { t: 134, s: [94] },
          { t: 179, s: [0] },
        ],
        rotationFrames: [
          { t: star.inFrame, s: [star.rot - 18] },
          { t: 112, s: [star.rot + 10] },
          { t: 179, s: [star.rot + 34] },
        ],
        inFrame: star.inFrame,
        outFrame: DURATION_FRAMES,
      }),
    );
    nextIndex += 1;
  }

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 1231,
    count: 5,
    center,
    radiusRange: [160, 580],
    widthRange: [8, 18],
    palette: [rgb("#f5c65b"), rgb("#ffffff")],
    accentPalette: [rgb("#fff1b4"), rgb("#ffde8b")],
    startFrame: 10,
    durationRange: [44, 84],
    scaleFrom: 10,
    scaleTo: 190,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const sparkles = buildRadialBurstLayers(nextIndex, {
    seed: 1232,
    count: 26,
    center,
    minRadius: 180,
    maxRadius: 760,
    startFrame: 24,
    duration: 116,
    palette: goldPalette,
    sizeRange: [10, 22],
    shapeFactory: ({ size, color }) => [sparkleGroup("Reward Spark", size, color, rgb("#fff6d6"))],
    scaleFrom: 24,
    scaleTo: 108,
    travelYScale: 0.62,
  });
  layers.push(...sparkles);

  return makeAnimation("Star Flash Reward", layers);
};

const buildGoldenStarFinaleFullscreen = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH * 0.5, HEIGHT * 0.51];

  const rain = buildFallingLayers(nextIndex, {
    seed: 1241,
    count: 26,
    startY: -160,
    endY: HEIGHT + 150,
    xRange: [80, WIDTH - 80],
    palette: goldPalette,
    sizeRange: [16, 42],
    shapeFactory: ({ size, index }) => [goldenStarGroup(`Finale Rain Star ${index}`, size)],
  });
  layers.push(...rain);
  nextIndex += rain.length;

  const burst = buildRadialBurstLayers(nextIndex, {
    seed: 1242,
    count: 46,
    center,
    minRadius: 170,
    maxRadius: 900,
    startFrame: 58,
    duration: 104,
    palette: goldPalette,
    sizeRange: [14, 42],
    shapeFactory: ({ size, index }) => [goldenStarGroup(`Finale Burst Star ${index}`, size)],
    scaleFrom: 18,
    scaleTo: 118,
    travelYScale: 0.58,
    rotationRange: [-260, 260],
  });
  layers.push(...burst);
  nextIndex += burst.length;

  layers.push(
    buildLayer({
      index: nextIndex,
      name: "Finale Center Star",
      shapes: [goldenStarGroup("Finale Center Star Shape", 170)],
      positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
      scaleFrames: [
        { t: 0, s: [0, 0, 100] },
        { t: 46, s: [46, 46, 100] },
        { t: 68, s: [134, 134, 100] },
        { t: 92, s: [96, 96, 100] },
        { t: 126, s: [108, 108, 100] },
        { t: 170, s: [60, 60, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 42, s: [86] },
        { t: 126, s: [100] },
        { t: 156, s: [48] },
        { t: 179, s: [0] },
      ],
      rotationFrames: [
        { t: 0, s: [-12] },
        { t: 101, s: [8] },
        { t: 179, s: [26] },
      ],
    }),
  );
  nextIndex += 1;

  const rings = buildRingPulseLayers(nextIndex, {
    seed: 1243,
    count: 5,
    center,
    radiusRange: [180, 620],
    widthRange: [8, 18],
    palette: [rgb("#f5c65b"), rgb("#ffffff"), rgb("#ffde8b")],
    accentPalette: [rgb("#fff1b4"), rgb("#ffffff")],
    startFrame: 54,
    durationRange: [44, 98],
    scaleFrom: 14,
    scaleTo: 210,
  });
  layers.push(...rings);
  nextIndex += rings.length;

  const dust = buildRadialBurstLayers(nextIndex, {
    seed: 1244,
    count: 28,
    center,
    minRadius: 220,
    maxRadius: 720,
    startFrame: 74,
    duration: 98,
    palette: goldPalette,
    sizeRange: [8, 18],
    shapeFactory: ({ size, color }) => [sparkleGroup("Finale Dust", size, color, rgb("#fff6d6"))],
    scaleFrom: 16,
    scaleTo: 96,
    travelYScale: 0.6,
  });
  layers.push(...dust);

  return makeAnimation("Golden Star Finale", layers);
};

const starrySkyPalette = {
  blue: rgb("#58c7ff"),
  purple: rgb("#8f5bff"),
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  white: rgb("#ffffff"),
  cyan: rgb("#9de8ff"),
};

const tinyStarGroup = (name, size, color, accent = starrySkyPalette.white) =>
  group(name, [
    group("Tiny Star Glow", [
      ellipseShape("Tiny Star Glow Path", size * 2.3, size * 2.3),
      fillNode("Tiny Star Glow Fill", color, 14),
    ]),
    sparkleGroup("Tiny Star Spark", size, color, accent),
  ]);

const buildStarrySkyGlowLayer = (index, name, color, center = [WIDTH / 2, HEIGHT * 0.44]) =>
  buildLayer({
    index,
    name,
    shapes: [
      group("Starry Sky Soft Glow", [
        ellipseShape("Starry Sky Wide Glow Path", 1180, 520),
        fillNode("Starry Sky Wide Glow Fill", color, 8),
      ]),
      group("Starry Sky Center Haze", [
        ellipseShape("Starry Sky Center Haze Path", 680, 320),
        fillNode("Starry Sky Center Haze Fill", starrySkyPalette.white, 4),
      ]),
    ],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [72, 72, 100] }, { t: 68, s: [108, 108, 100] }, { t: 118, s: [116, 116, 100] }, { t: 179, s: [130, 130, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 28, s: [36] }, { t: 100, s: [62] }, { t: 138, s: [30] }, { t: 179, s: [0] }],
  });

const buildStarrySkyFieldLayers = (startIndex, { seed, count = 72, palette = [starrySkyPalette.white, starrySkyPalette.cyan, starrySkyPalette.purple], goldStars = false, sizeRange = [8, 25], pulse = false } = {}) => {
  const rng = createRng(seed);
  const layers = [];
  for (let index = 0; index < count; index += 1) {
    const x = 55 + (rng() * (WIDTH - 110));
    const y = 50 + (rng() * (HEIGHT - 120));
    const color = palette[index % palette.length];
    const size = sizeRange[0] + (rng() * (sizeRange[1] - sizeRange[0]));
    const start = clampFrame(Math.floor(rng() * 38));
    const blinkA = clampFrame(58 + Math.floor(rng() * 24));
    const blinkB = clampFrame(98 + Math.floor(rng() * 28));
    const shape = goldStars && index % 3 === 0 ? [goldenStarGroup("Blinking Gold Star", size * 0.72, starrySkyPalette.white)] : [tinyStarGroup("Blinking Tiny Star", size, color, starrySkyPalette.white)];
    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Blinking Star ${seed}-${index}`,
      shapes: shape,
      positionFrames: [{ t: start, s: [x, y, 0] }, { t: 108, s: [x + ((rng() - 0.5) * 18), y + ((rng() - 0.5) * 14), 0] }, { t: 179, s: [x + ((rng() - 0.5) * 120), y + ((rng() - 0.5) * 92) - 18, 0] }],
      scaleFrames: [{ t: start, s: [45, 45, 100] }, { t: blinkA, s: [pulse ? 138 : 112, pulse ? 138 : 112, 100] }, { t: blinkB, s: [72, 72, 100] }, { t: clampFrame(blinkB + 18), s: [118, 118, 100] }, { t: 179, s: [62, 62, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: clampFrame(start + 16), s: [42 + (rng() * 36)] }, { t: blinkA, s: [92] }, { t: clampFrame(blinkA + 10), s: [36] }, { t: blinkB, s: [86] }, { t: 136, s: [58] }, { t: 179, s: [0] }],
      rotationFrames: [{ t: start, s: [rng() * 90] }, { t: 179, s: [(rng() * 180) - 90] }],
      inFrame: 0,
      outFrame: DURATION_FRAMES,
    }));
  }
  return layers;
};

const buildShootingStarLayers = (startIndex, configs) => configs.map((config, index) => buildLayer({
  index: startIndex + index,
  name: `Shooting Star ${index + 1}`,
  shapes: [
    lineStrokeGroup("Shooting Star Trail", [[-config.length, 0], [0, 0]], config.color, config.width * 2.8, starrySkyPalette.white, config.width, 16, 90),
    sparkleGroup("Shooting Star Head", config.head, starrySkyPalette.white, config.color),
  ],
  positionFrames: [{ t: config.start, s: [config.from[0], config.from[1], 0] }, { t: config.end, s: [config.to[0], config.to[1], 0] }],
  scaleFrames: [{ t: config.start, s: [62, 62, 100] }, { t: clampFrame(config.start + 10), s: [110, 110, 100] }, { t: config.end, s: [82, 82, 100] }],
  opacityFrames: [{ t: 0, s: [0] }, { t: config.start, s: [0] }, { t: clampFrame(config.start + 8), s: [92] }, { t: clampFrame(config.end - 12), s: [74] }, { t: config.end, s: [0] }],
  rotationFrames: [{ t: 0, s: [config.rotation] }],
  inFrame: config.start,
  outFrame: Math.min(DURATION_FRAMES, config.end + 1),
}));

const buildMagicStarrySky = () => {
  let nextIndex = 1;
  const layers = [buildStarrySkyGlowLayer(nextIndex, "Magic Starry Sky Blue Purple Haze", starrySkyPalette.purple)];
  nextIndex += 1;
  const stars = buildStarrySkyFieldLayers(nextIndex, { seed: 16001, count: 86, palette: [starrySkyPalette.white, starrySkyPalette.cyan, starrySkyPalette.purple], sizeRange: [7, 23] });
  layers.push(...stars);
  nextIndex += stars.length;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 16002, count: 28, center: [WIDTH / 2, HEIGHT * 0.48], minRadius: 180, maxRadius: 760, startFrame: 48, duration: 112, palette: [starrySkyPalette.cyan, starrySkyPalette.white, starrySkyPalette.purple], sizeRange: [6, 15], shapeFactory: ({ size, color }) => [sparkleGroup("Magic Dust Spark", size, color, starrySkyPalette.white)], scaleFrom: 18, scaleTo: 100, travelYScale: 0.5, rotationRange: [-90, 90] }));
  return makeAnimation("Magic Starry Sky", layers);
};

const buildGoldenTwinkleSky = () => {
  let nextIndex = 1;
  const layers = [buildStarrySkyGlowLayer(nextIndex, "Golden Twinkle Sky VIP Glow", starrySkyPalette.gold, [WIDTH / 2, HEIGHT * 0.45])];
  nextIndex += 1;
  const stars = buildStarrySkyFieldLayers(nextIndex, { seed: 16011, count: 92, palette: [starrySkyPalette.gold, starrySkyPalette.goldLight, starrySkyPalette.white], goldStars: true, sizeRange: [8, 27], pulse: true });
  layers.push(...stars);
  nextIndex += stars.length;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 16012, count: 36, center: [WIDTH / 2, HEIGHT * 0.5], minRadius: 140, maxRadius: 820, startFrame: 56, duration: 116, palette: [starrySkyPalette.gold, starrySkyPalette.goldLight, starrySkyPalette.white], sizeRange: [7, 18], shapeFactory: ({ size, index }) => index % 4 === 0 ? [goldenStarGroup("Golden Dust Star", size * 0.72, starrySkyPalette.white)] : [sparkleGroup("Golden Dust Spark", size, starrySkyPalette.goldLight, starrySkyPalette.white)], scaleFrom: 16, scaleTo: 108, travelYScale: 0.55, rotationRange: [-120, 120] }));
  return makeAnimation("Golden Twinkle Sky", layers);
};

const buildShootingStarNight = () => {
  let nextIndex = 1;
  const layers = [buildStarrySkyGlowLayer(nextIndex, "Shooting Star Night Blue Haze", starrySkyPalette.blue, [WIDTH / 2, HEIGHT * 0.46])];
  nextIndex += 1;
  const stars = buildStarrySkyFieldLayers(nextIndex, { seed: 16021, count: 72, palette: [starrySkyPalette.white, starrySkyPalette.cyan, starrySkyPalette.purple], sizeRange: [7, 21] });
  layers.push(...stars);
  nextIndex += stars.length;
  const shooting = buildShootingStarLayers(nextIndex, [
    { start: 50, end: 82, from: [-120, 210], to: [760, 430], length: 190, width: 4, head: 20, color: starrySkyPalette.cyan, rotation: 14 },
    { start: 66, end: 102, from: [WIDTH + 140, 170], to: [980, 410], length: 220, width: 4.5, head: 24, color: starrySkyPalette.goldLight, rotation: 164 },
    { start: 88, end: 128, from: [260, -90], to: [1280, 520], length: 240, width: 4.2, head: 23, color: starrySkyPalette.white, rotation: 32 },
  ]);
  layers.push(...shooting);
  nextIndex += shooting.length;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 16022, count: 24, center: [WIDTH / 2, HEIGHT * 0.5], minRadius: 210, maxRadius: 780, startFrame: 72, duration: 108, palette: [starrySkyPalette.cyan, starrySkyPalette.white], sizeRange: [6, 14], shapeFactory: ({ size, color }) => [sparkleGroup("Wish Dust", size, color, starrySkyPalette.white)], scaleFrom: 18, scaleTo: 96, travelYScale: 0.48 }));
  return makeAnimation("Shooting Star Night", layers);
};

const buildStarlightPulse = () => {
  let nextIndex = 1;
  const center = [WIDTH / 2, HEIGHT * 0.5];
  const layers = [buildStarrySkyGlowLayer(nextIndex, "Starlight Pulse Warm Glow", starrySkyPalette.goldLight, [WIDTH / 2, HEIGHT * 0.48])];
  nextIndex += 1;
  const pulses = buildRingPulseLayers(nextIndex, { seed: 16031, count: 5, center, radiusRange: [170, 520], widthRange: [5, 12], palette: [starrySkyPalette.goldLight, starrySkyPalette.cyan, starrySkyPalette.white], accentPalette: [starrySkyPalette.white], startFrame: 48, durationRange: [82, 120], scaleFrom: 20, scaleTo: 190 });
  layers.push(...pulses);
  nextIndex += pulses.length;
  layers.push(...buildStarrySkyFieldLayers(nextIndex, { seed: 16032, count: 82, palette: [starrySkyPalette.goldLight, starrySkyPalette.white, starrySkyPalette.cyan], sizeRange: [8, 24], pulse: true }));
  return makeAnimation("Starlight Pulse", layers);
};

const buildGrandStarryFinale = () => {
  let nextIndex = 1;
  const center = [WIDTH / 2, HEIGHT * 0.5];
  const layers = [buildStarrySkyGlowLayer(nextIndex, "Grand Starry Finale Blue Gold Glow", starrySkyPalette.blue, [WIDTH / 2, HEIGHT * 0.48])];
  nextIndex += 1;
  const stars = buildStarrySkyFieldLayers(nextIndex, { seed: 16041, count: 96, palette: [starrySkyPalette.white, starrySkyPalette.cyan, starrySkyPalette.goldLight, starrySkyPalette.purple], goldStars: true, sizeRange: [7, 26], pulse: true });
  layers.push(...stars);
  nextIndex += stars.length;
  const waves = buildRingPulseLayers(nextIndex, { seed: 16042, count: 4, center, radiusRange: [220, 560], widthRange: [6, 14], palette: [starrySkyPalette.blue, starrySkyPalette.goldLight, starrySkyPalette.white], accentPalette: [starrySkyPalette.white], startFrame: 58, durationRange: [88, 124], scaleFrom: 22, scaleTo: 200 });
  layers.push(...waves);
  nextIndex += waves.length;
  const shooting = buildShootingStarLayers(nextIndex, [
    { start: 58, end: 94, from: [-140, 230], to: [820, 420], length: 210, width: 4, head: 22, color: starrySkyPalette.cyan, rotation: 12 },
    { start: 82, end: 120, from: [WIDTH + 140, 210], to: [920, 500], length: 250, width: 4.4, head: 24, color: starrySkyPalette.goldLight, rotation: 162 },
  ]);
  layers.push(...shooting);
  nextIndex += shooting.length;
  layers.push(...buildRadialBurstLayers(nextIndex, { seed: 16043, count: 42, center, minRadius: 150, maxRadius: 860, startFrame: 70, duration: 118, palette: [starrySkyPalette.cyan, starrySkyPalette.goldLight, starrySkyPalette.white], sizeRange: [6, 16], shapeFactory: ({ size, color, index }) => index % 5 === 0 ? [goldenStarGroup("Finale Tiny Gold Star", size * 0.68, starrySkyPalette.white)] : [sparkleGroup("Finale Magic Dust", size, color, starrySkyPalette.white)], scaleFrom: 18, scaleTo: 106, travelYScale: 0.54, rotationRange: [-160, 160] }));
  return makeAnimation("Grand Starry Finale", layers);
};

const countdownPalette = {
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  orange: rgb("#ff9c36"),
  blue: rgb("#58c7ff"),
  pink: rgb("#ff4fd8"),
  purple: rgb("#8f5bff"),
  white: rgb("#ffffff"),
  red: rgb("#ff6548"),
};

const countdownBallPalette = [
  { color: rgb("#f5c65b"), digit: 3 },
  { color: rgb("#58c7ff"), digit: 2 },
  { color: rgb("#ff4fd8"), digit: 1 },
  { color: rgb("#ff9c36"), digit: 7 },
  { color: rgb("#23bf66"), digit: 9 },
];

const addCountdownNumberLayer = (layers, nextIndex, text, start, end, options = {}) => {
  const color = options.color ?? countdownPalette.white;
  const accent = options.accent ?? countdownPalette.gold;
  const center = options.center ?? [WIDTH / 2, HEIGHT / 2 - 18];
  layers.push(
    buildTextLayer({
      index: nextIndex,
      name: `Countdown ${text}`,
      text,
      fontSize: options.fontSize ?? 430,
      fillColor: color,
      strokeColor: accent,
      strokeWidth: options.strokeWidth ?? 10,
      positionFrames: [
        { t: start, s: [center[0], center[1] - 42, 0] },
        { t: clampFrame(start + 8), s: [center[0], center[1], 0] },
        { t: clampFrame(end - 4), s: [center[0], center[1] + 12, 0] },
      ],
      scaleFrames: [
        { t: start, s: [42, 42, 100] },
        { t: clampFrame(start + 8), s: [126, 126, 100] },
        { t: clampFrame(start + 18), s: [96, 96, 100] },
        { t: clampFrame(end - 5), s: [104, 104, 100] },
        { t: end, s: [118, 118, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: start, s: [0] },
        { t: clampFrame(start + 5), s: [100] },
        { t: clampFrame(end - 7), s: [100] },
        { t: end, s: [0] },
      ],
      inFrame: start,
      outFrame: Math.min(DURATION_FRAMES, end + 1),
    }),
  );
  return nextIndex + 1;
};

const addBingoHeroLayer = (layers, nextIndex, options = {}) => {
  const start = options.start ?? 70;
  const peak = options.peak ?? 102;
  const end = options.end ?? 164;
  const text = options.text ?? "BINGO!";
  layers.push(
    buildTextLayer({
      index: nextIndex,
      name: `${text} Hero`,
      text,
      fontSize: options.fontSize ?? 248,
      fillColor: options.color ?? countdownPalette.goldLight,
      strokeColor: options.accent ?? countdownPalette.orange,
      strokeWidth: options.strokeWidth ?? 8,
      positionFrames: [
        { t: start, s: [WIDTH / 2, HEIGHT / 2 + 8, 0] },
        { t: peak, s: [WIDTH / 2, HEIGHT / 2 - 6, 0] },
        { t: end, s: [WIDTH / 2, HEIGHT / 2 + 22, 0] },
      ],
      scaleFrames: [
        { t: start, s: [30, 30, 100] },
        { t: clampFrame(start + 10), s: [148, 148, 100] },
        { t: clampFrame(start + 22), s: [104, 104, 100] },
        { t: peak, s: [118, 118, 100] },
        { t: clampFrame(end - 20), s: [112, 112, 100] },
        { t: end, s: [148, 148, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: start, s: [0] },
        { t: clampFrame(start + 7), s: [100] },
        { t: peak, s: [100] },
        { t: clampFrame(end - 22), s: [86] },
        { t: end, s: [0] },
      ],
      inFrame: start,
      outFrame: Math.min(DURATION_FRAMES, end + 1),
    }),
  );
  return nextIndex + 1;
};

const buildCountdownBallBurstLayers = (startIndex, seed, startFrame, count = 18, center = [WIDTH / 2, HEIGHT / 2 + 60]) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 340,
    maxRadius: 940,
    startFrame,
    duration: 78,
    palette: countdownBallPalette.map((ball) => ball.color),
    sizeRange: [28, 58],
    scaleFrom: 36,
    scaleTo: 152,
    travelYScale: 0.62,
    shapeFactory: ({ size, index }) => {
      const ball = countdownBallPalette[index % countdownBallPalette.length];
      return [bingoBallGroup(`Countdown Ball ${index}`, size, ball.color, ball.digit)];
    },
  });

const buildCountdownSparkLayers = (startIndex, seed, startFrame, count = 28, center = [WIDTH / 2, HEIGHT / 2]) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 260,
    maxRadius: 1000,
    startFrame,
    duration: 86,
    palette: [countdownPalette.gold, countdownPalette.goldLight, countdownPalette.white, countdownPalette.blue],
    sizeRange: [10, 26],
    scaleFrom: 40,
    scaleTo: 135,
    travelYScale: 0.58,
    shapeFactory: ({ size, color, index }) => [
      sparkleGroup(`Countdown Spark ${index}`, size, countdownPalette.white, color),
    ],
  });

const addCountdownImpactLayers = (layers, nextIndex, seed, startFrame, center = [WIDTH / 2, HEIGHT / 2]) => {
  const rings = buildRingPulseLayers(nextIndex, {
    seed,
    count: 5,
    center,
    radiusRange: [120, 340],
    widthRange: [8, 18],
    palette: [countdownPalette.gold, countdownPalette.goldLight, countdownPalette.white],
    accentPalette: [countdownPalette.orange, countdownPalette.goldLight],
    startFrame,
    durationRange: [62, 96],
    scaleFrom: 28,
    scaleTo: 220,
  });
  layers.push(...rings);
  return nextIndex + rings.length;
};

const buildClassicCountdownBingo = () => {
  let nextIndex = 1;
  const layers = [];
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "3", 0, 34, { color: countdownPalette.white, accent: countdownPalette.blue });
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "2", 30, 66, { color: countdownPalette.white, accent: countdownPalette.pink });
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "1", 62, 94, { color: countdownPalette.goldLight, accent: countdownPalette.gold });
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 94, peak: 118, end: 168, color: countdownPalette.white, accent: countdownPalette.gold });
  nextIndex = addCountdownImpactLayers(layers, nextIndex, 801, 92);
  const balls = buildCountdownBallBurstLayers(nextIndex, 802, 96, 20);
  layers.push(...balls);
  nextIndex += balls.length;
  const sparks = buildCountdownSparkLayers(nextIndex, 803, 90, 30);
  layers.push(...sparks);
  return makeAnimation("Classic 3 2 1 BINGO", layers);
};

const buildBingoLetterBuild = () => {
  let nextIndex = 1;
  const layers = [];
  const letters = ["B", "I", "N", "G", "O"];
  letters.forEach((letter, index) => {
    nextIndex = addCountdownNumberLayer(layers, nextIndex, letter, index * 18, 48 + (index * 18), {
      fontSize: letter === "I" ? 380 : 330,
      color: index % 2 === 0 ? countdownPalette.goldLight : countdownPalette.white,
      accent: [countdownPalette.gold, countdownPalette.blue, countdownPalette.pink][index % 3],
      center: [WIDTH / 2, HEIGHT / 2 - 10],
      strokeWidth: 7,
    });
    nextIndex = addCountdownImpactLayers(layers, nextIndex, 820 + index, index * 18, [WIDTH / 2, HEIGHT / 2]);
  });
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 92, peak: 120, end: 166, color: countdownPalette.goldLight, accent: countdownPalette.pink });
  const balls = buildCountdownBallBurstLayers(nextIndex, 828, 100, 18);
  layers.push(...balls);
  nextIndex += balls.length;
  const sparks = buildCountdownSparkLayers(nextIndex, 829, 96, 26);
  layers.push(...sparks);
  return makeAnimation("B I N G O Letter Build", layers);
};

const buildGoldJackpotCountdown = () => {
  let nextIndex = 1;
  const layers = [];
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "3", 0, 34, { color: countdownPalette.goldLight, accent: countdownPalette.gold, strokeWidth: 12 });
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "2", 32, 66, { color: countdownPalette.goldLight, accent: countdownPalette.orange, strokeWidth: 12 });
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "1", 64, 96, { color: countdownPalette.white, accent: countdownPalette.gold, strokeWidth: 14, fontSize: 460 });
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 94, peak: 122, end: 168, color: countdownPalette.goldLight, accent: countdownPalette.gold, strokeWidth: 11 });
  nextIndex = addCountdownImpactLayers(layers, nextIndex, 840, 88);
  const sparks = buildCountdownSparkLayers(nextIndex, 841, 86, 44);
  layers.push(...sparks);
  nextIndex += sparks.length;
  const balls = buildCountdownBallBurstLayers(nextIndex, 842, 102, 14);
  layers.push(...balls);
  return makeAnimation("Gold Jackpot Countdown", layers);
};

const buildFinalCountdownDetonation = () => {
  let nextIndex = 1;
  const layers = [];
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "3", 0, 30, { color: countdownPalette.white, accent: countdownPalette.red, fontSize: 410 });
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "2", 26, 58, { color: countdownPalette.white, accent: countdownPalette.orange, fontSize: 430 });
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "1", 54, 96, { color: countdownPalette.goldLight, accent: countdownPalette.gold, fontSize: 500, strokeWidth: 16 });
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 88, peak: 114, end: 166, color: countdownPalette.white, accent: countdownPalette.red, fontSize: 270, strokeWidth: 10 });
  nextIndex = addCountdownImpactLayers(layers, nextIndex, 860, 84);
  const balls = buildCountdownBallBurstLayers(nextIndex, 861, 90, 26);
  layers.push(...balls);
  nextIndex += balls.length;
  const sparks = buildCountdownSparkLayers(nextIndex, 862, 84, 42);
  layers.push(...sparks);
  return makeAnimation("Final Countdown Detonation", layers);
};

const buildMegaBingoImpact = () => {
  let nextIndex = 1;
  const layers = [];
  nextIndex = addCountdownImpactLayers(layers, nextIndex, 878, 4, [WIDTH / 2, HEIGHT / 2 + 20]);
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "3", 4, 42, { color: countdownPalette.white, accent: countdownPalette.purple, fontSize: 390 });
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "2", 38, 74, { color: countdownPalette.white, accent: countdownPalette.blue, fontSize: 420 });
  nextIndex = addCountdownNumberLayer(layers, nextIndex, "1", 70, 104, { color: countdownPalette.goldLight, accent: countdownPalette.gold, fontSize: 480, strokeWidth: 15 });
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 100, peak: 124, end: 170, color: countdownPalette.goldLight, accent: countdownPalette.gold, fontSize: 288, strokeWidth: 12 });
  nextIndex = addCountdownImpactLayers(layers, nextIndex, 879, 96);
  const balls = buildOrbitBallLayers(nextIndex, {
    seed: 880,
    count: 16,
    center: [WIDTH / 2, HEIGHT / 2 + 12],
    radiusRange: [180, 520],
    sizeRange: [30, 56],
    palette: countdownBallPalette,
  });
  layers.push(...balls);
  nextIndex += balls.length;
  const sparks = buildCountdownSparkLayers(nextIndex, 881, 96, 28);
  layers.push(...sparks);
  return makeAnimation("Mega Bingo Impact", layers);
};

const buildGiantBingoReveal = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2 + 24];
  nextIndex = addCountdownImpactLayers(layers, nextIndex, 10301, 18, center);
  const gather = buildOrbitBallLayers(nextIndex, {
    seed: 10302,
    count: 14,
    center,
    radiusRange: [210, 460],
    sizeRange: [30, 58],
    palette: countdownBallPalette,
  });
  layers.push(...gather);
  nextIndex += gather.length;
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 62, peak: 94, end: 166, color: countdownPalette.goldLight, accent: countdownPalette.gold, fontSize: 300, strokeWidth: 12 });
  const balls = buildCountdownBallBurstLayers(nextIndex, 10303, 96, 18, center);
  layers.push(...balls);
  nextIndex += balls.length;
  const sparks = buildCountdownSparkLayers(nextIndex, 10304, 62, 44, center);
  layers.push(...sparks);
  return makeAnimation("Giant Bingo Reveal", layers);
};

const buildFullscreenBingoLetterBuild = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  const letters = ["B", "I", "N", "G", "O"];
  letters.forEach((letter, index) => {
    nextIndex = addCountdownNumberLayer(layers, nextIndex, letter, 8 + index * 14, 48 + index * 14, {
      fontSize: letter === "I" ? 380 : 330,
      color: index % 2 === 0 ? countdownPalette.goldLight : countdownPalette.white,
      accent: [countdownPalette.gold, countdownPalette.blue, countdownPalette.pink][index % 3],
      center: [WIDTH / 2, HEIGHT / 2 - 36],
      strokeWidth: 8,
    });
    nextIndex = addCountdownImpactLayers(layers, nextIndex, 10320 + index, 8 + index * 14, center);
  });
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 88, peak: 118, end: 168, color: countdownPalette.goldLight, accent: countdownPalette.pink, fontSize: 286, strokeWidth: 10 });
  const balls = buildCountdownBallBurstLayers(nextIndex, 10328, 100, 20, [WIDTH / 2, HEIGHT / 2 + 64]);
  layers.push(...balls);
  nextIndex += balls.length;
  const sparks = buildCountdownSparkLayers(nextIndex, 10329, 88, 36, center);
  layers.push(...sparks);
  return makeAnimation("Bingo Letter Build", layers);
};

const buildGoldenBingoJackpot = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2 + 14];
  layers.push(buildNeonGlowLayer(nextIndex, "Golden Bingo Jackpot Glow", countdownPalette.gold, center, [1040, 480]));
  nextIndex += 1;
  nextIndex = addCountdownImpactLayers(layers, nextIndex, 10341, 24, center);
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 58, peak: 96, end: 168, color: countdownPalette.goldLight, accent: countdownPalette.gold, fontSize: 300, strokeWidth: 14 });
  const goldBalls = buildCountdownBallBurstLayers(nextIndex, 10342, 72, 16, center).map((layer) => ({
    ...layer,
    shapes: [bingoBallGroup("Golden Bingo Ball", 50, countdownPalette.gold, 7)],
  }));
  layers.push(...goldBalls);
  nextIndex += goldBalls.length;
  const beams = buildBeamLayers(nextIndex, { seed: 10343, count: 12, xRange: [240, WIDTH - 240], yBase: HEIGHT * 0.56, palette: [countdownPalette.gold, countdownPalette.goldLight, countdownPalette.white], accentPalette: [countdownPalette.white], widthRange: [26, 54], heightRange: [240, 620], rotationRange: [-70, 70] });
  layers.push(...beams);
  nextIndex += beams.length;
  const sparks = buildCountdownSparkLayers(nextIndex, 10344, 58, 46, center);
  layers.push(...sparks);
  return makeAnimation("Golden Bingo Jackpot", layers);
};

const buildMegaBingoFinaleFullscreen = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2 + 20];
  layers.push(buildNeonGlowLayer(nextIndex, "Mega Bingo Finale Glow", countdownPalette.pink, center, [1180, 520]));
  nextIndex += 1;
  const rush = buildHeroBallRushLayers(nextIndex, [
    { startFrame: 0, from: [-160, 180], mid: [430, 330], to: [260, 260], radius: 76, color: countdownPalette.blue, digit: 3, endFrame: 136 },
    { startFrame: 4, from: [WIDTH + 160, 200], mid: [1490, 330], to: [1640, 250], radius: 82, color: countdownPalette.red, digit: 7, endFrame: 138 },
    { startFrame: 8, from: [WIDTH / 2, -180], mid: [960, 250], to: [960, 120], radius: 78, color: countdownPalette.gold, digit: 1, endFrame: 140 },
    { startFrame: 12, from: [WIDTH / 2, HEIGHT + 180], mid: [960, 720], to: [960, HEIGHT + 160], radius: 88, color: countdownPalette.purple, digit: 8, endFrame: 142 },
  ]);
  layers.push(...rush);
  nextIndex += rush.length;
  nextIndex = addCountdownImpactLayers(layers, nextIndex, 10351, 34, center);
  nextIndex = addBingoHeroLayer(layers, nextIndex, { start: 56, peak: 92, end: 168, color: countdownPalette.goldLight, accent: countdownPalette.pink, fontSize: 320, strokeWidth: 13 });
  const burst = buildCountdownBallBurstLayers(nextIndex, 10352, 76, 28, center);
  layers.push(...burst);
  nextIndex += burst.length;
  const sparks = buildCountdownSparkLayers(nextIndex, 10353, 58, 62, center);
  layers.push(...sparks);
  return makeAnimation("Mega Bingo Finale", layers);
};

const flowerPalette = {
  rose: rgb("#ff6fb7"),
  roseLight: rgb("#ffd1e6"),
  sakura: rgb("#ff9fd0"),
  sakuraLight: rgb("#fff1f7"),
  coral: rgb("#ff7f95"),
  lavender: rgb("#c58bff"),
  red: rgb("#e94765"),
  white: rgb("#ffffff"),
  gold: rgb("#ffe28a"),
};

const petalGroup = (name, width, height, color, accent = flowerPalette.white) =>
  group(name, [
    group("Petal Glow", [
      ellipseShape("Petal Glow Path", width * 1.32, height * 1.32),
      fillNode("Petal Glow Fill", color, 13),
    ]),
    group("Petal Fill", [
      ellipseShape("Petal Fill Path", width, height),
      fillNode("Petal Fill", color, 92),
    ]),
    group("Petal Highlight", [
      ellipseShape("Petal Highlight Path", width * 0.32, height * 0.58),
      fillNode("Petal Highlight Fill", accent, 22),
    ], {
      position: [-(width * 0.14), -(height * 0.08)],
      rotation: -18,
    }),
  ]);

const flowerBloomGroup = (name, radius, petalColor, centerColor = flowerPalette.gold, petals = 8) =>
  group(name, [
    group("Bloom Glow", [
      ellipseShape("Bloom Glow Path", radius * 2.35, radius * 2.35),
      fillNode("Bloom Glow Fill", petalColor, 10),
    ]),
    ...Array.from({ length: petals }, (_, index) => {
      const angle = (index / petals) * 360;
      const radians = (angle * Math.PI) / 180;
      return group(`Bloom Petal ${index + 1}`, [
        petalGroup("Bloom Petal Shape", radius * 0.52, radius * 1.08, petalColor, flowerPalette.white),
      ], {
        position: [Math.cos(radians) * radius * 0.36, Math.sin(radians) * radius * 0.36],
        rotation: angle,
      });
    }),
    group("Bloom Center", [
      ellipseShape("Bloom Center Path", radius * 0.62, radius * 0.62),
      fillNode("Bloom Center Fill", centerColor, 92),
      strokeNode("Bloom Center Shine", flowerPalette.white, Math.max(2, radius * 0.04), 42),
    ]),
    sparkleGroup("Bloom Spark", Math.max(9, radius * 0.12), flowerPalette.white, centerColor),
  ]);

const roseBloomGroup = (name, radius) =>
  group(name, [
    group("Rose Glow", [
      ellipseShape("Rose Glow Path", radius * 2.6, radius * 2.35),
      fillNode("Rose Glow Fill", flowerPalette.red, 12),
    ]),
    ...Array.from({ length: 13 }, (_, index) => {
      const progress = index / 12;
      const angle = progress * 760;
      const radians = (angle * Math.PI) / 180;
      const distance = radius * (0.08 + (progress * 0.56));
      const size = radius * (0.46 - (progress * 0.12));
      return group(`Rose Petal ${index + 1}`, [
        petalGroup("Rose Petal Shape", size * 0.82, size * 1.22, index % 2 === 0 ? flowerPalette.red : flowerPalette.rose, flowerPalette.roseLight),
      ], {
        position: [Math.cos(radians) * distance, Math.sin(radians) * distance * 0.72],
        rotation: angle + 38,
      });
    }),
    group("Rose Core", [
      ellipseShape("Rose Core Path", radius * 0.4, radius * 0.34),
      fillNode("Rose Core Fill", flowerPalette.roseLight, 70),
    ]),
  ]);

const buildPetalDriftLayers = (startIndex, options) => {
  const {
    seed,
    count,
    startFrame = 0,
    endFrame = LAST_FRAME,
    colorSet = [flowerPalette.rose, flowerPalette.sakura, flowerPalette.roseLight],
    sizeRange = [18, 48],
    fromEdges = true,
    swirl = false,
  } = options;
  const rng = createRng(seed);
  const layers = [];

  for (let index = 0; index < count; index += 1) {
    const side = Math.floor(rng() * 4);
    const targetX = 160 + (rng() * (WIDTH - 320));
    const targetY = 100 + (rng() * (HEIGHT - 220));
    const startX = fromEdges
      ? side === 0 ? -80 : side === 1 ? WIDTH + 80 : rng() * WIDTH
      : targetX + ((rng() - 0.5) * 520);
    const startY = fromEdges
      ? side === 2 ? -80 : side === 3 ? HEIGHT + 80 : rng() * HEIGHT
      : targetY + ((rng() - 0.5) * 360);
    const midX = swirl ? WIDTH / 2 + (Math.cos(index * 0.72) * (120 + (rng() * 420))) : targetX;
    const midY = swirl ? HEIGHT / 2 + (Math.sin(index * 0.72) * (70 + (rng() * 230))) : targetY;
    const outX = targetX + ((rng() - 0.5) * 640);
    const outY = targetY + 180 + (rng() * 340);
    const color = colorSet[index % colorSet.length];
    const size = sizeRange[0] + (rng() * (sizeRange[1] - sizeRange[0]));
    const inFrame = clampFrame(startFrame + Math.floor(rng() * 30));
    const buildFrame = clampFrame(54 + Math.floor(rng() * 22));
    const holdFrame = clampFrame(108 + Math.floor(rng() * 18));
    const fadeFrame = clampFrame(Math.max(132, endFrame - 30 + Math.floor(rng() * 10)));

    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Flower Petal Drift ${seed}-${index}`,
      shapes: [petalGroup("Petal Shape", size * 0.72, size * 1.4, color, flowerPalette.white)],
      positionFrames: [
        { t: inFrame, s: [startX, startY, 0] },
        { t: buildFrame, s: [midX, midY, 0] },
        { t: holdFrame, s: [targetX, targetY, 0] },
        { t: fadeFrame, s: [outX, outY, 0] },
      ],
      scaleFrames: [
        { t: inFrame, s: [44, 44, 100] },
        { t: buildFrame, s: [112, 112, 100] },
        { t: holdFrame, s: [100, 100, 100] },
        { t: fadeFrame, s: [86, 86, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: inFrame, s: [0] },
        { t: clampFrame(inFrame + 10), s: [88] },
        { t: holdFrame, s: [94] },
        { t: fadeFrame, s: [0] },
      ],
      rotationFrames: [
        { t: inFrame, s: [rng() * 180] },
        { t: buildFrame, s: [180 + (rng() * 160)] },
        { t: fadeFrame, s: [420 + (rng() * 220)] },
      ],
      inFrame,
      outFrame: Math.min(DURATION_FRAMES, fadeFrame + 1),
    }));
  }

  return layers;
};

const buildHeroFlowerLayer = (index, name, shapes, start = 58, peak = 98, end = 166, center = [WIDTH / 2, HEIGHT / 2]) =>
  buildLayer({
    index,
    name,
    shapes,
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [
      { t: start, s: [20, 20, 100] },
      { t: clampFrame(start + 14), s: [126, 126, 100] },
      { t: peak, s: [100, 100, 100] },
      { t: clampFrame(end - 24), s: [106, 106, 100] },
      { t: end, s: [72, 72, 100] },
    ],
    opacityFrames: [
      { t: 0, s: [0] },
      { t: start, s: [0] },
      { t: clampFrame(start + 12), s: [100] },
      { t: clampFrame(end - 20), s: [86] },
      { t: end, s: [0] },
    ],
    rotationFrames: [
      { t: start, s: [-16] },
      { t: peak, s: [0] },
      { t: end, s: [12] },
    ],
    inFrame: start,
    outFrame: Math.min(DURATION_FRAMES, end + 1),
  });

const buildFloralHeartLayers = (startIndex) => {
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2 + 6];
  for (let index = 0; index < 28; index += 1) {
    const t = (index / 28) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    const target = [center[0] + (x * 28), center[1] + (y * 24)];
    const angle = (index / 28) * Math.PI * 2;
    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Floral Heart Bloom ${index + 1}`,
      shapes: [flowerBloomGroup("Heart Flower", 34 + ((index % 4) * 6), index % 3 === 0 ? flowerPalette.rose : index % 3 === 1 ? flowerPalette.sakura : flowerPalette.lavender, flowerPalette.gold, 6)],
      positionFrames: [
        { t: 0, s: [center[0] + (Math.cos(angle) * 780), center[1] + (Math.sin(angle) * 430), 0] },
        { t: 68, s: [target[0], target[1], 0] },
        { t: 122, s: [target[0], target[1], 0] },
        { t: 168, s: [target[0] + (Math.cos(angle) * 260), target[1] + (Math.sin(angle) * 180), 0] },
      ],
      scaleFrames: [
        { t: 0, s: [20, 20, 100] },
        { t: 68, s: [96, 96, 100] },
        { t: 96, s: [112, 112, 100] },
        { t: 168, s: [66, 66, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 16 + (index % 8), s: [92] },
        { t: 122, s: [96] },
        { t: 168, s: [0] },
      ],
      rotationFrames: [
        { t: 0, s: [index * 18] },
        { t: 122, s: [index * 18 + 32] },
        { t: 168, s: [index * 18 + 90] },
      ],
    }));
  }
  return layers;
};

const buildPetalStormBloom = () => {
  let nextIndex = 1;
  const layers = [];
  const petals = buildPetalDriftLayers(nextIndex, { seed: 9011, count: 54, colorSet: [flowerPalette.rose, flowerPalette.sakura, flowerPalette.roseLight], swirl: true });
  layers.push(...petals);
  nextIndex += petals.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Petal Storm Hero Bloom", [flowerBloomGroup("Hero Flower", 205, flowerPalette.rose, flowerPalette.gold, 12)], 58, 96, 166));
  nextIndex += 1;
  const sparks = buildCountdownSparkLayers(nextIndex, 9012, 62, 24, [WIDTH / 2, HEIGHT / 2]);
  layers.push(...sparks);
  return makeAnimation("Petal Storm Bloom", layers);
};

const buildSakuraJackpotBlossom = () => {
  let nextIndex = 1;
  const layers = [];
  const petals = buildFallingLayers(nextIndex, {
    seed: 9021,
    count: 48,
    xRange: [-120, WIDTH + 120],
    yRange: [-120, HEIGHT + 160],
    palette: [flowerPalette.sakura, flowerPalette.sakuraLight, flowerPalette.roseLight],
    sizeRange: [22, 58],
    shapeFactory: ({ size, color, index }) => [petalGroup(`Sakura Petal ${index}`, size * 0.68, size * 1.28, color, flowerPalette.white)],
    startFrame: 0,
    endFrame: 170,
    driftXRange: [-120, 120],
    driftYRange: [260, 620],
    rotationRange: [-80, 160],
    scaleRange: [72, 128],
  });
  layers.push(...petals);
  nextIndex += petals.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Sakura Jackpot Blossom", [flowerBloomGroup("Sakura Hero", 190, flowerPalette.sakura, flowerPalette.gold, 10)], 64, 100, 168));
  nextIndex += 1;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9022, 70, 22, [WIDTH / 2, HEIGHT / 2]));
  return makeAnimation("Sakura Jackpot Blossom", layers);
};

const buildRoseSwirlReveal = () => {
  let nextIndex = 1;
  const layers = [];
  const petals = buildPetalDriftLayers(nextIndex, { seed: 9031, count: 46, colorSet: [flowerPalette.red, flowerPalette.rose, flowerPalette.roseLight], swirl: true, sizeRange: [20, 52] });
  layers.push(...petals);
  nextIndex += petals.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Rose Swirl Reveal Hero", [roseBloomGroup("Hero Rose", 220)], 62, 100, 168));
  nextIndex += 1;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9032, 68, 20, [WIDTH / 2, HEIGHT / 2]));
  return makeAnimation("Rose Swirl Reveal", layers);
};

const buildFloralHeartBloom = () => {
  let nextIndex = 1;
  const layers = buildFloralHeartLayers(nextIndex);
  nextIndex += layers.length;
  const petals = buildPetalDriftLayers(nextIndex, { seed: 9041, count: 24, colorSet: [flowerPalette.roseLight, flowerPalette.sakura, flowerPalette.lavender], swirl: false, sizeRange: [16, 42] });
  layers.push(...petals);
  nextIndex += petals.length;
  layers.push(...buildRingPulseLayers(nextIndex, {
    seed: 9042,
    count: 3,
    center: [WIDTH / 2, HEIGHT / 2],
    radiusRange: [180, 360],
    widthRange: [8, 14],
    palette: [flowerPalette.rose, flowerPalette.sakuraLight],
    accentPalette: [flowerPalette.white],
    startFrame: 62,
    durationRange: [74, 106],
    scaleFrom: 40,
    scaleTo: 170,
  }));
  return makeAnimation("Floral Heart Bloom", layers);
};

const buildBloomBurstFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const bloomPositions = [
    [360, 300, 96, flowerPalette.sakura],
    [720, 640, 112, flowerPalette.lavender],
    [960, 430, 178, flowerPalette.rose],
    [1240, 620, 108, flowerPalette.coral],
    [1570, 310, 100, flowerPalette.sakuraLight],
  ];
  for (const [x, y, radius, color] of bloomPositions) {
    layers.push(buildHeroFlowerLayer(nextIndex, `Finale Bloom ${nextIndex}`, [flowerBloomGroup("Finale Flower", radius, color, flowerPalette.gold, 9)], 18 + (nextIndex * 8), 92, 166, [x, y]));
    nextIndex += 1;
  }
  const petals = buildPetalDriftLayers(nextIndex, { seed: 9051, count: 50, colorSet: [flowerPalette.rose, flowerPalette.sakura, flowerPalette.lavender, flowerPalette.sakuraLight], swirl: false, sizeRange: [18, 48] });
  layers.push(...petals);
  nextIndex += petals.length;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9052, 62, 30, [WIDTH / 2, HEIGHT / 2]));
  return makeAnimation("Bloom Burst Finale", layers);
};

const leprechaunPalette = {
  emerald: rgb("#22c55e"),
  emeraldLight: rgb("#86efac"),
  deepGreen: rgb("#15803d"),
  mint: rgb("#bbf7d0"),
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  orange: rgb("#ff9c36"),
  white: rgb("#ffffff"),
  red: rgb("#ff5f5f"),
  blue: rgb("#58c7ff"),
  purple: rgb("#8f5bff"),
};

const shamrockGroup = (name, size, color = leprechaunPalette.emerald, accent = leprechaunPalette.goldLight) =>
  group(name, [
    group("Shamrock Glow", [
      ellipseShape("Shamrock Glow Path", size * 2.25, size * 2.05),
      fillNode("Shamrock Glow Fill", color, 13),
    ]),
    group("Leaf Top", [
      ellipseShape("Leaf Top Path", size * 0.9, size * 0.82),
      fillNode("Leaf Top Fill", color, 94),
      strokeNode("Leaf Top Shine", accent, Math.max(2, size * 0.055), 26),
    ], { position: [0, -(size * 0.34)], rotation: -8 }),
    group("Leaf Left", [
      ellipseShape("Leaf Left Path", size * 0.92, size * 0.8),
      fillNode("Leaf Left Fill", color, 94),
      strokeNode("Leaf Left Shine", accent, Math.max(2, size * 0.055), 24),
    ], { position: [-(size * 0.36), size * 0.06], rotation: -38 }),
    group("Leaf Right", [
      ellipseShape("Leaf Right Path", size * 0.92, size * 0.8),
      fillNode("Leaf Right Fill", color, 94),
      strokeNode("Leaf Right Shine", accent, Math.max(2, size * 0.055), 24),
    ], { position: [size * 0.36, size * 0.06], rotation: 38 }),
    group("Stem", [
      pathShape("Stem Path", [[0, size * 0.24], [size * 0.1, size * 0.76], [-(size * 0.18), size * 1.02]], false),
      strokeNode("Stem Stroke", leprechaunPalette.deepGreen, Math.max(3, size * 0.09), 88),
    ]),
    sparkleGroup("Lucky Shine", Math.max(8, size * 0.16), leprechaunPalette.white, accent),
  ]);

const potOfGoldGroup = (name, size) =>
  group(name, [
    group("Gold Glow", [
      ellipseShape("Gold Glow Path", size * 2.4, size * 1.35),
      fillNode("Gold Glow Fill", leprechaunPalette.gold, 16),
    ], { position: [0, -(size * 0.42)] }),
    group("Gold Pile", [
      ellipseShape("Gold Pile Path", size * 1.52, size * 0.58),
      fillNode("Gold Pile Fill", leprechaunPalette.gold, 96),
      strokeNode("Gold Pile Shine", leprechaunPalette.goldLight, Math.max(4, size * 0.06), 72),
    ], { position: [0, -(size * 0.42)] }),
    ...Array.from({ length: 7 }, (_, index) => {
      const offset = index - 3;
      return group(`Gold Coin ${index + 1}`, [
        coinGroup("Pot Coin", size * 0.16, index % 2 === 0 ? leprechaunPalette.gold : leprechaunPalette.goldLight, leprechaunPalette.white),
      ], {
        position: [offset * size * 0.19, -(size * (0.58 + (Math.abs(offset) % 2) * 0.08))],
        rotation: offset * 10,
      });
    }),
    group("Pot Body", [
      pathShape("Pot Body Path", [
        [-(size * 0.78), -(size * 0.16)],
        [size * 0.78, -(size * 0.16)],
        [size * 0.56, size * 0.56],
        [-(size * 0.56), size * 0.56],
      ], true),
      fillNode("Pot Body Fill", rgb("#151515"), 96),
      strokeNode("Pot Body Rim", leprechaunPalette.emeraldLight, Math.max(4, size * 0.055), 58),
    ]),
    group("Pot Rim", [
      ellipseShape("Pot Rim Path", size * 1.72, size * 0.28),
      fillNode("Pot Rim Fill", rgb("#232323"), 98),
      strokeNode("Pot Rim Shine", leprechaunPalette.goldLight, Math.max(3, size * 0.045), 42),
    ], { position: [0, -(size * 0.18)] }),
    group("Pot Foot", [
      rectShape("Pot Foot Path", size * 0.76, size * 0.14, size * 0.06),
      fillNode("Pot Foot Fill", rgb("#111111"), 94),
    ], { position: [0, size * 0.6] }),
  ]);

const rainbowArcGroup = (name, radius, width = 16) => {
  const arcPoints = (arcRadius) => Array.from({ length: 24 }, (_, index) => {
    const progress = index / 23;
    const angle = Math.PI * (1.04 - (progress * 1.08));
    return [Math.cos(angle) * arcRadius, -Math.sin(angle) * arcRadius * 0.56];
  });

  const bands = [
    [leprechaunPalette.red, radius + width * 2.5],
    [leprechaunPalette.orange, radius + width * 1.5],
    [leprechaunPalette.gold, radius + width * 0.5],
    [leprechaunPalette.emeraldLight, radius - width * 0.5],
    [leprechaunPalette.blue, radius - width * 1.5],
    [leprechaunPalette.purple, radius - width * 2.5],
  ];

  return group(name, bands.map(([color, arcRadius], index) =>
    lineStrokeGroup(`Rainbow Band ${index + 1}`, arcPoints(arcRadius), color, width * 1.28, color, width * 0.82, 12, 84),
  ));
};

const buildLuckyShamrockBurstLayers = (startIndex, seed, startFrame, count, center = [WIDTH / 2, HEIGHT / 2]) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 260,
    maxRadius: 940,
    startFrame,
    duration: 92,
    palette: [leprechaunPalette.emerald, leprechaunPalette.emeraldLight, leprechaunPalette.gold],
    sizeRange: [24, 58],
    scaleFrom: 34,
    scaleTo: 136,
    travelYScale: 0.62,
    shapeFactory: ({ size, color, index }) => [
      shamrockGroup(`Lucky Shamrock ${index}`, size, color, index % 3 === 0 ? leprechaunPalette.goldLight : leprechaunPalette.white),
    ],
  });

const buildGoldDustLayers = (startIndex, seed, startFrame, count, center = [WIDTH / 2, HEIGHT / 2]) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 180,
    maxRadius: 980,
    startFrame,
    duration: 84,
    palette: [leprechaunPalette.gold, leprechaunPalette.goldLight, leprechaunPalette.white, leprechaunPalette.emeraldLight],
    sizeRange: [8, 22],
    scaleFrom: 36,
    scaleTo: 120,
    travelYScale: 0.6,
    shapeFactory: ({ size, color, index }) => [
      sparkleGroup(`Lucky Gold Dust ${index}`, size, leprechaunPalette.white, color),
    ],
  });

const buildLuckyShamrockStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];

  layers.push(buildHeroFlowerLayer(nextIndex, "Lucky Storm Glow", [
    group("Emerald Lucky Glow", [
      ellipseShape("Emerald Glow Path", 780, 360),
      fillNode("Emerald Glow Fill", leprechaunPalette.emerald, 10),
    ]),
  ], 34, 86, 166, center));
  nextIndex += 1;

  const shamrocks = buildPetalDriftLayers(nextIndex, {
    seed: 9101,
    count: 54,
    colorSet: [leprechaunPalette.emerald, leprechaunPalette.emeraldLight, leprechaunPalette.gold],
    sizeRange: [28, 64],
    swirl: true,
  }).map((layer, index) => ({
    ...layer,
    nm: `Lucky Shamrock Storm ${index + 1}`,
    shapes: [shamrockGroup(`Storm Shamrock ${index + 1}`, 34 + ((index % 5) * 6), index % 3 === 0 ? leprechaunPalette.gold : index % 3 === 1 ? leprechaunPalette.emeraldLight : leprechaunPalette.emerald)],
  }));
  layers.push(...shamrocks);
  nextIndex += shamrocks.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Giant Lucky Burst Shamrock", [shamrockGroup("Hero Lucky Shamrock", 190, leprechaunPalette.emerald, leprechaunPalette.goldLight)], 58, 98, 168, center));
  nextIndex += 1;
  layers.push(...buildGoldDustLayers(nextIndex, 9102, 66, 30, center));
  return makeAnimation("Lucky Shamrock Storm", layers);
};

const buildPotOfGoldBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.6];

  layers.push(buildHeroFlowerLayer(nextIndex, "Pot Of Gold Hero", [potOfGoldGroup("Hero Pot Of Gold", 210)], 22, 92, 166, center));
  nextIndex += 1;
  const shamrocks = buildLuckyShamrockBurstLayers(nextIndex, 9111, 54, 20, [WIDTH / 2, HEIGHT * 0.52]);
  layers.push(...shamrocks);
  nextIndex += shamrocks.length;
  const dust = buildGoldDustLayers(nextIndex, 9112, 42, 38, [WIDTH / 2, HEIGHT * 0.58]);
  layers.push(...dust);
  return makeAnimation("Pot Of Gold Burst", layers);
};

const buildRainbowLuckyArc = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.72];

  layers.push(buildLayer({
    index: nextIndex,
    name: "Rainbow Lucky Hero Arc",
    shapes: [rainbowArcGroup("Lucky Rainbow Arc", 660, 18)],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [
      { t: 0, s: [20, 20, 100] },
      { t: 34, s: [86, 86, 100] },
      { t: 68, s: [100, 100, 100] },
      { t: 112, s: [100, 100, 100] },
      { t: 135, s: [104, 104, 100] },
      { t: 179, s: [118, 118, 100] },
    ],
    opacityFrames: [
      { t: 0, s: [0] },
      { t: 24, s: [42] },
      { t: 68, s: [100] },
      { t: 112, s: [92] },
      { t: 135, s: [42] },
      { t: 179, s: [0] },
    ],
  }));
  nextIndex += 1;
  const shamrocks = buildLuckyShamrockBurstLayers(nextIndex, 9121, 58, 22, [WIDTH / 2, HEIGHT * 0.52]);
  layers.push(...shamrocks);
  nextIndex += shamrocks.length;
  layers.push(...buildGoldDustLayers(nextIndex, 9122, 36, 32, [WIDTH / 2, HEIGHT * 0.56]));
  return makeAnimation("Rainbow Lucky Arc", layers);
};

const buildLeprechaunGoldRush = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];

  const inward = buildPetalDriftLayers(nextIndex, {
    seed: 9131,
    count: 44,
    colorSet: [leprechaunPalette.gold, leprechaunPalette.emerald, leprechaunPalette.goldLight],
    sizeRange: [20, 54],
    swirl: true,
  }).map((layer, index) => ({
    ...layer,
    nm: `Gold Rush Lucky Element ${index + 1}`,
    shapes: index % 3 === 0
      ? [coinGroup(`Gold Rush Coin ${index}`, 28 + ((index % 4) * 7), leprechaunPalette.gold, leprechaunPalette.goldLight)]
      : [shamrockGroup(`Gold Rush Shamrock ${index}`, 28 + ((index % 4) * 7), index % 2 === 0 ? leprechaunPalette.emerald : leprechaunPalette.emeraldLight)],
  }));
  layers.push(...inward);
  nextIndex += inward.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Gold Rush Center Burst", [shamrockGroup("Gold Rush Hero Shamrock", 155, leprechaunPalette.emerald, leprechaunPalette.goldLight)], 58, 92, 166, center));
  nextIndex += 1;
  const dust = buildGoldDustLayers(nextIndex, 9132, 62, 42, center);
  layers.push(...dust);
  return makeAnimation("Leprechaun Gold Rush", layers);
};

const buildMegaLuckyFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.56];

  layers.push(buildLayer({
    index: nextIndex,
    name: "Mega Lucky Rainbow Glow",
    shapes: [rainbowArcGroup("Finale Rainbow Glow", 520, 15)],
    positionFrames: [{ t: 0, s: [WIDTH / 2, HEIGHT * 0.76, 0] }],
    scaleFrames: [
      { t: 0, s: [28, 28, 100] },
      { t: 68, s: [100, 100, 100] },
      { t: 112, s: [100, 100, 100] },
      { t: 179, s: [124, 124, 100] },
    ],
    opacityFrames: [
      { t: 0, s: [0] },
      { t: 42, s: [64] },
      { t: 112, s: [80] },
      { t: 135, s: [34] },
      { t: 179, s: [0] },
    ],
  }));
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Mega Lucky Pot Hero", [potOfGoldGroup("Finale Pot Of Gold", 178)], 48, 96, 168, [center[0], center[1] + 78]));
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Mega Lucky Shamrock Hero", [shamrockGroup("Finale Hero Shamrock", 130, leprechaunPalette.emerald, leprechaunPalette.goldLight)], 42, 92, 164, [center[0], center[1] - 150]));
  nextIndex += 1;
  const shamrocks = buildLuckyShamrockBurstLayers(nextIndex, 9141, 58, 28, center);
  layers.push(...shamrocks);
  nextIndex += shamrocks.length;
  layers.push(...buildGoldDustLayers(nextIndex, 9142, 54, 40, center));
  return makeAnimation("Mega Lucky Finale", layers);
};

const premiumPalette = {
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  white: rgb("#ffffff"),
  diamond: rgb("#dff8ff"),
  cyan: rgb("#58c7ff"),
  blue: rgb("#2f86ff"),
  purple: rgb("#8f5bff"),
  emerald: rgb("#23bf66"),
  amber: rgb("#ff9c36"),
};

const diamondHeroGroup = (name, size) =>
  group(name, [
    group("Diamond Glow", [
      pathShape("Diamond Glow Path", diamondPoints(size * 1.45, size * 1.55), true),
      fillNode("Diamond Glow Fill", premiumPalette.cyan, 12),
    ]),
    group("Diamond Body", [
      pathShape("Diamond Body Path", diamondPoints(size, size * 1.08), true),
      fillNode("Diamond Body Fill", premiumPalette.diamond, 86),
      strokeNode("Diamond Rim", premiumPalette.white, Math.max(5, size * 0.045), 88),
    ]),
    group("Diamond Top Facet", [
      pathShape("Facet Top Path", [[-(size * 0.5), 0], [-(size * 0.25), -(size * 0.54)], [size * 0.25, -(size * 0.54)], [size * 0.5, 0]], true),
      fillNode("Facet Top Fill", premiumPalette.white, 22),
    ]),
    lineStrokeGroup("Diamond Cross Shine", [[-(size * 0.42), 0], [0, size * 0.54], [size * 0.42, 0]], premiumPalette.cyan, size * 0.05, premiumPalette.white, size * 0.02, 18, 58),
    sparkleGroup("Diamond Spark", Math.max(18, size * 0.12), premiumPalette.white, premiumPalette.cyan),
  ]);

const crownGroup = (name, size) =>
  group(name, [
    group("Crown Glow", [
      ellipseShape("Crown Glow Path", size * 2.55, size * 1.6),
      fillNode("Crown Glow Fill", premiumPalette.gold, 12),
    ]),
    group("Crown Body", [
      pathShape("Crown Body Path", [
        [-(size * 0.86), size * 0.34],
        [-(size * 0.72), -(size * 0.28)],
        [-(size * 0.32), size * 0.04],
        [0, -(size * 0.54)],
        [size * 0.32, size * 0.04],
        [size * 0.72, -(size * 0.28)],
        [size * 0.86, size * 0.34],
      ], true),
      fillNode("Crown Body Fill", premiumPalette.gold, 96),
      strokeNode("Crown Rim Shine", premiumPalette.goldLight, Math.max(5, size * 0.055), 76),
    ]),
    group("Crown Base", [
      rectShape("Crown Base Path", size * 1.72, size * 0.25, size * 0.08),
      fillNode("Crown Base Fill", premiumPalette.gold, 96),
      strokeNode("Crown Base Shine", premiumPalette.white, Math.max(3, size * 0.035), 42),
    ], { position: [0, size * 0.34] }),
    ...[-0.72, 0, 0.72].map((x, index) => group(`Crown Jewel ${index + 1}`, [
      ellipseShape("Jewel Path", size * 0.17, size * 0.17),
      fillNode("Jewel Fill", index === 1 ? premiumPalette.cyan : premiumPalette.purple, 92),
      strokeNode("Jewel Shine", premiumPalette.white, Math.max(2, size * 0.02), 54),
    ], { position: [x * size, index === 1 ? -(size * 0.5) : -(size * 0.26)] })),
    sparkleGroup("Crown Spark", Math.max(16, size * 0.1), premiumPalette.white, premiumPalette.goldLight),
  ]);

const moneySymbolGroup = (name, size, color = premiumPalette.gold) =>
  group(name, [
    group("Money Glow", [
      ellipseShape("Money Glow Path", size * 1.6, size * 1.6),
      fillNode("Money Glow Fill", color, 10),
    ]),
    lineStrokeGroup("Money S Top", [[size * 0.24, -(size * 0.36)], [-(size * 0.22), -(size * 0.42)], [-(size * 0.34), -(size * 0.08)], [size * 0.22, size * 0.02]], color, size * 0.18, premiumPalette.white, size * 0.07, 22, 84),
    lineStrokeGroup("Money S Bottom", [[size * 0.22, size * 0.02], [size * 0.34, size * 0.36], [-(size * 0.22), size * 0.42], [-(size * 0.32), size * 0.26]], color, size * 0.18, premiumPalette.white, size * 0.07, 22, 84),
    lineStrokeGroup("Money Vertical", [[0, -(size * 0.58)], [0, size * 0.58]], color, size * 0.12, premiumPalette.goldLight, size * 0.045, 20, 84),
  ]);

const trophyGroup = (name, size) =>
  group(name, [
    group("Trophy Glow", [
      ellipseShape("Trophy Glow Path", size * 2.1, size * 2.0),
      fillNode("Trophy Glow Fill", premiumPalette.gold, 13),
    ]),
    group("Cup", [
      pathShape("Cup Path", [[-(size * 0.54), -(size * 0.46)], [size * 0.54, -(size * 0.46)], [size * 0.38, size * 0.24], [0, size * 0.44], [-(size * 0.38), size * 0.24]], true),
      fillNode("Cup Fill", premiumPalette.gold, 96),
      strokeNode("Cup Shine", premiumPalette.goldLight, Math.max(5, size * 0.05), 74),
    ]),
    lineStrokeGroup("Left Handle", [[-(size * 0.54), -(size * 0.28)], [-(size * 0.92), -(size * 0.18)], [-(size * 0.62), size * 0.18]], premiumPalette.gold, size * 0.13, premiumPalette.goldLight, size * 0.055, 24, 86),
    lineStrokeGroup("Right Handle", [[size * 0.54, -(size * 0.28)], [size * 0.92, -(size * 0.18)], [size * 0.62, size * 0.18]], premiumPalette.gold, size * 0.13, premiumPalette.goldLight, size * 0.055, 24, 86),
    group("Stem", [
      rectShape("Stem Path", size * 0.26, size * 0.45, size * 0.06),
      fillNode("Stem Fill", premiumPalette.gold, 96),
    ], { position: [0, size * 0.58] }),
    group("Base", [
      rectShape("Base Path", size * 0.9, size * 0.25, size * 0.08),
      fillNode("Base Fill", premiumPalette.gold, 96),
      strokeNode("Base Shine", premiumPalette.white, Math.max(3, size * 0.035), 34),
    ], { position: [0, size * 0.86] }),
    sparkleGroup("Trophy Spark", Math.max(16, size * 0.1), premiumPalette.white, premiumPalette.goldLight),
  ]);

const buildDiamondJackpotBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  const shards = buildRadialBurstLayers(nextIndex, {
    seed: 9301,
    count: 38,
    center,
    minRadius: 260,
    maxRadius: 900,
    startFrame: 0,
    duration: 92,
    palette: [premiumPalette.diamond, premiumPalette.cyan, premiumPalette.goldLight, premiumPalette.white],
    sizeRange: [18, 48],
    scaleFrom: 36,
    scaleTo: 128,
    travelYScale: 0.62,
    shapeFactory: ({ size, color }) => [shardGroup("Crystal Shard", size * 0.82, size * 1.22, color, premiumPalette.white)],
  });
  layers.push(...shards);
  nextIndex += shards.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Diamond Jackpot Hero", [diamondHeroGroup("Hero Diamond", 245)], 54, 96, 168, center));
  nextIndex += 1;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9302, 68, 32, center));
  return makeAnimation("Diamond Jackpot Burst", layers);
};

const buildRoyalGoldCrown = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.46];
  const dust = buildGoldDustLayers(nextIndex, 9311, 0, 32, center);
  layers.push(...dust);
  nextIndex += dust.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Royal Gold Crown Hero", [crownGroup("Hero Crown", 230)], 44, 92, 168, center));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, {
    seed: 9312,
    count: 3,
    center,
    radiusRange: [170, 420],
    widthRange: [7, 13],
    palette: [premiumPalette.gold, premiumPalette.goldLight],
    accentPalette: [premiumPalette.white],
    startFrame: 58,
    durationRange: [84, 108],
    scaleFrom: 34,
    scaleTo: 160,
  }));
  return makeAnimation("Royal Gold Crown", layers);
};

const buildMoneyWinCascade = () => {
  let nextIndex = 1;
  const layers = [];
  const money = buildFallingLayers(nextIndex, {
    seed: 9321,
    count: 42,
    palette: [premiumPalette.gold, premiumPalette.goldLight, premiumPalette.emerald],
    sizeRange: [26, 58],
    shapeFactory: ({ size, color, index }) => index % 3 === 0
      ? [coinGroup("Money Coin", size * 0.5, premiumPalette.gold, premiumPalette.goldLight)]
      : [moneySymbolGroup("Money Symbol", size, color)],
  });
  layers.push(...money);
  nextIndex += money.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Money Win Hero Glow", [moneySymbolGroup("Hero Money Symbol", 250, premiumPalette.gold)], 58, 96, 168, [WIDTH / 2, HEIGHT / 2]));
  nextIndex += 1;
  layers.push(...buildGoldDustLayers(nextIndex, 9322, 62, 32, [WIDTH / 2, HEIGHT / 2]));
  return makeAnimation("Money Win Cascade", layers);
};

const buildElectricPremiumBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  const configs = [
    [500, 300, 170, 340, -18],
    [1420, 300, 170, 340, 18],
    [960, 520, 220, 430, 0],
    [340, 610, 140, 280, -34],
    [1580, 610, 140, 280, 34],
  ];
  for (const [x, y, width, height, rotation] of configs) {
    layers.push(buildLayer({
      index: nextIndex,
      name: `Premium Lightning ${nextIndex}`,
      shapes: [lightningGroup("Electric Arc", width, height, premiumPalette.white, premiumPalette.cyan)],
      positionFrames: [
        { t: 0, s: [x, y, 0] },
        { t: 68, s: [center[0] + ((x - center[0]) * 0.24), center[1] + ((y - center[1]) * 0.24), 0] },
        { t: 112, s: [center[0] + ((x - center[0]) * 0.24), center[1] + ((y - center[1]) * 0.24), 0] },
        { t: 179, s: [x, y, 0] },
      ],
      scaleFrames: [
        { t: 0, s: [20, 20, 100] },
        { t: 48, s: [86, 86, 100] },
        { t: 68, s: [118, 118, 100] },
        { t: 112, s: [106, 106, 100] },
        { t: 179, s: [60, 60, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: 26, s: [72] },
        { t: 68, s: [100] },
        { t: 112, s: [84] },
        { t: 179, s: [0] },
      ],
      rotationFrames: [{ t: 0, s: [rotation] }],
    }));
    nextIndex += 1;
  }
  layers.push(...buildRingPulseLayers(nextIndex, {
    seed: 9331,
    count: 4,
    center,
    radiusRange: [150, 440],
    widthRange: [8, 15],
    palette: [premiumPalette.cyan, premiumPalette.blue, premiumPalette.white],
    accentPalette: [premiumPalette.cyan],
    startFrame: 58,
    durationRange: [84, 112],
    scaleFrom: 24,
    scaleTo: 180,
  }));
  return makeAnimation("Electric Premium Blast", layers);
};

const buildTrophyWinMoment = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  const dust = buildGoldDustLayers(nextIndex, 9341, 0, 36, center);
  layers.push(...dust);
  nextIndex += dust.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Trophy Win Hero", [trophyGroup("Hero Trophy", 210)], 48, 96, 168, center));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, {
    seed: 9342,
    count: 3,
    center,
    radiusRange: [160, 420],
    widthRange: [7, 13],
    palette: [premiumPalette.gold, premiumPalette.goldLight],
    accentPalette: [premiumPalette.white],
    startFrame: 62,
    durationRange: [80, 104],
    scaleFrom: 34,
    scaleTo: 160,
  }));
  return makeAnimation("Trophy Win Moment", layers);
};

const confettiExplosionPalette = [
  rgb("#ff4fd8"),
  rgb("#58c7ff"),
  rgb("#f5c65b"),
  rgb("#8f5bff"),
  rgb("#ff9c36"),
  rgb("#ffffff"),
];

const buildConfettiBurstLayers = (startIndex, seed, center, count, startFrame = 28, duration = 118) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 180,
    maxRadius: 980,
    startFrame,
    duration,
    palette: confettiExplosionPalette,
    sizeRange: [14, 38],
    scaleFrom: 28,
    scaleTo: 140,
    travelYScale: 0.64,
    shapeFactory: ({ size, color, index }) =>
      index % 6 === 0
        ? [ribbonGroup("Explosion Ribbon", size * 1.8, color, rgb("#ffffff"))]
        : [confettiGroup("Explosion Confetti", size * 0.95, size * (index % 2 === 0 ? 0.54 : 0.36), color, rgb("#ffffff"))],
  });

const buildConfettiRainLayers = (startIndex, seed, count, startY = -140, endY = HEIGHT + 170) =>
  buildFallingLayers(startIndex, {
    seed,
    count,
    startY,
    endY,
    xRange: [70, WIDTH - 70],
    palette: confettiExplosionPalette,
    sizeRange: [12, 34],
    shapeFactory: ({ size, color, index }) =>
      index % 7 === 0
        ? [ribbonGroup("Rain Ribbon", size * 1.48, color, rgb("#ffffff"))]
        : [confettiGroup("Rain Confetti", size * 0.92, size * (index % 2 === 0 ? 0.52 : 0.36), color, rgb("#ffffff"))],
  });

const buildRibbonSweepLayers = (startIndex, sweeps) => {
  const layers = [];
  for (const [index, sweep] of sweeps.entries()) {
    const midFrame = sweep.start + 24;
    const endFrame = sweep.start + 114;
    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Confetti Ribbon Sweep ${index + 1}`,
      shapes: [ribbonGroup("Ribbon Sweep Shape", sweep.length, sweep.color, sweep.accent)],
      positionFrames: [
        { t: sweep.start, s: [sweep.from[0], sweep.from[1], 0] },
        { t: midFrame, s: [sweep.mid[0], sweep.mid[1], 0] },
        { t: endFrame, s: [sweep.to[0], sweep.to[1], 0] },
      ],
      scaleFrames: [
        { t: sweep.start, s: [54, 54, 100] },
        { t: midFrame, s: [134, 134, 100] },
        { t: 112, s: [118, 118, 100] },
        { t: endFrame, s: [86, 86, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: sweep.start, s: [0] },
        { t: sweep.start + 8, s: [94] },
        { t: 112, s: [88] },
        { t: endFrame, s: [0] },
      ],
      rotationFrames: [
        { t: sweep.start, s: [sweep.rotation] },
        { t: midFrame, s: [sweep.rotation + sweep.spin * 0.5] },
        { t: endFrame, s: [sweep.rotation + sweep.spin] },
      ],
      inFrame: sweep.start,
      outFrame: Math.min(DURATION_FRAMES, endFrame + 1),
    }));
  }
  return layers;
};

const buildMegaConfettiCannon = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.54];

  layers.push(buildLayer({
    index: nextIndex,
    name: "Left Confetti Cannon",
    shapes: [partyHornGroup("Left Cannon Shape", 292, rgb("#8f5bff"), rgb("#58c7ff"), rgb("#fff1b4"))],
    positionFrames: [
      { t: 0, s: [-260, HEIGHT * 0.72, 0] },
      { t: 24, s: [360, HEIGHT * 0.68, 0] },
      { t: 112, s: [360, HEIGHT * 0.68, 0] },
      { t: 170, s: [210, HEIGHT * 0.76, 0] },
    ],
    scaleFrames: [{ t: 0, s: [66, 66, 100] }, { t: 24, s: [112, 112, 100] }, { t: 112, s: [100, 100, 100] }, { t: 170, s: [76, 76, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 12, s: [90] }, { t: 135, s: [86] }, { t: 170, s: [0] }],
    rotationFrames: [{ t: 0, s: [-22] }],
  }));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Right Confetti Cannon",
    shapes: [partyHornGroup("Right Cannon Shape", 292, rgb("#ff4fd8"), rgb("#58c7ff"), rgb("#fff1b4"))],
    positionFrames: [
      { t: 0, s: [WIDTH + 260, HEIGHT * 0.72, 0] },
      { t: 24, s: [WIDTH - 360, HEIGHT * 0.68, 0] },
      { t: 112, s: [WIDTH - 360, HEIGHT * 0.68, 0] },
      { t: 170, s: [WIDTH - 210, HEIGHT * 0.76, 0] },
    ],
    scaleFrames: [{ t: 0, s: [66, 66, 100] }, { t: 24, s: [112, 112, 100] }, { t: 112, s: [100, 100, 100] }, { t: 170, s: [76, 76, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 12, s: [90] }, { t: 135, s: [86] }, { t: 170, s: [0] }],
    rotationFrames: [{ t: 0, s: [202] }],
  }));
  nextIndex += 1;

  const left = buildConfettiBurstLayers(nextIndex, 9401, [330, HEIGHT * 0.66], 42, 26, 126);
  layers.push(...left);
  nextIndex += left.length;
  const right = buildConfettiBurstLayers(nextIndex, 9402, [WIDTH - 330, HEIGHT * 0.66], 42, 26, 126);
  layers.push(...right);
  nextIndex += right.length;
  layers.push(...buildConfettiRainLayers(nextIndex, 9403, 40));
  return makeAnimation("Mega Confetti Cannon", layers);
};

const buildConfettiJackpotBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildHeroFlowerLayer(nextIndex, "Confetti Jackpot Charge", [
    ringGroup("Jackpot Flash Ring", 240, rgb("#f5c65b"), rgb("#ffffff"), 16),
    sparkleGroup("Jackpot Center Spark", 46, rgb("#ffffff"), rgb("#fff1b4")),
  ], 24, 70, 132, center));
  nextIndex += 1;
  const burst = buildConfettiBurstLayers(nextIndex, 9411, center, 82, 34, 124);
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(...buildConfettiRainLayers(nextIndex, 9412, 36));
  return makeAnimation("Confetti Jackpot Blast", layers);
};

const buildConfettiRainStorm = () => {
  let nextIndex = 1;
  const layers = [];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Confetti Storm Atmosphere",
    shapes: [
      group("Storm Glow", [
        ellipseShape("Storm Glow Path", 940, 420),
        fillNode("Storm Glow Fill", rgb("#ff4fd8"), 7),
      ]),
    ],
    positionFrames: [{ t: 0, s: [WIDTH / 2, HEIGHT / 2, 0] }],
    scaleFrames: [{ t: 0, s: [30, 30, 100] }, { t: 68, s: [100, 100, 100] }, { t: 112, s: [100, 100, 100] }, { t: 179, s: [120, 120, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 34, s: [40] }, { t: 112, s: [54] }, { t: 135, s: [32] }, { t: 179, s: [0] }],
  }));
  nextIndex += 1;
  const rainA = buildConfettiRainLayers(nextIndex, 9421, 58, -160, HEIGHT + 140);
  layers.push(...rainA);
  nextIndex += rainA.length;
  const rainB = buildConfettiRainLayers(nextIndex, 9422, 38, -300, HEIGHT + 180);
  layers.push(...rainB);
  return makeAnimation("Confetti Rain Storm", layers);
};

const buildRibbonConfettiBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const sweeps = [
    { start: 14, from: [-160, 180], mid: [760, 390], to: [WIDTH + 180, 720], length: 360, color: rgb("#ff4fd8"), accent: rgb("#ffffff"), rotation: -24, spin: 130 },
    { start: 18, from: [WIDTH + 160, 160], mid: [1120, 410], to: [-180, 760], length: 370, color: rgb("#58c7ff"), accent: rgb("#fff1b4"), rotation: 202, spin: -140 },
    { start: 24, from: [-160, 760], mid: [900, 500], to: [WIDTH + 180, 260], length: 330, color: rgb("#f5c65b"), accent: rgb("#ffffff"), rotation: 18, spin: 120 },
    { start: 28, from: [WIDTH + 160, 760], mid: [980, 470], to: [-180, 240], length: 330, color: rgb("#8f5bff"), accent: rgb("#ffffff"), rotation: 160, spin: -110 },
  ];
  const ribbons = buildRibbonSweepLayers(nextIndex, sweeps);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  const burst = buildConfettiBurstLayers(nextIndex, 9431, [WIDTH / 2, HEIGHT / 2], 58, 34, 124);
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(...buildConfettiRainLayers(nextIndex, 9432, 28));
  return makeAnimation("Ribbon Confetti Burst", layers);
};

const buildGrandConfettiFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const sideA = buildConfettiBurstLayers(nextIndex, 9441, [300, HEIGHT * 0.68], 32, 22, 134);
  layers.push(...sideA);
  nextIndex += sideA.length;
  const sideB = buildConfettiBurstLayers(nextIndex, 9442, [WIDTH - 300, HEIGHT * 0.68], 32, 22, 134);
  layers.push(...sideB);
  nextIndex += sideB.length;
  const center = buildConfettiBurstLayers(nextIndex, 9443, [WIDTH / 2, HEIGHT / 2], 76, 44, 124);
  layers.push(...center);
  nextIndex += center.length;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 28, from: [-180, 240], mid: [780, 380], to: [WIDTH + 180, 650], length: 340, color: rgb("#ff4fd8"), accent: rgb("#ffffff"), rotation: -18, spin: 120 },
    { start: 32, from: [WIDTH + 180, 240], mid: [1120, 380], to: [-180, 650], length: 340, color: rgb("#58c7ff"), accent: rgb("#fff1b4"), rotation: 198, spin: -120 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  layers.push(...buildConfettiRainLayers(nextIndex, 9444, 44));
  return makeAnimation("Grand Confetti Finale", layers);
};

const premiumConfettiPalette = [
  rgb("#f5c65b"),
  rgb("#fff1b4"),
  rgb("#ff9c36"),
  rgb("#ffffff"),
  rgb("#58c7ff"),
  rgb("#ff4fd8"),
];

const premiumRainbowConfettiPalette = [
  rgb("#ff4fd8"),
  rgb("#ff9c36"),
  rgb("#f5c65b"),
  rgb("#23bf66"),
  rgb("#58c7ff"),
  rgb("#8f5bff"),
  rgb("#ffffff"),
];

const buildPremiumConfettiBurstLayers = (startIndex, seed, center, count, options = {}) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: options.minRadius ?? 150,
    maxRadius: options.maxRadius ?? 1040,
    startFrame: options.startFrame ?? 28,
    duration: options.duration ?? 130,
    palette: options.palette ?? premiumConfettiPalette,
    sizeRange: options.sizeRange ?? [16, 44],
    scaleFrom: 24,
    scaleTo: options.scaleTo ?? 148,
    travelYScale: options.travelYScale ?? 0.68,
    shapeFactory: ({ size, color, index }) =>
      index % 5 === 0
        ? [ribbonGroup("Premium Metallic Ribbon", size * 2.1, color, rgb("#ffffff"))]
        : [confettiGroup("Premium Metallic Confetti", size, size * (index % 2 === 0 ? 0.48 : 0.32), color, rgb("#ffffff"))],
  });

const buildPremiumConfettiRainLayers = (startIndex, seed, count, options = {}) =>
  buildFallingLayers(startIndex, {
    seed,
    count,
    startY: options.startY ?? -160,
    endY: options.endY ?? HEIGHT + 170,
    xRange: options.xRange ?? [70, WIDTH - 70],
    palette: options.palette ?? premiumConfettiPalette,
    sizeRange: options.sizeRange ?? [12, 34],
    shapeFactory: ({ size, color, index }) =>
      index % 6 === 0
        ? [ribbonGroup("Premium Falling Streamer", size * 1.62, color, rgb("#ffffff"))]
        : [confettiGroup("Premium Falling Confetti", size * 0.94, size * (index % 2 === 0 ? 0.5 : 0.34), color, rgb("#ffffff"))],
  });

const buildPremiumConfettiGlowLayer = (index, name, color, startFrame = 0, peakFrame = 72, endFrame = 179) =>
  buildLayer({
    index,
    name,
    shapes: [
      group("Premium Confetti Glow", [
        ellipseShape("Glow Field", 980, 460),
        fillNode("Glow Fill", color, 9),
      ]),
      group("Premium Confetti Core Flash", [
        ellipseShape("Core Flash", 380, 180),
        fillNode("Core Fill", rgb("#ffffff"), 12),
      ]),
    ],
    positionFrames: [{ t: 0, s: [WIDTH / 2, HEIGHT * 0.52, 0] }],
    scaleFrames: [
      { t: startFrame, s: [24, 24, 100] },
      { t: peakFrame, s: [112, 112, 100] },
      { t: endFrame, s: [136, 136, 100] },
    ],
    opacityFrames: [
      { t: 0, s: [0] },
      { t: clampFrame(startFrame + 8), s: [46] },
      { t: peakFrame, s: [78] },
      { t: 135, s: [34] },
      { t: endFrame, s: [0] },
    ],
    inFrame: startFrame,
    outFrame: DURATION_FRAMES,
  });

const buildLuxuryConfettiBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Luxury Confetti Charge", rgb("#f5c65b"), 0, 70, 179));
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Luxury Confetti Shock Flash", [
    ringGroup("Luxury Jackpot Ring", 260, rgb("#f5c65b"), rgb("#ffffff"), 14),
    sparkleGroup("Luxury Center Flash", 54, rgb("#ffffff"), rgb("#fff1b4")),
  ], 18, 70, 132, center));
  nextIndex += 1;
  const burst = buildPremiumConfettiBurstLayers(nextIndex, 9861, center, 96, { startFrame: 32, duration: 130, maxRadius: 1080 });
  layers.push(...burst);
  nextIndex += burst.length;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 36, from: [-160, 260], mid: [780, 400], to: [WIDTH + 180, 670], length: 390, color: rgb("#f5c65b"), accent: rgb("#ffffff"), rotation: -16, spin: 112 },
    { start: 40, from: [WIDTH + 160, 250], mid: [1120, 390], to: [-180, 690], length: 380, color: rgb("#fff1b4"), accent: rgb("#ff4fd8"), rotation: 196, spin: -118 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  layers.push(...buildPremiumConfettiRainLayers(nextIndex, 9862, 42));
  return makeAnimation("Luxury Confetti Blast", layers);
};

const buildGoldenConfettiStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const goldPalette = [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffcf70"), rgb("#ffffff"), rgb("#ff9c36")];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Golden Confetti Atmosphere", rgb("#fff1b4"), 0, 82, 179));
  nextIndex += 1;
  const rainA = buildPremiumConfettiRainLayers(nextIndex, 9871, 82, { palette: goldPalette, startY: -170, endY: HEIGHT + 150, sizeRange: [13, 36] });
  layers.push(...rainA);
  nextIndex += rainA.length;
  const rainB = buildPremiumConfettiRainLayers(nextIndex, 9872, 48, { palette: goldPalette, startY: -330, endY: HEIGHT + 180, sizeRange: [10, 26] });
  layers.push(...rainB);
  nextIndex += rainB.length;
  const peak = buildPremiumConfettiBurstLayers(nextIndex, 9873, [WIDTH / 2, HEIGHT * 0.42], 42, {
    palette: goldPalette,
    startFrame: 48,
    duration: 112,
    minRadius: 220,
    maxRadius: 920,
    sizeRange: [14, 32],
  });
  layers.push(...peak);
  return makeAnimation("Golden Confetti Storm", layers);
};

const buildConfettiShockwave = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Confetti Shockwave Charge", rgb("#58c7ff"), 0, 74, 179));
  nextIndex += 1;
  const rings = buildRingPulseLayers(nextIndex, {
    seed: 9881,
    count: 7,
    center,
    radiusRange: [180, 520],
    widthRange: [6, 14],
    palette: [rgb("#ffffff"), rgb("#f5c65b"), rgb("#58c7ff"), rgb("#ff4fd8")],
    accentPalette: [rgb("#ffffff"), rgb("#fff1b4")],
    startFrame: 30,
    durationRange: [88, 128],
    scaleFrom: 20,
    scaleTo: 210,
  });
  layers.push(...rings);
  nextIndex += rings.length;
  const burst = buildPremiumConfettiBurstLayers(nextIndex, 9882, center, 104, {
    palette: premiumRainbowConfettiPalette,
    startFrame: 34,
    duration: 132,
    maxRadius: 1120,
    travelYScale: 0.56,
  });
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(...buildPremiumConfettiRainLayers(nextIndex, 9883, 32, { palette: premiumRainbowConfettiPalette }));
  return makeAnimation("Confetti Shockwave", layers);
};

const buildRainbowConfettiCascade = () => {
  let nextIndex = 1;
  const layers = [];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Rainbow Confetti Glow", rgb("#8f5bff"), 0, 84, 179));
  nextIndex += 1;
  const sweeps = buildRibbonSweepLayers(nextIndex, [
    { start: 18, from: [-170, 180], mid: [700, 330], to: [WIDTH + 170, 620], length: 360, color: rgb("#ff4fd8"), accent: rgb("#ffffff"), rotation: -22, spin: 116 },
    { start: 22, from: [WIDTH + 170, 210], mid: [1180, 350], to: [-170, 650], length: 360, color: rgb("#58c7ff"), accent: rgb("#ffffff"), rotation: 198, spin: -118 },
    { start: 30, from: [-170, 720], mid: [840, 500], to: [WIDTH + 170, 260], length: 330, color: rgb("#f5c65b"), accent: rgb("#ffffff"), rotation: 18, spin: 104 },
    { start: 34, from: [WIDTH + 170, 740], mid: [1060, 500], to: [-170, 280], length: 330, color: rgb("#23bf66"), accent: rgb("#fff1b4"), rotation: 164, spin: -106 },
  ]);
  layers.push(...sweeps);
  nextIndex += sweeps.length;
  const rain = buildPremiumConfettiRainLayers(nextIndex, 9891, 90, {
    palette: premiumRainbowConfettiPalette,
    startY: -120,
    endY: HEIGHT + 170,
    sizeRange: [12, 32],
  });
  layers.push(...rain);
  nextIndex += rain.length;
  const burst = buildPremiumConfettiBurstLayers(nextIndex, 9892, [WIDTH / 2, HEIGHT * 0.5], 44, {
    palette: premiumRainbowConfettiPalette,
    startFrame: 48,
    duration: 118,
    maxRadius: 940,
  });
  layers.push(...burst);
  return makeAnimation("Rainbow Confetti Cascade", layers);
};

const buildGrandPremiumConfettiFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Grand Premium Confetti Glow", rgb("#f5c65b"), 0, 76, 179));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Premium Left Cannon",
    shapes: [partyHornGroup("Premium Left Cannon Shape", 270, rgb("#f5c65b"), rgb("#ff4fd8"), rgb("#ffffff"))],
    positionFrames: [{ t: 0, s: [-240, HEIGHT * 0.73, 0] }, { t: 24, s: [300, HEIGHT * 0.69, 0] }, { t: 126, s: [300, HEIGHT * 0.69, 0] }, { t: 170, s: [150, HEIGHT * 0.78, 0] }],
    scaleFrames: [{ t: 0, s: [58, 58, 100] }, { t: 24, s: [108, 108, 100] }, { t: 126, s: [100, 100, 100] }, { t: 170, s: [70, 70, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 10, s: [90] }, { t: 140, s: [82] }, { t: 170, s: [0] }],
    rotationFrames: [{ t: 0, s: [-20] }],
  }));
  nextIndex += 1;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Premium Right Cannon",
    shapes: [partyHornGroup("Premium Right Cannon Shape", 270, rgb("#58c7ff"), rgb("#ff4fd8"), rgb("#ffffff"))],
    positionFrames: [{ t: 0, s: [WIDTH + 240, HEIGHT * 0.73, 0] }, { t: 24, s: [WIDTH - 300, HEIGHT * 0.69, 0] }, { t: 126, s: [WIDTH - 300, HEIGHT * 0.69, 0] }, { t: 170, s: [WIDTH - 150, HEIGHT * 0.78, 0] }],
    scaleFrames: [{ t: 0, s: [58, 58, 100] }, { t: 24, s: [108, 108, 100] }, { t: 126, s: [100, 100, 100] }, { t: 170, s: [70, 70, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 10, s: [90] }, { t: 140, s: [82] }, { t: 170, s: [0] }],
    rotationFrames: [{ t: 0, s: [200] }],
  }));
  nextIndex += 1;
  const sideA = buildPremiumConfettiBurstLayers(nextIndex, 9901, [300, HEIGHT * 0.68], 48, { startFrame: 26, duration: 134, palette: premiumRainbowConfettiPalette, maxRadius: 840 });
  layers.push(...sideA);
  nextIndex += sideA.length;
  const sideB = buildPremiumConfettiBurstLayers(nextIndex, 9902, [WIDTH - 300, HEIGHT * 0.68], 48, { startFrame: 26, duration: 134, palette: premiumRainbowConfettiPalette, maxRadius: 840 });
  layers.push(...sideB);
  nextIndex += sideB.length;
  const centerBurst = buildPremiumConfettiBurstLayers(nextIndex, 9903, center, 112, { startFrame: 44, duration: 132, maxRadius: 1160 });
  layers.push(...centerBurst);
  nextIndex += centerBurst.length;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 30, from: [-190, 230], mid: [760, 380], to: [WIDTH + 190, 670], length: 410, color: rgb("#f5c65b"), accent: rgb("#ffffff"), rotation: -16, spin: 118 },
    { start: 34, from: [WIDTH + 190, 230], mid: [1160, 390], to: [-190, 680], length: 410, color: rgb("#ff4fd8"), accent: rgb("#ffffff"), rotation: 196, spin: -120 },
    { start: 42, from: [-190, 790], mid: [850, 520], to: [WIDTH + 190, 300], length: 360, color: rgb("#58c7ff"), accent: rgb("#fff1b4"), rotation: 20, spin: 108 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  layers.push(...buildPremiumConfettiRainLayers(nextIndex, 9904, 72, { palette: premiumRainbowConfettiPalette }));
  return makeAnimation("Grand Premium Confetti Finale", layers);
};

const goldenLuxuryConfettiPalette = [rgb("#f5c65b"), rgb("#fff1b4"), rgb("#ffcf70"), rgb("#ffffff"), rgb("#ff9c36")];

const buildGoldenConfettiJackpotBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Golden Jackpot Charge", rgb("#f5c65b"), 0, 72, 179));
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Golden Jackpot Flash", [
    ringGroup("VIP Gold Ring", 290, rgb("#f5c65b"), rgb("#ffffff"), 14),
    ringGroup("Outer Luxury Ring", 440, rgb("#fff1b4"), rgb("#f5c65b"), 8),
    sparkleGroup("Center Gold Flash", 62, rgb("#ffffff"), rgb("#fff1b4")),
  ], 18, 62, 130, center));
  nextIndex += 1;
  const burst = buildPremiumConfettiBurstLayers(nextIndex, 15001, center, 118, {
    palette: goldenLuxuryConfettiPalette,
    startFrame: 28,
    duration: 132,
    maxRadius: 1120,
    sizeRange: [14, 38],
  });
  layers.push(...burst);
  nextIndex += burst.length;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 30, from: [-190, 250], mid: [780, 390], to: [WIDTH + 190, 670], length: 430, color: rgb("#f5c65b"), accent: rgb("#ffffff"), rotation: -16, spin: 116 },
    { start: 36, from: [WIDTH + 190, 250], mid: [1120, 390], to: [-190, 690], length: 420, color: rgb("#fff1b4"), accent: rgb("#ff9c36"), rotation: 196, spin: -118 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  layers.push(...buildPremiumConfettiRainLayers(nextIndex, 15002, 44, { palette: goldenLuxuryConfettiPalette, startY: -110, endY: HEIGHT + 150, sizeRange: [12, 30] }));
  return makeAnimation("Golden Confetti Jackpot Blast", layers);
};

const buildVipGoldConfettiRain = () => {
  let nextIndex = 1;
  const layers = [];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "VIP Gold Rain Glow", rgb("#fff1b4"), 0, 82, 179));
  nextIndex += 1;
  const rainA = buildPremiumConfettiRainLayers(nextIndex, 15011, 112, {
    palette: goldenLuxuryConfettiPalette,
    startY: -190,
    endY: HEIGHT + 160,
    sizeRange: [12, 34],
  });
  layers.push(...rainA);
  nextIndex += rainA.length;
  const rainB = buildPremiumConfettiRainLayers(nextIndex, 15012, 74, {
    palette: goldenLuxuryConfettiPalette,
    startY: -420,
    endY: HEIGHT + 190,
    sizeRange: [9, 24],
  });
  layers.push(...rainB);
  nextIndex += rainB.length;
  const burst = buildPremiumConfettiBurstLayers(nextIndex, 15013, [WIDTH / 2, HEIGHT * 0.44], 42, {
    palette: goldenLuxuryConfettiPalette,
    startFrame: 44,
    duration: 116,
    minRadius: 180,
    maxRadius: 880,
    sizeRange: [12, 30],
  });
  layers.push(...burst);
  return makeAnimation("VIP Gold Confetti Rain", layers);
};

const buildTrophyGoldConfettiBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Trophy Gold Celebration Glow", rgb("#f5c65b"), 0, 78, 179));
  nextIndex += 1;
  layers.push(...buildVictoryBeamLayers(nextIndex, 15021, center, 18));
  nextIndex += 18;
  layers.push(buildHeroFlowerLayer(nextIndex, "Trophy Gold Hero", [
    trophyGroup("Trophy Gold Silhouette", 190),
    sparkleGroup("Trophy Victory Spark", 56, rgb("#ffffff"), rgb("#fff1b4")),
  ], 34, 74, 150, center));
  nextIndex += 1;
  const burst = buildPremiumConfettiBurstLayers(nextIndex, 15022, center, 92, {
    palette: goldenLuxuryConfettiPalette,
    startFrame: 44,
    duration: 126,
    maxRadius: 1040,
    sizeRange: [12, 34],
  });
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(...buildPremiumConfettiRainLayers(nextIndex, 15023, 42, { palette: goldenLuxuryConfettiPalette, startY: -130, endY: HEIGHT + 150 }));
  return makeAnimation("Trophy Gold Confetti Burst", layers);
};

const buildGoldRibbonConfettiStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Gold Ribbon Storm Glow", rgb("#f5c65b"), 0, 78, 179));
  nextIndex += 1;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 18, from: [-190, 160], mid: [700, 330], to: [WIDTH + 190, 630], length: 430, color: rgb("#f5c65b"), accent: rgb("#ffffff"), rotation: -22, spin: 120 },
    { start: 22, from: [WIDTH + 190, 190], mid: [1180, 340], to: [-190, 650], length: 420, color: rgb("#fff1b4"), accent: rgb("#f5c65b"), rotation: 198, spin: -124 },
    { start: 34, from: [-190, 800], mid: [820, 520], to: [WIDTH + 190, 290], length: 380, color: rgb("#ffcf70"), accent: rgb("#ffffff"), rotation: 18, spin: 108 },
    { start: 38, from: [WIDTH + 190, 790], mid: [1050, 520], to: [-190, 300], length: 380, color: rgb("#ff9c36"), accent: rgb("#fff1b4"), rotation: 164, spin: -110 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  const burst = buildPremiumConfettiBurstLayers(nextIndex, 15031, center, 86, {
    palette: goldenLuxuryConfettiPalette,
    startFrame: 36,
    duration: 128,
    maxRadius: 1040,
  });
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(...buildPremiumConfettiRainLayers(nextIndex, 15032, 70, { palette: goldenLuxuryConfettiPalette, startY: -160, endY: HEIGHT + 170, sizeRange: [10, 30] }));
  return makeAnimation("Gold Ribbon Confetti Storm", layers);
};

const buildRoyalGoldConfettiFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildPremiumConfettiGlowLayer(nextIndex, "Royal Gold Finale Glow", rgb("#fff1b4"), 0, 78, 179));
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Royal Crown Shine Accent", [
    crownGroup("Royal Gold Crown Accent", 150),
    ringGroup("Royal Gold Halo", 360, rgb("#f5c65b"), rgb("#ffffff"), 10),
  ], 34, 72, 138, [WIDTH / 2, HEIGHT * 0.35]));
  nextIndex += 1;
  const centerBurst = buildPremiumConfettiBurstLayers(nextIndex, 15041, center, 124, {
    palette: goldenLuxuryConfettiPalette,
    startFrame: 32,
    duration: 134,
    maxRadius: 1160,
    sizeRange: [13, 38],
  });
  layers.push(...centerBurst);
  nextIndex += centerBurst.length;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 28, from: [-190, 240], mid: [760, 390], to: [WIDTH + 190, 670], length: 430, color: rgb("#f5c65b"), accent: rgb("#ffffff"), rotation: -16, spin: 118 },
    { start: 34, from: [WIDTH + 190, 245], mid: [1160, 390], to: [-190, 680], length: 420, color: rgb("#fff1b4"), accent: rgb("#ff9c36"), rotation: 196, spin: -120 },
    { start: 44, from: [-190, 760], mid: [860, 520], to: [WIDTH + 190, 300], length: 360, color: rgb("#ffcf70"), accent: rgb("#ffffff"), rotation: 20, spin: 108 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  layers.push(...buildPremiumConfettiRainLayers(nextIndex, 15042, 88, { palette: goldenLuxuryConfettiPalette, startY: -150, endY: HEIGHT + 180, sizeRange: [10, 32] }));
  return makeAnimation("Royal Gold Confetti Finale", layers);
};

const heartPalette = {
  red: rgb("#ff3f6e"),
  pink: rgb("#ff6ec7"),
  hotPink: rgb("#ff4fd8"),
  rose: rgb("#ff9fdb"),
  white: rgb("#ffffff"),
  goldLight: rgb("#fff1b4"),
};

const heartPoints = (size) => {
  const points = [];
  for (let index = 0; index < 40; index += 1) {
    const t = (index / 40) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    points.push([x * size * 0.033, y * size * 0.033]);
  }
  return points;
};

const heartGroup = (name, size, color = heartPalette.red, accent = heartPalette.white) =>
  group(name, [
    group("Heart Glow", [
      pathShape("Heart Glow Path", heartPoints(size * 1.2), true),
      fillNode("Heart Glow Fill", color, 14),
    ]),
    group("Heart Fill", [
      pathShape("Heart Path", heartPoints(size), true),
      fillNode("Heart Fill", color, 94),
      strokeNode("Heart Shine Stroke", accent, Math.max(2, size * 0.035), 28),
    ]),
    group("Heart Highlight", [
      ellipseShape("Heart Highlight Path", size * 0.18, size * 0.11),
      fillNode("Heart Highlight Fill", accent, 28),
    ], {
      position: [-(size * 0.18), -(size * 0.18)],
      rotation: -24,
    }),
  ]);

const cupidArrowGroup = (name, length, color = heartPalette.white, accent = heartPalette.pink) =>
  group(name, [
    lineStrokeGroup("Arrow Shaft", [[-(length * 0.48), 0], [length * 0.34, 0]], accent, 13, color, 5, 24, 92),
    group("Arrow Head", [
      pathShape("Arrow Head Path", [[length * 0.34, 0], [length * 0.18, -(length * 0.08)], [length * 0.22, 0], [length * 0.18, length * 0.08]], true),
      fillNode("Arrow Head Fill", color, 96),
      strokeNode("Arrow Head Shine", accent, Math.max(2, length * 0.012), 46),
    ]),
    group("Arrow Feather A", [
      pathShape("Feather A Path", [[-(length * 0.48), 0], [-(length * 0.62), -(length * 0.08)], [-(length * 0.54), 0]], true),
      fillNode("Feather A Fill", accent, 82),
    ]),
    group("Arrow Feather B", [
      pathShape("Feather B Path", [[-(length * 0.48), 0], [-(length * 0.62), length * 0.08], [-(length * 0.54), 0]], true),
      fillNode("Feather B Fill", accent, 82),
    ]),
  ]);

const buildHeartParticleLayers = (startIndex, seed, count, mode = "burst", center = [WIDTH / 2, HEIGHT / 2]) => {
  if (mode === "rain") {
    return buildFallingLayers(startIndex, {
      seed,
      count,
      startY: -140,
      endY: HEIGHT + 170,
      xRange: [70, WIDTH - 70],
      palette: [heartPalette.red, heartPalette.pink, heartPalette.hotPink, heartPalette.rose],
      sizeRange: [18, 48],
      shapeFactory: ({ size, color, index }) => [heartGroup(`Rain Heart ${index}`, size, color)],
    });
  }

  return buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 180,
    maxRadius: 900,
    startFrame: 42,
    duration: 116,
    palette: [heartPalette.red, heartPalette.pink, heartPalette.hotPink, heartPalette.rose],
    sizeRange: [18, 52],
    scaleFrom: 30,
    scaleTo: 138,
    travelYScale: 0.62,
    shapeFactory: ({ size, color, index }) => [heartGroup(`Burst Heart ${index}`, size, color)],
  });
};

const buildGiantHeartFormation = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  for (let index = 0; index < 64; index += 1) {
    const t = (index / 64) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    const target = [center[0] + x * 26, center[1] + y * 23];
    const edgeAngle = t + 1.4;
    layers.push(buildLayer({
      index: nextIndex,
      name: `Giant Formation Heart ${index + 1}`,
      shapes: [heartGroup("Formation Heart", 36 + ((index % 5) * 4), index % 3 === 0 ? heartPalette.red : index % 3 === 1 ? heartPalette.pink : heartPalette.hotPink)],
      positionFrames: [
        { t: 0, s: [center[0] + Math.cos(edgeAngle) * 980, center[1] + Math.sin(edgeAngle) * 560, 0] },
        { t: 68, s: [target[0], target[1], 0] },
        { t: 112, s: [target[0], target[1], 0] },
        { t: 170, s: [target[0] + Math.cos(t) * 330, target[1] + Math.sin(t) * 210, 0] },
      ],
      scaleFrames: [{ t: 0, s: [20, 20, 100] }, { t: 68, s: [100, 100, 100] }, { t: 112, s: [108, 108, 100] }, { t: 170, s: [56, 56, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 14 + (index % 12), s: [82] }, { t: 112, s: [94] }, { t: 170, s: [0] }],
      rotationFrames: [{ t: 0, s: [index * 9] }, { t: 112, s: [index * 9 + 22] }, { t: 170, s: [index * 9 + 96] }],
    }));
    nextIndex += 1;
  }
  layers.push(buildHeroFlowerLayer(nextIndex, "Giant Heart Hero Glow", [heartGroup("Hero Heart", 390, heartPalette.red, heartPalette.white)], 58, 96, 168, center));
  nextIndex += 1;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9501, 68, 26, center));
  return makeAnimation("Giant Heart Formation", layers);
};

const buildHeartRainExplosion = () => {
  let nextIndex = 1;
  const layers = [];
  const rain = buildHeartParticleLayers(nextIndex, 9511, 72, "rain");
  layers.push(...rain);
  nextIndex += rain.length;
  const burst = buildHeartParticleLayers(nextIndex, 9512, 42, "burst", [WIDTH / 2, HEIGHT / 2]);
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Heart Rain Love Burst", [heartGroup("Rain Hero Heart", 240, heartPalette.hotPink, heartPalette.white)], 58, 98, 168, [WIDTH / 2, HEIGHT / 2]));
  return makeAnimation("Heart Rain Explosion", layers);
};

const buildCupidHeartBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Cupid Arrow Strike",
    shapes: [cupidArrowGroup("Cupid Arrow", 760, heartPalette.white, heartPalette.pink)],
    positionFrames: [
      { t: 0, s: [-360, center[1] - 80, 0] },
      { t: 54, s: [center[0], center[1], 0] },
      { t: 90, s: [center[0] + 140, center[1] + 18, 0] },
      { t: 150, s: [WIDTH + 360, center[1] + 120, 0] },
    ],
    scaleFrames: [{ t: 0, s: [72, 72, 100] }, { t: 54, s: [112, 112, 100] }, { t: 112, s: [100, 100, 100] }, { t: 150, s: [74, 74, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 10, s: [92] }, { t: 112, s: [84] }, { t: 150, s: [0] }],
    rotationFrames: [{ t: 0, s: [8] }, { t: 90, s: [8] }],
  }));
  nextIndex += 1;
  const burst = buildHeartParticleLayers(nextIndex, 9521, 58, "burst", center);
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Cupid Impact Heart", [heartGroup("Cupid Hero Heart", 255, heartPalette.red, heartPalette.white)], 54, 92, 166, center));
  return makeAnimation("Cupid Heart Blast", layers);
};

const buildDoubleHeartMerge = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  for (const side of [-1, 1]) {
    layers.push(buildLayer({
      index: nextIndex,
      name: side < 0 ? "Left Heart Merge" : "Right Heart Merge",
      shapes: [heartGroup("Merge Heart", 230, side < 0 ? heartPalette.red : heartPalette.pink, heartPalette.white)],
      positionFrames: [
        { t: 0, s: [center[0] + side * 980, center[1], 0] },
        { t: 52, s: [center[0] + side * 140, center[1], 0] },
        { t: 78, s: [center[0] + side * 40, center[1], 0] },
        { t: 112, s: [center[0] + side * 40, center[1], 0] },
        { t: 150, s: [center[0] + side * 280, center[1] + 90, 0] },
      ],
      scaleFrames: [{ t: 0, s: [50, 50, 100] }, { t: 52, s: [105, 105, 100] }, { t: 78, s: [86, 86, 100] }, { t: 112, s: [88, 88, 100] }, { t: 150, s: [46, 46, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 12, s: [96] }, { t: 112, s: [72] }, { t: 150, s: [0] }],
    }));
    nextIndex += 1;
  }
  layers.push(buildHeroFlowerLayer(nextIndex, "Merged Giant Heart", [heartGroup("Merged Hero Heart", 360, heartPalette.hotPink, heartPalette.white)], 68, 98, 168, center));
  nextIndex += 1;
  const burst = buildHeartParticleLayers(nextIndex, 9531, 36, "burst", center);
  layers.push(...burst);
  return makeAnimation("Double Heart Merge", layers);
};

const buildHeartJackpotFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  const rain = buildHeartParticleLayers(nextIndex, 9541, 54, "rain");
  layers.push(...rain);
  nextIndex += rain.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Heart Jackpot Hero", [heartGroup("Jackpot Hero Heart", 350, heartPalette.red, heartPalette.white)], 56, 96, 168, center));
  nextIndex += 1;
  const burst = buildHeartParticleLayers(nextIndex, 9542, 54, "burst", center);
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9543, 68, 32, center));
  return makeAnimation("Heart Jackpot Finale", layers);
};

const thumbsPalette = {
  blue: rgb("#2f86ff"),
  cyan: rgb("#58c7ff"),
  lightBlue: rgb("#d8ecff"),
  white: rgb("#ffffff"),
  goldLight: rgb("#fff1b4"),
  purple: rgb("#8f5bff"),
};

const thumbsUpGroup = (name, size, color = thumbsPalette.blue, accent = thumbsPalette.white) =>
  group(name, [
    group("Thumb Glow", [
      ellipseShape("Thumb Glow Path", size * 1.78, size * 1.9),
      fillNode("Thumb Glow Fill", color, 13),
    ]),
    group("Palm", [
      rectShape("Palm Path", size * 0.62, size * 0.68, size * 0.16),
      fillNode("Palm Fill", color, 94),
      strokeNode("Palm Shine", accent, Math.max(3, size * 0.035), 26),
    ], { position: [size * 0.05, size * 0.18], rotation: -4 }),
    group("Thumb", [
      rectShape("Thumb Path", size * 0.32, size * 0.78, size * 0.16),
      fillNode("Thumb Fill", color, 94),
      strokeNode("Thumb Shine", accent, Math.max(3, size * 0.035), 28),
    ], { position: [-(size * 0.27), -(size * 0.2)], rotation: -34 }),
    ...Array.from({ length: 4 }, (_, index) => group(`Finger ${index + 1}`, [
      rectShape("Finger Path", size * (0.52 - index * 0.035), size * 0.17, size * 0.08),
      fillNode("Finger Fill", color, 94),
      strokeNode("Finger Shine", accent, Math.max(2, size * 0.02), 20),
    ], { position: [size * 0.32, -(size * 0.16) + (index * size * 0.18)] })),
    group("Wrist", [
      rectShape("Wrist Path", size * 0.34, size * 0.34, size * 0.08),
      fillNode("Wrist Fill", thumbsPalette.lightBlue, 88),
      strokeNode("Wrist Rim", accent, Math.max(2, size * 0.026), 42),
    ], { position: [-(size * 0.18), size * 0.6] }),
    sparkleGroup("Thumb Shine Spark", Math.max(12, size * 0.09), accent, thumbsPalette.cyan),
  ]);

const buildThumbParticleLayers = (startIndex, seed, count, center = [WIDTH / 2, HEIGHT / 2]) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 220,
    maxRadius: 920,
    startFrame: 42,
    duration: 112,
    palette: [thumbsPalette.blue, thumbsPalette.cyan, thumbsPalette.lightBlue, thumbsPalette.white],
    sizeRange: [26, 62],
    scaleFrom: 30,
    scaleTo: 132,
    travelYScale: 0.62,
    shapeFactory: ({ size, color, index }) => [thumbsUpGroup(`Reaction Thumb ${index}`, size, color, thumbsPalette.white)],
  });

const buildGiantLikePop = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildHeroFlowerLayer(nextIndex, "Giant Like Pop Hero", [thumbsUpGroup("Hero Like", 330, thumbsPalette.blue, thumbsPalette.white)], 18, 82, 166, center));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, {
    seed: 9601,
    count: 4,
    center,
    radiusRange: [140, 420],
    widthRange: [8, 15],
    palette: [thumbsPalette.blue, thumbsPalette.cyan, thumbsPalette.white],
    accentPalette: [thumbsPalette.cyan],
    startFrame: 44,
    durationRange: [72, 104],
    scaleFrom: 24,
    scaleTo: 168,
  }));
  nextIndex += 4;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9602, 58, 28, center));
  return makeAnimation("Giant Like Pop", layers);
};

const buildThumbsUpStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const storm = buildThumbParticleLayers(nextIndex, 9611, 48, [WIDTH / 2, HEIGHT / 2]);
  layers.push(...storm);
  nextIndex += storm.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Thumb Storm Hero", [thumbsUpGroup("Storm Hero Like", 260, thumbsPalette.blue, thumbsPalette.white)], 58, 98, 168, [WIDTH / 2, HEIGHT / 2]));
  nextIndex += 1;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9612, 66, 24, [WIDTH / 2, HEIGHT / 2]));
  return makeAnimation("Thumbs Up Storm", layers);
};

const buildMegaApprovalBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildHeroFlowerLayer(nextIndex, "Approval Blast Thumb", [thumbsUpGroup("Approval Hero Like", 300, thumbsPalette.cyan, thumbsPalette.white)], 50, 92, 168, center));
  nextIndex += 1;
  const rings = buildRingPulseLayers(nextIndex, {
    seed: 9621,
    count: 5,
    center,
    radiusRange: [150, 520],
    widthRange: [8, 16],
    palette: [thumbsPalette.cyan, thumbsPalette.blue, thumbsPalette.white],
    accentPalette: [thumbsPalette.cyan],
    startFrame: 52,
    durationRange: [82, 110],
    scaleFrom: 18,
    scaleTo: 184,
  });
  layers.push(...rings);
  nextIndex += rings.length;
  layers.push(...buildThumbParticleLayers(nextIndex, 9622, 32, center));
  return makeAnimation("Mega Approval Blast", layers);
};

const buildEmojiLikeBounce = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Emoji Like Bounce Hero",
    shapes: [thumbsUpGroup("Bouncy Like", 250, thumbsPalette.blue, thumbsPalette.white)],
    positionFrames: [
      { t: 0, s: [220, 190, 0] },
      { t: 28, s: [560, 690, 0] },
      { t: 48, s: [860, 280, 0] },
      { t: 68, s: [center[0], center[1], 0] },
      { t: 112, s: [center[0], center[1], 0] },
      { t: 168, s: [center[0], center[1] + 100, 0] },
    ],
    scaleFrames: [
      { t: 0, s: [36, 36, 100] },
      { t: 28, s: [66, 66, 100] },
      { t: 48, s: [92, 92, 100] },
      { t: 68, s: [132, 132, 100] },
      { t: 112, s: [116, 116, 100] },
      { t: 168, s: [58, 58, 100] },
    ],
    opacityFrames: [{ t: 0, s: [0] }, { t: 8, s: [100] }, { t: 112, s: [100] }, { t: 168, s: [0] }],
    rotationFrames: [{ t: 0, s: [-12] }, { t: 48, s: [14] }, { t: 112, s: [0] }, { t: 168, s: [20] }],
  }));
  nextIndex += 1;
  layers.push(...buildThumbParticleLayers(nextIndex, 9631, 24, center));
  return makeAnimation("Emoji Like Bounce", layers);
};

const buildThumbsUpFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  const thumbs = buildThumbParticleLayers(nextIndex, 9641, 46, center);
  layers.push(...thumbs);
  nextIndex += thumbs.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Thumbs Up Finale Hero", [thumbsUpGroup("Finale Hero Like", 320, thumbsPalette.blue, thumbsPalette.white)], 54, 96, 168, center));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, {
    seed: 9642,
    count: 4,
    center,
    radiusRange: [180, 560],
    widthRange: [8, 14],
    palette: [thumbsPalette.blue, thumbsPalette.cyan, thumbsPalette.white],
    accentPalette: [thumbsPalette.cyan],
    startFrame: 58,
    durationRange: [84, 112],
    scaleFrom: 24,
    scaleTo: 178,
  }));
  return makeAnimation("Thumbs Up Finale", layers);
};

const kissPalette = {
  red: rgb("#ff315f"),
  lipstick: rgb("#d81b60"),
  pink: rgb("#ff6ec7"),
  rose: rgb("#ff9fdb"),
  white: rgb("#ffffff"),
  goldLight: rgb("#fff1b4"),
};

const kissMarkGroup = (name, size, color = kissPalette.lipstick, accent = kissPalette.white) =>
  group(name, [
    group("Kiss Glow", [
      ellipseShape("Kiss Glow Path", size * 1.72, size * 1.18),
      fillNode("Kiss Glow Fill", color, 13),
    ]),
    group("Upper Lip Left", [
      ellipseShape("Upper Lip Left Path", size * 0.58, size * 0.25),
      fillNode("Upper Lip Left Fill", color, 94),
      strokeNode("Upper Lip Left Shine", accent, Math.max(2, size * 0.026), 22),
    ], { position: [-(size * 0.22), -(size * 0.13)], rotation: -13 }),
    group("Upper Lip Right", [
      ellipseShape("Upper Lip Right Path", size * 0.58, size * 0.25),
      fillNode("Upper Lip Right Fill", color, 94),
      strokeNode("Upper Lip Right Shine", accent, Math.max(2, size * 0.026), 22),
    ], { position: [size * 0.22, -(size * 0.13)], rotation: 13 }),
    group("Lower Lip", [
      ellipseShape("Lower Lip Path", size * 1.02, size * 0.34),
      fillNode("Lower Lip Fill", color, 94),
      strokeNode("Lower Lip Shine", accent, Math.max(2, size * 0.026), 20),
    ], { position: [0, size * 0.14], rotation: -2 }),
    group("Lip Gap", [
      ellipseShape("Lip Gap Path", size * 0.82, size * 0.12),
      fillNode("Lip Gap Fill", rgb("#230313"), 42),
    ], { position: [0, size * 0.02], rotation: -2 }),
    group("Lip Shine", [
      ellipseShape("Lip Shine Path", size * 0.18, size * 0.07),
      fillNode("Lip Shine Fill", accent, 28),
    ], { position: [-(size * 0.28), -(size * 0.18)], rotation: -16 }),
    sparkleGroup("Kiss Spark", Math.max(10, size * 0.07), accent, kissPalette.rose),
  ]);

const lipstickStreakGroup = (name, length, color = kissPalette.red) =>
  group(name, [
    lineStrokeGroup("Lipstick Streak", [[-(length * 0.45), 0], [0, -(length * 0.06)], [length * 0.45, 0]], color, length * 0.12, kissPalette.white, length * 0.035, 20, 54),
    sparkleGroup("Streak Spark", Math.max(8, length * 0.045), kissPalette.white, color),
  ]);

const buildKissParticleLayers = (startIndex, seed, count, mode = "burst", center = [WIDTH / 2, HEIGHT / 2]) => {
  if (mode === "rain") {
    return buildFallingLayers(startIndex, {
      seed,
      count,
      startY: -150,
      endY: HEIGHT + 170,
      xRange: [70, WIDTH - 70],
      palette: [kissPalette.red, kissPalette.lipstick, kissPalette.pink, kissPalette.rose],
      sizeRange: [28, 68],
      shapeFactory: ({ size, color, index }) => [kissMarkGroup(`Floating Kiss ${index}`, size, color)],
    });
  }

  return buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 180,
    maxRadius: 900,
    startFrame: 42,
    duration: 116,
    palette: [kissPalette.red, kissPalette.lipstick, kissPalette.pink, kissPalette.rose],
    sizeRange: [26, 70],
    scaleFrom: 28,
    scaleTo: 132,
    travelYScale: 0.62,
    shapeFactory: ({ size, color, index }) => [kissMarkGroup(`Burst Kiss ${index}`, size, color)],
  });
};

const buildGiantKissMarkBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildHeroFlowerLayer(nextIndex, "Giant Kiss Mark Hero", [kissMarkGroup("Hero Kiss Mark", 410, kissPalette.lipstick, kissPalette.white)], 40, 92, 168, center));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, {
    seed: 9701,
    count: 4,
    center,
    radiusRange: [160, 450],
    widthRange: [8, 14],
    palette: [kissPalette.red, kissPalette.pink, kissPalette.white],
    accentPalette: [kissPalette.rose],
    startFrame: 54,
    durationRange: [80, 108],
    scaleFrom: 22,
    scaleTo: 170,
  }));
  nextIndex += 4;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9702, 62, 28, center));
  return makeAnimation("Giant Kiss Mark Burst", layers);
};

const buildKissStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const storm = buildKissParticleLayers(nextIndex, 9711, 64, "rain");
  layers.push(...storm);
  nextIndex += storm.length;
  const burst = buildKissParticleLayers(nextIndex, 9712, 38, "burst", [WIDTH / 2, HEIGHT / 2]);
  layers.push(...burst);
  nextIndex += burst.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Kiss Storm Hero", [kissMarkGroup("Storm Hero Kiss", 300, kissPalette.red, kissPalette.white)], 58, 98, 168, [WIDTH / 2, HEIGHT / 2]));
  return makeAnimation("Kiss Storm", layers);
};

const buildAirKissExplosion = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildLayer({
    index: nextIndex,
    name: "Air Kiss Projectile",
    shapes: [kissMarkGroup("Air Kiss Shape", 190, kissPalette.pink, kissPalette.white)],
    positionFrames: [
      { t: 0, s: [180, center[1] - 120, 0] },
      { t: 52, s: [center[0], center[1], 0] },
      { t: 88, s: [center[0] + 120, center[1] + 16, 0] },
      { t: 150, s: [WIDTH + 240, center[1] + 90, 0] },
    ],
    scaleFrames: [{ t: 0, s: [30, 30, 100] }, { t: 52, s: [118, 118, 100] }, { t: 112, s: [98, 98, 100] }, { t: 150, s: [48, 48, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 8, s: [100] }, { t: 112, s: [84] }, { t: 150, s: [0] }],
    rotationFrames: [{ t: 0, s: [-8] }, { t: 88, s: [8] }],
  }));
  nextIndex += 1;
  const kisses = buildKissParticleLayers(nextIndex, 9721, 40, "burst", center);
  layers.push(...kisses);
  nextIndex += kisses.length;
  const hearts = buildHeartParticleLayers(nextIndex, 9722, 28, "burst", center);
  layers.push(...hearts);
  nextIndex += hearts.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Air Kiss Impact Mark", [kissMarkGroup("Air Kiss Hero", 260, kissPalette.lipstick, kissPalette.white)], 54, 92, 166, center));
  return makeAnimation("Air Kiss Explosion", layers);
};

const buildGlamourKissReveal = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  const streaks = buildRibbonSweepLayers(nextIndex, [
    { start: 12, from: [-160, 300], mid: [760, 390], to: [WIDTH + 140, 620], length: 280, color: kissPalette.red, accent: kissPalette.white, rotation: -12, spin: 80 },
    { start: 18, from: [WIDTH + 160, 280], mid: [1120, 420], to: [-140, 650], length: 280, color: kissPalette.pink, accent: kissPalette.white, rotation: 190, spin: -80 },
  ]).map((layer, index) => ({
    ...layer,
    nm: `Glamour Lipstick Streak ${index + 1}`,
    shapes: [lipstickStreakGroup(`Glamour Streak Shape ${index + 1}`, 320, index % 2 === 0 ? kissPalette.red : kissPalette.pink)],
  }));
  layers.push(...streaks);
  nextIndex += streaks.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Glamour Kiss Hero", [kissMarkGroup("Glamour Hero Kiss", 390, kissPalette.red, kissPalette.white)], 54, 96, 168, center));
  nextIndex += 1;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9731, 62, 34, center));
  return makeAnimation("Glamour Kiss Reveal", layers);
};

const buildKissJackpotFinale = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  const rain = buildKissParticleLayers(nextIndex, 9741, 50, "rain");
  layers.push(...rain);
  nextIndex += rain.length;
  const hearts = buildHeartParticleLayers(nextIndex, 9742, 34, "burst", center);
  layers.push(...hearts);
  nextIndex += hearts.length;
  const kisses = buildKissParticleLayers(nextIndex, 9743, 48, "burst", center);
  layers.push(...kisses);
  nextIndex += kisses.length;
  layers.push(buildHeroFlowerLayer(nextIndex, "Kiss Jackpot Hero", [kissMarkGroup("Jackpot Hero Kiss", 390, kissPalette.lipstick, kissPalette.white)], 56, 96, 168, center));
  nextIndex += 1;
  layers.push(...buildCountdownSparkLayers(nextIndex, 9744, 68, 32, center));
  return makeAnimation("Kiss Jackpot Finale", layers);
};

const fireworkFinalePalette = {
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  orange: rgb("#ff9c36"),
  pink: rgb("#ff4fd8"),
  blue: rgb("#58c7ff"),
  purple: rgb("#8f5bff"),
  cyan: rgb("#58e5ff"),
  white: rgb("#ffffff"),
};

const fireworkFinaleColors = [
  fireworkFinalePalette.gold,
  fireworkFinalePalette.orange,
  fireworkFinalePalette.pink,
  fireworkFinalePalette.blue,
  fireworkFinalePalette.purple,
  fireworkFinalePalette.cyan,
];

const buildFireworkRocketLayers = (startIndex, launches) => {
  const layers = [];

  for (const [idx, launch] of launches.entries()) {
    const start = launch.start ?? 0;
    const impact = launch.impact ?? clampFrame(start + 42);
    const from = launch.from ?? [launch.to[0], HEIGHT + 80];
    const to = launch.to;
    const color = launch.color ?? fireworkFinalePalette.gold;
    const accent = launch.accent ?? fireworkFinalePalette.white;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];

    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Finale Rocket ${idx + 1}`,
      shapes: [lineStrokeGroup("Rocket Trail", [[0, 0], [dx * 0.34, dy * 0.34]], color, launch.glowWidth ?? 14, accent, launch.coreWidth ?? 3.4, 18, 94)],
      positionFrames: [
        { t: start, s: [from[0], from[1], 0] },
        { t: impact, s: [to[0], to[1], 0] },
      ],
      scaleFrames: [
        { t: start, s: [44, 44, 100] },
        { t: clampFrame(start + 10), s: [100, 100, 100] },
        { t: impact, s: [68, 68, 100] },
      ],
      opacityFrames: [
        { t: 0, s: [0] },
        { t: start, s: [0] },
        { t: clampFrame(start + 6), s: [92] },
        { t: clampFrame(impact - 4), s: [78] },
        { t: impact, s: [0] },
      ],
      inFrame: start,
      outFrame: impact + 1,
    }));
  }

  return layers;
};

const buildFireworkSparkRainLayers = (startIndex, seed, count, palette = fireworkFinaleColors) =>
  buildFallingLayers(startIndex, {
    seed,
    count,
    startY: 160,
    endY: HEIGHT + 170,
    xRange: [70, WIDTH - 70],
    palette,
    sizeRange: [9, 24],
    shapeFactory: ({ size, color, index }) => [sparkleGroup(`Finale Falling Spark ${index}`, size, color, fireworkFinalePalette.white)],
  });

const buildFireworkGlowLayer = (index, name, color, startFrame = 44, peakFrame = 92, endFrame = 176, radius = 820) =>
  buildLayer({
    index,
    name,
    shapes: [group(`${name} Shape`, [
      ellipseShape("Glow Field", radius * 2, radius * 0.9),
      fillNode("Glow Fill", color, 10),
    ])],
    positionFrames: [{ t: 0, s: [WIDTH / 2, HEIGHT * 0.48, 0] }],
    scaleFrames: [
      { t: startFrame, s: [40, 40, 100] },
      { t: peakFrame, s: [112, 112, 100] },
      { t: endFrame, s: [138, 138, 100] },
    ],
    opacityFrames: [
      { t: 0, s: [0] },
      { t: startFrame, s: [0] },
      { t: clampFrame(startFrame + 10), s: [72] },
      { t: peakFrame, s: [54] },
      { t: endFrame, s: [0] },
    ],
    inFrame: startFrame,
    outFrame: endFrame + 1,
  });

const buildFireworkFinaleScene = (title, seed, bursts, options = {}) => {
  let nextIndex = 1;
  const layers = [];
  const center = options.center ?? [WIDTH / 2, HEIGHT * 0.48];
  const palette = options.palette ?? fireworkFinaleColors;
  const launchSides = options.launchSides ?? false;

  const launches = bursts.map((burst, idx) => {
    const sideOffset = idx % 2 === 0 ? -180 : 180;
    const sideX = idx % 2 === 0 ? -90 : WIDTH + 90;
    return {
      start: Math.max(0, burst.start - (34 + (idx % 3) * 5)),
      impact: burst.start,
      from: launchSides && idx > 1 ? [sideX, HEIGHT * (0.48 + ((idx % 4) * 0.1))] : [burst.center[0] + sideOffset, HEIGHT + 120],
      to: burst.center,
      color: burst.color,
      accent: burst.accent,
    };
  });

  const rockets = buildFireworkRocketLayers(nextIndex, launches);
  layers.push(...rockets);
  nextIndex += rockets.length;

  const fireworks = buildFireworkDisplayLayers(nextIndex, bursts);
  layers.push(...fireworks);
  nextIndex += fireworks.length;

  const sparkleBursts = buildRadialBurstLayers(nextIndex, {
    seed: seed + 101,
    count: options.sparkBursts ?? 70,
    center,
    radiusRange: options.sparkRadiusRange ?? [260, 850],
    sizeRange: [9, 24],
    palette,
    startFrame: 58,
    endFrame: 178,
    shapeFactory: ({ size, color, index }) => [sparkleGroup(`Firework Peak Spark ${index}`, size, color, fireworkFinalePalette.white)],
  });
  layers.push(...sparkleBursts);
  nextIndex += sparkleBursts.length;

  const rain = buildFireworkSparkRainLayers(nextIndex, seed + 202, options.rainCount ?? 48, palette);
  layers.push(...rain);

  return makeAnimation(title, layers);
};

const buildMegaFireworkDetonation = () => buildFireworkFinaleScene("Mega Firework Detonation", 9811, [
  { center: [340, 252], start: 30, outer: 126, rays: 18, color: fireworkFinalePalette.pink, accent: fireworkFinalePalette.white },
  { center: [1570, 250], start: 36, outer: 136, rays: 18, color: fireworkFinalePalette.blue, accent: fireworkFinalePalette.white },
  { center: [740, 248], start: 46, outer: 158, rays: 22, color: fireworkFinalePalette.gold, accent: fireworkFinalePalette.goldLight },
  { center: [1180, 292], start: 54, outer: 162, rays: 22, color: fireworkFinalePalette.orange, accent: fireworkFinalePalette.white },
  { center: [960, 402], start: 68, outer: 232, rays: 28, color: fireworkFinalePalette.gold, accent: fireworkFinalePalette.white },
], { glowColor: fireworkFinalePalette.gold, sparkBursts: 78, rainCount: 46 });

const buildJackpotSkyBlast = () => buildFireworkFinaleScene("Jackpot Sky Blast", 9821, [
  { center: [300, 230], start: 28, outer: 136, rays: 20, color: fireworkFinalePalette.gold, accent: fireworkFinalePalette.goldLight },
  { center: [620, 320], start: 38, outer: 164, rays: 22, color: fireworkFinalePalette.orange, accent: fireworkFinalePalette.white },
  { center: [960, 220], start: 48, outer: 196, rays: 24, color: fireworkFinalePalette.gold, accent: fireworkFinalePalette.white },
  { center: [1300, 330], start: 58, outer: 168, rays: 22, color: fireworkFinalePalette.goldLight, accent: fireworkFinalePalette.white },
  { center: [1620, 250], start: 68, outer: 142, rays: 20, color: fireworkFinalePalette.orange, accent: fireworkFinalePalette.goldLight },
], { glowColor: fireworkFinalePalette.goldLight, palette: [fireworkFinalePalette.gold, fireworkFinalePalette.goldLight, fireworkFinalePalette.orange, fireworkFinalePalette.white], rainCount: 64, rings: 8 });

const buildFireworkChaosStorm = () => buildFireworkFinaleScene("Firework Chaos Storm", 9831, [
  { center: [240, 318], start: 24, outer: 112, rays: 16, color: fireworkFinalePalette.cyan, accent: fireworkFinalePalette.white },
  { center: [520, 206], start: 31, outer: 132, rays: 18, color: fireworkFinalePalette.pink, accent: fireworkFinalePalette.white },
  { center: [760, 370], start: 42, outer: 154, rays: 20, color: fireworkFinalePalette.purple, accent: fireworkFinalePalette.pink },
  { center: [1020, 246], start: 51, outer: 170, rays: 22, color: fireworkFinalePalette.gold, accent: fireworkFinalePalette.white },
  { center: [1260, 394], start: 60, outer: 150, rays: 20, color: fireworkFinalePalette.blue, accent: fireworkFinalePalette.white },
  { center: [1540, 244], start: 69, outer: 138, rays: 18, color: fireworkFinalePalette.orange, accent: fireworkFinalePalette.goldLight },
  { center: [960, 520], start: 76, outer: 198, rays: 24, color: fireworkFinalePalette.pink, accent: fireworkFinalePalette.white },
], { glowColor: fireworkFinalePalette.purple, sparkBursts: 92, rainCount: 56, rings: 9, launchSides: true, ringScaleTo: 196 });

const buildGalaxyFireworkFinale = () => buildFireworkFinaleScene("Galaxy Firework Finale", 9841, [
  { center: [410, 280], start: 32, outer: 148, rays: 20, color: fireworkFinalePalette.purple, accent: fireworkFinalePalette.cyan },
  { center: [740, 216], start: 42, outer: 168, rays: 22, color: fireworkFinalePalette.cyan, accent: fireworkFinalePalette.white },
  { center: [1090, 285], start: 52, outer: 192, rays: 24, color: fireworkFinalePalette.pink, accent: fireworkFinalePalette.white },
  { center: [1420, 220], start: 62, outer: 156, rays: 22, color: fireworkFinalePalette.gold, accent: fireworkFinalePalette.goldLight },
  { center: [960, 462], start: 72, outer: 230, rays: 28, color: fireworkFinalePalette.purple, accent: fireworkFinalePalette.cyan },
], { glowColor: fireworkFinalePalette.purple, palette: [fireworkFinalePalette.purple, fireworkFinalePalette.cyan, fireworkFinalePalette.pink, fireworkFinalePalette.gold], sparkBursts: 84, rainCount: 44, rings: 7, launchSides: true });

const buildGrandJackpotFinale = () => buildFireworkFinaleScene("Grand Jackpot Finale", 9851, [
  { center: [260, 250], start: 26, outer: 150, rays: 20, color: fireworkFinalePalette.gold, accent: fireworkFinalePalette.white },
  { center: [560, 350], start: 36, outer: 166, rays: 22, color: fireworkFinalePalette.pink, accent: fireworkFinalePalette.white },
  { center: [860, 210], start: 46, outer: 188, rays: 24, color: fireworkFinalePalette.blue, accent: fireworkFinalePalette.white },
  { center: [1160, 370], start: 56, outer: 172, rays: 22, color: fireworkFinalePalette.orange, accent: fireworkFinalePalette.goldLight },
  { center: [1500, 242], start: 66, outer: 164, rays: 22, color: fireworkFinalePalette.purple, accent: fireworkFinalePalette.cyan },
  { center: [960, 442], start: 76, outer: 260, rays: 30, color: fireworkFinalePalette.gold, accent: fireworkFinalePalette.white },
], { glowColor: fireworkFinalePalette.gold, sparkBursts: 108, rainCount: 70, rings: 10, launchSides: true, ringScaleTo: 210, glowRadius: 960 });

const neonPalette = {
  cyan: rgb("#58e5ff"),
  blue: rgb("#2f86ff"),
  magenta: rgb("#ff4fd8"),
  purple: rgb("#8f5bff"),
  gold: rgb("#f5c65b"),
  white: rgb("#ffffff"),
};

const neonColors = [neonPalette.cyan, neonPalette.magenta, neonPalette.purple, neonPalette.blue, neonPalette.gold, neonPalette.white];

const buildNeonGlowLayer = (index, name, color, center = [WIDTH / 2, HEIGHT * 0.52], radius = [1100, 520]) =>
  buildLayer({
    index,
    name,
    shapes: [group(`${name} Shape`, [
      ellipseShape("Neon Glow Field", radius[0], radius[1]),
      fillNode("Neon Glow Fill", color, 8),
    ])],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [
      { t: 0, s: [18, 18, 100] },
      { t: 68, s: [110, 110, 100] },
      { t: 112, s: [114, 114, 100] },
      { t: 179, s: [136, 136, 100] },
    ],
    opacityFrames: [
      { t: 0, s: [0] },
      { t: 22, s: [58] },
      { t: 90, s: [82] },
      { t: 135, s: [34] },
      { t: 179, s: [0] },
    ],
  });

const buildNeonGridLayers = (startIndex, options = {}) => {
  const layers = [];
  const colorA = options.colorA ?? neonPalette.cyan;
  const colorB = options.colorB ?? neonPalette.magenta;
  const horizonY = options.horizonY ?? 430;
  const floorY = options.floorY ?? HEIGHT + 70;
  const vanishX = WIDTH / 2;

  for (let idx = 0; idx < 11; idx += 1) {
    const x = -120 + idx * ((WIDTH + 240) / 10);
    const color = idx % 2 === 0 ? colorA : colorB;
    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Neon Perspective Grid Ray ${idx + 1}`,
      shapes: [lineStrokeGroup("Neon Grid Ray", [[0, 0], [vanishX - x, horizonY - floorY]], color, 8, neonPalette.white, 2.2, 18, 78)],
      positionFrames: [{ t: 0, s: [x, floorY, 0] }],
      scaleFrames: [{ t: 0, s: [40, 40, 100] }, { t: 68, s: [100, 100, 100] }, { t: 135, s: [104, 104, 100] }, { t: 179, s: [112, 112, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 18 + idx, s: [78] }, { t: 112, s: [74] }, { t: 179, s: [0] }],
    }));
  }

  for (let idx = 0; idx < 7; idx += 1) {
    const y = horizonY + Math.pow(idx / 6, 1.7) * (floorY - horizonY);
    const width = 260 + (idx * 250);
    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Neon Horizon Grid Line ${idx + 1}`,
      shapes: [lineStrokeGroup("Neon Grid Horizon", [[-(width * 0.5), 0], [width * 0.5, 0]], idx % 2 === 0 ? colorB : colorA, 7, neonPalette.white, 2, 18, 80)],
      positionFrames: [{ t: 0, s: [WIDTH / 2, y, 0] }],
      scaleFrames: [{ t: 0, s: [30, 30, 100] }, { t: 68, s: [100, 100, 100] }, { t: 135, s: [104, 104, 100] }, { t: 179, s: [112, 112, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: 22 + idx * 3, s: [74] }, { t: 112, s: [72] }, { t: 179, s: [0] }],
    }));
  }

  return layers;
};

const buildNeonParticleLayers = (startIndex, seed, count, center = [WIDTH / 2, HEIGHT * 0.48], palette = neonColors) =>
  buildRadialBurstLayers(startIndex, {
    seed,
    count,
    center,
    minRadius: 140,
    maxRadius: 980,
    startFrame: 24,
    duration: 150,
    palette,
    sizeRange: [8, 20],
    shapeFactory: ({ size, color }) => [sparkleGroup("Neon Particle", size, color, neonPalette.white)],
    scaleFrom: 20,
    scaleTo: 126,
    travelYScale: 0.54,
    rotationRange: [-160, 160],
  });

const buildNeonLightningLayers = (startIndex, configs) => {
  const layers = [];
  for (const [idx, config] of configs.entries()) {
    const start = config.start ?? (12 + idx * 8);
    const mid = config.mid ?? clampFrame(start + 42);
    const end = config.end ?? 170;
    layers.push(buildLayer({
      index: startIndex + layers.length,
      name: `Neon Lightning Arc ${idx + 1}`,
      shapes: [lightningGroup("Neon Lightning Shape", config.width, config.height, config.color ?? neonPalette.white, config.accent ?? neonPalette.cyan)],
      positionFrames: [
        { t: start, s: [config.from[0], config.from[1], 0] },
        { t: mid, s: [config.midPoint[0], config.midPoint[1], 0] },
        { t: end, s: [config.to[0], config.to[1], 0] },
      ],
      scaleFrames: [{ t: start, s: [30, 30, 100] }, { t: mid, s: [126, 126, 100] }, { t: 112, s: [108, 108, 100] }, { t: end, s: [80, 80, 100] }],
      opacityFrames: [{ t: 0, s: [0] }, { t: start, s: [0] }, { t: start + 7, s: [96] }, { t: 112, s: [78] }, { t: end, s: [0] }],
      rotationFrames: [{ t: start, s: [config.rotation ?? 0] }, { t: mid, s: [(config.rotation ?? 0) + (config.spin ?? 24)] }, { t: end, s: [(config.rotation ?? 0) + (config.spin ?? 24) * 1.4] }],
      inFrame: start,
      outFrame: Math.min(DURATION_FRAMES, end + 1),
    }));
  }
  return layers;
};

const buildNeonGalaxyGrid = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildNeonGlowLayer(nextIndex, "Neon Galaxy Grid Glow", neonPalette.purple, center, [1180, 540]));
  nextIndex += 1;
  const grid = buildNeonGridLayers(nextIndex);
  layers.push(...grid);
  nextIndex += grid.length;
  const particles = buildNeonParticleLayers(nextIndex, 9961, 64, [WIDTH / 2, HEIGHT * 0.42], [neonPalette.cyan, neonPalette.purple, neonPalette.magenta, neonPalette.white]);
  layers.push(...particles);
  nextIndex += particles.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 9962, count: 4, center, radiusRange: [220, 520], widthRange: [6, 11], palette: [neonPalette.cyan, neonPalette.magenta, neonPalette.purple], accentPalette: [neonPalette.white], startFrame: 44, durationRange: [90, 126], scaleFrom: 26, scaleTo: 176 }));
  return makeAnimation("Neon Galaxy Grid", layers);
};

const buildElectricNeonStorm = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.5];
  layers.push(buildNeonGlowLayer(nextIndex, "Electric Neon Storm Glow", neonPalette.cyan, center, [1060, 520]));
  nextIndex += 1;
  const arcs = buildNeonLightningLayers(nextIndex, [
    { start: 8, from: [-130, 210], midPoint: [620, 350], to: [WIDTH + 130, 230], width: 260, height: 150, accent: neonPalette.cyan, rotation: -18, spin: 28 },
    { start: 16, from: [WIDTH + 120, 320], midPoint: [1120, 450], to: [-140, 620], width: 300, height: 170, accent: neonPalette.magenta, rotation: 190, spin: -30 },
    { start: 28, from: [240, HEIGHT + 120], midPoint: [870, 510], to: [1600, -120], width: 280, height: 160, accent: neonPalette.purple, rotation: -58, spin: 34 },
    { start: 36, from: [1680, HEIGHT + 120], midPoint: [1040, 390], to: [300, -130], width: 250, height: 150, accent: neonPalette.cyan, rotation: 52, spin: -30 },
  ]);
  layers.push(...arcs);
  nextIndex += arcs.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 9971, count: 8, center, radiusRange: [150, 540], widthRange: [5, 13], palette: [neonPalette.cyan, neonPalette.magenta, neonPalette.white], accentPalette: [neonPalette.white], startFrame: 30, durationRange: [82, 120], scaleFrom: 22, scaleTo: 204 }));
  nextIndex += 8;
  layers.push(...buildNeonParticleLayers(nextIndex, 9972, 78, center, [neonPalette.cyan, neonPalette.magenta, neonPalette.white]));
  return makeAnimation("Electric Neon Storm", layers);
};

const buildNeonRibbonTunnel = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildNeonGlowLayer(nextIndex, "Neon Ribbon Tunnel Glow", neonPalette.magenta, center, [1180, 520]));
  nextIndex += 1;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 8, from: [-180, 170], mid: [720, 340], to: [WIDTH + 180, 640], length: 430, color: neonPalette.cyan, accent: neonPalette.white, rotation: -22, spin: 120 },
    { start: 14, from: [WIDTH + 180, 180], mid: [1180, 350], to: [-180, 650], length: 430, color: neonPalette.magenta, accent: neonPalette.white, rotation: 200, spin: -120 },
    { start: 24, from: [-180, 830], mid: [820, 560], to: [WIDTH + 180, 280], length: 390, color: neonPalette.purple, accent: neonPalette.cyan, rotation: 20, spin: 105 },
    { start: 30, from: [WIDTH + 180, 820], mid: [1080, 560], to: [-180, 300], length: 390, color: neonPalette.blue, accent: neonPalette.magenta, rotation: 160, spin: -105 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 9981, count: 8, center, radiusRange: [180, 520], widthRange: [5, 10], palette: [neonPalette.cyan, neonPalette.magenta, neonPalette.purple], accentPalette: [neonPalette.white], startFrame: 28, durationRange: [90, 126], scaleFrom: 18, scaleTo: 186 }));
  nextIndex += 8;
  layers.push(...buildNeonParticleLayers(nextIndex, 9982, 52, center));
  return makeAnimation("Neon Ribbon Tunnel", layers);
};

const buildLuxuryNeonPulse = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildNeonGlowLayer(nextIndex, "Luxury Neon Pulse Glow", neonPalette.gold, center, [960, 460]));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 9991, count: 10, center, radiusRange: [140, 560], widthRange: [5, 16], palette: [neonPalette.gold, neonPalette.cyan, neonPalette.white], accentPalette: [neonPalette.white], startFrame: 18, durationRange: [88, 130], scaleFrom: 20, scaleTo: 190 }));
  nextIndex += 10;
  const beams = buildBeamLayers(nextIndex, { seed: 9992, count: 10, xRange: [260, WIDTH - 260], yBase: HEIGHT * 0.54, palette: [neonPalette.gold, neonPalette.cyan, neonPalette.white], accentPalette: [neonPalette.white], widthRange: [26, 52], heightRange: [220, 540], rotationRange: [-68, 68] });
  layers.push(...beams);
  nextIndex += beams.length;
  layers.push(...buildNeonParticleLayers(nextIndex, 9993, 42, center, [neonPalette.gold, neonPalette.cyan, neonPalette.white]));
  return makeAnimation("Luxury Neon Pulse", layers);
};

const buildMegaNeonJackpot = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildNeonGlowLayer(nextIndex, "Mega Neon Jackpot Glow", neonPalette.magenta, center, [1260, 570]));
  nextIndex += 1;
  const grid = buildNeonGridLayers(nextIndex, { colorA: neonPalette.cyan, colorB: neonPalette.purple, horizonY: 420 });
  layers.push(...grid);
  nextIndex += grid.length;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 18, from: [-190, 210], mid: [760, 370], to: [WIDTH + 190, 690], length: 420, color: neonPalette.cyan, accent: neonPalette.white, rotation: -18, spin: 115 },
    { start: 24, from: [WIDTH + 190, 230], mid: [1160, 390], to: [-190, 700], length: 420, color: neonPalette.magenta, accent: neonPalette.white, rotation: 198, spin: -118 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  const arcs = buildNeonLightningLayers(nextIndex, [
    { start: 28, from: [-130, 440], midPoint: [650, 420], to: [WIDTH + 130, 300], width: 270, height: 150, accent: neonPalette.cyan, rotation: -12, spin: 26 },
    { start: 36, from: [WIDTH + 130, 510], midPoint: [1120, 470], to: [-130, 320], width: 270, height: 150, accent: neonPalette.magenta, rotation: 192, spin: -28 },
  ]);
  layers.push(...arcs);
  nextIndex += arcs.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10001, count: 9, center, radiusRange: [150, 620], widthRange: [5, 14], palette: neonColors, accentPalette: [neonPalette.white], startFrame: 34, durationRange: [90, 130], scaleFrom: 22, scaleTo: 212 }));
  nextIndex += 9;
  layers.push(...buildNeonParticleLayers(nextIndex, 10002, 92, center, neonColors));
  return makeAnimation("Mega Neon Jackpot", layers);
};

const ultimatePalette = {
  cyan: rgb("#58e5ff"),
  blue: rgb("#2f86ff"),
  magenta: rgb("#ff4fd8"),
  purple: rgb("#8f5bff"),
  gold: rgb("#f5c65b"),
  goldLight: rgb("#fff1b4"),
  orange: rgb("#ff9c36"),
  red: rgb("#ff315f"),
  white: rgb("#ffffff"),
};

const ultimateColors = [ultimatePalette.cyan, ultimatePalette.magenta, ultimatePalette.purple, ultimatePalette.gold, ultimatePalette.white];

const buildUltimateShockwave = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildNeonGlowLayer(nextIndex, "Ultimate Energy Glow", ultimatePalette.cyan, center, [1180, 520]));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10101, count: 10, center, radiusRange: [120, 620], widthRange: [6, 16], palette: [ultimatePalette.cyan, ultimatePalette.blue, ultimatePalette.white], accentPalette: [ultimatePalette.white], startFrame: 24, durationRange: [86, 130], scaleFrom: 20, scaleTo: 220 }));
  nextIndex += 10;
  layers.push(...buildNeonLightningLayers(nextIndex, [
    { start: 16, from: [-120, 250], midPoint: [650, 390], to: [WIDTH + 120, 280], width: 290, height: 150, accent: ultimatePalette.cyan, rotation: -14, spin: 28 },
    { start: 28, from: [WIDTH + 120, 610], midPoint: [1180, 460], to: [-120, 390], width: 270, height: 150, accent: ultimatePalette.blue, rotation: 190, spin: -26 },
  ]));
  nextIndex += 2;
  layers.push(...buildNeonParticleLayers(nextIndex, 10102, 72, center, [ultimatePalette.cyan, ultimatePalette.blue, ultimatePalette.white]));
  return makeAnimation("Energy Shockwave", layers);
};

const buildCosmicPortalOpening = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildNeonGlowLayer(nextIndex, "Cosmic Portal Glow", ultimatePalette.purple, center, [980, 560]));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10111, count: 12, center, radiusRange: [130, 440], widthRange: [5, 13], palette: [ultimatePalette.purple, ultimatePalette.cyan, ultimatePalette.magenta], accentPalette: [ultimatePalette.white], startFrame: 18, durationRange: [96, 138], scaleFrom: 18, scaleTo: 176 }));
  nextIndex += 12;
  layers.push(buildLayer({
    index: nextIndex,
    name: "Cosmic Portal Hero Ring",
    shapes: [ringGroup("Portal Hero Ring Shape", 280, ultimatePalette.purple, ultimatePalette.cyan, 18), ringGroup("Portal Inner Ring Shape", 190, ultimatePalette.cyan, ultimatePalette.white, 8)],
    positionFrames: [{ t: 0, s: [center[0], center[1], 0] }],
    scaleFrames: [{ t: 0, s: [20, 20, 100] }, { t: 68, s: [116, 116, 100] }, { t: 112, s: [108, 108, 100] }, { t: 179, s: [20, 20, 100] }],
    opacityFrames: [{ t: 0, s: [0] }, { t: 22, s: [92] }, { t: 112, s: [100] }, { t: 179, s: [0] }],
    rotationFrames: [{ t: 0, s: [0] }, { t: 112, s: [210] }, { t: 179, s: [420] }],
  }));
  nextIndex += 1;
  layers.push(...buildNeonParticleLayers(nextIndex, 10112, 86, center, [ultimatePalette.purple, ultimatePalette.cyan, ultimatePalette.magenta, ultimatePalette.white]));
  return makeAnimation("Cosmic Portal Opening", layers);
};

const buildCrystalShardExplosion = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildNeonGlowLayer(nextIndex, "Crystal Shard Luxury Glow", ultimatePalette.goldLight, center, [1040, 480]));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10121, count: 5, center, radiusRange: [160, 460], widthRange: [8, 14], palette: [ultimatePalette.gold, ultimatePalette.white, ultimatePalette.cyan], accentPalette: [ultimatePalette.white], startFrame: 26, durationRange: [88, 124], scaleFrom: 24, scaleTo: 190 }));
  nextIndex += 5;
  const shards = buildRadialBurstLayers(nextIndex, { seed: 10122, count: 74, center, minRadius: 120, maxRadius: 1040, startFrame: 30, duration: 142, palette: [ultimatePalette.white, ultimatePalette.goldLight, ultimatePalette.cyan, ultimatePalette.gold], sizeRange: [18, 48], shapeFactory: ({ size, color }) => [shardGroup("Ultimate Crystal Shard", size * 0.78, size * 1.28, color, ultimatePalette.white)], scaleFrom: 22, scaleTo: 142, travelYScale: 0.6, rotationRange: [-220, 220] });
  layers.push(...shards);
  nextIndex += shards.length;
  layers.push(...buildNeonParticleLayers(nextIndex, 10123, 44, center, [ultimatePalette.white, ultimatePalette.goldLight, ultimatePalette.cyan]));
  return makeAnimation("Crystal Shard Explosion", layers);
};

const buildAlertImpactBlast = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildNeonGlowLayer(nextIndex, "Alert Impact Glow", ultimatePalette.red, center, [1080, 500]));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10131, count: 9, center, radiusRange: [120, 590], widthRange: [7, 18], palette: [ultimatePalette.red, ultimatePalette.orange, ultimatePalette.white], accentPalette: [ultimatePalette.white], startFrame: 20, durationRange: [82, 118], scaleFrom: 20, scaleTo: 214 }));
  nextIndex += 9;
  const beams = buildBeamLayers(nextIndex, { seed: 10132, count: 14, xRange: [180, WIDTH - 180], yBase: HEIGHT * 0.52, palette: [ultimatePalette.red, ultimatePalette.orange, ultimatePalette.white], accentPalette: [ultimatePalette.white], widthRange: [24, 48], heightRange: [220, 620], rotationRange: [-82, 82] });
  layers.push(...beams);
  nextIndex += beams.length;
  layers.push(...buildNeonParticleLayers(nextIndex, 10133, 48, center, [ultimatePalette.red, ultimatePalette.orange, ultimatePalette.white]));
  return makeAnimation("Alert Impact Blast", layers);
};

const buildCelestialStarfall = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.46];
  layers.push(buildNeonGlowLayer(nextIndex, "Celestial Starfall Glow", ultimatePalette.purple, [WIDTH / 2, HEIGHT * 0.44], [1120, 520]));
  nextIndex += 1;
  const stars = buildFallingLayers(nextIndex, { seed: 10141, count: 90, startY: -160, endY: HEIGHT + 170, xRange: [70, WIDTH - 70], palette: [ultimatePalette.goldLight, ultimatePalette.white, ultimatePalette.cyan, ultimatePalette.purple], sizeRange: [12, 34], shapeFactory: ({ size, index }) => [goldenStarGroup(`Celestial Star ${index}`, size, ultimatePalette.white)] });
  layers.push(...stars);
  nextIndex += stars.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10142, count: 4, center, radiusRange: [220, 560], widthRange: [5, 10], palette: [ultimatePalette.goldLight, ultimatePalette.purple], accentPalette: [ultimatePalette.white], startFrame: 48, durationRange: [94, 130], scaleFrom: 28, scaleTo: 170 }));
  return makeAnimation("Celestial Starfall", layers);
};

const buildJackpotCoreDetonation = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildNeonGlowLayer(nextIndex, "Jackpot Core Glow", ultimatePalette.gold, center, [1120, 520]));
  nextIndex += 1;
  layers.push(buildHeroFlowerLayer(nextIndex, "Jackpot Core Hero", [ringGroup("Core Ring", 220, ultimatePalette.gold, ultimatePalette.white, 16), sparkleGroup("Core Spark", 64, ultimatePalette.white, ultimatePalette.goldLight)], 16, 70, 132, center));
  nextIndex += 1;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10151, count: 9, center, radiusRange: [150, 600], widthRange: [7, 16], palette: [ultimatePalette.gold, ultimatePalette.orange, ultimatePalette.white], accentPalette: [ultimatePalette.white], startFrame: 28, durationRange: [88, 124], scaleFrom: 22, scaleTo: 214 }));
  nextIndex += 9;
  const burst = buildRadialBurstLayers(nextIndex, { seed: 10152, count: 86, center, minRadius: 110, maxRadius: 1080, startFrame: 34, duration: 138, palette: [ultimatePalette.gold, ultimatePalette.goldLight, ultimatePalette.orange, ultimatePalette.white], sizeRange: [10, 28], shapeFactory: ({ size, color }) => [sparkleGroup("Jackpot Reward Particle", size, color, ultimatePalette.white)], scaleFrom: 20, scaleTo: 132, travelYScale: 0.62, rotationRange: [-200, 200] });
  layers.push(...burst);
  return makeAnimation("Jackpot Core Detonation", layers);
};

const buildPrismLightCascade = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT * 0.52];
  layers.push(buildNeonGlowLayer(nextIndex, "Prism Cascade Glow", ultimatePalette.white, center, [1180, 500]));
  nextIndex += 1;
  const beams = buildBeamLayers(nextIndex, { seed: 10161, count: 18, xRange: [100, WIDTH - 100], yBase: HEIGHT * 0.5, palette: [ultimatePalette.magenta, ultimatePalette.orange, ultimatePalette.gold, ultimatePalette.cyan, ultimatePalette.purple, ultimatePalette.white], accentPalette: [ultimatePalette.white], widthRange: [22, 58], heightRange: [260, 720], rotationRange: [-72, 72] });
  layers.push(...beams);
  nextIndex += beams.length;
  const ribbons = buildRibbonSweepLayers(nextIndex, [
    { start: 20, from: [-160, 260], mid: [760, 390], to: [WIDTH + 160, 650], length: 390, color: ultimatePalette.cyan, accent: ultimatePalette.white, rotation: -18, spin: 100 },
    { start: 28, from: [WIDTH + 160, 270], mid: [1160, 410], to: [-160, 660], length: 390, color: ultimatePalette.magenta, accent: ultimatePalette.white, rotation: 198, spin: -100 },
  ]);
  layers.push(...ribbons);
  nextIndex += ribbons.length;
  layers.push(...buildNeonParticleLayers(nextIndex, 10162, 46, center, [ultimatePalette.magenta, ultimatePalette.gold, ultimatePalette.cyan, ultimatePalette.white]));
  return makeAnimation("Prism Light Cascade", layers);
};

const buildHyperBoostBurst = () => {
  let nextIndex = 1;
  const layers = [];
  const center = [WIDTH / 2, HEIGHT / 2];
  layers.push(buildNeonGlowLayer(nextIndex, "Hyper Boost Glow", ultimatePalette.cyan, center, [1240, 500]));
  nextIndex += 1;
  const speedLines = [];
  for (let index = 0; index < 26; index += 1) {
    const angle = (index / 26) * Math.PI * 2;
    const from = [center[0] + Math.cos(angle) * 120, center[1] + Math.sin(angle) * 70];
    const to = [center[0] + Math.cos(angle) * 1120, center[1] + Math.sin(angle) * 620];
    speedLines.push({ start: 8 + (index % 5) * 4, from, mid: [center[0] + Math.cos(angle) * 520, center[1] + Math.sin(angle) * 280], to, length: 260, color: index % 3 === 0 ? ultimatePalette.cyan : index % 3 === 1 ? ultimatePalette.magenta : ultimatePalette.white, accent: ultimatePalette.white, rotation: angle * 180 / Math.PI, spin: 8 });
  }
  const lines = buildRibbonSweepLayers(nextIndex, speedLines);
  layers.push(...lines);
  nextIndex += lines.length;
  layers.push(...buildRingPulseLayers(nextIndex, { seed: 10171, count: 6, center, radiusRange: [120, 520], widthRange: [5, 12], palette: [ultimatePalette.cyan, ultimatePalette.magenta, ultimatePalette.white], accentPalette: [ultimatePalette.white], startFrame: 26, durationRange: [70, 112], scaleFrom: 18, scaleTo: 220 }));
  nextIndex += 6;
  layers.push(...buildNeonParticleLayers(nextIndex, 10172, 54, center, [ultimatePalette.cyan, ultimatePalette.magenta, ultimatePalette.white]));
  return makeAnimation("Hyper Boost Burst", layers);
};

const effects = [
  { output: "trh-full-energy-shockwave.json", build: buildUltimateShockwave, decorate: false },
  { output: "trh-full-cosmic-portal-opening.json", build: buildCosmicPortalOpening, decorate: false },
  { output: "trh-full-crystal-shard-explosion.json", build: buildCrystalShardExplosion, decorate: false },
  { output: "trh-full-alert-impact-blast.json", build: buildAlertImpactBlast, decorate: false },
  { output: "trh-full-celestial-starfall.json", build: buildCelestialStarfall, decorate: false },
  { output: "trh-full-jackpot-core-detonation.json", build: buildJackpotCoreDetonation, decorate: false },
  { output: "trh-full-prism-light-cascade.json", build: buildPrismLightCascade, decorate: false },
  { output: "trh-full-hyper-boost-burst.json", build: buildHyperBoostBurst, decorate: false },
  { output: "trh-full-neon-galaxy-grid.json", build: buildNeonGalaxyGrid, decorate: false },
  { output: "trh-full-electric-neon-storm.json", build: buildElectricNeonStorm, decorate: false },
  { output: "trh-full-neon-ribbon-tunnel.json", build: buildNeonRibbonTunnel, decorate: false },
  { output: "trh-full-luxury-neon-pulse.json", build: buildLuxuryNeonPulse, decorate: false },
  { output: "trh-full-mega-neon-jackpot.json", build: buildMegaNeonJackpot, decorate: false },
  { output: "trh-full-mega-firework-detonation.json", build: buildMegaFireworkDetonation, decorate: false },
  { output: "trh-full-jackpot-sky-blast.json", build: buildJackpotSkyBlast, decorate: false },
  { output: "trh-full-firework-chaos-storm.json", build: buildFireworkChaosStorm, decorate: false },
  { output: "trh-full-galaxy-firework-finale.json", build: buildGalaxyFireworkFinale, decorate: false },
  { output: "trh-full-grand-jackpot-finale.json", build: buildGrandJackpotFinale, decorate: false },
  { output: "trh-full-giant-kiss-mark-burst.json", build: buildGiantKissMarkBurst, decorate: false },
  { output: "trh-full-kiss-storm.json", build: buildKissStorm, decorate: false },
  { output: "trh-full-air-kiss-explosion.json", build: buildAirKissExplosion, decorate: false },
  { output: "trh-full-glamour-kiss-reveal.json", build: buildGlamourKissReveal, decorate: false },
  { output: "trh-full-kiss-jackpot-finale.json", build: buildKissJackpotFinale, decorate: false },
  { output: "trh-full-giant-like-pop.json", build: buildGiantLikePop, decorate: false },
  { output: "trh-full-thumbs-up-storm.json", build: buildThumbsUpStorm, decorate: false },
  { output: "trh-full-mega-approval-blast.json", build: buildMegaApprovalBlast, decorate: false },
  { output: "trh-full-emoji-like-bounce.json", build: buildEmojiLikeBounce, decorate: false },
  { output: "trh-full-thumbs-up-finale.json", build: buildThumbsUpFinale, decorate: false },
  { output: "trh-full-giant-heart-formation.json", build: buildGiantHeartFormation, decorate: false },
  { output: "trh-full-heart-rain-explosion.json", build: buildHeartRainExplosion, decorate: false },
  { output: "trh-full-cupid-heart-blast.json", build: buildCupidHeartBlast, decorate: false },
  { output: "trh-full-double-heart-merge.json", build: buildDoubleHeartMerge, decorate: false },
  { output: "trh-full-heart-jackpot-finale.json", build: buildHeartJackpotFinale, decorate: false },
  { output: "trh-full-mega-confetti-cannon.json", build: buildMegaConfettiCannon, decorate: false },
  { output: "trh-full-confetti-jackpot-blast.json", build: buildConfettiJackpotBlast, decorate: false },
  { output: "trh-full-confetti-rain-storm.json", build: buildConfettiRainStorm, decorate: false },
  { output: "trh-full-ribbon-confetti-burst.json", build: buildRibbonConfettiBurst, decorate: false },
  { output: "trh-full-grand-confetti-finale.json", build: buildGrandConfettiFinale, decorate: false },
  { output: "trh-full-luxury-confetti-blast.json", build: buildLuxuryConfettiBlast, decorate: false },
  { output: "trh-full-golden-confetti-storm.json", build: buildGoldenConfettiStorm, decorate: false },
  { output: "trh-full-confetti-shockwave.json", build: buildConfettiShockwave, decorate: false },
  { output: "trh-full-rainbow-confetti-cascade.json", build: buildRainbowConfettiCascade, decorate: false },
  { output: "trh-full-grand-premium-confetti-finale.json", build: buildGrandPremiumConfettiFinale, decorate: false },
  { output: "trh-full-golden-confetti-jackpot-blast.json", build: buildGoldenConfettiJackpotBlast, decorate: false },
  { output: "trh-full-vip-gold-confetti-rain.json", build: buildVipGoldConfettiRain, decorate: false },
  { output: "trh-full-trophy-gold-confetti-burst.json", build: buildTrophyGoldConfettiBurst, decorate: false },
  { output: "trh-full-gold-ribbon-confetti-storm.json", build: buildGoldRibbonConfettiStorm, decorate: false },
  { output: "trh-full-royal-gold-confetti-finale.json", build: buildRoyalGoldConfettiFinale, decorate: false },
  { output: "trh-full-diamond-jackpot-burst.json", build: buildDiamondJackpotBurst, decorate: false },
  { output: "trh-full-royal-gold-crown.json", build: buildRoyalGoldCrown, decorate: false },
  { output: "trh-full-money-win-cascade.json", build: buildMoneyWinCascade, decorate: false },
  { output: "trh-full-electric-premium-blast.json", build: buildElectricPremiumBlast, decorate: false },
  { output: "trh-full-trophy-win-moment.json", build: buildTrophyWinMoment, decorate: false },
  { output: "trh-full-lucky-shamrock-storm.json", build: buildLuckyShamrockStorm, decorate: false },
  { output: "trh-full-pot-of-gold-burst.json", build: buildPotOfGoldBurst, decorate: false },
  { output: "trh-full-rainbow-lucky-arc.json", build: buildRainbowLuckyArc, decorate: false },
  { output: "trh-full-leprechaun-gold-rush.json", build: buildLeprechaunGoldRush, decorate: false },
  { output: "trh-full-mega-lucky-finale.json", build: buildMegaLuckyFinale, decorate: false },
  { output: "trh-full-petal-storm-bloom.json", build: buildPetalStormBloom, decorate: false },
  { output: "trh-full-sakura-jackpot-blossom.json", build: buildSakuraJackpotBlossom, decorate: false },
  { output: "trh-full-rose-swirl-reveal.json", build: buildRoseSwirlReveal, decorate: false },
  { output: "trh-full-floral-heart-bloom.json", build: buildFloralHeartBloom, decorate: false },
  { output: "trh-full-bloom-burst-finale.json", build: buildBloomBurstFinale, decorate: false },
  { output: "trh-full-classic-countdown-bingo.json", build: buildClassicCountdownBingo, decorate: false },
  { output: "trh-full-bingo-letter-build.json", build: buildBingoLetterBuild, decorate: false },
  { output: "trh-full-gold-jackpot-countdown.json", build: buildGoldJackpotCountdown, decorate: false },
  { output: "trh-full-final-countdown-detonation.json", build: buildFinalCountdownDetonation, decorate: false },
  { output: "trh-full-mega-bingo-impact.json", build: buildMegaBingoImpact, decorate: false },
  { output: "trh-full-bingo-ball-storm.json", build: buildBingoBallStorm, decorate: false },
  { output: "trh-full-jackpot-ball-explosion.json", build: buildJackpotBallExplosion, decorate: false },
  { output: "trh-full-bingo-letter-formation.json", build: buildBingoLetterFormation, decorate: false },
  { output: "trh-full-golden-bingo-cascade.json", build: buildGoldenBingoCascade, decorate: false },
  { output: "trh-full-mega-bingo-balls-finale.json", build: buildMegaBingoBallsFinale, decorate: false },
  { output: "trh-full-gold-star-jackpot-rain.json", build: buildGoldenStarRainFullscreen, decorate: false },
  { output: "trh-full-mega-star-explosion.json", build: buildMegaStarExplosionFullscreen, decorate: false },
  { output: "trh-full-golden-galaxy-spiral.json", build: buildGoldenGalaxySpiralFullscreen, decorate: false },
  { output: "trh-full-star-flash-reward.json", build: buildStarFlashRewardFullscreen, decorate: false },
  { output: "trh-full-golden-star-finale.json", build: buildGoldenStarFinaleFullscreen, decorate: false },
  { output: "trh-full-magic-starry-sky.json", build: buildMagicStarrySky, decorate: false },
  { output: "trh-full-golden-twinkle-sky.json", build: buildGoldenTwinkleSky, decorate: false },
  { output: "trh-full-shooting-star-night.json", build: buildShootingStarNight, decorate: false },
  { output: "trh-full-starlight-pulse.json", build: buildStarlightPulse, decorate: false },
  { output: "trh-full-grand-starry-finale.json", build: buildGrandStarryFinale, decorate: false },
  { output: "trh-full-party-blast.json", build: buildPartyBlast, decorate: false },
  { output: "trh-full-fullscreen-festival.json", build: buildFullscreenFestival, decorate: false },
  { output: "trh-full-giant-bingo-reveal.json", build: buildGiantBingoReveal, decorate: false },
  { output: "trh-full-exploding-bingo-balls.json", build: buildExplodingBingoBalls, decorate: false },
  { output: "trh-full-bingo-letter-jackpot-build.json", build: buildFullscreenBingoLetterBuild, decorate: false },
  { output: "trh-full-golden-bingo-jackpot.json", build: buildGoldenBingoJackpot, decorate: false },
  { output: "trh-full-mega-bingo-finale.json", build: buildMegaBingoFinaleFullscreen, decorate: false },
  { output: "trh-full-birthday-cake-celebration.json", build: buildBirthdayCakeCelebration, decorate: false },
  { output: "trh-full-balloon-party-burst.json", build: buildBalloonPartyBurst, decorate: false },
  { output: "trh-full-gift-box-explosion.json", build: buildGiftBoxExplosion, decorate: false },
  { output: "trh-full-candle-wish-moment.json", build: buildCandleWishMoment, decorate: false },
  { output: "trh-full-happy-birthday-grand-finale.json", build: buildHappyBirthdayGrandFinale, decorate: false },
  { output: "trh-full-christmas-tree-reveal.json", build: buildChristmasTreeReveal, decorate: false },
  { output: "trh-full-santa-gift-burst.json", build: buildSantaGiftBurst, decorate: false },
  { output: "trh-full-snowfall-magic.json", build: buildSnowfallMagic, decorate: false },
  { output: "trh-full-jingle-bells-blast.json", build: buildJingleBellsBlast, decorate: false },
  { output: "trh-full-christmas-grand-finale.json", build: buildChristmasGrandFinale, decorate: false },
  { output: "trh-full-giant-snowman-reveal.json", build: buildGiantSnowmanReveal, decorate: false },
  { output: "trh-full-snowman-snowstorm.json", build: buildSnowmanSnowstorm, decorate: false },
  { output: "trh-full-top-hat-snowman-pop.json", build: buildTopHatSnowmanPop, decorate: false },
  { output: "trh-full-christmas-snowman-gift.json", build: buildChristmasSnowmanGift, decorate: false },
  { output: "trh-full-snowman-grand-finale.json", build: buildSnowmanGrandFinale, decorate: false },
  { output: "trh-full-giant-clap-burst.json", build: buildGiantClapBurst, decorate: false },
  { output: "trh-full-standing-ovation.json", build: buildStandingOvation, decorate: false },
  { output: "trh-full-golden-applause-rain.json", build: buildGoldenApplauseRain, decorate: false },
  { output: "trh-full-champion-applause.json", build: buildChampionApplause, decorate: false },
  { output: "trh-full-applause-grand-finale.json", build: buildApplauseGrandFinale, decorate: false },
  { output: "trh-full-giant-thanks-reveal.json", build: buildGiantThanksReveal, decorate: false },
  { output: "trh-full-golden-gratitude-burst.json", build: buildGoldenGratitudeBurst, decorate: false },
  { output: "trh-full-sparkle-thank-you.json", build: buildSparkleThankYou, decorate: false },
  { output: "trh-full-thanks-gift-pop.json", build: buildThanksGiftPop, decorate: false },
  { output: "trh-full-thanks-grand-finale.json", build: buildThanksGrandFinale, decorate: false },
  { output: "trh-full-giant-win-reveal.json", build: buildGiantWinReveal, decorate: false },
  { output: "trh-full-big-win-jackpot.json", build: buildBigWinJackpot, decorate: false },
  { output: "trh-full-royal-win-crown.json", build: buildRoyalWinCrown, decorate: false },
  { output: "trh-full-win-confetti-blast.json", build: buildWinConfettiBlast, decorate: false },
  { output: "trh-full-mega-win-finale.json", build: buildMegaWinFinale, decorate: false },
  { output: "trh-full-friendship-handshake-reveal.json", build: buildFriendshipHandshakeReveal, decorate: false },
  { output: "trh-full-best-friends-pop.json", build: buildBestFriendsPop, decorate: false },
  { output: "trh-full-friendship-heart-burst.json", build: buildFriendshipHeartBurst, decorate: false },
  { output: "trh-full-friendship-star-circle.json", build: buildFriendshipStarCircle, decorate: false },
  { output: "trh-full-friendship-grand-finale.json", build: buildFriendshipGrandFinale, decorate: false },
  { output: "trh-full-jackpot-fever.json", build: buildJackpotFever, decorate: false },
  { output: "trh-full-bingo-shock.json", build: buildBingoShock, decorate: false },
  { output: "trh-full-bingo-ball-formation-wink.json", build: buildBingoBallFormationWink, decorate: false },
  { output: "trh-full-omg-big-win.json", build: buildOmgBigWin, decorate: false },
  { output: "trh-full-hot-streak.json", build: buildHotStreak, decorate: false },
  { output: "trh-full-lucky-diamond-hit.json", build: buildLuckyDiamondHit, decorate: false },
  { output: "trh-full-lucky-roll.json", build: buildLuckyRoll, decorate: false },
  { output: "trh-full-electric-win-pulse.json", build: buildElectricWinPulse, decorate: false },
  { output: "trh-full-money-rush.json", build: buildMoneyRush, decorate: false },
  { output: "trh-full-troll-win.json", build: buildTrollWin, decorate: false },
  { output: "trh-full-miracle-hit.json", build: buildMiracleHit, decorate: false },
  { output: "trh-full-giant-lol-burst.json", build: buildGiantLolBurst, decorate: false },
  { output: "trh-full-laughing-emoji-storm.json", build: buildLaughingEmojiStorm, decorate: false },
  { output: "trh-full-hahaha-text-wave.json", build: buildHahahaTextWave, decorate: false },
  { output: "trh-full-rofl-jackpot.json", build: buildRoflJackpot, decorate: false },
  { output: "trh-full-laughter-grand-finale.json", build: buildLaughterGrandFinale, decorate: false },
];

export const regenerateFullscreenLotties = async (rootDir) => {
  const targetDir = path.join(rootDir, "public", "winks", "fullscreen");
  await fs.mkdir(targetDir, { recursive: true });

  for (const effect of effects) {
    const animation = effect.decorate === false
      ? effect.build()
      : decoratePremiumFullscreenAnimation(effect.build(), effect.output);
    const winkAnimation = retimeFullscreenWink(animation, TARGET_WINK_FRAMES);
    await fs.writeFile(path.join(targetDir, effect.output), `${JSON.stringify(winkAnimation)}\n`, "utf8");
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await regenerateFullscreenLotties(process.cwd());
}
