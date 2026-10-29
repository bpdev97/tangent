import type { AssetUrlState } from "@t3tools/client-runtime/state/assets";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";

import { useDeckVersionSlot, type DeckVersionSlot } from "./office/deckVersions";
import { SlideAnnotatedFilePreview } from "./SlideAnnotatedFilePreview";

const assets = vi.hoisted(() => ({
  state: { _tag: "Loading" } as unknown,
}));

vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlState: () => assets.state,
}));

const views = vi.hoisted(() => ({
  mounted: [] as string[],
  reporters: [] as DeckVersionSlot[],
  commentOpen: false,
}));

vi.mock("./office/SlideAnnotations", async (original) => ({
  ...(await original<typeof import("./office/SlideAnnotations")>()),
  useSlideCommentOpen: () => views.commentOpen,
}));

vi.mock("./AttachmentFilePreview", async () => {
  const { useRef } = await import("react");
  return {
    AttachmentFilePreview: function FakePreview() {
      const slot = useDeckVersionSlot();
      const id = useRef<string | null>(null);
      if (id.current === null) {
        id.current = `copy-${views.mounted.length}`;
        views.mounted.push(id.current);
      }
      if (slot) views.reporters[Number(id.current.slice(5))] = slot;
      return <div>{id.current}</div>;
    },
  };
});

const environmentId = EnvironmentId.make("environment-revisions");
const threadRef = { environmentId, threadId: ThreadId.make("thread-revisions") };

function Preview(props: { readonly mutation: string | null; readonly name: string }) {
  const [resource] = useState({
    _tag: "media-file" as const,
    threadId: threadRef.threadId,
    path: `/work/${props.name}`,
  });
  const preview: ComponentProps<typeof SlideAnnotatedFilePreview> = {
    composerTarget: threadRef,
    path: `/work/${props.name}`,
    workspaceMutationId: props.mutation,
    name: props.name,
    mimeType: "application/octet-stream",
    sizeBytes: 0,
    asset: { environmentId, resource },
  };
  return <SlideAnnotatedFilePreview {...preview} />;
}

function revision(fileRevision: string): AssetUrlState {
  return { _tag: "Success", url: "https://host/deck", expiresAt: 1, fileRevision };
}

function reset() {
  assets.state = revision("a");
  views.mounted.length = 0;
  views.reporters.length = 0;
  views.commentOpen = false;
}

describe("SlideAnnotatedFilePreview", () => {
  it("stays mounted through mutations that leave the file unchanged", async () => {
    reset();
    await using screen = await render(<Preview mutation="m1" name="deck.pptx" />);
    await screen.rerender(<Preview mutation="m2" name="deck.pptx" />);
    await screen.rerender(<Preview mutation="m3" name="deck.pptx" />);
    expect(views.mounted).toEqual(["copy-0"]);
  });

  it("keeps the old deck visible until the new one is ready, without remounting either", async () => {
    reset();
    await using screen = await render(<Preview mutation="m1" name="deck.pptx" />);
    assets.state = revision("b");
    await screen.rerender(<Preview mutation="m2" name="deck.pptx" />);

    expect(views.mounted).toEqual(["copy-0", "copy-1"]);
    await expect.element(page.getByText("copy-0")).toBeVisible();
    await expect.element(page.getByText("copy-1")).not.toBeVisible();
    expect(views.reporters[1]?.hidden).toBe(true);

    views.reporters[1]?.onReady();
    await expect.element(page.getByText("copy-1")).toBeVisible();
    await expect.element(page.getByText("copy-0")).not.toBeInTheDocument();
    expect(views.mounted).toEqual(["copy-0", "copy-1"]);
    expect(views.reporters[1]?.hidden).toBe(false);
  });

  it("holds a ready deck while a comment is open, and says so", async () => {
    reset();
    views.commentOpen = true;
    await using screen = await render(<Preview mutation="m1" name="deck.pptx" />);
    assets.state = revision("b");
    await screen.rerender(<Preview mutation="m2" name="deck.pptx" />);
    views.reporters[1]?.onReady();

    await expect.element(page.getByText(/Finish or cancel your comment/)).toBeVisible();
    await expect.element(page.getByText("copy-0")).toBeVisible();

    views.commentOpen = false;
    await screen.rerender(<Preview mutation="m3" name="deck.pptx" />);
    await expect.element(page.getByText("copy-1")).toBeVisible();
    await expect.element(page.getByText(/Finish or cancel/)).not.toBeInTheDocument();
  });

  it("keeps the old deck and says so when the new one cannot open", async () => {
    reset();
    await using screen = await render(<Preview mutation="m1" name="deck.pptx" />);
    assets.state = revision("b");
    await screen.rerender(<Preview mutation="m2" name="deck.pptx" />);
    views.reporters[1]?.onFailed();

    await expect.element(page.getByText(/Could not load the latest version/)).toBeVisible();
    await expect.element(page.getByText("copy-0")).toBeVisible();
    await expect.element(page.getByText("copy-1")).not.toBeInTheDocument();
  });

  it("ignores a revision still being refreshed, as when a closed file changed and reopens", async () => {
    reset();
    assets.state = { ...revision("old"), waiting: true };
    await using screen = await render(<Preview mutation="m1" name="report.docx" />);
    assets.state = revision("new");
    await screen.rerender(<Preview mutation="m2" name="report.docx" />);
    expect(views.mounted).toEqual(["copy-0"]);
  });

  it("keeps a loaded document on screen while its file cannot be reached", async () => {
    reset();
    await using screen = await render(<Preview mutation="m1" name="report.docx" />);
    assets.state = { _tag: "Failure" };
    await screen.rerender(<Preview mutation="m2" name="report.docx" />);

    await expect.element(page.getByText(/Could not reach this file/)).toBeVisible();
    await expect.element(page.getByText("copy-0")).toBeVisible();
    expect(views.mounted).toEqual(["copy-0"]);

    assets.state = revision("a");
    await screen.rerender(<Preview mutation="m3" name="report.docx" />);
    await expect.element(page.getByText(/Could not reach this file/)).not.toBeInTheDocument();
    expect(views.mounted).toEqual(["copy-0"]);
  });

  it("replaces other documents outright when their file changes", async () => {
    reset();
    await using screen = await render(<Preview mutation="m1" name="report.docx" />);
    await screen.rerender(<Preview mutation="m2" name="report.docx" />);
    expect(views.mounted).toEqual(["copy-0"]);

    assets.state = revision("b");
    await screen.rerender(<Preview mutation="m3" name="report.docx" />);
    expect(views.mounted).toEqual(["copy-0", "copy-1"]);
    await expect.element(page.getByText("copy-1")).toBeVisible();
    await expect.element(page.getByText("copy-0")).not.toBeInTheDocument();
  });

  it("falls back to the workspace mutation on a server that reports no file revision", async () => {
    reset();
    assets.state = { _tag: "Success", url: "https://host/deck", expiresAt: 1 };
    await using screen = await render(<Preview mutation="m1" name="report.docx" />);
    await screen.rerender(<Preview mutation="m2" name="report.docx" />);
    expect(views.mounted).toEqual(["copy-0", "copy-1"]);
  });
});
