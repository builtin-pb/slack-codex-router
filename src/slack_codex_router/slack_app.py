from __future__ import annotations

import mimetypes
import shutil
import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from urllib.request import Request, urlopen

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

from slack_codex_router.commands import RouterCommands
from slack_codex_router.job_manager import JobManager, StaleWatcherError
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
        bot_token: str | None = None,
        log_dir: Path | None = None,
    ) -> None:
        self._allowed_user_id = allowed_user_id
        self._registry = registry
        self._manager = manager
        self._store = store
        self._bot_token = bot_token
        self._log_dir = log_dir
        self._commands = RouterCommands(store=store, manager=manager)

    def handle_message(self, event: Mapping[str, object], reply: ReplyFn) -> None:
        if event.get("user") != self._allowed_user_id:
            reply("User is not allowed to control this router.")
            return

        channel_id = str(event["channel"])
        project = self._registry.by_channel(channel_id)
        if project is None:
            reply("This channel is not registered to a project.")
            return

        message_ts = str(event["ts"])
        thread_ts = str(event.get("thread_ts") or message_ts)
        prompt = str(event.get("text") or "").strip()
        if prompt == "status":
            self._reply_command_result(reply, lambda: self._commands.status(thread_ts))
            return
        if prompt == "cancel":
            self._reply_command_result(reply, lambda: self._commands.cancel(thread_ts))
            return
        if prompt == "what changed":
            self._reply_command_result(reply, lambda: self._commands.what_changed(thread_ts))
            return
        if prompt == "show diff":
            self._reply_command_result(reply, lambda: self._commands.show_diff(project.path))
            return

        try:
            image_paths = tuple(self._download_image_files(event))
        except Exception as exc:
            reply(f"Could not read attached image: {exc}")
            return

        if not prompt:
            if image_paths:
                prompt = "Inspect the attached image(s)."
            else:
                reply("Send a non-empty message to start or continue a task.")
                return

        if event.get("thread_ts"):
            session = self._store.get_thread_session(thread_ts)
            if session is None:
                reply("This thread has no stored Codex session yet.")
                return

            try:
                prepared = self._manager.prepare_follow_up(
                    thread_ts=thread_ts,
                    user_message_ts=message_ts,
                )
            except Exception as exc:
                reply(f"Could not continue Codex session: {exc}")
                return
            if prepared.interrupted_prior_run:
                reply("Interrupted prior run and resumed the Codex session with the latest message.")
            try:
                self._manager.resume_follow_up(
                    channel_id=channel_id,
                    thread_ts=thread_ts,
                    user_message_ts=message_ts,
                    prompt=prompt,
                    project=project,
                    session_id=prepared.session_id,
                    image_paths=image_paths,
                )
            except Exception as exc:
                reply(f"Could not continue Codex session: {exc}")
                return
            self.start_completion_watch(
                channel_id=channel_id,
                thread_ts=thread_ts,
                expected_message_ts=message_ts,
                reply=reply,
            )
            return

        try:
            self._manager.start_new_thread(
                channel_id=channel_id,
                thread_ts=thread_ts,
                user_message_ts=message_ts,
                prompt=prompt,
                project=project,
                image_paths=image_paths,
            )
        except Exception as exc:
            reply(f"Could not start Codex task: {exc}")
            return
        self.start_completion_watch(
            channel_id=channel_id,
            thread_ts=thread_ts,
            expected_message_ts=message_ts,
            reply=reply,
        )
        reply(f"Started Codex task for project `{project.name}`.")

    def _reply_command_result(self, reply: ReplyFn, command: Callable[[], str]) -> None:
        try:
            result = command()
        except Exception as exc:
            reply(f"Could not run router command: {exc}")
            return
        reply(result)

    def _watch_completion(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        expected_message_ts: str,
        reply: ReplyFn,
    ) -> None:
        try:
            exit_code, summary, interrupted = self._manager.wait_for_thread(
                thread_ts,
                expected_message_ts=expected_message_ts,
            )
        except StaleWatcherError:
            return
        except RuntimeError as exc:
            reply(f"Codex completion handling failed: {exc}")
            return

        self.publish_completion(
            channel_id=channel_id,
            thread_ts=thread_ts,
            exit_code=exit_code,
            summary=summary,
            interrupted=interrupted,
            reply=reply,
        )

    def publish_completion(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        exit_code: int,
        summary: str,
        interrupted: bool,
        reply: ReplyFn,
    ) -> None:
        del channel_id, thread_ts

        if interrupted:
            reply("Previous Codex run was interrupted.")
            return

        if exit_code == 0:
            header = "Finished Codex run."
        elif exit_code == 124:
            header = "Codex run timed out before completion."
        else:
            header = f"Codex run exited with code {exit_code}."

        if summary and summary != header:
            reply(f"{header}\n\n{summary}")
            return

        reply(header)

    def _download_image_files(self, event: Mapping[str, object]) -> list[Path]:
        files = event.get("files")
        if not isinstance(files, list):
            return []

        if self._bot_token is None or self._log_dir is None:
            raise RuntimeError("router is not configured to download Slack image attachments")

        message_ts = str(event["ts"]).replace(".", "-")
        destination_dir = self._log_dir / "slack-inputs" / message_ts
        destination_dir.mkdir(parents=True, exist_ok=True)

        downloaded: list[Path] = []
        for file_info in files:
            if not isinstance(file_info, Mapping):
                continue

            mimetype = str(file_info.get("mimetype") or "")
            if not mimetype.startswith("image/"):
                continue

            url = str(file_info.get("url_private_download") or file_info.get("url_private") or "")
            if not url:
                continue

            file_id = str(file_info.get("id") or f"image-{len(downloaded) + 1}")
            filename = str(file_info.get("name") or "")
            suffix = Path(filename).suffix or mimetypes.guess_extension(mimetype) or ".img"
            destination = destination_dir / f"{file_id}{suffix}"
            self._download_file(url, destination)
            downloaded.append(destination)

        return downloaded

    def _download_file(self, url: str, destination: Path) -> None:
        request = Request(url, headers={"Authorization": f"Bearer {self._bot_token}"})
        with urlopen(request) as response, destination.open("wb") as handle:
            shutil.copyfileobj(response, handle)

    def start_completion_watch(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        expected_message_ts: str,
        reply: ReplyFn,
    ) -> threading.Thread:
        watcher = threading.Thread(
            target=self._watch_completion,
            kwargs={
                "channel_id": channel_id,
                "thread_ts": thread_ts,
                "expected_message_ts": expected_message_ts,
                "reply": reply,
            },
            daemon=True,
            name=f"codex-watch-{thread_ts}",
        )
        watcher.start()
        return watcher


def build_app(*, bot_token: str, app_token: str, router: SlackRouter) -> SocketModeHandler:
    app = App(token=bot_token)

    @app.event("message")
    def on_message(event, say) -> None:
        subtype = event.get("subtype")
        if subtype not in (None, "file_share") or not event.get("user"):
            return

        thread_ts = str(event.get("thread_ts") or event["ts"])
        router.handle_message(event, lambda text: say(text=text, thread_ts=thread_ts))

    return SocketModeHandler(app, app_token)
