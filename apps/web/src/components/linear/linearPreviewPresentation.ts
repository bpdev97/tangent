import type { LinearPrDestinationResolution } from "@t3tools/contracts";

import type { LinearPreviewPresentation } from "~/rightPanelStore";

export function isActiveLinearDestination(currentUrl: string, destinationUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const destination = new URL(destinationUrl);
    return (
      current.origin === destination.origin &&
      current.pathname.replace(/\/$/, "") === destination.pathname.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}

export function linearPreviewTabTitle(presentation: LinearPreviewPresentation): string {
  const destinationUrl = presentation.destinationUrl;
  if (destinationUrl === presentation.reviewUrl) return "Linear Review";
  return (
    presentation.tickets.find((ticket) => ticket.url === destinationUrl)?.identifier ?? "Linear"
  );
}

export function buildLinearPreviewPresentation(input: {
  readonly reviewUrl: string | null;
  readonly resolution: LinearPrDestinationResolution | null;
  readonly lookupComplete: boolean;
  readonly destinationUrl?: string;
}): LinearPreviewPresentation {
  const resolved = input.resolution?.status === "resolved" ? input.resolution : null;
  return {
    _tag: "linear",
    reviewUrl: resolved?.review?.url ?? input.reviewUrl,
    tickets: resolved?.tickets ?? [],
    ticketLookup: !input.lookupComplete ? "loading" : resolved ? "ready" : "unavailable",
    ...(input.destinationUrl === undefined ? {} : { destinationUrl: input.destinationUrl }),
  };
}
