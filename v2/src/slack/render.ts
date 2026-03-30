export function renderUnauthorizedUser(): string {
  return "User is not allowed to control this router.";
}

export function renderUnknownChannel(): string {
  return "This channel is not registered to a project.";
}

export function renderMissingSession(): string {
  return "This thread has no stored Codex session yet.";
}

export function renderEmptyMessage(): string {
  return "Send a non-empty message to start or continue a task.";
}

export function renderStartedTask(projectName: string): string {
  return `Started Codex task for project \`${projectName}\`.`;
}

export function renderContinuedTask(projectName: string): string {
  return `Continuing Codex task for project \`${projectName}\`.`;
}
