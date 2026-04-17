// Lightweight Web Audio sound generator (no asset files needed)
let ctx: AudioContext | null = null;
let muted = false;

const getCtx = () => {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
};

export const setMuted = (v: boolean) => { muted = v; };
export const isMuted = () => muted;

const tone = (freq: number, dur: number, type: OscillatorType = "sine", vol = 0.2, delay = 0) => {
  const ac = getCtx();
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
};

const sweep = (f1: number, f2: number, dur: number, type: OscillatorType = "sawtooth", vol = 0.18, delay = 0) => {
  const ac = getCtx();
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f1, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
};

const noise = (dur: number, vol = 0.15, delay = 0) => {
  const ac = getCtx();
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const buffer = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  const gain = ac.createGain();
  src.buffer = buffer;
  gain.gain.value = vol;
  src.connect(gain).connect(ac.destination);
  src.start(t0);
};

export const sounds = {
  partyHorn: () => {
    sweep(220, 880, 0.3, "sawtooth", 0.22);
    sweep(220, 660, 0.4, "square", 0.12, 0.15);
    setTimeout(() => sweep(180, 700, 0.35, "sawtooth", 0.18), 350);
  },
  fireworks: () => {
    for (let i = 0; i < 4; i++) {
      const d = i * 0.3;
      sweep(80, 1200, 0.15, "triangle", 0.18, d);
      noise(0.4, 0.12, d + 0.15);
    }
  },
  pop: () => { tone(800, 0.08, "triangle", 0.2); tone(1200, 0.06, "sine", 0.15, 0.05); },
  sparkle: () => {
    [880, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.15, "sine", 0.1, i * 0.05));
  },
  twinkle: () => {
    [1568, 2093, 2637].forEach((f, i) => tone(f, 0.2, "triangle", 0.1, i * 0.08));
  },
  heart: () => { tone(523, 0.15, "sine", 0.18); tone(659, 0.2, "sine", 0.15, 0.1); },
  emoji: () => { sweep(400, 900, 0.2, "square", 0.15); tone(1200, 0.1, "triangle", 0.15, 0.15); },
  neon: () => { sweep(1500, 200, 0.4, "sawtooth", 0.18); noise(0.2, 0.1, 0.05); },
  golden: () => { [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.18, "sine", 0.14, i * 0.06)); },
  happy: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, "triangle", 0.16, i * 0.08)); },
  // New sounds
  rainbow: () => { [392, 440, 494, 523, 587, 659, 698, 784].forEach((f, i) => tone(f, 0.1, "sine", 0.12, i * 0.05)); },
  cash: () => { [1568, 1976].forEach((f, i) => tone(f, 0.08, "square", 0.15, i * 0.05)); tone(2349, 0.15, "triangle", 0.12, 0.15); },
  bubble: () => { [400, 600, 800, 1000].forEach((f, i) => sweep(f, f * 1.5, 0.15, "sine", 0.1, i * 0.08)); },
  laser: () => { sweep(2000, 100, 0.3, "sawtooth", 0.15); },
  snow: () => { [2000, 2500, 3000].forEach((f, i) => tone(f, 0.4, "sine", 0.06, i * 0.15)); noise(0.6, 0.04); },
  bell: () => { [1047, 1319, 1568].forEach((f, i) => tone(f, 0.6, "sine", 0.12, i * 0.1)); },
  thunder: () => { noise(0.8, 0.25); sweep(120, 40, 0.6, "sawtooth", 0.2, 0.1); },
  ufo: () => { sweep(400, 1200, 0.3, "sine", 0.15); sweep(1200, 400, 0.3, "sine", 0.15, 0.3); sweep(400, 1200, 0.3, "sine", 0.15, 0.6); },
  drumroll: () => { for (let i = 0; i < 12; i++) noise(0.04, 0.12, i * 0.04); tone(880, 0.4, "triangle", 0.2, 0.5); },
  magic: () => { [523, 698, 880, 1175, 1568].forEach((f, i) => tone(f, 0.2, "triangle", 0.12, i * 0.06)); },
  applause: () => { for (let i = 0; i < 25; i++) noise(0.05 + Math.random() * 0.05, 0.06 + Math.random() * 0.05, i * 0.04); },
};
