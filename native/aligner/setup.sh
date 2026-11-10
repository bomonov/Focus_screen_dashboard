#!/bin/sh
# Installs the lyrics aligner's runtime: a Python 3.12 environment, the CTC alignment models for
# English and Japanese (~1.65 GB download, ~1.6 GB on disk) and the Whisper large-v3-turbo model
# for everything else (~1.6 GB download, ~1.5 GB on disk).
#
#   sh native/aligner/setup.sh [runtime dir]
#
# The default, ~/Library/Application Support/Focus Screen/aligner, is where the app looks.
# It's outside ~/Desktop on purpose: iCloud would sync gigabytes of it.
set -e
RUNTIME="${1:-$HOME/Library/Application Support/Focus Screen/aligner}"
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
"$RUNTIME/.venv/bin/python" -c "
import sys, whisper
whisper.load_model('large-v3-turbo', device='cpu', download_root=sys.argv[1])
" "$RUNTIME/models"
"$RUNTIME/.venv/bin/python" "$HERE/fetch_models.py" "$RUNTIME/models"
echo "Aligner ready in $RUNTIME"
