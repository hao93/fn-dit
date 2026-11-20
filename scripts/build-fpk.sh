#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="${PROJECT_DIR}/.build/fn-dit"

if ! command -v fnpack >/dev/null 2>&1; then
  echo '未检测到官方 fnpack。请先从飞牛开发者平台安装 fnpack，然后重新执行。'
  exit 2
fi

cd "$PROJECT_DIR"
node --test tests/*.test.js
mkdir -p "${PROJECT_DIR}/.build"
if [ ! -d "$STAGE_DIR" ]; then
  (cd "${PROJECT_DIR}/.build" && fnpack create fn-dit)
fi
mkdir -p "$STAGE_DIR/app/server" "$STAGE_DIR/app/ui/images"
cp -R app/lib app/ui "$STAGE_DIR/app/server/"
cp app/server.js "$STAGE_DIR/app/server/"
cp fnos/manifest "$STAGE_DIR/manifest"
cp -R fnos/cmd fnos/config "$STAGE_DIR/"
cp fnos/ui/config "$STAGE_DIR/app/ui/config"
cp fnos/ICON.PNG fnos/ICON_256.PNG "$STAGE_DIR/"
cp fnos/ui/images/icon_64.png fnos/ui/images/icon_256.png "$STAGE_DIR/app/ui/images/"
chmod +x "$STAGE_DIR/cmd/main"
cd "$STAGE_DIR"
fnpack build
echo '完成。请检查 fnpack 输出的 fn-dit.fpk，并先在测试机验证 USB/SD 权限。'
