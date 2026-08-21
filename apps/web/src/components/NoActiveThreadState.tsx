import { MessageCircleIcon } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import { isElectron } from "../env";
import { useHandleNewChat } from "../hooks/useHandleNewThread";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

export function NoActiveThreadState() {
  const { chatProject, handleNewChat } = useHandleNewChat();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          {isElectron ? (
            <span className="text-xs text-muted-foreground/50">No active thread</span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
                No active thread
              </span>
            </div>
          )}
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-xl">Start a conversation</EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Chat without attaching a project, or select an existing project thread.
              </EmptyDescription>
              <div className="mt-5 flex justify-center">
                <Button
                  size="sm"
                  disabled={chatProject === null}
                  onClick={() => void handleNewChat()}
                >
                  <MessageCircleIcon className="size-4" />
                  New chat
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
