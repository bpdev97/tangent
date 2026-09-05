export interface NativeAppShortcutSubscription {
  remove(): void;
}

export function getPendingNativeAppShortcutAction(): unknown {
  return null;
}

export function clearPendingNativeAppShortcutAction(_requestId: string): void {}

export function subscribeToNativeAppShortcutActions(
  _listener: (payload: unknown) => void,
): NativeAppShortcutSubscription {
  return { remove() {} };
}
