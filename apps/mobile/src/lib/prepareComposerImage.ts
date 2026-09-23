import {
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

import { estimateBase64ByteSize } from "./base64";

// Tangent(FORK-IMAGE-001): one preparation step for library, camera,
// clipboard, and shared images, so every input fits the unchanged 10 MiB
// upload limit in a format every provider reads.

/** Largest source the phone will decode and re-encode. */
export const MAX_COMPOSER_IMAGE_SOURCE_BYTES = 50 * 1024 * 1024;
/** Longest edge kept when a photo is re-encoded; matches the web composer. */
const PHOTO_MAX_EDGE = 2048;
const MAX_ENCODE_ATTEMPTS = 6;

export interface PreparedComposerImage {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
  readonly previewUri: string;
}

/**
 * Supported images within the cap keep their bytes. Anything else (HEIC,
 * unknown types, oversized files up to 50 MiB) is re-encoded natively with
 * bounded attempts: PNG stays PNG to keep transparency, the rest becomes
 * JPEG. Oversized GIF and WebP are rejected because re-encoding would drop
 * their animation.
 */
export async function prepareComposerImage(
  input: {
    readonly mimeType: string;
    readonly name: string;
  } & ({ readonly base64: string } | { readonly uri: string }),
): Promise<PreparedComposerImage> {
  const mimeType = input.mimeType.toLowerCase();
  const sourceFile = "uri" in input ? new (await import("expo-file-system")).File(input.uri) : null;
  const sizeBytes =
    "base64" in input ? estimateBase64ByteSize(input.base64) : (sourceFile?.size ?? null);
  if (sizeBytes === 0) {
    throw new Error(`Could not read '${input.name}'.`);
  }
  const supported = isProviderSendTurnSupportedImageMimeType(mimeType);
  if (
    supported &&
    sizeBytes !== null &&
    sizeBytes > 0 &&
    sizeBytes <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
  ) {
    const base64 = "base64" in input ? input.base64 : ((await sourceFile?.base64()) ?? "");
    const measuredBytes = estimateBase64ByteSize(base64);
    if (measuredBytes <= 0 || measuredBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      throw new Error(`'${input.name}' exceeds the 10 MB attachment limit.`);
    }
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return {
      name: input.name,
      mimeType,
      sizeBytes: measuredBytes,
      dataUrl,
      previewUri: sourceFile?.uri ?? dataUrl,
    };
  }
  if (sizeBytes !== null && sizeBytes > MAX_COMPOSER_IMAGE_SOURCE_BYTES) {
    throw new Error(`'${input.name}' exceeds the 50 MB image processing limit.`);
  }
  if (mimeType === "image/gif" || mimeType === "image/webp") {
    throw new Error(
      `'${input.name}' exceeds 10 MB. Resize it before attaching to preserve animation.`,
    );
  }

  const source = "base64" in input ? `data:${mimeType};base64,${input.base64}` : input.uri;
  const { File } = await import("expo-file-system");
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
  const context = ImageManipulator.manipulate(source);
  const preserveAlpha = mimeType === "image/png";
  const outputMimeType = preserveAlpha ? "image/png" : "image/jpeg";
  const name = `${input.name.replace(/\.[^.]+$/, "")}.${preserveAlpha ? "png" : "jpg"}`;
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    rendered = await context.renderAsync();
    // Camera and library photos are 12-48 MP; bound them like the web composer.
    if (
      sourceFile &&
      !preserveAlpha &&
      Math.max(rendered.width, rendered.height) > PHOTO_MAX_EDGE
    ) {
      const size =
        rendered.width >= rendered.height ? { width: PHOTO_MAX_EDGE } : { height: PHOTO_MAX_EDGE };
      rendered.release();
      rendered = undefined;
      context.resize(size);
      rendered = await context.renderAsync();
    }
    for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt++) {
      // JPEG tries a lower quality before giving up resolution; PNG can only shrink.
      if (attempt > (preserveAlpha ? 0 : 1)) {
        const width = Math.max(1, Math.floor(rendered.width * 0.75));
        const height = Math.max(1, Math.floor(rendered.height * 0.75));
        rendered.release();
        rendered = undefined;
        context.resize({ width, height });
        rendered = await context.renderAsync();
      }
      const result = await rendered.saveAsync({
        format: preserveAlpha ? SaveFormat.PNG : SaveFormat.JPEG,
        compress: attempt === 0 ? 0.9 : 0.75,
        base64: true,
      });
      try {
        const bytes = estimateBase64ByteSize(result.base64 ?? "");
        if (bytes > 0 && bytes <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          const dataUrl = `data:${outputMimeType};base64,${result.base64}`;
          return { name, mimeType: outputMimeType, sizeBytes: bytes, dataUrl, previewUri: dataUrl };
        }
      } finally {
        const file = new File(result.uri);
        if (file.exists) file.delete();
      }
    }
  } finally {
    rendered?.release();
    context.release();
  }
  throw new Error(`Could not shrink '${input.name}' below the 10 MB attachment limit.`);
}
