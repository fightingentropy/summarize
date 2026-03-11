import { describe, expect, it } from "vitest";
import {
  buildVisionOcrArgs,
  cleanOcrText,
  estimateOcrConfidence,
  resolveVisionOcrRuntimeOptions,
} from "../src/slides/ocr.js";

describe("slides ocr helpers", () => {
  it("cleans noisy lines and keeps readable content", () => {
    expect(
      cleanOcrText(
        [
          "A",
          "Readable title",
          "SUPERCALIFRAGILISTICEXPIALIDOCIOUS",
          "###",
          "second line 123",
        ].join("\n"),
      ),
    ).toBe("Readable title\nsecond line 123");
  });

  it("estimates confidence from alphanumeric density", () => {
    expect(estimateOcrConfidence("")).toBe(0);
    expect(estimateOcrConfidence("abc123")).toBe(1);
    expect(estimateOcrConfidence("abc!!!")).toBeCloseTo(0.5, 2);
  });

  it("uses Raycast-style fast Vision OCR defaults on Apple Silicon", () => {
    expect(resolveVisionOcrRuntimeOptions({ platform: "darwin", arch: "arm64" })).toEqual({
      recognitionLevel: "fast",
      useLanguageCorrection: false,
    });
    expect(
      buildVisionOcrArgs(
        "/tmp/slide.png",
        resolveVisionOcrRuntimeOptions({ platform: "darwin", arch: "arm64" }),
      ),
    ).toEqual([
      "--image-path",
      "/tmp/slide.png",
      "--recognition-level",
      "fast",
      "--disable-language-correction",
    ]);
  });

  it("keeps accurate Vision OCR defaults off the Apple Silicon fast path", () => {
    expect(resolveVisionOcrRuntimeOptions({ platform: "darwin", arch: "x64" })).toEqual({
      recognitionLevel: "accurate",
      useLanguageCorrection: true,
    });
    expect(
      buildVisionOcrArgs(
        "/tmp/slide.png",
        resolveVisionOcrRuntimeOptions({ platform: "darwin", arch: "x64" }),
      ),
    ).toEqual(["--image-path", "/tmp/slide.png"]);
  });

  it("allows explicit Vision OCR overrides from config/runtime", () => {
    expect(
      resolveVisionOcrRuntimeOptions({
        platform: "darwin",
        arch: "arm64",
        recognitionLevel: "accurate",
        useLanguageCorrection: true,
      }),
    ).toEqual({
      recognitionLevel: "accurate",
      useLanguageCorrection: true,
    });
    expect(
      buildVisionOcrArgs(
        "/tmp/slide.png",
        resolveVisionOcrRuntimeOptions({
          platform: "darwin",
          arch: "x64",
          recognitionLevel: "fast",
          useLanguageCorrection: false,
        }),
      ),
    ).toEqual([
      "--image-path",
      "/tmp/slide.png",
      "--recognition-level",
      "fast",
      "--disable-language-correction",
    ]);
  });
});
