import { readFileSync } from "node:fs";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const action = chooseAction(input);
  const controls = Array.isArray(input.observation?.available_controls)
    ? input.observation.available_controls
        .map((control) => `${control.current ? "current" : "stale"}:${control.action_id}`)
        .join(",")
    : "<none>";

  process.stderr.write(
    `worker: scenario=${input.scenario} step=${input.step} state=${input.thread?.state ?? "missing"}\n`,
  );
  process.stderr.write(`worker-controls: ${controls}\n`);
  process.stdout.write(`${JSON.stringify(action)}\n`);
} catch (error) {
  process.stderr.write(`worker-error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function chooseAction(observation) {
  if (observation.scenario === "toy-app-normal") {
    return chooseNormalAction(observation);
  }

  return chooseAdversarialAction(observation);
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

function chooseAdversarialAction(observation) {
  if (observation.step === 0) {
    return {
      action: "send_top_level_message",
      text: "Build a tiny toy app",
    };
  }

  if (observation.step === 1) {
    return {
      action: "send_thread_reply",
      text: "duplicate delivery probe",
      duplicate: true,
    };
  }

  if (observation.step === 2) {
    const interrupt =
      findCurrentControl(observation, "Interrupt") ??
      findCurrentControl(observation, "Restart router");
    if (interrupt) {
      return toClickAction(interrupt);
    }

    return {
      action: "send_thread_reply",
      text: "continue after restart",
    };
  }

  if (observation.step === 3) {
    const staleControl =
      findStaleControlByActionId(observation, "interrupt") ??
      findStaleChoiceControl(observation, "Approve") ??
      findStaleChoiceControl(observation, "Reject");
    if (staleControl) {
      return toClickAction(staleControl);
    }

    return {
      action: "send_thread_reply",
      text: "continue after restart",
    };
  }

  if (observation.step === 4) {
    return {
      action: "send_thread_reply",
      text: "duplicate delivery probe",
      duplicate: true,
    };
  }

  if (observation.step === 5) {
    const approve = findCurrentControl(observation, "Approve");
    if (approve) {
      return toClickAction(approve);
    }

    return {
      action: "finish",
      reason: "adversarial variant complete",
    };
  }

  return {
    action: "finish",
    reason: "adversarial variant complete",
  };
}

function findCurrentControl(observation, label) {
  return observation.observation.available_controls.find(
    (control) => control.label === label && control.current === true,
  );
}

function findStaleChoiceControl(observation, label) {
  return observation.observation.available_controls.find(
    (control) =>
      control.label === label &&
      control.current === false &&
      control.action_id.startsWith("codex_choice:"),
  );
}

function sawStaleControlRejection(observation) {
  return observation.observation.action_responses.some(
    (response) =>
      typeof response.text === "string" &&
      response.text.includes("needs a new message"),
  );
}

function findStaleControlByActionId(observation, actionId) {
  return observation.observation.available_controls.find(
    (control) => control.action_id === actionId && control.current === false,
  );
}

function toClickAction(control) {
  return {
    action: "click_control",
    action_id: control.action_id,
    value: control.value,
  };
}
