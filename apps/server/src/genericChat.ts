/**
 * Tangent(FORK-CHAT-001): the server side of chats with no user project.
 *
 * Startup keeps one managed project, provider turns in it carry short factual
 * context, and its workspace is never checkpointed. The cwd and runtime policy
 * come from upstream treating the managed project like any other project.
 * See docs/fork/generic-chat.md.
 */
import { CommandId } from "@t3tools/contracts";
import {
  buildGenericChatProviderInput,
  GENERIC_CHAT_PROJECT_ID,
  GENERIC_CHAT_PROJECT_TITLE,
  isGenericChatThread,
} from "@t3tools/shared/genericChat";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { CheckpointStore } from "./checkpointing/CheckpointStore.ts";
import { ServerConfig } from "./config.ts";
import { ProjectionProjectRepository } from "./persistence/Services/ProjectionProjects.ts";
import { ProjectService } from "./project/ProjectService.ts";

/** App-owned scratch space, never user content and never a sandbox. */
export const genericChatWorkspaceRoot = (path: Path.Path, baseDir: string) =>
  path.resolve(path.join(baseDir, "workspaces", "generic-chat"));

/**
 * Creates the managed project, or repairs its title and workspace. Idempotent:
 * it never deletes threads and never touches the project's model preference.
 */
export const ensureGenericChatProject = Effect.fn("ensureGenericChatProject")(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { baseDir } = yield* ServerConfig;
  const projects = yield* ProjectService;
  const workspaceRoot = genericChatWorkspaceRoot(path, baseDir);

  yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });

  const existing = yield* projects.getById(GENERIC_CHAT_PROJECT_ID);
  if (Option.isNone(existing)) {
    yield* projects.create({
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      projectId: GENERIC_CHAT_PROJECT_ID,
      title: GENERIC_CHAT_PROJECT_TITLE,
      workspaceRoot,
      createWorkspaceRootIfMissing: true,
    });
    return "created" as const;
  }
  if (
    existing.value.title === GENERIC_CHAT_PROJECT_TITLE &&
    existing.value.workspaceRoot === workspaceRoot
  ) {
    return "unchanged" as const;
  }
  yield* projects.update({
    commandId: CommandId.make(yield* crypto.randomUUIDv4),
    projectId: GENERIC_CHAT_PROJECT_ID,
    title: GENERIC_CHAT_PROJECT_TITLE,
    workspaceRoot,
  });
  return "repaired" as const;
});

/**
 * The text a provider receives for a turn. Chat turns, including resumed and
 * attachment-only ones, are wrapped with the chat context; the stored message
 * is untouched. Slash commands pass through verbatim so provider and T3
 * commands such as `/compact` keep working.
 */
export function genericChatProviderText(input: {
  readonly thread: { readonly projectId: string };
  readonly message: { readonly text: string; readonly attachments: ReadonlyArray<unknown> };
  readonly providerText: string;
}): string {
  if (!isGenericChatThread(input.thread)) return input.providerText;
  if (input.message.attachments.length === 0 && input.message.text.trimStart().startsWith("/")) {
    return input.providerText;
  }
  return buildGenericChatProviderInput(input.providerText);
}

/**
 * Keeps checkpoints out of the managed project's workspace. Upstream skips
 * checkpoints outside Git, but detection walks up the tree, so a scratch
 * directory nested in a repository (a development worktree's `.t3`, or a home
 * directory under version control) would otherwise snapshot that repository.
 */
export const genericChatCheckpointStoreLayer = Layer.effect(
  CheckpointStore,
  Effect.gen(function* () {
    const checkpointStore = yield* CheckpointStore;
    const projects = yield* ProjectionProjectRepository;
    const isGenericChatWorkspace = (cwd: string) =>
      projects.getById({ projectId: GENERIC_CHAT_PROJECT_ID }).pipe(
        Effect.map(Option.exists((project) => project.workspaceRoot === cwd)),
        Effect.orElseSucceed(() => false),
      );
    return CheckpointStore.of({
      ...checkpointStore,
      isGitRepository: (cwd) =>
        isGenericChatWorkspace(cwd).pipe(
          Effect.flatMap((genericChat) =>
            genericChat ? Effect.succeed(false) : checkpointStore.isGitRepository(cwd),
          ),
        ),
    });
  }),
);
