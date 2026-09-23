import { assert, describe, it } from "@effect/vitest";

import { withSharedMcpHeaders } from "./sharedMcpBridge.ts";

describe("shared MCP bridge", () => {
  it("replaces the bridge's T3 credential with the server's own headers", async () => {
    const seen: Array<Headers> = [];
    const fetchWithHeaders = withSharedMcpHeaders({ "X-Api-Key": "secret" }, async (_url, init) => {
      seen.push(new Headers(init?.headers));
      return new Response(null, { status: 202 });
    });

    await fetchWithHeaders("http://127.0.0.1:4788/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "",
        "mcp-session-id": "session-1",
      },
    });

    const [headers] = seen;
    assert.isFalse(headers?.has("authorization"));
    assert.equal(headers?.get("x-api-key"), "secret");
    assert.equal(headers?.get("mcp-session-id"), "session-1");
    assert.equal(headers?.get("content-type"), "application/json");
  });
});
