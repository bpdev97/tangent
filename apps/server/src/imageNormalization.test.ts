import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  hasHeifSignature,
  ImageNormalizationError,
  normalizeUploadedImage,
} from "./imageNormalization.ts";
import { HEIC_FIXTURE_BASE64 } from "./testFixtures/heic.ts";

describe("image normalization", () => {
  it("detects HEIF-family ISO BMFF images without relying on declared MIME type", () => {
    const heic = Buffer.from(HEIC_FIXTURE_BASE64, "base64");

    expect(hasHeifSignature(heic)).toBe(true);
    expect(hasHeifSignature(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    expect(hasHeifSignature(Buffer.from("000000206674797061766966", "hex"))).toBe(false);
  });

  it.effect("passes other image formats through unchanged", () =>
    Effect.gen(function* () {
      const bytes = Buffer.from([0xff, 0xd8, 0xff]);

      const result = yield* normalizeUploadedImage({
        bytes,
        mimeType: "IMAGE/JPEG",
        name: "photo.jpeg",
      });

      expect(result).toEqual({
        bytes,
        mimeType: "image/jpeg",
        name: "photo.jpeg",
      });
    }),
  );

  it.effect("converts HEIC bytes to bounded JPEG bytes and canonical metadata", () =>
    Effect.gen(function* () {
      const result = yield* normalizeUploadedImage({
        bytes: Buffer.from(HEIC_FIXTURE_BASE64, "base64"),
        mimeType: "application/octet-stream",
        name: "camera-original.heic",
      });

      expect(result.mimeType).toBe("image/jpeg");
      expect(result.name).toBe("camera-original.jpg");
      expect(result.bytes.slice(0, 3)).toEqual(Uint8Array.from([0xff, 0xd8, 0xff]));
      expect(result.bytes.byteLength).toBeGreaterThan(0);
      expect(result.bytes.byteLength).toBeLessThanOrEqual(10 * 1024 * 1024);
    }),
  );

  it.effect("rejects invalid bytes declared as HEIC with a controlled error", () =>
    Effect.gen(function* () {
      const error = yield* normalizeUploadedImage({
        bytes: Buffer.from("not a HEIC image"),
        mimeType: "image/heic",
        name: "broken.heic",
      }).pipe(Effect.flip);

      expect(error).toEqual(
        expect.objectContaining<ImageNormalizationError>({
          name: "ImageNormalizationError",
          message: "HEIC/HEIF image could not be decoded.",
          code: "decode",
        }),
      );
    }),
  );
});
