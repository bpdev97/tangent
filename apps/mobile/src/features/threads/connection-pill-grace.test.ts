import { describe, expect, it } from "vite-plus/test";

import { connectionPillPhase } from "./connection-pill-grace";

describe("connectionPillPhase", () => {
  it("hides a connect or reconnect until the grace period passes", () => {
    expect(connectionPillPhase("reconnecting", false)).toBe("connected");
    expect(connectionPillPhase("connecting", false)).toBe("connected");
    expect(connectionPillPhase("reconnecting", true)).toBe("reconnecting");
    expect(connectionPillPhase("connecting", true)).toBe("connecting");
  });

  it("shows phases that will not clear on their own immediately", () => {
    for (const phase of ["offline", "error", "unsupported", "available"] as const) {
      expect(connectionPillPhase(phase, false)).toBe(phase);
    }
  });
});
