#!/bin/bash
# Builds Focus Screen as a normal Mac app in /Applications (Bek's copy), so it opens from the
# Dock or Spotlight with no Terminal window. Run it again any time to update to the latest code:
#   bash <(curl -fsSL https://raw.githubusercontent.com/bomonov/Focus_screen_dashboard/main/install-app.command)
set -e
DIR="$HOME/FocusScreen"
OUT="$HOME/Library/Developer/FocusScreen"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if [ ! -d "$DIR/.git" ]; then
  echo "Run setup-mac.command first (it installs the tools and downloads the code)."
  exit 1
fi
cd "$DIR"

echo "== 1/5 Latest code"
git pull --ff-only
npm install
[ -f node_modules/electron/path.txt ] || node node_modules/electron/install.js

echo "== 2/5 Mac helpers"
sh native/mac-reminders/build.sh 2>/dev/null || FOCUS_SCREEN_ARCHS="--arch $(uname -m)" sh native/mac-reminders/build.sh
# The audio helper only times plain lyrics (an optional add-on); the app runs fine without it.
(sh native/mac-audio/build.sh 2>/dev/null || FOCUS_SCREEN_ARCHS="--arch $(uname -m)" sh native/mac-audio/build.sh) \
  || echo "(Skipped the optional audio helper.)"

echo "== 3/5 Browser extension"
npm run build:extension

echo "== 4/5 Building Focus Screen.app (a few minutes)"
npm run build
rm -rf "$OUT/dist"
# No Apple developer certificate here, so electron-builder skips signing and the app is signed
# "ad hoc" below: fine for this Mac, which is the only one it runs on.
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir \
  -c.mac.identity=null -c.directories.output="$OUT/dist"
BUILT="$(ls -d "$OUT"/dist/mac*/"Focus Screen.app" | head -1)"
codesign --force --deep --sign - --entitlements build/entitlements.mac.plist "$BUILT"

echo "== 5/5 Installing to /Applications"
node scripts/install-mac.mjs --skip-build
# The old Terminal launcher isn't needed any more.
rm -f "$HOME/Desktop/Focus Screen.command"

echo
echo "Done. Open Focus Screen from Applications, Launchpad or Spotlight."
echo "To keep it in the Dock: right-click its Dock icon > Options > Keep in Dock."
echo "To start it with your Mac: System Settings > General > Login Items > + > Focus Screen."
