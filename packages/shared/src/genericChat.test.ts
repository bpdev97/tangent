import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildGenericChatProviderInput,
  excludeGenericChatProjects,
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
    expect(isGenericChatProjectId(null)).toBe(false);
    expect(isGenericChatProject({ id: GENERIC_CHAT_PROJECT_ID })).toBe(true);
    expect(isGenericChatProject(null)).toBe(false);
    expect(isGenericChatThread({ projectId: GENERIC_CHAT_PROJECT_ID })).toBe(true);
    expect(isGenericChatThread({ projectId: ProjectId.make("regular-project") })).toBe(false);
    expect(isGenericChatThread(undefined)).toBe(false);
  });

  it("does not detect chats by title", () => {
    expect(isGenericChatProject({ id: "project-1", title: "Chats" } as { id: string })).toBe(false);
  });

  it("wraps the user's text with factual context that does not direct tool use", () => {
    const providerInput = buildGenericChatProviderInput("  Explain monads simply.  ");

    expect(providerInput).toContain(
      "No user project, repository, or working directory is attached",
    );
    expect(providerInput).toContain("app-owned scratch space and is not user content");
    expect(providerInput).not.toMatch(/sandbox|do not (inspect|use|run)/i);
    expect(
      providerInput.startsWith("<user_message>\nExplain monads simply.\n</user_message>"),
    ).toBe(true);
  });

  it("still supplies the context for attachment-only turns", () => {
    const providerInput = buildGenericChatProviderInput("   ");

    expect(providerInput).toContain("general chat session");
    expect(providerInput).not.toContain("<user_message>");
  });

  it("excludes only the managed project from user projects", () => {
    const projects = [{ id: "project-1" }, { id: GENERIC_CHAT_PROJECT_ID }];
    expect(excludeGenericChatProjects(projects)).toEqual([{ id: "project-1" }]);
    const userProjects = [{ id: "project-1" }];
    expect(excludeGenericChatProjects(userProjects)).toBe(userProjects);
  });

  it("prefers the requested environment and falls back to any managed project", () => {
    const projects = [
      { id: "project-1", environmentId: "local" },
      { id: GENERIC_CHAT_PROJECT_ID, environmentId: "remote" },
      { id: GENERIC_CHAT_PROJECT_ID, environmentId: "local" },
    ];

    expect(findGenericChatProject(projects, "local")?.environmentId).toBe("local");
    expect(findGenericChatProject(projects, "missing")?.environmentId).toBe("remote");
    expect(findGenericChatProject(projects)?.environmentId).toBe("remote");
    expect(findGenericChatProject([{ id: "project-1", environmentId: "local" }])).toBeNull();
  });
});
