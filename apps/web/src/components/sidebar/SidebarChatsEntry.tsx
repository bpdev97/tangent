/**
 * Tangent(FORK-CHAT-001): the sidebar's Chats destination.
 *
 * Chats are threads in the managed Chats project, so the destination is the
 * sidebar's project scope set to that project, and "New chat" opens a draft in
 * it. Renders nothing until a server reports the managed project.
 */
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { GENERIC_CHAT_LOGICAL_PROJECT_KEY } from "@t3tools/shared/genericChat";
import { MessageCircleIcon, SquarePenIcon } from "lucide-react";
import { memo, useCallback } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useUiStateStore } from "../../uiStateStore";
import { SidebarMenuButton, useSidebar } from "../ui/sidebar";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

export const SidebarChatsEntry = memo(function SidebarChatsEntry(props: {
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
}) {
  const chats = props.projectGroups.find(
    (group) => group.projectKey === GENERIC_CHAT_LOGICAL_PROJECT_KEY,
  );
  const scoped = useUiStateStore(
    (store) => store.sidebarProjectScopeKey === GENERIC_CHAT_LOGICAL_PROJECT_KEY,
  );
  const setProjectScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const handleNewThread = useNewThreadHandler();
  const { isMobile, setOpenMobile } = useSidebar();

  const toggleChats = useCallback(() => {
    setProjectScopeKey(scoped ? null : GENERIC_CHAT_LOGICAL_PROJECT_KEY);
  }, [scoped, setProjectScopeKey]);
  const startChat = useCallback(() => {
    // The group's representative is the primary environment's member when it has one.
    if (!chats) return;
    setProjectScopeKey(GENERIC_CHAT_LOGICAL_PROJECT_KEY);
    if (isMobile) setOpenMobile(false);
    void handleNewThread(scopeProjectRef(chats.environmentId, chats.id));
  }, [chats, handleNewThread, isMobile, setOpenMobile, setProjectScopeKey]);

  if (!chats) return null;
  return (
    <div className="mt-1 flex items-center gap-1">
      <SidebarMenuButton
        isActive={scoped}
        aria-pressed={scoped}
        className="min-w-0 flex-1"
        onClick={toggleChats}
      >
        <MessageCircleIcon className="size-4" />
        <span className="truncate font-medium">Chats</span>
      </SidebarMenuButton>
      <SidebarHeaderIconButton label="New chat" onClick={startChat}>
        <SquarePenIcon />
      </SidebarHeaderIconButton>
    </div>
  );
});
