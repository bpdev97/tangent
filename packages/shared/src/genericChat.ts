import { ProjectId, type RuntimeMode } from "@t3tools/contracts";

export const GENERIC_CHAT_PROJECT_ID = ProjectId.make("t3code-generic-chat");
export const GENERIC_CHAT_PROJECT_TITLE = "Chats";
export const GENERIC_CHAT_LOGICAL_PROJECT_KEY = "t3code:generic-chat";
export const GENERIC_CHAT_RUNTIME_MODE: RuntimeMode = "approval-required";

const GENERIC_CHAT_PROVIDER_CONTEXT = `<t3_code_generic_chat_context>
This is a general chat session. No user project, repository, or working directory is attached.
The process working directory is app-owned scratch space and is not user content.
</t3_code_generic_chat_context>`;
const GENERIC_CHAT_USER_MESSAGE_PREFIX = "<user_message>\n";
const GENERIC_CHAT_USER_MESSAGE_SUFFIX = `\n</user_message>\n\n${GENERIC_CHAT_PROVIDER_CONTEXT}`;

export function isGenericChatProjectId(projectId: string): boolean {
  return projectId === GENERIC_CHAT_PROJECT_ID;
}

export function isGenericChatProject(project: { readonly id: string } | null | undefined): boolean {
  return project != null && isGenericChatProjectId(project.id);
}

export function isGenericChatThread(
  thread: { readonly projectId: string } | null | undefined,
): boolean {
  return thread != null && isGenericChatProjectId(thread.projectId);
}

/** An explicit chat host never falls back to another environment. */
export function findGenericChatProject<
  T extends { readonly id: string; readonly environmentId: string },
>(projects: ReadonlyArray<T>, environmentId?: string | null): T | null {
  return (
    projects.find(
      (project) =>
        isGenericChatProject(project) &&
        (environmentId == null || project.environmentId === environmentId),
    ) ?? null
  );
}

export function buildGenericChatProviderInput(userInput?: string): string {
  const normalizedInput = userInput?.trim();
  return normalizedInput
    ? `${GENERIC_CHAT_USER_MESSAGE_PREFIX}${normalizedInput}${GENERIC_CHAT_USER_MESSAGE_SUFFIX}`
    : GENERIC_CHAT_PROVIDER_CONTEXT;
}

export function extractGenericChatUserInput(providerInput: string): string | undefined {
  const normalizedInput = providerInput.trim();
  if (
    !normalizedInput.startsWith(GENERIC_CHAT_USER_MESSAGE_PREFIX) ||
    !normalizedInput.endsWith(GENERIC_CHAT_USER_MESSAGE_SUFFIX)
  ) {
    return undefined;
  }

  return normalizedInput
    .slice(
      GENERIC_CHAT_USER_MESSAGE_PREFIX.length,
      normalizedInput.length - GENERIC_CHAT_USER_MESSAGE_SUFFIX.length,
    )
    .trim();
}
