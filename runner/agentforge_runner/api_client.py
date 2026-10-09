"""Control-plane client (CONTRACTS §9): `Authorization: Bearer <AF_RUNNER_KEY>`, retries, no secret logging."""

from __future__ import annotations

import contextlib
import logging
import os
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx

log = logging.getLogger(__name__)

SECRET_ENV = (
    "AF_RUNNER_KEY",
    "AF_GEMINI_API_KEY",
    "GROQ_API_KEY",
    "DP_GEMINI_API_KEY",
    "RP_GEMINI_API_KEY",
    "EVAL_DATABASE_URL",
)
RESULTS_BATCH = 25
RETRY_STATUS = {502, 503, 504}


def mask_secrets(env: dict[str, str] | None = None, out: Any = None) -> int:
    """In GitHub Actions, register every secret with `::add-mask::` so it never appears in public logs."""
    env = dict(os.environ) if env is None else env
    if env.get("GITHUB_ACTIONS") != "true":
        return 0
    stream = out or sys.stdout
    n = 0
    for name in SECRET_ENV:
        value = env.get(name)
        if value:
            stream.write(f"::add-mask::{value}\n")
            n += 1
    stream.flush()
    return n


class ControlPlaneError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"control plane HTTP {status}: {message}")
        self.status = status


class ControlPlane:
    def __init__(
        self,
        base_url: str,
        key: str,
        *,
        transport: httpx.BaseTransport | None = None,
        retries: int = 3,
        backoff_s: float = 1.0,
    ) -> None:
        # Accept the host (https://x), the API root (https://x/api, like AGENTFORGE_URL) or the full base.
        self._base = base_url.rstrip("/")
        if self._base.endswith("/api"):
            self._base += "/v1"
        elif not self._base.endswith("/api/v1"):
            self._base += "/api/v1"
        self._http = httpx.Client(
            timeout=30, transport=transport, headers={"Authorization": f"Bearer {key}", "User-Agent": "af-run/0.1"}
        )
        self._retries = retries
        self._backoff = backoff_s

    @classmethod
    def from_env(cls) -> ControlPlane:
        url, key = os.environ.get("AF_API_URL"), os.environ.get("AF_RUNNER_KEY")
        if not url or not key:
            raise SystemExit("AF_API_URL and AF_RUNNER_KEY must be set for control-plane mode")
        return cls(url, key)

    def _request(self, method: str, path: str, json: Any = None) -> Any:
        url = f"{self._base}{path}"
        for attempt in range(self._retries + 1):
            try:
                resp = self._http.request(method, url, json=json)
            except httpx.TransportError as exc:
                if attempt == self._retries:
                    raise ControlPlaneError(0, type(exc).__name__) from exc
            else:
                if resp.status_code not in RETRY_STATUS:
                    if resp.status_code >= 400:
                        # Only the error code from the body is surfaced; bodies may echo request content.
                        code = ""
                        with contextlib.suppress(ValueError):
                            code = str((resp.json().get("error") or {}).get("code", ""))
                        raise ControlPlaneError(resp.status_code, f"{method} {path} {code}".strip())
                    return resp.json() if resp.content else None
                if attempt == self._retries:
                    raise ControlPlaneError(resp.status_code, f"{method} {path}")
            time.sleep(self._backoff * 2**attempt)
        return None

    # runs ------------------------------------------------------------------------------------------
    def get_run(self, run_id: str) -> dict[str, Any]:
        return self._request("GET", f"/runner/runs/{run_id}")

    def start_run(self, run_id: str, gh_run_id: int | None) -> None:
        self._request("POST", f"/runner/runs/{run_id}/start", {"gh_run_id": gh_run_id})

    def heartbeat(self, run_id: str) -> None:
        self._request("POST", f"/runner/runs/{run_id}/heartbeat", {})

    def post_results(self, run_id: str, results: list[dict[str, Any]]) -> int:
        for i in range(0, len(results), RESULTS_BATCH):
            self._request("POST", f"/runner/runs/{run_id}/results", {"results": results[i : i + RESULTS_BATCH]})
        return len(results)

    def finish_run(self, run_id: str, *, summary: dict[str, Any] | None = None, error: str | None = None) -> None:
        body = {"summary": summary} if error is None else {"error": error}
        self._request("POST", f"/runner/runs/{run_id}/finish", body)

    def create_run(self, body: dict[str, Any]) -> str:
        return str(self._request("POST", "/runner/runs", body)["run_id"])

    # optimizer -------------------------------------------------------------------------------------
    def get_state(self, experiment_id: str) -> dict[str, Any]:
        return self._request("GET", f"/runner/experiments/{experiment_id}/state")

    def put_state(self, experiment_id: str, state: dict[str, Any]) -> None:
        self._request("PUT", f"/runner/experiments/{experiment_id}/state", state)

    def post_candidate(self, experiment_id: str, candidate: dict[str, Any]) -> None:
        self._request("POST", f"/runner/experiments/{experiment_id}/candidates", candidate)

    # datasets / usage ------------------------------------------------------------------------------
    def post_reviews(self, drafts: list[dict[str, Any]]) -> None:
        self._request("POST", "/runner/reviews", {"drafts": drafts})

    def post_usage(self, rows: list[dict[str, Any]]) -> None:
        if rows:
            self._request("POST", "/runner/usage", {"rows": rows})

    @contextmanager
    def heartbeats(self, run_id: str, every_s: float = 60.0) -> Iterator[None]:
        """Post a heartbeat every minute while the block runs (the control plane marks runs stalled after 10)."""
        stop = threading.Event()

        def beat() -> None:
            while not stop.wait(every_s):
                try:
                    self.heartbeat(run_id)
                except ControlPlaneError as exc:
                    log.info("heartbeat failed: %s", exc)

        thread = threading.Thread(target=beat, daemon=True)
        thread.start()
        try:
            yield
        finally:
            stop.set()
            thread.join(timeout=1)
