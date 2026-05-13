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
  const intro = Math.min(1, time / 1.8);
  const fade = time > 6 ? Math.max(0, 1 - ((time - 6) / 2)) : 1;
  const bloom = Math.exp(-((time - 3) ** 2) / 0.24) * 0.46;
  const sustain = time > 3 && time < 6 ? 0.34 : 0;
  return Math.min(1, ((0.24 * intro) + bloom + sustain) * fade);
};

const makeWav = (frequencies, gain) => {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 2);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    let value = 0;

    for (let index = 0; index < frequencies.length; index += 1) {
      const frequency = frequencies[index];
      const drift = 1 + (Math.sin(time * 0.9 + index) * 0.004);
      value += Math.sin(time * Math.PI * 2 * frequency * drift) * (0.18 / (index + 1));
      value += Math.sin(time * Math.PI * 2 * (frequency * 1.5) * drift) * (0.04 / (index + 1));
    }

    const wind = (Math.sin(time * Math.PI * 2 * 92) + Math.sin(time * Math.PI * 2 * 137)) * 0.035 * (0.65 + Math.sin(time * 0.7) * 0.35);
    const shimmer = Math.sin(time * Math.PI * 2 * (1420 + Math.sin(time * 2.2) * 28)) * 0.035;
    const sparkles = [0.42, 1.15, 1.9, 2.55, 3, 3.8, 4.55, 5.35].reduce((sum, hitTime, index) => {
      const decay = Math.exp(-Math.max(0, time - hitTime) * 7);
      return time >= hitTime ? sum + (Math.sin(time * Math.PI * 2 * (980 + index * 120)) * decay * 0.095) : sum;
    }, 0);

    value = clamp((value + wind + shimmer + sparkles) * envelope(time) * gain);
    data.writeInt16LE(Math.round(value * 32767), sample * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
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
