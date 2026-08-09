import { CheckIcon, Code2Icon, CopyIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useId,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { RenderResult } from "mermaid";

import { Button } from "./ui/button";

type MermaidTheme = "light" | "dark";

interface MermaidRenderResult extends RenderResult {
  readonly viewBoxWidth: number | null;
}

interface MermaidRenderState {
  readonly inputKey: string;
  readonly result: MermaidRenderResult | null;
}

const MIN_MERMAID_SCALE = 0.5;
const MAX_MERMAID_SCALE = 3;
const MERMAID_ZOOM_STEP = 0.25;
const MERMAID_MAX_TEXT_SIZE = 50_000;
const MERMAID_MAX_EDGES = 500;

let mermaidRenderQueue: Promise<unknown> = Promise.resolve();

export function clampMermaidScale(scale: number): number {
  return Math.min(MAX_MERMAID_SCALE, Math.max(MIN_MERMAID_SCALE, scale));
}

export function shouldRenderMermaid(language: string, isStreaming: boolean): boolean {
  return !isStreaming && language.toLowerCase() === "mermaid";
}

export function mermaidViewBoxWidth(svg: string): number | null {
  const viewBox = /\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+[\d.]+\s*["']/i.exec(svg);
  const width = Number(viewBox?.[1]);
  return Number.isFinite(width) && width > 0 ? width : null;
}

export function mermaidDiagramWidth(scale: number, viewBoxWidth: number | null): string {
  const percentage = Math.round(scale * 10_000) / 100;
  if (viewBoxWidth === null) {
    return `${percentage}%`;
  }
  const pixelWidth = Math.round(viewBoxWidth * scale * 100) / 100;
  return `min(${percentage}%, ${pixelWidth}px)`;
}

export function renderMermaidDiagram(
  id: string,
  code: string,
  theme: MermaidTheme,
): Promise<MermaidRenderResult> {
  const render = async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: MERMAID_MAX_TEXT_SIZE,
      maxEdges: MERMAID_MAX_EDGES,
      theme: theme === "dark" ? "dark" : "default",
      darkMode: theme === "dark",
      fontFamily: "var(--font-sans)",
      logLevel: "fatal",
    });
    const result = await mermaid.render(id, code);
    return { ...result, viewBoxWidth: mermaidViewBoxWidth(result.svg) };
  };

  const result = mermaidRenderQueue.then(render, render);
  mermaidRenderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function MermaidSource(props: { readonly code: string; readonly failed: boolean }) {
  return (
    <>
      {props.failed ? (
        <div className="chat-markdown-mermaid-error" role="alert">
          Mermaid could not render this diagram. The source is shown below.
        </div>
      ) : null}
      <pre>
        <code className="language-mermaid">{props.code}</code>
      </pre>
    </>
  );
}

export const MermaidDiagram = memo(function MermaidDiagram(props: {
  readonly code: string;
  readonly theme: MermaidTheme;
}) {
  const reactId = useId();
  const diagramId = `t3-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const inputKey = `${props.theme}\0${props.code}`;
  const [renderState, setRenderState] = useState<MermaidRenderState | null>(null);
  const [scale, setScale] = useState(1);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const stateForInput = renderState?.inputKey === inputKey ? renderState : null;
  const markdownSource = `\`\`\`mermaid\n${props.code.trimEnd()}\n\`\`\``;

  useEffect(() => {
    let active = true;
    void renderMermaidDiagram(diagramId, props.code, props.theme)
      .then((result) => {
        if (active) setRenderState({ inputKey, result });
      })
      .catch(() => {
        if (active) setRenderState({ inputKey, result: null });
      });
    return () => {
      active = false;
    };
  }, [diagramId, inputKey, props.code, props.theme]);

  useEffect(() => {
    setScale(1);
    setShowSource(false);
  }, [inputKey]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1_200);
    return () => clearTimeout(timeout);
  }, [copied]);

  const changeZoom = (change: number) => {
    setScale((current) => clampMermaidScale(Math.round((current + change) * 100) / 100));
  };

  const handleCopy = () => {
    if (navigator.clipboard == null) return;
    void navigator.clipboard
      .writeText(props.code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 0.1 : -0.1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(MERMAID_ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      changeZoom(-MERMAID_ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      setScale(1);
    }
  };

  const result = stateForInput?.result ?? null;
  const failed = stateForInput !== null && result === null;
  const sourceVisible = showSource || result === null;

  return (
    <div className="chat-markdown-mermaid" data-markdown-copy={markdownSource}>
      <div className="chat-markdown-mermaid-header">
        <span className="chat-markdown-mermaid-title">Mermaid</span>
        <span className="chat-markdown-mermaid-actions" role="toolbar" aria-label="Diagram actions">
          {!sourceVisible ? (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                aria-label="Zoom out diagram"
                title="Zoom out"
                disabled={scale <= MIN_MERMAID_SCALE}
                onClick={() => changeZoom(-MERMAID_ZOOM_STEP)}
              >
                <MinusIcon />
              </Button>
              <span className="chat-markdown-mermaid-scale">{Math.round(scale * 100)}%</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                aria-label="Zoom in diagram"
                title="Zoom in"
                disabled={scale >= MAX_MERMAID_SCALE}
                onClick={() => changeZoom(MERMAID_ZOOM_STEP)}
              >
                <PlusIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                aria-label="Reset diagram zoom"
                title="Reset zoom"
                disabled={scale === 1}
                onClick={() => setScale(1)}
              >
                <RotateCcwIcon />
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            className="chat-markdown-chrome-action"
            aria-label={showSource ? "Show diagram" : "Show diagram source"}
            title={showSource ? "Show diagram" : "Show source"}
            aria-pressed={showSource}
            disabled={result === null}
            onClick={() => setShowSource((current) => !current)}
          >
            <Code2Icon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="chat-markdown-chrome-action"
            aria-label={copied ? "Copied Mermaid source" : "Copy Mermaid source"}
            title={copied ? "Copied" : "Copy source"}
            onClick={handleCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </span>
      </div>
      {sourceVisible ? (
        <MermaidSource code={props.code} failed={failed} />
      ) : (
        <div
          className="chat-markdown-mermaid-viewport"
          role="group"
          tabIndex={0}
          aria-label="Mermaid diagram. Scroll to pan. Press plus or minus to zoom, or zero to reset."
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
        >
          <div
            className="chat-markdown-mermaid-svg"
            style={{ width: mermaidDiagramWidth(scale, result.viewBoxWidth) }}
            role="img"
            aria-label="Mermaid diagram"
            dangerouslySetInnerHTML={{ __html: result.svg }}
          />
        </div>
      )}
    </div>
  );
});
