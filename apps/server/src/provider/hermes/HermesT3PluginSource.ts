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
import json
import os
import re
import tempfile
import threading
import urllib.error
import urllib.request

BRIDGE_ENV = ${JSON.stringify(HERMES_T3_BRIDGE_ENV)}
PREFIX = ${JSON.stringify(HERMES_T3_TOOL_PREFIX)}
TOOLS_FILE = ${JSON.stringify(HERMES_T3_TOOLS_FILE)}
SESSIONS_DIR = ${JSON.stringify(HERMES_T3_SESSIONS_DIR)}
LOADED_FILE = ${JSON.stringify(HERMES_T3_LOADED_FILE)}
INSTRUCTIONS_TAG = ${JSON.stringify(`<${HERMES_T3_INSTRUCTIONS_TAG}>`)}
PROTOCOL = "2025-06-18"
SESSION_KEY = re.compile(r"^[A-Za-z0-9_.-]+$")
HANDSHAKE_TIMEOUT_SECONDS = 30
# Some tools wait on other threads or on the user.
CALL_TIMEOUT_SECONDS = 1800
INTERRUPT_POLL_SECONDS = 0.2
UNATTACHED = "This Hermes session is not attached to a Tangent thread, so Tangent tools are unavailable here."
INTERRUPTED = "The turn was stopped before Tangent answered."

# Loopback only: never route the credential through a configured proxy.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_lock = threading.Lock()
# A Hermes subagent has its own session; its calls belong to the thread that spawned it.
_parents = {}
# Sessions already given Tangent's instructions by this process.
_briefed = set()


def _send(method, endpoint, authorization, payload=None, mcp_session=None, timeout=HANDSHAKE_TIMEOUT_SECONDS):
    headers = {
        "Accept": "application/json, text/event-stream",
        "Authorization": authorization,
        "MCP-Protocol-Version": PROTOCOL,
    }
    if mcp_session:
        headers["Mcp-Session-Id"] = mcp_session
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(endpoint, data=data, headers=headers, method=method)
    with _opener.open(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return response.headers.get("Mcp-Session-Id"), response.headers.get_content_type(), body


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


def _close(endpoint, authorization, mcp_session):
    if not mcp_session:
        return
    try:
        _send("DELETE", endpoint, authorization, None, mcp_session)
    except Exception:
        pass


def _call_tool(endpoint, authorization, name, arguments, call):
    """One MCP session per call. The session id is shared so a stopped turn can end it."""
    mcp_session, _, _ = _send("POST", endpoint, authorization, {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": "hermes-t3-code", "version": "1"},
        },
    })
    call["mcp_session"] = mcp_session
    try:
        _send("POST", endpoint, authorization, {"jsonrpc": "2.0", "method": "notifications/initialized"}, mcp_session)
        _, content_type, body = _send("POST", endpoint, authorization, {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }, mcp_session, CALL_TIMEOUT_SECONDS)
        return _response(content_type, body, 2)
    finally:
        _close(endpoint, authorization, mcp_session)


def _turn_stopped():
    try:
        from tools.interrupt import is_interrupted

        return bool(is_interrupted())
    except Exception:
        return False


def _call_until_stopped(endpoint, authorization, name, arguments):
    """Run the call on a worker so stopping the Hermes turn does not wait for Tangent.

    Hermes marks the handler's own thread as interrupted, so that thread polls.
    Returns (frame, stopped).
    """
    call = {}

    def run():
        try:
            call["frame"] = _call_tool(endpoint, authorization, name, arguments, call)
        except BaseException as error:  # reported on the handler thread
            call["error"] = error

    worker = threading.Thread(target=run, name="t3-code-call", daemon=True)
    worker.start()
    while worker.is_alive():
        worker.join(INTERRUPT_POLL_SECONDS)
        if worker.is_alive() and _turn_stopped():
            _close(endpoint, authorization, call.get("mcp_session"))
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


def _binding(bridge, session_key):
    """This session's binding, or the binding of the session whose subagent it is."""
    seen = set()
    while session_key and session_key not in seen:
        seen.add(session_key)
        binding = _attached(bridge, session_key)
        if binding is not None:
            return binding
        with _lock:
            session_key = _parents.get(session_key)
    return None


def _handler(bridge, name):
    def handle(params, **kwargs):
        binding = _binding(bridge, str(kwargs.get("session_id") or kwargs.get("task_id") or ""))
        if binding is None:
            return json.dumps({"error": UNATTACHED})
        try:
            frame, stopped = _call_until_stopped(binding["endpoint"], binding["authorization"], name, params or {})
        except urllib.error.HTTPError as error:
            return json.dumps({"error": "Tangent refused the tool call (HTTP %d)." % error.code})
        except Exception as error:
            return json.dumps({"error": "Could not reach Tangent (%s)." % type(error).__name__})
        return json.dumps({"error": INTERRUPTED}) if stopped else _render(frame)

    return handle


def _subagent_started(bridge):
    def on_start(parent_session_id=None, child_session_id=None, **kwargs):
        if parent_session_id and child_session_id:
            with _lock:
                _parents[str(child_session_id)] = str(parent_session_id)

    return on_start


def _subagent_stopped(child_session_id=None, **kwargs):
    if child_session_id:
        with _lock:
            _parents.pop(str(child_session_id), None)


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
    ctx.register_hook("subagent_start", _subagent_started(bridge))
    ctx.register_hook("subagent_stop", _subagent_stopped)
    # Tells Tangent this profile has the plugin enabled.
    try:
        with open(os.path.join(bridge, LOADED_FILE), "w", encoding="utf-8") as file:
            json.dump({"tools": registered}, file)
    except OSError:
        pass
`;
