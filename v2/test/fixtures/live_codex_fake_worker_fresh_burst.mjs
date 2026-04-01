import { readFileSync } from "node:fs";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const action = chooseAction(input);
  process.stderr.write("worker-mode: fresh-reply-burst\n");
  process.stderr.write(
    `worker: scenario=${input.scenario} step=${input.step} state=${input.thread?.state ?? "missing"}\n`,
  );
  process.stderr.write(
    `worker-controls: ${
      Array.isArray(input.observation?.available_controls)
        ? input.observation.available_controls
            .map((control) => `${control.current ? "current" : "stale"}:${control.action_id}`)
            .join(",")
        : "<none>"
    }\n`,
  );
  process.stdout.write(`${JSON.stringify(action)}\n`);
} catch (error) {
  process.stderr.write(
    `worker-error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

function chooseAction(observation) {
  if (observation.scenario === "toy-app-normal") {
    return chooseNormalAction(observation);
  }

  return chooseFreshBurstAction(observation);
}

function chooseNormalAction(observation) {
  if (observation.step === 0) {
    return {
      action: "send_top_level_message",
      text: "Build a tiny toy app",
    };
  }

  if (observation.step === 1) {
    const approve = findCurrentControl(observation, "Approve");
    if (approve) {
      return toClickAction(approve);
    }

    return {
      action: "send_thread_reply",
      text: "Approve",
    };
  }

  return {
    action: "finish",
    reason: "normal variant complete",
  };
}

function chooseFreshBurstAction(observation) {
  if (observation.step === 0) {
    return {
      action: "send_top_level_message",
      text: "Build a tiny toy app",
    };
  }

  if (observation.step === 1) {
    return {
      action: "send_thread_reply",
      text: "prepare restart",
      duplicate: true,
    };
  }

  if (observation.step === 2) {
    const restart =
      findCurrentControl(observation, "Interrupt") ??
      findCurrentControl(observation, "Restart router");
    if (restart) {
      return toClickAction(restart);
    }

    return {
      action: "send_thread_reply",
      text: "trigger restart",
    };
  }

  if (observation.step === 3) {
    return {
      action: "send_thread_reply",
      text: "fresh reply burst one",
      burst_texts: ["fresh reply burst two"],
    };
  }

  if (observation.step === 4) {
    const approve = findCurrentControl(observation, "Approve");
    if (approve) {
      return toClickAction(approve);
    }

    return {
      action: "finish",
      reason: "fresh burst variant complete",
    };
  }

  return {
    action: "finish",
    reason: "fresh burst variant complete",
  };
}

function findCurrentControl(observation, label) {
  return observation.observation.available_controls.find(
    (control) => control.label === label && control.current === true,
  );
}

function toClickAction(control) {
  return {
    action: "click_control",
    action_id: control.action_id,
    value: control.value,
  };
}
