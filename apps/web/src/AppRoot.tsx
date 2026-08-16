import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so eligible webviews survive route transitions. It shares
 * the routed UI's atom registry and receives the router only to suspend browser
 * sessions after their thread is explicitly settled and inactive.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <PreviewAutomationHosts />
      <ElectronBrowserHost router={router} />
      <QuitHoldOverlay />
    </AppAtomRegistryProvider>
  );
}
