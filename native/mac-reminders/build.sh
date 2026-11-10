#!/bin/sh
# Builds "Focus Screen Reminders.app", the Reminders helper (Apple silicon + Intel), and signs it.
#
#   sh native/mac-reminders/build.sh [output dir]
#
# The default output, ~/Library/Developer/FocusScreen, is where `npm run dev` runs it from and
# where `npm run build:mac` packs it from. The helper asks macOS for access as itself, so run
# from inside ~/Desktop it would also have to ask for the Desktop folder, and codesign refuses
# the Finder attributes iCloud puts on files there.
#
# macOS remembers Reminders access by the helper's signature. An Apple Development certificate
# keeps that the same across rebuilds; without one the helper is signed ad hoc, and every
# rebuild asks for access again. Set FOCUS_SCREEN_SIGN_IDENTITY to pick a certificate.
set -e
OUT="${1:-$HOME/Library/Developer/FocusScreen}"
case "$OUT" in /*) ;; *) OUT="$(pwd)/$OUT" ;; esac
cd "$(dirname "$0")"
HERE="$(pwd)"
APP="$OUT/Focus Screen Reminders.app"

ARCHS="--arch arm64 --arch x86_64"
swift build -c release $ARCHS
BIN_DIR="$(swift build -c release $ARCHS --show-bin-path)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/focus-screen-reminders" "$APP/Contents/MacOS/"
cp "$HERE/Info.plist" "$APP/Contents/"
cp "$HERE/../../build/icon.icns" "$APP/Contents/Resources/icon.icns"

IDENTITY="${FOCUS_SCREEN_SIGN_IDENTITY:-$(security find-identity -v -p codesigning |
  awk -F'"' '/Apple Development/ { print $2; exit }')}"
# Hardened runtime, as in the packaged app, so dev runs into the same permission rules. Under
# it, calendar mode needs the calendars entitlement or macOS never shows its prompt.
codesign --force --timestamp=none --options runtime --entitlements "$HERE/entitlements.plist" \
  --sign "${IDENTITY:--}" "$APP"
echo "Built $APP"
