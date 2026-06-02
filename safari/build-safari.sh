#!/usr/bin/env bash
# build-safari.sh — convert this extension into a Safari Web Extension Xcode project.
#
# Requirements:
#   - macOS
#   - Xcode installed from the Mac App Store (free, ~10 GB)
#   - Xcode command-line tools (the converter ships with them):
#       xcode-select --install
#
# Usage:
#   cd safari
#   ./build-safari.sh
#
# After this script finishes, an Xcode project will exist in safari/build/.
# Open it in Xcode and press the Run button (▶) once to build + install the
# host app. Then follow the Safari steps in ../README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SCRIPT_DIR/build"
APP_NAME="LinkedInProfileTracker"
BUNDLE_ID="dev.local.linkedinprofiletracker"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found. Install Xcode and Xcode command-line tools." >&2
  echo "       xcode-select --install" >&2
  exit 1
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "error: safari-web-extension-converter not available." >&2
  echo "       Make sure Xcode (full IDE, not just the CLT) is installed and that you have" >&2
  echo "       opened it at least once to accept the license:  sudo xcodebuild -license accept" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo ">> Converting Chrome extension at $REPO_ROOT into a Safari Web Extension project at $OUT_DIR ..."

# --no-prompt: don't ask interactive questions
# --copy-resources: physically copy files into the Xcode project (so the project
#                   is self-contained and survives if this script is re-run)
# --macos-only: skip iOS targets (LinkedIn web scraping doesn't make sense on iOS)
xcrun safari-web-extension-converter "$REPO_ROOT" \
  --project-location "$OUT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --no-prompt \
  --copy-resources \
  --macos-only

PROJECT_PATH="$OUT_DIR/$APP_NAME/$APP_NAME.xcodeproj"
if [[ -d "$PROJECT_PATH" ]]; then
  echo ""
  echo "Done."
  echo ""
  echo "Next steps:"
  echo "  1. open \"$PROJECT_PATH\""
  echo "  2. In Xcode, press the Run button (▶)."
  echo "  3. A small host app will launch; quit it."
  echo "  4. Open Safari → Settings → Extensions → enable LinkedIn Profile Tracker."
  echo "  5. (If needed) Safari → Develop menu → 'Allow Unsigned Extensions'."
  echo ""
  echo "See ../README.md for the full Safari install walkthrough."
else
  echo "warning: converter ran but expected project not found at $PROJECT_PATH" >&2
  exit 1
fi
