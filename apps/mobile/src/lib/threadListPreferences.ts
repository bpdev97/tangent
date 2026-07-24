export interface ThreadListPreferences {
  readonly threadListV2Enabled?: boolean;
}

/**
 * The current thread list is the default. Keep the stored preference as an
 * explicit per-device escape hatch for switching back to the legacy list.
 */
export function isThreadListV2Enabled(
  preferences: ThreadListPreferences | null | undefined,
): boolean {
  return preferences?.threadListV2Enabled !== false;
}
