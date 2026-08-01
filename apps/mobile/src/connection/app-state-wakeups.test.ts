import { describe, expect, it } from "@effect/vitest";

import { mobileApplicationActiveWakeup } from "./app-state-wakeups";

describe("mobileApplicationActiveWakeup", () => {
  it("probes the existing session whenever the app becomes active", () => {
    expect(mobileApplicationActiveWakeup()).toBe("application-active-probe");
  });
});
