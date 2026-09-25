// Tangent(FORK-LAN-001): see docs/fork/lan-fallback.md.
import type { EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useLanAddresses } from "../../connection/lan-addresses";

/** Read-only list of the local-network addresses the phone falls back to for an environment. */
export function LearnedLanAddresses(props: { readonly environmentId: EnvironmentId }) {
  const stored = useLanAddresses(props.environmentId);
  const addresses = stored?.httpBaseUrls ?? [];

  return (
    <View className="gap-1.5">
      <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
        Local network
      </Text>
      {addresses.length === 0 ? (
        <Text className="text-xs text-foreground-muted">
          None learned. The host shares its local addresses when it listens on the network.
        </Text>
      ) : (
        <View className="gap-2 rounded-[14px] border border-input-border bg-input px-4 py-3">
          {addresses.map((address) => (
            <View key={address} className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-shrink text-sm text-foreground" selectable>
                {address}
              </Text>
              {address === stored?.preferredHttpBaseUrl ? (
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  Last used
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
