import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "public", "audio", "stars");
const sampleRate = 44100;
const durationSeconds = 8;

const sounds = [
  ["trh-full-gold-star-jackpot-rain-sound.mp3", [880, 1320, 1760], 0.72],
  ["trh-full-mega-star-explosion-sound.mp3", [660, 990, 1480, 2200], 0.88],
  ["trh-full-golden-galaxy-spiral-sound.mp3", [520, 780, 1040, 1560], 0.78],
  ["trh-full-star-flash-reward-sound.mp3", [980, 1470, 1960, 2480], 0.82],
  ["trh-full-golden-star-finale-sound.mp3", [740, 1110, 1660, 2220], 0.9],
];

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));

const envelope = (time) => {
  const intro = Math.min(1, time / 1.7);
  const fade = time > 6 ? Math.max(0, 1 - ((time - 6) / 2)) : 1;
  const hit = Math.exp(-((time - 3) ** 2) / 0.16) * 0.48;
  const sustain = time > 3 && time < 6 ? 0.28 : 0;
  return Math.min(1, ((0.2 * intro) + sustain + hit) * fade);
};

const makeWav = (frequencies, gain) => {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(sampleCount * 4);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate;
    let left = 0;
    let right = 0;
    for (let index = 0; index < frequencies.length; index += 1) {
      const frequency = frequencies[index];
      const shimmer = 1 + (Math.sin(time * 2.7 + index) * 0.005);
      const pan = index % 2 === 0 ? 0.62 : 0.38;
      const tone = Math.sin(time * Math.PI * 2 * frequency * shimmer) * (0.16 / (index + 1));
      const overtone = Math.sin(time * Math.PI * 2 * (frequency * 2.01)) * (0.022 / (index + 1));
      left += (tone + overtone) * pan;
      right += (tone + overtone) * (1 - pan);
    }
    const twinkle = Math.sin(time * Math.PI * 2 * (1900 + (Math.sin(time * 3.6) * 64))) * (0.035 + (0.018 * Math.sin(time * 12)));
    const sparkleHits = [0.25, 0.8, 1.35, 2.05, 3, 3.18, 4.2, 5.1].reduce((sum, hitTime, index) => {
      const decay = Math.exp(-Math.max(0, time - hitTime) * 7);
      return time >= hitTime ? sum + (Math.sin(time * Math.PI * 2 * (1450 + (index * 110))) * decay * 0.09) : sum;
    }, 0);
    left = clamp((left + twinkle + sparkleHits) * envelope(time) * gain * 0.58);
    right = clamp((right - (twinkle * 0.72) + (sparkleHits * 0.82)) * envelope(time) * gain * 0.58);
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

console.log(`Generated ${sounds.length} star sound MP3 files.`);
