import "dotenv/config";

import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";

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
