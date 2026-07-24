import { describe, expect, it } from "@effect/vitest";

import {
  deriveToolCallPresentation,
  deriveToolCallSummary,
  mergeToolCallPresentations,
  mergeToolCallSummaries,
  toolCallSectionText,
} from "./index.ts";

describe("deriveToolCallSummary", () => {
  it("projects collapsed-row metadata without constructing full details", () => {
    const summary = deriveToolCallSummary({
      activityKind: "tool.completed",
      summary: "Call repository tool",
      payload: {
        itemId: "mcp-summary",
        itemType: "mcp_tool_call",
        status: "completed",
        data: {
          item: {
            server: "repository",
            tool: "search",
            arguments: { query: "work log" },
            result: { matches: Array.from({ length: 100 }, (_, index) => `match-${index}`) },
          },
        },
      },
    });

    expect(summary).toEqual({
      callId: "mcp-summary",
      category: "mcp",
      title: "repository · search",
      preview: '{"query":"work log"}',
      status: "completed",
      hasDetails: true,
    });
    expect(summary).not.toHaveProperty("sections");
    expect(summary).not.toHaveProperty("copyText");
  });

  it("merges sparse lifecycle summaries without requiring detail sections", () => {
    const started = deriveToolCallSummary({
      activityKind: "tool.started",
      summary: "Run tests started",
      payload: {
        itemId: "summary-command",
        itemType: "command_execution",
        title: "Run tests",
        data: { item: { command: "vp test", cwd: "/workspace" } },
      },
    });
    const completed = deriveToolCallSummary({
      activityKind: "tool.completed",
      summary: "Run tests",
      payload: {
        itemId: "summary-command",
        itemType: "command_execution",
        status: "completed",
        data: { item: { aggregatedOutput: "passed", exitCode: 0 } },
      },
    });

    expect(mergeToolCallSummaries(started, completed)).toEqual({
      callId: "summary-command",
      category: "command",
      title: "Run tests",
      preview: "passed",
      status: "completed",
      exitCode: 0,
      hasDetails: true,
    });
  });
});

describe("deriveToolCallPresentation", () => {
  it("presents a Codex command start as running before output exists", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.started",
      summary: "Ran command started",
      payload: {
        itemId: "command-live",
        itemType: "command_execution",
        status: "inProgress",
        title: "Ran command",
        data: {
          item: {
            id: "command-live",
            command: "python3 slow-script.py",
            aggregatedOutput: null,
            status: "inProgress",
          },
        },
      },
    });

    expect(presentation).toMatchObject({
      callId: "command-live",
      category: "command",
      title: "Running command",
      preview: "python3 slow-script.py",
      status: "inProgress",
      sections: [expect.objectContaining({ title: "Command", content: "python3 slow-script.py" })],
    });
  });

  it("projects Codex command metadata and output into structured sections", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Ran command",
      payload: {
        itemId: "command-1",
        itemType: "command_execution",
        status: "completed",
        title: "Run tests",
        data: {
          item: {
            id: "command-1",
            command: ["vp", "test"],
            cwd: "/workspace/t3code",
            aggregatedOutput: "42 tests passed",
            durationMs: 1234,
            exitCode: 0,
          },
        },
      },
      command: "vp test",
    });

    expect(presentation).toMatchObject({
      callId: "command-1",
      category: "command",
      title: "Run tests",
      preview: "vp test",
      status: "completed",
      cwd: "/workspace/t3code",
      durationMs: 1234,
      exitCode: 0,
    });
    expect(presentation?.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "code", title: "Command", content: "vp test" }),
        expect.objectContaining({ kind: "code", title: "Output", content: "42 tests passed" }),
      ]),
    );
  });

  it("keeps MCP arguments, results, and source links separate", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "browser · open",
      payload: {
        itemId: "mcp-1",
        itemType: "mcp_tool_call",
        data: {
          item: {
            id: "mcp-1",
            type: "mcpToolCall",
            server: "browser",
            tool: "open",
            arguments: { url: "https://example.com" },
            durationMs: 80,
            result: {
              content: [{ type: "text", text: "Opened" }],
              sources: [{ title: "Example", url: "https://example.com" }],
            },
          },
        },
      },
    });

    expect(presentation).toMatchObject({
      category: "mcp",
      title: "browser · open",
      durationMs: 80,
    });
    expect(presentation?.sections.map((section) => section.title)).toEqual([
      "Arguments",
      "Result",
      "Link",
    ]);
  });

  it("projects ACP file changes without depending on provider-specific rendering", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Applied patch",
      payload: {
        itemId: "acp-edit-1",
        itemType: "file_change",
        data: {
          toolCallId: "acp-edit-1",
          kind: "edit",
          rawInput: { path: "apps/web/src/App.tsx" },
          rawOutput: {
            changes: [
              {
                path: "apps/web/src/App.tsx",
                kind: "update",
                diff: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          },
        },
      },
    });

    expect(presentation?.category).toBe("file-change");
    expect(presentation?.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "files",
          files: [
            {
              path: "apps/web/src/App.tsx",
              change: "update",
              diff: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
        }),
      ]),
    );
  });

  it("projects ACP content blocks from provider tool calls", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Edit",
      payload: {
        itemId: "acp-edit-content-1",
        itemType: "file_change",
        data: {
          toolCallId: "acp-edit-content-1",
          kind: "edit",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Updated the configuration." },
            },
            {
              type: "diff",
              path: "config.json",
              oldText: '{"enabled":false}',
              newText: '{"enabled":true}',
            },
            {
              type: "content",
              content: {
                type: "resource_link",
                name: "Documentation",
                uri: "https://example.com/docs",
              },
            },
          ],
        },
      },
    });

    expect(presentation?.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Tool output", content: "Updated the configuration." }),
        expect.objectContaining({
          kind: "files",
          files: [
            expect.objectContaining({
              path: "config.json",
              diff: expect.stringContaining('{"enabled":true}'),
            }),
          ],
        }),
        expect.objectContaining({
          kind: "links",
          links: [{ label: "Documentation", url: "https://example.com/docs" }],
        }),
      ]),
    );
  });

  it("uses ACP kinds and preserved titles for file and web searches", () => {
    const fileSearch = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Searched files",
      payload: {
        itemId: "acp-search-1",
        itemType: "web_search",
        title: "Searched files",
        data: {
          toolCallId: "acp-search-1",
          kind: "search",
          providerTitle: "search: makeAcpToolCallEvent",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Found 3 matches." },
            },
          ],
        },
      },
    });
    const webSearch = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Searched web",
      payload: {
        itemId: "acp-web-1",
        itemType: "web_search",
        title: "Searched web",
        data: {
          toolCallId: "acp-web-1",
          kind: "fetch",
          providerTitle: "web search: ACP tool call rendering",
          content: [
            {
              type: "content",
              content: { type: "text", text: "**Results**\n\n- One\n- Two" },
            },
          ],
        },
      },
    });

    expect(fileSearch).toMatchObject({
      category: "search",
      title: "Searched files",
      preview: "makeAcpToolCallEvent",
    });
    expect(webSearch).toMatchObject({
      category: "web",
      title: "Searched web",
      preview: "ACP tool call rendering",
      sections: [
        expect.objectContaining({
          kind: "text",
          title: "Search query",
          content: "ACP tool call rendering",
        }),
        expect.objectContaining({
          kind: "text",
          title: "Tool output",
          format: "markdown",
        }),
      ],
    });
  });

  it("projects Claude tool input and result using the same model", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Read",
      payload: {
        itemId: "claude-read-1",
        itemType: "dynamic_tool_call",
        data: {
          toolName: "Read",
          input: { file_path: "/workspace/src/index.ts" },
          result: "export const ready = true;",
        },
      },
    });

    expect(presentation).toMatchObject({
      callId: "claude-read-1",
      category: "read",
      title: "Read",
    });
    expect(presentation?.sections.map((section) => section.title)).toEqual(["Input", "Result"]);
  });

  it("shows web search queries in the row preview and expanded details", () => {
    const codexSearch = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Web search",
      payload: {
        itemId: "search-1",
        itemType: "web_search",
        data: {
          item: {
            id: "search-1",
            type: "webSearch",
            query: "maintainable tool call UI patterns",
          },
        },
      },
    });
    const claudeSearch = deriveToolCallPresentation({
      activityKind: "tool.started",
      summary: "WebSearch started",
      payload: {
        itemId: "search-2",
        itemType: "dynamic_tool_call",
        data: {
          toolName: "WebSearch",
          input: {
            search_query: [{ q: "mobile tool call UX" }, { q: "desktop tool call UX" }],
          },
        },
      },
    });

    expect(codexSearch).toMatchObject({
      category: "web",
      preview: "maintainable tool call UI patterns",
      sections: [
        expect.objectContaining({
          kind: "text",
          title: "Search query",
          content: "maintainable tool call UI patterns",
        }),
      ],
    });
    expect(claudeSearch).toMatchObject({
      category: "web",
      preview: "mobile tool call UX +1 more",
    });
    expect(claudeSearch?.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Search queries",
          content: "mobile tool call UX\ndesktop tool call UX",
        }),
      ]),
    );
  });

  it("bounds very large output while retaining both ends", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Ran command",
      payload: {
        itemType: "command_execution",
        data: {
          item: {
            command: "build",
            aggregatedOutput: `start-${"x".repeat(40_000)}-end`,
          },
        },
      },
    });
    const output = presentation?.sections.find((section) => section.title === "Output");

    expect(output).toMatchObject({ kind: "code", truncated: true });
    expect(output ? toolCallSectionText(output) : "").toMatch(/^start-/u);
    expect(output ? toolCallSectionText(output) : "").toMatch(/-end$/u);
  });

  it("renders circular JSON with an explicit bounded diagnostic marker", () => {
    const input: Record<string, unknown> = { path: "/workspace/app.ts" };
    input.self = input;
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Custom tool",
      payload: {
        itemId: "custom-1",
        itemType: "dynamic_tool_call",
        data: { toolName: "Custom", input },
      },
    });
    const section = presentation?.sections.find((candidate) => candidate.title === "Input");

    expect(section).toMatchObject({ kind: "json", truncated: true });
    expect(section ? toolCallSectionText(section) : "").toContain("circular-reference");
  });

  it("caps recursive search-query collection", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.started",
      summary: "WebSearch started",
      payload: {
        itemId: "search-many",
        itemType: "dynamic_tool_call",
        data: {
          toolName: "WebSearch",
          input: {
            search_query: Array.from({ length: 10_000 }, (_, index) => ({ q: `query-${index}` })),
          },
        },
      },
    });

    expect(presentation?.preview).toBe("query-0 +19 more");
    expect(
      presentation?.sections.find((candidate) => candidate.title === "Search queries"),
    ).toMatchObject({
      kind: "text",
      content: Array.from({ length: 20 }, (_, index) => `query-${index}`).join("\n"),
    });
  });

  it("explains server-side payload truncation in the shared presentation", () => {
    const presentation = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Ran command",
      payload: {
        itemId: "command-truncated",
        itemType: "command_execution",
        data: { command: "vp test" },
        dataTruncation: {
          truncated: true,
          reasons: ["string-size", "collection-size"],
        },
      },
    });

    expect(presentation?.sections[0]).toMatchObject({
      kind: "text",
      title: "Payload notice",
      content: expect.stringContaining("string-size, collection-size"),
    });
  });
});

describe("mergeToolCallPresentations", () => {
  it("retains start metadata when a sparse completion arrives", () => {
    const started = deriveToolCallPresentation({
      activityKind: "tool.started",
      summary: "Run tests started",
      payload: {
        itemId: "command-1",
        itemType: "command_execution",
        title: "Run tests",
        data: { item: { command: "vp test", cwd: "/workspace" } },
      },
      command: "vp test",
    });
    const completed = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Run tests",
      payload: {
        itemId: "command-1",
        itemType: "command_execution",
        status: "completed",
        data: { item: { aggregatedOutput: "passed", exitCode: 0 } },
      },
    });

    expect(mergeToolCallPresentations(started, completed)).toMatchObject({
      callId: "command-1",
      category: "command",
      title: "Run tests",
      preview: "passed",
      status: "completed",
      cwd: "/workspace",
      exitCode: 0,
      sections: [
        expect.objectContaining({ title: "Command", content: "vp test" }),
        expect.objectContaining({ title: "Output", content: "passed" }),
      ],
    });
  });

  it("replaces lifecycle bookkeeping JSON when structured search details arrive", () => {
    const started = deriveToolCallPresentation({
      activityKind: "tool.started",
      summary: "Web search started",
      payload: {
        itemId: "search-1",
        itemType: "web_search",
        data: { item: { id: "search-1", type: "webSearch", query: "" }, startedAtMs: 123 },
      },
    });
    const completed = deriveToolCallPresentation({
      activityKind: "tool.completed",
      summary: "Web search",
      payload: {
        itemId: "search-1",
        itemType: "web_search",
        data: {
          item: {
            id: "search-1",
            type: "webSearch",
            query: "2002 Mazda Miata for sale price",
          },
        },
      },
    });

    const merged = mergeToolCallPresentations(started, completed);
    expect(merged?.preview).toBe("2002 Mazda Miata for sale price");
    expect(merged?.sections.map((section) => section.title)).toEqual(["Search query"]);
  });
});
