// Tangent(FORK-LAN-001): see docs/fork/lan-fallback.md.

/**
 * The background service passes its listen address to the server as this variable. Absent means
 * the server's default, loopback only.
 */
export const SERVICE_HOST_ENV = "T3CODE_HOST";

/**
 * Reads the listen address back out of a rendered unit or plist, so reinstalls and `t3 update`
 * keep the address chosen with `t3 service install --host`. Only values the renderers write are
 * expected, unquoted and unescaped the same way `bootServiceBaseDirOf` reads `T3CODE_HOME`.
 */
export function bootServiceHostOf(contents: string): string | undefined {
  const systemd = new RegExp(`^Environment=${SERVICE_HOST_ENV}=(.*)$`, "m").exec(contents)?.[1];
  if (systemd !== undefined) {
    const raw = systemd.trim();
    const unquoted =
      raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\")
        : raw;
    return unquoted.replaceAll("%%", "%");
  }
  const plist = new RegExp(`<key>${SERVICE_HOST_ENV}</key>\\s*<string>([^<]*)</string>`).exec(
    contents,
  )?.[1];
  if (plist !== undefined) {
    return plist.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  }
  return undefined;
}
