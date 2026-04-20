"""
Test diagnostico Parakeet STT: upload + polling /status ad alta frequenza.

Scopo: capire dove sparisce l'ultimo chunk.
  - Polla /status ogni 0.5s e logga ogni cambio di `partial_text`/`current_chunk`.
  - Dopo che il server torna a idle, continua a pollare per 10s per vedere
    se `partial_text` cambia (server che finisce di scrivere dopo idle).
  - Tenta anche di leggere la response del POST (potrebbe contenere
    il testo completo se il proxy non ha fatto 504).
  - Salva ogni snapshot di `partial_text` in file distinti per confronto.

Uso:
  python test-parakeet.py <file.mkv|mp4|...>

Prerequisiti:
  pip install requests urllib3
"""

import json
import os
import sys
import threading
import time
from pathlib import Path

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─── Config ────────────────────────────────────────────────────────────────
API_URL = "https://parakeet.local.smarthomeformyhouse.loan"
MODEL = "istupakov/parakeet-tdt-0.6b-v3-onnx"
POLL_INTERVAL_S = 0.5          # aggressivo, per non perdere transizioni
POST_IDLE_POLL_DURATION_S = 10 # continua a pollare dopo idle per vedere se cambia
OUT_DIR = Path("parakeet-debug")

# ─── Helpers ───────────────────────────────────────────────────────────────
def ts() -> str:
    return time.strftime("%H:%M:%S") + f".{int((time.time() % 1) * 1000):03d}"

def content_type_for(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".mkv": "video/x-matroska",
        ".mp4": "video/mp4",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".webm": "video/webm",
    }.get(ext, "application/octet-stream")

def save_snapshot(label: str, text: str) -> None:
    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"{label}.txt"
    path.write_text(text, encoding="utf-8")
    print(f"   [saved {len(text)} chars → {path}]")

# ─── Upload (thread separato) ──────────────────────────────────────────────
post_result = {"status": None, "body": None, "error": None, "done_at": None}

def do_upload(file_path: Path) -> None:
    print(f"[{ts()}] POST /v1/audio/transcriptions ...")
    files = {
        "file": (file_path.name, file_path.read_bytes(), content_type_for(file_path)),
    }
    data = {"model": MODEL, "response_format": "verbose_json"}
    try:
        r = requests.post(
            f"{API_URL}/v1/audio/transcriptions",
            files=files,
            data=data,
            headers={"Accept": "application/json"},
            verify=False,
            timeout=(10, 900),  # (connect, read)
        )
        post_result["status"] = r.status_code
        post_result["body"] = r.text
        post_result["done_at"] = ts()
        print(f"[{ts()}] POST response: {r.status_code} (body {len(r.text)} chars)")
    except Exception as e:
        post_result["error"] = str(e)
        post_result["done_at"] = ts()
        print(f"[{ts()}] POST terminato con eccezione: {e}")

# ─── Polling ───────────────────────────────────────────────────────────────
def poll_status() -> dict:
    r = requests.get(f"{API_URL}/status", verify=False, timeout=10)
    return r.json()

def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python test-parakeet.py <audio-file>")
        sys.exit(1)
    file_path = Path(sys.argv[1])
    if not file_path.exists():
        print(f"File non trovato: {file_path}")
        sys.exit(1)

    size_mb = file_path.stat().st_size / 1024 / 1024
    print(f"File: {file_path.name} ({size_mb:.1f} MB)")
    print(f"Poll interval: {POLL_INTERVAL_S}s")
    print(f"Post-idle poll duration: {POST_IDLE_POLL_DURATION_S}s\n")

    # Avvio upload in background
    upload_thread = threading.Thread(target=do_upload, args=(file_path,), daemon=True)
    upload_thread.start()

    # ── Fase 1: polling durante la trascrizione ──
    last_partial_len = -1
    last_chunk = -1
    job_seen = False
    final_text = ""
    all_snapshots = []  # (ts, chunk, partial) history

    idle_after_job_at = None

    while True:
        time.sleep(POLL_INTERVAL_S)
        try:
            data = poll_status()
        except Exception as e:
            print(f"[{ts()}] poll error: {e}")
            continue

        status = data.get("status") or ""
        job_id = data.get("job_id") or ""
        chunk = data.get("current_chunk") or 0
        total = data.get("total_chunks") or 0
        partial = data.get("partial_text") or ""

        if job_id:
            job_seen = True

        # Log solo se qualcosa è cambiato
        changed = (chunk != last_chunk) or (len(partial) != last_partial_len)
        if changed:
            print(
                f"[{ts()}] status={status!r:14} job={bool(job_id):d} "
                f"chunk={chunk}/{total} partial_len={len(partial)}"
            )
            if partial and len(partial) != last_partial_len:
                # Salva snapshot quando partial cambia dimensione
                label = f"{len(all_snapshots):02d}_chunk{chunk}of{total}_len{len(partial)}"
                all_snapshots.append((ts(), chunk, total, partial))
            last_chunk = chunk
            last_partial_len = len(partial)

        if partial:
            final_text = partial

        # Upload ancora in corso → server idle, nessun job
        if status == "idle" and not job_id and not job_seen:
            continue

        # Fine: idle dopo aver visto un job
        if status == "idle" and not job_id and job_seen:
            if idle_after_job_at is None:
                idle_after_job_at = time.time()
                print(f"\n[{ts()}] >>> Server tornato idle dopo job visto.")
                print(f"[{ts()}] >>> Continuo a pollare per {POST_IDLE_POLL_DURATION_S}s per vedere se partial_text cambia...\n")
            elif time.time() - idle_after_job_at > POST_IDLE_POLL_DURATION_S:
                break

    # Aspetta la fine dell'upload
    print(f"\n[{ts()}] Attendo fine upload thread ...")
    upload_thread.join(timeout=30)

    # ── Report finale ──
    print("\n" + "=" * 70)
    print("REPORT")
    print("=" * 70)
    print(f"Snapshot di partial_text catturati: {len(all_snapshots)}")
    for i, (tstamp, c, t, p) in enumerate(all_snapshots):
        print(f"  {i:02d}  {tstamp}  chunk {c}/{t}  len={len(p)}")
        label = f"snapshot_{i:02d}_chunk{c}of{t}_len{len(p)}"
        save_snapshot(label, p)

    print(f"\nfinal_text da polling: {len(final_text)} caratteri")
    save_snapshot("FINAL_from_polling", final_text)

    # POST response
    print(f"\nPOST response: status={post_result['status']} error={post_result['error']}")
    if post_result["body"]:
        body = post_result["body"]
        print(f"POST body: {len(body)} chars")
        try:
            parsed = json.loads(body)
            post_text = parsed.get("text", "")
            print(f"POST 'text' field: {len(post_text)} caratteri")
            save_snapshot("FINAL_from_POST_text", post_text)
            save_snapshot("FINAL_from_POST_raw_json", json.dumps(parsed, indent=2, ensure_ascii=False))

            # Confronto
            if post_text and final_text:
                if post_text == final_text:
                    print("\n✓ POST text == polling final_text (identici)")
                elif post_text.startswith(final_text):
                    diff = post_text[len(final_text):]
                    print(f"\n⚠ POST text è PIÙ LUNGO di final_text di {len(diff)} caratteri")
                    print(f"   Coda mancante dal polling: {diff[:200]!r}")
                elif final_text.startswith(post_text):
                    print(f"\n⚠ polling final_text è più lungo di POST text (strano)")
                else:
                    print(f"\n⚠ POST text e polling final_text divergono")
                    print(f"   POST len={len(post_text)} polling len={len(final_text)}")
        except json.JSONDecodeError:
            print(f"POST body non è JSON — primi 500 char:\n{body[:500]}")
            save_snapshot("FINAL_from_POST_raw_body", body)

    print("\nFile salvati in:", OUT_DIR.resolve())


if __name__ == "__main__":
    main()
