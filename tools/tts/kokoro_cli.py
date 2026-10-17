"""Kokoro TTS command-line shim for DemoForge's KokoroBackend.

Reads text on stdin and writes a 24 kHz mono 16-bit WAV to stdout, matching
the contract the backend expects (--model/--voice/--speed/--output_raw).
The voices file is looked up next to the model unless --voices is given.
"""

import argparse
import io
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices")
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--lang", default="en-us")
    parser.add_argument("--output_raw", action="store_true")
    args = parser.parse_args()

    voices = args.voices or os.path.join(os.path.dirname(args.model), "voices-v1.0.bin")
    text = sys.stdin.read().strip()
    if not text:
        return 0

    kokoro = Kokoro(args.model, voices)
    samples, sample_rate = kokoro.create(text, voice=args.voice, speed=args.speed, lang=args.lang)

    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    sys.stdout.buffer.write(buf.getvalue())
    return 0


if __name__ == "__main__":
    sys.exit(main())
