import type { LinearPrDestinationResolution } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildLinearPreviewPresentation } from "./linearPreviewPresentation";

const resolved: LinearPrDestinationResolution = {
  status: "resolved",
  tickets: [
    {
      id: "issue-1",
      identifier: "TAN-42",
      title: "Make Linear feel native",
      url: "https://linear.app/tangent/issue/TAN-42",
    },
  ],
  review: { url: "https://linear.review/bpdev97/tangent/pull/52" },
  stale: false,
};

describe("buildLinearPreviewPresentation", () => {
  it("shows Review immediately while ticket lookup is in flight", () => {
    expect(
      buildLinearPreviewPresentation({
        reviewUrl: "https://linear.review/bpdev97/tangent/pull/52",
        resolution: null,
        lookupComplete: false,
      }),
    ).toEqual({
      _tag: "linear",
      reviewUrl: "https://linear.review/bpdev97/tangent/pull/52",
      tickets: [],
      ticketLookup: "loading",
    });
  });

  it("adds resolved tickets and the canonical Review destination", () => {
    expect(
      buildLinearPreviewPresentation({
        reviewUrl: null,
        resolution: resolved,
        lookupComplete: true,
      }),
    ).toEqual({
      _tag: "linear",
      reviewUrl: "https://linear.review/bpdev97/tangent/pull/52",
      tickets: resolved.tickets,
      ticketLookup: "ready",
    });
  });

  it("marks a failed lookup unavailable without hiding an eligible Review", () => {
    expect(
      buildLinearPreviewPresentation({
        reviewUrl: "https://linear.review/bpdev97/tangent/pull/52",
        resolution: null,
        lookupComplete: true,
      }),
    ).toEqual({
      _tag: "linear",
      reviewUrl: "https://linear.review/bpdev97/tangent/pull/52",
      tickets: [],
      ticketLookup: "unavailable",
    });
  });
});
