// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { EnvironmentId } from "@t3tools/contracts";
import { walkthroughFlagCounts, type WalkthroughReference } from "@t3tools/shared/walkthrough";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GitCommitHorizontalIcon,
  ImageIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import type { ChatFileAttachment } from "~/types";

import { HtmlRenderFrame } from "../chat/HtmlRenderFrame";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WalkthroughAttentionChip } from "./WalkthroughCard";
import { WalkthroughSeverityBadge } from "./WalkthroughNoteAnnotation";

/**
 * Shown in place of a section while the diff panel cannot show the turn a
 * walkthrough was written for, because that turn is still running and has
 * no checkpoint yet.
 */
export function WalkthroughWaitingHeader(props: {
  readonly walkthrough: WalkthroughReference;
  readonly onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-background px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
        {props.walkthrough.title}
      </span>
      <span className="text-2xs text-muted-foreground">
        Waiting for the turn to finish before showing its changes.
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Leave walkthrough"
              onClick={props.onClose}
            />
          }
        >
          <XIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Show all changes</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * The section being read, above the diff panel's viewer: counter, title, how
 * closely it wants reading, the agent's paragraph, and the files it covers. A
 * file the diff no longer has is listed but struck through, so a walkthrough
 * written before a rebase still reads; a notice says when the branch has
 * moved on since the walkthrough was written.
 */
export function WalkthroughSectionHeader(props: {
  readonly walkthrough: WalkthroughReference;
  readonly sectionIndex: number;
  readonly presentPaths: ReadonlySet<string>;
  /** The branch has changed since `publishedAt`, so the sections may be behind. */
  readonly stale: boolean;
  readonly environmentId: EnvironmentId;
  readonly onOpenFile: (attachment: ChatFileAttachment) => void;
  readonly onSelectSection: (index: number) => void;
  readonly onSelectFile: (path: string) => void;
  readonly onClose: () => void;
}) {
  const {
    walkthrough,
    sectionIndex,
    presentPaths,
    stale,
    onSelectSection,
    onSelectFile,
    onClose,
    environmentId,
    onOpenFile,
  } = props;
  // A diagram starts open on the section it belongs to; the reader can tuck
  // it away while working through the files.
  const [visualHidden, setVisualHidden] = useState(false);
  const section = walkthrough.sections[sectionIndex];
  if (!section) return null;
  const total = walkthrough.sections.length;
  const pad = (n: number) => String(n).padStart(2, "0");
  const counts = walkthroughFlagCounts(section);
  return (
    <div className="shrink-0 border-b border-border/70 bg-background">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span className="font-mono text-2xs tabular-nums text-muted-foreground">
          {pad(sectionIndex + 1)} / {pad(total)}
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {walkthrough.title}
        </span>
        {walkthrough.headCommit ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={
                    stale
                      ? "inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-px font-mono text-2xs text-warning-foreground"
                      : "inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground"
                  }
                />
              }
            >
              <GitCommitHorizontalIcon className="size-3" aria-hidden="true" />
              {walkthrough.headCommit.slice(0, 7)}
              {stale ? " · branch moved" : ""}
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {stale
                ? "The agent has made changes since this walkthrough was written. Ask it to update the walkthrough."
                : "Written at this commit."}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous section"
          disabled={sectionIndex === 0}
          onClick={() => onSelectSection(sectionIndex - 1)}
        >
          <ChevronLeftIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next section"
          disabled={sectionIndex === total - 1}
          onClick={() => onSelectSection(sectionIndex + 1)}
        >
          <ChevronRightIcon className="size-3.5" />
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Leave walkthrough"
                onClick={onClose}
              />
            }
          >
            <XIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Show all changes</TooltipPopup>
        </Tooltip>
      </div>
      {/* A long summary or a tall diagram scrolls here rather than pushing the diff off screen. */}
      <div className="max-h-[40vh] overflow-y-auto px-3 pb-3 pt-1">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold leading-5 text-foreground">
            {section.title}
          </h2>
          {section.attention ? (
            <WalkthroughAttentionChip attention={section.attention} reason={section.reason} />
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <WalkthroughSeverityBadge severity="blocker" count={counts.blocker} />
            <WalkthroughSeverityBadge severity="question" count={counts.question} />
            <WalkthroughSeverityBadge severity="nit" count={counts.nit} />
            <WalkthroughSeverityBadge severity="note" count={counts.note} />
          </span>
        </div>
        {section.reason ? (
          <p className="mt-0.5 text-2xs text-muted-foreground">{section.reason}</p>
        ) : null}
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{section.summary}</p>
        {section.visual ? (
          <div className="mt-2">
            <Button variant="ghost-muted" size="xs" onClick={() => setVisualHidden((h) => !h)}>
              <ImageIcon className="size-3.5" />
              {visualHidden ? "Show diagram" : "Hide diagram"}
            </Button>
            {visualHidden ? null : (
              <div className="mt-1 overflow-hidden rounded-md">
                <HtmlRenderFrame
                  key={`${sectionIndex}:${section.visual.attachmentId}`}
                  environmentId={environmentId}
                  htmlRender={section.visual}
                  onOpen={onOpenFile}
                />
              </div>
            )}
          </div>
        ) : null}
        <ul className="mt-2 flex flex-wrap gap-1">
          {section.files.map((file) => {
            const present = presentPaths.has(file.path);
            const name = file.path.split("/").at(-1) ?? file.path;
            const flagged = (file.flags ?? []).length;
            return (
              <li key={file.path}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        disabled={!present}
                        onClick={() => onSelectFile(file.path)}
                        className="inline-flex max-w-56 items-center gap-1 truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-2xs text-foreground hover:bg-muted disabled:text-muted-foreground/60 disabled:line-through disabled:hover:bg-muted/40"
                      />
                    }
                  >
                    {name}
                    {flagged > 0 ? (
                      <span className="rounded-full bg-foreground/10 px-1 text-3xs tabular-nums">
                        {flagged}
                      </span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    {present ? file.path : `${file.path} (not in this diff)`}
                  </TooltipPopup>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
