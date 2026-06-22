from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from src.solver import planner


HOST = "127.0.0.1"
PORT = 8000
PROJECT_ROOT = Path(__file__).resolve().parent
WEB_DIR = PROJECT_ROOT / "web"


class PlannerRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed_url = urlparse(self.path)

        if parsed_url.path == "/":
            self._send_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            return

        if parsed_url.path.startswith("/web/"):
            self._send_web_asset(parsed_url.path)
            return

        if parsed_url.path == "/api/items":
            self._send_json(sorted(planner.items_by_name))
            return

        if parsed_url.path == "/api/recipes":
            query = parse_qs(parsed_url.query)
            item_name = query.get("item", [""])[0]
            self._send_json_or_error(lambda: planner.list_recipes(item_name))
            return

        if parsed_url.path.startswith("/data/item_icons/"):
            self._send_icon(parsed_url.path)
            return

        self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed_url = urlparse(self.path)
        if parsed_url.path != "/api/calculate":
            self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(content_length).decode("utf-8")
            payload = json.loads(body or "{}")
            rate = payload.get("rate")
            input_limit_mode = rate in (None, "")
            result = planner.visual_graph(
                item=payload["item"],
                rate=1.0 if input_limit_mode else float(rate),
                strategy=payload.get("strategy", "default"),
                recipe_choices=payload.get("recipe_choices") or None,
                clock_percent=float(payload.get("clock_percent") or 100),
            )
            if input_limit_mode:
                result["mode"] = "input_limits"
                result["rate"] = None
                result["base_rate"] = 1
                result["numbers_visible"] = False
            else:
                result["mode"] = "output_rate"
                result["numbers_visible"] = True
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return

        self._send_json(result)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _send_json_or_error(self, callback) -> None:
        try:
            self._send_json(callback())
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def _send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        response = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def _send_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self._send_json({"error": "File not found"}, status=HTTPStatus.NOT_FOUND)
            return

        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_icon(self, request_path: str) -> None:
        relative_path = unquote(request_path.lstrip("/"))
        icon_path = (PROJECT_ROOT / relative_path).resolve()
        icon_root = (PROJECT_ROOT / "data" / "item_icons").resolve()

        if icon_root not in icon_path.parents or not icon_path.exists():
            self._send_json({"error": "Icon not found"}, status=HTTPStatus.NOT_FOUND)
            return

        self._send_file(icon_path, "image/png")

    def _send_web_asset(self, request_path: str) -> None:
        relative_path = unquote(request_path.lstrip("/"))
        asset_path = (PROJECT_ROOT / relative_path).resolve()
        web_root = WEB_DIR.resolve()

        if web_root not in asset_path.parents or not asset_path.exists():
            self._send_json({"error": "Asset not found"}, status=HTTPStatus.NOT_FOUND)
            return

        content_types = {
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".html": "text/html; charset=utf-8",
        }
        self._send_file(asset_path, content_types.get(asset_path.suffix, "application/octet-stream"))


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), PlannerRequestHandler)
    print(f"Serving Satisfactory Visual Planner at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
