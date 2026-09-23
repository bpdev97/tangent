import { ProviderInstanceId } from "@t3tools/contracts";
import { SHARED_MCP_SERVER_HEADER_REDACTED } from "@t3tools/contracts/sharedMcpServers";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_SHARED_MCP_SERVER_DRAFT,
  emptySharedMcpHeader,
  renameSharedMcpHeader,
  sharedMcpServerDraft,
  sharedMcpServerFromDraft,
} from "./sharedMcpServers.logic";

const saved = {
  name: "executor",
  url: "http://127.0.0.1:4788/mcp",
  headers: [{ name: "Authorization", value: SHARED_MCP_SERVER_HEADER_REDACTED }],
  enabled: true,
  disabledProviderInstances: [ProviderInstanceId.make("codex")],
};

describe("shared MCP server drafts", () => {
  it("keeps a saved header value the user leaves blank", () => {
    const draft = sharedMcpServerDraft(saved);
    expect(draft.headers).toMatchObject([{ name: "Authorization", value: "", saved: true }]);
    expect(sharedMcpServerFromDraft(draft, [])).toEqual({ server: saved });
  });

  it("asks for a new value when a saved header is renamed", () => {
    const [header] = sharedMcpServerDraft(saved).headers;
    expect(renameSharedMcpHeader(header!, "X-Api-Key")).toMatchObject({
      name: "X-Api-Key",
      value: "",
      saved: false,
    });
  });

  it("ignores blank header rows and trims the name and URL", () => {
    const result = sharedMcpServerFromDraft(
      {
        ...EMPTY_SHARED_MCP_SERVER_DRAFT,
        name: " executor ",
        url: " http://127.0.0.1:4788/mcp ",
        headers: [emptySharedMcpHeader()],
      },
      [],
    );
    expect(result).toEqual({
      server: {
        name: "executor",
        url: "http://127.0.0.1:4788/mcp",
        headers: [],
        enabled: true,
        disabledProviderInstances: [],
      },
    });
  });

  it("rejects reserved, duplicate, and malformed servers", () => {
    const draft = { ...EMPTY_SHARED_MCP_SERVER_DRAFT, url: "http://127.0.0.1:4788/mcp" };
    expect(sharedMcpServerFromDraft({ ...draft, name: "t3-code" }, [])).toHaveProperty("error");
    expect(sharedMcpServerFromDraft({ ...draft, name: "Executor" }, [saved])).toHaveProperty(
      "error",
    );
    expect(sharedMcpServerFromDraft({ ...draft, name: "has space" }, [])).toHaveProperty("error");
    expect(
      sharedMcpServerFromDraft({ ...draft, name: "executor", url: "ftp://host" }, []),
    ).toHaveProperty("error");
  });
});
