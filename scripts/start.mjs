// `npm start`: serve the built app on the address the online/offline toggle
// (lib/providers.js) calls for — loopback only when offline.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { bindHost } from "../lib/providers.js";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const args = [next, "start", ...(bindHost ? ["-H", bindHost] : []), ...process.argv.slice(2)];
spawn(process.execPath, args, { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
