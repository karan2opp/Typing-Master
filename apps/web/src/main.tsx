import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@typing/ui";

// Where the server is. Set VITE_API_URL when building; a computer can also be pointed elsewhere from the login screen.
// A built site is served by the server itself, so it talks to the address it was opened from.
const serverUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? window.location.origin : "http://localhost:8787");

// Where the landing page's download button goes: the newest installer on the project's GitHub releases.
// Set VITE_DOWNLOAD_URL to use a different file.
const downloadUrl =
  import.meta.env.VITE_DOWNLOAD_URL || "https://github.com/karan2opp/Typing-Master/releases/latest/download/TypingMaster-Setup.exe";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App platform="web" defaultServerUrl={serverUrl} downloadUrl={downloadUrl} />
  </StrictMode>,
);
