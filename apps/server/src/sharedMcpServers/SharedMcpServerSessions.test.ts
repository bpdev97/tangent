import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  SHARED_MCP_SERVER_HEADER_REDACTED,
  type SharedMcpServers,
} from "@t3tools/contracts/sharedMcpServers";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  acpSharedMcpServers,
  codexSharedMcpServers,
  prepareSharedMcpServers,
  readSharedMcpServers,
  resolveSharedMcpServers,
  sharedHttpMcpServers,
} from "./SharedMcpServerSessions.ts";

const claude = ProviderInstanceId.make("claudeAgent");
const codex = ProviderInstanceId.make("codex");

const servers: SharedMcpServers = [
  {
    name: "executor",
    url: "http://127.0.0.1:4788/mcp",
    headers: [
      { name: "Authorization", value: "Bearer token" },
      // A redacted value whose secret is gone must not be sent.
      { name: "X-Missing", value: SHARED_MCP_SERVER_HEADER_REDACTED },
    ],
    enabled: true,
    disabledProviderInstances: [codex],
  },
  {
    name: "paused",
    url: "http://127.0.0.1:4789/mcp",
    headers: [],
    enabled: false,
    disabledProviderInstances: [],
  },
];

describe("shared MCP server sessions", () => {
  it("attaches enabled servers the provider instance has not opted out of", () => {
    assert.deepEqual(resolveSharedMcpServers(servers, claude), [
      {
        name: "executor",
        url: "http://127.0.0.1:4788/mcp",
        headers: { Authorization: "Bearer token" },
      },
    ]);
    assert.deepEqual(resolveSharedMcpServers(servers, codex), []);
  });

  it.effect("snapshots a thread's servers when its session opens", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-shared-mcp");
      const settings = Option.some({
        getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, mcpServers: servers }),
      });

      yield* prepareSharedMcpServers(settings, threadId, claude);
      assert.deepEqual(sharedHttpMcpServers(threadId), {
        executor: {
          type: "http",
          url: "http://127.0.0.1:4788/mcp",
          headers: { Authorization: "Bearer token" },
        },
      });
      assert.deepEqual(codexSharedMcpServers(threadId), {
        executor: {
          url: "http://127.0.0.1:4788/mcp",
          http_headers: { Authorization: "Bearer token" },
        },
      });

      const [acp] = acpSharedMcpServers(threadId, {
        command: "/usr/local/bin/node",
        entrypoint: "/opt/t3/bin.mjs",
      });
      assert.deepEqual(acp, {
        name: "executor",
        command: "/usr/local/bin/node",
        args: ["/opt/t3/bin.mjs", "shared-mcp-bridge"],
        env: [
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          { name: "T3_SHARED_MCP_ENDPOINT", value: "http://127.0.0.1:4788/mcp" },
          { name: "T3_SHARED_MCP_HEADERS", value: '{"Authorization":"Bearer token"}' },
        ],
      });

      // Reopening for an opted-out instance clears the snapshot.
      yield* prepareSharedMcpServers(settings, threadId, codex);
      assert.deepEqual(readSharedMcpServers(threadId), []);
    }),
  );
});
