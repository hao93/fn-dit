#!/usr/bin/env bash
# Test packages also use official fnpack; never handcraft FPK archives.
set -euo pipefail
export FPK_DEBUG_UNSIGNED=1
exec bash "$(dirname "${BASH_SOURCE[0]}")/build-fpk.sh"
