import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  type ClientOrchestrationCommand,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { HEIC_FIXTURE_BASE64 } from "../testFixtures/heic.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { canonicalizeClientCommandTimestamps, normalizeDispatchCommand } from "./Normalizer.ts";

const clientCreatedAt = "2031-01-01T00:00:00.000Z";
const serverReceivedAt = "2026-07-18T00:00:00.000Z";
const normalizerTestLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-normalizer-test-" }),
  WorkspacePaths.layer,
).pipe(Layer.provideMerge(NodeServices.layer));

describe("canonicalizeClientCommandTimestamps", () => {
  it("replaces a client command timestamp with the server receipt timestamp", () => {
    const command: ClientOrchestrationCommand = {
      type: "project.create",
      commandId: CommandId.make("command-1"),
      projectId: ProjectId.make("project-1"),
      title: "Clock-safe project",
      workspaceRoot: "/tmp/clock-safe-project",
      createdAt: clientCreatedAt,
    };

    expect(canonicalizeClientCommandTimestamps(command, serverReceivedAt)).toEqual({
      ...command,
      createdAt: serverReceivedAt,
    });
  });

  it("replaces both timestamps when the first turn bootstraps a thread", () => {
    const command: ClientOrchestrationCommand = {
      type: "thread.turn.start",
      commandId: CommandId.make("command-2"),
      threadId: ThreadId.make("thread-1"),
      message: {
        messageId: MessageId.make("message-1"),
        role: "user",
        text: "Start a thread",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId: ProjectId.make("project-1"),
          title: "Clock-safe thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: clientCreatedAt,
        },
      },
      createdAt: clientCreatedAt,
    };

    const result = canonicalizeClientCommandTimestamps(command, serverReceivedAt);

    expect(result.type).toBe("thread.turn.start");
    if (result.type !== "thread.turn.start") {
      throw new Error("Expected a thread.turn.start command");
    }
    expect(result.createdAt).toBe(serverReceivedAt);
    expect(result.bootstrap?.createThread?.createdAt).toBe(serverReceivedAt);
  });

  it.effect("persists canonical JPEG bytes and metadata for a real HEIC upload", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const heicBytes = Buffer.from(HEIC_FIXTURE_BASE64, "base64");
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("command-real-heic"),
        threadId: ThreadId.make("thread-real-heic"),
        message: {
          messageId: MessageId.make("message-real-heic"),
          role: "user",
          text: "Inspect this photo",
          attachments: [
            {
              type: "image",
              name: "camera-original.heic",
              mimeType: "image/heic",
              sizeBytes: heicBytes.byteLength,
              dataUrl: `data:image/heic;base64,${HEIC_FIXTURE_BASE64}`,
            },
          ],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: clientCreatedAt,
      };

      const result = yield* normalizeDispatchCommand(command);
      if (result.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command");
      }
      const attachment = result.message.attachments[0];
      expect(attachment).toMatchObject({
        type: "image",
        name: "camera-original.jpg",
        mimeType: "image/jpeg",
      });
      if (!attachment) {
        throw new Error("Expected a persisted attachment");
      }

      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment,
      });
      expect(attachmentPath).not.toBeNull();
      if (!attachmentPath) {
        throw new Error("Expected a safe persisted attachment path");
      }

      const persistedBytes = yield* fileSystem.readFile(attachmentPath);
      expect(attachment.sizeBytes).toBe(persistedBytes.byteLength);
      expect(Array.from(persistedBytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    }).pipe(Effect.provide(normalizerTestLayer)),
  );
});
