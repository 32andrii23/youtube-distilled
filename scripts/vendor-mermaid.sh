#!/bin/zsh

# Refreshes extension/vendor/mermaid.min.js from node_modules.
#
# The panel loads as an unpacked folder with no build step, and MV3 forbids
# pulling a script off a CDN, so mermaid's own prebuilt bundle is committed
# instead. Run this after bumping mermaid in package.json.

set -e

APP_ROOT="${0:A:h:h}"
SOURCE="$APP_ROOT/node_modules/mermaid/dist/mermaid.min.js"
TARGET="$APP_ROOT/extension/vendor/mermaid.min.js"

if [[ ! -f "$SOURCE" ]]; then
  echo "mermaid is not installed. Run npm install first."
  exit 1
fi

mkdir -p "${TARGET:h}"
cp "$SOURCE" "$TARGET"

VERSION=$(node -p "require('$APP_ROOT/node_modules/mermaid/package.json').version")
echo "Vendored mermaid $VERSION into extension/vendor/mermaid.min.js"
