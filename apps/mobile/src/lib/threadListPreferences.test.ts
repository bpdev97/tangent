import { describe, expect, it } from "vite-plus/test";

import { isThreadListV2Enabled } from "./threadListPreferences";

describe("isThreadListV2Enabled", () => {
  it("enables the current thread list when no preference has been saved", () => {
    expect(isThreadListV2Enabled(undefined)).toBe(true);
    expect(isThreadListV2Enabled({})).toBe(true);
  });

  it("preserves an explicit per-device choice", () => {
    expect(isThreadListV2Enabled({ threadListV2Enabled: true })).toBe(true);
    expect(isThreadListV2Enabled({ threadListV2Enabled: false })).toBe(false);
  });
});
