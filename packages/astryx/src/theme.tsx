import { LayerProvider } from "@astryxdesign/core/Layer";
import { Theme } from "@astryxdesign/core/theme";
import type { ReactNode } from "react";

import { koiTheme } from "./theme/generated/koi.js";

/**
 * Applies Koi's built Astryx theme and the layer stack that Astryx overlays (tooltips, dialogs,
 * toasts) render into. Hosts import `@koi/astryx/theme.css` alongside this provider.
 */
export function KoiThemeProvider({ children }: { children: ReactNode }) {
  return (
    <Theme theme={koiTheme} mode="light">
      <LayerProvider toast={{ position: "bottomStart" }}>{children}</LayerProvider>
    </Theme>
  );
}
