/**
 * Tangent(FORK-HOST-001): each client's default host for a project.
 *
 * A project that lives on several servers is one logical project. A client can
 * name the server new threads in it start on, keyed by the logical project key.
 * When that server is offline or no longer has the project, new threads fall
 * back to the upstream choice. See docs/fork/project-default-host.md.
 */

/** Logical project key to environment ID, stored per client. */
export type ProjectDefaultHosts = Readonly<Record<string, string>>;

/**
 * The member a new thread starts on: the one on the default host, when that
 * host is connected. `preferred` wins when it is already on the default host,
 * so a checkout the caller picked stays picked. Null means no default applies.
 */
export function resolveProjectDefaultHostMember<
  T extends { readonly environmentId: string },
>(input: {
  readonly members: ReadonlyArray<T>;
  readonly defaultEnvironmentId: string | null | undefined;
  readonly isEnvironmentConnected: (environmentId: string) => boolean;
  readonly preferred?: T | null;
}): T | null {
  const environmentId = input.defaultEnvironmentId;
  if (!environmentId || !input.isEnvironmentConnected(environmentId)) return null;
  if (input.preferred?.environmentId === environmentId) return input.preferred;
  return input.members.find((member) => member.environmentId === environmentId) ?? null;
}

/** Returns the map with the project's default host set, or cleared when `environmentId` is null. */
export function setProjectDefaultHost(
  hosts: ProjectDefaultHosts,
  projectKey: string,
  environmentId: string | null,
): ProjectDefaultHosts {
  const { [projectKey]: _previous, ...rest } = hosts;
  return environmentId === null ? rest : { ...rest, [projectKey]: environmentId };
}

/** Keeps only string-to-string entries from stored data; null when nothing valid remains. */
export function sanitizeProjectDefaultHosts(value: unknown): ProjectDefaultHosts | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      entry[0].length > 0 && typeof entry[1] === "string" && entry[1].length > 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}
