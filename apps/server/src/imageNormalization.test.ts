import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  hasHeifSignature,
  ImageNormalizationError,
  normalizeUploadedImage,
} from "./imageNormalization.ts";
import { HEIC_FIXTURE_BASE64 } from "./testFixtures/heic.ts";
import { attachmentRelativePath } from "./attachmentStore.ts";

describe("image normalization", () => {
  it("detects HEIF-family ISO BMFF images without relying on declared MIME type", () => {
    const heic = Buffer.from(HEIC_FIXTURE_BASE64, "base64");

    expect(hasHeifSignature(heic)).toBe(true);
    expect(hasHeifSignature(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    expect(hasHeifSignature(Buffer.from("000000206674797061766966", "hex"))).toBe(false);
  });

  it("detects a HEIC compatible brand when the major brand is generic", () => {
    const bytes = Buffer.from("00000018667479706d69663100000000686569636d696631", "hex");

    expect(hasHeifSignature(bytes)).toBe(true);
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
        mimeType: "IMAGE/JPEG",
        name: "photo.jpeg",
      });
      expect(result.bytes).toBe(bytes);
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

      expect(error).toBeInstanceOf(ImageNormalizationError);
      expect(error.code).toBe("decode");
      expect(error.message).toBe("HEIC/HEIF image could not be decoded.");
    }),
  );
});

describe("image normalization pass-through", () => {
  it.effect("keeps JPEG, PNG, GIF, WebP, and AVIF bytes and metadata unchanged", () =>
    Effect.gen(function* () {
      const avif = Buffer.from("0000001c667479706176696600000000617669666d696631", "hex");
      for (const [mimeType, bytes] of [
        ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff])],
        ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
        ["image/gif", Buffer.from("GIF89a")],
        ["image/webp", Buffer.from("RIFF0000WEBP")],
        ["image/avif", avif],
      ] as const) {
        const input = { bytes, mimeType, name: `image.${mimeType.slice(6)}` };
        const result = yield* normalizeUploadedImage(input);
        expect(result).toBe(input);
      }
    }),
  );

  it.effect("stores converted HEIC under a .jpg attachment path", () =>
    Effect.gen(function* () {
      const result = yield* normalizeUploadedImage({
        bytes: Buffer.from(HEIC_FIXTURE_BASE64, "base64"),
        mimeType: "image/heic",
        name: "IMG_0001.HEIC",
      });
      expect(
        attachmentRelativePath({
          type: "image",
          id: "thread-attachment",
          name: result.name,
          mimeType: result.mimeType,
          sizeBytes: result.bytes.byteLength,
        }),
      ).toBe("thread-attachment.jpg");
    }),
  );
});
