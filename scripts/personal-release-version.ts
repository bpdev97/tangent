export function resolvePersonalReleaseVersion(
  input: string,
  existingTags: ReadonlyArray<string>,
): string {
  const version = input.replace(/^personal-v/, "");
  const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stableVersion.test(version)) throw new Error("Personal release versions must use X.Y.Z.");
  const proposed = version.split(".").map(BigInt);
  for (const tag of existingTags) {
    if (!tag.startsWith("personal-v")) continue;
    const previous = tag.slice("personal-v".length);
    if (!stableVersion.test(previous)) continue;
    const parts = previous.split(".").map(BigInt);
    const difference = proposed.findIndex((value, index) => value !== parts[index]);
    if (difference === -1 || proposed[difference]! < parts[difference]!) {
      throw new Error(`Version ${version} must be newer than existing release or tag ${tag}.`);
    }
  }
  return version;
}

if (import.meta.main) {
  // @effect-diagnostics-next-line globalConsole:off - Dependency-free release bootstrap writes to stdout.
  console.log(
    resolvePersonalReleaseVersion(process.argv[2] ?? "", (process.argv[3] ?? "").split("\n")),
  );
}
