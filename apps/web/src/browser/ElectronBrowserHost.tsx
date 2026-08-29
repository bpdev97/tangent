"use client";

import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { FILL_PREVIEW_VIEWPORT } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { type ThreadPreviewState, useActivePreviewSessions } from "~/previewStateStore";
import type { AppRouter } from "~/router";
import { useThreadShell } from "~/state/entities";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "~/threadRoutes";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { shouldMountThreadBrowserSessions } from "./browserSessionSuspension";
import { useBrowserPointerStore } from "./browserPointerStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

const EMPTY_ROUTE_PARAMS = Object.freeze({});

function useActiveThreadKey(router: AppRouter): string | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => router.subscribe("onResolved", onStoreChange),
    [router],
  );
  const getSnapshot = useCallback(
    () => router.state.matches.at(-1)?.params ?? EMPTY_ROUTE_PARAMS,
    [router],
  );
  const routeParams = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const routeTarget = useMemo(() => resolveThreadRouteTarget(routeParams), [routeParams]);
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const activeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  return activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
}

function ThreadBrowserSessions(props: {
  readonly activeThreadKey: string | null;
  readonly previewState: ThreadPreviewState;
  readonly threadKey: string;
}) {
  const { activeThreadKey, previewState, threadKey } = props;
  const threadRef = useMemo(() => parseScopedThreadKey(threadKey), [threadKey]);
  const thread = useThreadShell(threadRef);

  if (
    !threadRef ||
    !shouldMountThreadBrowserSessions({
      activeThreadKey,
      settledOverride: thread?.settledOverride,
      threadKey,
    })
  ) {
    return null;
  }

  return Object.values(previewState.sessions).map((snapshot) => {
    const runtimeTabId = previewRuntimeTabId(threadRef, previewState.serverEpoch, snapshot.tabId);
    const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
    return (
      <HostedBrowserWebview
        key={runtimeTabId}
        threadRef={threadRef}
        tabId={snapshot.tabId}
        runtimeTabId={runtimeTabId}
        initialUrl={url}
        viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
        pictureInPicture={previewState.desktopByTabId[snapshot.tabId]?.pictureInPicture ?? false}
        zoomFactor={previewState.desktopByTabId[snapshot.tabId]?.zoomFactor ?? 1}
      />
    );
  });
}

export function ElectronBrowserHost({ router }: { readonly router: AppRouter }) {
  const { resolvedTheme } = useTheme();
  const previewByThreadKey = useActivePreviewSessions();
  const activeThreadKey = useActiveThreadKey(router);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;

    let lastSerializedTheme = "";
    const syncTheme = () => {
      const theme = readPreviewAnnotationTheme();
      const serializedTheme = JSON.stringify(theme);
      if (serializedTheme === lastSerializedTheme) return;
      lastSerializedTheme = serializedTheme;
      void preview.setAnnotationTheme(theme).catch(() => {
        lastSerializedTheme = "";
      });
    };
    const frameId = window.requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const headObserver = new MutationObserver(syncTheme);
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      headObserver.disconnect();
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => {
      useBrowserPointerStore.getState().apply(event);
    });
  }, []);

  if (!isElectron) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {Object.entries(previewByThreadKey).map(([threadKey, previewState]) => (
        <ThreadBrowserSessions
          key={threadKey}
          activeThreadKey={activeThreadKey}
          previewState={previewState}
          threadKey={threadKey}
        />
      ))}
    </div>
  );
}
