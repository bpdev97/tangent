/**
 * Tangent(FORK-NOTES-001): the sidebar notice shown once after an update. It
 * stays until the notes are opened or it is dismissed, and looks like the
 * provider update notice it sits beside. See docs/fork/release-notes.md.
 */
import { useAtomValue } from "@effect/atom-react";
import { SparklesIcon, XIcon } from "lucide-react";

import {
  acknowledgeReleaseUpdate,
  openReleaseNotes,
  releaseNotesStateAtom,
} from "../../lib/releaseNotes";

export function SidebarReleaseNotesPill() {
  const state = useAtomValue(releaseNotesStateAtom);
  if (!state.update || state.acknowledged) return null;

  return (
    <div className="flex min-h-7 w-full shrink-0 items-center rounded-lg bg-sidebar-control-surface text-2xs leading-4 font-medium text-sidebar-foreground has-[button[data-release-notes-main]:hover]:bg-sidebar-row-hover">
      <button
        type="button"
        data-release-notes-main
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={openReleaseNotes}
      >
        <SparklesIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 wrap-break-word">
          Updated to {state.update.to} ·{" "}
          <span className="underline decoration-dotted underline-offset-4">What's new</span>
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss release notes notice"
        className="mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={acknowledgeReleaseUpdate}
      >
        <XIcon className="size-3.5 shrink-0" />
      </button>
    </div>
  );
}
