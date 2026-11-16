import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative paths, so the app works from any folder of a website (it is served under /app/).
  base: "./",
  plugins: [react()],
});
