import { useMemo } from "react";
import { isGenericChatThread } from "@t3tools/shared/genericChat";

import { useSelectedThreadWorktreePath } from "./use-thread-detail";
import { useThreadSelection } from "./use-thread-selection";
import { resolvePreferredThreadWorktreePath } from "../features/terminal/terminalLaunchContext";

export function useSelectedThreadWorktree() {
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  const detailWorktreePath = useSelectedThreadWorktreePath();
  // Tangent(FORK-CHAT-001): a chat has no working copy, so file, Git, and review
  // consumers all see none. The terminal resolves its own cwd from the project.
  const genericChat = isGenericChatThread(selectedThread);

  const selectedThreadWorktreePath = useMemo(
    () =>
      genericChat
        ? null
        : resolvePreferredThreadWorktreePath({
            threadShellWorktreePath: selectedThread?.worktreePath ?? null,
            threadDetailWorktreePath: detailWorktreePath,
          }),
    [detailWorktreePath, genericChat, selectedThread?.worktreePath],
  );

  return {
    selectedThreadWorktreePath,
    selectedThreadCwd: genericChat
      ? null
      : (selectedThreadWorktreePath ?? selectedThreadProject?.workspaceRoot ?? null),
  };
}
