import { PERSONAL_DISTRIBUTION } from "../../../../downstream/config.ts";

export function resolveQuickChatActionScheme(isDevelopment: boolean): string {
  return isDevelopment
    ? PERSONAL_DISTRIBUTION.macos.developmentActionScheme
    : PERSONAL_DISTRIBUTION.macos.actionScheme;
}

export function isQuickChatActionUrl(rawUrl: string, scheme: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === `${scheme}:` &&
      url.hostname === "quick-chat" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
