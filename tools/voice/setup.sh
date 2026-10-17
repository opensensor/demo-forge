#!/usr/bin/env bash
# Installs the local voice-cloning toolchain (Chatterbox + faster-whisper) used by
# `demoforge voice`. Needs an NVIDIA GPU for reasonable speed (CPU works, slowly).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
[ -d .venv ] || uv venv -q --python 3.11 .venv
# overrides.txt lifts chatterbox-tts's torch 2.6 pin to a CUDA 12.8 build (Blackwell/sm_120);
# setuptools<81 keeps pkg_resources, which the Perth watermarker still imports.
uv pip install -q --python .venv/bin/python --index-strategy unsafe-best-match \
  --extra-index-url https://download.pytorch.org/whl/cu128 --override overrides.txt \
  chatterbox-tts faster-whisper "setuptools<81"
echo "Voice toolchain ready ($DIR/.venv)."
