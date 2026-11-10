from __future__ import annotations

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

USER_KEY = os.environ["NEWSFLUX_TEST_USER_KEY"]
ROTATED_KEY = os.environ["NEWSFLUX_TEST_ROTATED_KEY"]
OTHER_USER_KEY = os.environ["NEWSFLUX_TEST_OTHER_USER_KEY"]
ADMIN_KEY = os.environ["NEWSFLUX_TEST_ADMIN_KEY"]
USER_ID = 7
OTHER_USER_ID = 8
ADMIN_ID = 99
FEED_ID = 55
CATEGORY_ID = 42

SHORT_CONTENT = {
    501: "<p>Original teaser 501: a short synthetic article preview.</p>",
    502: "<p>Original teaser 502: a short synthetic article preview.</p>",
    503: "<p>Original teaser 503: a short synthetic article preview.</p>",
    701: "<p>Original teaser 701: a short synthetic article preview.</p>",
    801: "<p>Original teaser 801: a short synthetic article preview.</p>",
    901: "<p>Original teaser 901: a short synthetic article preview.</p>",
    902: "<p>Original teaser 902: a short synthetic article preview.</p>",
    991: "<p>Original teaser 991: a short synthetic article preview.</p>",
}
RECOVERED_PARAGRAPHS = (
    "Synthetic recovered paragraph for isolated Reader validation. Researchers compared water temperature, wind direction, and shoreline movement at several coastal stations during repeated autumn visits. The record kept each observation available for later comparison.",
    "Synthetic recovered paragraph for isolated Reader validation. Field notes recorded rainfall totals and tide levels, giving scientists comparable observations across northern survey locations. These entries gave researchers a consistent reference for analysis.",
    "Synthetic recovered paragraph for isolated Reader validation. The teams reviewed morning measurements alongside evening readings to identify gradual changes across the region. That review helped describe the regional pattern accurately.",
    "Synthetic recovered paragraph for isolated Reader validation. Local observers documented shoreline conditions and shared dated reports with the coordinating research group. The dated notes allowed teams to verify their field reports.",
    "Synthetic recovered paragraph for isolated Reader validation. Analysts checked the collected records for gaps before comparing results from every monitoring station. This process made missing observations visible before analysis was completed.",
    "Synthetic recovered paragraph for isolated Reader validation. Researchers described how seasonal winds affected the samples and noted which patterns appeared consistently. The summary distinguished recurring effects from temporary local changes.",
    "Synthetic recovered paragraph for isolated Reader validation. The study team compared its findings with earlier observations while keeping each source record intact. Earlier measurements supplied context for the new observations.",
    "Synthetic recovered paragraph for isolated Reader validation. Follow-up visits will help the group assess whether these measured conditions continue through the winter. The next survey will extend the same measurement process.",
)
RECOVERED_CONTENT = "".join(f"<p>{paragraph}</p>" for paragraph in RECOVERED_PARAGRAPHS) + (
    "<script>window.__unsafe_fixture_script = true</script>"
)
FEED = {
    "id": FEED_ID,
    "user_id": USER_ID,
    "title": "Synthetic Research Desk",
    "site_url": "https://publisher.example.test",
    "feed_url": "https://publisher.example.test/feed.xml",
    "urlrewrite_rules": "",
    "category": {"id": CATEGORY_ID, "title": "Technology", "user_id": USER_ID},
    "icon": None,
    "disabled": False,
    "hide_globally": False,
}

_lock = threading.Lock()
_events: list[dict[str, object]] = []
_writes: list[str] = []
_entry_reads: dict[int, int] = {}
_fingerprint_mismatch = False
_user_entry_ids = (501, 502, 503, 701, 901)
_other_user_entry_ids = (801, 902)
_admin_entry_ids = (991,)


def _principal(api_key: str) -> tuple[int, bool] | None:
    if api_key in {USER_KEY, ROTATED_KEY}:
        return USER_ID, False
    if api_key == OTHER_USER_KEY:
        return OTHER_USER_ID, False
    if api_key == ADMIN_KEY:
        return ADMIN_ID, True
    return None


def _entry(entry_id: int, owner_id: int, *, mismatch_url: bool = False) -> dict[str, object]:
    published = "2026-10-01T12:00:00Z"
    feed = {**FEED, "user_id": owner_id, "category": {**FEED["category"], "user_id": owner_id}}
    url_id = entry_id
    url = f"https://publisher.example.test/article/{url_id}"
    if mismatch_url:
        url = f"https://publisher.example.test/article/{url_id}?fixture=fingerprint-changed"
    return {
        "id": entry_id,
        "user_id": owner_id,
        "feed_id": FEED_ID,
        "status": "unread",
        "hash": f"synthetic-{entry_id}",
        "title": f"Synthetic story {entry_id}",
        "url": url,
        "comments_url": "",
        "published_at": published,
        "created_at": published,
        "changed_at": published,
        "content": SHORT_CONTENT.get(entry_id, "<p>Short synthetic teaser.</p>"),
        "author": "Synthetic fixture",
        "share_code": "",
        "starred": True,
        "reading_time": 1,
        "enclosures": [],
        "tags": [],
        "feed": feed,
    }


def _send(handler: BaseHTTPRequestHandler, status: int, value: object) -> None:
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    server_version = "NewsFluxSyntheticMiniflux/1.0"

    def _record(self, status: int) -> None:
        parsed_url = urlsplit(self.path)
        query = parse_qs(parsed_url.query)
        entry = {
            "method": self.command,
            "path": parsed_url.path,
            "status": status,
            "forwarded_proto": self.headers.get("X-Forwarded-Proto"),
            "forwarded_for": self.headers.get("X-Forwarded-For"),
            "forwarded_host": self.headers.get("X-Forwarded-Host"),
            "forwarded_header": self.headers.get("Forwarded"),
            "update_content": query.get("update_content", []),
        }
        with _lock:
            _events.append(entry)
            if self.command != "GET":
                _writes.append(self.command)

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        query = parse_qs(urlsplit(self.path).query)
        api_key = self.headers.get("X-Auth-Token", "")
        principal = _principal(api_key)
        status = 200

        if path == "/__harness__/state":
            with _lock:
                events = list(_events)
                writes = list(_writes)
            payload = {
                "events": events,
                "writes": writes,
                "read_ids": [],
                "unread_ids": list(_user_entry_ids),
                "starred_ids": list(_user_entry_ids),
                "reader_recovery_gets": [
                    event["path"]
                    for event in events
                    if str(event["path"]).endswith("/fetch-content")
                ],
                "real_wallhop_requests": 0,
            }
            _send(self, status, payload)
            self._record(status)
            return

        if path == "/__harness__/fingerprint-mode":
            global _fingerprint_mismatch
            with _lock:
                _fingerprint_mismatch = query.get("enabled") == ["1"]
                _entry_reads[901] = 0
            _send(self, status, {"enabled": _fingerprint_mismatch})
            self._record(status)
            return

        if principal is None:
            status = 401
            _send(self, status, {"error_message": "Unauthorized"})
            self._record(status)
            return

        user_id, is_admin = principal
        if path == "/v1/version":
            payload: object = {"version": "2.3.2", "commit": "synthetic", "build_date": "2026-11-10"}
        elif path == "/v1/me":
            payload = {"id": user_id, "username": f"synthetic-{user_id}", "is_admin": is_admin, "theme": "system"}
        elif path == "/v1/categories":
            payload = [{"id": CATEGORY_ID, "user_id": user_id, "title": "Technology"}]
        elif path == "/v1/feeds/counters":
            payload = {"reads": {str(FEED_ID): 0}, "unreads": {str(FEED_ID): len(_user_entry_ids)}}
        elif path == "/v1/feeds":
            payload = [{**FEED, "user_id": user_id, "category": {**FEED["category"], "user_id": user_id}}]
        elif path == f"/v1/feeds/{FEED_ID}":
            payload = {**FEED, "user_id": user_id, "category": {**FEED["category"], "user_id": user_id}}
        elif path == "/v1/integrations/status":
            payload = {"has_integrations": False}
        elif path in {"/v1/entries", "/v1/entries/ids"}:
            entries = [_entry(entry_id, user_id) for entry_id in _user_entry_ids if user_id == USER_ID]
            payload = {"total": len(entries), "entries": entries}
            if path.endswith("/ids"):
                payload = {"total": len(entries), "entry_ids": [item["id"] for item in entries]}
        elif re.fullmatch(r"/v1/entries/[1-9][0-9]*/fetch-content", path):
            entry_id = int(path.split("/")[3])
            if query.get("update_content") != ["false"]:
                status = 400
                payload = {"error_message": "Only response-only content fetches are allowed"}
            elif entry_id == 502:
                status = 503
                payload = {"error_message": "Synthetic provider failure"}
            else:
                if entry_id == 503:
                    time.sleep(2.5)
                payload = {"content": RECOVERED_CONTENT}
        else:
            match = re.fullmatch(r"/v1/entries/([1-9][0-9]*)", path)
            if match is None:
                status = 404
                payload = {"error_message": "Not found"}
            else:
                entry_id = int(match.group(1))
                owner_id = (
                    OTHER_USER_ID if entry_id in _other_user_entry_ids else
                    ADMIN_ID if entry_id == 991 else
                    USER_ID
                )
                if (
                    entry_id not in _user_entry_ids
                    and entry_id not in _other_user_entry_ids
                    and entry_id not in _admin_entry_ids
                ):
                    status = 404
                    payload = {"error_message": "Entry not found"}
                elif owner_id != user_id:
                    status = 403
                    payload = {"error_message": "Entry not accessible"}
                else:
                    with _lock:
                        _entry_reads[entry_id] = _entry_reads.get(entry_id, 0) + 1
                        read_count = _entry_reads[entry_id]
                        mismatch = _fingerprint_mismatch and entry_id == 901 and read_count >= 2
                    payload = _entry(entry_id, owner_id, mismatch_url=mismatch)

        _send(self, status, payload)
        self._record(status)

    def do_POST(self) -> None:  # noqa: N802
        self._record(405)
        _send(self, 405, {"error_message": "Synthetic Miniflux is read-only"})

    def do_PUT(self) -> None:  # noqa: N802
        self._record(405)
        _send(self, 405, {"error_message": "Synthetic Miniflux is read-only"})

    def do_DELETE(self) -> None:  # noqa: N802
        self._record(405)
        _send(self, 405, {"error_message": "Synthetic Miniflux is read-only"})

    def do_PATCH(self) -> None:  # noqa: N802
        self._record(405)
        _send(self, 405, {"error_message": "Synthetic Miniflux is read-only"})

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._record(405)
        _send(self, 405, {"error_message": "Synthetic Miniflux is read-only"})

    def log_message(self, _format: str, *args: object) -> None:
        # Do not log request headers, article content, request bodies or query values.
        status = args[1] if len(args) > 1 else "-"
        print(f"synthetic-miniflux {self.command} {urlsplit(self.path).path} {status}", flush=True)


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
    server.daemon_threads = True
    print("synthetic-miniflux ready", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
