/**
 * Tangent(FORK-CHAT-001): chats with no user project attached.
 *
 * Chats live in one managed project per server. The reserved project ID is the
 * only capability marker: clients and the server branch on it, never on the
 * `Chats` title or the scratch path, which can be repaired or differ per host.
 * See docs/fork/generic-chat.md.
 */
import type { ProjectId, RuntimeMode } from "@t3tools/contracts";

// Type-only contracts import: upstream tests mock `@t3tools/contracts` with a few constants,
// and a runtime import here would break every module that imports this one.
export const GENERIC_CHAT_PROJECT_ID = "t3code-generic-chat" as ProjectId;
export const GENERIC_CHAT_PROJECT_TITLE = "Chats";
/** Groups every environment's managed project under one logical `Chats` entry. */
export const GENERIC_CHAT_LOGICAL_PROJECT_KEY = "t3code:generic-chat";
export const GENERIC_CHAT_RUNTIME_MODE: RuntimeMode = "approval-required";

const GENERIC_CHAT_PROVIDER_CONTEXT = `<t3_code_generic_chat_context>
This is a general chat session. No user project, repository, or working directory is attached.
The process working directory is app-owned scratch space and is not user content.
</t3_code_generic_chat_context>`;

export function isGenericChatProjectId(projectId: string | null | undefined): boolean {
  return projectId === GENERIC_CHAT_PROJECT_ID;
}

export function isGenericChatProject(project: { readonly id: string } | null | undefined): boolean {
  return project != null && isGenericChatProjectId(project.id);
}

/** Existing-thread capability reads `projectId`, so it never waits on the project catalog. */
export function isGenericChatThread(
  thread: { readonly projectId: string } | null | undefined,
): boolean {
  return thread != null && isGenericChatProjectId(thread.projectId);
}

/** Projects the user added; the managed Chats project is not evidence of user setup. */
export function excludeGenericChatProjects<T extends { readonly id: string }>(
  projects: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return projects.some(isGenericChatProject)
    ? projects.filter((project) => !isGenericChatProject(project))
    : projects;
}

/** The managed project to start a new chat in: the preferred environment's, else any. */
export function findGenericChatProject<
  T extends { readonly id: string; readonly environmentId: string },
>(projects: ReadonlyArray<T>, preferredEnvironmentId?: string | null): T | null {
  const chats = projects.filter(isGenericChatProject);
  return (
    chats.find((project) => project.environmentId === preferredEnvironmentId) ?? chats[0] ?? null
  );
}

/**
 * The provider-facing text of a chat turn: the user's text followed by factual
 * host context. The context never directs tool use; attachment-only turns get
 * the context alone.
 */
export function buildGenericChatProviderInput(userInput?: string): string {
  const normalizedInput = userInput?.trim();
  return normalizedInput
    ? `<user_message>\n${normalizedInput}\n</user_message>\n\n${GENERIC_CHAT_PROVIDER_CONTEXT}`
    : GENERIC_CHAT_PROVIDER_CONTEXT;
}
