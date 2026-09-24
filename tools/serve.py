"""Local preview server that tells the browser never to cache, so every reload shows the latest files.

Usage: python3 tools/serve.py [port]   (run from the site folder; default port 4321)
"""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4321
    handler = functools.partial(NoCacheHandler, directory=".")
    print(f"Serving on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
