#!/bin/bash
# 兼容旧入口；从机械芯片矢量源生成应用图标。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun run "$SCRIPT_DIR/../scripts/generate-icons.ts"
