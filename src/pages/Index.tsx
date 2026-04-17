import { useCallback, useMemo, useRef, useState } from "react";
import {
  PartyPopper, Sparkles, Heart, Star, Zap, Crown, Smile, Flame, Wand2,
  Volume2, VolumeX, RotateCw, Eraser, Shuffle, Trophy,
  Rainbow, DollarSign, Droplets, Snowflake, Bell, CloudLightning,
  Rocket, Drum, Sparkle, Hand,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CelebrationCard } from "@/components/CelebrationCard";
import { EffectOverlay } from "@/components/EffectOverlay";
import {
  CelebrationId, fullScreenConfetti, fireworksConfetti, fireConfetti,
  triggerEmojiConfetti, clearConfetti, playSoundFor, rainbowConfetti, laserConfetti,
  fwClassic, fwMega, fwRain, fwSpiral, fwHeart, fwPulse, fwRgb, fwFinale, fwCrackle,
} from "@/lib/celebrations";
import { setMuted } from "@/lib/sounds";
import { toast } from "sonner";

type Celebration = {
  id: CelebrationId;
  name: string;
  description: string;
  icon: typeof PartyPopper;
  gradient: string;
  featured?: boolean;
};

const CELEBRATIONS: Celebration[] = [
  { id: "celebration", name: "Celebration", description: "Confetti em tela cheia + party horns. A explosão festiva imersiva.", icon: PartyPopper, gradient: "bg-gradient-hero", featured: true },
  { id: "fireworks", name: "Fogos de Artifício", description: "Explosões coloridas iluminando o céu da tela.", icon: Flame, gradient: "bg-gradient-to-br from-festive-red to-festive-orange" },
  { id: "balloons", name: "Balões", description: "Balões coloridos subindo suavemente pela tela.", icon: Wand2, gradient: "bg-gradient-to-br from-festive-pink to-festive-purple" },
  { id: "glitter", name: "Chuva de Glitter", description: "Partículas brilhantes caindo em cascata.", icon: Sparkles, gradient: "bg-gradient-to-br from-festive-cyan to-festive-blue" },
  { id: "stars", name: "Estrelas Brilhando", description: "Estrelas piscando por toda a tela.", icon: Star, gradient: "bg-gradient-to-br from-festive-yellow to-festive-orange" },
  { id: "hearts", name: "Corações Flutuantes", description: "Corações apaixonados subindo lentamente.", icon: Heart, gradient: "bg-gradient-to-br from-festive-pink to-festive-red" },
  { id: "emojis", name: "Emoji Explosion", description: "Uma explosão divertida de emojis felizes.", icon: Smile, gradient: "bg-gradient-to-br from-festive-yellow to-festive-green" },
  { id: "neon", name: "Neon Flash", description: "Flash neon vibrante e cinematográfico.", icon: Zap, gradient: "bg-gradient-neon" },
  { id: "golden", name: "Golden Sparkle", description: "Burst dourado luxuoso e elegante.", icon: Crown, gradient: "bg-gradient-gold" },
  { id: "happy", name: "Happy Burst", description: "Mistura alegre com som divertido.", icon: Trophy, gradient: "bg-gradient-to-br from-festive-purple to-festive-cyan" },
  { id: "rainbow", name: "Arco-íris", description: "Cascata colorida em forma de arco-íris.", icon: Rainbow, gradient: "bg-gradient-celebration" },
  { id: "cash", name: "Chuva de Dinheiro", description: "Notas e cifras caindo do céu.", icon: DollarSign, gradient: "bg-gradient-to-br from-festive-green to-festive-yellow" },
  { id: "bubbles", name: "Bolhas de Sabão", description: "Bolhas leves flutuando pela tela.", icon: Droplets, gradient: "bg-gradient-to-br from-festive-cyan to-festive-purple" },
  { id: "laser", name: "Laser Show", description: "Raios laser cruzando a tela em alta velocidade.", icon: Sparkle, gradient: "bg-gradient-to-br from-festive-purple to-festive-pink" },
  { id: "snow", name: "Nevasca", description: "Flocos de neve caindo lentamente.", icon: Snowflake, gradient: "bg-gradient-to-br from-festive-blue to-festive-cyan" },
  { id: "bells", name: "Sinos", description: "Sinos festivos com som mágico.", icon: Bell, gradient: "bg-gradient-to-br from-festive-yellow to-festive-red" },
  { id: "thunder", name: "Trovão", description: "Raios e flashes brancos intensos.", icon: CloudLightning, gradient: "bg-gradient-to-br from-festive-blue to-festive-purple" },
  { id: "ufo", name: "Invasão UFO", description: "OVNIs alienígenas invadindo a tela.", icon: Rocket, gradient: "bg-gradient-to-br from-festive-green to-festive-cyan" },
  { id: "drumroll", name: "Rufar de Tambores", description: "Suspense crescente com tambores.", icon: Drum, gradient: "bg-gradient-to-br from-festive-red to-festive-purple" },
  { id: "magic", name: "Magia", description: "Varinhas mágicas com brilho encantado.", icon: Wand2, gradient: "bg-gradient-to-br from-festive-purple to-festive-blue" },
  { id: "applause", name: "Aplausos", description: "Mãos aplaudindo para celebrar você.", icon: Hand, gradient: "bg-gradient-to-br from-festive-orange to-festive-pink" },
  // Fireworks variations
  { id: "fw-classic", name: "Fogos Clássicos", description: "Bursts coloridos espalhados pelo céu.", icon: Flame, gradient: "bg-gradient-to-br from-festive-red to-festive-yellow" },
  { id: "fw-mega", name: "Mega Fogos", description: "Explosões gigantes com som de trovão.", icon: Flame, gradient: "bg-gradient-to-br from-festive-purple to-festive-red" },
  { id: "fw-rain", name: "Chuva Dourada", description: "Cascata dourada caindo do alto.", icon: Flame, gradient: "bg-gradient-gold" },
  { id: "fw-spiral", name: "Fogos Espiral", description: "Partículas em movimento espiralado.", icon: Flame, gradient: "bg-gradient-to-br from-festive-purple to-festive-cyan" },
  { id: "fw-heart", name: "Fogos Coração", description: "Bursts em forma de coração apaixonado.", icon: Heart, gradient: "bg-gradient-to-br from-festive-pink to-festive-red" },
  { id: "fw-pulse", name: "Fogos Pulsantes", description: "Ondas pulsantes que crescem do centro.", icon: Flame, gradient: "bg-gradient-to-br from-festive-cyan to-festive-purple" },
  { id: "fw-rgb", name: "Fogos RGB", description: "Trio vermelho, verde e azul em sequência.", icon: Flame, gradient: "bg-gradient-to-br from-festive-red to-festive-blue" },
  { id: "fw-finale", name: "Grand Finale", description: "Build-up épico com explosão final massiva.", icon: Crown, gradient: "bg-gradient-hero" },
  { id: "fw-crackle", name: "Fogos Crepitantes", description: "Pequenos estalos brilhantes em série.", icon: Sparkles, gradient: "bg-gradient-to-br from-festive-yellow to-festive-orange" },
];

const Index = () => {
  const [active, setActive] = useState<CelebrationId | null>(null);
  const [runId, setRunId] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [muted, setMutedState] = useState(false);
  const lastRef = useRef<CelebrationId | null>(null);

  const totalClicks = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts]
  );

  const topEffects = useMemo(
    () =>
      [...CELEBRATIONS]
        .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
        .slice(0, 3),
    [counts]
  );

  const runEffect = useCallback((id: CelebrationId) => {
    setActive(id);
    lastRef.current = id;
    setRunId((r) => r + 1);
    setCounts((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
    playSoundFor(id);

    switch (id) {
      case "celebration":
        fullScreenConfetti();
        // second wave
        setTimeout(() => fullScreenConfetti(), 600);
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
        setTimeout(() => fullScreenConfetti(), 700);
        break;
      case "fw-classic": fwClassic(); break;
      case "fw-mega": fwMega(); break;
      case "fw-rain": fwRain(); break;
      case "fw-spiral": fwSpiral(); break;
      case "fw-heart": fwHeart(); break;
      case "fw-pulse": fwPulse(); break;
      case "fw-rgb": fwRgb(); break;
      case "fw-finale": fwFinale(); break;
      case "fw-crackle": fwCrackle(); break;
      // others handled by overlay
    }
  }, []);

  const repeat = () => {
    if (lastRef.current) runEffect(lastRef.current);
    else toast("Escolha um efeito primeiro!");
  };

  const clearAll = () => {
    clearConfetti();
    setActive(null);
    setRunId((r) => r + 1);
    toast("Tela limpa ✨");
  };

  const random = () => {
    const pick = CELEBRATIONS[Math.floor(Math.random() * CELEBRATIONS.length)];
    toast(`🎲 ${pick.name}!`);
    runEffect(pick.id);
  };

  const toggleMute = () => {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
  };

  const activeMeta = CELEBRATIONS.find((c) => c.id === active);

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Decorative background blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-festive-purple/30 blur-3xl animate-float-slow" />
        <div className="absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full bg-festive-pink/25 blur-3xl animate-float" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-festive-cyan/20 blur-3xl animate-float-slow" />
      </div>

      <EffectOverlay effect={active} runId={runId} />

      {/* Header */}
      <header className="container flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-glow">
            <PartyPopper className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">Winks</span>
        </div>
        <Button variant="outline" size="sm" onClick={toggleMute} className="glass">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          <span className="ml-2 hidden sm:inline">{muted ? "Som desligado" : "Som ligado"}</span>
        </Button>
      </header>

      {/* Hero */}
      <section className="container pt-8 pb-12 text-center md:pt-16 md:pb-20">
        <div className="mx-auto inline-flex animate-fade-in items-center gap-2 rounded-full border border-border/60 glass px-4 py-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-secondary" />
          Ative um efeito especial em um clique
        </div>

        <h1 className="mx-auto mt-6 max-w-4xl animate-fade-in text-5xl font-extrabold leading-[1.05] tracking-tighter md:text-7xl">
          Escolha sua{" "}
          <span className="text-gradient-hero animate-gradient inline-block">Celebration</span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl animate-fade-in text-base text-muted-foreground md:text-lg">
          Teste vários efeitos festivos com confetti, fogos, glitter, neon e muito mais.
          Cada clique dispara uma experiência visual e sonora única. 🎉
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 animate-fade-in">
          <Button
            size="lg"
            onClick={() => runEffect("celebration")}
            className="bg-gradient-hero text-white shadow-elegant hover:shadow-glow transition-all hover:scale-105 px-7 h-12 text-base font-semibold"
          >
            <PartyPopper className="mr-2 h-5 w-5" />
            Disparar Celebration
          </Button>
          <Button size="lg" variant="outline" onClick={random} className="glass h-12 px-6">
            <Shuffle className="mr-2 h-4 w-4" />
            Surpresa Aleatória
          </Button>
        </div>

        {/* Demo area */}
        <div className="mx-auto mt-10 max-w-2xl">
          <div className="glass rounded-2xl p-6 shadow-card">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Efeito ativo</p>
            <div className="mt-2 flex items-center justify-center gap-3">
              {activeMeta ? (
                <>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${activeMeta.gradient}`}>
                    <activeMeta.icon className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-2xl font-bold">{activeMeta.name}</span>
                </>
              ) : (
                <span className="text-2xl font-bold text-muted-foreground">Nenhum ainda…</span>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={repeat}>
                <RotateCw className="mr-1.5 h-4 w-4" /> Repetir
              </Button>
              <Button size="sm" variant="outline" onClick={clearAll} className="glass">
                <Eraser className="mr-1.5 h-4 w-4" /> Limpar
              </Button>
              <Button size="sm" variant="outline" onClick={random} className="glass">
                <Shuffle className="mr-1.5 h-4 w-4" /> Random
              </Button>
            </div>
            {totalClicks > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                Você já disparou <span className="font-bold text-foreground">{totalClicks}</span> celebrações 🎊
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Top effects */}
      {totalClicks > 0 && (
        <section className="container pb-10">
          <div className="mb-4 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-secondary" />
            <h2 className="text-xl font-bold">Top Effects</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {topEffects.map((e, i) => (
              <button
                key={e.id}
                onClick={() => runEffect(e.id)}
                className="glass hover-lift group flex items-center gap-3 rounded-xl p-4 text-left shadow-card"
              >
                <span className="text-2xl font-black text-gradient-gold">#{i + 1}</span>
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${e.gradient}`}>
                  <e.icon className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{e.name}</p>
                  <p className="text-xs text-muted-foreground">{counts[e.id] ?? 0} cliques</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Grid */}
      <section className="container pb-24">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold md:text-3xl">Todas as celebrações</h2>
            <p className="mt-1 text-sm text-muted-foreground">Clique em qualquer card para disparar o efeito.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CELEBRATIONS.map((c) => (
            <CelebrationCard
              key={c.id}
              icon={c.icon}
              name={c.name}
              description={c.description}
              count={counts[c.id] ?? 0}
              active={active === c.id}
              featured={c.featured}
              gradient={c.gradient}
              onClick={() => runEffect(c.id)}
            />
          ))}
        </div>
      </section>

      <footer className="container border-t border-border/40 py-6 text-center text-xs text-muted-foreground">
        Feito com 💖 para espalhar boas vibrações.
      </footer>
    </main>
  );
};

export default Index;
