// Builds the whole website into ./site: the landing page, which leads into the typing app (apps/web build).
// The API server serves this folder itself, so one address does everything.
// The installer is not part of it: the landing page's download button links to the GitHub release.
// Set VITE_API_URL first if the API lives somewhere else than the site.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");

execSync("pnpm --filter @typing/web build", { cwd: root, stdio: "inherit" });

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
cpSync(join(root, "apps/web/dist"), site, { recursive: true });

console.log(`\nSite built in ${site}`);
