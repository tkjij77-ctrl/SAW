from __future__ import annotations

import asyncio
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from gradio_client import Client
from huggingface_hub import HfApi
from pydantic import BaseModel, Field

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")

HF_CLIENT_ID = os.getenv("HF_CLIENT_ID", "")
HF_CLIENT_SECRET = os.getenv("HF_CLIENT_SECRET", "")
HF_REDIRECT_URI = os.getenv("HF_REDIRECT_URI", "http://localhost:8000/auth/callback")
HF_SCOPES = os.getenv("HF_SCOPES", "openid profile read-repos")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
SESSION_TTL = int(os.getenv("SESSION_TTL_SECONDS", "28800"))

HF_AUTHORIZE_URL = "https://huggingface.co/oauth/authorize"
HF_TOKEN_URL = "https://huggingface.co/oauth/token"
HF_USERINFO_URL = "https://huggingface.co/oauth/userinfo"

AGENT_APIS = {
    "status": "/server_status",
    "logs": "/server_logs",
    "resources": "/server_resources",
    "players": "/server_players",
    "start": "/start_server",
    "stop": "/stop_server",
    "restart": "/restart_server",
    "command": "/send_command",
}
MUTATING_ACTIONS = {"start", "stop", "restart", "command"}


@dataclass
class Session:
    access_token: str
    user: dict[str, Any]
    csrf_token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    created_at: float = field(default_factory=time.time)
    expires_at: float = field(default_factory=lambda: time.time() + SESSION_TTL)
    selected_space: str | None = None


SESSIONS: dict[str, Session] = {}
OAUTH_STATES: dict[str, float] = {}
STORE_LOCK = threading.RLock()

app = FastAPI(title="MC Control Cloud", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class AgentCall(BaseModel):
    action: str = Field(pattern="^[a-z_]+$")
    command: str | None = Field(default=None, max_length=500)


def cleanup_stores() -> None:
    now = time.time()
    with STORE_LOCK:
        for sid in list(SESSIONS):
            if SESSIONS[sid].expires_at <= now:
                del SESSIONS[sid]
        for state in list(OAUTH_STATES):
            if OAUTH_STATES[state] <= now:
                del OAUTH_STATES[state]


def get_session(request: Request) -> tuple[str, Session]:
    cleanup_stores()
    sid = request.cookies.get("mc_session")
    if not sid:
        raise HTTPException(401, "Not authenticated")
    with STORE_LOCK:
        session = SESSIONS.get(sid)
    if not session:
        raise HTTPException(401, "Session expired")
    return sid, session


def require_csrf(session: Session, csrf: str | None) -> None:
    if not csrf or not secrets.compare_digest(csrf, session.csrf_token):
        raise HTTPException(403, "Invalid CSRF token")


def space_owner_allowed(session: Session, owner: str) -> bool:
    username = str(session.user.get("preferred_username") or session.user.get("name") or "")
    if owner.casefold() == username.casefold():
        return True
    # Organization access is ultimately revalidated by the authenticated Hub API call.
    return True


def serialize_runtime(runtime: Any) -> dict[str, Any]:
    def value(name: str, default: Any = None):
        item = getattr(runtime, name, default)
        return getattr(item, "value", item)

    return {
        "stage": value("stage", "UNKNOWN"),
        "hardware": value("hardware"),
        "requested_hardware": value("requested_hardware"),
        "sleep_time": value("sleep_time"),
        "raw": str(runtime),
    }


async def verify_space_access(session: Session, repo_id: str) -> None:
    try:
        api = HfApi(token=session.access_token)
        await asyncio.to_thread(api.repo_info, repo_id=repo_id, repo_type="space")
    except Exception as exc:
        raise HTTPException(403, f"No access to this Space: {exc}") from exc


@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/health")
async def health():
    return {"ok": True, "service": "mc-control-cloud"}


@app.get("/api/public-config")
async def public_config():
    """Expose only non-secret readiness information to the frontend."""
    return {
        "oauth_configured": bool(HF_CLIENT_ID and HF_CLIENT_SECRET and HF_REDIRECT_URI),
        "redirect_uri": HF_REDIRECT_URI if HF_CLIENT_ID and HF_CLIENT_SECRET else None,
    }


@app.get("/auth/login")
async def auth_login():
    if not HF_CLIENT_ID or not HF_CLIENT_SECRET:
        return RedirectResponse("/?oauth_error=not_configured", status_code=302)
    state = secrets.token_urlsafe(32)
    with STORE_LOCK:
        OAUTH_STATES[state] = time.time() + 600
    query = urlencode(
        {
            "client_id": HF_CLIENT_ID,
            "redirect_uri": HF_REDIRECT_URI,
            "response_type": "code",
            "scope": HF_SCOPES,
            "state": state,
        }
    )
    response = RedirectResponse(f"{HF_AUTHORIZE_URL}?{query}", status_code=302)
    response.set_cookie(
        "oauth_state",
        state,
        max_age=600,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
    )
    return response


@app.get("/auth/callback")
async def auth_callback(request: Request, code: str = "", state: str = ""):
    cookie_state = request.cookies.get("oauth_state")
    with STORE_LOCK:
        expires = OAUTH_STATES.pop(state, None)
    if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        raise HTTPException(400, "OAuth state mismatch")
    if not expires or expires < time.time() or not code:
        raise HTTPException(400, "OAuth request expired")

    async with httpx.AsyncClient(timeout=30) as client:
        token_response = await client.post(
            HF_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": HF_REDIRECT_URI,
            },
            auth=(HF_CLIENT_ID, HF_CLIENT_SECRET),
            headers={"Accept": "application/json"},
        )
        if token_response.is_error:
            raise HTTPException(400, f"Token exchange failed: {token_response.text}")
        token_data = token_response.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(400, "Missing access token")

        user_response = await client.get(
            HF_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_response.is_error:
            raise HTTPException(400, "Could not load Hugging Face profile")
        user = user_response.json()

    sid = secrets.token_urlsafe(32)
    session = Session(access_token=access_token, user=user)
    with STORE_LOCK:
        SESSIONS[sid] = session

    response = RedirectResponse("/", status_code=302)
    response.delete_cookie("oauth_state")
    response.set_cookie(
        "mc_session",
        sid,
        max_age=SESSION_TTL,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
    )
    return response


@app.post("/auth/logout")
async def auth_logout(request: Request, x_csrf_token: str | None = Header(default=None)):
    sid, session = get_session(request)
    require_csrf(session, x_csrf_token)
    with STORE_LOCK:
        SESSIONS.pop(sid, None)
    response = JSONResponse({"ok": True})
    response.delete_cookie("mc_session")
    return response


@app.get("/api/me")
async def api_me(request: Request):
    _, session = get_session(request)
    return {
        "authenticated": True,
        "user": session.user,
        "csrf_token": session.csrf_token,
        "selected_space": session.selected_space,
    }


@app.get("/api/spaces")
async def api_spaces(request: Request):
    _, session = get_session(request)
    username = str(
        session.user.get("preferred_username")
        or session.user.get("name")
        or session.user.get("sub")
        or ""
    )
    if not username:
        raise HTTPException(400, "Hugging Face username is missing")

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            "https://huggingface.co/api/spaces",
            params={"author": username, "limit": 100, "full": "true"},
            headers={"Authorization": f"Bearer {session.access_token}"},
        )
    if response.is_error:
        raise HTTPException(response.status_code, "Could not load Spaces")

    items = response.json()
    spaces = []
    for item in items if isinstance(items, list) else []:
        card_data = item.get("cardData") or {}
        tags = item.get("tags") or card_data.get("tags") or []
        spaces.append(
            {
                "id": item.get("id"),
                "title": card_data.get("title") or item.get("id", "").split("/")[-1],
                "sdk": item.get("sdk"),
                "private": bool(item.get("private")),
                "likes": item.get("likes", 0),
                "tags": tags,
                "is_agent": "mc-panel-agent" in tags,
                "url": f"https://huggingface.co/spaces/{item.get('id')}",
            }
        )
    return {"spaces": spaces}


@app.get("/api/spaces/{owner}/{name}/runtime")
async def api_runtime(owner: str, name: str, request: Request):
    _, session = get_session(request)
    repo_id = f"{owner}/{name}"
    if not space_owner_allowed(session, owner):
        raise HTTPException(403, "Space owner mismatch")
    await verify_space_access(session, repo_id)
    try:
        api = HfApi(token=session.access_token)
        runtime = await asyncio.to_thread(api.get_space_runtime, repo_id=repo_id)
        return serialize_runtime(runtime)
    except Exception as exc:
        raise HTTPException(502, f"Could not read Space runtime: {exc}") from exc


@app.post("/api/spaces/{owner}/{name}/select")
async def api_select_space(
    owner: str,
    name: str,
    request: Request,
    x_csrf_token: str | None = Header(default=None),
):
    _, session = get_session(request)
    require_csrf(session, x_csrf_token)
    repo_id = f"{owner}/{name}"
    await verify_space_access(session, repo_id)
    session.selected_space = repo_id
    return {"ok": True, "space": repo_id}


@app.post("/api/spaces/{owner}/{name}/agent")
async def api_agent_call(
    owner: str,
    name: str,
    payload: AgentCall,
    request: Request,
    x_csrf_token: str | None = Header(default=None),
):
    _, session = get_session(request)
    repo_id = f"{owner}/{name}"
    action = payload.action
    if action not in AGENT_APIS:
        raise HTTPException(400, "Unsupported agent action")
    if action in MUTATING_ACTIONS:
        require_csrf(session, x_csrf_token)
    await verify_space_access(session, repo_id)

    def invoke():
        client = Client(repo_id, token=session.access_token, verbose=False)
        api_name = AGENT_APIS[action]
        if action == "command":
            if not payload.command:
                raise ValueError("Command is required")
            return client.predict(payload.command, api_name=api_name)
        return client.predict(api_name=api_name)

    try:
        result = await asyncio.wait_for(asyncio.to_thread(invoke), timeout=45)
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except json.JSONDecodeError:
                pass
        return {"ok": True, "action": action, "result": result}
    except asyncio.TimeoutError as exc:
        raise HTTPException(504, "Agent request timed out") from exc
    except Exception as exc:
        raise HTTPException(
            502,
            "Agent is unavailable or does not implement the required API: " + str(exc),
        ) from exc
