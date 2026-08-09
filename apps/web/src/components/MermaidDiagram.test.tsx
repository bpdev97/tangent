import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

import {
  MermaidDiagram,
  clampMermaidScale,
  mermaidDiagramWidth,
  mermaidViewBoxWidth,
  renderMermaidDiagram,
  shouldRenderMermaid,
} from "./MermaidDiagram";

describe("renderMermaidDiagram", () => {
  beforeEach(() => {
    mermaid.initialize.mockReset();
    mermaid.render.mockReset();
  });

  it.each([
    { theme: "light" as const, configuredTheme: "default", darkMode: false },
    { theme: "dark" as const, configuredTheme: "dark", darkMode: true },
  ])("renders with bounded strict configuration in $theme mode", async (testTheme) => {
    mermaid.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 640 320" />',
      diagramType: "flowchart-v2",
    });

    await expect(
      renderMermaidDiagram("diagram-1", "flowchart LR\nA-->B", testTheme.theme),
    ).resolves.toEqual({
      svg: '<svg viewBox="0 0 640 320" />',
      diagramType: "flowchart-v2",
      viewBoxWidth: 640,
    });

    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      theme: testTheme.configuredTheme,
      darkMode: testTheme.darkMode,
      fontFamily: "var(--font-sans)",
      logLevel: "fatal",
    });
    expect(mermaid.render).toHaveBeenCalledWith("diagram-1", "flowchart LR\nA-->B");
  });

  it("continues the global render queue after a diagram fails", async () => {
    mermaid.render.mockRejectedValueOnce(new Error("Invalid diagram")).mockResolvedValueOnce({
      svg: '<svg viewBox="0 0 320 180" />',
      diagramType: "sequence",
    });

    await expect(renderMermaidDiagram("diagram-1", "invalid", "light")).rejects.toThrow(
      "Invalid diagram",
    );
    await expect(
      renderMermaidDiagram("diagram-2", "sequenceDiagram\nA->>B: Hi", "light"),
    ).resolves.toMatchObject({ diagramType: "sequence", viewBoxWidth: 320 });
  });
});

describe("Mermaid diagram presentation", () => {
  it("renders completed Mermaid fences without replacing streaming code", () => {
    expect(shouldRenderMermaid("mermaid", false)).toBe(true);
    expect(shouldRenderMermaid("MERMAID", false)).toBe(true);
    expect(shouldRenderMermaid("mermaid", true)).toBe(false);
    expect(shouldRenderMermaid("typescript", false)).toBe(false);
  });

  it("clamps zoom and preserves the rendered diagram's aspect width", () => {
    expect(clampMermaidScale(0.1)).toBe(0.5);
    expect(clampMermaidScale(4)).toBe(3);
    expect(mermaidDiagramWidth(1.25, 640)).toBe("min(125%, 800px)");
    expect(mermaidDiagramWidth(0.5, null)).toBe("50%");
  });

  it("reads a positive SVG viewBox width", () => {
    expect(mermaidViewBoxWidth('<svg viewBox="0 0 721.5 480"></svg>')).toBe(721.5);
    expect(mermaidViewBoxWidth("<svg></svg>")).toBeNull();
    expect(mermaidViewBoxWidth('<svg viewBox="0 0 0 480"></svg>')).toBeNull();
  });

  it("keeps source visible and copyable before the asynchronous render completes", () => {
    const markup = renderToStaticMarkup(
      <MermaidDiagram code={"flowchart LR\nA-->B"} theme="light" />,
    );

    expect(markup).toContain("language-mermaid");
    expect(markup).toContain("flowchart LR");
    expect(markup).toContain("Copy Mermaid source");
    expect(markup).toContain("data-markdown-copy=");
  });
});
