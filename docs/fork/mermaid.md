# FORK-MERMAID-001: Mermaid diagrams

## Why

Agents often explain designs and flows with Mermaid diagrams. Upstream shows them as source code.
Tangent renders completed Mermaid blocks as diagrams in web and desktop, without adding risk: the
renderer is strictly sandboxed and never touches the server, providers, or mobile.

## Behavior

- Only completed fenced `mermaid` blocks render. While a turn is streaming, the block stays ordinary
  source, so incomplete syntax is never parsed repeatedly.
- Mermaid is loaded on demand the first time a completed diagram appears, keeping it out of the main
  bundle.
- Mermaid's configuration is process-wide, so renders are serialized through one queue. Each render
  picks Mermaid's built-in light or dark theme. A failed render does not block later ones.
- Mermaid runs with strict security and explicit text and edge limits. Generated SVG never enables
  links, HTML labels, or interaction callbacks.
- When rendering fails, the original source stays visible and copyable.
- The diagram scrolls natively and has bounded zoom. The maximize button reuses the same rendered
  SVG in the shared dialog; it does not render again or use the browser Fullscreen API.
- There is no setting, cache, server-side rendering, or mobile code.

## Upstream hooks

- `apps/web/src/components/ChatMarkdown.tsx`: one branch at the fenced-code boundary in the `pre`
  renderer, marked `Tangent(FORK-MERMAID-001)`, sends completed `mermaid` fences to the diagram
  component, plus its import.
- `apps/web/package.json` and `pnpm-lock.yaml`: the `mermaid` dependency.
- `docs/README.md`: the link to the user guide.
- `third-party-licenses.config.json`: notices for Mermaid's `fastdom`, `strictdom`, and `khroma`
  dependencies, which ship without usable license files.

Fork-owned: `apps/web/src/components/MermaidDiagram.tsx`, its test, its stylesheet
`MermaidDiagram.css` (imported by the component, so `index.css` stays upstream's), and
`docs/user/mermaid-diagrams.md`.

## Resolving conflicts

- `ChatMarkdown.tsx`: take upstream's version and re-add the one branch for completed Mermaid fences.
  All other fences must stay on upstream's code-block path.
- Dependency files: keep upstream's changes and re-add the `mermaid` dependency.

## Never

- Never weaken strict mode or enable HTML labels to make one diagram work.
- Never render while streaming.
- Never add server, provider, contract, or mobile code for this feature.

## Remove when

Upstream renders Mermaid with streaming-safe, strict, themed rendering and a source fallback (see
upstream PR #4989 for a related proposal). Adopt upstream's component rather than keeping two
rendering paths.

## Verify

```sh
vp test apps/web/src/components/MermaidDiagram.test.tsx
```

Plus one web check in light and dark themes: a valid diagram, an invalid one showing its source,
source-only rendering while streaming, zoom, and the maximized view.
