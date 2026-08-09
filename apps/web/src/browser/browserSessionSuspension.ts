export function shouldMountThreadBrowserSessions(input: {
  readonly activeThreadKey: string | null;
  readonly settledOverride: "settled" | "active" | null | undefined;
  readonly threadKey: string;
}): boolean {
  return input.activeThreadKey === input.threadKey || input.settledOverride !== "settled";
}
