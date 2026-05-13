import { useEffect, useState, type CSSProperties } from "react";
import type { CelebrationId } from "@/lib/celebrations";

type Item = {
  id: number;
  left: number;
  top?: number;
  delay: number;
  size: number;
  duration: number;
  drift: number;
  emoji?: string;
  color?: string;
};

interface Props {
  effect: CelebrationId | null;
  runId: number;
  onDone?: () => void;
}

const palette = ["#ff4ecd", "#a855f7", "#3b82f6", "#22d3ee", "#fbbf24", "#fb923c", "#22c55e"];
const flowerPalette = ["#f9a8d4", "#f472b6", "#fbcfe8", "#fef3c7", "#ffffff"];
const luckyPalette = ["#22c55e", "#86efac", "#fbbf24", "#fde68a", "#ffffff"];
const heartPalette = ["#ff4ecd", "#f43f5e", "#ec4899", "#ffffff"];
const CORE_WINKS = new Set([
  "celebration",
  "bingo",
  "flowers",
  "thumbs-up",
  "leprechaun",
  "countdown",
  "trivia-time",
  "happy-birthday",
]);
const WINK_LIFETIME_MS = 8200;

const normalizeCelebrationKey = (effect: CelebrationId) => {
  const key = String(effect).trim().toLowerCase();
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

export const EffectOverlay = ({ effect, runId, onDone }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!effect) return;

    const key = normalizeCelebrationKey(effect);
    const isCoreWink = CORE_WINKS.has(key);
    const timingScale = isCoreWink ? 1.4 : 1;
    const make = (
      count: number,
      opts: Partial<Item> & { emojis?: string[]; colors?: string[] },
    ): Item[] =>
      Array.from({ length: count }).map((_, index) => ({
        id: Date.now() + index + Math.random(),
        left: Math.random() * 100,
        top: Math.random() * 90,
        delay: Math.random() * (isCoreWink ? 1.6 : 0.8) * timingScale,
        size: (opts.size ?? 24) + Math.random() * 18,
        duration: ((opts.duration ?? 4) + Math.random() * (isCoreWink ? 3.2 : 2.4)) * timingScale,
        drift: (Math.random() - 0.5) * 180,
        emoji: opts.emojis ? opts.emojis[Math.floor(Math.random() * opts.emojis.length)] : undefined,
        color: opts.colors ? opts.colors[Math.floor(Math.random() * opts.colors.length)] : undefined,
      }));

    let next: Item[] = [];
    let lifetime = 5000;
    setFlash(null);

    switch (key) {
      case "celebration":
        next = make(28, { colors: palette, size: 8, duration: 3.1 });
        setFlash("bg-gradient-neon");
        setTimeout(() => setFlash(null), 220);
        lifetime = WINK_LIFETIME_MS;
        break;
      case "bingo":
        next = make(10, { emojis: ["7", "8", "3", "9", "!"], size: 22, duration: 0 });
        setFlash("bg-white");
        setTimeout(() => setFlash(null), 160);
        setTimeout(() => {
          setFlash("bg-gradient-neon");
          setTimeout(() => setFlash(null), 220);
        }, 520);
        lifetime = WINK_LIFETIME_MS;
        break;
      case "flowers":
        next = make(16, { colors: flowerPalette, size: 10, duration: 4.8 });
        lifetime = WINK_LIFETIME_MS;
        break;
      case "thumbs-up":
        next = make(8, { emojis: ["+1", "OK"], size: 24, duration: 0 });
        setFlash("bg-gradient-neon");
        setTimeout(() => setFlash(null), 180);
        lifetime = WINK_LIFETIME_MS;
        break;
      case "leprechaun":
        next = make(16, { colors: luckyPalette, size: 10, duration: 4.2 });
        lifetime = WINK_LIFETIME_MS;
        break;
      case "countdown":
        setFlash("bg-white");
        setTimeout(() => setFlash(null), 160);
        setTimeout(() => {
          setFlash("bg-white");
          setTimeout(() => setFlash(null), 160);
        }, 900);
        setTimeout(() => {
          setFlash("bg-white");
          setTimeout(() => setFlash(null), 220);
        }, 1800);
        lifetime = WINK_LIFETIME_MS;
        break;
      case "trivia-time":
        next = make(10, { emojis: ["?"], size: 28, duration: 0 });
        setFlash("bg-gradient-neon");
        setTimeout(() => setFlash(null), 240);
        lifetime = WINK_LIFETIME_MS;
        break;
      case "happy-birthday":
        next = make(18, { colors: palette, size: 8, duration: 4.4 });
        setFlash("bg-white");
        setTimeout(() => setFlash(null), 180);
        lifetime = WINK_LIFETIME_MS;
        break;
      case "balloons":
        next = make(18, { colors: palette, size: 12, duration: 6 });
        lifetime = 6500;
        break;
      case "glitter":
        next = make(72, { colors: palette, size: 6, duration: 3 });
        lifetime = 4200;
        break;
      case "hearts":
        next = make(20, { colors: heartPalette, size: 10, duration: 5 });
        lifetime = 6000;
        break;
      case "stars":
        next = make(18, { emojis: ["*", "+"], size: 22, duration: 0 });
        lifetime = 3200;
        break;
      case "neon":
        setFlash("bg-gradient-neon");
        setTimeout(() => setFlash(null), 700);
        lifetime = 1200;
        break;
      case "golden":
        next = make(36, { colors: ["#fbbf24", "#f59e0b", "#fde68a", "#fcd34d"], size: 8, duration: 2.5 });
        lifetime = 3200;
        break;
      case "cash":
        next = make(20, { emojis: ["$"], size: 24, duration: 4 });
        lifetime = 5000;
        break;
      case "bubbles":
        next = make(20, { colors: ["#67e8f9", "#93c5fd", "#ffffff"], size: 14, duration: 6 });
        lifetime = 6500;
        break;
      case "snow":
        next = make(42, { colors: ["#ffffff", "#bfdbfe", "#67e8f9"], size: 8, duration: 7 });
        lifetime = 7800;
        break;
      case "bells":
        next = make(12, { emojis: ["o"], size: 18, duration: 4 });
        lifetime = 5000;
        break;
      case "thunder":
        setFlash("bg-white");
        setTimeout(() => setFlash(null), 200);
        setTimeout(() => {
          setFlash("bg-white");
          setTimeout(() => setFlash(null), 200);
        }, 400);
        lifetime = 1500;
        break;
      case "ufo":
        next = make(8, { emojis: ["O", "*"], size: 24, duration: 0 });
        lifetime = 4500;
        break;
      case "drumroll":
        next = make(8, { emojis: ["!"], size: 22, duration: 0 });
        lifetime = 2200;
        break;
      case "magic":
        next = make(24, { emojis: ["*", "+"], size: 22, duration: 0 });
        lifetime = 3000;
        break;
      case "applause":
        next = make(14, { emojis: ["OK", "+1"], size: 20, duration: 0 });
        lifetime = 2800;
        break;
      case "rainbow":
        next = make(14, { colors: palette, size: 10, duration: 5 });
        lifetime = 5200;
        break;
      default:
        lifetime = 3000;
    }

    setItems(next);

    const timeout = setTimeout(() => {
      setItems([]);
      onDone?.();
    }, lifetime);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const risingEffects = ["balloons", "hearts", "bubbles", "rainbow", "flowers", "happy-birthday", "leprechaun"] as const;
  const fallingEffects = ["glitter", "golden", "cash", "snow", "bells", "celebration"] as const;
  const twinkleEffects = ["stars", "magic", "drumroll", "applause", "ufo", "thumbs-up", "trivia-time", "bingo"] as const;
  const normalizedEffect = effect ? normalizeCelebrationKey(effect) : null;

  const renderItem = (it: Item, className: string, style: CSSProperties) => {
    if (it.emoji) {
      return (
        <div key={it.id} className={className} style={style}>
          {it.emoji}
        </div>
      );
    }

    return <div key={it.id} className={`${className} rounded-full`} style={style} />;
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {flash && <div className={`absolute inset-0 animate-flash ${flash} mix-blend-screen`} />}

      {items.map((it) => {
        const baseStyle: CSSProperties = {
          left: `${it.left}%`,
          fontSize: it.emoji ? `${it.size}px` : undefined,
          width: it.emoji ? undefined : `${it.size}px`,
          height: it.emoji ? undefined : `${it.size}px`,
          animationDuration: `${it.duration}s`,
          animationDelay: `${it.delay}s`,
          ["--drift" as keyof CSSProperties]: `${it.drift}px`,
          ["--rot" as keyof CSSProperties]: `${(Math.random() - 0.5) * 720}deg`,
          background: it.color ? `radial-gradient(circle, ${it.color}, transparent 70%)` : undefined,
          boxShadow: it.color ? `0 0 12px ${it.color}` : undefined,
        };

        if (normalizedEffect && twinkleEffects.includes(normalizedEffect as typeof twinkleEffects[number])) {
          return renderItem(it, "absolute animate-twinkle", {
            ...baseStyle,
            top: `${Math.random() * 90}%`,
            animationDuration: `${1 + Math.random() * 1.5}s`,
          });
        }

        if (normalizedEffect && risingEffects.includes(normalizedEffect as typeof risingEffects[number])) {
          return renderItem(it, "absolute bottom-0 animate-rise", baseStyle);
        }

        if (normalizedEffect && fallingEffects.includes(normalizedEffect as typeof fallingEffects[number])) {
          return renderItem(it, "absolute top-0 animate-fall", baseStyle);
        }

        return null;
      })}
    </div>
  );
};
