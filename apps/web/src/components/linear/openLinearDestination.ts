import type { LinearDestinationOpenBehavior } from "@t3tools/contracts";
import { linearAppUrl } from "@t3tools/shared/linear";

export async function openLinearDestination(input: {
  readonly behavior: LinearDestinationOpenBehavior;
  readonly destinationUrl: string;
  readonly openInSidePanel: (url: string) => Promise<void> | void;
  readonly openExternal: (url: string) => Promise<void>;
}): Promise<void> {
  if (input.behavior === "tangent") {
    await input.openInSidePanel(input.destinationUrl);
    return;
  }

  const appUrl = linearAppUrl(input.destinationUrl);
  if (appUrl === null) {
    throw new Error("Linear returned an unsupported destination URL.");
  }
  await input.openExternal(appUrl);
}
