#!/usr/bin/bash

set -eu

DIST_DIR="dist/"
CURRENT_DATE=$(date +%F)
TARGET_DIR="release/"

PLATFORM_FLAG=${1:-win}
case "$PLATFORM_FLAG" in
  ""|"win"|"linux"|"macos")
    PLATFORM="$PLATFORM_FLAG"
    ;;
  *)
    echo "unknown or unsupported platform: $1"
    exit 1
    ;;
esac


FILE_NAME="UNO-${CURRENT_DATE}_${PLATFORM}.zip"
FULL_PATH="${TARGET_DIR}${FILE_NAME}"

if [ -f "$FULL_PATH" ]; then
    rm "$FULL_PATH"
fi

if [ -d "$DIST_DIR" ]; then
    rm -rf "$DIST_DIR"
fi
mkdir -p "$DIST_DIR"

echo "build for $PLATFORM..."

if [ "$PLATFORM" = "win" ]; then
    # Windows 7 support
    outfile="${DIST_DIR}uno-server.exe"
    pkg . --targets node12-win-x64 --output "$outfile" --public

    # rcedit "$outfile" --set-version-string "LegalCopyright" "Copyright (C) 2026 miruku (lovemilk)"
else
    outfile="${DIST_DIR}uno-server"
    pkg . --targets "node12-${PLATFORM}-x64" --output "$outfile" --public
fi

mkdir -p "$TARGET_DIR"

zip "$FULL_PATH" -j "$outfile"

echo "released at \`$FULL_PATH\`"
