import { ProjectId } from "@t3tools/contracts";
import { GENERIC_CHAT_PROJECT_ID } from "@t3tools/shared/genericChat";
import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "../rightPanelStore";
import { allowedRightPanelSurfaces } from "./genericChat";

const surfaces: RightPanelSurface[] = [
  { id: "diff", kind: "diff" },
  { id: "files", kind: "files" },
  {
    id: "file:src/index.ts",
    kind: "file",
    relativePath: "src/index.ts",
    revealLine: null,
    revealRequestId: 0,
  },
  {
    id: "attachment:a1",
    kind: "file",
    relativePath: "notes.pdf",
    revealLine: null,
    revealRequestId: 0,
    attachment: { type: "file", id: "a1", name: "notes.pdf", mimeType: "application/pdf" } as never,
  },
  { id: "pull-requests", kind: "pull-requests" },
  {
    id: "pull-request:t3tools/t3code#1",
    kind: "pull-request",
    projectId: "project-1",
    repository: "t3tools/t3code",
    number: 1,
  },
  {
    id: "terminal:t1",
    kind: "terminal",
    resourceId: "t1",
    terminalIds: ["t1"],
    activeTerminalId: "t1",
  },
  { id: "browser:b1", kind: "preview", resourceId: "b1" },
  { id: "device", kind: "device" },
];

describe("generic chat right panel guard", () => {
  it("keeps the terminal, browser, devices, and attachments in a chat", () => {
    expect(
      allowedRightPanelSurfaces({ projectId: GENERIC_CHAT_PROJECT_ID }, surfaces).map(
        (surface) => surface.id,
      ),
    ).toEqual(["attachment:a1", "terminal:t1", "browser:b1", "device"]);
  });

  it("leaves project threads untouched", () => {
    const projectThread = { projectId: ProjectId.make("project-1") };
    expect(allowedRightPanelSurfaces(projectThread, surfaces)).toBe(surfaces);
    expect(allowedRightPanelSurfaces(null, surfaces)).toBe(surfaces);
  });
});
