/**
 * Fork-owned mobile runtime policy. Keep this separate from the Expo
 * distribution config so JavaScript-only tuning does not change the native
 * runtime fingerprint.
 */
export const PERSONAL_MOBILE_RUNTIME = {
  // Release inactive thread graphs promptly on memory-constrained clients.
  // One second preserves transient subscriber gaps during navigation.
  threadStateIdleTtlMs: 1_000,
} as const;
