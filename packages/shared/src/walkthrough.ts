// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.

/**
 * A code walkthrough is an agent-authored reading order for a diff: sections
 * that each explain why a group of files changed, published into a thread with
 * T3's `walkthrough_publish` MCP tool. The thread shows a compact card; opening
 * a section drives the native diff panel, so the diff itself is always the
 * app's own rendering of the live checkout, never a copy.
 */

import { readHtmlRenderReference, type HtmlRenderReference } from "./htmlRender.ts";

export const WALKTHROUGH_PUBLISH_TOOL_NAME = "walkthrough_publish";
/** Stores a diagram as an HTML render without showing it in the thread; a walkthrough attaches it. */
export const WALKTHROUGH_VISUAL_TOOL_NAME = "walkthrough_visual";

export const WALKTHROUGH_MAX_SECTIONS = 12;
export const WALKTHROUGH_MAX_FILES_PER_SECTION = 40;
export const WALKTHROUGH_MAX_FLAGS_PER_FILE = 6;
export const WALKTHROUGH_MAX_TITLE_LENGTH = 120;
export const WALKTHROUGH_MAX_SUMMARY_LENGTH = 1_200;
export const WALKTHROUGH_MAX_REASON_LENGTH = 160;
export const WALKTHROUGH_MAX_FLAG_LENGTH = 400;
/** The whole reference travels in the compact tool output, so it has its own cap. */
const WALKTHROUGH_MAX_BYTES = 32_000;

/** Which diff the sections point into. */
export type WalkthroughScope =
  | { readonly kind: "branch"; readonly baseRef?: string }
  | { readonly kind: "turn"; readonly turnId: string };

/** How closely a reviewer should read a section. */
export type WalkthroughAttention = "review" | "skim" | "trust";
const WALKTHROUGH_ATTENTIONS: ReadonlyArray<WalkthroughAttention> = ["review", "skim", "trust"];

/** What a flag on a line means to the reviewer. */
export type WalkthroughFlagSeverity = "blocker" | "question" | "nit" | "note";
const WALKTHROUGH_FLAG_SEVERITIES: ReadonlyArray<WalkthroughFlagSeverity> = [
  "blocker",
  "question",
  "nit",
  "note",
];

export interface WalkthroughFlag {
  readonly severity: WalkthroughFlagSeverity;
  /** New-side line the flag hangs under; omitted for a file-level remark. */
  readonly line?: number;
  readonly text: string;
}

export interface WalkthroughFile {
  readonly path: string;
  readonly flags?: ReadonlyArray<WalkthroughFlag>;
}

export interface WalkthroughSection {
  readonly title: string;
  readonly summary: string;
  /** A diagram shown above the section's files. */
  readonly visual?: HtmlRenderReference;
  readonly attention?: WalkthroughAttention;
  /** One line on why the section earns its attention level. */
  readonly reason?: string;
  readonly files: ReadonlyArray<WalkthroughFile>;
}

export interface WalkthroughReference {
  /** Server-assigned; a later walkthrough names it in `replaces`. */
  readonly id: string;
  readonly title: string;
  /** What the change does as a whole, read before any section. */
  readonly summary?: string;
  /** A diagram of the whole change, shown with the summary. */
  readonly visual?: HtmlRenderReference;
  readonly scope: WalkthroughScope;
  readonly sections: ReadonlyArray<WalkthroughSection>;
  /** The id of the walkthrough this one updates, whose card then collapses. */
  readonly replaces?: string;
  /** The checkout's head commit when the walkthrough was written. */
  readonly headCommit?: string;
  readonly publishedAt?: string;
}

const trimTo = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, max).trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const oneOf = <T extends string>(value: unknown, options: ReadonlyArray<T>): T | undefined =>
  typeof value === "string" && (options as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : undefined;

function readScope(value: unknown): WalkthroughScope | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { kind, baseRef, turnId } = value as Record<string, unknown>;
  if (kind === "branch") {
    const ref = trimTo(baseRef, 200);
    return ref === undefined ? { kind } : { kind, baseRef: ref };
  }
  if (kind === "turn") {
    const id = trimTo(turnId, 128);
    return id === undefined ? undefined : { kind, turnId: id };
  }
  return undefined;
}

function readFlag(value: unknown): WalkthroughFlag | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { severity, line, text } = value as Record<string, unknown>;
  const flagText = trimTo(text, WALKTHROUGH_MAX_FLAG_LENGTH);
  if (flagText === undefined) return undefined;
  const flagSeverity = oneOf(severity, WALKTHROUGH_FLAG_SEVERITIES) ?? "note";
  const flagLine =
    typeof line === "number" && Number.isInteger(line) && line >= 1 && line <= 1_000_000
      ? line
      : undefined;
  return flagLine === undefined
    ? { severity: flagSeverity, text: flagText }
    : { severity: flagSeverity, line: flagLine, text: flagText };
}

function readFile(value: unknown): WalkthroughFile | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { path, flags, note } = value as Record<string, unknown>;
  const filePath = trimTo(path, 1_024);
  if (filePath === undefined) return undefined;
  // `note` is the earlier single-remark spelling; it reads as one "note" flag.
  const rawFlags = Array.isArray(flags) ? flags : note !== undefined ? [note] : [];
  const parsedFlags = rawFlags.slice(0, WALKTHROUGH_MAX_FLAGS_PER_FILE).flatMap((flag) => {
    const parsed = readFlag(flag);
    return parsed === undefined ? [] : [parsed];
  });
  return parsedFlags.length === 0 ? { path: filePath } : { path: filePath, flags: parsedFlags };
}

function readSection(value: unknown): WalkthroughSection | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { title, summary, attention, reason, files, visual } = value as Record<string, unknown>;
  const sectionTitle = trimTo(title, WALKTHROUGH_MAX_TITLE_LENGTH);
  const sectionSummary = trimTo(summary, WALKTHROUGH_MAX_SUMMARY_LENGTH);
  if (sectionTitle === undefined || sectionSummary === undefined || !Array.isArray(files)) {
    return undefined;
  }
  if (files.length === 0 || files.length > WALKTHROUGH_MAX_FILES_PER_SECTION) return undefined;
  const parsedFiles = files.flatMap((file) => {
    const parsed = readFile(file);
    return parsed === undefined ? [] : [parsed];
  });
  if (parsedFiles.length !== files.length) return undefined;
  const sectionAttention = oneOf(attention, WALKTHROUGH_ATTENTIONS);
  const sectionReason = trimTo(reason, WALKTHROUGH_MAX_REASON_LENGTH);
  const sectionVisual = readHtmlRenderReference(visual);
  return {
    title: sectionTitle,
    summary: sectionSummary,
    ...(sectionVisual === undefined ? {} : { visual: sectionVisual }),
    ...(sectionAttention === undefined ? {} : { attention: sectionAttention }),
    ...(sectionReason === undefined ? {} : { reason: sectionReason }),
    files: parsedFiles,
  };
}

/** Validates a walkthrough from an untrusted tool result, or returns undefined. */
export function readWalkthroughReference(value: unknown): WalkthroughReference | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, title, summary, visual, scope, sections, replaces, headCommit, publishedAt } =
    value as Record<string, unknown>;
  const walkthroughId = trimTo(id, 128);
  const walkthroughTitle = trimTo(title, WALKTHROUGH_MAX_TITLE_LENGTH);
  const parsedScope = readScope(scope);
  if (
    walkthroughId === undefined ||
    walkthroughTitle === undefined ||
    parsedScope === undefined ||
    !Array.isArray(sections)
  ) {
    return undefined;
  }
  if (sections.length === 0 || sections.length > WALKTHROUGH_MAX_SECTIONS) return undefined;
  const parsedSections = sections.flatMap((section) => {
    const parsed = readSection(section);
    return parsed === undefined ? [] : [parsed];
  });
  if (parsedSections.length !== sections.length) return undefined;
  const walkthroughSummary = trimTo(summary, WALKTHROUGH_MAX_SUMMARY_LENGTH);
  const walkthroughVisual = readHtmlRenderReference(visual);
  const replacesId = trimTo(replaces, 128);
  const head = trimTo(headCommit, 64);
  const published = trimTo(publishedAt, 40);
  const reference: WalkthroughReference = {
    id: walkthroughId,
    title: walkthroughTitle,
    ...(walkthroughSummary === undefined ? {} : { summary: walkthroughSummary }),
    ...(walkthroughVisual === undefined ? {} : { visual: walkthroughVisual }),
    scope: parsedScope,
    sections: parsedSections,
    ...(replacesId === undefined ? {} : { replaces: replacesId }),
    ...(head === undefined ? {} : { headCommit: head }),
    ...(published === undefined ? {} : { publishedAt: published }),
  };
  return new TextEncoder().encode(JSON.stringify(reference)).byteLength > WALKTHROUGH_MAX_BYTES
    ? undefined
    : reference;
}

/** Whether two references describe the same walkthrough. */
export function walkthroughReferencesEqual(
  left: WalkthroughReference,
  right: WalkthroughReference,
) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/** Every distinct path a walkthrough mentions, in reading order. */
export function walkthroughFilePaths(reference: WalkthroughReference): ReadonlyArray<string> {
  const seen = new Set<string>();
  for (const section of reference.sections) {
    for (const file of section.files) seen.add(file.path);
  }
  return [...seen];
}

/** Flags in a section, counted by severity; absent severities are 0. */
export function walkthroughFlagCounts(
  section: WalkthroughSection,
): Readonly<Record<WalkthroughFlagSeverity, number>> {
  const counts = { blocker: 0, question: 0, nit: 0, note: 0 };
  for (const file of section.files) {
    for (const flag of file.flags ?? []) counts[flag.severity] += 1;
  }
  return counts;
}

/**
 * The ids of walkthroughs a later one in the same list replaces. Their cards
 * collapse; the newest keeps the full view.
 */
export function supersededWalkthroughIds(
  references: ReadonlyArray<WalkthroughReference>,
): ReadonlySet<string> {
  const ids = new Set(references.map((reference) => reference.id));
  const superseded = new Set<string>();
  for (const reference of references) {
    if (reference.replaces !== undefined && ids.has(reference.replaces)) {
      superseded.add(reference.replaces);
    }
  }
  return superseded;
}
