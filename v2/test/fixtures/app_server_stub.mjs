import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const scenario = process.env.APP_SERVER_STUB_SCENARIO ?? "happy-path";
const requestLogPath = process.env.APP_SERVER_STUB_REQUEST_LOG;
const threadId = process.env.APP_SERVER_STUB_THREAD_ID ?? "thread_abc";

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

function emitHappyPathNotifications() {
  writeJson({ method: "thread/status/changed", params: { threadId, state: "running" } });
  writeJson({
    method: "item/completed",
    params: {
      threadId,
      item: { type: "message", role: "assistant", text: "Working on it." },
    },
  });
}

rl.on("line", (line) => {
  const request = JSON.parse(line);
  logRequest(request);

  if (request.method === "initialize") {
    writeJson({ id: request.id, result: { ok: true } });
    return;
  }

  if (request.method === "thread/start") {
    writeJson({ id: request.id, result: { thread: { id: threadId } } });
    return;
  }

  if (request.method === "turn/start") {
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
          item: { type: "message", role: "assistant", text: "Working on it." },
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
              item: { type: "message", role: "assistant", text: "Working on it." },
            },
          })}\n`,
      );
      return;
    }

    writeJson(response);
    emitHappyPathNotifications();
  }
});
