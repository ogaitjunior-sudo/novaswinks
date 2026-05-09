import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chatWinks, fullscreenWinks } from "@/lib/winks";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(testDir, "../..");

const decodeAlphaSummary = async (absolutePath: string) => {
  const UPNGModule = await import("upng-js");
  const UPNG = UPNGModule.default as {
    decode: (buffer: Buffer) => unknown;
    toRGBA8: (image: unknown) => ArrayBuffer[];
  };

  const buffer = await readFile(absolutePath);
  const image = UPNG.decode(buffer);
  const rgba = new Uint8Array(UPNG.toRGBA8(image)[0]);
  let transparent = 0;
  let visible = 0;

  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] === 0) transparent += 1;
    if (rgba[index] > 0) visible += 1;
  }

  return { transparent, visible };
};

const findChunkTypes = (buffer: Buffer) => {
  const types: string[] = [];
  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    types.push(type);
    offset += 12 + length;
    if (type === "IEND") {
      break;
    }
  }

  return types;
};

describe("wink assets", () => {
  it("ships real APNG files for the active chat effects", async () => {
    const chatFiles = chatWinks.map((asset) => path.basename(asset.filePath));

    for (const file of chatFiles) {
      const absolutePath = path.join(workspaceRoot, "public", "winks", "chat", file);
      const buffer = await readFile(absolutePath);
      const chunkTypes = findChunkTypes(buffer);
      expect(chunkTypes).toContain("acTL");
      expect(chunkTypes).toContain("fcTL");

      const alphaSummary = await decodeAlphaSummary(absolutePath);
      expect(alphaSummary.transparent).toBeGreaterThan(0);
      expect(alphaSummary.visible).toBeGreaterThan(0);
    }
  }, 180000);

  it("ships animated lottie json files for the fullscreen effects", async () => {
    const fullscreenFiles = fullscreenWinks.map((asset) => path.basename(asset.filePath));
    expect(fullscreenFiles.length).toBeGreaterThan(0);

    for (const file of fullscreenFiles) {
      const raw = await readFile(path.join(workspaceRoot, "public", "winks", "fullscreen", file), "utf8");
      const animation = JSON.parse(raw) as {
        ip: number;
        op: number;
        layers?: Array<{
          ks?: Record<string, { a?: number; k?: Array<{ i?: unknown; o?: unknown; e?: unknown }> }>;
        }>;
      };
      expect(animation.op).toBeGreaterThan(animation.ip);
      expect(animation.layers?.some((layer) => layer.ks?.o?.a === 1 || layer.ks?.s?.a === 1)).toBe(true);

      for (const layer of animation.layers ?? []) {
        for (const property of Object.values(layer.ks ?? {})) {
          if (property?.a !== 1 || !Array.isArray(property.k)) {
            continue;
          }

          for (const keyframe of property.k.slice(0, -1)) {
            expect(keyframe.i).toBeTruthy();
            expect(keyframe.o).toBeTruthy();
            expect(keyframe.e).toBeTruthy();
          }
        }
      }
    }
  });

  it("ships only the active fullscreen output files for the rebuilt collection", async () => {
    expect(fullscreenWinks.length).toBeGreaterThan(0);

    const fullscreenFiles = await readdir(path.join(workspaceRoot, "public", "winks", "fullscreen"));
    const fullscreenPreviews = await readdir(path.join(workspaceRoot, "public", "previews", "fullscreen"));
    const expectedFullscreenFiles = fullscreenWinks.map((asset) => path.basename(asset.filePath)).sort();
    const expectedFullscreenPreviews = fullscreenWinks.map((asset) => path.basename(asset.previewPath)).sort();

    expect(fullscreenFiles.sort()).toEqual(expectedFullscreenFiles);
    expect(fullscreenPreviews.sort()).toEqual(expectedFullscreenPreviews);
  });

  it("ships transparent preview pngs for the active wink cards", async () => {
    const previewFiles = [...chatWinks, ...fullscreenWinks].map((asset) => asset.previewPath.replace(/^\//, ""));

    for (const file of previewFiles) {
      const absolutePath = path.join(workspaceRoot, "public", file);
      const alphaSummary = await decodeAlphaSummary(absolutePath);
      expect(alphaSummary.transparent).toBeGreaterThan(0);
      expect(alphaSummary.visible).toBeGreaterThan(0);
    }
  }, 25000);
});
