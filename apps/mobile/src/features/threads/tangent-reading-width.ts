// Tangent(FORK-READWIDTH-001): see docs/fork/reading-width.md.
import { Platform } from "react-native";

import { ANDROID_READING_MAX_WIDTH } from "../../lib/layout";

/** Caps the thread's lane at upstream's Android reading width, which is already a no-op there. */
export function capThreadReadingWidth(upstreamMaxWidth: number | undefined): number {
  return Math.min(upstreamMaxWidth ?? Number.POSITIVE_INFINITY, ANDROID_READING_MAX_WIDTH);
}

/**
 * UIKit resizes a column or fold before JS hears the new width, so padding derived from that width
 * re-wraps every row twice. LegendList then anchors the end against sizes that never reach native
 * and lands past it. A native max width re-wraps them once, in the resize itself.
 */
export function threadLaneContainerStyle(input: {
  readonly maxWidth: number | undefined;
  readonly minimumPadding: number;
  readonly leftInset: number;
  readonly rightInset: number;
}) {
  if (Platform.OS !== "ios" || input.maxWidth === undefined) return null;
  return {
    alignSelf: "center",
    width: "100%",
    maxWidth: input.maxWidth + input.leftInset + input.rightInset,
    paddingLeft: input.minimumPadding + input.leftInset,
    paddingRight: input.minimumPadding + input.rightInset,
  } as const;
}
