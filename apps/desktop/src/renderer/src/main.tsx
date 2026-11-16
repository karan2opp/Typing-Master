import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@typing/ui";

// Where the server is. Set VITE_API_URL when building; a computer can also be pointed elsewhere from the login screen.
const serverUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App platform="desktop" defaultServerUrl={serverUrl} />
  </StrictMode>,
);
