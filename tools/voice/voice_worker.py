"""DemoForge voice worker — local voice cloning (Chatterbox) and transcription.

Commands:
  serve                 Long-lived synthesis worker. Reads JSON lines on stdin:
                          {"id": 1, "text": "...", "ref": "reference.wav", "out": "line.wav",
                           "exaggeration": 0.5, "cfg_weight": 0.5}
                        and answers each with one JSON line on stdout:
                          {"id": 1, "ok": true, "duration_ms": 2310}  or  {"id": 1, "ok": false, "error": "..."}
                        The model loads once, on the first request.
  transcribe WAV        Print {"text": ..., "segments": [{"start", "end", "text"}]} as JSON.

Everything runs locally; nothing is uploaded. Chatterbox embeds an inaudible
watermark in everything it generates.
"""

import json
import sys


def _log(message: str) -> None:
    print(f"[voice-worker] {message}", file=sys.stderr, flush=True)


def serve() -> int:
    import soundfile as sf
    import torch

    model = None
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        request = json.loads(raw)
        try:
            if model is None:
                from chatterbox.tts import ChatterboxTTS

                device = "cuda" if torch.cuda.is_available() else "cpu"
                _log(f"loading Chatterbox on {device}")
                model = ChatterboxTTS.from_pretrained(device=device)
            wav = model.generate(
                request["text"],
                audio_prompt_path=request["ref"],
                exaggeration=float(request.get("exaggeration", 0.5)),
                cfg_weight=float(request.get("cfg_weight", 0.5)),
            )
            samples = wav.squeeze(0).detach().cpu().numpy()
            sf.write(request["out"], samples, model.sr, subtype="PCM_16")
            reply = {"id": request["id"], "ok": True, "duration_ms": round(len(samples) / model.sr * 1000)}
        except Exception as exc:  # report, keep serving
            reply = {"id": request.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        print(json.dumps(reply), flush=True)
    return 0


def transcribe(path: str) -> int:
    from faster_whisper import WhisperModel

    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(path, beam_size=5, vad_filter=True)
    out = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
    print(json.dumps({"text": " ".join(s["text"] for s in out), "segments": out}))
    return 0


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "serve":
        return serve()
    if len(sys.argv) >= 3 and sys.argv[1] == "transcribe":
        return transcribe(sys.argv[2])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
