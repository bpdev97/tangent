import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildGenericChatProviderInput,
  extractGenericChatUserInput,
  findGenericChatProject,
  GENERIC_CHAT_PROJECT_ID,
  isGenericChatProject,
  isGenericChatProjectId,
  isGenericChatThread,
} from "./genericChat.ts";

describe("generic chat", () => {
  it("recognizes only the reserved managed project", () => {
    expect(isGenericChatProjectId(GENERIC_CHAT_PROJECT_ID)).toBe(true);
    expect(isGenericChatProjectId(ProjectId.make("regular-project"))).toBe(false);
    expect(isGenericChatProject({ id: GENERIC_CHAT_PROJECT_ID })).toBe(true);
    expect(isGenericChatProject(null)).toBe(false);
    expect(isGenericChatThread({ projectId: GENERIC_CHAT_PROJECT_ID })).toBe(true);
    expect(isGenericChatThread({ projectId: ProjectId.make("regular-project") })).toBe(false);
    expect(isGenericChatThread(null)).toBe(false);
  });

  it("adds hidden no-filesystem context without changing the stored user message", () => {
    const providerInput = buildGenericChatProviderInput("  Explain monads simply.  ");

    expect(providerInput).toContain(
      "No user project, repository, or working directory is attached",
    );
    expect(providerInput).toContain(
      "Do not inspect, enumerate, search, read, or modify local files",
    );
    expect(providerInput).toContain("<user_message>\nExplain monads simply.\n</user_message>");
    expect(providerInput.indexOf("<t3_code_generic_chat_context>")).toBeGreaterThan(
      providerInput.indexOf("</user_message>"),
    );
  });

  it("extracts the user-authored portion from a generated provider input", () => {
    const providerInput = buildGenericChatProviderInput("/fast status");

    expect(extractGenericChatUserInput(providerInput)).toBe("/fast status");
    expect(extractGenericChatUserInput("/fast status")).toBeUndefined();
  });

  it("prefers the managed chat project in the requested environment", () => {
    const projects = [
      { id: GENERIC_CHAT_PROJECT_ID, environmentId: "remote" },
      { id: GENERIC_CHAT_PROJECT_ID, environmentId: "local" },
    ];

    expect(findGenericChatProject(projects, "local")?.environmentId).toBe("local");
    expect(findGenericChatProject(projects, "missing")?.environmentId).toBe("remote");
  });

  it("still supplies the host context for attachment-only turns", () => {
    const providerInput = buildGenericChatProviderInput();

    expect(providerInput).toContain("general chat session");
    expect(providerInput).not.toContain("<user_message>\n");
  });
});
