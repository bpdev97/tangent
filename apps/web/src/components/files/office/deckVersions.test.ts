import { describe, expect, it } from "vite-plus/test";

import {
  INITIAL_DECK_VERSIONS,
  markVersionFailed,
  markVersionReady,
  markVersionRecovered,
  markVersionStalled,
  observeRevision,
  showReadyVersion,
  UNAVAILABLE_REVISION,
} from "./deckVersions";

const open = observeRevision(INITIAL_DECK_VERSIONS, "a", true);
const loading = observeRevision(open, "b", true);
const nextId = loading.next?.id ?? -1;

describe("deck versions", () => {
  it("keeps the first copy when the first revision arrives", () => {
    expect(open.shown).toEqual({ id: 0, revision: "a", ready: true });
    expect(open.next).toBeNull();
  });

  it("loads nothing when a mutation left the file unchanged", () => {
    expect(observeRevision(open, "a", true)).toBe(open);
    expect(observeRevision(loading, "b", true)).toBe(loading);
  });

  it("loads a changed file behind the shown copy, then shows it", () => {
    expect(loading.shown.revision).toBe("a");
    expect(loading.next).toEqual({ id: 1, revision: "b", ready: false });

    const ready = markVersionReady(loading, nextId);
    expect(ready.shown.revision).toBe("a");
    expect(showReadyVersion(ready)).toMatchObject({
      shown: { id: 1, revision: "b", ready: true },
      next: null,
    });
  });

  it("does not show a version before it is ready", () => {
    expect(showReadyVersion(loading)).toBe(loading);
  });

  it("restarts with the newest revision when the file changes again mid-load", () => {
    const newer = observeRevision(loading, "c", true);
    expect(newer.shown.revision).toBe("a");
    expect(newer.next).toEqual({ id: 2, revision: "c", ready: false });
    expect(markVersionReady(newer, nextId)).toBe(newer);
  });

  it("drops a pending version when the file returns to what is shown", () => {
    expect(observeRevision(loading, "a", true)).toMatchObject({ next: null, rejected: null });
  });

  it("keeps the shown copy when a version cannot open, and does not retry that revision", () => {
    const failed = markVersionFailed(loading, nextId);
    expect(failed).toMatchObject({ shown: { revision: "a" }, next: null, rejected: "b" });
    expect(observeRevision(failed, "b", true)).toBe(failed);
    expect(observeRevision(failed, "c", true)).toMatchObject({
      next: { revision: "c" },
      rejected: null,
    });
  });

  it("keeps a slow version loading, and lets it replace the shown copy when it arrives", () => {
    const stalled = markVersionStalled(loading, nextId);
    expect(stalled).toMatchObject({ next: { revision: "b" }, rejected: "b" });
    expect(observeRevision(stalled, "b", true)).toBe(stalled);
    expect(showReadyVersion(markVersionReady(stalled, nextId))).toMatchObject({
      shown: { revision: "b" },
      rejected: null,
    });
  });

  it("keeps the shown copy while the file cannot be reached, and recovers", () => {
    const missing = observeRevision(open, UNAVAILABLE_REVISION, true);
    expect(missing).toMatchObject({
      shown: { revision: "a" },
      next: null,
      rejected: UNAVAILABLE_REVISION,
    });
    expect(observeRevision(missing, UNAVAILABLE_REVISION, true)).toBe(missing);
    expect(observeRevision(missing, "a", true)).toMatchObject({ next: null, rejected: null });
    expect(observeRevision(missing, "b", true)).toMatchObject({ next: { revision: "b" } });
  });

  it("abandons a load when the file disappears during it", () => {
    expect(observeRevision(loading, UNAVAILABLE_REVISION, true)).toMatchObject({
      shown: { revision: "a" },
      next: null,
      rejected: UNAVAILABLE_REVISION,
    });
  });

  it("replaces a shown copy that failed instead of hiding its successor", () => {
    const broken = markVersionFailed(open, open.shown.id);
    expect(observeRevision(broken, "b", true)).toEqual({
      shown: { id: 1, revision: "b", ready: true },
      next: null,
      rejected: null,
      shownFailed: false,
    });
  });

  it("replaces the shown copy outright for documents that cannot swap", () => {
    expect(observeRevision(open, "b", false)).toMatchObject({
      shown: { id: 1, revision: "b" },
      next: null,
    });
  });

  it("keeps a loaded document on screen while its file cannot be reached", () => {
    const missing = observeRevision(open, UNAVAILABLE_REVISION, false);
    expect(missing).toMatchObject({
      shown: { id: 0, revision: "a" },
      rejected: UNAVAILABLE_REVISION,
    });
    expect(observeRevision(missing, "a", false)).toMatchObject({
      shown: { id: 0 },
      rejected: null,
    });
    expect(observeRevision(missing, "b", false)).toMatchObject({
      shown: { id: 1, revision: "b" },
      rejected: null,
    });
  });

  it("swaps again once a failed copy recovers through Retry", () => {
    const broken = markVersionFailed(open, open.shown.id);
    const recovered = markVersionRecovered(broken, open.shown.id);
    expect(recovered.shownFailed).toBe(false);
    expect(observeRevision(recovered, "b", true)).toMatchObject({
      shown: { revision: "a" },
      next: { revision: "b" },
    });
    expect(markVersionRecovered(open, open.shown.id)).toBe(open);
  });

  it("does not offer a failed copy as the previous version", () => {
    const broken = markVersionFailed(open, open.shown.id);
    expect(observeRevision(broken, UNAVAILABLE_REVISION, true)).toBe(broken);
  });

  it("ignores reports from a version that is gone", () => {
    expect(markVersionReady(open, 7)).toBe(open);
    expect(markVersionFailed(open, 7)).toBe(open);
    expect(markVersionStalled(open, 7)).toBe(open);
  });
});
