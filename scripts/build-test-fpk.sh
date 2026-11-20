#!/usr/bin/env bash
# Experimental double-tar FPK builder for development environments without fnpack.
# The result is NOT a substitute for fnpack validation or a real fnOS install test.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_STAGE="$(mktemp -d)"
trap 'rm -rf -- "$TEST_STAGE"' EXIT

cd "$PROJECT_DIR"
node --test tests/*.test.js

mkdir -p "$TEST_STAGE/app/server" "$TEST_STAGE/app/ui/images" "$TEST_STAGE/wizard" "$TEST_STAGE/cmd" "$TEST_STAGE/config" "$PROJECT_DIR/dist"
cp -R app/lib app/ui "$TEST_STAGE/app/server/"
cp app/server.js "$TEST_STAGE/app/server/"
cp fnos/ui/config "$TEST_STAGE/app/ui/config"
cp fnos/ui/images/icon_64.png fnos/ui/images/icon_256.png "$TEST_STAGE/app/ui/images/"
cp fnos/manifest "$TEST_STAGE/manifest"
cp fnos/cmd/main "$TEST_STAGE/cmd/main"
chmod +x "$TEST_STAGE/cmd/main"
cp fnos/config/privilege fnos/config/resource "$TEST_STAGE/config/"
cp fnos/ICON.PNG fnos/ICON_256.PNG "$TEST_STAGE/"

tar -czf "$TEST_STAGE/app.tgz" -C "$TEST_STAGE/app" .
CHECKSUM="$(md5sum "$TEST_STAGE/app.tgz" | cut -d' ' -f1)"
printf '\nchecksum = %s\n' "$CHECKSUM" >> "$TEST_STAGE/manifest"

rm -r -- "$TEST_STAGE/app"
OUTPUT="$PROJECT_DIR/dist/fn-dit-0.1.0-test.fpk"
tar -czf "$OUTPUT" -C "$TEST_STAGE" .

echo "Test FPK: $OUTPUT"
echo "Inner app.tgz MD5: $CHECKSUM"
echo '注意：此包尚未通过 fnpack 或飞牛真机安装验收，请仅用于测试。'
