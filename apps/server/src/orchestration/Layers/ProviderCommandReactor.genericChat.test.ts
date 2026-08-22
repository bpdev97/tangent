import { ProjectId } from "@t3tools/contracts";
import { GENERIC_CHAT_PROJECT_ID, GENERIC_CHAT_RUNTIME_MODE } from "@t3tools/shared/genericChat";
import { describe, expect, it } from "vite-plus/test";

import {
  prepareProviderMessageInput,
  resolveProviderRuntimeMode,
  resolveProviderSessionCwd,
} from "./ProviderCommandReactor.ts";

describe("generic chat provider context", () => {
  it("wraps generic chat messages with factual projectless context", () => {
    const input = prepareProviderMessageInput(GENERIC_CHAT_PROJECT_ID, "What is a monad?");

    expect(input).toContain("No user project, repository, or working directory is attached");
    expect(input).toContain("app-owned scratch space and is not user content");
    expect(input).not.toContain("Do not inspect");
    expect(input).not.toContain("start a project-bound thread");
    expect(input).toContain("<user_message>\nWhat is a monad?\n</user_message>");
  });

  it("leaves project-bound messages unchanged", () => {
    expect(prepareProviderMessageInput(ProjectId.make("project-1"), "  Inspect this repo.  ")).toBe(
      "Inspect this repo.",
    );
  });

  it("forces generic chats into the safest existing runtime mode", () => {
    expect(resolveProviderRuntimeMode(GENERIC_CHAT_PROJECT_ID, "full-access")).toBe(
      GENERIC_CHAT_RUNTIME_MODE,
    );
    expect(resolveProviderRuntimeMode(ProjectId.make("project-1"), "full-access")).toBe(
      "full-access",
    );
  });

  it("pins generic sessions to the managed scratch root instead of a thread worktree", () => {
    expect(
      resolveProviderSessionCwd(
        GENERIC_CHAT_PROJECT_ID,
        "/state/workspaces/generic-chat",
        "/user/project/worktree",
      ),
    ).toBe("/state/workspaces/generic-chat");
    expect(
      resolveProviderSessionCwd(
        ProjectId.make("project-1"),
        "/user/project",
        "/user/project/worktree",
      ),
    ).toBe("/user/project/worktree");
  });
});
