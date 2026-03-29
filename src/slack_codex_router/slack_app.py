from __future__ import annotations

import threading
from collections.abc import Callable, Mapping

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectRegistry
from slack_codex_router.store import RouterStore


ReplyFn = Callable[[str], None]


class SlackRouter:
    def __init__(
        self,
        *,
        allowed_user_id: str,
        registry: ProjectRegistry,
        manager: JobManager,
        store: RouterStore,
    ) -> None:
        self._allowed_user_id = allowed_user_id
        self._registry = registry
        self._manager = manager
        self._store = store

    def handle_message(self, event: Mapping[str, object], reply: ReplyFn) -> None:
        if event.get("user") != self._allowed_user_id:
            return

        channel_id = str(event["channel"])
        project = self._registry.by_channel(channel_id)
        if project is None:
            reply("No project is configured for this channel.")
            return

        prompt = str(event.get("text") or "").strip()
        if not prompt:
            return

        message_ts = str(event["ts"])
        thread_ts = str(event.get("thread_ts") or message_ts)
        session = self._store.get_thread_session(thread_ts)

        if session is None and thread_ts == message_ts:
            self._manager.start_new_thread(
                channel_id=channel_id,
                thread_ts=thread_ts,
                user_message_ts=message_ts,
                prompt=prompt,
                project=project,
            )
            self.start_completion_watch(channel_id=channel_id, thread_ts=thread_ts, reply=reply)
            return

        self._manager.handle_follow_up(
            channel_id=channel_id,
            thread_ts=thread_ts,
            user_message_ts=message_ts,
            prompt=prompt,
            project=project,
        )
        self.start_completion_watch(channel_id=channel_id, thread_ts=thread_ts, reply=reply)

    def _watch_completion(self, *, channel_id: str, thread_ts: str, reply: ReplyFn) -> None:
        try:
            exit_code, summary, interrupted = self._manager.wait_for_thread(thread_ts)
        except RuntimeError:
            return

        self._manager.complete_thread(
            thread_ts,
            exit_code=exit_code,
            summary=summary,
            interrupted=interrupted,
        )
        self.publish_completion(
            channel_id=channel_id,
            thread_ts=thread_ts,
            summary=summary,
            interrupted=interrupted,
            reply=reply,
        )

    def publish_completion(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        summary: str,
        interrupted: bool,
        reply: ReplyFn,
    ) -> None:
        del channel_id, thread_ts

        if interrupted:
            reply("Previous Codex run was interrupted.")
            return

        reply(f"Finished Codex run.\n\n{summary}")

    def start_completion_watch(self, *, channel_id: str, thread_ts: str, reply: ReplyFn) -> threading.Thread:
        watcher = threading.Thread(
            target=self._watch_completion,
            kwargs={
                "channel_id": channel_id,
                "thread_ts": thread_ts,
                "reply": reply,
            },
            daemon=True,
            name=f"codex-watch-{thread_ts}",
        )
        watcher.start()
        return watcher
