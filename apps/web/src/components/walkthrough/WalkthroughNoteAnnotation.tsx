// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { WalkthroughFlagSeverity } from "@t3tools/shared/walkthrough";
import { CircleAlertIcon, CircleHelpIcon, SparklesIcon, WrenchIcon } from "lucide-react";

import { cn } from "~/lib/utils";

/** Colour and icon per severity; the shape is the comment bubble's so the two read as one system. */
const SEVERITY = {
  blocker: {
    label: "Blocker",
    icon: CircleAlertIcon,
    bar: "border-destructive/70 bg-destructive/[0.07]",
    icon_: "text-destructive",
    badge: "bg-destructive/15 text-destructive",
  },
  question: {
    label: "Question",
    icon: CircleHelpIcon,
    bar: "border-warning/70 bg-warning/[0.08]",
    icon_: "text-warning-foreground",
    badge: "bg-warning/20 text-warning-foreground",
  },
  nit: {
    label: "Nit",
    icon: WrenchIcon,
    bar: "border-border bg-muted/50",
    icon_: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  note: {
    label: "Note",
    icon: SparklesIcon,
    bar: "border-accent/60 bg-accent/[0.06]",
    icon_: "text-accent",
    badge: "bg-accent/15 text-accent",
  },
} as const satisfies Record<WalkthroughFlagSeverity, unknown>;

/** The small count chip the card and header show for a severity. */
export function WalkthroughSeverityBadge(props: {
  readonly severity: WalkthroughFlagSeverity;
  readonly count: number;
}) {
  if (props.count === 0) return null;
  const style = SEVERITY[props.severity];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-2xs font-medium tabular-nums",
        style.badge,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {props.count}
    </span>
  );
}

/**
 * An agent's flag under a diff line, from the walkthrough section being read.
 * It is the agent speaking, not the reader, so it carries a severity colour
 * where a reader's comment carries the primary one.
 */
export function WalkthroughNoteAnnotation(props: {
  readonly severity: WalkthroughFlagSeverity;
  readonly text: string;
}) {
  const style = SEVERITY[props.severity];
  const Icon = style.icon;
  return (
    <div
      data-diff-comment-annotation
      className={cn(
        "flex min-w-0 items-start gap-2.5 border-s-2 px-3 py-2.5 font-sans text-foreground",
        style.bar,
      )}
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", style.icon_)} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm leading-5">
        <span className={cn("mr-1.5 text-2xs font-semibold uppercase tracking-wide", style.icon_)}>
          {style.label}
        </span>
        <span className="whitespace-pre-wrap">{props.text}</span>
      </p>
    </div>
  );
}
