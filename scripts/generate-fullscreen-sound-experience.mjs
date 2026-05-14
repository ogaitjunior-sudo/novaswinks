import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const rootDir = process.cwd();
const winkDir = path.join(rootDir, "public", "winks", "fullscreen");
const previewDir = path.join(rootDir, "public", "previews", "fullscreen");
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

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));

const hashId = (id) => Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0);

const soundProfile = (id) => {
  const lower = id.toLowerCase();
  if (lower.includes("firework") || lower.includes("explosion") || lower.includes("blast") || lower.includes("detonation")) {
    return { base: 330, color: 0.8, hit: 0.46, shimmer: 0.13, ambience: 0.035 };
  }
  if (lower.includes("bingo") || lower.includes("win") || lower.includes("jackpot") || lower.includes("premium")) {
    return { base: 392, color: 0.72, hit: 0.42, shimmer: 0.12, ambience: 0.03 };
  }
  if (lower.includes("heart") || lower.includes("kiss") || lower.includes("thanks") || lower.includes("friend")) {
    return { base: 440, color: 0.54, hit: 0.28, shimmer: 0.085, ambience: 0.045 };
  }
  if (lower.includes("christmas") || lower.includes("snow") || lower.includes("birthday")) {
    return { base: 523.25, color: 0.58, hit: 0.32, shimmer: 0.095, ambience: 0.045 };
  }
  if (lower.includes("neon") || lower.includes("electric") || lower.includes("energy")) {
    return { base: 261.63, color: 0.68, hit: 0.36, shimmer: 0.11, ambience: 0.04 };
  }
  return { base: 369.99, color: 0.62, hit: 0.34, shimmer: 0.1, ambience: 0.04 };
};

const envelope = (time) => {
  const intro = Math.min(1, time / 1.9);
  const fade = time > 6 ? Math.max(0, 1 - ((time - 6) / 2)) : 1;
  const hero = Math.exp(-((time - 3) ** 2) / 0.22);
  const sustain = time > 3 && time < 6 ? 0.22 : 0;
  return Math.min(1, ((0.18 * intro) + (0.36 * hero) + sustain) * fade);
};

const smoothNoise = (seed, time) => (
  Math.sin(time * 1.3 + seed) +
  Math.sin(time * 2.1 + seed * 1.7) * 0.6 +
  Math.sin(time * 3.8 + seed * 2.3) * 0.32
) / 1.92;

const makeWav = (id) => {
  const profile = soundProfile(id);
  const seed = hashId(id);
  const chordShift = (seed % 7) * 6;
  const frequencies = [
    profile.base + chordShift,
    (profile.base * 1.5) + chordShift,
    (profile.base * 2) + chordShift,
  ];
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 4);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    let left = 0;
    let right = 0;

    for (let index = 0; index < frequencies.length; index += 1) {
      const frequency = frequencies[index];
      const drift = 1 + Math.sin(time * (0.8 + index * 0.18) + seed) * 0.004;
      const tone = Math.sin(time * Math.PI * 2 * frequency * drift) * (0.115 / (index + 1));
      const overtone = Math.sin(time * Math.PI * 2 * frequency * 2.01) * (0.018 / (index + 1));
      const pan = index % 2 === 0 ? 0.62 : 0.38;
      left += (tone + overtone) * pan;
      right += (tone + overtone) * (1 - pan);
    }

    const softAir = smoothNoise(seed * 0.017, time) * profile.ambience;
    const shimmer = Math.sin(time * Math.PI * 2 * (1050 + (seed % 260) + Math.sin(time * 2.4) * 44)) * profile.shimmer * 0.16;
    const hitTimes = [0.45, 1.15, 1.85, 2.45, 3, 3.32, 4.25, 5.3];
    const sparkles = hitTimes.reduce((sum, hitTime, index) => {
      const decay = Math.exp(-Math.max(0, time - hitTime) * 6.2);
      return time >= hitTime
        ? sum + Math.sin(time * Math.PI * 2 * (780 + (seed % 180) + index * 95)) * decay * profile.hit * 0.16
        : sum;
    }, 0);

    const body = envelope(time) * profile.color * 0.58;
    left = clamp((left + softAir + shimmer + sparkles) * body);
    right = clamp((right + (softAir * 0.86) - (shimmer * 0.68) + (sparkles * 0.78)) * body);
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

const runFfmpeg = (input, output) => new Promise((resolve, reject) => {
  const child = spawn(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-codec:a", "libmp3lame", "-b:a", "128k", output], {
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`ffmpeg exited with ${code}`));
  });
});

await fs.mkdir(audioDir, { recursive: true });

const winkFiles = await fs.readdir(winkDir);
const originalIds = winkFiles
  .filter((fileName) => fileName.endsWith(".json"))
  .map((fileName) => fileName.replace(".json", ""))
  .filter((id) => !id.endsWith("-sound") && !skipSpecialSoundIds.has(id))
  .sort();

for (const id of originalIds) {
  await fs.copyFile(path.join(winkDir, `${id}.json`), path.join(winkDir, `${id}-sound.json`));
  await fs.copyFile(path.join(previewDir, `${id}.png`), path.join(previewDir, `${id}-sound.png`));

  const wavPath = path.join(audioDir, `${id}-sound.wav`);
  const mp3Path = path.join(audioDir, `${id}-sound.mp3`);
  await fs.writeFile(wavPath, makeWav(id));
  await runFfmpeg(wavPath, mp3Path);
  await fs.rm(wavPath, { force: true });
}

console.log(`Generated ${originalIds.length} fullscreen sound experience copies.`);
