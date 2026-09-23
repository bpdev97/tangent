import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  GENERIC_CHAT_LOGICAL_PROJECT_KEY,
  GENERIC_CHAT_PROJECT_ID,
} from "@t3tools/shared/genericChat";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentProject } from "./models.ts";
import { buildProjectGroups } from "./projectGrouping.ts";

function makeProject(
  environmentId: string,
  id: string,
  workspaceRoot: string,
  title = id,
): EnvironmentProject {
  return {
    environmentId: EnvironmentId.make(environmentId),
    id: ProjectId.make(id),
    title,
    workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("generic chat project grouping", () => {
  it("groups every environment's Chats project into one logical entry, in any mode", () => {
    const projects = [
      makeProject(
        "local",
        GENERIC_CHAT_PROJECT_ID,
        "/Users/me/.t3/workspaces/generic-chat",
        "Chats",
      ),
      makeProject(
        "remote",
        GENERIC_CHAT_PROJECT_ID,
        "/home/me/.t3/workspaces/generic-chat",
        "Chats",
      ),
      makeProject("local", "project-1", "/Users/me/src/app"),
    ];

    for (const mode of ["repository", "repository_path", "separate"] as const) {
      const groups = buildProjectGroups({
        projects,
        settings: { sidebarProjectGroupingMode: mode, sidebarProjectGroupingOverrides: {} },
        preferredEnvironmentId: EnvironmentId.make("local"),
      });
      const chats = groups.find((group) => group.key === GENERIC_CHAT_LOGICAL_PROJECT_KEY);
      expect(chats?.label).toBe("Chats");
      expect(chats?.representative.environmentId).toBe("local");
      expect(chats?.memberProjectRefs.map((ref) => ref.environmentId)).toEqual(["local", "remote"]);
      expect(groups).toHaveLength(2);
    }
  });

  it("does not group a project by its Chats title", () => {
    const groups = buildProjectGroups({
      projects: [makeProject("local", "project-1", "/Users/me/src/chats", "Chats")],
      settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
    });
    expect(groups[0]?.key).not.toBe(GENERIC_CHAT_LOGICAL_PROJECT_KEY);
  });
});
