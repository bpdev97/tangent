/**
 * Source for the Tangent-owned Hermes plugin that gives Hermes threads the
 * `t3-code` tools.
 *
 * Hermes loads plugins from the profile's `plugins/` directory, so this is
 * Python kept as a string and written there, the same way Pi's extension is.
 * The plugin uses only the standard library: a source install of Hermes does
 * not include the MCP SDK.
 *
 * @module provider/hermes/HermesT3PluginSource
 */

export const HERMES_T3_PLUGIN_NAME = "t3-code";
export const HERMES_T3_BRIDGE_ENV = "T3CODE_HERMES_BRIDGE_DIR";
/** Hermes rejects a plugin tool whose name a built-in already uses (`delegate_task`). */
export const HERMES_T3_TOOL_PREFIX = "t3code__";
export const HERMES_T3_TOOLS_FILE = "tools.json";
export const HERMES_T3_SESSIONS_DIR = "sessions";
/** Written by the plugin when Hermes loads it, so Tangent can tell it is enabled. */
export const HERMES_T3_LOADED_FILE = "loaded.json";
/** Wraps Tangent's instructions; the plugin looks for it before adding them again. */
export const HERMES_T3_INSTRUCTIONS_TAG = "t3_code_instructions";

export const HERMES_T3_PLUGIN_MANIFEST = `name: ${HERMES_T3_PLUGIN_NAME}
version: "1"
description: Tangent tools for Hermes threads that Tangent started
`;

export const HERMES_T3_PLUGIN_SOURCE = String.raw`"""Tangent's t3-code tools for Hermes threads.

Tangent starts the Hermes gateway with a private directory in
T3CODE_HERMES_BRIDGE_DIR. It holds the tool list (tools.json) and one file per
attached session (sessions/<session key>.json) with that thread's MCP endpoint,
credential and instructions. Each call looks up the calling session, so one
gateway serves every thread and a call always lands on its own thread.

Outside Tangent the variable is unset and this plugin registers nothing.
"""

import base64
import http.client
import json
import os
import re
import socket
import tempfile
import threading
import urllib.parse

BRIDGE_ENV = ${JSON.stringify(HERMES_T3_BRIDGE_ENV)}
PREFIX = ${JSON.stringify(HERMES_T3_TOOL_PREFIX)}
TOOLS_FILE = ${JSON.stringify(HERMES_T3_TOOLS_FILE)}
SESSIONS_DIR = ${JSON.stringify(HERMES_T3_SESSIONS_DIR)}
LOADED_FILE = ${JSON.stringify(HERMES_T3_LOADED_FILE)}
INSTRUCTIONS_TAG = ${JSON.stringify(`<${HERMES_T3_INSTRUCTIONS_TAG}>`)}
PROTOCOL = "2025-06-18"
SESSION_KEY = re.compile(r"^[A-Za-z0-9_.-]+$")
HANDSHAKE_TIMEOUT_SECONDS = 30
CLOSE_TIMEOUT_SECONDS = 5
# Some tools wait on other threads or on the user.
CALL_TIMEOUT_SECONDS = 1800
INTERRUPT_POLL_SECONDS = 0.2
UNATTACHED = "This Hermes session is not attached to a Tangent thread, so Tangent tools are unavailable here."
INTERRUPTED = "The turn was stopped before Tangent answered."

_lock = threading.Lock()
# Other ids a call can arrive under, each pointing at the id whose binding it uses. A
# subagent's session and task id point at the session that started the work, and a session
# id Hermes handed out when it compressed a conversation points where its task id does.
_parents = {}
# Each id a subagent goes by -> the set of all its ids, shared between them, so a finished
# subagent is forgotten whole and nothing else is.
_subagent_ids = {}
# Hermes does not always say which ids a finished subagent had, so the map is bounded too.
MAX_ALIASES = 4096
# Sessions already given Tangent's instructions by this process.
_briefed = set()


class _Refused(Exception):
    """Tangent answered with a status that is not a result."""

    def __init__(self, status):
        super().__init__("HTTP %d" % status)
        self.status = status


class _Stopped(Exception):
    """The Hermes turn was stopped while the call was in flight."""


def _send(call, method, endpoint, authorization, payload=None, mcp_session=None, timeout=HANDSHAKE_TIMEOUT_SECONDS):
    """One request, straight to the endpoint Tangent wrote.

    http.client connects directly: it follows no redirect and uses no proxy, so
    the credential never goes anywhere else. The connection is shared through
    call so a stopped turn can shut its socket down under a blocked read or
    write. Once _stop returns nothing more is sent: a request not yet started
    sees the flag, and one already past it writes to a socket that is shut.
    """
    target = urllib.parse.urlsplit(endpoint)
    connect = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
    connection = connect(target.hostname, target.port, timeout=timeout)
    headers = {
        "Accept": "application/json, text/event-stream",
        "Authorization": authorization,
        "MCP-Protocol-Version": PROTOCOL,
    }
    if mcp_session:
        headers["Mcp-Session-Id"] = mcp_session
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    with call["lock"]:
        if call["stopped"].is_set():
            raise _Stopped()
        call["connection"] = connection
    try:
        # Opening can block and has no socket to shut down yet, so stop is checked again after it.
        connection.connect()
        with call["lock"]:
            if call["stopped"].is_set():
                raise _Stopped()
        connection.request(method, (target.path or "/") + ("?" + target.query if target.query else ""), body=body, headers=headers)
        response = connection.getresponse()
        text = response.read().decode("utf-8")
        if not 200 <= response.status < 300:
            raise _Refused(response.status)
        return response.getheader("Mcp-Session-Id"), (response.getheader("Content-Type") or "").split(";")[0].strip().lower(), text
    finally:
        with call["lock"]:
            call["connection"] = None
        connection.close()


def _response(content_type, body, request_id):
    """The JSON-RPC response for request_id from a JSON or event-stream body."""
    if content_type != "text/event-stream":
        return json.loads(body) if body.strip() else None
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            frame = json.loads(line[5:].strip())
        except ValueError:
            continue
        if isinstance(frame, dict) and frame.get("id") == request_id:
            return frame
    return None


def _call_tool(call, endpoint, authorization, name, arguments):
    """One MCP session per call, ended afterwards even when the turn was stopped."""
    mcp_session, _, _ = _send(call, "POST", endpoint, authorization, {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": "hermes-t3-code", "version": "1"},
        },
    })
    try:
        _send(call, "POST", endpoint, authorization, {"jsonrpc": "2.0", "method": "notifications/initialized"}, mcp_session)
        # _send refuses once the turn is stopped, so a stop during the handshake never reaches the tool.
        _, content_type, body = _send(call, "POST", endpoint, authorization, {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }, mcp_session, CALL_TIMEOUT_SECONDS)
        return _response(content_type, body, 2)
    finally:
        if mcp_session:
            try:
                _send(_new_call(), "DELETE", endpoint, authorization, None, mcp_session, CLOSE_TIMEOUT_SECONDS)
            except Exception:
                pass


def _turn_stopped():
    try:
        from tools.interrupt import is_interrupted

        return bool(is_interrupted())
    except Exception:
        return False


def _new_call():
    return {"stopped": threading.Event(), "connection": None, "lock": threading.Lock()}


def _stop(call):
    """Refuse further requests and break the one in flight, which ends the worker."""
    with call["lock"]:
        call["stopped"].set()
        connection = call["connection"]
    # Outside the lock: the worker may be blocked writing a large request.
    try:
        if connection is not None and connection.sock is not None:
            # close() alone does not wake a thread blocked in recv() or send().
            connection.sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


def _call_until_stopped(endpoint, authorization, name, arguments):
    """Run the call on a worker so stopping the Hermes turn does not wait for Tangent.

    Hermes marks the handler's own thread as interrupted, so that thread polls.
    Returns (frame, stopped).
    """
    call = _new_call()

    def run():
        try:
            call["frame"] = _call_tool(call, endpoint, authorization, name, arguments)
        except BaseException as error:  # reported on the handler thread
            call["error"] = error

    worker = threading.Thread(target=run, name="t3-code-call", daemon=True)
    worker.start()
    while worker.is_alive():
        worker.join(INTERRUPT_POLL_SECONDS)
        if worker.is_alive() and _turn_stopped():
            _stop(call)
            return None, True
    if "error" in call:
        raise call["error"]
    return call.get("frame"), False


def _save_image(block):
    """Hermes shows the model an image as a MEDIA:<path> line, as its own MCP client does."""
    try:
        data = base64.b64decode(block.get("data") or "", validate=False)
    except ValueError:
        return ""
    if not data:
        return ""
    mime = str(block.get("mimeType") or "image/png").split(";")[0].strip().lower()
    extension = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(mime, ".png")
    try:
        from gateway.platforms.base import cache_image_from_bytes

        return "MEDIA:" + cache_image_from_bytes(data, ext=extension)
    except Exception:
        handle, path = tempfile.mkstemp(prefix="t3code-", suffix=extension)
        with os.fdopen(handle, "wb") as file:
            file.write(data)
        return "MEDIA:" + path


def _render(frame):
    if not isinstance(frame, dict):
        return json.dumps({"error": "Tangent did not answer the tool call."})
    if isinstance(frame.get("error"), dict):
        return json.dumps({"error": str(frame["error"].get("message") or "Tangent rejected the tool call.")})
    result = frame.get("result") if isinstance(frame.get("result"), dict) else {}
    parts = []
    for block in result.get("content") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
        elif block.get("type") == "image":
            parts.append(_save_image(block))
    text = "\n".join(part for part in parts if part)
    if result.get("isError"):
        return json.dumps({"error": text or "The Tangent tool failed."})
    if text:
        return text
    return json.dumps(result.get("structuredContent") if result.get("structuredContent") is not None else {"ok": True})


def _attached(bridge, session_key):
    """The binding Tangent wrote for exactly this session, or None."""
    if not session_key or not SESSION_KEY.match(session_key):
        return None
    try:
        with open(os.path.join(bridge, SESSIONS_DIR, session_key + ".json"), encoding="utf-8") as file:
            binding = json.load(file)
    except (OSError, ValueError):
        return None
    if not isinstance(binding, dict) or not binding.get("endpoint") or not binding.get("authorization"):
        return None
    return binding


def _binding(bridge, *keys):
    """The binding for a call, or for the session whose subagent made it.

    Hermes gives a compressed conversation a new session id mid-turn, but the
    turn's task id stays the id it started under, so a call is looked up by both.
    """
    seen = set()
    for key in keys:
        while key and key not in seen:
            seen.add(key)
            binding = _attached(bridge, key)
            if binding is not None:
                return binding
            with _lock:
                key = _parents.get(key)
    return None


def _handler(bridge, name):
    def handle(params, **kwargs):
        binding = _binding(bridge, str(kwargs.get("session_id") or ""), str(kwargs.get("task_id") or ""))
        if binding is None:
            return json.dumps({"error": UNATTACHED})
        try:
            frame, stopped = _call_until_stopped(binding["endpoint"], binding["authorization"], name, params or {})
        except _Refused as error:
            return json.dumps({"error": "Tangent refused the tool call (HTTP %d)." % error.status})
        except Exception as error:
            return json.dumps({"error": "Could not reach Tangent (%s)." % type(error).__name__})
        return json.dumps({"error": INTERRUPTED}) if stopped else _render(frame)

    return handle


def _point(key, target):
    """Calls under key belong wherever target's do, unless key is already known. Caller holds _lock.

    It points at the end of target's chain, so a subagent that outlives the
    subagent that spawned it still reaches its thread.
    """
    if not key or not target or key == target or key in _parents:
        return
    if len(_parents) >= MAX_ALIASES:
        for old in list(_parents)[: MAX_ALIASES // 2]:
            _parents.pop(old, None)
            _subagent_ids.pop(old, None)
    seen = set()
    while target in _parents and target not in seen:
        seen.add(target)
        target = _parents[target]
    _parents[key] = target


def _rename(key, known):
    """key is a newer id for known, so also one of that subagent's ids. Caller holds _lock."""
    if not key or not known or key == known:
        return
    _point(key, known)
    ids = _subagent_ids.get(known)
    if ids is not None:
        ids.add(key)
        _subagent_ids[key] = ids


def _note_call(task_id="", session_id="", **kwargs):
    """Before every tool call: a session id that differs from its task id is a newer name for it.

    This runs before delegate_task spawns a subagent, so a subagent started
    after its parent was compressed still leads back to an attached session.
    """
    with _lock:
        _rename(str(session_id or ""), str(task_id or ""))


def _subagent_started(parent_session_id=None, parent_subagent_id=None, child_session_id=None, child_subagent_id=None, **kwargs):
    if not parent_session_id:
        return
    parent = str(parent_session_id)
    # A subagent's turns run under its subagent id as their task id.
    ids = {str(key) for key in (child_session_id, child_subagent_id) if key}
    with _lock:
        # A subagent that spawns one of its own may have been compressed since it started.
        _rename(parent, str(parent_subagent_id or ""))
        for key in ids:
            _point(key, parent)
            _subagent_ids[key] = ids


def _subagent_stopped(child_session_id=None, child_subagent_id=None, **kwargs):
    """Forget the finished subagent's own ids. Hermes may name only its session."""
    with _lock:
        finished = set()
        for key in (child_session_id, child_subagent_id):
            if key:
                finished.add(str(key))
                finished.update(_subagent_ids.get(str(key)) or ())
        for key in finished:
            _parents.pop(key, None)
            _subagent_ids.pop(key, None)


def _brief(bridge):
    def before_turn(session_id="", conversation_history=None, **kwargs):
        """Tangent's instructions, once per session: Hermes keeps them with that turn's message."""
        session_key = str(session_id or "")
        binding = _attached(bridge, session_key)
        instructions = binding.get("instructions") if binding else None
        if not isinstance(instructions, str) or not instructions:
            return None
        with _lock:
            if session_key in _briefed:
                return None
            _briefed.add(session_key)
        # After a gateway restart the earlier turn that carried them is still in the history.
        try:
            if INSTRUCTIONS_TAG in json.dumps(conversation_history or [], default=str):
                return None
        except (TypeError, ValueError):
            pass
        return {"context": instructions}

    return before_turn


def register(ctx):
    bridge = os.environ.get(BRIDGE_ENV)
    if not bridge:
        return
    try:
        with open(os.path.join(bridge, TOOLS_FILE), encoding="utf-8") as file:
            tools = json.load(file)
    except (OSError, ValueError):
        return
    registered = 0
    for tool in tools if isinstance(tools, list) else []:
        name = tool.get("name") if isinstance(tool, dict) else None
        if not isinstance(name, str) or not name:
            continue
        ctx.register_tool(
            name=PREFIX + name,
            toolset="t3-code",
            schema={
                "name": PREFIX + name,
                "description": str(tool.get("description") or ""),
                "parameters": tool.get("inputSchema") or {"type": "object", "properties": {}},
            },
            handler=_handler(bridge, name),
        )
        registered += 1
    ctx.register_hook("pre_llm_call", _brief(bridge))
    ctx.register_hook("pre_tool_call", _note_call)
    ctx.register_hook("subagent_start", _subagent_started)
    ctx.register_hook("subagent_stop", _subagent_stopped)
    # Tells Tangent this profile has the plugin enabled.
    try:
        with open(os.path.join(bridge, LOADED_FILE), "w", encoding="utf-8") as file:
            json.dump({"tools": registered}, file)
    except OSError:
        pass
`;
