#!/usr/bin/env bash
set -euo pipefail

# 发行包与资源版本必须同时匹配。更新固定设计版本后，仅允许上游提供新快照。
seed_revision=7db9784ac4f4974d78ab166c7db1c706c0481c3d-whiteboard-e8793e7420d8e8da89cded75a7f2d59132916a52
seed_asset=Carpus-0.19.272-mac-arm64.zip
seed_sha256=955eebd0f475b362f9eb730f39a7347f720f88e0d217c3bf70f9e66bcf1ae1f4
revision=$(bun -e 'import { DESIGN_BUNDLE_REVISION } from "./packages/shared/src/types/design"; console.log(DESIGN_BUNDLE_REVISION)')
if [[ "$revision" != "$seed_revision" ]]; then
  echo "已发布的设计快照与当前构建版本不匹配：$revision" >&2
  exit 1
fi

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
archive="$temp_dir/$seed_asset"
gh release download v0.19.272 --repo xhslam/Carpus --pattern "$seed_asset" --output "$archive"
actual_sha256=$(bun -e 'import { digest } from "./apps/electron/scripts/release-artifacts"; console.log(await digest(process.argv[1], "sha256"))' "$archive")
if [[ "$actual_sha256" != "$seed_sha256" ]]; then
  echo "设计快照来源发行包的 SHA-256 不匹配" >&2
  exit 1
fi

bundle_path="Carpus.app/Contents/Resources/design-bundle/$revision"
if [[ "${RUNNER_OS:-}" == Windows ]]; then
  7z x "$(cygpath -w "$archive")" "-o$(cygpath -w "$temp_dir")" "$bundle_path/*"
else
  unzip -q "$archive" "$bundle_path/*" -d "$temp_dir"
fi
if [[ $(cat "$temp_dir/$bundle_path/.carpus-design-revision") != "$revision" ]]; then
  echo "发行包内的设计快照标记不匹配" >&2
  exit 1
fi
install_root=apps/electron/resources/design-bundle
mkdir -p "$install_root"
rm -rf "$install_root/$revision"
mv "$temp_dir/$bundle_path" "$install_root/$revision"
