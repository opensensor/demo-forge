#!/usr/bin/env bash
# Installs the local Kokoro TTS backend (venv + model files) used for narration.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
[ -d .venv ] || uv venv -q --python 3.12 .venv
uv pip install -q --python .venv/bin/python kokoro-onnx soundfile
mkdir -p models
REL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  [ -f "models/$f" ] || curl -sSL -o "models/$f" "$REL/$f"
done
chmod +x kokoro
echo "Kokoro ready: export DEMOFORGE_KOKORO_BIN=$DIR/kokoro DEMOFORGE_KOKORO_MODEL=$DIR/models/kokoro-v1.0.onnx"
