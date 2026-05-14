import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "public", "audio", "flowers");
const sampleRate = 44100;
const durationSeconds = 8;

const sounds = [
  ["trh-full-petal-storm-bloom-sound.mp3", [392, 587.33, 783.99], 0.52],
  ["trh-full-sakura-jackpot-blossom-sound.mp3", [440, 659.25, 880], 0.48],
  ["trh-full-rose-swirl-reveal-sound.mp3", [349.23, 523.25, 698.46], 0.5],
  ["trh-full-floral-heart-bloom-sound.mp3", [415.3, 622.25, 830.61], 0.5],
  ["trh-full-bloom-burst-finale-sound.mp3", [493.88, 739.99, 987.77], 0.56],
];

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));

const envelope = (time) => {
  const intro = Math.min(1, time / 2.2);
  const fade = time > 6 ? Math.max(0, 1 - ((time - 6) / 2)) : 1;
  const bloom = Math.exp(-((time - 3) ** 2) / 0.38) * 0.34;
  const sustain = time > 3 && time < 6 ? 0.26 : 0;
  return Math.min(1, ((0.18 * intro) + bloom + sustain) * fade);
};

const smoothNoise = (seed, time) => (
  Math.sin(time * 1.7 + seed) +
  Math.sin(time * 2.9 + seed * 1.8) * 0.55 +
  Math.sin(time * 4.1 + seed * 2.6) * 0.28
) / 1.83;

const makeWav = (frequencies, gain) => {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 4);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    let left = 0;
    let right = 0;

    for (let index = 0; index < frequencies.length; index += 1) {
      const frequency = frequencies[index];
      const drift = 1 + (Math.sin(time * 0.9 + index) * 0.004);
      const pan = index % 2 === 0 ? 0.58 : 0.42;
      const tone = Math.sin(time * Math.PI * 2 * frequency * drift) * (0.14 / (index + 1));
      const overtone = Math.sin(time * Math.PI * 2 * (frequency * 1.5) * drift) * (0.026 / (index + 1));
      left += (tone + overtone) * pan;
      right += (tone + overtone) * (1 - pan);
    }

    const wind = smoothNoise(1.8, time) * 0.05 * (0.55 + Math.sin(time * 0.6) * 0.25);
    const shimmer = Math.sin(time * Math.PI * 2 * (1180 + Math.sin(time * 1.7) * 22)) * 0.018;
    const sparkles = [0.42, 1.15, 1.9, 2.55, 3, 3.8, 4.55, 5.35].reduce((sum, hitTime, index) => {
      const decay = Math.exp(-Math.max(0, time - hitTime) * 5.8);
      return time >= hitTime ? sum + (Math.sin(time * Math.PI * 2 * (860 + index * 85)) * decay * 0.052) : sum;
    }, 0);

    left = clamp((left + wind + shimmer + sparkles) * envelope(time) * gain);
    right = clamp((right + (wind * 0.86) - shimmer + (sparkles * 0.78)) * envelope(time) * gain);
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

await fs.mkdir(outDir, { recursive: true });

for (const [fileName, frequencies, gain] of sounds) {
  const wavPath = path.join(outDir, fileName.replace(".mp3", ".wav"));
  const mp3Path = path.join(outDir, fileName);
  await fs.writeFile(wavPath, makeWav(frequencies, gain));
  await runFfmpeg(wavPath, mp3Path);
  await fs.rm(wavPath, { force: true });
}

console.log(`Generated ${sounds.length} flower sound MP3 files.`);
