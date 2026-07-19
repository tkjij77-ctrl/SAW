from __future__ import annotations

import ast
import base64
import hashlib
import json
import os
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path


def load_functions(namespace: dict, *names: str):
    source = Path(__file__).with_name("app.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    module = ast.Module(body=nodes, type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), "app.py", "exec"), namespace)
    return [namespace[name] for name in names]


class ChunkedUploadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.logs: list[str] = []

        def safe_path(value=""):
            target = (self.root / str(value)).resolve()
            target.relative_to(self.root)
            return target

        def safe_child(name):
            value = str(name).strip()
            if not value or value in {".", ".."} or Path(value).name != value or "/" in value or "\\" in value:
                raise ValueError("invalid name")
            return value

        def atomic_write(path, content):
            path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix(path.suffix + ".tmp")
            temp.write_text(content, encoding="utf-8"); os.replace(temp, path)

        namespace = {
            "__builtins__": __builtins__, "Any": object,
            "WORKDIR": self.root, "UPLOAD_SESSIONS_DIR": self.root / ".saw-uploads",
            "UPLOAD_SESSION_TTL_SECONDS": 7200, "MAX_CHUNKED_UPLOAD_SIZE": 512 * 1024 * 1024,
            "UPLOAD_CHUNK_SIZE": 3 * 1024 * 1024, "UPLOAD_LOCK": threading.Lock(),
            "safe_path": safe_path, "safe_child_name": safe_child, "atomic_write": atomic_write,
            "secrets": __import__("secrets"), "json": json, "time": time, "os": os,
            "re": __import__("re"), "base64": base64, "hashlib": hashlib, "hmac": __import__("hmac"), "Path": Path,
            "log": self.logs.append,
        }
        names = [
            "_upload_session_paths", "_cleanup_upload_sessions", "api_file_upload_init",
            "_load_upload_session", "api_file_upload_chunk", "api_file_upload_status",
            "api_file_upload_complete", "api_file_upload_abort",
        ]
        loaded = load_functions(namespace, *names)
        self.fn = dict(zip(names, loaded))

    def test_upload_chunks_complete_atomically(self):
        payload = b"hello persistent world" * 100
        init = self.fn["api_file_upload_init"]("", "world.zip", str(len(payload)), hashlib.sha256(payload).hexdigest())
        upload_id = init["upload_id"]
        split = len(payload) // 2
        for index, chunk in enumerate((payload[:split], payload[split:])):
            result = self.fn["api_file_upload_chunk"](
                upload_id, str(index), base64.b64encode(chunk).decode(), hashlib.sha256(chunk).hexdigest()
            )
            self.assertEqual(result["next_index"], index + 1)
        completed = self.fn["api_file_upload_complete"](upload_id)
        self.assertEqual((self.root / "world.zip").read_bytes(), payload)
        self.assertEqual(completed["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertFalse((self.root / ".saw-uploads" / f"{upload_id}.json").exists())

    def test_duplicate_chunk_is_idempotent(self):
        payload = b"chunk-data"
        init = self.fn["api_file_upload_init"]("", "plugin.jar", str(len(payload)), "")
        encoded = base64.b64encode(payload).decode(); checksum = hashlib.sha256(payload).hexdigest()
        self.fn["api_file_upload_chunk"](init["upload_id"], "0", encoded, checksum)
        duplicate = self.fn["api_file_upload_chunk"](init["upload_id"], "0", encoded, checksum)
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["received"], len(payload))


class SafeApplyTests(unittest.TestCase):
    def make(self, dataset: bool = False):
        temp = tempfile.TemporaryDirectory(); root = Path(temp.name).resolve()
        properties = root / "server.properties"
        properties.write_text("motd=Old\nonline-mode=true\nenforce-secure-profile=false\n", encoding="utf-8")
        logs: list[str] = []
        def safe_path(value=""):
            target = (root / str(value)).resolve(); target.relative_to(root); return target
        def atomic_write(path, content):
            path = Path(path); tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(content, encoding="utf-8"); os.replace(tmp, path)
        namespace = {
            "__builtins__": __builtins__, "Any": object, "SAFE_APPLY_LOCK": threading.Lock(),
            "PROCESS_LOCK": threading.RLock(), "WORKDIR": root, "PROPERTIES_FILE": properties,
            "MAX_EDITABLE_SIZE": 512 * 1024, "DATASET_REPO_ID": "owner/data" if dataset else "",
            "HF_TOKEN": "token" if dataset else "", "server_phase": "stopped",
            "process_running": lambda: False, "safe_path": safe_path, "atomic_write": atomic_write,
            "hashlib": hashlib, "hmac": __import__("hmac"), "shutil": __import__("shutil"),
            "threading": threading, "start_worker": lambda: None, "_stop_process": lambda timeout=30: None,
            "log": logs.append,
            "_backup_create_sync": (lambda _label: (_ for _ in ()).throw(RuntimeError("snapshot failed"))) if dataset else lambda _label: {},
        }
        property_value, apply = load_functions(namespace, "_property_value", "_file_write_safe_sync")
        return temp, root, properties, logs, apply

    def test_safe_apply_preserves_valid_user_edits(self):
        temp, _root, properties, _logs, apply = self.make(False); self.addCleanup(temp.cleanup)
        content = "motd=New\nmax-players=42\nonline-mode=true\nenforce-secure-profile=false\n"
        result = apply("server.properties", content)
        self.assertEqual(properties.read_text(), content)
        self.assertEqual(result["persistence"], "local-only")

    def test_disabling_authentication_is_rejected_without_writing(self):
        temp, _root, properties, _logs, apply = self.make(False); self.addCleanup(temp.cleanup)
        old = properties.read_text()
        with self.assertRaisesRegex(ValueError, "Microsoft authentication cannot be disabled"):
            apply("server.properties", "motd=Unsafe\nonline-mode=false\nenforce-secure-profile=false\n")
        self.assertEqual(properties.read_text(), old)

    def test_snapshot_failure_rolls_back_file(self):
        temp, _root, properties, logs, apply = self.make(True); self.addCleanup(temp.cleanup)
        old = properties.read_text()
        with self.assertRaisesRegex(RuntimeError, "snapshot failed"):
            apply("server.properties", "motd=Changed\nonline-mode=true\nenforce-secure-profile=false\n")
        self.assertEqual(properties.read_text(), old)
        self.assertTrue(any("Restored previous file" in line for line in logs))


class PersistenceFingerprintTests(unittest.TestCase):
    def test_world_detection_and_fingerprint_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve(); state = root / ".saw-backup-state.json"
            def safe_path(value=""):
                target = (root / str(value)).resolve(); target.relative_to(root); return target
            def atomic_write(path, content): Path(path).write_text(content, encoding="utf-8")
            namespace = {
                "__builtins__": __builtins__, "Any": object, "WORKDIR": root,
                "BACKUP_STATE_FILE": state, "PROPERTIES_FILE": root / "server.properties",
                "hashlib": hashlib, "json": json, "Path": Path, "safe_path": safe_path,
                "atomic_write": atomic_write,
            }
            fingerprint, read_state, write_state, has_world = load_functions(
                namespace, "_backup_fingerprint", "_read_backup_state", "_write_backup_state", "_has_local_world_data"
            )
            self.assertFalse(has_world())
            world = root / "world"; world.mkdir(); level = world / "level.dat"; level.write_bytes(b"one")
            self.assertTrue(has_world())
            first = fingerprint(); time.sleep(0.002); level.write_bytes(b"two-two")
            second = fingerprint(); self.assertNotEqual(first, second)
            write_state(second, "backups/latest.tar.gz", "now")
            self.assertEqual(read_state()["fingerprint"], second)


if __name__ == "__main__":
    unittest.main()
