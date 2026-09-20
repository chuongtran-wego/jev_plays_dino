#!/usr/bin/env python3
"""Small HTTP service that keeps a Laya-MLX model loaded on Apple Silicon."""

from __future__ import annotations

import json
import os
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


ACTIONS = ("jump", "duck", "continue")
MODEL_ID = os.getenv("LAYA_MODEL", "aac6fef/laya-mlx")
HOST = os.getenv("LAYA_HOST", "127.0.0.1")
PORT = int(os.getenv("LAYA_PORT", "8090"))
API_KEY = os.getenv("LAYA_SERVER_API_KEY", "")

_agent: Any = None
_inference_lock = threading.Lock()


def load_agent() -> Any:
    import laya_mlx as laya

    return laya.load(
        MODEL_ID,
        dtype=os.getenv("LAYA_DTYPE", "float16"),
        device=os.getenv("LAYA_DEVICE", "gpu"),
        compile=os.getenv("LAYA_COMPILE", "false").lower() == "true",
        pad_to_multiple=16,
        cache_prompts=True,
    )


def make_state(payload: dict[str, Any]) -> dict[str, Any]:
    obstacle = payload["obstacle"]
    return {
        "obstacle_type": obstacle["type"],
        "time_to_collision_ms": payload.get("time_to_collision_ms", 0),
        "dino_state": payload.get("dino_state", "running"),
    }


def decide(payload: dict[str, Any]) -> dict[str, Any]:
    obstacle = payload.get("obstacle")
    if not isinstance(obstacle, dict) or not obstacle.get("id") or not obstacle.get("type"):
        raise ValueError("obstacle.id and obstacle.type are required")

    questions = {
        "next_action": {
            "type": "choice",
            "instructions": "Select the maneuver for this obstacle.",
            "criteria": {
                "jump": "Ground cactus.",
                "duck": "Low bird.",
                "continue": "High bird.",
            },
        }
    }
    started = time.perf_counter()
    with _inference_lock:
        output = _agent.predict(make_state(payload), questions)
    latency_ms = max(1, round((time.perf_counter() - started) * 1000))
    answer = output["answers"]["next_action"]
    action = answer["choice"]
    probabilities = answer["probabilities"]
    if action not in ACTIONS or set(probabilities) != set(ACTIONS):
        raise ValueError("model returned an invalid action distribution")

    return {
        "obstacle_id": obstacle["id"],
        "action": action,
        "probabilities": probabilities,
        "confidence": answer.get("confidence", probabilities[action]),
        "latency_ms": latency_ms,
        "engine": "laya-mlx",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "LayaDino/1.0"

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.write_json(HTTPStatus.OK, {"ok": True, "engine": "laya-mlx", "model": MODEL_ID})

    def do_POST(self) -> None:
        if self.path != "/v1/decision":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if API_KEY and self.headers.get("Authorization") != f"Bearer {API_KEY}":
            self.write_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 16 * 1024:
                raise ValueError("invalid content length")
            payload = json.loads(self.rfile.read(length))
            self.write_json(HTTPStatus.OK, decide(payload))
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # Keep inference failures behind a stable API.
            print(f"decision error: {error}", flush=True)
            self.write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "inference failed"})

    def write_json(self, status: HTTPStatus, value: dict[str, Any]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


def main() -> None:
    global _agent
    print(f"Loading {MODEL_ID}…", flush=True)
    _agent = load_agent()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Laya-MLX listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
