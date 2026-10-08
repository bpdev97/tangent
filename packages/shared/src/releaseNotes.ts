// @effect-diagnostics globalFetch:off - The loader runs in the browser and React Native clients, without an Effect runtime.
/**
 * Tangent(FORK-NOTES-001): release notes shown in the app after an update.
 *
 * Every Tangent release on GitHub carries plain-language notes. Each client
 * remembers the release it last ran, offers the notes when it finds itself on
 * a newer one, and reads them from GitHub's public release list when asked.
 * See docs/fork/release-notes.md.
 */
import { compareSemverVersions, parseSemver } from "./semver.ts";

// These repeat downstream/config.ts, which mobile code must not import.
// releaseNotes.test.ts fails when they drift.
export const RELEASE_NOTES_REPOSITORY = "bpdev97/tangent";
export const RELEASE_NOTES_TAG_PREFIX = "personal-v";

/** Every release, for when the app cannot show the notes itself. */
export const RELEASE_NOTES_HISTORY_URL = `https://github.com/${RELEASE_NOTES_REPOSITORY}/releases`;

// One page of GitHub's list-releases endpoint, newest first. Anyone further
// behind than this reads the rest on GitHub.
const RELEASE_NOTES_INDEX_URL = `https://api.github.com/repos/${RELEASE_NOTES_REPOSITORY}/releases?per_page=30`;

/** Earlier releases listed below the new ones, so the notes stay a short read. */
const RELEASE_NOTES_HISTORY_LIMIT = 10;

export interface ReleaseNote {
  readonly version: string;
  /** Markdown, as written for the GitHub release. */
  readonly body: string;
  readonly url: string;
}

export interface ReleaseNoteEntry extends ReleaseNote {
  /** Published after the release this client last ran. */
  readonly isNew: boolean;
}

/** The step a client just took, from the release it last ran to the one it runs now. */
export interface ReleaseUpdate {
  readonly from: string;
  readonly to: string;
}

/** A plain `X.Y.Z` release, as opposed to a development or unstamped build. */
function isReleaseVersion(version: string | null | undefined): version is string {
  if (!version) return false;
  const parsed = parseSemver(version);
  return parsed !== null && parsed.prerelease.length === 0 && version !== "0.0.0";
}

/**
 * Decides, on launch, whether this client was updated since it last ran.
 * `remember` is the version to store right away: a first run and a downgrade
 * have nothing to announce. An update is stored only once the user has read
 * its notes or dismissed it, so it survives a restart until then.
 */
export function resolveReleaseUpdate(input: {
  readonly lastSeenVersion: string | null | undefined;
  readonly currentVersion: string | null | undefined;
}): { readonly update: ReleaseUpdate | null; readonly remember: string | null } {
  const { currentVersion, lastSeenVersion } = input;
  if (!isReleaseVersion(currentVersion)) return { update: null, remember: null };
  if (!isReleaseVersion(lastSeenVersion)) return { update: null, remember: currentVersion };
  const direction = compareSemverVersions(currentVersion, lastSeenVersion);
  if (direction > 0) {
    return { update: { from: lastSeenVersion, to: currentVersion }, remember: null };
  }
  return { update: null, remember: direction < 0 ? currentVersion : null };
}

/**
 * Reads GitHub's list-releases response into published Tangent releases that
 * have notes, newest first. Drafts, prereleases, and foreign tags are skipped.
 */
export function parseReleaseNotes(payload: unknown): ReadonlyArray<ReleaseNote> {
  if (!Array.isArray(payload)) return [];
  const notes: ReleaseNote[] = [];
  for (const release of payload as ReadonlyArray<unknown>) {
    if (typeof release !== "object" || release === null) continue;
    const { tag_name, body, html_url, draft, prerelease } = release as Record<string, unknown>;
    if (draft === true || prerelease === true) continue;
    if (typeof tag_name !== "string" || !tag_name.startsWith(RELEASE_NOTES_TAG_PREFIX)) continue;
    const version = tag_name.slice(RELEASE_NOTES_TAG_PREFIX.length);
    if (!isReleaseVersion(version)) continue;
    if (typeof body !== "string" || body.trim().length === 0) continue;
    notes.push({
      version,
      body: body.trim(),
      url:
        typeof html_url === "string"
          ? html_url
          : `${RELEASE_NOTES_HISTORY_URL}/tag/${encodeURIComponent(tag_name)}`,
    });
  }
  return notes.sort((left, right) => compareSemverVersions(right.version, left.version));
}

/** Whether the notes for an update are published, so reading the list counts as having seen it. */
export function hasReleaseNotesFor(
  releases: ReadonlyArray<ReleaseNote>,
  update: ReleaseUpdate | null,
): boolean {
  return update !== null && releases.some((release) => release.version === update.to);
}

/**
 * The releases to list for a client on `currentVersion`: everything newer than
 * `sinceVersion`, marked new, then a few earlier releases. Releases newer than
 * the running build are left out; a build that is not a release lists the
 * newest ones instead.
 */
export function selectReleaseNotes(input: {
  readonly releases: ReadonlyArray<ReleaseNote>;
  readonly currentVersion: string | null | undefined;
  readonly sinceVersion: string | null | undefined;
}): ReadonlyArray<ReleaseNoteEntry> {
  const { currentVersion, sinceVersion } = input;
  const shipped = isReleaseVersion(currentVersion)
    ? input.releases.filter(
        (release) => compareSemverVersions(release.version, currentVersion) <= 0,
      )
    : input.releases;
  const entries: ReleaseNoteEntry[] = [];
  let earlier = 0;
  for (const release of shipped) {
    const isNew =
      isReleaseVersion(sinceVersion) && compareSemverVersions(release.version, sinceVersion) > 0;
    if (!isNew) {
      if (earlier === RELEASE_NOTES_HISTORY_LIMIT) continue;
      earlier += 1;
    }
    entries.push({ ...release, isNew });
  }
  return entries;
}

/**
 * Loads the release list from GitHub. The repository is public, so no token is
 * sent. Nothing is cached: an update can reach a device before its release is
 * published, and the next look has to find the notes.
 */
export async function fetchReleaseNotes(): Promise<ReadonlyArray<ReleaseNote>> {
  const response = await fetch(RELEASE_NOTES_INDEX_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for the release list.`);
  }
  return parseReleaseNotes(await response.json());
}
