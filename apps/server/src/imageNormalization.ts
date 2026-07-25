import * as NodeModule from "node:module";
import * as NodeWorkerThreads from "node:worker_threads";

import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

const HEIF_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);
const JPEG_QUALITIES = [90, 75, 60] as const;
const MAX_DECODED_PIXELS = 40_000_000;
const NORMALIZATION_TIMEOUT_MS = 30_000;

const IMAGE_NORMALIZATION_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const decodeHeic = require(workerData.decoderPath);
const jpeg = require(workerData.encoderPath);

const fail = (code) => parentPort.postMessage({ ok: false, code });

(async () => {
  let images;
  try {
    images = await decodeHeic.all({ buffer: Buffer.from(workerData.input) });
    const image = images[0];
    if (!image) {
      fail("decode");
      return;
    }

    const { width, height } = image;
    const pixels = width * height;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isSafeInteger(pixels) ||
      pixels > workerData.maxPixels
    ) {
      fail("dimensions");
      return;
    }

    const decoded = await image.decode();
    for (const quality of workerData.qualities) {
      const encoded = jpeg.encode(decoded, quality).data;
      if (encoded.byteLength <= workerData.maxBytes) {
        const output = Uint8Array.from(encoded);
        parentPort.postMessage({ ok: true, output }, [output.buffer]);
        return;
      }
    }
    fail("output");
  } catch {
    fail("decode");
  } finally {
    images?.dispose();
  }
})();
`;

type NormalizationWorkerFailureCode = "decode" | "dimensions" | "output" | "timeout";

const NORMALIZATION_ERROR_MESSAGES: Record<NormalizationWorkerFailureCode, string> = {
  decode: "HEIC/HEIF image could not be decoded.",
  dimensions: "HEIC/HEIF image dimensions exceed the supported limit.",
  output: "Normalized image exceeds the supported size limit.",
  timeout: "HEIC/HEIF image conversion timed out.",
};

type NormalizationWorkerMessage =
  | { readonly ok: true; readonly output: Uint8Array }
  | { readonly ok: false; readonly code: NormalizationWorkerFailureCode };

export class ImageNormalizationError extends Error {
  readonly code: NormalizationWorkerFailureCode;

  constructor(code: NormalizationWorkerFailureCode) {
    super(NORMALIZATION_ERROR_MESSAGES[code]);
    this.name = "ImageNormalizationError";
    this.code = code;
  }
}

export interface NormalizedUploadedImage {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly name: string;
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let index = start; index < end; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0);
  }
  return value;
}

export function hasHeifSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    readAscii(bytes, 4, 8) === "ftyp" &&
    HEIF_BRANDS.has(readAscii(bytes, 8, 12))
  );
}

function jpegFileName(name: string): string {
  const extensionIndex = name.lastIndexOf(".");
  const unsuffixed = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
  const baseName = (unsuffixed.trim() || "image").slice(0, 251);
  return `${baseName}.jpg`;
}

function transcodeHeifToJpeg(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ImageNormalizationError> {
  const require = NodeModule.createRequire(import.meta.url);
  const input = Uint8Array.from(bytes);

  return Effect.callback<Uint8Array, ImageNormalizationError>((resume) => {
    const worker = new NodeWorkerThreads.Worker(IMAGE_NORMALIZATION_WORKER_SOURCE, {
      eval: true,
      workerData: {
        input,
        decoderPath: require.resolve("heic-decode"),
        encoderPath: require.resolve("jpeg-js"),
        maxPixels: MAX_DECODED_PIXELS,
        maxBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
        qualities: JPEG_QUALITIES,
      },
      transferList: [input.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: 512,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
    });
    worker.unref();

    let settled = false;
    const settle = (effect: Effect.Effect<Uint8Array, ImageNormalizationError>) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      resume(effect);
    };

    worker.once("message", (message: NormalizationWorkerMessage) => {
      settle(
        message.ok
          ? Effect.succeed(message.output)
          : Effect.fail(new ImageNormalizationError(message.code)),
      );
    });
    worker.once("error", () => {
      settle(Effect.fail(new ImageNormalizationError("decode")));
    });
    worker.once("exit", () => {
      settle(Effect.fail(new ImageNormalizationError("decode")));
    });

    return Effect.sync(() => {
      settled = true;
      void worker.terminate();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: NORMALIZATION_TIMEOUT_MS,
      orElse: () => Effect.fail(new ImageNormalizationError("timeout")),
    }),
  );
}

export const normalizeUploadedImage = Effect.fn("imageNormalization.normalizeUploadedImage")(
  function* (input: {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly name: string;
  }) {
    const mimeType = input.mimeType.toLowerCase();
    if (!HEIF_MIME_TYPES.has(mimeType) && !hasHeifSignature(input.bytes)) {
      return {
        ...input,
        mimeType,
      } satisfies NormalizedUploadedImage;
    }

    const bytes = yield* transcodeHeifToJpeg(input.bytes);
    return {
      bytes,
      mimeType: "image/jpeg",
      name: jpegFileName(input.name),
    } satisfies NormalizedUploadedImage;
  },
);
