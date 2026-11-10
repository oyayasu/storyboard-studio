#!/usr/bin/env python3
"""Local-only preview; use the same port to reopen the same browser test library."""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import argparse,threading,webbrowser

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=45671)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent/'src'
url=f'http://127.0.0.1:{args.port}'
try:
    server=ThreadingHTTPServer(('127.0.0.1',args.port),partial(SimpleHTTPRequestHandler,directory=str(root)))
except OSError as error:
    raise SystemExit(f'Could not open the preview port: {error}\nClose an earlier preview or run with --port 45672.')
print('Storyboard Studio — Highlighter Test 0.4.0',flush=True)
print(f'Opening {url}\nKeep this window open while testing. Press Control+C to stop.',flush=True)
print('Browser preview and native app have separate test saves. Use Export test project to transfer a test project.',flush=True)
threading.Timer(.4,lambda:webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
