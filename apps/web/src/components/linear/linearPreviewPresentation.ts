import type { LinearPrDestinationResolution } from "@t3tools/contracts";

import type { LinearPreviewPresentation } from "~/rightPanelStore";

export function buildLinearPreviewPresentation(input: {
  readonly reviewUrl: string | null;
  readonly resolution: LinearPrDestinationResolution | null;
  readonly lookupComplete: boolean;
}): LinearPreviewPresentation {
  const resolved = input.resolution?.status === "resolved" ? input.resolution : null;
  return {
    _tag: "linear",
    reviewUrl: resolved?.review?.url ?? input.reviewUrl,
    tickets: resolved?.tickets ?? [],
    ticketLookup: !input.lookupComplete ? "loading" : resolved ? "ready" : "unavailable",
  };
}
