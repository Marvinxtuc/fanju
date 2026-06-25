import { createRoot } from "react-dom/client";

import { App } from "./App.js";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for ops app");
}

createRoot(rootElement).render(<App />);
