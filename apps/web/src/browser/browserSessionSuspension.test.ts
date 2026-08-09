import { describe, expect, it } from "vite-plus/test";

import { shouldMountThreadBrowserSessions } from "./browserSessionSuspension";

describe("shouldMountThreadBrowserSessions", () => {
  it("suspends an explicitly settled thread after navigation leaves it", () => {
    expect(
      shouldMountThreadBrowserSessions({
        activeThreadKey: "environment:other-thread",
        settledOverride: "settled",
        threadKey: "environment:settled-thread",
      }),
    ).toBe(false);
  });

  it("keeps the active thread mounted while it is explicitly settled", () => {
    expect(
      shouldMountThreadBrowserSessions({
        activeThreadKey: "environment:settled-thread",
        settledOverride: "settled",
        threadKey: "environment:settled-thread",
      }),
    ).toBe(true);
  });

  it.each([null, undefined, "active"] as const)(
    "keeps an inactive thread mounted for the %s lifecycle state",
    (settledOverride) => {
      expect(
        shouldMountThreadBrowserSessions({
          activeThreadKey: "environment:other-thread",
          settledOverride,
          threadKey: "environment:thread",
        }),
      ).toBe(true);
    },
  );
});
