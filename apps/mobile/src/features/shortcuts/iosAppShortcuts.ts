export const IOS_APP_SHORTCUT_ACTIONS = ["new-chat", "dictate-new-chat"] as const;

export type IosAppShortcutActionName = (typeof IOS_APP_SHORTCUT_ACTIONS)[number];

export interface IosAppShortcutAction {
  readonly action: IosAppShortcutActionName;
  readonly requestId: string;
}

export function parseIosAppShortcutAction(payload: unknown): IosAppShortcutAction | null {
  if (typeof payload !== "object" || payload === null) return null;

  const action = "action" in payload ? payload.action : null;
  const requestId = "requestId" in payload ? payload.requestId : null;
  if (
    typeof action !== "string" ||
    !IOS_APP_SHORTCUT_ACTIONS.some((candidate) => candidate === action) ||
    typeof requestId !== "string"
  ) {
    return null;
  }

  const normalizedRequestId = requestId.trim();
  if (normalizedRequestId.length === 0 || normalizedRequestId.length > 128) return null;

  return {
    action: action as IosAppShortcutActionName,
    requestId: normalizedRequestId,
  };
}
