import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { CommandId, MessageId, ThreadId, type ModelSelection } from "@t3tools/contracts";
import { DEFAULT_PROVIDER_INTERACTION_MODE } from "@t3tools/contracts";
import { GENERIC_CHAT_RUNTIME_MODE } from "@t3tools/shared/genericChat";

import type { TurnCommandMetadata } from "../../lib/commandMetadata";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import type { QueuedThreadMessage } from "../../state/thread-outbox";

export function homeChatDraftKey(environmentId: string | undefined): string {
  return `home-chat:${environmentId ?? "automatic"}`;
}

export function buildHomeChatOutboxMessage(input: {
  readonly project: EnvironmentProject;
  readonly text: string;
  readonly attachments: ReadonlyArray<DraftComposerImageAttachment>;
  readonly modelSelection: ModelSelection;
  readonly metadata: TurnCommandMetadata;
}): QueuedThreadMessage {
  return {
    environmentId: input.project.environmentId,
    threadId: ThreadId.make(input.metadata.threadId),
    messageId: MessageId.make(input.metadata.messageId),
    commandId: CommandId.make(input.metadata.commandId),
    text: input.text.trim(),
    attachments: input.attachments,
    modelSelection: input.modelSelection,
    runtimeMode: GENERIC_CHAT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    creation: {
      projectId: input.project.id,
      projectTitle: input.project.title,
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
    },
    createdAt: input.metadata.createdAt,
  };
}
