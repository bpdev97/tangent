/**
 * Tangent(FORK-NOTES-001): the notes for this build and the releases before it,
 * read from GitHub when the dialog opens. See docs/fork/release-notes.md.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  fetchReleaseNotes,
  hasReleaseNotesFor,
  RELEASE_NOTES_HISTORY_URL,
  selectReleaseNotes,
  type ReleaseNote,
  type ReleaseNoteEntry,
  type ReleaseUpdate,
} from "@t3tools/shared/releaseNotes";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { APP_VERSION } from "../../branding";
import {
  acknowledgeReleaseUpdate,
  closeReleaseNotes,
  releaseNotesStateAtom,
} from "../../lib/releaseNotes";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";

type ReleaseNotesLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "loaded"; readonly releases: ReadonlyArray<ReleaseNote> };

function useReleaseNotes(): ReleaseNotesLoad {
  const [load, setLoad] = useState<ReleaseNotesLoad>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchReleaseNotes()
      .then((releases) => {
        if (!cancelled) setLoad({ status: "loaded", releases });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return load;
}

function ReleaseNoteSection(props: {
  readonly release: ReleaseNoteEntry;
  readonly defaultOpen: boolean;
}) {
  const { release } = props;
  return (
    <Collapsible defaultOpen={props.defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 py-2 text-left">
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
        <span className="font-mono text-sm font-semibold">{release.version}</span>
        {release.isNew ? (
          <Badge variant="info" size="sm">
            New
          </Badge>
        ) : null}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pt-1 pb-3 pl-5.5">
          <ChatMarkdown text={release.body} cwd={undefined} headingLevelOffset={2} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ReleaseNotesBody(props: { readonly update: ReleaseUpdate | null }) {
  const load = useReleaseNotes();
  const published = load.status === "loaded" && hasReleaseNotesFor(load.releases, props.update);

  // The update counts as seen once its own notes are on screen.
  useEffect(() => {
    if (published) acknowledgeReleaseUpdate();
  }, [published]);

  if (load.status === "loading") {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner size="sm" />
        Loading release notes
      </div>
    );
  }

  const releases =
    load.status === "loaded"
      ? selectReleaseNotes({
          releases: load.releases,
          currentVersion: APP_VERSION,
          sinceVersion: props.update?.from,
        })
      : [];
  if (load.status === "failed") {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Could not reach GitHub for the release notes. They are also on the releases page.
      </p>
    );
  }

  return (
    <>
      {props.update && !published ? (
        <p className="text-sm text-muted-foreground">
          The notes for {props.update.to} are not published yet. The update notice stays until they
          are.
        </p>
      ) : releases.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No release notes are published for this build yet.
        </p>
      ) : null}
      <div className="divide-y divide-border">
        {releases.map((release, index) => (
          <ReleaseNoteSection key={release.version} release={release} defaultOpen={index === 0} />
        ))}
      </div>
    </>
  );
}

export function ReleaseNotesDialog() {
  const state = useAtomValue(releaseNotesStateAtom);

  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) closeReleaseNotes();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
          <DialogDescription>
            {state.update
              ? `Updated from ${state.update.from} to ${state.update.to}`
              : `You are on ${APP_VERSION}`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ReleaseNotesBody update={state.update} />
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            render={
              <a href={RELEASE_NOTES_HISTORY_URL} target="_blank" rel="noreferrer noopener" />
            }
          >
            View on GitHub
            <ExternalLinkIcon />
          </Button>
          <Button onClick={closeReleaseNotes}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
