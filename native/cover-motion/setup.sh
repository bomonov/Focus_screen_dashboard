#!/bin/sh
# Installs the moving cover parts' runtime: a Python 3.12 environment with PyTorch and OpenCV, and
# SAM 2.1 (facebook/sam2.1-hiera-base-plus, ~320 MB) to cut parts out of covers.
#
#   sh native/cover-motion/setup.sh [runtime dir]
#
# The default, ~/Library/Application Support/Focus Screen/cover-motion, is where the app looks.
# It's outside ~/Desktop on purpose: iCloud would sync gigabytes of it.
set -e
RUNTIME="${1:-$HOME/Library/Application Support/Focus Screen/cover-motion}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${FOCUS_SCREEN_PYTHON:-$(command -v python3.12 || true)}"
if [ -z "$PYTHON" ]; then
  echo "Python 3.12 is needed (e.g. brew install python@3.12)." >&2
  exit 1
fi
mkdir -p "$RUNTIME/models"
if command -v uv >/dev/null 2>&1; then
  uv venv --python "$PYTHON" "$RUNTIME/.venv"
  uv pip install --python "$RUNTIME/.venv/bin/python" -r "$HERE/requirements.txt"
else
  "$PYTHON" -m venv "$RUNTIME/.venv"
  "$RUNTIME/.venv/bin/pip" install -r "$HERE/requirements.txt"
fi
"$RUNTIME/.venv/bin/python" "$HERE/fetch_models.py" "$RUNTIME/models"
echo "Moving cover parts are installed in $RUNTIME"
