import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";

const routerDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(routerDir, "../../..");
const dotenvPath = process.env.DOTENV_CONFIG_PATH ?? resolve(repoRoot, ".env");

loadDotenv({ path: dotenvPath });

export function main(): void {
  const config = loadConfig();
  console.log(
    `v2 router bootstrap ready for ${config.allowedUserId} with ${config.projectsFile}`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
