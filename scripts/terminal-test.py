#!/usr/bin/env python3
import os
import pty
import select
import sys
import time

env = os.environ.copy()
env['TERM'] = 'xterm-256color'
pid, fd = pty.fork()
if pid == 0:
    os.execvpe('node', ['node', 'bin/aimp.js', '--help'], env)
deadline = time.time() + 10
data = bytearray()
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if not ready:
        continue
    try:
        data.extend(os.read(fd, 65536))
    except OSError:
        break
_, status = os.waitpid(pid, 0)
text = data.decode('utf-8', errors='replace')
if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0 or 'aimp' not in text or '/sync' not in text:
    print(text, file=sys.stderr)
    raise SystemExit('terminal smoke test failed')
print('terminal smoke test passed')
