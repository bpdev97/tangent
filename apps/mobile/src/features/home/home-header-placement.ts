export type HomeHeaderPlacement = "top" | "native-mail-bottom" | "legacy-bottom";

export function resolveHomeHeaderPlacement(input: {
  readonly bottomComposerPresent: boolean;
  readonly nativeMailSearchToolbarSupported: boolean;
}): HomeHeaderPlacement {
  if (input.bottomComposerPresent) return "top";
  return input.nativeMailSearchToolbarSupported ? "native-mail-bottom" : "legacy-bottom";
}
