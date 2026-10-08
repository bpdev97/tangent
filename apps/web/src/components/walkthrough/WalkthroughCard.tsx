// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { EnvironmentId } from "@t3tools/contracts";
import {
  walkthroughFlagCounts,
  type WalkthroughAttention,
  type WalkthroughReference,
} from "@t3tools/shared/walkthrough";
import { BookOpenIcon, ChevronRightIcon, HistoryIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import type { ChatFileAttachment } from "~/types";

import { HtmlRenderFrame } from "../chat/HtmlRenderFrame";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WalkthroughSeverityBadge } from "./WalkthroughNoteAnnotation";

const ATTENTION: Record<WalkthroughAttention, { label: string; className: string }> = {
  review: { label: "Review", className: "bg-destructive/10 text-destructive" },
  skim: { label: "Skim", className: "bg-warning/15 text-warning-foreground" },
  trust: { label: "Trust", className: "bg-muted text-muted-foreground" },
};

/** The small chip that says how closely a section wants reading. */
export function WalkthroughAttentionChip(props: {
  readonly attention: WalkthroughAttention;
  readonly reason?: string | undefined;
}) {
  const style = ATTENTION[props.attention];
  const chip = (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-px text-2xs font-semibold uppercase tracking-wide",
        style.className,
      )}
    >
      {style.label}
    </span>
  );
  if (!props.reason) return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{chip}</TooltipTrigger>
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The walkthrough as it appears in the thread: what the change does, then its
 * sections in reading order with how much review each wants and what the agent
 * flagged in it. The diffs themselves are never here; opening a section hands
 * the native diff panel that section's files. A superseded walkthrough keeps
 * only its title, since a newer card below it carries the reading.
 */
export const WalkthroughCard = memo(function WalkthroughCard(props: {
  readonly walkthrough: WalkthroughReference;
  /** The section the diff panel is reading from this card, if any. */
  readonly openSectionIndex: number | null;
  readonly superseded: boolean;
  readonly environmentId: EnvironmentId;
  readonly onOpenFile: (attachment: ChatFileAttachment) => void;
  readonly onOpenSection: (
    sectionIndex: number,
    reveal?: { readonly path: string; readonly line?: number },
  ) => void;
}) {
  const { walkthrough, openSectionIndex, superseded, onOpenSection, environmentId, onOpenFile } =
    props;
  const fileCount = new Set(walkthrough.sections.flatMap((s) => s.files.map((f) => f.path))).size;
  const totals = walkthrough.sections.reduce(
    (sum, section) => {
      const counts = walkthroughFlagCounts(section);
      return {
        blocker: sum.blocker + counts.blocker,
        question: sum.question + counts.question,
        nit: sum.nit + counts.nit,
        note: sum.note + counts.note,
      };
    },
    { blocker: 0, question: 0, nit: 0, note: 0 },
  );

  if (superseded) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground dark:bg-input/20">
        <HistoryIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground/80">{walkthrough.title}</span> · earlier
          version, replaced below
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg bg-secondary dark:bg-input/20">
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2 text-xs">
          <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {walkthrough.title}
          </span>
          {walkthrough.replaces ? (
            <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-2xs font-medium text-accent">
              Updated
            </span>
          ) : null}
          <span className="shrink-0 text-muted-foreground">
            {walkthrough.sections.length} section{walkthrough.sections.length === 1 ? "" : "s"} ·{" "}
            {fileCount} file{fileCount === 1 ? "" : "s"}
          </span>
        </div>
        {walkthrough.summary ? (
          <p className="mt-1.5 text-sm leading-6 text-foreground/90">{walkthrough.summary}</p>
        ) : null}
        {walkthrough.visual ? (
          <div className="mt-2 overflow-hidden rounded-md">
            <HtmlRenderFrame
              key={walkthrough.visual.attachmentId}
              environmentId={environmentId}
              htmlRender={walkthrough.visual}
              onOpen={onOpenFile}
            />
          </div>
        ) : null}
        {totals.blocker + totals.question + totals.nit + totals.note > 0 ? (
          <div className="mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span>Flagged</span>
            <WalkthroughSeverityBadge severity="blocker" count={totals.blocker} />
            <WalkthroughSeverityBadge severity="question" count={totals.question} />
            <WalkthroughSeverityBadge severity="nit" count={totals.nit} />
            <WalkthroughSeverityBadge severity="note" count={totals.note} />
          </div>
        ) : null}
      </div>
      <ol className="divide-y divide-border/40 border-t border-border/40">
        {walkthrough.sections.map((section, index) => {
          const open = openSectionIndex === index;
          const counts = walkthroughFlagCounts(section);
          const flags = section.files.flatMap((file) =>
            (file.flags ?? []).map((flag) => ({ path: file.path, ...flag })),
          );
          return (
            <li key={index}>
              <button
                type="button"
                aria-current={open ? "step" : undefined}
                onClick={() => onOpenSection(index)}
                className={cn(
                  "group/section flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]",
                  open && "bg-accent/[0.07] hover:bg-accent/[0.09]",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-2xs tabular-nums",
                    open
                      ? "bg-accent text-accent-foreground"
                      : "bg-foreground/[0.07] text-muted-foreground",
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {section.title}
                    </span>
                    {section.attention ? (
                      <WalkthroughAttentionChip
                        attention={section.attention}
                        reason={section.reason}
                      />
                    ) : null}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                    {section.summary}
                  </span>
                </span>
                <span className="mt-1 flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground">
                  <WalkthroughSeverityBadge severity="blocker" count={counts.blocker} />
                  <WalkthroughSeverityBadge severity="question" count={counts.question} />
                  {section.files.length} file{section.files.length === 1 ? "" : "s"}
                  <ChevronRightIcon
                    className="size-3.5 transition-transform group-hover/section:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </button>
              {flags.filter((flag) => flag.severity === "blocker" || flag.severity === "question")
                .length > 0 ? (
                <ul className="space-y-1 px-3 pb-2.5 pl-11">
                  {flags
                    .filter((flag) => flag.severity === "blocker" || flag.severity === "question")
                    .map((flag, flagIndex) => (
                      <li key={flagIndex}>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenSection(index, {
                              path: flag.path,
                              ...(flag.line === undefined ? {} : { line: flag.line }),
                            })
                          }
                          className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs leading-5 text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                        >
                          <WalkthroughSeverityBadge severity={flag.severity} count={1} />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2">{flag.text}</span>
                            <span className="font-mono text-2xs text-muted-foreground/80">
                              {flag.path.split("/").at(-1)}
                              {flag.line === undefined ? "" : `:${flag.line}`}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
});
