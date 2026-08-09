import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";

import { buildHomeChatOutboxMessage, homeChatDraftKey } from "./homeChat";

describe("home chat", () => {
  it("keeps automatic and explicit host drafts separate", () => {
    assert.equal(homeChatDraftKey(undefined), "home-chat:automatic");
    assert.equal(homeChatDraftKey("mac-mini"), "home-chat:mac-mini");
  });

  it("queues a generic local thread without repository metadata", () => {
    const attachments = [
      {
        id: "image-1",
        type: "image" as const,
        name: "reference.png",
        mimeType: "image/png",
        sizeBytes: 4,
        dataUrl: "data:image/png;base64,dGVzdA==",
        previewUri: "file:///tmp/reference.png",
      },
    ];
    const message = buildHomeChatOutboxMessage({
      project: {
        environmentId: EnvironmentId.make("mac-mini"),
        id: ProjectId.make("t3code-generic-chat"),
        title: "Chats",
        workspaceRoot: "/managed/chat",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-08-09T12:00:00.000Z",
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
      text: "  hello  ",
      attachments,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      metadata: {
        threadId: "thread-1",
        messageId: "message-1",
        commandId: "command-1",
        createdAt: "2026-08-09T12:00:00.000Z",
      },
    });

    assert.equal(message.text, "hello");
    assert.equal(message.runtimeMode, "approval-required");
    assert.deepStrictEqual(message.attachments, attachments);
    assert.deepInclude(message.creation, {
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
    });
    assert.notProperty(message.creation ?? {}, "projectCwd");
  });
});
