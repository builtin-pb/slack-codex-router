type PlainText = {
  type: "plain_text";
  text: string;
};

type MarkdownText = {
  type: "mrkdwn";
  text: string;
};

type ButtonElement = {
  type: "button";
  action_id: string;
  text: PlainText;
  value: string;
};

type SectionBlock = {
  type: "section";
  text: MarkdownText;
};

type ActionsBlock = {
  type: "actions";
  elements: ButtonElement[];
};

export type SlackBlock = SectionBlock | ActionsBlock;

export function buildThreadControls(state: {
  canInterrupt: boolean;
  canReview: boolean;
  canMerge: boolean;
}): SlackBlock[] {
  const elements: ButtonElement[] = [buildButton("status", "Status")];

  if (state.canInterrupt) {
    elements.push(buildButton("interrupt", "Interrupt"));
  }

  elements.push(
    buildButton("what_changed", "What changed"),
    buildButton("open_diff", "Open diff"),
  );

  if (state.canReview) {
    elements.push(buildButton("review", "Review"));
  }

  if (state.canMerge) {
    elements.push(buildButton("merge_to_main", "Merge to main"));
  }

  elements.push(
    buildButton("restart_router", "Restart router"),
    buildButton("archive_task", "Archive task"),
  );

  return [
    {
      type: "actions",
      elements,
    },
  ];
}

export function buildUserInputBlocks(input: {
  prompt: string;
  options: { id: string; label: string; value?: string }[];
}): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: input.prompt,
      },
    },
    {
      type: "actions",
      elements: input.options.map((option) =>
        buildButton(`codex_choice:${option.id}`, option.label, option.value ?? option.id),
      ),
    },
  ];
}

function buildButton(actionId: string, label: string, value = actionId): ButtonElement {
  return {
    type: "button",
    action_id: actionId,
    text: {
      type: "plain_text",
      text: label,
    },
    value,
  };
}
