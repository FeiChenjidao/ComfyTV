import asyncio
import threading
import time
import types


class _Executor:
    def __init__(self, state):
        self.state = state
        self.success = True
        self.status_messages = []

    def execute(self, *args):
        with self.state["lock"]:
            self.state["active"] += 1
            self.state["peak"] = max(self.state["peak"], self.state["active"])
        time.sleep(0.05)
        with self.state["lock"]:
            self.state["active"] -= 1


async def _run_pair(monkeypatch, allow_parallel):
    from ComfyTV.runners import _nested_exec as nested
    import server

    state = {"active": 0, "peak": 0, "lock": threading.Lock()}
    monkeypatch.setattr(
        nested,
        "_new_nested_executor",
        lambda _server: _Executor(state),
    )
    monkeypatch.setattr(
        server,
        "BinaryEventTypes",
        types.SimpleNamespace(PREVIEW_IMAGE_WITH_METADATA=99),
        raising=False,
    )
    nested._NESTED_LOCK = None
    await asyncio.gather(
        nested._run_subprompt({}, "a", [], allow_parallel=allow_parallel),
        nested._run_subprompt({}, "b", [], allow_parallel=allow_parallel),
    )
    return state["peak"]


def test_api_nested_runs_can_execute_in_parallel(monkeypatch):
    assert asyncio.run(_run_pair(monkeypatch, True)) == 2


def test_local_nested_runs_keep_resource_lock(monkeypatch):
    assert asyncio.run(_run_pair(monkeypatch, False)) == 1


def test_local_resource_lock_works_across_event_loops(monkeypatch):
    from ComfyTV.runners import _nested_exec as nested
    import server

    state = {"active": 0, "peak": 0, "lock": threading.Lock()}
    monkeypatch.setattr(
        nested,
        "_new_nested_executor",
        lambda _server: _Executor(state),
    )
    monkeypatch.setattr(
        server,
        "BinaryEventTypes",
        types.SimpleNamespace(PREVIEW_IMAGE_WITH_METADATA=99),
        raising=False,
    )
    nested._NESTED_LOCK = None
    errors = []

    def run(prompt_id):
        try:
            asyncio.run(nested._run_subprompt({}, prompt_id, []))
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(prompt_id,)) for prompt_id in ("a", "b")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert state["peak"] == 1


def test_contextual_prompt_events_route_to_execution_server():
    from ComfyTV.runners import _nested_exec as nested

    routed = []
    original = []
    instance = object()
    target = types.SimpleNamespace(
        send_sync=lambda event, data, sid=None: routed.append((event, data, sid)),
    )
    token = nested._EXECUTION_SERVER.set(target)
    try:
        nested._route_contextual_prompt_event(
            instance,
            lambda event, data, sid=None: original.append((event, data, sid)),
            "progress",
            {"node": "280"},
            "client-1",
        )
    finally:
        nested._EXECUTION_SERVER.reset(token)

    assert routed == [("progress", {"node": "280"}, "client-1")]
    assert original == []
