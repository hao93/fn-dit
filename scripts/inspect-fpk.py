"""Inspect fnpack staging/archives without extracting archive paths."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import struct
import tarfile

HOOKS = ('main', 'install_init', 'install_callback', 'upgrade_init',
         'upgrade_callback', 'uninstall_init', 'uninstall_callback',
         'config_init', 'config_callback')
ROOT = Path(__file__).resolve().parent.parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def manifest_values(data):
    text = data.decode('utf-8')
    require('\r' not in text and not text.startswith('\ufeff'), 'manifest must use UTF-8 without BOM and LF only')
    return dict(tuple(part.strip().strip('"') for part in line.split('=', 1))
                for line in text.splitlines() if '=' in line and not line.startswith('#'))


def archive(data):
    files, modes, dirs, seen = {}, {}, set(), set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        for member in tar:
            name = member.name.rstrip('/')
            p = PurePosixPath(name)
            require(name and not name.startswith(('/', './')) and '..' not in p.parts and '\\' not in name,
                    f'noncanonical archive path: {name}')
            require(name not in seen, f'duplicate archive path: {name}')
            seen.add(name)
            require(member.isdir() or member.isfile(), f'unsupported archive entry: {name}')
            require('.DS_Store' not in p.parts and '__MACOSX' not in p.parts, f'template debris: {name}')
            modes[name] = member.mode
            if member.isdir():
                dirs.add(name)
            else:
                files[name] = tar.extractfile(member).read()
    return files, modes, dirs


def validate(files, modes, dirs, app):
    for directory in ('cmd', 'config', 'wizard'):
        require(directory in dirs, f'missing directory: {directory}')
    for name in ('manifest', 'config/privilege', 'config/resource', 'ICON.PNG', 'ICON_256.PNG'):
        require(name in files, f'missing file: {name}')
    manifest = manifest_values(files['manifest'])
    expected = manifest_values((ROOT / 'fnos/manifest').read_bytes())
    for key, value in expected.items():
        require(manifest.get(key) == value, f'manifest mismatch: {key}')
    require(manifest['version'] == json.loads((ROOT / 'package.json').read_text())['version'], 'version mismatch')
    privilege = json.loads(files['config/privilege'])
    require(privilege == json.loads((ROOT / 'fnos/config/privilege').read_text()), 'unexpected privilege configuration')
    require(privilege['defaults']['run-as'] == 'package', 'must use dedicated package user')
    require(json.loads(files['config/resource']) == {}, 'unexpected resources or broad grants')
    for hook in HOOKS:
        name = f'cmd/{hook}'
        require(name in files, f'missing lifecycle script: {name}')
        require(modes[name] & 0o111 and not modes[name] & 0o022, f'invalid executable permissions: {name}')
        require(files[name].startswith(b'#!/bin/bash\n') and b'\r' not in files[name], f'invalid shebang/LF: {name}')
        require(files[name] == (ROOT / 'fnos' / name).read_bytes(), f'lifecycle content mismatch: {name}')
    entry = json.loads(app['ui/config'])['.url'][manifest['desktop_applaunchname']]
    require(entry['gatewayPrefix'] == '/app/fn-dit' and entry['gatewaySocket'] == 'app.sock', 'gateway mismatch')
    require(entry['allUsers'] is False, 'entry must be administrator only')
    for size in (64, 256):
        icon = files['ICON.PNG' if size == 64 else 'ICON_256.PNG']
        desktop = app[f'ui/images/icon_{size}.png']
        require(icon == desktop, 'package/desktop icon mismatch')
        require(icon.startswith(b'\x89PNG\r\n\x1a\n') and struct.unpack('>II', icon[16:24]) == (size, size), 'invalid PNG dimensions')
        require(len(icon) <= 1024 * 1024, 'icon too large')
    for source in (ROOT / 'app').rglob('*'):
        if source.is_file():
            name = 'server/' + source.relative_to(ROOT / 'app').as_posix()
            require(app.get(name) == source.read_bytes(), f'missing/stale application source: {name}')
    return manifest


def inspect(package):
    data = Path(package).read_bytes()
    files, modes, dirs = archive(data)
    require('app.tgz' in files, 'missing app.tgz')
    app, _, _ = archive(files['app.tgz'])
    manifest = validate(files, modes, dirs, app)
    checksum = hashlib.md5(files['app.tgz']).hexdigest()
    require(manifest.get('checksum') == checksum, 'app.tgz checksum mismatch')
    return {'appname': manifest['appname'], 'version': manifest['version'],
            'platform': manifest['platform'], 'os_min_version': manifest['os_min_version'],
            'sha256': hashlib.sha256(data).hexdigest(), 'app_md5': checksum,
            'outer_entries': sorted(files), 'payload_files': sorted(app),
            'lifecycle_mode': {name: oct(modes['cmd/' + name]) for name in HOOKS},
            'note': 'Structure verified; fnOS installation and USB/ACL/gateway behavior not verified.'}


def stage(directory):
    root = Path(directory)
    files, app, modes, dirs = {}, {}, {}, set()
    for p in root.rglob('*'):
        name = p.relative_to(root).as_posix()
        if p.is_dir():
            dirs.add(name)
        else:
            modes[name] = p.stat().st_mode & 0o777
            if name.startswith('app/'):
                app[name[4:]] = p.read_bytes()
            else:
                files[name] = p.read_bytes()
    return validate(files, modes, dirs, app)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('package', nargs='?')
    parser.add_argument('--stage')
    args = parser.parse_args()
    if args.stage:
        print(json.dumps(stage(args.stage), ensure_ascii=False, indent=2))
    elif args.package:
        print(json.dumps(inspect(args.package), ensure_ascii=False, indent=2))
    else:
        parser.error('package or --stage is required')
