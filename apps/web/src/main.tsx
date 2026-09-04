import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@koi/astryx/theme.css";
import "@koi/astryx/components.css";
import "@koi/editor/style.css";
import "./global.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
