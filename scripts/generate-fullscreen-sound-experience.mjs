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
  fireworks: ["fireworks.mp3", "fireworks.ogg"],
  cash: ["cash-register.mp3", "cash-register.ogg"],
  chimes: ["windchimes.mp3", "windchimes.ogg"],
  wind: ["howling-wind.mp3", "howling-wind.ogg", "windchimes.mp3"],
  bell: ["bell.wav", "bell.mp3"],
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
  if (lower.includes("applause") || lower.includes("clap") || lower.includes("ovation") || lower.includes("bravo")) return "applause";
  if (lower.includes("laugh") || lower.includes("lol") || lower.includes("haha") || lower.includes("rofl") || lower.includes("troll") || lower.includes("omg")) return "laughter";
  if (lower.includes("firework") || lower.includes("explosion") || lower.includes("blast") || lower.includes("detonation")) return "fireworks";
  if (lower.includes("cash") || lower.includes("money") || lower.includes("win") || lower.includes("jackpot") || lower.includes("casino") || lower.includes("bingo")) return "cash";
  if (lower.includes("christmas") || lower.includes("bell") || lower.includes("birthday") || lower.includes("thanks")) return "bell";
  if (lower.includes("snow") || lower.includes("storm") || lower.includes("wind") || lower.includes("neon") || lower.includes("energy")) return "wind";
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
  const volume = profile === "applause" ? "0.82" : profile === "laughter" ? "0.78" : "0.74";
  const filter = [
    "aresample=44100",
    "aformat=sample_fmts=s16:channel_layouts=stereo",
    `aloop=loop=-1:size=${sampleRate * durationSeconds}`,
    `atrim=0:${durationSeconds}`,
    "asetpts=N/SR/TB",
    `volume=${volume}`,
    "afade=t=in:st=0:d=0.12",
    "afade=t=out:st=6.4:d=1.6",
    "alimiter=limit=0.92",
  ].join(",");

  await run(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    sourcePath,
    "-filter:a",
    filter,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath,
  ]);
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
  await fs.writeFile(wavPath, makeFallbackWav(id));
  await run(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "128k", outputPath]);
  await fs.rm(wavPath, { force: true });
};

const renderBirthdaySong = async ({ id, outputPath }) => {
  const wavPath = outputPath.replace(".mp3", ".wav");
  await fs.writeFile(wavPath, makeBirthdaySongWav(id));
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
