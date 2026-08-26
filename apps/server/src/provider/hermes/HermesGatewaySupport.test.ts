import { describe, expect, it } from "vite-plus/test";

import {
  buildHermesGatewayArgs,
  hermesApprovalChoice,
  parseHermesGatewayConversationCursor,
  parseHermesModelSelection,
  shouldAutoApproveHermes,
} from "./HermesGatewaySupport.ts";

describe("HermesGatewaySupport", () => {
  it("builds an isolated loopback gateway command", () => {
    expect(buildHermesGatewayArgs({ profile: "research" })).toEqual([
      "--profile",
      "research",
      "serve",
      "--isolated",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ]);
  });

  it("accepts only durable TUI gateway cursors", () => {
    expect(
      parseHermesGatewayConversationCursor({
        schemaVersion: 2,
        transport: "tui-gateway",
        sessionId: " stored-1 ",
      }),
    ).toEqual({ schemaVersion: 2, transport: "tui-gateway", sessionId: "stored-1" });
    expect(
      parseHermesGatewayConversationCursor({
        schemaVersion: 1,
        transport: "acp",
        sessionId: "lost-session",
      }),
    ).toBeUndefined();
  });

  it("maps model and approval selections without widening permissions", () => {
    expect(parseHermesModelSelection("openrouter:x-ai/grok-4.5:free")).toEqual({
      id: "openrouter:x-ai/grok-4.5:free",
      provider: "openrouter",
      model: "x-ai/grok-4.5:free",
    });
    expect(hermesApprovalChoice("acceptForSession")).toBe("session");
    expect(hermesApprovalChoice("acceptAlways")).toBe("session");
    expect(hermesApprovalChoice("decline")).toBe("deny");
    expect(shouldAutoApproveHermes("full-access")).toBe(true);
    expect(shouldAutoApproveHermes("auto-accept-edits")).toBe(false);
  });
});
