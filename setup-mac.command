#!/bin/bash
# One-step setup for Focus Screen on a Mac (Bek's copy). Double-click it, or run:
#   bash setup-mac.command
# Safe to run again: it updates the code and rebuilds.
set -e
REPO="https://github.com/bomonov/Focus_screen_dashboard.git"
DIR="$HOME/FocusScreen"

echo "== 1/6 Apple Command Line Tools (git, swift)"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo "A window asked to install the Command Line Tools. Finish that, then run this again."
  exit 1
fi

echo "== 2/6 Node.js 24 or newer"
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 24 ] && need_node=0
fi
if [ $need_node -eq 1 ]; then
  if command -v brew >/dev/null 2>&1; then
    brew install node
  else
    ver=$(curl -fsSL https://nodejs.org/dist/index.json | /usr/bin/python3 -c 'import json,sys; print(next(r["version"] for r in json.load(sys.stdin) if r["version"].startswith("v24.")))')
    curl -fL -o /tmp/node.pkg "https://nodejs.org/dist/$ver/node-$ver.pkg"
    echo "Installing Node $ver (asks for your Mac password)"
    sudo installer -pkg /tmp/node.pkg -target /
  fi
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
fi
node -v

echo "== 3/6 Code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR"

echo "== 4/6 Packages"
npm install
# Some npm setups skip Electron's own download; fetch it if it's missing.
[ -f node_modules/electron/path.txt ] || node node_modules/electron/install.js

echo "== 5/6 Browser extension and the Mac helper (Calendar, Reminders, weather)"
npm run build:extension
sh native/mac-reminders/build.sh || FOCUS_SCREEN_ARCHS="--arch $(uname -m)" sh native/mac-reminders/build.sh

echo "== 6/6 Desktop launcher"
cat > "$HOME/Desktop/Focus Screen.command" <<LAUNCH
#!/bin/bash
cd "$DIR" && npm run dev
LAUNCH
chmod +x "$HOME/Desktop/Focus Screen.command"

echo
echo "Done. Next time, double-click 'Focus Screen' on your Desktop."
echo "Chrome extension folder: $DIR/extension/dist  (chrome://extensions > Developer mode > Load unpacked)"
open -R "$DIR/extension/dist"
npm run dev
