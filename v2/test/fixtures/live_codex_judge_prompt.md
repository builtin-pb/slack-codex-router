# Live Codex Judge Prompt

Decide pass or fail using only the supplied evidence bundle.

The verdict must be strict JSON with this shape:

```json
{"status":"pass|fail","reasons":["..."]}
```

Use these criteria:

1. The transcript shows a coherent multi-round worker interaction.
2. The final workspace contains the requested toy app files.
3. The verdict is grounded in the captured artifacts, not hidden assumptions.
