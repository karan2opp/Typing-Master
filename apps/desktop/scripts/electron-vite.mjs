// Runs electron-vite with ELECTRON_RUN_AS_NODE removed.
// VS Code's integrated terminal sets it, which makes Electron start as plain
// Node (no `app`, no window), so `pnpm dev` would crash from inside VS Code.
import { spawn } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn("electron-vite", process.argv.slice(2), {
  stdio: "inherit",
  shell: true,
  env,
});
child.on("exit", (code) => process.exit(code ?? 1));
