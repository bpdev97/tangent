import { fitImageAttachmentSize } from "@t3tools/client-runtime/image-attachment-size";
import {
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

import { estimateBase64ByteSize } from "./base64";
import { fitComposerImage } from "./composerImageFit";

// Tangent(FORK-IMAGE-001): one preparation step for library, camera,
// clipboard, and shared images, so every input fits the unchanged 10 MiB
// upload limit in a format every provider reads.

/** Largest source the phone will decode and re-encode. */
export const MAX_COMPOSER_IMAGE_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_ENCODE_ATTEMPTS = 6;

export interface PreparedComposerImage {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly base64: string;
  /** The file to store: the source itself, or a temporary copy that `release` deletes. */
  readonly uri: string;
  readonly release: () => Promise<void>;
}

async function removeTemporaryImage(uri: string): Promise<void> {
  try {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn("[composer-images] could not remove a temporary image", error);
  }
}

/**
 * Supported images within the cap keep their bytes unless `fitComposerImage` scales them. The rest
 * is re-encoded (PNG stays PNG); oversized GIF and WebP are rejected to keep their animation. Pass
 * `base64` already read: native image loaders may not read a share provider's file.
 */
export async function prepareComposerImage(input: {
  readonly mimeType: string;
  readonly name: string;
  readonly uri: string;
  readonly base64?: string;
}): Promise<PreparedComposerImage> {
  const mimeType = input.mimeType.toLowerCase();
  const sourceFile =
    input.base64 === undefined ? new (await import("expo-file-system")).File(input.uri) : null;
  const sizeBytes =
    input.base64 === undefined ? (sourceFile?.size ?? null) : estimateBase64ByteSize(input.base64);
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
    const sourceBase64 = input.base64 ?? (await sourceFile?.base64()) ?? "";
    const candidate = await fitComposerImage({
      uri: input.base64 === undefined ? input.uri : `data:${mimeType};base64,${input.base64}`,
      mimeType,
      base64: sourceBase64,
    });
    // The original already fits the cap, so a scaled copy that doesn't is dropped.
    const fitted =
      candidate !== null &&
      estimateBase64ByteSize(candidate.base64) <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
        ? candidate
        : null;
    if (candidate !== null && fitted === null) await removeTemporaryImage(candidate.uri);
    const base64 = fitted?.base64 ?? sourceBase64;
    const measuredBytes = estimateBase64ByteSize(base64);
    if (measuredBytes <= 0 || measuredBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      throw new Error(`'${input.name}' exceeds the 10 MB attachment limit.`);
    }
    return {
      name: input.name,
      mimeType,
      sizeBytes: measuredBytes,
      base64,
      uri: fitted?.uri ?? input.uri,
      release: async () => {
        if (fitted !== null) await removeTemporaryImage(fitted.uri);
      },
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

  const source = input.base64 === undefined ? input.uri : `data:${mimeType};base64,${input.base64}`;
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
  const context = ImageManipulator.manipulate(source);
  const preserveAlpha = mimeType === "image/png";
  const outputMimeType = preserveAlpha ? "image/png" : "image/jpeg";
  const name = `${input.name.replace(/\.[^.]+$/, "")}.${preserveAlpha ? "png" : "jpg"}`;
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    rendered = await context.renderAsync();
    // Camera and library photos are 12-48 MP; bound every re-encode to upstream's attachment edge.
    const size = fitImageAttachmentSize(rendered);
    if (size !== null) {
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
      const base64 = result.base64 ?? "";
      const bytes = estimateBase64ByteSize(base64);
      if (bytes > 0 && bytes <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
        return {
          name,
          mimeType: outputMimeType,
          sizeBytes: bytes,
          base64,
          uri: result.uri,
          release: () => removeTemporaryImage(result.uri),
        };
      }
      await removeTemporaryImage(result.uri);
    }
  } finally {
    rendered?.release();
    context.release();
  }
  throw new Error(`Could not shrink '${input.name}' below the 10 MB attachment limit.`);
}
