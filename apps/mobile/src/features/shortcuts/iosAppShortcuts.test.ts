import { describe, expect, it } from "vite-plus/test";

import { parseIosAppShortcutAction } from "./iosAppShortcuts";

describe("parseIosAppShortcutAction", () => {
  it("accepts the two fixed iOS App Shortcut actions", () => {
    expect(parseIosAppShortcutAction({ action: "new-chat", requestId: "request-1" })).toEqual({
      action: "new-chat",
      requestId: "request-1",
    });
    expect(
      parseIosAppShortcutAction({ action: "dictate-new-chat", requestId: " request-2 " }),
    ).toEqual({ action: "dictate-new-chat", requestId: "request-2" });
  });

  it("rejects malformed, unknown, and unbounded native payloads", () => {
    expect(parseIosAppShortcutAction(null)).toBe(null);
    expect(parseIosAppShortcutAction({ action: "new-task", requestId: "request-1" })).toBe(null);
    expect(parseIosAppShortcutAction({ action: "new-chat", requestId: "   " })).toBe(null);
    expect(parseIosAppShortcutAction({ action: "new-chat", requestId: "x".repeat(129) })).toBe(
      null,
    );
  });
});
