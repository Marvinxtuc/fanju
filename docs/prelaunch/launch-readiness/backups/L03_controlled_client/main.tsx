import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { PrelaunchWorkspace } from "./PrelaunchWorkspace.js";
import { prelaunchEnabled } from "./prelaunch-api.js";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for ops app");
}

const showPrelaunch = prelaunchEnabled && new URLSearchParams(window.location.search).get("workspace") === "prelaunch";
createRoot(rootElement).render(showPrelaunch ? <PrelaunchWorkspace /> : <App />);
