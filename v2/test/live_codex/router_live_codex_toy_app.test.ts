import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLiveCodexHarness, isLiveCodexEnabled } from "../helpers/live_codex_harness.js";
import { LIVE_CODEX_TOY_APP_RUBRIC } from "../helpers/live_codex_judge_rubric.js";

const v2Root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const packageJsonPath = resolve(v2Root, "package.json");
const liveCodexConfigPath = resolve(v2Root, "vitest.live-codex.config.ts");
const workerPromptPath = resolve(
  v2Root,
  "test/fixtures/live_codex_worker_prompt.md",
);
const judgePromptPath = resolve(
  v2Root,
  "test/fixtures/live_codex_judge_prompt.md",
);
const harnessPath = resolve(v2Root, "test/helpers/live_codex_harness.ts");
const artifactsPath = resolve(v2Root, "test/helpers/live_codex_artifacts.ts");

describe("live codex test lane contract", () => {
  it("declares a dedicated env-gated live codex suite with its own scaffold files", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["test:live-codex"]).toBe(
      "vitest run --config vitest.live-codex.config.ts",
    );
    expect(existsSync(liveCodexConfigPath)).toBe(true);
    expect(existsSync(workerPromptPath)).toBe(true);
    expect(existsSync(judgePromptPath)).toBe(true);
    expect(existsSync(harnessPath)).toBe(true);
    expect(existsSync(artifactsPath)).toBe(true);
  });
});

describe("live codex toy app scaffold", () => {
  it.skipIf(!isLiveCodexEnabled())(
    "captures evidence for a worker and judge pass/fail decision",
    async () => {
      const harness = await createLiveCodexHarness();

      try {
        const execution = await harness.runToyAppScenario();
        expect(execution.worker.exitCode).toBe(0);
        expect(execution.judge.exitCode).toBe(0);
        expect(execution.worker.stderr).toContain("worker:");
        expect(execution.judge.stderr).toContain("judge:");
        expect(execution.worker.stdout).toContain("slack-message");
        expect(execution.judge.stdout.trim()).toMatch(/^{"status":"pass"/);
        expect(execution.objectiveChecks.passed).toBe(true);
        expect(execution.judgeVerdict).toEqual({
          status: "pass",
          reasons: [],
        });
        expect(execution.artifactBundle.rubric).toEqual(LIVE_CODEX_TOY_APP_RUBRIC);
        expect(execution.artifactBundle.transcript).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "slack-message" }),
            expect.objectContaining({ kind: "app-server-request" }),
            expect.objectContaining({ kind: "file-write", path: "src/app.txt" }),
            expect.objectContaining({ kind: "git-diff" }),
          ]),
        );
        expect(execution.serializedArtifacts).toContain("toy app ready");
        expect(harness.readWorkerPrompt()).toContain("toy app");
        expect(harness.readJudgePrompt()).toContain("strict JSON");
      } finally {
        await harness.cleanup();
      }
    },
  );
});
