"""Linux smoke test of the packaged scripts/server, without an fnOS device."""
import http.client
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tarfile
import tempfile


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.settimeout(5)
        self.sock.connect(str(sock))


with tempfile.TemporaryDirectory(prefix='fn-dit-smoke-') as tmp:
    root = Path(tmp)
    # Input is the output that passed inspect-fpk.py, not an arbitrary upload.
    with tarfile.open(sys.argv[1], 'r:gz') as outer:
        outer.extractall(root, filter='data')
    target = root / 'target'
    target.mkdir()
    with tarfile.open(fileobj=io.BytesIO((root / 'app.tgz').read_bytes()), mode='r:gz') as inner:
        inner.extractall(target, filter='data')
    state = root / 'state'
    env = {**os.environ, 'TRIM_APPDEST': str(target), 'TRIM_PKGVAR': str(state),
           'TRIM_TEMP_LOGFILE': str(root / 'error.log')}
    env.pop('DIT_DEV', None)
    sock = target / 'app.sock'
    main = root / 'cmd/main'

    def ctl(action, expected=0):
        result = subprocess.run([str(main), action], env=env, timeout=25)
        assert result.returncode == expected, (action, result.returncode, (state / 'service.log').read_text() if state.exists() else '')

    def request(route, headers=None, method='GET', body=None):
        connection = UnixHTTP('localhost')
        connection.request(method, '/app/fn-dit/' + route, body=body, headers=headers or {})
        response = connection.getresponse()
        data = response.read()
        code = response.status
        connection.close()
        return code, data

    ctl('status', 3)
    try:
        ctl('start')
        ctl('status')
        pid = (state / 'fn-dit.pid').read_text()
        ctl('start')
        assert (state / 'fn-dit.pid').read_text() == pid, 'duplicate process on repeated start'
        assert request('api/status')[0] == 403
        code, data = request('api/status', {'X-Trim-Isadmin': 'true'})
        assert code == 200 and json.loads(data)['config']['enabled'] is False
        assert any('UTC+8' in line for line in json.loads(data)['logs']), 'runtime logs must use East Asia time'
        admin={'X-Trim-Isadmin': 'true'}
        code, page=request('', admin)
        assert code == 200 and b'id="choose-destination"' in page and b'id="destination" type="hidden"' in page
        for asset in ('directory-picker.mjs','vendor/trim-web-app.mjs','folder-callback.html','folder-callback.mjs'):
            assert request(asset,admin)[0] == 200, asset
        code, mounts=request('api/mounts',admin)
        assert code == 200 and isinstance(json.loads(mounts)['devices'],list) and json.loads(mounts)['message']
        assert request('api/source/add',{**admin,'X-Dit-Request':'1'},'POST',json.dumps({'source':'/etc'}))[0] == 400
        payload=json.dumps({'destination':'/etc'})
        assert request('api/destination/check',admin,'POST',payload)[0] == 403
        assert request('api/destination/check',{**admin,'X-Dit-Request':'1'},'POST',payload)[0] == 400
    finally:
        ctl('stop')
    ctl('status', 3)
    assert not sock.exists() and not (state / 'fn-dit.pid').exists()
    # A broken service must fail startup visibly instead of returning success.
    (target / 'server/server.js').write_text('throw new Error("smoke-test failure");\n')
    ctl('start', 1)
    assert '服务启动失败' in (root / 'error.log').read_text()
    ctl('status', 3)
print('Packaged lifecycle smoke passed: start/status/repeated-start, admin HTTP, stop, failed startup.')
