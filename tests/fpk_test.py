"""Regression checks against a real fnpack output, including corrupt packages."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('inspect_fpk', Path(__file__).resolve().parents[1] / 'scripts/inspect-fpk.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
PACKAGE = Path(sys.argv.pop(1))


def mutate(destination, change):
    with tarfile.open(PACKAGE, 'r:gz') as src, tarfile.open(destination, 'w:gz') as dst:
        for member in src:
            data = src.extractfile(member).read() if member.isfile() else None
            member, data = change(member, data)
            if member is not None:
                if data is not None:
                    member.size = len(data)
                dst.addfile(member, io.BytesIO(data) if data is not None else None)


class PackageRegression(unittest.TestCase):
    def test_official_output(self):
        version=json.loads((audit.ROOT / 'package.json').read_text())['version']
        self.assertEqual(audit.inspect(PACKAGE)['version'], version)

    def reject_mutation(self, change, message):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / 'bad.fpk'
            mutate(bad, change)
            with self.assertRaisesRegex(ValueError, message):
                audit.inspect(bad)

    def test_missing_install_hook(self):
        self.reject_mutation(lambda m, d: (None, None) if m.name == 'cmd/install_init' else (m, d), 'missing lifecycle')

    def test_nonexecutable_main(self):
        def change(m, d):
            if m.name == 'cmd/main':
                m.mode = 0o644
            return m, d
        self.reject_mutation(change, 'executable permissions')

    def test_incorrect_payload_checksum(self):
        def change(m, d):
            if m.name == 'manifest':
                lines = d.decode().splitlines()
                d = ('\n'.join('checksum = ' + '0' * 32 if line.strip().startswith('checksum') else line for line in lines) + '\n').encode()
            return m, d
        self.reject_mutation(change, 'checksum mismatch')

    def test_old_manual_archive_paths(self):
        def change(m, d):
            m.name = './' + m.name
            return m, d
        self.reject_mutation(change, 'noncanonical archive path')


if __name__ == '__main__':
    unittest.main()
