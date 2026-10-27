#!/bin/bash
# 兼容旧入口；默认应用图标由玫瑰金 PNG 原图生成。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun run "$SCRIPT_DIR/../scripts/generate-icons.ts"
