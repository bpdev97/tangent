// Tangent(FORK-READWIDTH-001): see docs/fork/reading-width.md.
import { ANDROID_READING_MAX_WIDTH } from "../../lib/layout";

/** Caps the thread's lane at upstream's Android reading width, which is already a no-op there. */
export function capThreadReadingWidth(upstreamMaxWidth: number | undefined): number {
  return Math.min(upstreamMaxWidth ?? Number.POSITIVE_INFINITY, ANDROID_READING_MAX_WIDTH);
}
