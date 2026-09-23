import { HermesSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildHermesGatewayArgs,
  hermesApprovalChoice,
  hermesModelSwitchValue,
  parseHermesModelSelection,
  parseHermesReleaseVersion,
  parseHermesUpdateCommand,
} from "./HermesGatewaySupport.ts";
import { consumeHermesMediaText, renderHermesMediaText } from "./HermesMedia.ts";
import { projectHermesTool } from "./HermesTools.ts";

describe("Hermes gateway support", () => {
  it("defaults to the user's hermes binary and default profile, rejecting path-like profiles", () => {
    const decode = Schema.decodeUnknownSync(HermesSettings);
    expect(decode({})).toMatchObject({ enabled: true, binaryPath: "hermes", profile: "default" });
    expect(decode({ profile: "research_2" }).profile).toBe("research_2");
    for (const profile of ["../other", "a b", "-flag"]) {
      expect(() => decode({ profile })).toThrow();
    }
  });

  it("launches an isolated loopback backend for the instance profile", () => {
    expect(buildHermesGatewayArgs("research")).toEqual([
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

  it("never grants Hermes's permanent approval scope", () => {
    expect(hermesApprovalChoice("accept")).toBe("once");
    expect(hermesApprovalChoice("acceptForSession")).toBe("session");
    expect(hermesApprovalChoice("acceptAlways")).toBe("session");
    expect(hermesApprovalChoice("decline")).toBe("deny");
    expect(hermesApprovalChoice("cancel")).toBe("deny");
  });

  it("qualifies models with their provider", () => {
    expect(parseHermesModelSelection("default")).toBeUndefined();
    const selection = parseHermesModelSelection("openrouter:anthropic/claude-sonnet-5");
    expect(selection).toEqual({
      id: "openrouter:anthropic/claude-sonnet-5",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5",
    });
    expect(hermesModelSwitchValue(selection!)).toBe(
      "anthropic/claude-sonnet-5 --provider openrouter",
    );
  });

  it("runs the gateway-reported update command, not guidance text", () => {
    expect(parseHermesUpdateCommand("hermes update", "/opt/hermes/bin/hermes")).toEqual({
      executable: "/opt/hermes/bin/hermes",
      args: ["update"],
    });
    expect(
      parseHermesUpdateCommand("docker pull nousresearch/hermes-agent:latest", "hermes"),
    ).toEqual({ executable: "docker", args: ["pull", "nousresearch/hermes-agent:latest"] });
    expect(
      parseHermesUpdateCommand(
        "Update Hermes through the Nix source that installed it (e.g. nix profile upgrade, or ...)",
        "hermes",
      ),
    ).toBeNull();
    expect(parseHermesUpdateCommand("", "hermes")).toBeNull();
  });

  it("reads the version from a release name", () => {
    expect(parseHermesReleaseVersion("Hermes Agent v0.21.4 (v2026.9.21)")).toBe("0.21.4");
    expect(parseHermesReleaseVersion(null)).toBeNull();
  });
});

describe("Hermes MEDIA directives", () => {
  it("links files and expands the Hermes host home", () => {
    expect(renderHermesMediaText("Saved.\nMEDIA: ~/out/chart_1.png", "/home/me")).toBe(
      "Saved.\n[chart\\_1.png](</home/me/out/chart_1.png>)",
    );
    expect(renderHermesMediaText("MEDIA: '/tmp/with space.png'", undefined)).toBe(
      "[with space.png](</tmp/with space.png>)",
    );
    expect(renderHermesMediaText('see "MEDIA:/tmp/r.pdf" now', undefined)).toBe(
      "see [r.pdf](</tmp/r.pdf>) now",
    );
  });

  it("buffers only a possible partial directive while streaming", () => {
    expect(consumeHermesMediaText("Hello ME", false, undefined)).toEqual({
      output: "Hello ",
      pending: "ME",
    });
    expect(consumeHermesMediaText("MEDIA: /tmp/x.png", false, undefined)).toEqual({
      output: "",
      pending: "MEDIA: /tmp/x.png",
    });
    expect(consumeHermesMediaText("MEDIA: /tmp/x.png\n", false, undefined).output).toBe(
      "[x.png](</tmp/x.png>)\n",
    );
  });
});

describe("Hermes tool projection", () => {
  it("maps commands, file changes, searches, MCP calls, and bounded display fields", () => {
    expect(
      projectHermesTool({ tool_id: "1", name: "terminal", args: { command: "ls" } }).item,
    ).toEqual({ type: "command_execution", input: "ls" });
    expect(
      projectHermesTool({
        tool_id: "2",
        name: "patch",
        args: { patch: "*** Update File: a.ts\n*** Add File: b.ts" },
        result: {},
        inline_diff: "--- a\n+++ b",
      }).item,
    ).toEqual({
      type: "file_change",
      fileName: "a.ts",
      diffStr: "--- a\n+++ b",
      changes: [
        { operation: "update", path: "a.ts" },
        { operation: "add", path: "b.ts" },
      ],
    });
    expect(
      projectHermesTool({ tool_id: "3", name: "web_search", args: { query: "effect" } }).item,
    ).toEqual({ type: "web_search", patterns: ["effect"] });
    const mcp = projectHermesTool({
      tool_id: "4",
      name: "mcp__github__list_prs",
      args: { repo: "t3" },
    });
    expect(mcp.title).toBe("github · list_prs");
    expect(mcp.item).toEqual({
      type: "dynamic_tool",
      toolName: "mcp__github__list_prs",
      input: { repo: "t3" },
    });
    // Typed browser input is not copied; only the bounded display field is kept.
    expect(
      projectHermesTool({
        tool_id: "5",
        name: "browser_type",
        args: { text: "hunter2" },
        context: "Typing into the login form",
      }).item,
    ).toEqual({
      type: "dynamic_tool",
      toolName: "browser_type",
      input: { summary: "Typing into the login form" },
    });
  });
});
