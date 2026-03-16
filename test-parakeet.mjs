/**
 * Test: Parakeet STT — upload + polling su /status
 *
 * Workflow:
 *   1. POST il file (ignora 504 dal proxy)
 *   2. Poll /status per seguire avanzamento con % basata sui chunk
 *   3. Quando torna idle, il testo parziale accumulato è il risultato
 */
import { readFileSync, writeFileSync, statSync } from "fs";
import { basename } from "path";

const API_URL = "https://parakeet.local.smarthomeformyhouse.loan";
const MODEL = "istupakov/parakeet-tdt-0.6b-v3-onnx";
const TEST_FILE = "../test/file/2026-03-13 11-37-14.mkv";
const POLL_INTERVAL = 3000; // ms

// Disabilita verifica SSL per certificati self-signed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("=== Test: Parakeet STT (upload + polling) ===\n");

// Step 0: verifica connettività
console.log("0) GET /status ...");
try {
  const res = await fetch(`${API_URL}/status`);
  const text = await res.text();
  console.log(`   ${res.status} — ${text.slice(0, 300)}`);
} catch (e) {
  console.log(`   ERRORE: ${e.message}`);
  process.exit(1);
}

// Step 1: upload file
const fileBuffer = readFileSync(TEST_FILE);
const fileSizeMB = (statSync(TEST_FILE).size / 1024 / 1024).toFixed(1);
const fileName = basename(TEST_FILE);
console.log(`\n1) Upload file (${fileSizeMB} MB) ...`);

const formData = new FormData();
formData.append("file", new Blob([fileBuffer], { type: "video/matroska" }), fileName);
formData.append("model", MODEL);
formData.append("response_format", "verbose_json");

// Upload in background (senza await) — il polling parte subito
const uploadPromise = fetch(`${API_URL}/v1/audio/transcriptions`, {
  method: "POST",
  headers: { Accept: "application/json" },
  body: formData,
})
  .then((res) => console.log(`   Upload response: ${res.status}`))
  .catch((e) => console.log(`   Upload terminato con: ${e.message} (atteso se il proxy chiude)`));

// Step 2: polling — durante upload mostra "uploading", poi progresso trascrizione
console.log(`\n2) Polling /status ogni ${POLL_INTERVAL / 1000}s ...\n`);
let finalText = "";
let totalChunks = null;
let prevChunk = -1;
let jobSeen = false;

while (true) {
  await sleep(POLL_INTERVAL);
  try {
    const res = await fetch(`${API_URL}/status`);
    const data = await res.json();

    const status = data.status || "";
    const jobId = data.job_id || "";
    const chunk = data.current_chunk || 0;
    const partial = data.partial_text || "";
    const total = data.total_chunks || null;

    if (jobId) jobSeen = true;

    // Fase upload — server ancora idle, file in transito
    if (status === "idle" && !jobId && !jobSeen) {
      console.log("   Uploading ...");
      continue;
    }

    // Server idle dopo aver visto un job = trascrizione finita
    if (status === "idle" && !jobId && jobSeen) {
      console.log("\n   Trascrizione completata!\n");
      break;
    }

    // Stima percentuale basata sui chunk
    if (total) totalChunks = total;
    let progress;
    if (totalChunks && totalChunks > 0) {
      const pct = (chunk / totalChunks) * 100;
      const barLen = 30;
      const filled = Math.floor((barLen * chunk) / totalChunks);
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);
      progress = `[${bar}] ${pct.toFixed(0)}% (chunk ${chunk}/${totalChunks})`;
    } else {
      progress = `chunk ${chunk}`;
    }

    // Mostra solo se c'è un avanzamento
    if (chunk !== prevChunk) {
      const preview = partial.length > 120 ? partial.slice(-120) : partial;
      console.log(`   ${progress}`);
      console.log(`   ...${preview}\n`);
      prevChunk = chunk;
    }

    finalText = partial;
  } catch (e) {
    console.log(`   Errore polling: ${e.message}`);
  }
}

// Aspetta che la promise dell'upload si risolva (probabilmente già fatto)
await uploadPromise;

// Step 3: salva risultato su file
const outputFile = fileName.replace(/\.[^.]+$/, ".txt");
console.log(`3) Salvataggio risultato in ${outputFile} ...`);
if (finalText) {
  writeFileSync(outputFile, finalText, "utf-8");
  console.log(`   Salvato (${finalText.length} caratteri)`);
} else {
  console.log("   Nessun testo recuperato.");
}
