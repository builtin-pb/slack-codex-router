import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const scenario = process.env.APP_SERVER_STUB_SCENARIO ?? "happy-path";
const generation = Number.parseInt(process.env.APP_SERVER_STUB_GENERATION ?? "1", 10);
const threadMode = process.env.APP_SERVER_STUB_THREAD_MODE ?? "fixed";
const requestLogPath = process.env.APP_SERVER_STUB_REQUEST_LOG;
const artifactLogPath = process.env.APP_SERVER_STUB_ARTIFACT_LOG;
const projectRoot = process.env.APP_SERVER_STUB_PROJECT_ROOT;
const threadId = process.env.APP_SERVER_STUB_THREAD_ID ?? "thread_abc";
const scenarioState = {
  stepsByThreadId: new Map(),
};
let nextThreadIndex = 1;

function writeRaw(text) {
  process.stdout.write(text);
}

function writeJson(message) {
  writeRaw(`${JSON.stringify(message)}\n`);
}

function logRequest(request) {
  if (!requestLogPath) {
    return;
  }

  appendFileSync(requestLogPath, `${JSON.stringify(request)}\n`, "utf8");
}

function emitArtifact(artifact) {
  if (!artifactLogPath) {
    return;
  }

  appendFileSync(artifactLogPath, `${JSON.stringify(artifact)}\n`, "utf8");
}

function writeProjectFile(relativePath, contents) {
  const absolutePath = join(projectRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
  emitArtifact({ kind: "file-write", path: relativePath, contents });
}

function writeProjectFileFromRequest(request, relativePath, contents) {
  const cwd =
    request?.params &&
    typeof request.params === "object" &&
    typeof request.params.cwd === "string"
      ? request.params.cwd
      : projectRoot;

  if (!cwd) {
    throw new Error("APP_SERVER_STUB_PROJECT_ROOT or request params.cwd is required.");
  }

  const absolutePath = join(cwd, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
  emitArtifact({ kind: "file-write", path: relativePath, cwd, contents });
}

function emitHappyPathNotifications() {
  const currentThreadId = readThreadIdFromRequest();
  writeJson({
    method: "thread/status/changed",
    params: { threadId: currentThreadId, state: "running" },
  });
  writeJson({
    method: "item/completed",
    params: {
      threadId: currentThreadId,
      item: { type: "agentMessage", text: "Working on it.", phase: "commentary" },
    },
  });
}

function handleToyAppBuild(request) {
  if (request.method !== "turn/start") {
    return false;
  }

  const currentThreadId = readThreadIdFromRequest(request);
  if (
    scenario === "toy-app-build-pause-rebind" &&
    generation === 2 &&
    readPromptFromRequest(request)?.trim() === "continue after first restart"
  ) {
    emitArtifact({
      kind: "paused-turn-start",
      generation,
      threadId: currentThreadId,
      prompt: "continue after first restart",
    });
    return true;
  }

  const step = scenarioState.stepsByThreadId.get(currentThreadId) ?? 0;

  if (step === 0) {
    scenarioState.stepsByThreadId.set(currentThreadId, 1);
    writeJson({ id: request.id, result: { turn: { id: `turn_${currentThreadId}_1` } } });
    emitArtifact({ kind: "request-user-input", threadId: currentThreadId, step: 1 });
    writeJson({
      method: "tool/requestUserInput",
      params: {
        threadId: currentThreadId,
        questions: [
          {
            id: "approve-build",
            header: "Confirm build",
            question: `Create the toy app files for ${currentThreadId}?`,
            options: [{ label: "Approve" }, { label: "Reject" }],
          },
        ],
      },
    });
    return true;
  }

  if (step === 1) {
    scenarioState.stepsByThreadId.set(currentThreadId, 2);
    writeProjectFileFromRequest(request, "src/app.txt", "toy app ready\n");
    writeJson({ id: request.id, result: { turn: { id: `turn_${currentThreadId}_2` } } });
    writeJson({
      method: "item/completed",
      params: {
        threadId: currentThreadId,
        item: {
          type: "agentMessage",
          text: `toy app complete for ${currentThreadId}`,
          phase: "commentary",
        },
      },
    });
    writeJson({
      method: "thread/status/changed",
      params: { threadId: currentThreadId, state: "idle" },
    });
    return true;
  }

  return false;
}

function handleTransportTorture(request) {
  if (request.method !== "turn/start") {
    return false;
  }

  const currentThreadId = readThreadIdFromRequest(request);
  const response = { id: request.id, result: { turn: { id: "turn_noise" } } };
  const serialized = JSON.stringify(response);
  writeRaw(serialized.slice(0, 18));
  writeRaw(`${serialized.slice(18)}\n`);
  process.stderr.write("stub: stderr noise before crash\n");
  writeJson({
    method: "thread/status/changed",
    params: { threadId: currentThreadId, state: "running" },
  });
  writeJson({
    method: "item/completed",
    params: {
      threadId: currentThreadId,
      item: { type: "agentMessage", text: "partial progress", phase: "commentary" },
    },
  });
  emitArtifact({ kind: "transport-torture", phase: "before-exit" });
  setTimeout(() => {
    process.exit(23);
  }, 10);
  return true;
}

rl.on("line", (line) => {
  const request = JSON.parse(line);
  logRequest(request);

  if (request.method === "initialize") {
    writeJson({ id: request.id, result: { ok: true } });
    return;
  }

  if (request.method === "thread/start") {
    writeJson({ id: request.id, result: { thread: { id: makeThreadId() } } });
    return;
  }

  if (request.method === "turn/start") {
    if (
      (
        scenario === "toy-app-build" ||
        scenario === "toy-app-build-pause-rebind" ||
        scenario === "multi-thread-toy-app-build"
      ) &&
      handleToyAppBuild(request)
    ) {
      return;
    }

    if (scenario === "transport-torture" && handleTransportTorture(request)) {
      return;
    }

    if (scenario === "exit-during-turn-start") {
      process.exit(23);
    }

    const response = { id: request.id, result: { turn: { id: "turn_abc" } } };

    if (scenario === "fragmented-output") {
      const serialized = JSON.stringify(response);
      writeRaw(serialized.slice(0, 20));
      writeRaw(`${serialized.slice(20)}\n`);
      writeJson({
        method: "thread/status/changed",
        params: { threadId, state: "running" },
      });
      writeJson({
        method: "item/completed",
        params: {
          threadId,
          item: { type: "agentMessage", text: "Working on it.", phase: "commentary" },
        },
      });
      return;
    }

    if (scenario === "coalesced-output") {
      writeRaw(
        `${JSON.stringify(response)}\n` +
          `${JSON.stringify({
            method: "thread/status/changed",
            params: { threadId, state: "running" },
          })}\n` +
          `${JSON.stringify({
            method: "item/completed",
            params: {
              threadId,
              item: {
                type: "agentMessage",
                text: "Working on it.",
                phase: "commentary",
              },
            },
          })}\n`,
      );
      return;
    }

    writeJson(response);
    emitHappyPathNotifications();
  }
});

function makeThreadId() {
  if (threadMode === "incrementing") {
    const id = `${threadId}_${nextThreadIndex}`;
    nextThreadIndex += 1;
    return id;
  }

  return threadId;
}

function readThreadIdFromRequest(request = {}) {
  const params = request?.params;
  if (params && typeof params === "object" && typeof params.threadId === "string") {
    return params.threadId;
  }

  return threadId;
}

function readPromptFromRequest(request = {}) {
  const params = request?.params;
  if (!params || typeof params !== "object") {
    return null;
  }

  const input = Array.isArray(params.input) ? params.input : [];
  const textEntry = input.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      entry.type === "text" &&
      typeof entry.text === "string",
  );

  return textEntry?.text ?? null;
}
