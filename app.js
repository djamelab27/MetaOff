import { createZip } from "./src/zip.js";
import { extensionForFormat, mimeForFormat } from "./src/image-metadata.js";

const MAX_FILES = 100;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const worker = new Worker("worker.js", { type: "module" });
const pending = new Map();
const items = [];
let nextItemId = 1;
let nextWorkerId = 1;

const $ = (id) => document.getElementById(id);
const dropZone = $("drop-zone");
const fileInput = $("file-input");
const batchPanel = $("batch-panel");
const resultPanel = $("result-panel");
const fileList = $("file-list");

worker.addEventListener("message", ({ data }) => {
  const request = pending.get(data.id);
  if (!request) return;
  pending.delete(data.id);
  if (data.ok) request.resolve(data.report || data.result);
  else request.reject(new Error(data.error || "The image could not be processed."));
});

function callWorker(action, buffer, options = {}) {
  const id = nextWorkerId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, buffer, options }, [buffer]);
  });
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

async function sha256(input) {
  const hash = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function outputName(item, used = new Set()) {
  const base = item.file.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "photo";
  const extension = extensionForFormat(item.report.format);
  let name = `${base}-clean.${extension}`;
  let suffix = 2;
  while (used.has(name.toLowerCase())) name = `${base}-clean-${suffix++}.${extension}`;
  used.add(name.toLowerCase());
  return name;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function setView(view) {
  dropZone.hidden = view !== "drop";
  batchPanel.hidden = view !== "batch";
  resultPanel.hidden = view !== "result";
}

function statusText(item) {
  if (item.status === "queued") return ["Queued", "working"];
  if (item.status === "scanning") return ["Scanning…", "working"];
  if (item.status === "cleaning") return ["Cleaning…", "working"];
  if (item.status === "error") return ["Could not read", "error"];
  if (item.status === "cleaned") return ["Verified clean", "clean"];
  if (!item.report?.findings.length) return ["No metadata found", "clean"];
  return [`${item.report.sensitiveCount || item.report.findings.length} signal${(item.report.sensitiveCount || item.report.findings.length) === 1 ? "" : "s"}`, "risk"];
}

function render() {
  const ready = items.filter((item) => item.status === "ready");
  const scanning = items.filter((item) => ["queued", "scanning"].includes(item.status)).length;
  const risks = ready.reduce((sum, item) => sum + item.report.sensitiveCount, 0);
  $("batch-title").textContent = `${items.length} photo${items.length === 1 ? "" : "s"}`;
  $("batch-summary").textContent = scanning
    ? `Scanning ${scanning} file${scanning === 1 ? "" : "s"} locally…`
    : risks ? `${risks} privacy signal${risks === 1 ? "" : "s"} worth removing.` : "No sensitive metadata was detected, but a clean copy can still be produced.";
  $("selection-stats").innerHTML = `<strong>${formatBytes(items.reduce((sum, item) => sum + item.file.size, 0))}</strong> in memory<br>${risks} sensitive signal${risks === 1 ? "" : "s"} detected`;
  $("clean-all").disabled = !ready.length || items.some((item) => ["queued", "scanning", "cleaning"].includes(item.status));
  fileList.replaceChildren(...items.map(renderItem));
}

function renderItem(item) {
  const card = document.createElement("article");
  card.className = "file-card";
  card.dataset.itemId = String(item.id);

  const image = document.createElement("img");
  image.className = "thumb";
  image.src = item.previewUrl;
  image.alt = "";

  const copy = document.createElement("div");
  copy.className = "file-copy";
  const name = document.createElement("p");
  name.className = "file-name";
  name.textContent = item.file.name;
  name.title = item.file.name;
  const meta = document.createElement("div");
  meta.className = "file-meta";
  const dimensions = item.report?.width && item.report?.height ? ` · ${item.report.width} × ${item.report.height}` : "";
  meta.textContent = item.error || `${formatBytes(item.file.size)}${dimensions}${item.report ? ` · ${item.report.format.toUpperCase()}` : ""}`;
  copy.append(name, meta);

  if (item.report?.findings.length) {
    const list = document.createElement("div");
    list.className = "finding-list";
    for (const entry of item.report.findings.slice(0, 5)) {
      const chip = document.createElement("span");
      chip.className = `finding-chip ${entry.sensitivity}`;
      chip.textContent = `${entry.label}: ${entry.value}`;
      chip.title = chip.textContent;
      list.append(chip);
    }
    if (item.report.findings.length > 5) {
      const more = document.createElement("span");
      more.className = "finding-chip low";
      more.textContent = `+${item.report.findings.length - 5} more`;
      list.append(more);
    }
    copy.append(list);
  }

  const state = document.createElement("div");
  state.className = "file-state";
  const [text, className] = statusText(item);
  const badge = document.createElement("div");
  badge.className = `status-badge ${className}`;
  badge.textContent = text;
  state.append(badge);

  if (item.status === "cleaned") {
    const download = document.createElement("button");
    download.className = "remove-file";
    download.type = "button";
    download.textContent = "Download clean copy";
    download.addEventListener("click", () => downloadItem(item));
    state.append(download);
  } else if (item.status !== "cleaning") {
    const remove = document.createElement("button");
    remove.className = "remove-file";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeItem(item.id));
    state.append(remove);
  }

  card.append(image, copy, state);
  return card;
}

async function addFiles(fileCollection) {
  const incoming = [...fileCollection].slice(0, Math.max(0, MAX_FILES - items.length));
  if (!incoming.length) return;
  setView("batch");
  for (const file of incoming) {
    const item = {
      id: nextItemId++,
      file,
      previewUrl: URL.createObjectURL(file),
      status: file.size > MAX_FILE_BYTES ? "error" : "queued",
      error: file.size > MAX_FILE_BYTES ? "This file exceeds the 100 MB limit." : "",
      report: null,
      cleaned: null
    };
    items.push(item);
  }
  render();
  await mapLimit(items.filter((item) => item.status === "queued"), 3, inspectItem);
  render();
}

async function inspectItem(item) {
  item.status = "scanning";
  render();
  try {
    const buffer = await item.file.arrayBuffer();
    item.originalSha256 = await sha256(buffer);
    item.report = await callWorker("inspect", buffer);
    item.status = "ready";
  } catch (error) {
    item.status = "error";
    item.error = error.message;
  }
}

async function cleanItem(item, usedNames) {
  item.status = "cleaning";
  render();
  try {
    const buffer = await item.file.arrayBuffer();
    const result = await callWorker("clean", buffer, { removeColorProfile: $("remove-color").checked });
    const bytes = new Uint8Array(result.bytes);
    const remainingSensitive = result.verification.findings.filter((entry) => ["critical", "high", "medium"].includes(entry.sensitivity));
    if (remainingSensitive.length) throw new Error("The verification scan still found sensitive metadata.");
    item.cleaned = {
      bytes,
      name: outputName(item, usedNames),
      removed: result.removed,
      savedBytes: result.savedBytes,
      sha256: await sha256(bytes),
      verification: result.verification
    };
    item.status = "cleaned";
  } catch (error) {
    item.status = "error";
    item.error = error.message;
  }
}

async function mapLimit(values, limit, task) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const value = values[cursor++];
      await task(value);
    }
  });
  await Promise.all(runners);
}

function removeItem(id) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return;
  URL.revokeObjectURL(items[index].previewUrl);
  items.splice(index, 1);
  if (!items.length) setView("drop");
  else render();
}

function clearAll() {
  for (const item of items) URL.revokeObjectURL(item.previewUrl);
  items.splice(0);
  fileInput.value = "";
  setView("drop");
}

function downloadItem(item) {
  if (!item.cleaned) return;
  downloadBlob(new Blob([item.cleaned.bytes], { type: mimeForFormat(item.report.format) }), item.cleaned.name);
}

function buildReport() {
  return {
    generatedAt: new Date().toISOString(),
    generatedBy: "MetaOff 1.0.0",
    processing: "All inspection and cleaning happened locally in the browser.",
    files: items.filter((item) => item.cleaned).map((item) => ({
      originalName: item.file.name,
      cleanName: item.cleaned.name,
      format: item.report.format,
      originalBytes: item.file.size,
      cleanedBytes: item.cleaned.bytes.length,
      originalSha256: item.originalSha256,
      cleanedSha256: item.cleaned.sha256,
      detected: item.report.findings,
      removedContainers: item.cleaned.removed,
      verification: {
        sensitiveSignalsRemaining: item.cleaned.verification.sensitiveCount,
        remainingFindings: item.cleaned.verification.findings
      }
    }))
  };
}

function showResults() {
  const cleaned = items.filter((item) => item.cleaned);
  const removedSignals = cleaned.reduce((sum, item) => sum + item.report.findings.length, 0);
  const removedBytes = cleaned.reduce((sum, item) => sum + Math.max(0, item.cleaned.savedBytes), 0);
  $("result-title").textContent = cleaned.length === 1 ? "Your photo is ready." : "Your photos are ready.";
  $("result-copy").textContent = `${cleaned.length} clean ${cleaned.length === 1 ? "copy was" : "copies were"} created without changing the encoded image pixels. Originals remain untouched on your device.`;
  $("stat-files").textContent = String(cleaned.length);
  $("stat-fields").textContent = String(removedSignals);
  $("stat-bytes").textContent = formatBytes(removedBytes);
  setView("result");
}

async function cleanAll() {
  const candidates = items.filter((item) => item.status === "ready");
  const usedNames = new Set();
  $("clean-all").disabled = true;
  await mapLimit(candidates, 2, (item) => cleanItem(item, usedNames));
  render();
  if (items.some((item) => item.cleaned)) showResults();
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (event) => {
  if (["Enter", " "].includes(event.key)) { event.preventDefault(); fileInput.click(); }
});
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); });
}
dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
$("add-more").addEventListener("click", () => fileInput.click());
$("clear-all").addEventListener("click", clearAll);
$("clean-all").addEventListener("click", cleanAll);
$("start-over").addEventListener("click", clearAll);
$("download-report").addEventListener("click", () => {
  downloadBlob(new Blob([JSON.stringify(buildReport(), null, 2)], { type: "application/json" }), "metaoff-privacy-report.json");
});
$("download-all").addEventListener("click", () => {
  const report = new TextEncoder().encode(JSON.stringify(buildReport(), null, 2));
  const files = items.filter((item) => item.cleaned).map((item) => ({ name: item.cleaned.name, bytes: item.cleaned.bytes }));
  files.push({ name: "metaoff-privacy-report.json", bytes: report });
  downloadBlob(new Blob([createZip(files)], { type: "application/zip" }), "metaoff-clean-photos.zip");
});
