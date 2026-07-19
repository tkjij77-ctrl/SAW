"""Isolated unit tests for the Playit handoff state machine (no Gradio startup)."""
from __future__ import annotations

import ast
import tempfile
import threading
import types
import unittest
from pathlib import Path


def load_functions(namespace: dict, *names: str):
    source = Path(__file__).with_name("app.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    nodes = [item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name in names]
    module = ast.Module(body=nodes, type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), "app.py", "exec"), namespace)
    return [namespace[name] for name in names]


def load_handoff(namespace: dict):
    return load_functions(namespace, "perform_playit_program_handoff")[0]


class PlayitHandoffTests(unittest.TestCase):
    def scenario(self, fail_agent: bool = False):
        temp = tempfile.TemporaryDirectory()
        work = Path(temp.name)
        plugins = work / "plugins"
        plugins.mkdir()
        plugin = plugins / "playit.jar"
        plugin.write_bytes(b"plugin")
        calls: list[str] = []
        logs: list[str] = []
        event = threading.Event()

        def ensure(_secret: str):
            calls.append("agent")
            if fail_agent:
                raise RuntimeError("simulated failure")

        class ImmediateThread:
            def __init__(self, target, args=(), daemon=False):
                self.target, self.args = target, args
            def start(self):
                self.target(*self.args)

        namespace = {
            "__builtins__": __builtins__,
            "PLAYIT_HANDOFF_COMPLETE": event,
            "PLAYIT_HANDOFF_LOCK": threading.Lock(),
            "PLUGINS_DIR": plugins,
            "process_running": lambda: True,
            "_stop_process": lambda timeout=30: calls.append("stop"),
            "ensure_playit_program_running": ensure,
            "playit_tunnel_provisioning_worker": lambda _secret: calls.append("bedrock"),
            "threading": types.SimpleNamespace(Thread=ImmediateThread),
            "start_worker": lambda: calls.append("start"),
            "PROCESS_LOCK": threading.RLock(),
            "server_phase": "running",
            "time": types.SimpleNamespace(sleep=lambda _seconds: None),
            "log": logs.append,
        }
        handoff = load_handoff(namespace)
        handoff("secret-not-logged")
        return temp, plugins, calls, logs, event

    def test_successful_handoff_order(self):
        temp, plugins, calls, logs, event = self.scenario(False)
        self.addCleanup(temp.cleanup)
        self.assertEqual(calls, ["stop", "agent", "bedrock", "start"])
        self.assertFalse((plugins / "playit.jar").exists())
        self.assertTrue((plugins / "playit.jar.disabled").exists())
        self.assertTrue(event.is_set())
        self.assertFalse(any("secret-not-logged" in line for line in logs))

    def test_failed_agent_restores_plugin(self):
        temp, plugins, calls, logs, event = self.scenario(True)
        self.addCleanup(temp.cleanup)
        self.assertEqual(calls, ["stop", "agent", "start"])
        self.assertTrue((plugins / "playit.jar").exists())
        self.assertFalse((plugins / "playit.jar.disabled").exists())
        self.assertFalse(event.is_set())
        self.assertTrue(any("Restored Minecraft Playit plugin" in line for line in logs))


class PlayitReadinessTests(unittest.TestCase):
    def test_ready_log_is_emitted_outside_log_lock(self):
        lock = threading.Lock()
        emitted: list[str] = []

        class RunningProcess:
            @staticmethod
            def poll():
                return None

        def non_reentrant_log(message: str):
            if not lock.acquire(blocking=False):
                raise RuntimeError("LOG_LOCK re-entry detected")
            try:
                emitted.append(message)
            finally:
                lock.release()

        namespace = {
            "__builtins__": __builtins__,
            "LOG_LOCK": lock,
            "LOGS": ["[PLAYIT-AGENT] playit connected; tunnels loaded tunnel_count=0"],
            "playit_process": RunningProcess(),
            "time": __import__("time"),
            "log": non_reentrant_log,
        }
        wait = load_functions(namespace, "wait_for_playit_program_ready")[0]
        wait(timeout=1)
        self.assertTrue(any("control session is ready" in line for line in emitted))


class BedrockTunnelTests(unittest.TestCase):
    def functions(self, responses: list[object]):
        calls: list[tuple[str, object]] = []
        logs: list[str] = []

        def api(_secret: str, path: str, payload=None):
            calls.append((path, payload))
            if not responses:
                self.fail(f"Unexpected API call: {path}")
            return responses.pop(0)

        namespace = {
            "__builtins__": __builtins__,
            "Any": object,
            "playit_api_call": api,
            "log": logs.append,
            "time": types.SimpleNamespace(sleep=lambda _seconds: None),
        }
        extract, _list, _agent, _request, ensure = load_functions(
            namespace,
            "extract_playit_display_address",
            "_playit_tunnels",
            "_playit_agent_id",
            "_request_playit_tunnel",
            "ensure_playit_bedrock_tunnel",
        )
        return extract, ensure, calls, logs

    def test_existing_bedrock_tunnel_is_reused(self):
        java = {"tunnel_type": "minecraft-java", "connect_addresses": ["java.example"]}
        bedrock = {
            "tunnel_type": "minecraft-bedrock",
            "connect_addresses": [{"value": {"address": "bedrock.example", "default_port": 19132}}],
        }
        responses = [{"tunnels": [java, bedrock]}, {"agent_id": "agent-123"}]
        _extract, ensure, calls, logs = self.functions(responses)
        self.assertEqual(ensure("hidden"), "bedrock.example:19132")
        self.assertEqual([path for path, _ in calls], ["/v1/tunnels/list", "/v1/agents/rundata"])
        self.assertTrue(any("Existing tunnel ready" in line for line in logs))

    def test_missing_bedrock_tunnel_is_created_once(self):
        java = {"tunnel_type": "minecraft-java", "origin": {"details": {"agent_id": "agent-123"}}}
        bedrock = {
            "tunnel_type": "minecraft-bedrock",
            "connect_addresses": [{"value": {"address": "auto.example", "default_port": 23456}}],
        }
        responses = [
            {"tunnels": [java]},
            {"agent_id": "agent-123"},
            {"tunnels": [java]},
            {},
            {"tunnels": [java, bedrock]},
        ]
        _extract, ensure, calls, _logs = self.functions(responses)
        self.assertEqual(ensure("hidden"), "auto.example:23456")
        self.assertEqual([path for path, _ in calls], [
            "/v1/tunnels/list", "/v1/agents/rundata", "/v1/tunnels/list",
            "/v1/tunnels/create", "/v1/tunnels/list",
        ])
        payload = calls[3][1]
        self.assertEqual(payload["protocol"]["details"], "minecraft-bedrock")
        self.assertEqual(payload["origin"]["data"]["agent_id"], "agent-123")
        self.assertEqual(payload["endpoint"]["details"]["region"], "global")
        self.assertEqual(payload["origin"]["data"]["config"], {})
        self.assertNotIn("port", payload["endpoint"]["details"])
        self.assertNotIn("firewall_id", payload)

    def test_missing_java_and_bedrock_are_both_created(self):
        java = {"tunnel_type": "minecraft-java", "connect_addresses": ["java.auto.example"]}
        bedrock = {
            "tunnel_type": "minecraft-bedrock",
            "connect_addresses": [{"value": {"address": "bedrock.auto.example", "default_port": 34567}}],
        }
        responses = [
            {"tunnels": []},
            {"agent_id": "agent-456"},
            {"tunnels": []},
            {},
            {"tunnels": [java]},
            {"tunnels": [java]},
            {},
            {"tunnels": [java, bedrock]},
        ]
        _extract, ensure, calls, _logs = self.functions(responses)
        self.assertEqual(ensure("hidden"), "bedrock.auto.example:34567")
        create_payloads = [payload for path, payload in calls if path == "/v1/tunnels/create"]
        self.assertEqual([item["protocol"]["details"] for item in create_payloads], [
            "minecraft-java", "minecraft-bedrock",
        ])
        self.assertTrue(all(item["origin"]["data"]["agent_id"] == "agent-456" for item in create_payloads))


if __name__ == "__main__":
    unittest.main()
