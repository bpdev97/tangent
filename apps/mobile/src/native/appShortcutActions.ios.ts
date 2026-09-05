import { NativeModule, requireOptionalNativeModule } from "expo";

import type { NativeAppShortcutSubscription } from "./appShortcutActions";

type AppShortcutEvents = {
  onShortcutAction(payload: unknown): void;
};

declare class AppShortcutNativeModule extends NativeModule<AppShortcutEvents> {
  getPendingShortcutAction(): unknown;
  clearPendingShortcutAction(requestId: string): void;
}

function nativeModule(): AppShortcutNativeModule | null {
  return requireOptionalNativeModule<AppShortcutNativeModule>("T3AppShortcuts");
}

export function getPendingNativeAppShortcutAction(): unknown {
  return nativeModule()?.getPendingShortcutAction() ?? null;
}

export function clearPendingNativeAppShortcutAction(requestId: string): void {
  nativeModule()?.clearPendingShortcutAction(requestId);
}

export function subscribeToNativeAppShortcutActions(
  listener: (payload: unknown) => void,
): NativeAppShortcutSubscription {
  const module = nativeModule();
  return module?.addListener("onShortcutAction", listener) ?? { remove() {} };
}
