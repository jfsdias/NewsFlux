import json, os, ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
# Test-only Miniflux API: canary keys, admin/non-admin users, optional /v1/users failure.
TOKENS = {"tok-owner-CANARYKEY7": (7, True), "tok-user-CANARYKEY9": (9, False), "tok-admin2-CANARYKEY8": (8, True)}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        who = TOKENS.get(self.headers.get("X-Auth-Token", ""))
        if not who:
            return self.send(401, {"error_message": "Access Unauthorized"})
        if self.path == "/v1/me":
            return self.send(200, {"id": who[0], "username": f"user-{who[0]}-CANARYNAME", "is_admin": who[1]})
        if self.path == "/v1/users":
            if os.path.exists("/state/users500"):
                return self.send(500, {"error_message": "boom"})
            if not who[1]:
                return self.send(403, {"error_message": "Access Forbidden"})
            users = [{"id": 7, "username": "user-7-CANARYNAME", "is_admin": True},
                     {"id": 9, "username": "user-9-CANARYNAME", "is_admin": False}]
            if os.path.exists("/state/multi"):
                users.append({"id": 8, "username": "user-8-CANARYNAME", "is_admin": True})
            return self.send(200, users)
        self.send(404, {})
srv = ThreadingHTTPServer(("0.0.0.0", 443), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain("/tls/server.pem", "/tls/server.key")
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
srv.serve_forever()
