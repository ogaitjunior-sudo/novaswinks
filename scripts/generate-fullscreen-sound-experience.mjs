import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const rootDir = process.cwd();
const winkDir = path.join(rootDir, "public", "winks", "fullscreen");
const previewDir = path.join(rootDir, "public", "previews", "fullscreen");
const sourceDir = path.join(rootDir, "public", "audio", "source-real");
const audioDir = path.join(rootDir, "public", "audio", "fullscreen");
const sampleRate = 44100;
const durationSeconds = 8;
const skipSpecialSoundIds = new Set([
  "trh-full-gold-star-jackpot-rain",
  "trh-full-mega-star-explosion",
  "trh-full-golden-galaxy-spiral",
  "trh-full-star-flash-reward",
  "trh-full-golden-star-finale",
  "trh-full-petal-storm-bloom",
  "trh-full-sakura-jackpot-blossom",
  "trh-full-rose-swirl-reveal",
  "trh-full-floral-heart-bloom",
  "trh-full-bloom-burst-finale",
]);
const birthdaySongIds = new Set([
  "trh-full-birthday-cake-celebration",
  "trh-full-balloon-party-burst",
  "trh-full-gift-box-explosion",
  "trh-full-candle-wish-moment",
  "trh-full-happy-birthday-grand-finale",
]);
const christmasSongIds = new Set([
  "trh-full-christmas-tree-reveal",
  "trh-full-santa-gift-burst",
  "trh-full-snowfall-magic",
  "trh-full-jingle-bells-blast",
  "trh-full-christmas-grand-finale",
]);
const laughterVariantIds = new Set([
  "trh-full-giant-lol-burst",
  "trh-full-laughing-emoji-storm",
  "trh-full-hahaha-text-wave",
  "trh-full-rofl-jackpot",
  "trh-full-laughter-grand-finale",
]);

const sourceCandidates = {
  applause: ["applause.ogg"],
  laughter: ["laughter.ogg"],
  fireworks: ["fireworks.ogg", "fireworks.mp3"],
  cash: ["cash-register.mp3", "cash-register.ogg"],
  chimes: ["windchimes.mp3", "windchimes.ogg"],
  wind: ["howling-wind.mp3", "howling-wind.ogg", "windchimes.mp3"],
  bell: ["bell.wav", "bell.mp3"],
  birthday: ["bell.mp3", "windchimes.mp3"],
  bingo: ["cash-register.mp3", "bell.mp3"],
  casino: ["cash-register.mp3", "windchimes.mp3"],
  confetti: ["windchimes.mp3", "bell.mp3"],
  electric: ["windchimes.mp3"],
  flowers: ["windchimes.mp3"],
  hearts: ["windchimes.mp3"],
  kiss: ["windchimes.mp3"],
  lucky: ["cash-register.mp3", "windchimes.mp3"],
  neon: ["windchimes.mp3"],
  premium: ["cash-register.mp3", "windchimes.mp3"],
  snow: ["windchimes.mp3", "bell.mp3"],
  stars: ["windchimes.mp3"],
  thumbs: ["applause.ogg"],
  win: ["cash-register.mp3", "bell.mp3"],
};

const sourcePathFor = async (profile) => {
  for (const fileName of sourceCandidates[profile] ?? []) {
    const candidate = path.join(sourceDir, fileName);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
};

const soundProfile = (id) => {
  const lower = id.toLowerCase();
  if (birthdaySongIds.has(id)) return "birthday-song";
  if (christmasSongIds.has(id)) return "christmas-song";
  if (lower.includes("firework")) return "fireworks";
  if (lower.includes("applause") || lower.includes("clap") || lower.includes("ovation") || lower.includes("bravo")) return "applause";
  if (lower.includes("laugh") || lower.includes("lol") || lower.includes("haha") || lower.includes("rofl") || lower.includes("troll") || lower.includes("omg")) return "laughter";
  if (lower.includes("birthday") || lower.includes("cake") || lower.includes("balloon") || lower.includes("candle")) return "birthday";
  if (lower.includes("christmas") || lower.includes("bell") || lower.includes("jingle")) return "bell";
  if (lower.includes("snow") || lower.includes("snowman")) return "snow";
  if (lower.includes("heart")) return "hearts";
  if (lower.includes("kiss") || lower.includes("lipstick")) return "kiss";
  if (lower.includes("flower") || lower.includes("bloom") || lower.includes("sakura") || lower.includes("rose") || lower.includes("petal")) return "flowers";
  if (lower.includes("star") || lower.includes("galaxy") || lower.includes("twinkle") || lower.includes("sky")) return "stars";
  if (lower.includes("thumb") || lower.includes("like") || lower.includes("approval")) return "thumbs";
  if (lower.includes("leprechaun") || lower.includes("shamrock") || lower.includes("lucky") || lower.includes("rainbow") || lower.includes("gold")) return "lucky";
  if (lower.includes("neon") || lower.includes("electric") || lower.includes("energy") || lower.includes("shockwave") || lower.includes("pulse")) return "electric";
  if (lower.includes("confetti") || lower.includes("celebration") || lower.includes("party") || lower.includes("ribbon")) return "confetti";
  if (lower.includes("bingo") || lower.includes("countdown") || lower.includes("ball")) return "bingo";
  if (lower.includes("cash") || lower.includes("money") || lower.includes("win") || lower.includes("jackpot") || lower.includes("casino") || lower.includes("crown") || lower.includes("trophy")) return "win";
  if (lower.includes("diamond") || lower.includes("crystal") || lower.includes("premium") || lower.includes("vip")) return "premium";
  if (lower.includes("thanks") || lower.includes("friend")) return "chimes";
  if (lower.includes("storm") || lower.includes("wind")) return "wind";
  return "chimes";
};

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const hashId = (id) => Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0);

const wavFromStereoData = (data) => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

const makeFallbackWav = (id) => {
  const lower = id.toLowerCase();
  const seed = hashId(id);
  const base = lower.includes("firework") || lower.includes("explosion") || lower.includes("blast") ? 120 : 392 + (seed % 80);
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 4);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    const fade = time > 6 ? Math.max(0, 1 - ((time - 6) / 2)) : 1;
    const hero = Math.exp(-((time - 3) ** 2) / 0.22);
    const intro = Math.min(1, time / 1.7);
    const env = Math.min(1, (0.16 * intro) + (0.34 * hero) + (time > 3 && time < 6 ? 0.2 : 0)) * fade;
    let left = Math.sin(time * Math.PI * 2 * base) * 0.1;
    let right = Math.sin(time * Math.PI * 2 * (base * 1.5)) * 0.08;

    if (lower.includes("firework") || lower.includes("explosion") || lower.includes("blast")) {
      for (const hitTime of [1.45, 2.35, 3, 3.62, 4.45, 5.18]) {
        if (time >= hitTime) {
          const age = time - hitTime;
          const boom = Math.sin(age * Math.PI * 2 * (68 - Math.min(36, age * 18))) * Math.exp(-age * 3.3);
          const crack = (Math.sin(age * 181 + seed) + Math.sin(age * 431 + seed * 0.7)) * Math.exp(-age * 8);
          left += boom * 0.28 + crack * 0.08;
          right += boom * 0.22 + crack * 0.07;
        }
      }
    }

    left = clamp(left * env * 0.72);
    right = clamp(right * env * 0.72);
    data.writeInt16LE(Math.round(left * 32767), sample * 4);
    data.writeInt16LE(Math.round(right * 32767), (sample * 4) + 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

const midiToHz = (note) => 440 * (2 ** ((note - 69) / 12));

const makeBirthdaySongWav = (id) => {
  const seed = hashId(id);
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 4);
  const transpose = seed % 2 === 0 ? 0 : 2;
  const melody = [
    [0.18, 0.32, 60], [0.52, 0.32, 60], [0.88, 0.58, 62], [1.48, 0.58, 60], [2.08, 0.58, 65], [2.68, 0.92, 64],
    [3.38, 0.32, 60], [3.72, 0.32, 60], [4.08, 0.58, 62], [4.68, 0.58, 60], [5.28, 0.58, 67], [5.88, 1.02, 65],
    [6.42, 0.24, 60], [6.7, 0.24, 60], [6.98, 0.46, 72], [7.42, 0.5, 69],
  ];

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    const fade = time > 7.1 ? Math.max(0, 1 - ((time - 7.1) / 0.9)) : 1;
    let left = 0;
    let right = 0;

    for (let index = 0; index < melody.length; index += 1) {
      const [start, duration, midi] = melody[index];
      if (time < start || time > start + duration + 0.42) continue;
      const age = time - start;
      const frequency = midiToHz(midi + transpose);
      const attack = Math.min(1, age / 0.035);
      const decay = Math.exp(-Math.max(0, age - duration) * 5.2);
      const noteEnv = attack * decay * (age <= duration ? 1 : 0.72);
      const bellTone =
        Math.sin(age * Math.PI * 2 * frequency) * 0.18 +
        Math.sin(age * Math.PI * 2 * frequency * 2.01) * 0.055 +
        Math.sin(age * Math.PI * 2 * frequency * 3.02) * 0.018;
      const pan = index % 2 === 0 ? 0.58 : 0.42;
      left += bellTone * noteEnv * pan;
      right += bellTone * noteEnv * (1 - pan);
    }

    const softPad =
      Math.sin(time * Math.PI * 2 * midiToHz(48 + transpose)) * 0.025 +
      Math.sin(time * Math.PI * 2 * midiToHz(55 + transpose)) * 0.02;
    const sparkle = Math.sin(time * Math.PI * 2 * (1320 + Math.sin(time * 2.1) * 30)) * 0.012;
    const body = (0.86 + Math.sin(time * 0.8) * 0.05) * fade;
    left = clamp((left + softPad + sparkle) * body);
    right = clamp((right + softPad - sparkle * 0.7) * body);
    data.writeInt16LE(Math.round(left * 32767), sample * 4);
    data.writeInt16LE(Math.round(right * 32767), (sample * 4) + 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

const makeChristmasSongWav = (id) => {
  const seed = hashId(id);
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 4);
  const transpose = seed % 3 === 0 ? 0 : seed % 3 === 1 ? 2 : -2;
  const melody = [
    [0.14, 0.22, 64], [0.42, 0.22, 64], [0.7, 0.44, 64],
    [1.18, 0.22, 64], [1.46, 0.22, 64], [1.74, 0.44, 64],
    [2.24, 0.24, 64], [2.52, 0.24, 67], [2.8, 0.32, 60], [3.16, 0.24, 62], [3.44, 0.62, 64],
    [4.14, 0.24, 65], [4.42, 0.24, 65], [4.7, 0.3, 65], [5.04, 0.24, 65], [5.32, 0.24, 65], [5.6, 0.3, 64],
    [5.94, 0.24, 64], [6.2, 0.24, 64], [6.48, 0.24, 64], [6.76, 0.28, 62], [7.08, 0.28, 62], [7.4, 0.52, 64],
  ];

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    const fade = time > 7.25 ? Math.max(0, 1 - ((time - 7.25) / 0.75)) : 1;
    let left = 0;
    let right = 0;

    for (let index = 0; index < melody.length; index += 1) {
      const [start, duration, midi] = melody[index];
      if (time < start || time > start + duration + 0.35) continue;
      const age = time - start;
      const frequency = midiToHz(midi + transpose);
      const attack = Math.min(1, age / 0.018);
      const release = Math.exp(-Math.max(0, age - duration) * 7.5);
      const env = attack * release * (age <= duration ? 1 : 0.7);
      const bell =
        Math.sin(age * Math.PI * 2 * frequency) * 0.16 +
        Math.sin(age * Math.PI * 2 * frequency * 2.02) * 0.07 +
        Math.sin(age * Math.PI * 2 * frequency * 3.01) * 0.025;
      const sleigh =
        noiseValue(sample + index * 97, seed) *
        Math.max(0, Math.sin(age * 46 + index)) *
        0.018;
      const pan = index % 2 === 0 ? 0.56 : 0.44;
      left += (bell + sleigh) * env * pan;
      right += (bell - sleigh * 0.5) * env * (1 - pan);
    }

    const warmPad =
      Math.sin(time * Math.PI * 2 * midiToHz(52 + transpose)) * 0.018 +
      Math.sin(time * Math.PI * 2 * midiToHz(59 + transpose)) * 0.014;
    const shimmer =
      Math.sin(time * Math.PI * 2 * (1480 + Math.sin(time * 3.4) * 42)) *
      (0.01 + Math.max(0, Math.sin(time * 8.5)) * 0.007);
    left = clamp((left + warmPad + shimmer) * fade * 0.96);
    right = clamp((right + warmPad - shimmer * 0.55) * fade * 0.96);
    data.writeInt16LE(Math.round(left * 32767), sample * 4);
    data.writeInt16LE(Math.round(right * 32767), (sample * 4) + 2);
  }

  return wavFromStereoData(data);
};

const laughEnvelope = (age, attack = 0.018, decay = 8.5) => {
  if (age < 0) return 0;
  return Math.min(1, age / attack) * Math.exp(-age * decay);
};

const addHaPulse = (time, start, baseFrequency, intensity, seed) => {
  const age = time - start;
  const env = laughEnvelope(age, 0.014, 9.2);
  if (!env) return 0;
  const wobble = 1 + Math.sin(age * 36 + seed) * 0.045;
  return (
    Math.sin(age * Math.PI * 2 * baseFrequency * wobble) * 0.34 +
    Math.sin(age * Math.PI * 2 * baseFrequency * 2.18) * 0.13 +
    Math.sin(age * Math.PI * 2 * baseFrequency * 3.4) * 0.05
  ) * env * intensity;
};

const addComicPop = (time, start, baseFrequency, intensity, seed) => {
  const age = time - start;
  const env = laughEnvelope(age, 0.008, 13);
  if (!env) return 0;
  const pitch = baseFrequency * (1 + age * 2.8);
  return (
    Math.sin(age * Math.PI * 2 * pitch) * 0.24 +
    Math.sin(age * Math.PI * 2 * (pitch * 1.8 + seed % 37)) * 0.08
  ) * env * intensity;
};

const addBoing = (time, start, baseFrequency, intensity, seed) => {
  const age = time - start;
  const env = laughEnvelope(age, 0.02, 4.6);
  if (!env) return 0;
  const pitch = baseFrequency * (1 + Math.sin(age * 18) * 0.22);
  return (
    Math.sin(age * Math.PI * 2 * pitch) * 0.2 +
    Math.sin(age * Math.PI * 2 * (pitch * 0.52)) * 0.12
  ) * env * intensity;
};

const makeComedyLayerWav = (id) => {
  const seed = hashId(id);
  const lower = id.toLowerCase();
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 4);
  const isLol = lower.includes("lol");
  const isEmoji = lower.includes("emoji");
  const isHaha = lower.includes("haha");
  const isRofl = lower.includes("rofl");
  const isFinale = lower.includes("finale");

  const haTimes = isHaha
    ? [0.58, 0.88, 1.18, 1.5, 2.1, 2.38, 2.66, 2.96, 3.8, 4.08, 4.38, 4.7]
    : isEmoji
      ? [0.5, 0.82, 1.22, 1.7, 2.18, 2.64, 3.26, 3.78, 4.24, 4.86]
      : isRofl
        ? [0.78, 1.0, 1.22, 2.55, 2.78, 3.02, 3.28, 4.55, 4.78, 5.0]
        : isFinale
          ? [0.5, 0.78, 1.08, 1.42, 2.12, 2.42, 2.72, 3.32, 3.62, 4.02, 4.32, 4.7, 5.08]
          : [0.72, 1.02, 1.36, 2.5, 2.84, 3.18, 4.42, 4.78];
  const popTimes = isLol
    ? [0.38, 1.9, 3.05, 4.42]
    : isRofl
      ? [0.45, 2.28, 3.6, 4.9]
      : isFinale
        ? [0.34, 1.62, 2.92, 4.18, 5.34]
        : [0.62, 2.02, 3.4, 4.82];
  const boingTimes = isRofl ? [0.38, 1.92, 3.82] : isEmoji ? [1.06, 2.84, 4.52] : isFinale ? [1.16, 3.04, 4.92] : [2.15, 4.95];

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    const fade = time > 6.35 ? Math.max(0, 1 - ((time - 6.35) / 1.65)) : 1;
    const stereoSwing = Math.sin(time * 3.2 + seed) * 0.12;
    let left = 0;
    let right = 0;

    haTimes.forEach((start, index) => {
      const frequency = (isRofl ? 155 : isHaha ? 210 : 250) + ((index + seed) % 4) * 22;
      const value = addHaPulse(time, start, frequency, isHaha ? 0.68 : 0.5, seed + index);
      const pan = index % 2 === 0 ? 0.68 : 0.36;
      left += value * pan;
      right += value * (1 - pan + stereoSwing);
    });

    popTimes.forEach((start, index) => {
      const value = addComicPop(time, start, 420 + index * 70, isLol ? 0.7 : 0.46, seed + index);
      const pan = index % 2 === 0 ? 0.42 : 0.64;
      left += value * pan;
      right += value * (1 - pan);
    });

    boingTimes.forEach((start, index) => {
      const value = addBoing(time, start, isRofl ? 95 : 132 + index * 8, isRofl ? 0.8 : 0.48, seed + index);
      const pan = index % 2 === 0 ? 0.58 : 0.4;
      left += value * pan;
      right += value * (1 - pan);
    });

    const tickle = Math.sin(time * Math.PI * 2 * (900 + Math.sin(time * 7) * 50)) * 0.012 * (isFinale ? 1.2 : 0.8);
    left = clamp((left + tickle) * fade);
    right = clamp((right - tickle * 0.75) * fade);
    data.writeInt16LE(Math.round(left * 32767), sample * 4);
    data.writeInt16LE(Math.round(right * 32767), (sample * 4) + 2);
  }

  return wavFromStereoData(data);
};

const noiseValue = (sample, seed) => {
  const value = Math.sin((sample + 1) * (12.9898 + (seed % 17)) + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

const softHitEnv = (age, attack = 0.012, decay = 7) => {
  if (age < 0) return 0;
  return Math.min(1, age / attack) * Math.exp(-age * decay);
};

const profileEventPlan = (profile, seed) => {
  const offset = (seed % 9) * 0.017;
  const base = {
    applause: [[0.55, "clap"], [1.1, "clap"], [1.7, "clap"], [2.35, "clap"], [3.05, "clap"], [3.7, "clap"], [4.35, "clap"], [5.15, "clap"]],
    bingo: [[0.72, "click"], [1.28, "click"], [1.86, "roll"], [2.52, "click"], [3.05, "jackpot"], [4.15, "spark"], [5.18, "roll"]],
    birthday: [[0.65, "bell"], [1.45, "spark"], [2.25, "pop"], [3.05, "bell"], [4.35, "spark"], [5.4, "pop"]],
    bell: [[0.72, "bell"], [1.62, "bell"], [2.78, "spark"], [3.65, "bell"], [4.78, "spark"]],
    chimes: [[0.6, "spark"], [1.34, "bell"], [2.3, "spark"], [3.2, "bell"], [4.42, "spark"], [5.38, "bell"]],
    confetti: [[0.7, "paper"], [1.18, "paper"], [1.72, "pop"], [2.44, "paper"], [3.1, "spark"], [3.8, "paper"], [4.56, "paper"], [5.22, "pop"]],
    electric: [[0.48, "zap"], [1.2, "zap"], [2.05, "rise"], [2.95, "zap"], [3.75, "spark"], [4.58, "zap"], [5.25, "rise"]],
    fireworks: [[0.82, "fuse"], [1.62, "crackle"], [2.35, "whistle"], [3.08, "crackle"], [3.72, "spark"], [4.42, "crackle"], [5.18, "whistle"]],
    flowers: [[0.72, "wind"], [1.42, "spark"], [2.36, "bell"], [3.08, "spark"], [4.35, "wind"], [5.28, "spark"]],
    hearts: [[0.72, "heart"], [1.52, "spark"], [2.36, "heart"], [3.12, "bell"], [4.42, "heart"], [5.32, "spark"]],
    kiss: [[0.7, "kiss"], [1.6, "spark"], [2.75, "kiss"], [3.42, "pop"], [4.6, "kiss"], [5.45, "spark"]],
    lucky: [[0.65, "coin"], [1.25, "coin"], [2.05, "spark"], [2.95, "coin"], [3.58, "jackpot"], [4.58, "coin"], [5.3, "spark"]],
    neon: [[0.5, "zap"], [1.25, "rise"], [2.12, "zap"], [3.05, "spark"], [4.12, "rise"], [5.0, "zap"]],
    premium: [[0.7, "crystal"], [1.45, "spark"], [2.35, "crystal"], [3.08, "jackpot"], [4.28, "crystal"], [5.18, "spark"]],
    snow: [[0.62, "wind"], [1.38, "ice"], [2.35, "spark"], [3.15, "ice"], [4.42, "wind"], [5.26, "spark"]],
    stars: [[0.58, "spark"], [1.32, "spark"], [2.22, "bell"], [3.02, "spark"], [3.85, "spark"], [4.72, "bell"], [5.44, "spark"]],
    thumbs: [[0.52, "pop"], [1.2, "clap"], [2.0, "pop"], [2.9, "clap"], [3.82, "spark"], [4.7, "pop"]],
    win: [[0.62, "coin"], [1.22, "coin"], [1.85, "roll"], [2.72, "jackpot"], [3.35, "spark"], [4.35, "coin"], [5.2, "bell"]],
    wind: [[0.58, "wind"], [1.8, "rise"], [3.1, "wind"], [4.6, "spark"]],
  }[profile] ?? [[0.72, "spark"], [2.2, "bell"], [3.25, "spark"], [5.0, "spark"]];
  return base.map(([time, type], index) => [time + offset + ((index % 3) * 0.011), type]);
};

const toneForEvent = (type, seed, index) => {
  const spread = (seed + index * 23) % 90;
  return {
    bell: 840 + spread,
    clap: 240 + spread,
    click: 520 + spread,
    coin: 1180 + spread,
    crackle: 2600 + spread * 5,
    crystal: 1440 + spread * 2,
    fuse: 2100 + spread * 3,
    heart: 420 + spread,
    ice: 1760 + spread * 2,
    jackpot: 660 + spread,
    kiss: 620 + spread,
    paper: 1450 + spread * 2,
    pop: 760 + spread,
    rise: 360 + spread,
    roll: 180 + spread,
    spark: 1320 + spread * 3,
    whistle: 980 + spread * 2,
    wind: 310 + spread,
    zap: 740 + spread * 2,
  }[type] ?? 1200;
};

const eventSample = (time, sample, start, type, seed, index) => {
  const age = time - start;
  if (age < 0 || age > 1.45) return 0;
  const f = toneForEvent(type, seed, index);
  const n = noiseValue(sample + index * 311, seed);

  if (type === "clap") {
    return n * softHitEnv(age, 0.003, 18) * 0.33;
  }
  if (type === "paper") {
    return (n * 0.16 + Math.sin(age * Math.PI * 2 * f) * 0.045) * softHitEnv(age, 0.006, 9);
  }
  if (type === "crackle" || type === "fuse") {
    const gate = Math.max(0, Math.sin(age * 70 + seed + index));
    return (n * 0.18 * gate + Math.sin(age * Math.PI * 2 * f) * 0.03) * softHitEnv(age, 0.005, type === "fuse" ? 5.6 : 9.5);
  }
  if (type === "whistle" || type === "rise") {
    const pitch = f + age * (type === "whistle" ? 560 : 280);
    return Math.sin(age * Math.PI * 2 * pitch) * softHitEnv(age, 0.04, 3.3) * 0.12;
  }
  if (type === "wind") {
    return (n * 0.08 + Math.sin(age * Math.PI * 2 * f * 0.32) * 0.05) * softHitEnv(age, 0.09, 2.2);
  }
  if (type === "roll") {
    return (n * 0.09 + Math.sin(age * Math.PI * 2 * (f + Math.sin(age * 18) * 80)) * 0.06) * softHitEnv(age, 0.018, 4.3);
  }
  if (type === "jackpot") {
    return (
      Math.sin(age * Math.PI * 2 * f) * 0.15 +
      Math.sin(age * Math.PI * 2 * f * 1.5) * 0.08 +
      Math.sin(age * Math.PI * 2 * f * 2) * 0.04
    ) * softHitEnv(age, 0.018, 3.8);
  }
  if (type === "kiss") {
    return (Math.sin(age * Math.PI * 2 * f) * 0.09 + n * 0.035) * softHitEnv(age, 0.025, 5.8);
  }
  if (type === "heart") {
    return (
      Math.sin(age * Math.PI * 2 * f) * 0.11 +
      Math.sin(age * Math.PI * 2 * f * 1.26) * 0.055
    ) * softHitEnv(age, 0.022, 4.8);
  }

  return (
    Math.sin(age * Math.PI * 2 * f) * 0.12 +
    Math.sin(age * Math.PI * 2 * f * 2.01) * 0.045 +
    n * 0.018
  ) * softHitEnv(age, 0.012, 6.4);
};

const makeProfileAccentWav = (id, profile) => {
  const seed = hashId(id);
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 4);
  const events = profileEventPlan(profile, seed);
  const profileGain = {
    applause: 0.72,
    bingo: 0.78,
    birthday: 0.58,
    bell: 0.56,
    confetti: 0.62,
    electric: 0.66,
    fireworks: 0.5,
    flowers: 0.46,
    hearts: 0.5,
    kiss: 0.5,
    lucky: 0.72,
    premium: 0.66,
    snow: 0.46,
    stars: 0.54,
    thumbs: 0.64,
    win: 0.76,
  }[profile] ?? 0.54;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    const fade = time > 6.35 ? Math.max(0, 1 - ((time - 6.35) / 1.65)) : 1;
    let left = 0;
    let right = 0;

    events.forEach(([start, type], index) => {
      const value = eventSample(time, sample, start, type, seed, index);
      const pan = 0.5 + Math.sin(seed + index * 1.7) * 0.24;
      left += value * pan;
      right += value * (1 - pan);
    });

    const bed =
      profile === "fireworks"
        ? noiseValue(sample, seed) * 0.012 * Math.max(0, Math.sin(time * 9))
        : profile === "flowers" || profile === "snow"
          ? noiseValue(sample, seed) * 0.01 + Math.sin(time * Math.PI * 2 * (210 + (seed % 30))) * 0.012
          : 0;
    left = clamp((left + bed) * fade * profileGain);
    right = clamp((right + bed * 0.8) * fade * profileGain);
    data.writeInt16LE(Math.round(left * 32767), sample * 4);
    data.writeInt16LE(Math.round(right * 32767), (sample * 4) + 2);
  }

  return wavFromStereoData(data);
};

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit" });
  child.on("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited with ${code}`));
  });
});

const renderFromRealSource = async ({ sourcePath, id, outputPath }) => {
  const seed = hashId(id);
  const profile = soundProfile(id);
  const accentPath = outputPath.replace(".mp3", ".accent.wav");
  await fs.writeFile(accentPath, makeProfileAccentWav(id, profile));
  const sourceVolume = {
    applause: "0.68",
    bell: "0.58",
    bingo: "0.38",
    birthday: "0.44",
    cash: "0.42",
    casino: "0.4",
    chimes: "0.48",
    confetti: "0.34",
    electric: "0.38",
    fireworks: "0.24",
    flowers: "0.46",
    hearts: "0.44",
    kiss: "0.42",
    lucky: "0.38",
    neon: "0.36",
    premium: "0.42",
    snow: "0.4",
    stars: "0.5",
    thumbs: "0.54",
    win: "0.42",
    wind: "0.42",
  }[profile] ?? "0.48";
  const accentVolume = {
    fireworks: "1.16",
    bingo: "0.98",
    confetti: "0.95",
    electric: "0.92",
    lucky: "0.9",
    win: "0.95",
    applause: "0.72",
  }[profile] ?? "0.82";
  const sourceTone = profile === "fireworks"
    ? "highpass=f=520,lowpass=f=7600,acompressor=threshold=-18dB:ratio=2.5:attack=8:release=120"
    : profile === "cash" || profile === "bingo" || profile === "win" || profile === "lucky"
      ? "highpass=f=110,lowpass=f=9000"
      : profile === "applause"
        ? "highpass=f=130,lowpass=f=8500"
        : "highpass=f=90,lowpass=f=10500";
  const filter = [
    `[0:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,aloop=loop=-1:size=${sampleRate * durationSeconds},atrim=0:${durationSeconds},asetpts=N/SR/TB,${sourceTone},volume=${sourceVolume},afade=t=in:st=0:d=0.12,afade=t=out:st=6.4:d=1.6[src]`,
    `[1:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,volume=${accentVolume},afade=t=out:st=6.35:d=1.65[accent]`,
    `[src][accent]amix=inputs=2:duration=longest:normalize=0,atrim=0:${durationSeconds},alimiter=limit=0.92[out]`,
  ].join(";");

  try {
    await run(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-i",
      accentPath,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath,
    ]);
  } finally {
    await fs.rm(accentPath, { force: true });
  }
};

const renderLaughterVariant = async ({ sourcePath, id, outputPath }) => {
  const wavPath = outputPath.replace(".mp3", ".comedy-layer.wav");
  await fs.writeFile(wavPath, makeComedyLayerWav(id));
  const lower = id.toLowerCase();
  const realVolume = lower.includes("emoji") ? "0.62" : lower.includes("rofl") ? "0.56" : "0.52";
  const comedyVolume = lower.includes("haha") ? "1.05" : lower.includes("finale") ? "0.98" : "0.9";
  const filter = [
    `[0:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,aloop=loop=-1:size=${sampleRate * durationSeconds},atrim=0:${durationSeconds},asetpts=N/SR/TB,volume=${realVolume},afade=t=in:st=0:d=0.08,afade=t=out:st=6.45:d=1.55[real]`,
    `[1:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,volume=${comedyVolume},afade=t=out:st=6.35:d=1.65[comic]`,
    `[real][comic]amix=inputs=2:duration=longest:normalize=0,atrim=0:${durationSeconds},alimiter=limit=0.92[out]`,
  ].join(";");

  try {
    await run(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-i",
      wavPath,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath,
    ]);
  } finally {
    await fs.rm(wavPath, { force: true });
  }
};

const renderFallback = async ({ id, outputPath }) => {
  const wavPath = outputPath.replace(".mp3", ".wav");
  await fs.writeFile(wavPath, makeProfileAccentWav(id, soundProfile(id)));
  await run(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "128k", outputPath]);
  await fs.rm(wavPath, { force: true });
};

const renderBirthdaySong = async ({ id, outputPath }) => {
  const wavPath = outputPath.replace(".mp3", ".wav");
  await fs.writeFile(wavPath, makeBirthdaySongWav(id));
  await run(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "128k", outputPath]);
  await fs.rm(wavPath, { force: true });
};

const renderChristmasSong = async ({ id, outputPath }) => {
  const wavPath = outputPath.replace(".mp3", ".wav");
  await fs.writeFile(wavPath, makeChristmasSongWav(id));
  await run(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "128k", outputPath]);
  await fs.rm(wavPath, { force: true });
};

await fs.mkdir(audioDir, { recursive: true });

const winkFiles = await fs.readdir(winkDir);
const originalIds = winkFiles
  .filter((fileName) => fileName.endsWith(".json"))
  .map((fileName) => fileName.replace(".json", ""))
  .filter((id) => !id.endsWith("-sound") && !skipSpecialSoundIds.has(id))
  .sort();

let realCount = 0;
let fallbackCount = 0;

for (const id of originalIds) {
  await fs.copyFile(path.join(winkDir, `${id}.json`), path.join(winkDir, `${id}-sound.json`));
  await fs.copyFile(path.join(previewDir, `${id}.png`), path.join(previewDir, `${id}-sound.png`));

  const outputPath = path.join(audioDir, `${id}-sound.mp3`);
  const profile = soundProfile(id);
  const sourcePath = await sourcePathFor(profile);

  if (profile === "birthday-song") {
    await renderBirthdaySong({ id, outputPath });
    realCount += 1;
  } else if (profile === "christmas-song") {
    await renderChristmasSong({ id, outputPath });
    realCount += 1;
  } else if (laughterVariantIds.has(id) && sourcePath) {
    await renderLaughterVariant({ sourcePath, id, outputPath });
    realCount += 1;
  } else if (sourcePath) {
    await renderFromRealSource({ sourcePath, id, outputPath });
    realCount += 1;
  } else {
    await renderFallback({ id, outputPath });
    fallbackCount += 1;
  }
}

console.log(`Generated ${originalIds.length} fullscreen sound experience copies (${realCount} real-source, ${fallbackCount} fallback).`);
