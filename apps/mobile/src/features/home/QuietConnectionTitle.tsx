// Tangent(FORK-STATUS-001): see docs/fork/quiet-connection-status.md.
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { useWorkspaceState } from "../../state/workspace";
import { ConnectionStatusDot } from "../connection/ConnectionStatusDot";
import {
  quietConnectionIndicator,
  type QuietConnectionIndicator,
} from "./quiet-connection-indicator";

/** Matches upstream's title: sub-second reconnects never show anything. */
const INDICATOR_SHOW_DELAY_MS = 800;

/**
 * The header indicator, debounced like upstream's status title. Once shown it follows the state
 * directly, so moving between partial and disconnected does not blink.
 */
export function useQuietConnectionIndicator(): QuietConnectionIndicator | undefined {
  const { state } = useWorkspaceState();
  const current = quietConnectionIndicator(state);
  const problem = current === "partial" || current === "disconnected";
  const [shown, setShown] = useState(false);
  if (!problem && shown) setShown(false);

  useEffect(() => {
    if (!problem) return;
    const timer = setTimeout(() => setShown(true), INDICATOR_SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [problem]);

  if (current === undefined) return undefined;
  return problem && shown ? current : "none";
}

/**
 * The brand with a small static mark after it: a dot while some environments are unreachable, a
 * crossed-out Wi-Fi symbol while none are connected. The mark hangs outside the brand's box so a
 * centered native title does not move. Pressing it opens environment settings.
 */
export function QuietConnectionTitle(props: {
  readonly brand: ReactNode;
  readonly indicator: "partial" | "disconnected";
  readonly onPress?: () => void;
  readonly grow?: boolean;
  readonly maxWidth?: number;
}) {
  return (
    <Pressable
      accessibilityHint="Opens environment settings"
      accessibilityLabel={
        props.indicator === "partial"
          ? "Some environments are unreachable"
          : "No environments connected"
      }
      accessibilityRole="button"
      disabled={props.onPress === undefined}
      hitSlop={8}
      onPress={props.onPress}
      style={[
        { alignItems: "center", flexDirection: "row", maxWidth: props.maxWidth },
        props.grow ? { flex: 1, minWidth: 0 } : null,
      ]}
    >
      <View style={{ justifyContent: "center" }}>
        {props.brand}
        <View style={{ position: "absolute", right: -16, alignItems: "center", width: 12 }}>
          {props.indicator === "partial" ? (
            <ConnectionStatusDot state="reconnecting" pulse={false} size={7} />
          ) : (
            <SymbolView
              name="wifi.slash"
              size={12}
              tintColorClassName="accent-icon-muted"
              type="monochrome"
            />
          )}
        </View>
      </View>
    </Pressable>
  );
}
