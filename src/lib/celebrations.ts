import confetti from "canvas-confetti";
import { sounds } from "./sounds";

export type CelebrationId =
  | "celebration"
  | "bingo"
  | "bingo!"
  | "flowers"
  | "thumbs-up"
  | "thumbs up"
  | "leprechaun"
  | "countdown"
  | "trivia-time"
  | "trivia time"
  | "happy-birthday"
  | "happy birthday"
  | "fireworks"
  | "balloons"
  | "glitter"
  | "stars"
  | "hearts"
  | "emojis"
  | "neon"
  | "golden"
  | "happy"
  | "rainbow"
  | "cash"
  | "bubbles"
  | "laser"
  | "snow"
  | "bells"
  | "thunder"
  | "ufo"
  | "drumroll"
  | "magic"
  | "applause"
  | "confetti-cannon"
  | "starburst"
  | "heart-rain"
  | "neon-rings"
  | "gold-comet"
  | "bubble-pop"
  // Fireworks variations
  | "fw-classic"
  | "fw-mega"
  | "fw-rain"
  | "fw-spiral"
  | "fw-heart"
  | "fw-pulse"
  | "fw-rgb"
  | "fw-finale"
  | "fw-crackle";

export const fireConfetti = (opts: confetti.Options = {}) => {
  confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, ...opts });
};

export const fullScreenConfetti = () => {
  const duration = 2500;
  const end = Date.now() + duration;
  const colors = ["#ff4ecd", "#a855f7", "#3b82f6", "#22d3ee", "#fbbf24", "#fb923c"];
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors });
    confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({ particleCount: 200, spread: 160, origin: { y: 0.5 }, colors, scalar: 1.2 });
};

export const fireworksConfetti = () => {
  const duration = 2500;
  const end = Date.now() + duration;
  const colors = ["#ff4ecd", "#fbbf24", "#22d3ee", "#a855f7", "#22c55e"];
  const interval = setInterval(() => {
    if (Date.now() > end) return clearInterval(interval);
    confetti({
      startVelocity: 30, spread: 360, ticks: 60, particleCount: 60,
      origin: { x: Math.random(), y: Math.random() * 0.5 },
      colors, shapes: ["circle"], scalar: 1.1,
    });
  }, 350);
};

export const triggerEmojiConfetti = (emojis: string[]) => {
  const scalar = 2;
  const shapes = emojis.map((e) => confetti.shapeFromText({ text: e, scalar }));
  confetti({ particleCount: 50, spread: 100, origin: { y: 0.6 }, scalar, shapes });
  setTimeout(() => confetti({ particleCount: 40, spread: 120, origin: { y: 0.7 }, scalar, shapes }), 200);
};

export const rainbowConfetti = () => {
  const colors = ["#ff0000", "#ff8c00", "#ffd700", "#00c853", "#00b0ff", "#651fff", "#d500f9"];
  colors.forEach((color, i) => {
    setTimeout(() => {
      confetti({ particleCount: 30, angle: 90, spread: 30, startVelocity: 55, origin: { x: 0.5, y: 0.7 }, colors: [color], scalar: 1.1 });
    }, i * 80);
  });
};

export const laserConfetti = () => {
  const colors = ["#22d3ee", "#a855f7", "#ff4ecd"];
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      confetti({ particleCount: 1, startVelocity: 80, spread: 1, ticks: 100, origin: { x: Math.random(), y: 1 }, colors, shapes: ["square"], scalar: 2 });
    }, i * 100);
  }
};

// ===== Fireworks Variations =====

const launchBurst = (x: number, y: number, colors: string[], opts: confetti.Options = {}) => {
  confetti({
    particleCount: 80, startVelocity: 28, spread: 360, ticks: 70,
    origin: { x, y }, colors, shapes: ["circle"], scalar: 1, ...opts,
  });
};

export const fwClassic = () => {
  const colors = ["#ff4ecd", "#fbbf24", "#22d3ee", "#a855f7", "#22c55e", "#fb923c"];
  for (let i = 0; i < 6; i++) {
    setTimeout(() => launchBurst(0.15 + Math.random() * 0.7, 0.2 + Math.random() * 0.3, colors), i * 350);
  }
};

export const fwMega = () => {
  const colors = ["#ff4ecd", "#fbbf24", "#22d3ee", "#a855f7"];
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      launchBurst(Math.random(), Math.random() * 0.4, colors, { particleCount: 200, startVelocity: 45, scalar: 1.5 });
    }, i * 500);
  }
};

export const fwRain = () => {
  const colors = ["#fbbf24", "#fde68a", "#f59e0b"];
  const end = Date.now() + 3000;
  (function tick() {
    if (Date.now() > end) return;
    confetti({
      particleCount: 8, angle: 270, spread: 30, startVelocity: 25, gravity: 0.4,
      origin: { x: Math.random(), y: -0.1 }, colors, shapes: ["circle"], scalar: 0.8,
    });
    setTimeout(tick, 80);
  })();
};

export const fwSpiral = () => {
  const colors = ["#a855f7", "#22d3ee", "#ff4ecd"];
  for (let i = 0; i < 24; i++) {
    setTimeout(() => {
      const angle = (i * 30) % 360;
      confetti({
        particleCount: 6, angle, spread: 10, startVelocity: 40,
        origin: { x: 0.5, y: 0.5 }, colors, shapes: ["circle"], scalar: 0.9,
      });
    }, i * 60);
  }
};

export const fwHeart = () => {
  const colors = ["#ff4ecd", "#ef4444", "#f43f5e", "#ec4899"];
  // Heart shape via two bursts side by side then bottom
  setTimeout(() => launchBurst(0.4, 0.35, colors, { particleCount: 100, scalar: 1.2 }), 0);
  setTimeout(() => launchBurst(0.6, 0.35, colors, { particleCount: 100, scalar: 1.2 }), 100);
  setTimeout(() => launchBurst(0.5, 0.55, colors, { particleCount: 140, scalar: 1.4 }), 300);
};

export const fwPulse = () => {
  const colors = ["#22d3ee", "#a855f7"];
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      launchBurst(0.5, 0.45, colors, {
        particleCount: 40 + i * 30,
        startVelocity: 20 + i * 8,
        scalar: 0.8 + i * 0.2,
      });
    }, i * 250);
  }
};

export const fwRgb = () => {
  const groups = [
    ["#ff0000", "#ff4444"],
    ["#22c55e", "#4ade80"],
    ["#3b82f6", "#60a5fa"],
  ];
  groups.forEach((colors, i) => {
    setTimeout(() => {
      launchBurst(0.25 + i * 0.25, 0.3, colors, { particleCount: 120, scalar: 1.2 });
    }, i * 250);
  });
};

export const fwFinale = () => {
  const colors = ["#ff4ecd", "#fbbf24", "#22d3ee", "#a855f7", "#22c55e", "#fb923c", "#ffffff"];
  // Build-up
  for (let i = 0; i < 10; i++) {
    setTimeout(() => launchBurst(Math.random(), 0.1 + Math.random() * 0.4, colors, { particleCount: 60 }), i * 180);
  }
  // Mega finale
  setTimeout(() => {
    for (let j = 0; j < 6; j++) {
      launchBurst(Math.random(), Math.random() * 0.5, colors, { particleCount: 250, startVelocity: 50, scalar: 1.6 });
    }
  }, 2000);
};

export const fwCrackle = () => {
  const colors = ["#fbbf24", "#fde68a", "#ffffff"];
  for (let i = 0; i < 12; i++) {
    setTimeout(() => {
      confetti({
        particleCount: 30, startVelocity: 35, spread: 360, ticks: 40,
        origin: { x: Math.random(), y: 0.1 + Math.random() * 0.4 },
        colors, shapes: ["circle"], scalar: 0.6,
      });
    }, i * 120);
  }
};

export const clearConfetti = () => confetti.reset();

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

// Sound mapping
export const playSoundFor = (id: CelebrationId) => {
  switch (normalizeCelebrationKey(id)) {
    case "celebration": sounds.partyHorn(); break;
    case "bingo": sounds.partyHorn(); sounds.fireworks(); sounds.cash(); sounds.thunder(); break;
    case "flowers": sounds.magic(); sounds.sparkle(); break;
    case "thumbs-up": sounds.emoji(); sounds.applause(); break;
    case "leprechaun": sounds.cash(); sounds.rainbow(); sounds.golden(); break;
    case "countdown": sounds.drumroll(); setTimeout(() => sounds.thunder(), 1450); break;
    case "trivia-time": sounds.neon(); sounds.magic(); break;
    case "happy-birthday": sounds.happy(); sounds.sparkle(); setTimeout(() => sounds.fireworks(), 180); break;
    case "fireworks": sounds.fireworks(); break;
    case "balloons": sounds.pop(); break;
    case "glitter": sounds.sparkle(); break;
    case "stars": sounds.twinkle(); break;
    case "hearts": sounds.heart(); break;
    case "emojis": sounds.emoji(); break;
    case "neon": sounds.neon(); break;
    case "golden": sounds.golden(); break;
    case "happy": sounds.happy(); break;
    case "rainbow": sounds.rainbow(); break;
    case "cash": sounds.cash(); break;
    case "bubbles": sounds.bubble(); break;
    case "laser": sounds.laser(); break;
    case "snow": sounds.snow(); break;
    case "bells": sounds.bell(); break;
    case "thunder": sounds.thunder(); break;
    case "ufo": sounds.ufo(); break;
    case "drumroll": sounds.drumroll(); break;
    case "magic": sounds.magic(); break;
    case "applause": sounds.applause(); break;
    case "fw-classic": sounds.fireworks(); break;
    case "fw-mega": sounds.thunder(); sounds.fireworks(); break;
    case "fw-rain": sounds.sparkle(); break;
    case "fw-spiral": sounds.ufo(); break;
    case "fw-heart": sounds.heart(); sounds.fireworks(); break;
    case "fw-pulse": sounds.drumroll(); break;
    case "fw-rgb": sounds.fireworks(); break;
    case "fw-finale": sounds.fireworks(); setTimeout(() => sounds.thunder(), 1800); break;
    case "fw-crackle": sounds.applause(); break;
  }
};
