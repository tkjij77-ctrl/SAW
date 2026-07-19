from __future__ import annotations

import atexit
import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from huggingface_hub import CommitOperationDelete, HfApi, hf_hub_download

# Gradio SSR cannot resolve a password-protected app configuration before login.
# Force the classic frontend before importing Gradio, overriding the Space default.
os.environ["GRADIO_SSR_MODE"] = "false"

# IMPORTANT: ZeroGPU requires importing `spaces` before Gradio.
import spaces
import gradio as gr
import psutil

# Use the bare decorator form expected by ZeroGPU startup detection.
# Minecraft itself is CPU-based; this endpoint exists only for compatibility.
@spaces.GPU
def zero_gpu_probe() -> str:
    return "ZeroGPU function detected; Minecraft runs on CPU."


# ============================================================
# Configuration
# ============================================================

WORKDIR = Path(os.getenv("MC_WORKDIR", "/home/user/app/server")).resolve()
WORKDIR.mkdir(parents=True, exist_ok=True)

USERS_FILE = WORKDIR / "users.json"
EULA_FILE = WORKDIR / "eula.txt"
PROPERTIES_FILE = WORKDIR / "server.properties"
SERVER_JAR = WORKDIR / "paper.jar"
PLUGINS_DIR = WORKDIR / "plugins"
LOCAL_JAVA = WORKDIR / "jdk" / "bin" / "java"
PLAYIT_AGENT_BIN = WORKDIR / "playit-agent"

MC_VERSION = os.getenv("MC_VERSION", "1.21.1")
MC_XMS = os.getenv("MC_XMS", "512M")
MC_XMX = os.getenv("MC_XMX", "2G")
AUTO_START = os.getenv("AUTO_START", "false").lower() == "true"
ACCEPT_EULA = os.getenv("ACCEPT_EULA", "false").lower() == "true"
INSTALL_PLAYIT = os.getenv("INSTALL_PLAYIT", "true").lower() == "true"
INSTALL_CROSSPLAY = os.getenv("INSTALL_CROSSPLAY", "true").lower() == "true"
INSTALL_VIA_SUITE = os.getenv("INSTALL_VIA_SUITE", "true").lower() == "true"
PLAYIT_AGENT_SECRET = os.getenv("PLAYIT_AGENT_SECRET", "").strip()
DATASET_REPO_ID = os.getenv("DATASET_REPO_ID", "").strip()
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
BACKUP_RETENTION = max(1, min(25, int(os.getenv("BACKUP_RETENTION", "5"))))
BACKUP_MAX_BYTES = max(64 * 1024 * 1024, int(os.getenv("BACKUP_MAX_BYTES", str(2 * 1024**3))))
AUTO_RESTORE = os.getenv("AUTO_RESTORE", "true").lower() == "true"
AUTO_BACKUP = os.getenv("AUTO_BACKUP", "true").lower() == "true"
BACKUP_INTERVAL_MINUTES = max(15, min(1440, int(os.getenv("BACKUP_INTERVAL_MINUTES", "60"))))
MAX_CHUNKED_UPLOAD_SIZE = max(64 * 1024 * 1024, min(2 * 1024**3, int(os.getenv("MAX_CHUNKED_UPLOAD_SIZE", str(512 * 1024**2)))))
UPLOAD_CHUNK_SIZE = 3 * 1024 * 1024
UPLOAD_SESSION_TTL_SECONDS = 2 * 60 * 60

PANEL_USERNAME = os.getenv("PANEL_USERNAME", "admin").strip()
PANEL_PASSWORD = os.getenv("PANEL_PASSWORD", "")
# WARNING: With public access enabled, every visitor receives admin permissions.
PUBLIC_ACCESS = True

PURPUR_URL = f"https://api.purpurmc.org/v2/purpur/{MC_VERSION}/latest/download"
PLAYIT_URL = (
    "https://github.com/playit-cloud/playit-minecraft-plugin/"
    "releases/latest/download/playit-minecraft-plugin.jar"
)
GEYSER_URL = (
    "https://download.geysermc.org/v2/projects/geyser/versions/latest/"
    "builds/latest/downloads/spigot"
)
FLOODGATE_URL = (
    "https://download.geysermc.org/v2/projects/floodgate/versions/latest/"
    "builds/latest/downloads/spigot"
)
# Java runtime is selected dynamically from the Minecraft version using Adoptium API.

MAX_EDITABLE_SIZE = 512 * 1024
MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024
MAX_UPLOAD_SIZE = 100 * 1024 * 1024
MAX_CLOUD_UPLOAD_SIZE = 8 * 1024 * 1024  # Edge-safe MVP limit per file

BINARY_EXTENSIONS = {
    ".jar", ".zip", ".gz", ".tar", ".rar", ".7z", ".class",
    ".dat", ".mca", ".mcr", ".png", ".jpg", ".jpeg", ".gif",
    ".ico", ".exe", ".bin", ".db", ".so", ".dll", ".webp",
    ".mp3", ".ogg", ".wav", ".mp4", ".mov",
}

PERMISSIONS = {
    "admin": {
        "console", "start", "stop", "restart", "files_read",
        "files_write", "files_delete", "settings_manage", "users_manage",
    },
    "operator": {"console", "start", "stop", "restart", "files_read"},
    "editor": {"files_read", "files_write"},
    "viewer": {"files_read"},
}

# ============================================================
# Shared state
# ============================================================

LOGS: deque[str] = deque(maxlen=1000)
LOG_LOCK = threading.Lock()
PROCESS_LOCK = threading.RLock()
BACKUP_LOCK = threading.Lock()
BACKUP_JOBS_LOCK = threading.Lock()
BACKUP_JOBS: dict[str, dict[str, Any]] = {}
UPLOAD_LOCK = threading.Lock()
SAFE_APPLY_LOCK = threading.Lock()
SAFE_APPLY_JOBS_LOCK = threading.Lock()
SAFE_APPLY_JOBS: dict[str, dict[str, Any]] = {}
UPLOAD_SESSIONS_DIR = WORKDIR / ".saw-uploads"
BACKUP_STATE_FILE = WORKDIR / ".saw-backup-state.json"
PLAYIT_HANDOFF_LOCK = threading.Lock()
PLAYIT_HANDOFF_COMPLETE = threading.Event()
ONLINE_PLAYERS: set[str] = set()

mc_process: subprocess.Popen[str] | None = None
playit_process: subprocess.Popen[str] | None = None
server_phase = "stopped"
app_started_at = time.time()


def log(message: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {message}"
    with LOG_LOCK:
        LOGS.append(line)

    joined = re.search(r"(?:\]: )?(\S+) joined the game", message)
    left = re.search(r"(?:\]: )?(\S+) left the game", message)
    if joined:
        ONLINE_PLAYERS.add(joined.group(1))
    if left:
        ONLINE_PLAYERS.discard(left.group(1))


# ============================================================
# Accounts and authentication
# ============================================================


def _password_hash(password: str, salt: bytes | None = None) -> dict[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return {
        "salt": base64.b64encode(salt).decode(),
        "password_hash": base64.b64encode(digest).decode(),
    }


def load_users() -> dict[str, dict[str, str]]:
    try:
        if USERS_FILE.exists():
            data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
    except Exception as exc:
        log(f"[AUTH] Failed to load users: {exc}")
    return {}


def save_users(users: dict[str, dict[str, str]]) -> None:
    temp = USERS_FILE.with_suffix(".json.tmp")
    temp.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, USERS_FILE)


def bootstrap_admin() -> None:
    if not PANEL_PASSWORD:
        return
    users = load_users()
    record = {"role": "admin", **_password_hash(PANEL_PASSWORD)}
    users[PANEL_USERNAME] = record
    save_users(users)


def authenticate(username: str, password: str) -> bool:
    users = load_users()
    record = users.get((username or "").strip())
    if not isinstance(record, dict):
        return False
    try:
        salt = base64.b64decode(record["salt"])
        expected = base64.b64decode(record["password_hash"])
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def request_user(request: gr.Request | None) -> str | None:
    if PUBLIC_ACCESS:
        return PANEL_USERNAME
    return getattr(request, "username", None) if request else None


def has_perm(username: str | None, permission: str) -> bool:
    # Login-free mode: all visitors are treated as the panel administrator.
    if PUBLIC_ACCESS:
        return permission in PERMISSIONS["admin"]
    if not username:
        return False
    record = load_users().get(username, {})
    role = record.get("role") if isinstance(record, dict) else None
    return permission in PERMISSIONS.get(role or "", set())


def require_perm(request: gr.Request | None, permission: str) -> tuple[bool, str]:
    username = request_user(request)
    if not has_perm(username, permission):
        return False, f"⛔ المستخدم `{username or 'unknown'}` لا يملك صلاحية `{permission}`"
    return True, username or "unknown"


# ============================================================
# Safe paths and files
# ============================================================


def safe_path(relative: str | Path = "") -> Path:
    value = str(relative or "")
    if "\x00" in value:
        raise ValueError("Invalid path")
    candidate = (WORKDIR / value).resolve()
    try:
        candidate.relative_to(WORKDIR)
    except ValueError as exc:
        raise PermissionError("Path escapes the server directory") from exc
    return candidate


def safe_child_name(name: str) -> str:
    name = (name or "").strip()
    if not name or name in {".", ".."}:
        raise ValueError("Invalid name")
    if Path(name).name != name or "/" in name or "\\" in name:
        raise ValueError("Use a name only, not a path")
    if "\x00" in name:
        raise ValueError("Invalid name")
    return name


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def is_binary(path: Path) -> bool:
    if path.suffix.lower() in BINARY_EXTENSIONS:
        return True
    try:
        return b"\x00" in path.read_bytes()[:2048]
    except OSError:
        return True


def scan_directory(rel: str, request: gr.Request | None = None):
    allowed, message = require_perm(request, "files_read")
    if not allowed:
        return message, gr.update(choices=[], value=None), gr.update(choices=[], value=None)
    try:
        folder = safe_path(rel)
        if not folder.is_dir():
            raise NotADirectoryError(rel)
        dirs, files = [], []
        for entry in folder.iterdir():
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    dirs.append(entry.name)
                else:
                    files.append(entry.name)
            except OSError:
                continue
        dirs.sort(key=str.lower)
        files.sort(key=str.lower)
        shown = f"/root/{rel}" if rel else "/root"
        return shown, gr.update(choices=dirs, value=None), gr.update(choices=files, value=None)
    except Exception as exc:
        log(f"[FILES] Scan failed: {exc}")
        return f"❌ {exc}", gr.update(choices=[], value=None), gr.update(choices=[], value=None)


def enter_folder(selected: str, rel: str, request: gr.Request | None = None):
    allowed, message = require_perm(request, "files_read")
    if not allowed:
        return rel, message, gr.update(), gr.update()
    try:
        name = safe_child_name(selected)
        new_rel = str(Path(rel) / name) if rel else name
        target = safe_path(new_rel)
        if not target.is_dir() or target.is_symlink():
            raise ValueError("Folder not found")
        path, folders, files = scan_directory(new_rel, request)
        return new_rel, path, folders, files
    except Exception as exc:
        path, folders, files = scan_directory(rel, request)
        return rel, f"❌ {exc}", folders, files


def go_up(rel: str, request: gr.Request | None = None):
    parent = str(Path(rel).parent)
    if parent == ".":
        parent = ""
    path, folders, files = scan_directory(parent, request)
    return parent, path, folders, files


def load_file(filename: str, rel: str, request: gr.Request | None = None):
    allowed, message = require_perm(request, "files_read")
    if not allowed:
        return "", message
    try:
        name = safe_child_name(filename)
        path = safe_path(Path(rel) / name)
        if not path.is_file() or path.is_symlink():
            raise FileNotFoundError(name)
        size = path.stat().st_size
        if size > MAX_EDITABLE_SIZE:
            raise ValueError(f"الملف أكبر من حد التحرير ({MAX_EDITABLE_SIZE // 1024} KB)")
        if is_binary(path):
            raise ValueError("ملف ثنائي؛ استخدم التنزيل أو الاستبدال")
        content = path.read_text(encoding="utf-8", errors="replace")
        return content, f"📝 يتم تعديل: `{name}` — {size:,} bytes"
    except Exception as exc:
        return "", f"❌ {exc}"


def save_file(filename: str, content: str, rel: str, request: gr.Request | None = None):
    allowed, actor = require_perm(request, "files_write")
    if not allowed:
        return actor
    try:
        name = safe_child_name(filename)
        path = safe_path(Path(rel) / name)
        if path.is_symlink() or not path.is_file():
            raise ValueError("Invalid file")
        if len(content.encode("utf-8")) > MAX_EDITABLE_SIZE:
            raise ValueError("Content exceeds editor size limit")
        backup = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup)
        atomic_write(path, content)
        log(f"[AUDIT] {actor} saved {path.relative_to(WORKDIR)}")
        return f"✅ تم حفظ `{name}` وإنشاء نسخة `.bak`"
    except Exception as exc:
        return f"❌ فشل الحفظ: {exc}"


def create_item(name: str, item_type: str, rel: str, request: gr.Request | None = None):
    allowed, actor = require_perm(request, "files_write")
    if not allowed:
        return actor, *scan_directory(rel, request)
    try:
        name = safe_child_name(name)
        target = safe_path(Path(rel) / name)
        if target.exists():
            raise FileExistsError(name)
        if item_type == "Folder":
            target.mkdir()
        else:
            atomic_write(target, "")
        log(f"[AUDIT] {actor} created {target.relative_to(WORKDIR)}")
        return f"✅ تم إنشاء `{name}`", *scan_directory(rel, request)
    except Exception as exc:
        return f"❌ {exc}", *scan_directory(rel, request)


def rename_item(old: str, new: str, rel: str, request: gr.Request | None = None):
    allowed, actor = require_perm(request, "files_write")
    if not allowed:
        return actor, *scan_directory(rel, request)
    try:
        old_name, new_name = safe_child_name(old), safe_child_name(new)
        source = safe_path(Path(rel) / old_name)
        target = safe_path(Path(rel) / new_name)
        if source.is_symlink() or not source.exists():
            raise FileNotFoundError(old_name)
        if target.exists():
            raise FileExistsError(new_name)
        source.rename(target)
        log(f"[AUDIT] {actor} renamed {old_name} to {new_name}")
        return "✅ تمت إعادة التسمية", *scan_directory(rel, request)
    except Exception as exc:
        return f"❌ {exc}", *scan_directory(rel, request)


def delete_item(name: str, rel: str, confirmation: bool, request: gr.Request | None = None):
    allowed, actor = require_perm(request, "files_delete")
    if not allowed:
        return actor, *scan_directory(rel, request)
    if not confirmation:
        return "⚠️ فعّل مربع تأكيد الحذف أولًا", *scan_directory(rel, request)
    try:
        name = safe_child_name(name)
        target = safe_path(Path(rel) / name)
        if target.is_symlink() or not target.exists():
            raise FileNotFoundError(name)
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        log(f"[AUDIT] {actor} deleted {target.relative_to(WORKDIR)}")
        return f"✅ تم حذف `{name}`", *scan_directory(rel, request)
    except Exception as exc:
        return f"❌ {exc}", *scan_directory(rel, request)


def upload_files(files: list[str] | str | None, rel: str, request: gr.Request | None = None):
    allowed, actor = require_perm(request, "files_write")
    if not allowed:
        return actor, *scan_directory(rel, request)
    if not files:
        return "⚠️ اختر ملفًا واحدًا على الأقل", *scan_directory(rel, request)
    paths = files if isinstance(files, list) else [files]
    uploaded = []
    try:
        destination_dir = safe_path(rel)
        for source_value in paths:
            source = Path(source_value)
            if not source.is_file():
                continue
            if source.stat().st_size > MAX_UPLOAD_SIZE:
                raise ValueError(f"{source.name} exceeds the upload limit")
            name = safe_child_name(source.name)
            destination = safe_path(Path(rel) / name)
            shutil.copy2(source, destination)
            uploaded.append(name)
            log(f"[AUDIT] {actor} uploaded {destination.relative_to(WORKDIR)}")
        if not uploaded:
            raise ValueError("No valid files received")
        return f"✅ تم رفع: {', '.join(uploaded)}", *scan_directory(rel, request)
    except Exception as exc:
        return f"❌ فشل الرفع: {exc}", *scan_directory(rel, request)


def download_file(filename: str, rel: str, request: gr.Request | None = None):
    allowed, message = require_perm(request, "files_read")
    if not allowed:
        gr.Warning(message)
        return None
    try:
        name = safe_child_name(filename)
        path = safe_path(Path(rel) / name)
        if not path.is_file() or path.is_symlink():
            raise FileNotFoundError(name)
        if path.stat().st_size > MAX_DOWNLOAD_SIZE:
            raise ValueError("File is larger than the download limit")
        return str(path)
    except Exception as exc:
        gr.Warning(str(exc))
        return None


# ============================================================
# Downloads and Minecraft process
# ============================================================


def download(url: str, destination: Path, label: str, jar: bool = False) -> None:
    temp = destination.with_suffix(destination.suffix + ".download")
    log(f"[SETUP] Downloading {label}...")
    request = urllib.request.Request(url, headers={"User-Agent": "MC-Control-Panel/2.0"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response, temp.open("wb") as out:
            shutil.copyfileobj(response, out)
        if temp.stat().st_size == 0:
            raise ValueError("Empty download")
        if jar and temp.read_bytes()[:4] != b"PK\x03\x04":
            raise ValueError("Downloaded file is not a valid JAR/ZIP")
        os.replace(temp, destination)
        log(f"[SETUP] {label} downloaded")
    finally:
        temp.unlink(missing_ok=True)


def download_github_release_jar(repo: str, destination: Path, label: str) -> None:
    """Download the primary JAR from the latest GitHub release."""
    api_url = f"https://api.github.com/repos/{repo}/releases/latest"
    request = urllib.request.Request(
        api_url,
        headers={
            "User-Agent": "MC-Control-Cloud/2.3",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        release = json.load(response)
    assets = release.get("assets") or []
    candidates = []
    for asset in assets:
        name = str(asset.get("name") or "").lower()
        url = asset.get("browser_download_url")
        if not url or not name.endswith(".jar"):
            continue
        if any(word in name for word in ("sources", "javadoc", "api", "dev")):
            continue
        candidates.append((name, url))
    if not candidates:
        raise RuntimeError(f"No release JAR found for {repo}")
    candidates.sort(key=lambda item: ("universal" not in item[0], len(item[0])))
    download(candidates[0][1], destination, label, jar=True)


def resolve_playit_agent_secret() -> str:
    """Use an explicit secret, or securely reuse the claimed Minecraft plugin agent."""
    if PLAYIT_AGENT_SECRET:
        return PLAYIT_AGENT_SECRET
    plugin_config = PLUGINS_DIR / "playit-gg" / "config.yml"
    if not plugin_config.exists():
        return ""
    try:
        text = plugin_config.read_text(encoding="utf-8", errors="replace")
        match = re.search(r'(?m)^agent-secret:\s*["\']?([^"\'\s]+)', text)
        secret = match.group(1).strip() if match else ""
        return secret if len(secret) >= 32 else ""
    except Exception as exc:
        log(f"[PLAYIT-AGENT] Could not read existing plugin secret: {exc}")
        return ""


def ensure_playit_program_agent() -> Path:
    """Download the official Playit Linux agent used for TCP and UDP tunnels."""
    if PLAYIT_AGENT_BIN.is_file():
        PLAYIT_AGENT_BIN.chmod(0o755)
        return PLAYIT_AGENT_BIN
    api_url = "https://api.github.com/repos/playit-cloud/playit-agent/releases/latest"
    request = urllib.request.Request(
        api_url,
        headers={"User-Agent": "MC-Control-Cloud/2.4", "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        release = json.load(response)
    wanted = "playit-linux-amd64"
    asset_url = next(
        (a.get("browser_download_url") for a in release.get("assets", []) if a.get("name") == wanted),
        None,
    )
    if not asset_url:
        raise RuntimeError("Official Playit Linux amd64 asset was not found")
    download(asset_url, PLAYIT_AGENT_BIN, "Playit Program Agent", jar=False)
    PLAYIT_AGENT_BIN.chmod(0o755)
    return PLAYIT_AGENT_BIN


def child_process_env() -> dict[str, str]:
    """Do not expose Space secrets to Java plugins or tunnel subprocesses."""
    blocked_fragments = ("TOKEN", "SECRET", "PASSWORD", "AUTHORIZATION", "API_KEY")
    return {
        key: value for key, value in os.environ.items()
        if not any(fragment in key.upper() for fragment in blocked_fragments)
    }


def playit_reader(process: subprocess.Popen[str]) -> None:
    global playit_process
    try:
        if process.stdout:
            for line in iter(process.stdout.readline, ""):
                if line:
                    log(f"[PLAYIT-AGENT] {line.rstrip()}")
        code = process.wait()
        log(f"[PLAYIT-AGENT] exited with code {code}")
    except Exception as exc:
        log(f"[PLAYIT-AGENT] reader failed: {exc}")
    finally:
        if playit_process is process:
            playit_process = None


def ensure_playit_program_running(secret: str) -> None:
    """Start the official agent without exposing its secret in logs."""
    global playit_process
    if not secret:
        return
    if playit_process and playit_process.poll() is None:
        return
    binary = ensure_playit_program_agent()
    playit_process = subprocess.Popen(
        [str(binary), "--secret", secret, "--platform-docker"],
        cwd=WORKDIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=child_process_env(),
    )
    time.sleep(1.0)
    if playit_process.poll() is not None:
        raise RuntimeError(f"Playit Program Agent exited during startup ({playit_process.returncode})")
    log(f"[PLAYIT-AGENT] started PID={playit_process.pid} (secret hidden)")
    threading.Thread(target=playit_reader, args=(playit_process,), daemon=True).start()


def java_tunnel_was_confirmed() -> bool:
    with LOG_LOCK:
        return any("found minecraft java tunnel:" in line.lower() for line in LOGS)


def playit_api_call(secret: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    """Call the same agent-key API used by Playit's open-source Minecraft plugin."""
    body = json.dumps(payload or {}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.playit.gg{path}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"agent-key {secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "SAW-MC-Hosting-Agent/3.2",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = ""
        raise RuntimeError(f"Playit API HTTP {exc.code} for {path}: {detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"Playit API request failed for {path}") from exc
    if not isinstance(result, dict) or result.get("status") not in {"success", "ok"}:
        raise RuntimeError(f"Playit API rejected {path}")
    return result.get("data")


def extract_playit_display_address(tunnel: dict[str, Any]) -> str | None:
    addresses = tunnel.get("connect_addresses") or []
    if not isinstance(addresses, list):
        return None
    for entry in addresses:
        if isinstance(entry, str) and entry:
            return entry
        if not isinstance(entry, dict):
            continue
        value = entry.get("value")
        if isinstance(value, str) and value:
            return value
        if isinstance(value, dict):
            address = value.get("address")
            port = value.get("default_port")
            if address:
                return f"{address}:{port}" if port and ":" not in str(address) else str(address)
        for nested in entry.values():
            if isinstance(nested, dict):
                address = nested.get("address")
                port = nested.get("default_port")
                if address:
                    return f"{address}:{port}" if port and ":" not in str(address) else str(address)
    return None


def wait_for_playit_program_ready(timeout: int = 45) -> None:
    """Wait until the daemon has authenticated and loaded its tunnel configuration."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not playit_process or playit_process.poll() is not None:
            raise RuntimeError("Playit Program Agent stopped before becoming ready")
        with LOG_LOCK:
            ready = any("playit connected; tunnels loaded" in line.lower() for line in LOGS)
        if ready:
            # Never call log() while LOG_LOCK is held; log() acquires the same lock.
            log("[PLAYIT-HANDOFF] Program Agent control session is ready")
            return
        time.sleep(1)
    raise RuntimeError("Timed out waiting for Playit Program Agent control session")


def _playit_tunnels(secret: str) -> list[dict[str, Any]]:
    listed = playit_api_call(secret, "/v1/tunnels/list") or {}
    tunnels = listed.get("tunnels") if isinstance(listed, dict) else []
    return [item for item in tunnels if isinstance(item, dict)] if isinstance(tunnels, list) else []


def _playit_agent_id(secret: str, tunnels: list[dict[str, Any]]) -> str:
    run_data = playit_api_call(secret, "/v1/agents/rundata") or {}
    agent_id = run_data.get("agent_id") if isinstance(run_data, dict) else None
    if agent_id:
        return str(agent_id)
    for tunnel in tunnels:
        origin = tunnel.get("origin") or {}
        details = origin.get("details") if isinstance(origin, dict) else {}
        if isinstance(details, dict) and details.get("agent_id"):
            return str(details["agent_id"])
    raise RuntimeError("Playit agent ID is unavailable")


def _request_playit_tunnel(secret: str, agent_id: str, tunnel_type: str, name: str) -> None:
    # Matches Jackson NON_NULL serialization in Playit's official open-source plugin.
    create = {
        "name": name,
        "protocol": {"type": "tunnel-type", "details": tunnel_type},
        "origin": {
            "type": "agent",
            "data": {"agent_id": agent_id, "config": {}},
        },
        "endpoint": {
            "type": "region",
            "details": {"region": "global"},
        },
        "enabled": True,
    }
    playit_api_call(secret, "/v1/tunnels/create", create)


def ensure_playit_bedrock_tunnel(secret: str) -> str | None:
    """Idempotently ensure both Java TCP and Bedrock UDP tunnels after daemon readiness."""
    desired = [
        ("minecraft-java", "SAW Minecraft Java", "PLAYIT-JAVA"),
        ("minecraft-bedrock", "SAW Minecraft Bedrock", "PLAYIT-BEDROCK"),
    ]
    tunnels = _playit_tunnels(secret)
    agent_id = _playit_agent_id(secret, tunnels)
    bedrock_address: str | None = None

    for tunnel_type, name, log_tag in desired:
        existing = next((item for item in tunnels if item.get("tunnel_type") == tunnel_type), None)
        if existing:
            address = extract_playit_display_address(existing)
            log(f"[{log_tag}] Existing tunnel ready: {address or 'allocation pending'}")
            if tunnel_type == "minecraft-bedrock":
                bedrock_address = address
            continue

        last_error: Exception | None = None
        for attempt in range(1, 6):
            # Re-list before retries so a successful-but-delayed request cannot create duplicates.
            tunnels = _playit_tunnels(secret)
            existing = next((item for item in tunnels if item.get("tunnel_type") == tunnel_type), None)
            if existing:
                break
            try:
                _request_playit_tunnel(secret, agent_id, tunnel_type, name)
                log(f"[{log_tag}] Automatic {tunnel_type} tunnel requested (attempt {attempt})")
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                log(f"[{log_tag}] Create attempt {attempt} delayed: {exc}")
                time.sleep(min(2 * attempt, 8))
        if last_error:
            raise RuntimeError(f"Could not create {tunnel_type} tunnel after retries") from last_error

        for _ in range(20):
            time.sleep(1)
            tunnels = _playit_tunnels(secret)
            existing = next((item for item in tunnels if item.get("tunnel_type") == tunnel_type), None)
            if existing:
                address = extract_playit_display_address(existing)
                log(f"[{log_tag}] Tunnel ready: {address or 'allocation pending'}")
                if tunnel_type == "minecraft-bedrock":
                    bedrock_address = address
                break
        else:
            raise RuntimeError(f"{tunnel_type} tunnel allocation is still pending")

    return bedrock_address


def playit_tunnel_provisioning_worker(secret: str) -> None:
    """Provision tunnels after the daemon control session is ready, with bounded retries."""
    try:
        wait_for_playit_program_ready(timeout=90)
    except Exception as exc:
        log(f"[PLAYIT-TUNNELS] Program Agent readiness failed: {exc}")
        return
    for attempt in range(1, 4):
        try:
            address = ensure_playit_bedrock_tunnel(secret)
            log(f"[PLAYIT-TUNNELS] Java + Bedrock automatic setup complete; Bedrock={address or 'allocation pending'}")
            return
        except Exception as exc:
            log(f"[PLAYIT-TUNNELS] Provisioning pass {attempt} failed: {exc}")
            if attempt < 3:
                time.sleep(15 * attempt)
    log("[PLAYIT-TUNNELS] Automatic setup exhausted retries; dashboard fallback remains available")


def perform_playit_program_handoff(secret: str) -> None:
    """Gracefully replace the TCP-only Minecraft plugin with the TCP/UDP agent."""
    global server_phase
    if PLAYIT_HANDOFF_COMPLETE.is_set():
        return
    if not PLAYIT_HANDOFF_LOCK.acquire(blocking=False):
        return
    playit_plugin = PLUGINS_DIR / "playit.jar"
    playit_disabled = PLUGINS_DIR / "playit.jar.disabled"
    was_running = process_running()
    plugin_was_disabled = False
    try:
        log("[PLAYIT-HANDOFF] Claimed Java tunnel detected; switching to Program Agent for Java + Bedrock UDP")
        if was_running:
            _stop_process(timeout=30)
            time.sleep(2)
        if playit_plugin.exists():
            playit_plugin.replace(playit_disabled)
            plugin_was_disabled = True
            log("[PLAYIT-HANDOFF] Minecraft Playit plugin disabled to prevent duplicate agents")
        ensure_playit_program_running(secret)
        PLAYIT_HANDOFF_COMPLETE.set()
        log("[PLAYIT-HANDOFF] Program Agent process started for Java TCP + Bedrock UDP")
        threading.Thread(
            target=playit_tunnel_provisioning_worker,
            args=(secret,),
            daemon=True,
        ).start()
    except Exception as exc:
        log(f"[PLAYIT-HANDOFF] Failed: {exc}")
        if plugin_was_disabled and playit_disabled.exists() and not playit_plugin.exists():
            playit_disabled.replace(playit_plugin)
            log("[PLAYIT-HANDOFF] Restored Minecraft Playit plugin after failed handoff")
    finally:
        PLAYIT_HANDOFF_LOCK.release()
    if was_running:
        with PROCESS_LOCK:
            server_phase = "starting"
        start_worker()


def playit_handoff_watcher() -> None:
    """Wait for first-time plugin claim, then perform one safe automatic handoff."""
    if not INSTALL_PLAYIT:
        return
    deadline = time.time() + 30 * 60
    while time.time() < deadline and not PLAYIT_HANDOFF_COMPLETE.is_set():
        if playit_process and playit_process.poll() is None:
            secret = resolve_playit_agent_secret()
            PLAYIT_HANDOFF_COMPLETE.set()
            if secret:
                log("[PLAYIT-HANDOFF] Existing Program Agent detected; validating Java + Bedrock tunnels")
                threading.Thread(
                    target=playit_tunnel_provisioning_worker,
                    args=(secret,),
                    daemon=True,
                ).start()
            return
        secret = resolve_playit_agent_secret()
        if secret and (PLAYIT_AGENT_SECRET or java_tunnel_was_confirmed()):
            perform_playit_program_handoff(secret)
            if PLAYIT_HANDOFF_COMPLETE.is_set():
                return
            time.sleep(15)
            continue
        time.sleep(3)
    if not PLAYIT_HANDOFF_COMPLETE.is_set():
        log("[PLAYIT-HANDOFF] Timed out waiting for a claimed Playit plugin agent")


def ensure_property(key: str, value: str) -> None:
    """Update one server.properties key without deleting unrelated settings."""
    lines = PROPERTIES_FILE.read_text(encoding="utf-8").splitlines() if PROPERTIES_FILE.exists() else []
    result, found = [], False
    for line in lines:
        if line.startswith(key + "="):
            result.append(f"{key}={value}")
            found = True
        else:
            result.append(line)
    if not found:
        result.append(f"{key}={value}")
    atomic_write(PROPERTIES_FILE, "\n".join(result) + "\n")


def configure_geyser_if_present() -> None:
    """Switch generated Geyser config to Floodgate authentication."""
    config = PLUGINS_DIR / "Geyser-Spigot" / "config.yml"
    if not config.exists():
        return
    text = config.read_text(encoding="utf-8", errors="replace")
    updated = re.sub(r"(?m)^(\s*auth-type:\s*)online\s*$", r"\1floodgate", text)
    if updated != text:
        atomic_write(config, updated)
        log("[SETUP] Geyser configured to use Floodgate authentication")


def version_tuple(version: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in version.split("."))
    except ValueError:
        return (0,)


def required_java_major(version: str) -> int:
    parsed = version_tuple(version)
    if parsed and parsed[0] >= 26:
        return 25
    if parsed >= (1, 20, 5):
        return 21
    if parsed >= (1, 18):
        return 17
    if parsed >= (1, 17):
        return 16
    return 8


def ensure_java() -> Path:
    java_major = required_java_major(MC_VERSION)
    configured = os.getenv("JAVA_BIN")
    if configured and Path(configured).is_file():
        return Path(configured)
    marker = WORKDIR / "jdk" / ".java-major"
    if LOCAL_JAVA.is_file() and marker.exists() and marker.read_text().strip() == str(java_major):
        return LOCAL_JAVA

    archive = WORKDIR / "jre.tar.gz"
    jre_url = (
        f"https://api.adoptium.net/v3/binary/latest/{java_major}/ga/"
        "linux/x64/jre/hotspot/normal/eclipse"
    )
    download(jre_url, archive, f"Java {java_major}")
    extract_dir = WORKDIR / ".jre-extract"
    shutil.rmtree(extract_dir, ignore_errors=True)
    extract_dir.mkdir()
    try:
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(extract_dir, filter="data")
        candidates = list(extract_dir.glob("*/bin/java"))
        if not candidates:
            raise RuntimeError("Java executable not found in archive")
        root = candidates[0].parent.parent
        shutil.rmtree(WORKDIR / "jdk", ignore_errors=True)
        shutil.move(str(root), str(WORKDIR / "jdk"))
        (WORKDIR / "jdk" / ".java-major").write_text(str(java_major), encoding="utf-8")
    finally:
        archive.unlink(missing_ok=True)
        shutil.rmtree(extract_dir, ignore_errors=True)
    return LOCAL_JAVA


def ensure_server_files() -> Path:
    if not ACCEPT_EULA:
        raise RuntimeError("Set ACCEPT_EULA=true after reading the Minecraft EULA")
    EULA_FILE.write_text("eula=true\n", encoding="utf-8")
    if not SERVER_JAR.is_file():
        download(PURPUR_URL, SERVER_JAR, f"Purpur {MC_VERSION}", jar=True)
    PLUGINS_DIR.mkdir(exist_ok=True)
    playit_plugin = PLUGINS_DIR / "playit.jar"
    playit_disabled = PLUGINS_DIR / "playit.jar.disabled"
    program_secret = resolve_playit_agent_secret()
    if program_secret:
        # Reuse the already-claimed plugin agent. This preserves the existing agent
        # slot and Java tunnel while upgrading it to the TCP/UDP Program Agent.
        if playit_plugin.exists():
            playit_plugin.replace(playit_disabled)
            log("[SETUP] Reusing claimed Playit agent; enabled Program Agent for Java + Bedrock UDP")
        ensure_playit_program_running(program_secret)
    elif INSTALL_PLAYIT:
        if not playit_plugin.is_file():
            download(PLAYIT_URL, playit_plugin, "Playit plugin", jar=True)

    if INSTALL_CROSSPLAY:
        crossplay_plugins = [
            (GEYSER_URL, PLUGINS_DIR / "Geyser-Spigot.jar", "Geyser-Spigot"),
            (FLOODGATE_URL, PLUGINS_DIR / "floodgate-spigot.jar", "Floodgate-Spigot"),
        ]
        for url, path, label in crossplay_plugins:
            if not path.is_file():
                try:
                    download(url, path, label, jar=True)
                except Exception as exc:
                    log(f"[SETUP] Failed to install {label}: {exc}")

    if INSTALL_VIA_SUITE:
        via_plugins = [
            ("ViaVersion/ViaVersion", PLUGINS_DIR / "ViaVersion.jar", "ViaVersion"),
            ("ViaVersion/ViaBackwards", PLUGINS_DIR / "ViaBackwards.jar", "ViaBackwards"),
            ("ViaVersion/ViaRewind", PLUGINS_DIR / "ViaRewind.jar", "ViaRewind"),
        ]
        for repo, path, label in via_plugins:
            if not path.is_file():
                try:
                    download_github_release_jar(repo, path, label)
                except Exception as exc:
                    log(f"[SETUP] Failed to install {label}: {exc}")

    if not PROPERTIES_FILE.exists():
        atomic_write(
            PROPERTIES_FILE,
            "online-mode=true\n"
            "enforce-secure-profile=false\n"
            "spawn-protection=0\n"
            "motd=Java and Bedrock Crossplay Server\n"
            "max-players=20\n",
        )
    ensure_property("online-mode", "true")
    ensure_property("enforce-secure-profile", "false")
    configure_geyser_if_present()
    return ensure_java()


def process_running() -> bool:
    with PROCESS_LOCK:
        return mc_process is not None and mc_process.poll() is None


def server_reader(process: subprocess.Popen[str]) -> None:
    global mc_process, server_phase
    try:
        if process.stdout:
            for line in iter(process.stdout.readline, ""):
                if line:
                    log(f"[MINECRAFT] {line.rstrip()}")
        code = process.wait()
        log(f"[SYSTEM] Minecraft exited with code {code}")
    except Exception as exc:
        log(f"[SYSTEM] Log reader failed: {exc}")
    finally:
        with PROCESS_LOCK:
            if mc_process is process:
                mc_process = None
                server_phase = "stopped"
        ONLINE_PLAYERS.clear()


def start_worker() -> None:
    global mc_process, server_phase
    try:
        java = ensure_server_files()
        command = [str(java)]
        if required_java_major(MC_VERSION) >= 16:
            command.append("--add-modules=jdk.incubator.vector")
        command.extend([
            f"-Xms{MC_XMS}", f"-Xmx{MC_XMX}",
            "-jar", SERVER_JAR.name, "nogui",
        ])
        with PROCESS_LOCK:
            if mc_process and mc_process.poll() is None:
                server_phase = "running"
                return
            mc_process = subprocess.Popen(
                command,
                cwd=WORKDIR,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                start_new_session=True,
                env=child_process_env(),
            )
            process = mc_process
            server_phase = "running"
        log(f"[SYSTEM] Started Minecraft PID={process.pid}")
        server_reader(process)
    except Exception as exc:
        with PROCESS_LOCK:
            mc_process = None
            server_phase = "crashed"
        log(f"[FATAL] Failed to start server: {exc}")


def start_server(request: gr.Request | None = None) -> str:
    global server_phase
    allowed, actor = require_perm(request, "start")
    if not allowed:
        return actor
    with PROCESS_LOCK:
        if mc_process and mc_process.poll() is None:
            return "⚠️ السيرفر يعمل بالفعل"
        if server_phase == "starting":
            return "⚠️ السيرفر قيد التشغيل بالفعل"
        server_phase = "starting"
    log(f"[AUDIT] {actor} requested START")
    threading.Thread(target=bootstrap_start_worker, daemon=True).start()
    return "⚡ بدأ فحص التخزين ثم تشغيل السيرفر. تابع الـ Console."


def _stop_process(timeout: int = 20) -> bool:
    global mc_process, server_phase
    with PROCESS_LOCK:
        process = mc_process
        if not process or process.poll() is not None:
            mc_process = None
            server_phase = "stopped"
            return False
        server_phase = "stopping"
        try:
            if process.stdin:
                process.stdin.write("save-all flush\n")
                process.stdin.write("stop\n")
                process.stdin.flush()
        except Exception as exc:
            log(f"[SYSTEM] Graceful stop command failed: {exc}")
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    with PROCESS_LOCK:
        if mc_process is process:
            mc_process = None
        server_phase = "stopped"
    ONLINE_PLAYERS.clear()
    return True


def stop_server(request: gr.Request | None = None) -> str:
    allowed, actor = require_perm(request, "stop")
    if not allowed:
        return actor
    log(f"[AUDIT] {actor} requested STOP")
    return "🛑 تم إيقاف السيرفر" if _stop_process() else "⚠️ السيرفر متوقف بالفعل"


def restart_server(request: gr.Request | None = None) -> str:
    allowed, actor = require_perm(request, "restart")
    if not allowed:
        return actor

    def worker():
        global server_phase
        log(f"[AUDIT] {actor} requested RESTART")
        if AUTO_BACKUP and DATASET_REPO_ID and HF_TOKEN:
            try:
                result = _backup_create_sync("Automatic pre-restart backup")
                log(f"[PERSISTENCE] Pre-restart backup verified: {result.get('archive')}")
            except Exception as exc:
                log(f"[PERSISTENCE] Pre-restart backup failed; restart cancelled: {exc}")
                return
        _stop_process()
        with PROCESS_LOCK:
            server_phase = "starting"
        start_worker()

    threading.Thread(target=worker, daemon=True).start()
    return "🔄 بدأت إعادة التشغيل الآمنة"


def send_command(command: str, request: gr.Request | None = None) -> str:
    allowed, actor = require_perm(request, "console")
    if not allowed:
        return actor
    command = (command or "").strip().lstrip("/")
    if not command or "\n" in command or "\r" in command:
        return "⚠️ أدخل أمرًا صالحًا في سطر واحد"
    with PROCESS_LOCK:
        if not mc_process or mc_process.poll() is not None or not mc_process.stdin:
            return "⚠️ السيرفر لا يعمل"
        try:
            mc_process.stdin.write(command + "\n")
            mc_process.stdin.flush()
        except Exception as exc:
            return f"❌ {exc}"
    log(f"[AUDIT] {actor} sent console command: {command}")
    return f"✅ تم إرسال: `{command}`"


# ============================================================
# Monitoring, settings and users
# ============================================================


def status_text() -> str:
    with PROCESS_LOCK:
        phase = server_phase
        process = mc_process
    icons = {
        "running": "🟢", "starting": "🟡", "stopping": "🟠",
        "stopped": "🔴", "crashed": "💥",
    }
    pid = process.pid if process and process.poll() is None else "—"
    return (
        f"## {icons.get(phase, '⚪')} {phase.title()}\n"
        f"**Purpur:** {MC_VERSION}  |  **RAM:** {MC_XMS}–{MC_XMX}  |  **PID:** {pid}"
    )


def logs_text() -> str:
    with LOG_LOCK:
        return "\n".join(LOGS) or "[SYSTEM] No logs yet"


def resources_text() -> str:
    cpu = psutil.cpu_percent(interval=None)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(str(WORKDIR))
    java_info = "not running"
    with PROCESS_LOCK:
        process = mc_process
    if process and process.poll() is None:
        try:
            p = psutil.Process(process.pid)
            java_info = f"{p.memory_info().rss / 1024**3:.2f} GB RAM, {p.cpu_percent():.1f}% CPU"
        except Exception:
            java_info = "unavailable"
    return (
        f"CPU: {cpu:.1f}% | RAM: {memory.percent:.1f}% "
        f"({memory.used / 1024**3:.1f}/{memory.total / 1024**3:.1f} GB)\n"
        f"Disk: {disk.percent:.1f}% ({disk.used / 1024**3:.1f}/{disk.total / 1024**3:.1f} GB)\n"
        f"Java: {java_info} | Players: {', '.join(sorted(ONLINE_PLAYERS)) or 'none'}"
    )


def refresh_dashboard():
    return status_text(), logs_text(), resources_text()


# Public, named API payloads consumed by MC Control Cloud.
# Access is controlled by Hugging Face Space visibility/OAuth; Gradio Basic Auth
# must stay disabled or the external JS client cannot read /config.
def api_server_status() -> dict[str, Any]:
    with PROCESS_LOCK:
        process = mc_process
        phase = server_phase
    return {
        "status": phase,
        "running": bool(process and process.poll() is None),
        "pid": process.pid if process and process.poll() is None else None,
        "version": MC_VERSION,
        "persistence": {
            "dataset": DATASET_REPO_ID or None,
            "auto_restore": AUTO_RESTORE,
            "auto_backup": AUTO_BACKUP,
            "interval_minutes": BACKUP_INTERVAL_MINUTES,
            "last_backup": _read_backup_state(),
        },
    }


def api_server_resources() -> dict[str, Any]:
    result: dict[str, Any] = {
        "cpu": psutil.cpu_percent(interval=None),
        "memory": "not running",
        "memory_bytes": 0,
        "uptime": int(time.time() - app_started_at),
    }
    with PROCESS_LOCK:
        process = mc_process
    if process and process.poll() is None:
        try:
            java = psutil.Process(process.pid)
            rss = java.memory_info().rss
            result["memory_bytes"] = rss
            result["memory"] = f"{rss / 1024**3:.2f} GB"
            result["java_cpu"] = java.cpu_percent()
        except Exception:
            pass
    return result


def api_server_players() -> list[str]:
    return sorted(ONLINE_PLAYERS)


def api_files_list(relative_path: str = "") -> dict[str, Any]:
    """List a safe directory for the external cloud panel."""
    folder = safe_path(relative_path or "")
    if not folder.is_dir() or folder.is_symlink():
        raise ValueError("Directory not found")
    folders: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    for entry in folder.iterdir():
        if entry.is_symlink():
            continue
        try:
            if entry.is_dir():
                folders.append({"name": entry.name})
            elif entry.is_file():
                files.append({
                    "name": entry.name,
                    "size": entry.stat().st_size,
                    "binary": is_binary(entry),
                })
        except OSError:
            continue
    folders.sort(key=lambda x: x["name"].lower())
    files.sort(key=lambda x: x["name"].lower())
    return {"path": relative_path or "", "folders": folders, "files": files}


def api_file_read(relative_path: str) -> dict[str, Any]:
    path = safe_path(relative_path)
    if not path.is_file() or path.is_symlink():
        raise FileNotFoundError("File not found")
    if path.stat().st_size > MAX_EDITABLE_SIZE:
        raise ValueError("File exceeds the editable size limit")
    if is_binary(path):
        raise ValueError("Binary files cannot be edited as text")
    return {
        "path": relative_path,
        "name": path.name,
        "size": path.stat().st_size,
        "content": path.read_text(encoding="utf-8", errors="replace"),
    }


def api_file_write(relative_path: str, content: str) -> dict[str, Any]:
    path = safe_path(relative_path)
    if path.is_symlink() or not path.is_file():
        raise FileNotFoundError("File not found")
    if len(content.encode("utf-8")) > MAX_EDITABLE_SIZE:
        raise ValueError("Content exceeds the editable size limit")
    backup = path.with_suffix(path.suffix + ".bak")
    shutil.copy2(path, backup)
    atomic_write(path, content)
    log(f"[AUDIT] Cloud API saved {path.relative_to(WORKDIR)}")
    return {"ok": True, "path": relative_path, "backup": backup.name}


def _property_value(content: str, key: str) -> str | None:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        current, value = stripped.split("=", 1)
        if current.strip() == key:
            return value.strip().lower()
    return None


def _file_write_safe_sync(relative_path: str, content: str) -> dict[str, Any]:
    """Validate, stop, atomically write, verify, persist and restart as one operation."""
    global server_phase
    if not SAFE_APPLY_LOCK.acquire(blocking=False):
        raise RuntimeError("Another safe file apply operation is already running")
    was_running = False
    backup: Path | None = None
    try:
        path = safe_path(relative_path)
        if path.is_symlink() or not path.is_file():
            raise FileNotFoundError("File not found")
        if len(content.encode("utf-8")) > MAX_EDITABLE_SIZE:
            raise ValueError("Content exceeds the editable size limit")

        if path == PROPERTIES_FILE:
            online_mode = _property_value(content, "online-mode")
            secure_profile = _property_value(content, "enforce-secure-profile")
            if online_mode != "true":
                raise ValueError("online-mode=true is required; Microsoft authentication cannot be disabled")
            if secure_profile != "false":
                raise ValueError("enforce-secure-profile=false is required for Floodgate Bedrock compatibility")

        was_running = process_running()
        if was_running:
            log(f"[SAFE-APPLY] Stopping Minecraft before writing {relative_path}")
            _stop_process(timeout=30)

        backup = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup)
        atomic_write(path, content)
        expected = hashlib.sha256(content.encode("utf-8")).hexdigest()
        actual_bytes = path.read_bytes()
        actual = hashlib.sha256(actual_bytes).hexdigest()
        if not hmac.compare_digest(expected, actual) or actual_bytes.decode("utf-8") != content:
            raise RuntimeError("Read-back verification failed after atomic write")

        dataset_backup: str | None = None
        persistence = "local-only"
        if DATASET_REPO_ID and HF_TOKEN:
            snapshot = _backup_create_sync(f"Safe apply: {relative_path}")
            dataset_backup = str(snapshot.get("archive") or "") or None
            persistence = "dataset-verified"
        else:
            log("[SAFE-APPLY] Dataset is not configured; file is verified locally only")

        log(f"[AUDIT] Safe apply verified {path.relative_to(WORKDIR)} SHA-256={actual[:12]}")
        return {
            "ok": True,
            "path": relative_path,
            "backup": backup.name,
            "sha256": actual,
            "content": content,
            "persistence": persistence,
            "dataset_backup": dataset_backup,
            "restarting": was_running,
        }
    except Exception:
        if backup and backup.is_file():
            try:
                shutil.copy2(backup, safe_path(relative_path))
                log(f"[SAFE-APPLY] Restored previous file after failure: {relative_path}")
            except Exception as restore_error:
                log(f"[SAFE-APPLY] Critical rollback failure for {relative_path}: {restore_error}")
        raise
    finally:
        if was_running:
            with PROCESS_LOCK:
                server_phase = "starting"
            threading.Thread(target=start_worker, daemon=True).start()
        SAFE_APPLY_LOCK.release()


def _run_safe_apply_job(job_id: str, relative_path: str, content: str) -> None:
    with SAFE_APPLY_JOBS_LOCK:
        SAFE_APPLY_JOBS[job_id].update({"state": "running", "started_at": datetime.now(timezone.utc).isoformat()})
    try:
        result = _file_write_safe_sync(relative_path, content)
        with SAFE_APPLY_JOBS_LOCK:
            SAFE_APPLY_JOBS[job_id].update({
                "state": "completed", "result": result,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as exc:
        with SAFE_APPLY_JOBS_LOCK:
            SAFE_APPLY_JOBS[job_id].update({
                "state": "failed", "error": str(exc)[:500],
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })


def api_file_write_safe(relative_path: str, content: str) -> dict[str, Any]:
    if len(content.encode("utf-8")) > MAX_EDITABLE_SIZE:
        raise ValueError("Content exceeds the editable size limit")
    job_id = "apply_" + secrets.token_hex(12)
    with SAFE_APPLY_JOBS_LOCK:
        if len(SAFE_APPLY_JOBS) >= 50:
            finished = [key for key, job in SAFE_APPLY_JOBS.items() if job.get("state") in {"completed", "failed"}]
            for key in finished[:max(1, len(SAFE_APPLY_JOBS) - 49)]:
                SAFE_APPLY_JOBS.pop(key, None)
        SAFE_APPLY_JOBS[job_id] = {
            "id": job_id, "path": relative_path, "state": "queued",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    threading.Thread(target=_run_safe_apply_job, args=(job_id, relative_path, content), daemon=True).start()
    return {"ok": True, "queued": True, "job_id": job_id, "state": "queued"}


def api_file_write_safe_status(job_id: str) -> dict[str, Any]:
    value = str(job_id or "")
    if not re.fullmatch(r"apply_[0-9a-f]{24}", value):
        raise ValueError("Invalid Safe Apply job ID")
    with SAFE_APPLY_JOBS_LOCK:
        job = SAFE_APPLY_JOBS.get(value)
        if not job:
            raise FileNotFoundError("Safe Apply job not found or Space restarted")
        return dict(job)


def api_file_upload(relative_dir: str, filename: str, data_base64: str) -> dict[str, Any]:
    name = safe_child_name(filename)
    directory = safe_path(relative_dir or "")
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("Upload directory not found")
    try:
        payload = base64.b64decode(data_base64, validate=True)
    except Exception as exc:
        raise ValueError("Invalid upload payload") from exc
    if len(payload) > MAX_CLOUD_UPLOAD_SIZE:
        raise ValueError(f"Cloud upload limit is {MAX_CLOUD_UPLOAD_SIZE // 1024 // 1024} MB per file")
    destination = safe_path(Path(relative_dir or "") / name)
    fd, temp_name = tempfile.mkstemp(prefix=f".{name}.", dir=directory)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, destination)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise
    log(f"[AUDIT] Cloud API uploaded {destination.relative_to(WORKDIR)}")
    return {"ok": True, "path": str(destination.relative_to(WORKDIR)), "size": len(payload)}


def _upload_session_paths(upload_id: str) -> tuple[Path, Path]:
    if not re.fullmatch(r"[0-9a-f]{32}", str(upload_id or "")):
        raise ValueError("Invalid upload session ID")
    UPLOAD_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_SESSIONS_DIR / f"{upload_id}.json", UPLOAD_SESSIONS_DIR / f"{upload_id}.part"


def _cleanup_upload_sessions() -> None:
    if not UPLOAD_SESSIONS_DIR.exists():
        return
    cutoff = time.time() - UPLOAD_SESSION_TTL_SECONDS
    for metadata in UPLOAD_SESSIONS_DIR.glob("*.json"):
        try:
            if metadata.stat().st_mtime < cutoff:
                part = metadata.with_suffix(".part")
                metadata.unlink(missing_ok=True)
                part.unlink(missing_ok=True)
        except OSError:
            continue


def api_file_upload_init(relative_dir: str, filename: str, total_size: str, expected_sha256: str = "") -> dict[str, Any]:
    name = safe_child_name(filename)
    directory = safe_path(relative_dir or "")
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("Upload directory not found")
    size = int(total_size)
    if size <= 0 or size > MAX_CHUNKED_UPLOAD_SIZE:
        raise ValueError(f"Chunked upload limit is {MAX_CHUNKED_UPLOAD_SIZE // 1024 // 1024} MB")
    checksum = str(expected_sha256 or "").lower()
    if checksum and not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("Invalid expected SHA-256")
    with UPLOAD_LOCK:
        _cleanup_upload_sessions()
        upload_id = secrets.token_hex(16)
        metadata_path, part_path = _upload_session_paths(upload_id)
        part_path.touch(exist_ok=False)
        metadata = {
            "id": upload_id,
            "directory": str(Path(relative_dir or "")),
            "filename": name,
            "total_size": size,
            "expected_sha256": checksum,
            "next_index": 0,
            "received": 0,
            "created_at": time.time(),
        }
        atomic_write(metadata_path, json.dumps(metadata, separators=(",", ":")))
    log(f"[UPLOAD] Initialized {upload_id} for {name} ({size} bytes)")
    return {"ok": True, "upload_id": upload_id, "chunk_size": UPLOAD_CHUNK_SIZE, "next_index": 0, "received": 0}


def _load_upload_session(upload_id: str) -> tuple[dict[str, Any], Path, Path]:
    metadata_path, part_path = _upload_session_paths(upload_id)
    if not metadata_path.is_file() or not part_path.is_file():
        raise FileNotFoundError("Upload session not found or expired")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if not isinstance(metadata, dict):
        raise ValueError("Invalid upload session metadata")
    return metadata, metadata_path, part_path


def api_file_upload_chunk(upload_id: str, chunk_index: str, data_base64: str, chunk_sha256: str) -> dict[str, Any]:
    index = int(chunk_index)
    checksum = str(chunk_sha256 or "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("A valid chunk SHA-256 is required")
    try:
        payload = base64.b64decode(data_base64, validate=True)
    except Exception as exc:
        raise ValueError("Invalid chunk payload") from exc
    if not payload or len(payload) > UPLOAD_CHUNK_SIZE:
        raise ValueError("Chunk size is invalid")
    if hashlib.sha256(payload).hexdigest() != checksum:
        raise ValueError("Chunk checksum verification failed")

    with UPLOAD_LOCK:
        metadata, metadata_path, part_path = _load_upload_session(upload_id)
        expected_index = int(metadata.get("next_index", 0))
        if index < expected_index:
            return {
                "ok": True, "upload_id": upload_id, "duplicate": True,
                "next_index": expected_index, "received": int(metadata.get("received", 0)),
            }
        if index != expected_index:
            raise ValueError(f"Expected chunk {expected_index}, received {index}")
        received = int(metadata.get("received", 0))
        total_size = int(metadata.get("total_size", 0))
        if received + len(payload) > total_size:
            raise ValueError("Chunk exceeds declared upload size")
        with part_path.open("ab") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        metadata["received"] = received + len(payload)
        metadata["next_index"] = expected_index + 1
        atomic_write(metadata_path, json.dumps(metadata, separators=(",", ":")))
    return {
        "ok": True, "upload_id": upload_id,
        "next_index": metadata["next_index"], "received": metadata["received"],
    }


def api_file_upload_status(upload_id: str) -> dict[str, Any]:
    with UPLOAD_LOCK:
        metadata, _metadata_path, _part_path = _load_upload_session(upload_id)
        return {
            "ok": True, "upload_id": upload_id,
            "next_index": int(metadata.get("next_index", 0)),
            "received": int(metadata.get("received", 0)),
            "total_size": int(metadata.get("total_size", 0)),
        }


def api_file_upload_complete(upload_id: str) -> dict[str, Any]:
    with UPLOAD_LOCK:
        metadata, metadata_path, part_path = _load_upload_session(upload_id)
        total_size = int(metadata.get("total_size", 0))
        if part_path.stat().st_size != total_size or int(metadata.get("received", 0)) != total_size:
            raise ValueError("Upload is incomplete")
        digest = hashlib.sha256()
        with part_path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        checksum = digest.hexdigest()
        expected = str(metadata.get("expected_sha256") or "")
        if expected and not hmac.compare_digest(checksum, expected):
            raise ValueError("Full file checksum verification failed")
        directory = safe_path(str(metadata.get("directory") or ""))
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError("Upload destination no longer exists")
        name = safe_child_name(str(metadata.get("filename") or ""))
        destination = safe_path(Path(str(metadata.get("directory") or "")) / name)
        os.replace(part_path, destination)
        metadata_path.unlink(missing_ok=True)
    log(f"[AUDIT] Cloud API completed chunked upload {destination.relative_to(WORKDIR)} ({total_size} bytes)")
    return {
        "ok": True, "path": str(destination.relative_to(WORKDIR)),
        "name": destination.name, "size": total_size, "sha256": checksum,
    }


def api_file_upload_abort(upload_id: str) -> dict[str, Any]:
    with UPLOAD_LOCK:
        metadata_path, part_path = _upload_session_paths(upload_id)
        metadata_path.unlink(missing_ok=True)
        part_path.unlink(missing_ok=True)
    return {"ok": True, "upload_id": upload_id, "aborted": True}


def api_file_download(relative_path: str) -> dict[str, Any]:
    path = safe_path(relative_path)
    if not path.is_file() or path.is_symlink():
        raise FileNotFoundError("File not found")
    size = path.stat().st_size
    if size > MAX_CLOUD_UPLOAD_SIZE:
        raise ValueError(f"Cloud download limit is {MAX_CLOUD_UPLOAD_SIZE // 1024 // 1024} MB per file")
    return {"name": path.name, "size": size, "data": base64.b64encode(path.read_bytes()).decode("ascii")}


def api_file_create(relative_path: str, item_type: str = "file") -> dict[str, Any]:
    path = safe_path(relative_path)
    if path.exists():
        raise FileExistsError("Path already exists")
    safe_child_name(path.name)
    if item_type == "folder":
        path.mkdir(parents=False)
    else:
        atomic_write(path, "")
    log(f"[AUDIT] Cloud API created {path.relative_to(WORKDIR)}")
    return {"ok": True, "path": relative_path, "type": item_type}


def api_file_rename(relative_path: str, new_name: str) -> dict[str, Any]:
    source = safe_path(relative_path)
    if not source.exists() or source.is_symlink():
        raise FileNotFoundError("Path not found")
    name = safe_child_name(new_name)
    target = safe_path(source.parent.relative_to(WORKDIR) / name)
    if target.exists():
        raise FileExistsError("Target already exists")
    source.rename(target)
    log(f"[AUDIT] Cloud API renamed {relative_path} to {target.relative_to(WORKDIR)}")
    return {"ok": True, "path": str(target.relative_to(WORKDIR))}


def api_file_delete(relative_path: str) -> dict[str, Any]:
    target = safe_path(relative_path)
    if target == WORKDIR or not target.exists() or target.is_symlink():
        raise ValueError("Invalid delete target")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    log(f"[AUDIT] Cloud API deleted {relative_path}")
    return {"ok": True, "path": relative_path}


# ============================================================
# Verified Modrinth plugin installation
# ============================================================


def api_plugin_install(download_url: str, filename: str, expected_sha512: str) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(str(download_url or ""))
    if parsed.scheme != "https" or parsed.hostname != "cdn.modrinth.com":
        raise ValueError("Only the official Modrinth CDN is allowed")
    name = safe_child_name(filename)
    if not name.lower().endswith(".jar"):
        raise ValueError("Plugin must be a JAR file")
    checksum = str(expected_sha512 or "").lower()
    if not re.fullmatch(r"[0-9a-f]{128}", checksum):
        raise ValueError("A valid SHA-512 checksum is required")

    PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
    destination = safe_path(PLUGINS_DIR.relative_to(WORKDIR) / name)
    fd, temp_name = tempfile.mkstemp(prefix=f".{name}.", dir=PLUGINS_DIR)
    total = 0
    digest = hashlib.sha512()
    try:
        request = urllib.request.Request(
            download_url,
            headers={"User-Agent": "SAW-MC-Hosting-Agent/3.2"},
        )
        with urllib.request.urlopen(request, timeout=45) as response, os.fdopen(fd, "wb") as output:
            declared = int(response.headers.get("Content-Length", "0") or 0)
            if declared > MAX_UPLOAD_SIZE:
                raise ValueError("Plugin exceeds the maximum download size")
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_SIZE:
                    raise ValueError("Plugin exceeds the maximum download size")
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if not hmac.compare_digest(digest.hexdigest(), checksum):
            raise ValueError("Plugin checksum verification failed")
        os.replace(temp_name, destination)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise
    log(f"[AUDIT] Cloud API installed verified Modrinth plugin {name}")
    return {"ok": True, "name": name, "size": total, "sha512": checksum}


# ============================================================
# Private Dataset backups
# ============================================================


def _require_backup_connection() -> None:
    if not DATASET_REPO_ID or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", DATASET_REPO_ID):
        raise RuntimeError("Backup Dataset is not configured")
    if not HF_TOKEN:
        raise RuntimeError("HF_TOKEN Space secret is missing; reconnect Hugging Face")


def _backup_api() -> HfApi:
    _require_backup_connection()
    return HfApi(token=HF_TOKEN)


def _backup_files() -> list[str]:
    return _backup_api().list_repo_files(
        repo_id=DATASET_REPO_ID,
        repo_type="dataset",
        token=HF_TOKEN,
    )


def _load_backup_manifest(path: str) -> dict[str, Any]:
    local = hf_hub_download(
        repo_id=DATASET_REPO_ID,
        filename=path,
        repo_type="dataset",
        token=HF_TOKEN,
    )
    data = json.loads(Path(local).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Invalid backup manifest")
    return data


def api_backup_list() -> list[dict[str, Any]]:
    manifests = sorted(
        (name for name in _backup_files() if re.fullmatch(r"backups/[A-Za-z0-9_.-]+\.json", name)),
        reverse=True,
    )[:100]
    result: list[dict[str, Any]] = []
    for manifest_path in manifests:
        try:
            item = _load_backup_manifest(manifest_path)
            archive = str(item.get("archive", ""))
            if not re.fullmatch(r"backups/[A-Za-z0-9_.-]+\.tar\.gz", archive):
                continue
            result.append({
                "id": str(item.get("id", Path(manifest_path).stem)),
                "label": str(item.get("label", "Backup"))[:80],
                "created_at": str(item.get("created_at", "")),
                "size": int(item.get("size", 0)),
                "sha256": str(item.get("sha256", "")),
                "archive": archive,
                "manifest": manifest_path,
                "version": str(item.get("minecraft_version", MC_VERSION)),
                "health": "verified" if re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))) else "unknown",
            })
        except Exception as exc:
            log(f"[BACKUP] Ignored invalid manifest {manifest_path}: {exc}")
    return result


def _backup_tar_filter(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
    parts = Path(info.name).parts
    excluded_parts = {"jdk", ".cache", "__pycache__", ".git", "logs", ".saw-uploads"}
    excluded_names = {"paper.jar", "playit-agent", ".saw-backup-state.json"}
    if any(part in excluded_parts for part in parts) or Path(info.name).name in excluded_names:
        return None
    if info.issym() or info.islnk() or info.isdev():
        return None
    return info


def _write_console_direct(command: str) -> None:
    with PROCESS_LOCK:
        if mc_process and mc_process.poll() is None and mc_process.stdin:
            mc_process.stdin.write(command + "\n")
            mc_process.stdin.flush()


def _prune_backups(api: HfApi) -> None:
    backups = api_backup_list()
    old = backups[BACKUP_RETENTION:]
    if not old:
        return
    operations: list[CommitOperationDelete] = []
    for item in old:
        operations.append(CommitOperationDelete(path_in_repo=item["archive"]))
        operations.append(CommitOperationDelete(path_in_repo=item["manifest"]))
    api.create_commit(
        repo_id=DATASET_REPO_ID,
        repo_type="dataset",
        operations=operations,
        commit_message=f"Prune {len(old)} old SAW backup(s)",
        token=HF_TOKEN,
    )


def _backup_fingerprint() -> str:
    """Fast metadata fingerprint used to avoid duplicate Dataset commits."""
    excluded_parts = {"jdk", "libraries", "versions", "logs", ".cache", ".saw-uploads", "__pycache__"}
    excluded_names = {"paper.jar", "playit-agent", ".saw-backup-state.json"}
    digest = hashlib.sha256()
    for path in sorted(WORKDIR.rglob("*"), key=lambda item: str(item.relative_to(WORKDIR))):
        try:
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(WORKDIR)
            if any(part in excluded_parts for part in relative.parts) or path.name in excluded_names:
                continue
            stat = path.stat()
            digest.update(str(relative).encode("utf-8", errors="surrogateescape"))
            digest.update(b"\0")
            digest.update(str(stat.st_size).encode())
            digest.update(b":")
            digest.update(str(stat.st_mtime_ns).encode())
            digest.update(b"\n")
        except OSError:
            continue
    return digest.hexdigest()


def _read_backup_state() -> dict[str, Any]:
    try:
        data = json.loads(BACKUP_STATE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_backup_state(fingerprint: str, archive: str, created_at: str) -> None:
    atomic_write(BACKUP_STATE_FILE, json.dumps({
        "fingerprint": fingerprint,
        "archive": archive,
        "created_at": created_at,
    }, separators=(",", ":")))


def _backup_create_sync(label: str = "Manual backup", skip_unchanged: bool = False) -> dict[str, Any]:
    if not BACKUP_LOCK.acquire(blocking=False):
        raise RuntimeError("Another backup operation is already running")
    temp_path: Path | None = None
    was_running = False
    try:
        api = _backup_api()
        clean_label = re.sub(r"[\r\n\x00]+", " ", str(label or "Manual backup")).strip()[:80]
        clean_label = clean_label or "Manual backup"
        fingerprint = _backup_fingerprint()
        previous_state = _read_backup_state()
        if skip_unchanged and fingerprint == previous_state.get("fingerprint"):
            log(f"[BACKUP] Skipped unchanged snapshot: {clean_label}")
            return {
                "ok": True, "skipped": True, "reason": "unchanged",
                "fingerprint": fingerprint, "archive": previous_state.get("archive"),
            }
        created = datetime.now(timezone.utc)
        backup_id = created.strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(3)
        archive_name = f"backups/{backup_id}.tar.gz"
        manifest_name = f"backups/{backup_id}.json"

        with PROCESS_LOCK:
            was_running = bool(mc_process and mc_process.poll() is None)
        if was_running:
            _write_console_direct("save-off")
            _write_console_direct("save-all flush")
            time.sleep(2)
            fingerprint = _backup_fingerprint()

        fd, filename = tempfile.mkstemp(prefix="saw-backup-", suffix=".tar.gz")
        os.close(fd)
        temp_path = Path(filename)
        with tarfile.open(temp_path, "w:gz", compresslevel=6) as archive:
            archive.add(WORKDIR, arcname="server", recursive=True, filter=_backup_tar_filter)

        size = temp_path.stat().st_size
        if size <= 0 or size > BACKUP_MAX_BYTES:
            raise ValueError(f"Backup size must be between 1 byte and {BACKUP_MAX_BYTES} bytes")
        digest = hashlib.sha256()
        with temp_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        sha256 = digest.hexdigest()
        manifest = {
            "schema": 1,
            "id": backup_id,
            "label": clean_label,
            "created_at": created.isoformat(),
            "size": size,
            "sha256": sha256,
            "fingerprint": fingerprint,
            "archive": archive_name,
            "minecraft_version": MC_VERSION,
            "server_id": os.getenv("SERVER_ID", ""),
        }

        api.upload_file(
            path_or_fileobj=str(temp_path),
            path_in_repo=archive_name,
            repo_id=DATASET_REPO_ID,
            repo_type="dataset",
            commit_message=f"Create SAW backup {backup_id}",
            token=HF_TOKEN,
        )
        api.upload_file(
            path_or_fileobj=io.BytesIO(json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")),
            path_in_repo=manifest_name,
            repo_id=DATASET_REPO_ID,
            repo_type="dataset",
            commit_message=f"Add manifest for SAW backup {backup_id}",
            token=HF_TOKEN,
        )
        _prune_backups(api)
        _write_backup_state(fingerprint, archive_name, created.isoformat())
        log(f"[AUDIT] Cloud API created Dataset backup {backup_id} ({size} bytes)")
        return {**manifest, "manifest": manifest_name, "health": "verified"}
    finally:
        if was_running:
            try:
                _write_console_direct("save-on")
            except Exception:
                pass
        if temp_path:
            temp_path.unlink(missing_ok=True)
        BACKUP_LOCK.release()


def _validate_backup_archive(path: str) -> str:
    value = str(path or "")
    if not re.fullmatch(r"backups/[A-Za-z0-9_.-]+\.tar\.gz", value):
        raise ValueError("Invalid backup archive path")
    return value


def api_backup_delete(archive_path: str) -> dict[str, Any]:
    archive_path = _validate_backup_archive(archive_path)
    if not BACKUP_LOCK.acquire(blocking=False):
        raise RuntimeError("Another backup operation is already running")
    try:
        api = _backup_api()
        manifest_path = archive_path.removesuffix(".tar.gz") + ".json"
        existing = set(_backup_files())
        operations = [
            CommitOperationDelete(path_in_repo=path)
            for path in (archive_path, manifest_path) if path in existing
        ]
        if not operations:
            raise FileNotFoundError("Backup not found")
        api.create_commit(
            repo_id=DATASET_REPO_ID,
            repo_type="dataset",
            operations=operations,
            commit_message=f"Delete SAW backup {Path(archive_path).name}",
            token=HF_TOKEN,
        )
        log(f"[AUDIT] Cloud API deleted Dataset backup {archive_path}")
        return {"ok": True, "archive": archive_path}
    finally:
        BACKUP_LOCK.release()


def _backup_restore_sync(archive_path: str) -> dict[str, Any]:
    archive_path = _validate_backup_archive(archive_path)
    with PROCESS_LOCK:
        if mc_process and mc_process.poll() is None:
            raise RuntimeError("Stop the Minecraft server before restoring a backup")
    if not BACKUP_LOCK.acquire(blocking=False):
        raise RuntimeError("Another backup operation is already running")
    extract_root: Path | None = None
    try:
        _require_backup_connection()
        manifest_path = archive_path.removesuffix(".tar.gz") + ".json"
        manifest = _load_backup_manifest(manifest_path)
        local_archive = Path(hf_hub_download(
            repo_id=DATASET_REPO_ID,
            filename=archive_path,
            repo_type="dataset",
            token=HF_TOKEN,
        ))
        digest = hashlib.sha256()
        with local_archive.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        if not hmac.compare_digest(digest.hexdigest(), str(manifest.get("sha256", ""))):
            raise ValueError("Backup checksum verification failed")

        extract_root = Path(tempfile.mkdtemp(prefix="saw-restore-"))
        total_size = 0
        with tarfile.open(local_archive, "r:gz") as archive:
            for member in archive.getmembers():
                parts = Path(member.name).parts
                if not parts or parts[0] != "server" or ".." in parts or member.issym() or member.islnk() or member.isdev():
                    raise ValueError("Unsafe entry detected in backup archive")
                total_size += max(0, member.size)
                if total_size > BACKUP_MAX_BYTES * 3:
                    raise ValueError("Expanded backup is too large")
            archive.extractall(extract_root, filter="data")

        restored_root = extract_root / "server"
        if not restored_root.is_dir():
            raise ValueError("Backup does not contain a server directory")
        restored = 0
        for source in restored_root.iterdir():
            if source.is_symlink() or source.name in {"jdk", ".cache", "paper.jar", "playit-agent"}:
                continue
            destination = safe_path(source.name)
            if destination.exists():
                if destination.is_dir():
                    shutil.rmtree(destination)
                else:
                    destination.unlink()
            if source.is_dir():
                shutil.copytree(source, destination)
            elif source.is_file():
                shutil.copy2(source, destination)
            restored += 1
        _write_backup_state(_backup_fingerprint(), archive_path, datetime.now(timezone.utc).isoformat())
        log(f"[AUDIT] Cloud API restored Dataset backup {archive_path}")
        return {"ok": True, "archive": archive_path, "restored_entries": restored, "sha256": digest.hexdigest()}
    finally:
        if extract_root:
            shutil.rmtree(extract_root, ignore_errors=True)
        BACKUP_LOCK.release()


def _run_backup_job(job_id: str, operation: str, value: str) -> None:
    with BACKUP_JOBS_LOCK:
        BACKUP_JOBS[job_id].update({"state": "running", "started_at": datetime.now(timezone.utc).isoformat()})
    try:
        if operation == "create":
            result = _backup_create_sync(value)
        elif operation == "restore":
            result = _backup_restore_sync(value)
        else:
            raise ValueError("Unknown backup operation")
        with BACKUP_JOBS_LOCK:
            BACKUP_JOBS[job_id].update({
                "state": "completed", "result": result,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as exc:
        log(f"[BACKUP] Job {job_id} failed: {exc}")
        with BACKUP_JOBS_LOCK:
            BACKUP_JOBS[job_id].update({
                "state": "failed", "error": str(exc)[:500],
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })


def _queue_backup_job(operation: str, value: str) -> dict[str, Any]:
    job_id = "job_" + secrets.token_hex(12)
    now = datetime.now(timezone.utc).isoformat()
    with BACKUP_JOBS_LOCK:
        if len(BACKUP_JOBS) >= 50:
            finished = [key for key, job in BACKUP_JOBS.items() if job.get("state") in {"completed", "failed"}]
            for key in finished[:max(1, len(BACKUP_JOBS) - 49)]:
                BACKUP_JOBS.pop(key, None)
        BACKUP_JOBS[job_id] = {"id": job_id, "operation": operation, "state": "queued", "created_at": now}
    threading.Thread(target=_run_backup_job, args=(job_id, operation, value), daemon=True).start()
    return {"ok": True, "queued": True, "job_id": job_id, "state": "queued"}


def api_backup_create(label: str = "Manual backup") -> dict[str, Any]:
    clean_label = re.sub(r"[\r\n\x00]+", " ", str(label or "Manual backup")).strip()[:80]
    return _queue_backup_job("create", clean_label or "Manual backup")


def api_backup_restore(archive_path: str) -> dict[str, Any]:
    return _queue_backup_job("restore", _validate_backup_archive(archive_path))


def api_backup_status(job_id: str) -> dict[str, Any]:
    value = str(job_id or "")
    if not re.fullmatch(r"job_[0-9a-f]{24}", value):
        raise ValueError("Invalid backup job ID")
    with BACKUP_JOBS_LOCK:
        job = BACKUP_JOBS.get(value)
        if not job:
            raise FileNotFoundError("Backup job not found or Space restarted")
        return dict(job)


def _has_local_world_data() -> bool:
    try:
        if any(WORKDIR.glob("*/level.dat")):
            return True
        if PROPERTIES_FILE.exists():
            for line in PROPERTIES_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.startswith("level-name="):
                    level = safe_path(line.split("=", 1)[1].strip() or "world")
                    return (level / "level.dat").is_file()
    except Exception:
        return False
    return False


def auto_restore_latest_if_needed() -> dict[str, Any]:
    if not AUTO_RESTORE or _has_local_world_data():
        return {"ok": True, "restored": False, "reason": "local-data-present-or-disabled"}
    if not DATASET_REPO_ID or not HF_TOKEN:
        log("[PERSISTENCE] Auto-restore skipped: Dataset/HF token is not configured")
        return {"ok": True, "restored": False, "reason": "backup-not-configured"}
    backups = api_backup_list()
    if not backups:
        log("[PERSISTENCE] No verified Dataset backup found; starting a fresh server")
        return {"ok": True, "restored": False, "reason": "no-backup"}
    latest = next((item for item in backups if item.get("health") == "verified"), None)
    if not latest:
        raise RuntimeError("Dataset contains backups but none has a verified SHA-256 manifest")
    log(f"[PERSISTENCE] Empty local disk detected; restoring {latest['archive']}")
    result = _backup_restore_sync(str(latest["archive"]))
    log(f"[PERSISTENCE] Auto-restore completed ({result.get('restored_entries', 0)} entries)")
    return {"ok": True, "restored": True, "archive": latest["archive"]}


def bootstrap_start_worker() -> None:
    global server_phase
    try:
        auto_restore_latest_if_needed()
    except Exception as exc:
        with PROCESS_LOCK:
            server_phase = "crashed"
        log(f"[PERSISTENCE] Auto-restore failed; Minecraft start blocked to protect data: {exc}")
        return
    start_worker()


def periodic_backup_worker() -> None:
    if not AUTO_BACKUP or not DATASET_REPO_ID or not HF_TOKEN:
        return
    interval = BACKUP_INTERVAL_MINUTES * 60
    log(f"[PERSISTENCE] Dirty-aware auto-backup enabled every {BACKUP_INTERVAL_MINUTES} minutes")
    while True:
        time.sleep(interval)
        try:
            result = _backup_create_sync("Automatic periodic backup", skip_unchanged=True)
            if result.get("skipped"):
                log("[PERSISTENCE] Periodic backup skipped because no files changed")
            else:
                log(f"[PERSISTENCE] Periodic backup verified: {result.get('archive')}")
        except Exception as exc:
            log(f"[PERSISTENCE] Periodic backup failed: {exc}")


def load_properties(request: gr.Request | None = None):
    allowed, message = require_perm(request, "files_read")
    if not allowed:
        return "", message
    try:
        content = PROPERTIES_FILE.read_text(encoding="utf-8") if PROPERTIES_FILE.exists() else ""
        return content, "✅ تم تحميل server.properties"
    except Exception as exc:
        return "", f"❌ {exc}"


def save_properties(content: str, request: gr.Request | None = None):
    allowed, actor = require_perm(request, "settings_manage")
    if not allowed:
        return actor
    try:
        if PROPERTIES_FILE.exists():
            shutil.copy2(PROPERTIES_FILE, PROPERTIES_FILE.with_suffix(".properties.bak"))
        atomic_write(PROPERTIES_FILE, content)
        log(f"[AUDIT] {actor} updated server.properties")
        return "✅ تم الحفظ. أعد تشغيل السيرفر لتطبيق التغييرات."
    except Exception as exc:
        return f"❌ {exc}"


def users_markdown(request: gr.Request | None = None) -> str:
    allowed, message = require_perm(request, "users_manage")
    if not allowed:
        return message
    users = load_users()
    lines = ["| User | Role |", "|---|---|"]
    for username, record in sorted(users.items()):
        role = record.get("role", "unknown") if isinstance(record, dict) else "legacy"
        lines.append(f"| `{username}` | `{role}` |")
    return "\n".join(lines)


def add_user(username: str, password: str, role: str, request: gr.Request | None = None):
    allowed, actor = require_perm(request, "users_manage")
    if not allowed:
        return actor, users_markdown(request)
    username = (username or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", username):
        return "❌ اسم المستخدم يجب أن يكون 3–32 حرفًا آمنًا", users_markdown(request)
    if len(password or "") < 10:
        return "❌ كلمة المرور يجب ألا تقل عن 10 أحرف", users_markdown(request)
    if role not in PERMISSIONS:
        return "❌ دور غير صالح", users_markdown(request)
    users = load_users()
    users[username] = {"role": role, **_password_hash(password)}
    save_users(users)
    log(f"[AUDIT] {actor} added/updated panel user {username} as {role}")
    return f"✅ تم حفظ المستخدم `{username}`", users_markdown(request)


def remove_user(username: str, request: gr.Request | None = None):
    allowed, actor = require_perm(request, "users_manage")
    if not allowed:
        return actor, users_markdown(request)
    username = (username or "").strip()
    if username == request_user(request):
        return "❌ لا يمكنك حذف حسابك الحالي", users_markdown(request)
    users = load_users()
    if username not in users:
        return "⚠️ المستخدم غير موجود", users_markdown(request)
    del users[username]
    save_users(users)
    log(f"[AUDIT] {actor} removed panel user {username}")
    return f"✅ تم حذف `{username}`", users_markdown(request)


# ============================================================
# UI
# ============================================================

bootstrap_admin()
log(f"[SYSTEM] Panel initialized; server directory: {WORKDIR}")

CSS = """
.gradio-container {max-width: 1450px !important; margin: auto !important;}
#console textarea, #file-editor textarea, #properties-editor textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
}
#console textarea {background: #080b10 !important; color: #8df58d !important;}
"""

with gr.Blocks(title="Minecraft Server Control Panel", css=CSS) as demo:
    current_rel = gr.State("")

    gr.Markdown(
        "# ⛏️ Minecraft Server Control Panel\n"
        "لوحة آمنة لإدارة Purpur والملفات والمستخدمين."
    )

    with gr.Tabs():
        with gr.Tab("🖥️ Dashboard"):
            status = gr.Markdown(status_text())
            resources = gr.Textbox(label="System resources", interactive=False, lines=3)
            with gr.Row():
                start_btn = gr.Button("▶ Start", variant="primary")
                stop_btn = gr.Button("⏹ Stop", variant="stop")
                restart_btn = gr.Button("🔄 Restart")
                refresh_btn = gr.Button("↻ Refresh")
            operation = gr.Markdown()
            console = gr.Textbox(
                label="Live Console", elem_id="console", lines=24,
                max_lines=24, interactive=False, autoscroll=True,
            )
            with gr.Row():
                command = gr.Textbox(label="Console command", placeholder="list", scale=5)
                send_btn = gr.Button("Send", variant="primary", scale=1)

        with gr.Tab("📂 Files"):
            path_display = gr.Textbox(label="Current path", value="/root", interactive=False)
            with gr.Row():
                folders = gr.Dropdown(label="Folders", choices=[])
                enter_btn = gr.Button("Open folder")
                up_btn = gr.Button("⬆ Up")
                file_refresh_btn = gr.Button("↻ Refresh")
            files = gr.Dropdown(label="Files", choices=[])
            with gr.Row():
                load_btn = gr.Button("Open file", variant="primary")
                download_btn = gr.Button("Download")
                download_output = gr.File(label="Download", interactive=False)
            editor_info = gr.Markdown("اختر ملفًا لفتحه")
            editor = gr.Textbox(
                label="Editor", elem_id="file-editor", lines=24,
                max_lines=40, interactive=True,
            )
            save_btn = gr.Button("💾 Save with backup", variant="primary")
            file_operation = gr.Markdown()

            gr.Markdown("### Upload")
            upload_input = gr.File(label="Choose files", file_count="multiple", type="filepath")
            upload_btn = gr.Button("Upload to current folder", variant="primary")

            with gr.Row():
                with gr.Column():
                    gr.Markdown("### Create")
                    create_name = gr.Textbox(label="Name")
                    create_type = gr.Radio(["File", "Folder"], value="File", label="Type")
                    create_btn = gr.Button("Create")
                with gr.Column():
                    gr.Markdown("### Rename")
                    rename_old = gr.Textbox(label="Current name")
                    rename_new = gr.Textbox(label="New name")
                    rename_btn = gr.Button("Rename")
                with gr.Column():
                    gr.Markdown("### Delete")
                    delete_name = gr.Textbox(label="Name")
                    delete_confirm = gr.Checkbox(label="I confirm permanent deletion")
                    delete_btn = gr.Button("Delete", variant="stop")

        with gr.Tab("⚙️ server.properties"):
            properties_editor = gr.Textbox(
                label="server.properties", elem_id="properties-editor",
                lines=30, max_lines=40,
            )
            with gr.Row():
                load_properties_btn = gr.Button("Load from disk")
                save_properties_btn = gr.Button("Save", variant="primary")
            properties_result = gr.Markdown()

        with gr.Tab("👥 Panel Users"):
            gr.Markdown(
                "المستخدم Admin فقط يمكنه إدارة حسابات اللوحة. "
                "كلمات المرور محفوظة باستخدام PBKDF2 وليست كنص صريح."
            )
            users_list = gr.Markdown()
            users_refresh_btn = gr.Button("Refresh users")
            with gr.Row():
                user_name = gr.Textbox(label="Username")
                user_password = gr.Textbox(label="Password", type="password")
                user_role = gr.Dropdown(
                    ["admin", "operator", "editor", "viewer"],
                    value="viewer", label="Role",
                )
            with gr.Row():
                add_user_btn = gr.Button("Add / Update", variant="primary")
                remove_user_btn = gr.Button("Remove", variant="stop")
            user_result = gr.Markdown()

        with gr.Tab("ℹ️ Help"):
            gr.Markdown(
                """
### Required Hugging Face setting
- `ACCEPT_EULA=true`: only after reading and accepting the Minecraft EULA.

> Login is disabled. Every visitor to this public Space has administrator permissions.

### Optional variables
- `PANEL_USERNAME=admin`
- `MC_VERSION=1.21.1`
- `MC_XMS=512M`
- `MC_XMX=2G`
- `AUTO_START=false`
- `INSTALL_PLAYIT=true`

> Hugging Face storage may be temporary unless Persistent Storage is enabled.
The Playit plugin is used because a Space does not expose the Minecraft port directly.
                """
            )
            gr.Markdown(
                "ZeroGPU requires a registered GPU endpoint. Minecraft itself still runs on CPU."
            )
            gpu_probe_btn = gr.Button("ZeroGPU compatibility check")
            gpu_probe_result = gr.Textbox(label="ZeroGPU result", interactive=False)

    # Register the decorated endpoint in Gradio's dependency graph. Merely defining
    # a decorated Python function is not enough for ZeroGPU startup detection.
    gpu_probe_btn.click(
        fn=zero_gpu_probe,
        inputs=None,
        outputs=gpu_probe_result,
        api_name="zero_gpu_probe",
    )

    # Hidden components register stable, named endpoints for the external website.
    api_status_trigger = gr.Button(visible=False)
    api_logs_trigger = gr.Button(visible=False)
    api_resources_trigger = gr.Button(visible=False)
    api_players_trigger = gr.Button(visible=False)
    api_files_trigger = gr.Button(visible=False)
    api_file_read_trigger = gr.Button(visible=False)
    api_file_write_trigger = gr.Button(visible=False)
    api_file_write_safe_trigger = gr.Button(visible=False)
    api_file_write_safe_status_trigger = gr.Button(visible=False)
    api_file_upload_trigger = gr.Button(visible=False)
    api_file_upload_init_trigger = gr.Button(visible=False)
    api_file_upload_chunk_trigger = gr.Button(visible=False)
    api_file_upload_status_trigger = gr.Button(visible=False)
    api_file_upload_complete_trigger = gr.Button(visible=False)
    api_file_upload_abort_trigger = gr.Button(visible=False)
    api_file_download_trigger = gr.Button(visible=False)
    api_file_create_trigger = gr.Button(visible=False)
    api_file_rename_trigger = gr.Button(visible=False)
    api_file_delete_trigger = gr.Button(visible=False)
    api_backup_list_trigger = gr.Button(visible=False)
    api_backup_create_trigger = gr.Button(visible=False)
    api_backup_delete_trigger = gr.Button(visible=False)
    api_backup_restore_trigger = gr.Button(visible=False)
    api_backup_status_trigger = gr.Button(visible=False)
    api_plugin_install_trigger = gr.Button(visible=False)
    api_file_path_input = gr.Textbox(visible=False)
    api_file_content_input = gr.Textbox(visible=False)
    api_file_name_input = gr.Textbox(visible=False)
    api_file_data_input = gr.Textbox(visible=False)
    api_file_type_input = gr.Textbox(visible=False)
    api_upload_id_input = gr.Textbox(visible=False)
    api_upload_index_input = gr.Textbox(visible=False)
    api_upload_size_input = gr.Textbox(visible=False)
    api_upload_hash_input = gr.Textbox(visible=False)
    api_safe_apply_job_input = gr.Textbox(visible=False)
    api_backup_label_input = gr.Textbox(visible=False)
    api_backup_path_input = gr.Textbox(visible=False)
    api_backup_job_input = gr.Textbox(visible=False)
    api_plugin_url_input = gr.Textbox(visible=False)
    api_plugin_filename_input = gr.Textbox(visible=False)
    api_plugin_hash_input = gr.Textbox(visible=False)
    api_status_output = gr.JSON(visible=False)
    api_logs_output = gr.Textbox(visible=False)
    api_resources_output = gr.JSON(visible=False)
    api_players_output = gr.JSON(visible=False)
    api_files_output = gr.JSON(visible=False)
    api_file_output = gr.JSON(visible=False)
    api_backup_output = gr.JSON(visible=False)

    api_status_trigger.click(
        api_server_status, outputs=api_status_output, api_name="server_status"
    )
    api_logs_trigger.click(
        logs_text, outputs=api_logs_output, api_name="server_logs"
    )
    api_resources_trigger.click(
        api_server_resources, outputs=api_resources_output, api_name="server_resources"
    )
    api_players_trigger.click(
        api_server_players, outputs=api_players_output, api_name="server_players"
    )
    api_files_trigger.click(
        api_files_list, inputs=api_file_path_input,
        outputs=api_files_output, api_name="files_list"
    )
    api_file_read_trigger.click(
        api_file_read, inputs=api_file_path_input,
        outputs=api_file_output, api_name="file_read"
    )
    api_file_write_trigger.click(
        api_file_write, inputs=[api_file_path_input, api_file_content_input],
        outputs=api_file_output, api_name="file_write"
    )
    api_file_write_safe_trigger.click(
        api_file_write_safe, inputs=[api_file_path_input, api_file_content_input],
        outputs=api_file_output, api_name="file_write_safe"
    )
    api_file_write_safe_status_trigger.click(
        api_file_write_safe_status, inputs=api_safe_apply_job_input,
        outputs=api_file_output, api_name="file_write_safe_status"
    )
    api_file_upload_trigger.click(
        api_file_upload, inputs=[api_file_path_input, api_file_name_input, api_file_data_input],
        outputs=api_file_output, api_name="file_upload"
    )
    api_file_upload_init_trigger.click(
        api_file_upload_init,
        inputs=[api_file_path_input, api_file_name_input, api_upload_size_input, api_upload_hash_input],
        outputs=api_file_output, api_name="file_upload_init"
    )
    api_file_upload_chunk_trigger.click(
        api_file_upload_chunk,
        inputs=[api_upload_id_input, api_upload_index_input, api_file_data_input, api_upload_hash_input],
        outputs=api_file_output, api_name="file_upload_chunk"
    )
    api_file_upload_status_trigger.click(
        api_file_upload_status, inputs=api_upload_id_input,
        outputs=api_file_output, api_name="file_upload_status"
    )
    api_file_upload_complete_trigger.click(
        api_file_upload_complete, inputs=api_upload_id_input,
        outputs=api_file_output, api_name="file_upload_complete"
    )
    api_file_upload_abort_trigger.click(
        api_file_upload_abort, inputs=api_upload_id_input,
        outputs=api_file_output, api_name="file_upload_abort"
    )
    api_file_download_trigger.click(
        api_file_download, inputs=api_file_path_input,
        outputs=api_file_output, api_name="file_download"
    )
    api_file_create_trigger.click(
        api_file_create, inputs=[api_file_path_input, api_file_type_input],
        outputs=api_file_output, api_name="file_create"
    )
    api_file_rename_trigger.click(
        api_file_rename, inputs=[api_file_path_input, api_file_name_input],
        outputs=api_file_output, api_name="file_rename"
    )
    api_file_delete_trigger.click(
        api_file_delete, inputs=api_file_path_input,
        outputs=api_file_output, api_name="file_delete"
    )
    api_backup_list_trigger.click(
        api_backup_list, outputs=api_backup_output, api_name="backup_list"
    )
    api_backup_create_trigger.click(
        api_backup_create, inputs=api_backup_label_input,
        outputs=api_backup_output, api_name="backup_create"
    )
    api_backup_delete_trigger.click(
        api_backup_delete, inputs=api_backup_path_input,
        outputs=api_backup_output, api_name="backup_delete"
    )
    api_backup_restore_trigger.click(
        api_backup_restore, inputs=api_backup_path_input,
        outputs=api_backup_output, api_name="backup_restore"
    )
    api_backup_status_trigger.click(
        api_backup_status, inputs=api_backup_job_input,
        outputs=api_backup_output, api_name="backup_status"
    )
    api_plugin_install_trigger.click(
        api_plugin_install,
        inputs=[api_plugin_url_input, api_plugin_filename_input, api_plugin_hash_input],
        outputs=api_file_output,
        api_name="plugin_install"
    )

    # Dashboard events + stable command API endpoints.
    start_btn.click(start_server, outputs=operation, api_name="start_server")
    stop_btn.click(stop_server, outputs=operation, api_name="stop_server")
    restart_btn.click(restart_server, outputs=operation, api_name="restart_server")
    send_btn.click(
        send_command, inputs=command, outputs=operation, api_name="send_command"
    ).then(lambda: "", outputs=command, api_name=False)
    command.submit(
        send_command, inputs=command, outputs=operation, api_name=False
    ).then(lambda: "", outputs=command, api_name=False)
    refresh_btn.click(
        refresh_dashboard, outputs=[status, console, resources], api_name=False
    )

    # File events
    file_refresh_btn.click(
        scan_directory, inputs=current_rel,
        outputs=[path_display, folders, files],
    )
    enter_btn.click(
        enter_folder, inputs=[folders, current_rel],
        outputs=[current_rel, path_display, folders, files],
    )
    folders.change(
        lambda value: value or "", inputs=folders, outputs=rename_old
    )
    up_btn.click(
        go_up, inputs=current_rel,
        outputs=[current_rel, path_display, folders, files],
    )
    load_btn.click(
        load_file, inputs=[files, current_rel], outputs=[editor, editor_info]
    )
    files.change(lambda value: value or "", inputs=files, outputs=[rename_old]).then(
        lambda value: value or "", inputs=files, outputs=[delete_name]
    )
    save_btn.click(
        save_file, inputs=[files, editor, current_rel], outputs=file_operation
    )
    download_btn.click(
        download_file, inputs=[files, current_rel], outputs=download_output
    )
    upload_btn.click(
        upload_files, inputs=[upload_input, current_rel],
        outputs=[file_operation, path_display, folders, files],
    ).then(lambda: None, outputs=upload_input)
    create_btn.click(
        create_item, inputs=[create_name, create_type, current_rel],
        outputs=[file_operation, path_display, folders, files],
    )
    rename_btn.click(
        rename_item, inputs=[rename_old, rename_new, current_rel],
        outputs=[file_operation, path_display, folders, files],
    )
    delete_btn.click(
        delete_item, inputs=[delete_name, current_rel, delete_confirm],
        outputs=[file_operation, path_display, folders, files],
    ).then(lambda: False, outputs=delete_confirm)

    # Settings events
    load_properties_btn.click(
        load_properties, outputs=[properties_editor, properties_result]
    )
    save_properties_btn.click(
        save_properties, inputs=properties_editor, outputs=properties_result
    )

    # User events
    users_refresh_btn.click(users_markdown, outputs=users_list)
    add_user_btn.click(
        add_user, inputs=[user_name, user_password, user_role],
        outputs=[user_result, users_list],
    )
    remove_user_btn.click(
        remove_user, inputs=user_name, outputs=[user_result, users_list]
    )

    # Initial and periodic refreshes. Files/users are not polled to avoid UI resets.
    demo.load(refresh_dashboard, outputs=[status, console, resources])
    demo.load(
        scan_directory, inputs=current_rel,
        outputs=[path_display, folders, files],
    )
    demo.load(users_markdown, outputs=users_list)
    timer = gr.Timer(3.0)
    timer.tick(refresh_dashboard, outputs=[status, console, resources], show_progress="hidden")


def shutdown_child() -> None:
    global playit_process
    try:
        _stop_process(timeout=10)
    except Exception:
        pass
    try:
        if playit_process and playit_process.poll() is None:
            playit_process.terminate()
            playit_process.wait(timeout=5)
    except Exception:
        try:
            if playit_process:
                playit_process.kill()
        except Exception:
            pass


atexit.register(shutdown_child)

if INSTALL_PLAYIT:
    threading.Thread(target=playit_handoff_watcher, daemon=True).start()

if AUTO_BACKUP and DATASET_REPO_ID and HF_TOKEN:
    threading.Thread(target=periodic_backup_worker, daemon=True).start()

if AUTO_START and ACCEPT_EULA:
    server_phase = "starting"
    threading.Thread(target=bootstrap_start_worker, daemon=True).start()

if __name__ == "__main__":
    print("[AGENT] Starting MC Server Agent v3.2.0 (Verified User-Controlled File Apply)", flush=True)
    print("[SECURITY WARNING] Public access is enabled; every visitor is an admin.", flush=True)
    demo.queue(default_concurrency_limit=4, max_size=32)
    demo.launch(
        show_error=True,
        ssr_mode=False,
    )
