import { CommandId } from "@t3tools/contracts";
import { GENERIC_CHAT_PROJECT_ID, GENERIC_CHAT_PROJECT_TITLE } from "@t3tools/shared/genericChat";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { ServerConfig } from "./config.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

export const ensureGenericChatProject = Effect.fn("ensureGenericChatProject")(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const workspaceRoot = path.join(serverConfig.baseDir, "workspaces", "generic-chat");

  yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });

  const existing = yield* projectionSnapshotQuery.getProjectShellById(GENERIC_CHAT_PROJECT_ID);
  if (Option.isNone(existing)) {
    yield* orchestrationEngine.dispatch({
      type: "project.create",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      projectId: GENERIC_CHAT_PROJECT_ID,
      title: GENERIC_CHAT_PROJECT_TITLE,
      workspaceRoot,
      createWorkspaceRootIfMissing: true,
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
    return GENERIC_CHAT_PROJECT_ID;
  }

  if (
    existing.value.title !== GENERIC_CHAT_PROJECT_TITLE ||
    existing.value.workspaceRoot !== workspaceRoot
  ) {
    yield* orchestrationEngine.dispatch({
      type: "project.meta.update",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      projectId: GENERIC_CHAT_PROJECT_ID,
      title: GENERIC_CHAT_PROJECT_TITLE,
      workspaceRoot,
    });
  }

  return GENERIC_CHAT_PROJECT_ID;
});
