import type { LinearDestinationOpenBehavior, LinearTicketDestination } from "@t3tools/contracts";

export function linearPrPrimaryDestinationUrls(input: {
  readonly behavior: LinearDestinationOpenBehavior;
  readonly reviewUrl: string | null;
  readonly tickets: ReadonlyArray<LinearTicketDestination>;
}): ReadonlyArray<string> {
  if (input.reviewUrl === null) return [];
  if (input.behavior === "linear-app") return [input.reviewUrl];

  const primaryTicketUrl = input.tickets[0]?.url;
  return primaryTicketUrl ? [primaryTicketUrl, input.reviewUrl] : [input.reviewUrl];
}
