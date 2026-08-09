import {
  CheckIcon,
  Code2Icon,
  CopyIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { RenderResult } from "mermaid";

import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from "./ui/dialog";

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
  const percentage = mermaidScalePercentage(scale);
  if (viewBoxWidth === null) {
    return percentage;
  }
  const pixelWidth = Math.round(viewBoxWidth * scale * 100) / 100;
  return `min(${percentage}, ${pixelWidth}px)`;
}

export function mermaidScalePercentage(scale: number): string {
  return `${Math.round(scale * 10_000) / 100}%`;
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

function MermaidViewport(props: {
  readonly result: MermaidRenderResult;
  readonly scale: number;
  readonly maximized: boolean;
  readonly onZoom: (change: number) => void;
  readonly onResetZoom: () => void;
}) {
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    props.onZoom(event.deltaY < 0 ? 0.1 : -0.1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      props.onZoom(MERMAID_ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      props.onZoom(-MERMAID_ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      props.onResetZoom();
    }
  };

  const maximizedSize = mermaidScalePercentage(props.scale);

  return (
    <div
      className="chat-markdown-mermaid-viewport"
      data-maximized={props.maximized ? "true" : undefined}
      role="group"
      tabIndex={0}
      aria-label={`Mermaid diagram. Scroll to pan. Press plus or minus to zoom, or zero to reset.${
        props.maximized ? " Press Escape to restore the conversation view." : ""
      }`}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="chat-markdown-mermaid-svg"
        style={
          props.maximized
            ? { width: maximizedSize, height: maximizedSize }
            : { width: mermaidDiagramWidth(props.scale, props.result.viewBoxWidth) }
        }
        role="img"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: props.result.svg }}
      />
    </div>
  );
}

function MermaidPresentation(props: {
  readonly code: string;
  readonly result: MermaidRenderResult | null;
  readonly failed: boolean;
  readonly scale: number;
  readonly showSource: boolean;
  readonly copied: boolean;
  readonly maximized: boolean;
  readonly toggleButtonRef?: Ref<HTMLButtonElement>;
  readonly onZoom: (change: number) => void;
  readonly onResetZoom: () => void;
  readonly onToggleSource: () => void;
  readonly onCopy: () => void;
  readonly onToggleMaximized: () => void;
}) {
  const sourceVisible = props.showSource || props.result === null;
  const maximizeLabel = props.maximized ? "Restore diagram" : "Maximize diagram";

  return (
    <>
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
                disabled={props.scale <= MIN_MERMAID_SCALE}
                onClick={() => props.onZoom(-MERMAID_ZOOM_STEP)}
              >
                <MinusIcon />
              </Button>
              <span className="chat-markdown-mermaid-scale">{Math.round(props.scale * 100)}%</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                aria-label="Zoom in diagram"
                title="Zoom in"
                disabled={props.scale >= MAX_MERMAID_SCALE}
                onClick={() => props.onZoom(MERMAID_ZOOM_STEP)}
              >
                <PlusIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="chat-markdown-chrome-action"
                aria-label="Reset diagram zoom"
                title="Reset zoom"
                disabled={props.scale === 1}
                onClick={props.onResetZoom}
              >
                <RotateCcwIcon />
              </Button>
            </>
          ) : null}
          {props.result !== null && props.maximized ? (
            <DialogClose
              render={
                <Button variant="ghost" size="icon-xs" className="chat-markdown-chrome-action" />
              }
              aria-label={maximizeLabel}
              title={maximizeLabel}
              aria-pressed
            >
              <Minimize2Icon />
            </DialogClose>
          ) : props.result !== null && !sourceVisible ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="chat-markdown-chrome-action"
              aria-label={maximizeLabel}
              title={maximizeLabel}
              aria-pressed={props.maximized}
              ref={props.toggleButtonRef}
              onClick={props.onToggleMaximized}
            >
              <Maximize2Icon />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            className="chat-markdown-chrome-action"
            aria-label={props.showSource ? "Show diagram" : "Show diagram source"}
            title={props.showSource ? "Show diagram" : "Show source"}
            aria-pressed={props.showSource}
            disabled={props.result === null}
            onClick={props.onToggleSource}
          >
            <Code2Icon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="chat-markdown-chrome-action"
            aria-label={props.copied ? "Copied Mermaid source" : "Copy Mermaid source"}
            title={props.copied ? "Copied" : "Copy source"}
            onClick={props.onCopy}
          >
            {props.copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </span>
      </div>
      {sourceVisible ? (
        <MermaidSource code={props.code} failed={props.failed} />
      ) : (
        <MermaidViewport
          result={props.result}
          scale={props.scale}
          maximized={props.maximized}
          onZoom={props.onZoom}
          onResetZoom={props.onResetZoom}
        />
      )}
    </>
  );
}

export const MermaidDiagram = memo(function MermaidDiagram(props: {
  readonly code: string;
  readonly theme: MermaidTheme;
}) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const maximizeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const diagramId = `t3-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const inputKey = `${props.theme}\0${props.code}`;
  const [renderState, setRenderState] = useState<MermaidRenderState | null>(null);
  const [scale, setScale] = useState(1);
  const [maximizedScale, setMaximizedScale] = useState(1);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [placeholderHeight, setPlaceholderHeight] = useState<number | null>(null);
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
    setMaximizedScale(1);
    setShowSource(false);
    setMaximized(false);
    setPlaceholderHeight(null);
  }, [inputKey]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1_200);
    return () => clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (maximized) {
      restoreFocusRef.current = true;
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      maximizeButtonRef.current?.focus();
    }
  }, [maximized]);

  const changeZoom = (change: number, maximizedView: boolean) => {
    const setCurrentScale = maximizedView ? setMaximizedScale : setScale;
    setCurrentScale((current) => clampMermaidScale(Math.round((current + change) * 100) / 100));
  };

  const handleCopy = () => {
    if (navigator.clipboard == null) return;
    void navigator.clipboard
      .writeText(props.code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  const openMaximized = () => {
    setPlaceholderHeight(containerRef.current?.getBoundingClientRect().height ?? null);
    setMaximizedScale(1);
    setMaximized(true);
  };

  const closeMaximized = () => {
    setMaximized(false);
    setPlaceholderHeight(null);
  };

  const result = stateForInput?.result ?? null;
  const failed = stateForInput !== null && result === null;

  return (
    <>
      <div
        ref={containerRef}
        className="chat-markdown-mermaid"
        data-markdown-copy={markdownSource}
        style={maximized && placeholderHeight !== null ? { height: placeholderHeight } : undefined}
      >
        {!maximized ? (
          <MermaidPresentation
            code={props.code}
            result={result}
            failed={failed}
            scale={scale}
            showSource={showSource}
            copied={copied}
            maximized={false}
            toggleButtonRef={maximizeButtonRef}
            onZoom={(change) => changeZoom(change, false)}
            onResetZoom={() => setScale(1)}
            onToggleSource={() => setShowSource((current) => !current)}
            onCopy={handleCopy}
            onToggleMaximized={openMaximized}
          />
        ) : null}
      </div>
      {maximized && result !== null ? (
        <Dialog
          defaultOpen
          onOpenChange={(open) => {
            if (!open) closeMaximized();
          }}
        >
          <DialogPopup
            className="chat-markdown h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none overflow-hidden rounded-xl"
            showCloseButton={false}
            bottomStickOnMobile={false}
            finalFocus={false}
          >
            <DialogTitle className="sr-only">Mermaid diagram</DialogTitle>
            <DialogDescription className="sr-only">
              Maximized Mermaid diagram with zoom, source, and copy controls.
            </DialogDescription>
            <div className="chat-markdown-mermaid chat-markdown-mermaid-fullscreen">
              <MermaidPresentation
                code={props.code}
                result={result}
                failed={false}
                scale={maximizedScale}
                showSource={showSource}
                copied={copied}
                maximized
                onZoom={(change) => changeZoom(change, true)}
                onResetZoom={() => setMaximizedScale(1)}
                onToggleSource={() => setShowSource((current) => !current)}
                onCopy={handleCopy}
                onToggleMaximized={closeMaximized}
              />
            </div>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
});
