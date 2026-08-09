import type { LinearTicketOpenBehavior } from "@t3tools/contracts";
import { linearAppUrl } from "@t3tools/shared/linear";

export async function openLinearTicket(input: {
  readonly behavior: LinearTicketOpenBehavior;
  readonly ticketUrl: string;
  readonly openInTangent: (url: string) => Promise<void> | void;
  readonly openExternal: (url: string) => Promise<void>;
}): Promise<void> {
  if (input.behavior === "tangent") {
    await input.openInTangent(input.ticketUrl);
    return;
  }

  const appUrl = linearAppUrl(input.ticketUrl);
  if (appUrl === null) {
    throw new Error("Linear returned an unsupported ticket URL.");
  }
  await input.openExternal(appUrl);
}
