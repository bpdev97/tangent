/**
 * Hermes delivers files with a `MEDIA: <path>` line in assistant text. T3
 * renders them as ordinary Markdown file links, which web, desktop, and mobile
 * already open through the shared host-file path.
 *
 * Streaming text arrives in arbitrary chunks, so `consumeHermesMediaText`
 * buffers only a possible partial directive and returns everything else.
 *
 * @module provider/hermes/HermesMedia
 */

const MEDIA_MARKER = "MEDIA:";
const MEDIA_PREFIXES = [MEDIA_MARKER, "`MEDIA:", '"MEDIA:', "'MEDIA:"] as const;
const QUOTES: ReadonlySet<string> = new Set(['"', "'", "`"]);

function markdownLabel(value: string): string {
  return value.replace(/[\\[\]*_`<&]/g, "\\$&");
}

function markdownDestination(value: string): string {
  const isUri = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) && !/^[A-Za-z]:[\\/]/u.test(value);
  const path = isUri
    ? value
    : value.replaceAll("%", "%25").replaceAll("#", "%23").replaceAll("?", "%3F");
  return path
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return quote && quote === trimmed.at(-1) && QUOTES.has(quote) ? trimmed.slice(1, -1) : trimmed;
}

/** A leading `~/` refers to the Hermes host's home, which is this server's. */
function expandHome(value: string, homeDirectory: string | undefined): string {
  if (!homeDirectory || !value.startsWith("~/")) return value;
  return `${homeDirectory.replace(/[\\/]+$/u, "")}/${value.slice(2)}`;
}

function hermesMediaLink(value: string, homeDirectory: string | undefined): string {
  const path = expandHome(unquote(value), homeDirectory);
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  const label = normalized.slice(normalized.lastIndexOf("/") + 1) || normalized || "File";
  return `[${markdownLabel(label)}](<${markdownDestination(path)}>)`;
}

function trailingPrefixLength(value: string): number {
  let retained = 0;
  for (const prefix of MEDIA_PREFIXES) {
    const maximum = Math.min(value.length, prefix.length - 1);
    for (let length = maximum; length > retained; length -= 1) {
      if (value.endsWith(prefix.slice(0, length))) {
        retained = length;
        break;
      }
    }
  }
  return retained;
}

/**
 * Replace complete `MEDIA:` directives in `value`. Unless `final`, a trailing
 * directive that may still be growing is returned as `pending`.
 */
export function consumeHermesMediaText(
  value: string,
  final: boolean,
  homeDirectory: string | undefined,
): { readonly output: string; readonly pending: string } {
  let cursor = 0;
  let output = "";

  while (cursor < value.length) {
    const mediaIndex = value.indexOf(MEDIA_MARKER, cursor);
    if (mediaIndex < 0) {
      const retained = final ? 0 : trailingPrefixLength(value.slice(cursor));
      const outputEnd = value.length - retained;
      output += value.slice(cursor, outputEnd);
      return { output, pending: value.slice(outputEnd) };
    }

    const preceding = value[mediaIndex - 1];
    const wrapped = mediaIndex > cursor && preceding !== undefined && QUOTES.has(preceding);
    const directiveStart = wrapped ? mediaIndex - 1 : mediaIndex;
    output += value.slice(cursor, directiveStart);

    let pathStart = mediaIndex + MEDIA_MARKER.length;
    while (pathStart < value.length && /\s/u.test(value[pathStart] ?? "")) pathStart += 1;
    if (pathStart >= value.length) {
      if (!final) return { output, pending: value.slice(directiveStart) };
      output += value.slice(directiveStart);
      return { output, pending: "" };
    }

    const quote = value[pathStart];
    let pathEnd: number;
    if (quote !== undefined && QUOTES.has(quote)) {
      const closingQuote = value.indexOf(quote, pathStart + 1);
      if (closingQuote < 0) {
        if (!final) return { output, pending: value.slice(directiveStart) };
        output += value.slice(directiveStart);
        return { output, pending: "" };
      }
      pathEnd = closingQuote + 1;
    } else {
      // A quote wrapping the whole directive also ends an unquoted path.
      const stopQuote = wrapped ? preceding : undefined;
      pathEnd = pathStart;
      while (
        pathEnd < value.length &&
        !/\s/u.test(value[pathEnd] ?? "") &&
        value[pathEnd] !== stopQuote
      ) {
        pathEnd += 1;
      }
      if (pathEnd === value.length && !final) {
        return { output, pending: value.slice(directiveStart) };
      }
    }

    output += hermesMediaLink(value.slice(pathStart, pathEnd), homeDirectory);
    // A quote that wrapped the whole directive closes after the path.
    if (wrapped && value[pathEnd] === preceding) pathEnd += 1;
    cursor = pathEnd;
  }

  return { output, pending: "" };
}

export function renderHermesMediaText(value: string, homeDirectory: string | undefined): string {
  return consumeHermesMediaText(value, true, homeDirectory).output;
}
