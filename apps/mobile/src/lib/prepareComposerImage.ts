import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";

import { estimateBase64ByteSize } from "./base64";

export const MAX_COMPOSER_IMAGE_SOURCE_BYTES = 50 * 1024 * 1024;

/** Prepare the selected bytes once for library, camera, clipboard, and shared images. */
export async function prepareComposerImage(
  input: {
    readonly mimeType: string;
    readonly name: string;
  } & ({ readonly base64: string } | { readonly uri: string }),
) {
  const sourceFile = "uri" in input ? new (await import("expo-file-system")).File(input.uri) : null;
  const sizeBytes =
    "base64" in input ? estimateBase64ByteSize(input.base64) : (sourceFile?.size ?? null);
  const source = "base64" in input ? `data:${input.mimeType};base64,${input.base64}` : input.uri;
  const needsJpeg =
    "uri" in input && /image\/hei[cf]|application\/octet-stream/.test(input.mimeType);
  if (sizeBytes === 0) {
    throw new Error(`Could not read '${input.name}'.`);
  }
  if (
    sizeBytes !== null &&
    sizeBytes > 0 &&
    sizeBytes <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES &&
    !needsJpeg
  ) {
    const base64 = "base64" in input ? input.base64 : ((await sourceFile?.base64()) ?? "");
    const measuredBytes = estimateBase64ByteSize(base64);
    if (measuredBytes <= 0 || measuredBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      throw new Error(`'${input.name}' exceeds the 10 MB attachment limit.`);
    }
    const dataUrl = `data:${input.mimeType};base64,${base64}`;
    return {
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: measuredBytes,
      dataUrl,
      previewUri: sourceFile?.uri ?? dataUrl,
    };
  }
  if (sizeBytes !== null && sizeBytes > MAX_COMPOSER_IMAGE_SOURCE_BYTES) {
    throw new Error(`'${input.name}' exceeds the 50 MB image processing limit.`);
  }
  // Native re-encoding loses animation. Keep these formats intact instead.
  if (input.mimeType === "image/gif" || input.mimeType === "image/webp") {
    throw new Error(
      `'${input.name}' exceeds 10 MB. Resize it before attaching to preserve animation.`,
    );
  }

  const { File } = await import("expo-file-system");
  const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
  const context = ImageManipulator.manipulate(source);
  const preserveAlpha = input.mimeType === "image/png";
  const mimeType = preserveAlpha ? "image/png" : "image/jpeg";
  const name = `${input.name.replace(/\.[^.]+$/, "")}.${preserveAlpha ? "png" : "jpg"}`;
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    rendered = await context.renderAsync();
    if (sourceFile && !preserveAlpha && Math.max(rendered.width, rendered.height) > 2048) {
      const size = rendered.width >= rendered.height ? { width: 2048 } : { height: 2048 };
      rendered.release();
      rendered = undefined;
      context.resize(size);
      rendered = await context.renderAsync();
    }
    for (let attempt = 0; attempt < 6; attempt++) {
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
          const preparedUrl = `data:${mimeType};base64,${result.base64}`;
          return {
            name,
            mimeType,
            sizeBytes: bytes,
            dataUrl: preparedUrl,
            previewUri: preparedUrl,
          };
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
