import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/schibsted-grotesk";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startRum } from "./lib/rum";

startRum();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
