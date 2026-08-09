import { describe, expect, it } from "vite-plus/test";

import { linearPrPrimaryDestinationUrls } from "./linearPrPrimaryDestinations";

const REVIEW_URL = "https://linear.review/bpdev97/tangent/pull/52";
const TICKETS = [
  {
    id: "issue-1",
    identifier: "TAN-42",
    title: "Make Linear feel native",
    url: "https://linear.app/tangent/issue/TAN-42",
  },
  {
    id: "issue-2",
    identifier: "TAN-43",
    title: "Keep the primary action focused",
    url: "https://linear.app/tangent/issue/TAN-43",
  },
];

describe("linearPrPrimaryDestinationUrls", () => {
  it("opens the primary ticket and then Review in Tangent", () => {
    expect(
      linearPrPrimaryDestinationUrls({
        behavior: "tangent",
        reviewUrl: REVIEW_URL,
        tickets: TICKETS,
      }),
    ).toEqual([TICKETS[0]?.url, REVIEW_URL]);
  });

  it("opens only Review in the Linear app", () => {
    expect(
      linearPrPrimaryDestinationUrls({
        behavior: "linear-app",
        reviewUrl: REVIEW_URL,
        tickets: TICKETS,
      }),
    ).toEqual([REVIEW_URL]);
  });

  it("falls back to the destination menu when Review is unavailable", () => {
    expect(
      linearPrPrimaryDestinationUrls({
        behavior: "tangent",
        reviewUrl: null,
        tickets: TICKETS,
      }),
    ).toEqual([]);
  });
});
