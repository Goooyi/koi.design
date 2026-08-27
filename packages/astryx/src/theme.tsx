import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import type { ReactNode } from "react";

export function KoiThemeProvider({ children }: { children: ReactNode }) {
  return <Theme theme={neutralTheme}>{children}</Theme>;
}
