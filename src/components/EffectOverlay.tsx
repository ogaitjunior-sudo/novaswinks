import { useEffect, useState } from "react";
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

export const EffectOverlay = ({ effect, runId, onDone }: Props) => {
  const [items, setItems] = useState<Item[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!effect) return;
    const make = (
      count: number,
      opts: Partial<Item> & { emojis?: string[]; colors?: string[] }
    ): Item[] =>
      Array.from({ length: count }).map((_, i) => ({
        id: Date.now() + i + Math.random(),
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        size: (opts.size ?? 24) + Math.random() * 20,
        duration: (opts.duration ?? 4) + Math.random() * 3,
        drift: (Math.random() - 0.5) * 200,
        emoji: opts.emojis ? opts.emojis[Math.floor(Math.random() * opts.emojis.length)] : undefined,
        color: opts.colors ? opts.colors[Math.floor(Math.random() * opts.colors.length)] : undefined,
      }));

    let next: Item[] = [];
    let lifetime = 5000;
    setFlash(null);

    switch (effect) {
      case "balloons":
        next = make(28, { emojis: ["🎈"], size: 36, duration: 6 });
        lifetime = 7000;
        break;
      case "glitter":
        next = make(120, { colors: palette, size: 6, duration: 3 });
        lifetime = 4500;
        break;
      case "hearts":
        next = make(35, { emojis: ["❤️", "💖", "💕", "💗", "💝"], size: 30, duration: 5 });
        lifetime = 6500;
        break;
      case "stars":
        next = make(40, { emojis: ["⭐", "✨", "🌟", "💫"], size: 28, duration: 0 });
        lifetime = 3500;
        break;
      case "neon":
        setFlash("bg-gradient-neon");
        setTimeout(() => setFlash(null), 700);
        lifetime = 1200;
        break;
      case "golden":
        next = make(60, { colors: ["#fbbf24", "#f59e0b", "#fde68a", "#fcd34d"], size: 8, duration: 2.5 });
        lifetime = 3500;
        break;
      case "cash":
        next = make(40, { emojis: ["💵", "💸", "💰", "🤑"], size: 36, duration: 4 });
        lifetime = 5500;
        break;
      case "bubbles":
        next = make(35, { emojis: ["🫧"], size: 40, duration: 6 });
        lifetime = 7000;
        break;
      case "snow":
        next = make(80, { emojis: ["❄️", "❅", "❆"], size: 22, duration: 7 });
        lifetime = 8500;
        break;
      case "bells":
        next = make(20, { emojis: ["🔔", "🎐"], size: 34, duration: 4 });
        lifetime = 5500;
        break;
      case "thunder":
        setFlash("bg-white");
        setTimeout(() => setFlash(null), 200);
        setTimeout(() => { setFlash("bg-white"); setTimeout(() => setFlash(null), 200); }, 400);
        lifetime = 1500;
        break;
      case "ufo":
        next = make(8, { emojis: ["🛸", "👽"], size: 50, duration: 5 });
        lifetime = 6500;
        break;
      case "drumroll":
        next = make(12, { emojis: ["🥁"], size: 40, duration: 0 });
        lifetime = 2500;
        break;
      case "magic":
        next = make(50, { emojis: ["🪄", "✨", "🔮"], size: 26, duration: 0 });
        lifetime = 3500;
        break;
      case "applause":
        next = make(35, { emojis: ["👏", "🙌"], size: 36, duration: 0 });
        lifetime = 3000;
        break;
      case "rainbow":
        next = make(25, { emojis: ["🌈"], size: 44, duration: 5 });
        lifetime = 6000;
        break;
      default:
        lifetime = 3000;
    }

    if (next.length) setItems(next);
    const t = setTimeout(() => {
      setItems([]);
      onDone?.();
    }, lifetime);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const risingEffects: CelebrationId[] = ["balloons", "hearts", "bubbles", "rainbow"];
  const fallingEffects: CelebrationId[] = ["glitter", "golden", "cash", "snow", "bells"];
  const twinkleEffects: CelebrationId[] = ["stars", "magic", "drumroll", "applause", "ufo"];

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {flash && <div className={`absolute inset-0 animate-flash ${flash} mix-blend-screen`} />}

      {items.map((it) => {
        const style: React.CSSProperties = {
          left: `${it.left}%`,
          fontSize: it.emoji ? `${it.size}px` : undefined,
          width: !it.emoji ? `${it.size}px` : undefined,
          height: !it.emoji ? `${it.size}px` : undefined,
          animationDuration: `${it.duration}s`,
          animationDelay: `${it.delay}s`,
          ["--drift" as any]: `${it.drift}px`,
          ["--rot" as any]: `${(Math.random() - 0.5) * 720}deg`,
          background: it.color ? `radial-gradient(circle, ${it.color}, transparent 70%)` : undefined,
          boxShadow: it.color ? `0 0 12px ${it.color}` : undefined,
        };

        if (effect && twinkleEffects.includes(effect)) {
          return (
            <div
              key={it.id}
              className="absolute animate-twinkle"
              style={{
                ...style,
                top: `${Math.random() * 90}%`,
                animationDuration: `${1 + Math.random() * 1.5}s`,
              }}
            >
              {it.emoji}
            </div>
          );
        }

        if (effect && risingEffects.includes(effect)) {
          return (
            <div key={it.id} className="absolute bottom-0 animate-rise" style={style}>
              {it.emoji}
            </div>
          );
        }

        if (effect && fallingEffects.includes(effect)) {
          if (it.emoji) {
            return (
              <div key={it.id} className="absolute animate-fall" style={{ ...style, top: 0 }}>
                {it.emoji}
              </div>
            );
          }
          return (
            <div
              key={it.id}
              className="absolute rounded-full animate-fall"
              style={{ ...style, top: 0 }}
            />
          );
        }

        return null;
      })}
    </div>
  );
};
