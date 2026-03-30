import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, repoRootPath } from "../config.js";

const dotenvPath = process.env.DOTENV_CONFIG_PATH ?? resolve(repoRootPath, ".env");

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
