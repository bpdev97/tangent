import { describe, expect, it } from "vite-plus/test";

import { PERSONAL_DISTRIBUTION } from "../../../downstream/config.ts";
import {
  hasReleaseNotesFor,
  parseReleaseNotes,
  RELEASE_NOTES_REPOSITORY,
  RELEASE_NOTES_TAG_PREFIX,
  resolveReleaseUpdate,
  selectReleaseNotes,
} from "./releaseNotes.ts";

const release = (version: string, extra: Record<string, unknown> = {}) => ({
  tag_name: `personal-v${version}`,
  body: `Notes for ${version}`,
  html_url: `https://github.com/bpdev97/tangent/releases/tag/personal-v${version}`,
  draft: false,
  prerelease: false,
  ...extra,
});

describe("release notes", () => {
  it("reads the same repository and tags the releases are published under", () => {
    const { owner, name } = PERSONAL_DISTRIBUTION.repository;
    expect(RELEASE_NOTES_REPOSITORY).toBe(`${owner}/${name}`);
    expect(RELEASE_NOTES_TAG_PREFIX).toBe(PERSONAL_DISTRIBUTION.serverRelease.tagPrefix);
  });

  describe("resolveReleaseUpdate", () => {
    it("remembers the version on a first run without announcing anything", () => {
      expect(resolveReleaseUpdate({ lastSeenVersion: null, currentVersion: "0.2.10" })).toEqual({
        update: null,
        remember: "0.2.10",
      });
    });

    it("announces an update and leaves it unstored until the user has seen it", () => {
      expect(resolveReleaseUpdate({ lastSeenVersion: "0.2.8", currentVersion: "0.2.10" })).toEqual({
        update: { from: "0.2.8", to: "0.2.10" },
        remember: null,
      });
    });

    it("compares versions numerically", () => {
      expect(
        resolveReleaseUpdate({ lastSeenVersion: "0.2.9", currentVersion: "0.2.10" }).update,
      ).toEqual({ from: "0.2.9", to: "0.2.10" });
    });

    it("stays quiet on the same version", () => {
      expect(resolveReleaseUpdate({ lastSeenVersion: "0.2.10", currentVersion: "0.2.10" })).toEqual(
        { update: null, remember: null },
      );
    });

    it("follows a downgrade so the next update is measured from it", () => {
      expect(resolveReleaseUpdate({ lastSeenVersion: "0.2.10", currentVersion: "0.2.8" })).toEqual({
        update: null,
        remember: "0.2.8",
      });
    });

    it("keeps the last release when the running build has no release version", () => {
      for (const currentVersion of [null, undefined, "", "0.0.0", "0.2.11-nightly.20261001.1"]) {
        expect(resolveReleaseUpdate({ lastSeenVersion: "0.2.10", currentVersion })).toEqual({
          update: null,
          remember: null,
        });
      }
    });
  });

  describe("parseReleaseNotes", () => {
    it("keeps published Tangent releases with notes, newest first", () => {
      const notes = parseReleaseNotes([
        release("0.2.9"),
        release("0.2.10"),
        release("0.2.11", { draft: true }),
        release("0.2.12", { prerelease: true }),
        release("0.2.7", { body: "  " }),
        release("0.2.6", { body: null }),
        { ...release("0.2.5"), tag_name: "v0.2.5" },
        { ...release("0.2.4"), tag_name: "personal-vnext" },
        "not a release",
      ]);
      expect(notes.map((note) => note.version)).toEqual(["0.2.10", "0.2.9"]);
      expect(notes[0]).toEqual({
        version: "0.2.10",
        body: "Notes for 0.2.10",
        url: "https://github.com/bpdev97/tangent/releases/tag/personal-v0.2.10",
      });
    });

    it("tells whether an update's own notes are published yet", () => {
      const notes = parseReleaseNotes([release("0.2.10")]);
      expect(hasReleaseNotesFor(notes, { from: "0.2.9", to: "0.2.10" })).toBe(true);
      expect(hasReleaseNotesFor(notes, { from: "0.2.10", to: "0.2.11" })).toBe(false);
      expect(hasReleaseNotesFor(notes, null)).toBe(false);
    });

    it("returns nothing for an error payload", () => {
      expect(parseReleaseNotes({ message: "API rate limit exceeded" })).toEqual([]);
    });
  });

  describe("selectReleaseNotes", () => {
    const releases = parseReleaseNotes(
      Array.from({ length: 16 }, (_, index) => release(`0.2.${index}`)),
    );

    it("marks every release since the last one the client ran", () => {
      const entries = selectReleaseNotes({
        releases,
        currentVersion: "0.2.10",
        sinceVersion: "0.2.8",
      });
      expect(entries.filter((entry) => entry.isNew).map((entry) => entry.version)).toEqual([
        "0.2.10",
        "0.2.9",
      ]);
    });

    it("leaves out releases newer than the running build", () => {
      const entries = selectReleaseNotes({
        releases,
        currentVersion: "0.2.10",
        sinceVersion: null,
      });
      expect(entries[0]?.version).toBe("0.2.10");
      expect(entries.some((entry) => entry.isNew)).toBe(false);
    });

    it("lists a few earlier releases after the new ones, however many are new", () => {
      const entries = selectReleaseNotes({
        releases,
        currentVersion: "0.2.15",
        sinceVersion: "0.2.2",
      });
      expect(entries.filter((entry) => entry.isNew)).toHaveLength(13);
      expect(entries.filter((entry) => !entry.isNew).map((entry) => entry.version)).toEqual([
        "0.2.2",
        "0.2.1",
        "0.2.0",
      ]);
      expect(
        selectReleaseNotes({ releases, currentVersion: "0.2.15", sinceVersion: null }),
      ).toHaveLength(10);
    });

    it("lists the newest releases for a build that is not a release", () => {
      const entries = selectReleaseNotes({ releases, currentVersion: null, sinceVersion: null });
      expect(entries[0]?.version).toBe("0.2.15");
    });
  });
});
