#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FNPACK="${FNPACK:-fnpack}"
command -v "$FNPACK" >/dev/null || { echo '请安装官方 fnpack。' >&2; exit 2; }
[[ "$(uname -s)" == Linux ]] || { echo '请在 Linux 或 GitHub Actions 构建以保留执行权限。' >&2; exit 2; }
cd "$PROJECT_DIR"
node --test tests/*.test.js
BUILD_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$BUILD_ROOT"' EXIT
STAGE_DIR="$BUILD_ROOT/fn-dit"
mkdir -p "$STAGE_DIR/app/server" "$STAGE_DIR/app/ui" "$STAGE_DIR/wizard" "$PROJECT_DIR/dist"
cp -R app/lib app/ui "$STAGE_DIR/app/server/"
cp app/server.js "$STAGE_DIR/app/server/"
cp fnos/manifest "$STAGE_DIR/manifest"
cp -R fnos/cmd fnos/config "$STAGE_DIR/"
cp fnos/ui/config "$STAGE_DIR/app/ui/config"
cp -R fnos/ui/images "$STAGE_DIR/app/ui/"
cp fnos/ICON.PNG fnos/ICON_256.PNG "$STAGE_DIR/"
find "$STAGE_DIR" -type d -exec chmod 755 {} +
find "$STAGE_DIR" -type f -exec chmod 644 {} +
chmod 755 "$STAGE_DIR"/cmd/*
python3 scripts/inspect-fpk.py --stage "$STAGE_DIR"
VERSION="$(node -p 'require("./package.json").version')"
PACK_ARGS=()
SUFFIX=''
if [[ "${FPK_UNSIGNED:-0}" == 1 ]]; then
  PACK_ARGS+=(--nosign)
  SUFFIX='-unsigned'
elif [[ "${FPK_DEBUG_UNSIGNED:-0}" == 1 ]]; then
  PACK_ARGS+=(--nosign)
  SUFFIX='-unsigned-test'
fi
(cd "$BUILD_ROOT" && "$FNPACK" build --directory "$STAGE_DIR" "${PACK_ARGS[@]}")
OUTPUT="$PROJECT_DIR/dist/fn-dit-${VERSION}${SUFFIX}.fpk"
test -s "$BUILD_ROOT/fn-dit.fpk"
python3 scripts/inspect-fpk.py "$BUILD_ROOT/fn-dit.fpk"
cp "$BUILD_ROOT/fn-dit.fpk" "$OUTPUT"
python3 scripts/inspect-fpk.py "$OUTPUT" > "${OUTPUT}.audit.json"
(cd "$PROJECT_DIR/dist" && sha256sum "$(basename "$OUTPUT")" > "$(basename "$OUTPUT").sha256")
printf 'FPK: %s\n' "$OUTPUT"
