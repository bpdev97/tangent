import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { LinearPrDestinationResolution, ScopedThreadRef } from "@t3tools/contracts";
import { linearReviewUrlForGitHubPullRequest } from "@t3tools/shared/linear";
import { ChevronDownIcon, ExternalLinkIcon, RefreshCwIcon, TicketIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { openUrlInPreview } from "../../browser/openFileInPreview";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { readLocalApi } from "../../localApi";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { serverEnvironment } from "../../state/server";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import type { PrStatusIndicator, ThreadPr } from "../ThreadStatusIndicators";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { cn } from "../../lib/utils";

function resolutionMessage(resolution: LinearPrDestinationResolution): string | null {
  switch (resolution.status) {
    case "resolved":
      return resolution.tickets.length === 0 && resolution.review === null
        ? "No Linear destination found"
        : resolution.stale
          ? "Showing the last successful result"
          : null;
    case "not_configured":
      return "Linear is not configured";
    case "invalid_pr":
      return "This is not a supported GitHub PR URL";
    case "unauthorized":
      return "Linear rejected the saved API key";
    case "rate_limited":
      return "Linear is rate limiting lookups";
    case "unreachable":
      return "Linear could not be reached";
    case "invalid_response":
      return "Linear returned an unexpected response";
  }
}

export function LinearPrBadge(props: {
  readonly pr: NonNullable<ThreadPr>;
  readonly status: PrStatusIndicator;
  readonly threadRef: ScopedThreadRef;
  readonly className?: string;
}) {
  const linear = useEnvironmentSettings(
    props.threadRef.environmentId,
    (settings) => settings.linearIntegration,
  );
  const configured = linear.apiKeyRedacted === true;
  const openPrLink = useOpenPrLink();
  const resolveDestinations = useAtomCommand(serverEnvironment.resolveLinearPrDestinations, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const [menuOpen, setMenuOpen] = useState(false);
  const [resolution, setResolution] = useState<LinearPrDestinationResolution | null>(null);
  const [loading, setLoading] = useState(false);
  const [transportFailed, setTransportFailed] = useState(false);
  const directReviewUrl = useMemo(
    () => linearReviewUrlForGitHubPullRequest(props.pr.url, linear.reviewRepositories),
    [linear.reviewRepositories, props.pr.url],
  );

  useEffect(() => {
    setResolution(null);
    setTransportFailed(false);
  }, [props.pr.url, linear.apiKeyRedacted, linear.reviewRepositories]);

  const load = useCallback(
    async (refresh = false): Promise<LinearPrDestinationResolution | null> => {
      setLoading(true);
      setTransportFailed(false);
      const result = await resolveDestinations({
        environmentId: props.threadRef.environmentId,
        input: { prUrl: props.pr.url, ...(refresh ? { refresh: true } : {}) },
      });
      setLoading(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) setTransportFailed(true);
        return null;
      }
      setResolution(result.value);
      return result.value;
    },
    [props.pr.url, props.threadRef.environmentId, resolveDestinations],
  );

  const openLinearUrl = useCallback(
    async (url: string) => {
      if (isPreviewSupportedInRuntime()) {
        const result = await openUrlInPreview({ threadRef: props.threadRef, url, openPreview });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Unable to open Linear in the side panel",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      try {
        await readLocalApi()?.shell.openExternal(url);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open Linear",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [openPreview, props.threadRef],
  );

  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      if (open && resolution === null && !loading) void load();
    },
    [load, loading, resolution],
  );

  const handleReviewClick = useCallback(
    async (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (directReviewUrl !== null) {
        await openLinearUrl(directReviewUrl);
        return;
      }
      setMenuOpen(true);
      if (resolution === null && !loading) void load();
    },
    [directReviewUrl, load, loading, openLinearUrl, resolution],
  );

  const badgeButtonClassName = cn("shrink-0 text-xs tabular-nums hover:underline", props.className);
  const reviewUrl = resolution?.review?.url ?? directReviewUrl;

  if (!configured) {
    return (
      <button
        type="button"
        onClick={(event) => openPrLink(event, props.pr.url)}
        className={badgeButtonClassName}
        aria-label={props.status.tooltip}
      >
        #{props.pr.number}
      </button>
    );
  }

  const menu = (
    <MenuPopup align="end" className="w-72">
      <MenuGroup>
        <MenuGroupLabel>Open pull request</MenuGroupLabel>
        <MenuItem onClick={(event) => openPrLink(event, props.pr.url)}>
          <ExternalLinkIcon />
          GitHub
        </MenuItem>
        {reviewUrl ? (
          <MenuItem onClick={() => void openLinearUrl(reviewUrl)}>
            <ExternalLinkIcon />
            Linear Review
          </MenuItem>
        ) : null}
        {resolution?.tickets.map((ticket) => (
          <MenuItem key={ticket.id} onClick={() => void openLinearUrl(ticket.url)}>
            <TicketIcon />
            <span className="min-w-0">
              <span className="block font-medium">{ticket.identifier}</span>
              <span className="block truncate text-xs text-muted-foreground">{ticket.title}</span>
            </span>
          </MenuItem>
        ))}
      </MenuGroup>
      {loading ? <MenuItem disabled>Looking up Linear destinations…</MenuItem> : null}
      {!loading && (resolution !== null || transportFailed) ? (
        <>
          {resolution && resolutionMessage(resolution) ? (
            <MenuItem disabled>{resolutionMessage(resolution)}</MenuItem>
          ) : transportFailed ? (
            <MenuItem disabled>Could not look up Linear destinations</MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem onClick={() => void load(true)}>
            <RefreshCwIcon />
            Refresh Linear destinations
          </MenuItem>
        </>
      ) : null}
    </MenuPopup>
  );

  if (linear.prBadgeBehavior === "choose") {
    return (
      <Menu open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <MenuTrigger
          render={
            <button
              type="button"
              className={cn(badgeButtonClassName, "inline-flex items-center gap-0.5")}
              aria-label={`${props.status.tooltip}. Choose destination`}
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          #{props.pr.number}
          <ChevronDownIcon className="size-2.5" />
        </MenuTrigger>
        {menu}
      </Menu>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center">
      <button
        type="button"
        onClick={
          linear.prBadgeBehavior === "linear-review"
            ? handleReviewClick
            : (event) => openPrLink(event, props.pr.url)
        }
        className={badgeButtonClassName}
        aria-label={props.status.tooltip}
      >
        #{props.pr.number}
      </button>
      <Menu open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <MenuTrigger
          render={
            <button
              type="button"
              className="inline-flex size-3.5 items-center justify-center text-current opacity-60 hover:opacity-100"
              aria-label={`Choose destination for PR #${props.pr.number}`}
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          <ChevronDownIcon className="size-2.5" />
        </MenuTrigger>
        {menu}
      </Menu>
    </span>
  );
}
