import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";

const native = vi.hoisted(() => ({
  save: vi.fn(),
  render: vi.fn(),
  resize: vi.fn(),
  releaseImage: vi.fn(),
  releaseContext: vi.fn(),
  manipulate: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  library: vi.fn(),
  camera: vi.fn(),
  permission: vi.fn(),
  clipboard: vi.fn(),
}));
vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: native.manipulate },
  SaveFormat: { PNG: "png", JPEG: "jpeg" },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    get exists() {
      return true;
    }
    base64() {
      return native.read(this.uri);
    }
    delete() {
      native.remove(this.uri);
    }
  },
}));
vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: native.library,
  launchCameraAsync: native.camera,
  requestCameraPermissionsAsync: native.permission,
}));
vi.mock("expo-clipboard", () => ({
  hasImageAsync: async () => true,
  getImageAsync: native.clipboard,
}));
vi.mock("./uuid", () => ({ uuidv4: () => "image-id" }));

import { MAX_COMPOSER_IMAGE_SOURCE_BYTES, prepareComposerImage } from "./prepareComposerImage";
import {
  convertPastedImagesToAttachments,
  pasteComposerClipboard,
  pickComposerMedia,
} from "./composerImages";
import { buildIncomingShareDraft } from "../features/sharing/incoming-share-model";
import { isForegroundHandoffActive } from "./foreground-handoff";

const oversized = "A".repeat(Math.ceil((PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1) / 3) * 4);
const input = { base64: oversized, mimeType: "image/jpeg", name: "photo.jpg" };
const output = { uri: "file:///cache/compressed.jpg", base64: "/9j/2Q==" };

beforeEach(() => {
  vi.resetAllMocks();
  native.save.mockResolvedValue(output);
  native.render.mockImplementation(async () => ({
    width: 4000,
    height: 3000,
    saveAsync: native.save,
    release: native.releaseImage,
  }));
  native.manipulate.mockReturnValue({
    renderAsync: native.render,
    resize: native.resize,
    release: native.releaseContext,
  });
  native.permission.mockResolvedValue({ granted: true });
  native.read.mockResolvedValue(oversized);
});

describe("mobile image preparation", () => {
  it.each(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"])(
    "preserves %s bytes within the cap",
    async (mimeType) => {
      const result = await prepareComposerImage({ ...input, base64: "YWJj", mimeType });
      expect(result).toMatchObject({
        mimeType,
        sizeBytes: 3,
        dataUrl: `data:${mimeType};base64,YWJj`,
      });
      expect(native.manipulate).not.toHaveBeenCalled();
    },
  );
  it("accepts the exact byte limit without re-encoding", async () => {
    const base64 = Buffer.alloc(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES).toString("base64");
    expect((await prepareComposerImage({ ...input, base64 })).sizeBytes).toBe(
      PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
    );
    expect(native.manipulate).not.toHaveBeenCalled();
  });
  it("compresses photos without reducing resolution when encoding alone fits", async () => {
    expect(await prepareComposerImage(input)).toMatchObject({
      sizeBytes: 4,
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,/9j/2Q==",
    });
    expect(native.resize).not.toHaveBeenCalled();
    expect(native.remove).toHaveBeenCalledWith(output.uri);
    expect(native.releaseImage).toHaveBeenCalledOnce();
    expect(native.releaseContext).toHaveBeenCalledOnce();
  });
  it("tries JPEG quality before reducing dimensions", async () => {
    native.save
      .mockResolvedValueOnce({ ...output, base64: oversized })
      .mockResolvedValueOnce({ ...output, base64: oversized });
    await prepareComposerImage(input);
    expect(native.save.mock.calls.map(([options]) => options.compress)).toEqual([0.9, 0.75, 0.75]);
    expect(native.resize).toHaveBeenCalledWith({ width: 3000, height: 2250 });
    expect(native.remove).toHaveBeenCalledTimes(3);
  });
  it("keeps PNG transparency and resizes when lossless encoding still exceeds the cap", async () => {
    native.save.mockResolvedValueOnce({ ...output, base64: oversized });
    const result = await prepareComposerImage({
      ...input,
      mimeType: "image/png",
      name: "screen.png",
    });
    expect(result).toMatchObject({ mimeType: "image/png", name: "screen.png" });
    expect(native.save.mock.calls.every(([options]) => options.format === "png")).toBe(true);
    expect(native.resize).toHaveBeenCalledOnce();
  });
  it.each(["image/gif", "image/webp"])(
    "rejects oversized %s without flattening it",
    async (mimeType) => {
      await expect(prepareComposerImage({ ...input, mimeType })).rejects.toThrow(
        "preserve animation",
      );
      expect(native.manipulate).not.toHaveBeenCalled();
    },
  );
  it("rejects empty and excessive input before decoding", async () => {
    await expect(prepareComposerImage({ ...input, base64: "" })).rejects.toThrow("Could not read");
    await expect(
      prepareComposerImage({
        ...input,
        base64: "A".repeat(Math.ceil((MAX_COMPOSER_IMAGE_SOURCE_BYTES + 1) / 3) * 4),
      }),
    ).rejects.toThrow("50 MB");
    expect(native.manipulate).not.toHaveBeenCalled();
  });
  it("bounds unsuccessful attempts and releases native resources", async () => {
    native.save.mockResolvedValue({ ...output, base64: oversized });
    await expect(prepareComposerImage(input)).rejects.toThrow("Could not shrink");
    expect(native.save).toHaveBeenCalledTimes(6);
    expect(native.remove).toHaveBeenCalledTimes(6);
    expect(native.releaseContext).toHaveBeenCalledOnce();
  });
  it("releases resources when encoding fails", async () => {
    native.save.mockRejectedValue(new Error("encode failed"));
    await expect(prepareComposerImage(input)).rejects.toThrow("encode failed");
    expect(native.releaseImage).toHaveBeenCalledOnce();
    expect(native.releaseContext).toHaveBeenCalledOnce();
  });
  it("releases the context when decoding fails", async () => {
    native.render.mockRejectedValue(new Error("decode failed"));
    await expect(prepareComposerImage(input)).rejects.toThrow("decode failed");
    expect(native.releaseContext).toHaveBeenCalledOnce();
  });
});

describe("mobile image entry points", () => {
  const asset = {
    uri: "file:///photo.jpg",
    type: "image",
    mimeType: "image/jpeg",
    fileName: "photo.jpg",
    base64: oversized,
    width: 4000,
    height: 3000,
  };
  it.each(["library", "camera"] as const)("shrinks a %s image before attaching", async (source) => {
    native.library.mockResolvedValue({ canceled: false, assets: [asset] });
    native.camera.mockImplementation(async () => {
      expect(isForegroundHandoffActive()).toBe(true);
      return { canceled: false, assets: [asset] };
    });
    const result = await pickComposerMedia({ existingCount: 0, source });
    expect(result.error).toBeNull();
    expect(result.attachments[0]).toMatchObject({ type: "image", sizeBytes: 4 });
    expect(isForegroundHandoffActive()).toBe(false);
  });
  it("shrinks a HEIC photo after the picker's JPEG conversion", async () => {
    native.library.mockResolvedValue({
      canceled: false,
      assets: [
        {
          ...asset,
          mimeType: "image/heic",
          fileName: "photo.HEIC",
          fileSize: 42,
          base64: `/9j/${oversized}`,
        },
      ],
    });
    const result = await pickComposerMedia({ existingCount: 0 });
    expect(result.error).toBeNull();
    expect(result.attachments[0]).toMatchObject({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
    });
  });
  it("keeps valid library images when another image cannot be compressed", async () => {
    native.library.mockResolvedValue({
      canceled: false,
      assets: [
        { ...asset, mimeType: "image/gif", fileName: "animation.gif" },
        { ...asset, base64: "/9j/2Q==" },
      ],
    });
    const result = await pickComposerMedia({ existingCount: 0 });
    expect(result.attachments).toHaveLength(1);
    expect(result.error).toContain("preserve animation");
  });
  it("does not open the camera without permission", async () => {
    native.permission.mockResolvedValue({ granted: false });
    expect(await pickComposerMedia({ existingCount: 0, source: "camera" })).toMatchObject({
      attachments: [],
      error: expect.stringContaining("Camera access"),
    });
    expect(native.camera).not.toHaveBeenCalled();
    expect(isForegroundHandoffActive()).toBe(false);
  });
  it("camera cancellation leaves the draft alone", async () => {
    native.camera.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickComposerMedia({ existingCount: 0, source: "camera" })).toEqual({
      attachments: [],
      error: null,
    });
    expect(native.manipulate).not.toHaveBeenCalled();
  });
  it("reports an unavailable camera and ends foreground handoff", async () => {
    native.camera.mockRejectedValue(new Error("Camera unavailable"));
    expect(await pickComposerMedia({ existingCount: 0, source: "camera" })).toEqual({
      attachments: [],
      error: "Camera unavailable",
    });
    expect(isForegroundHandoffActive()).toBe(false);
  });
  it("does not request permission when the draft is full", async () => {
    const result = await pickComposerMedia({ existingCount: 8, source: "camera" });
    expect(result.attachments).toEqual([]);
    expect(result.error).toContain("8 attachments");
    expect(native.permission).not.toHaveBeenCalled();
  });
  it("shrinks clipboard images", async () => {
    native.clipboard.mockResolvedValue({ data: `data:image/png;base64,${oversized}` });
    expect(await pasteComposerClipboard({ existingCount: 0 })).toMatchObject({
      error: null,
      images: [{ sizeBytes: 4, mimeType: "image/png" }],
    });
  });
  it("shrinks native paste images and releases owned sources", async () => {
    const uri = "file:///tmp/t3-composer-paste/photo.png";
    const result = await convertPastedImagesToAttachments({ uris: [uri], existingCount: 0 });
    expect(result.images[0]).toMatchObject({
      sizeBytes: 4,
      previewUri: "data:image/png;base64,/9j/2Q==",
    });
    expect(native.remove).toHaveBeenCalledWith(uri);
  });
  it("reports failed native paste while retaining valid images and cleaning both sources", async () => {
    const bad = "file:///tmp/t3-composer-paste/bad.png";
    const good = "file:///tmp/t3-composer-paste/good.png";
    native.read.mockImplementation(async (uri: string) => (uri === bad ? "" : "YWJj"));
    const result = await convertPastedImagesToAttachments({ uris: [bad, good], existingCount: 0 });
    expect(result.images).toHaveLength(1);
    expect(result.error).toContain("Could not read");
    expect(native.remove).toHaveBeenCalledWith(bad);
    expect(native.remove).toHaveBeenCalledWith(good);
  });
  it("shrinks shared images using actual bytes even when metadata under-reports", async () => {
    const payload = {
      shareType: "image" as const,
      value: "file:///shared/photo.jpg",
      mimeType: "image/jpeg",
    };
    const removeOwnedFile = vi.fn(async () => undefined);
    const result = await buildIncomingShareDraft({
      id: "share",
      createdAt: "2026-09-11T12:00:00.000Z",
      payloads: [payload],
      resolvedPayloads: [
        {
          ...payload,
          contentUri: payload.value,
          contentType: "image",
          contentMimeType: "image/jpeg",
          contentSize: 3,
          originalName: "photo.jpg",
        },
      ],
      fileReader: { readBase64: async () => oversized, removeOwnedFile },
    });
    expect(result.warnings).toEqual([]);
    expect(result.attachments[0]).toMatchObject({ sizeBytes: 4, mimeType: "image/jpeg" });
    expect(removeOwnedFile).toHaveBeenCalledWith(payload.value);
  });
});
