import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@typing/ui";

// Where the server is. Set VITE_API_URL when building; a computer can also be pointed elsewhere from the login screen.
// A built site is served by the server itself, so it talks to the address it was opened from.
const serverUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? window.location.origin : "http://localhost:8787");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App platform="web" defaultServerUrl={serverUrl} />
  </StrictMode>,
);
