// Builds the whole website into ./site:
//   /                         the landing page, which leads into the typing app (apps/web build)
//   /TypingMaster-Setup.exe   the Windows installer, if it has been built (the landing page links to it)
// The API server serves this folder itself, so one address does everything.
// Set VITE_API_URL first if the API lives somewhere else than the site.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");

execSync("pnpm --filter @typing/web build", { cwd: root, stdio: "inherit" });

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
cpSync(join(root, "apps/web/dist"), site, { recursive: true });

// The newest installer, under a name that never changes so the download link keeps working.
const releases = join(root, "apps/desktop/release");
const installers = existsSync(releases)
  ? readdirSync(releases).filter((f) => /^TypingMaster-Setup-.*\.exe$/.test(f)).sort()
  : [];
const newest = installers.at(-1);
if (newest) cpSync(join(releases, newest), join(site, "TypingMaster-Setup.exe"));

console.log(`\nSite built in ${site}`);
console.log(newest ? `Installer included: ${newest}` : "No installer found: run `pnpm build:desktop` first to include the download.");
