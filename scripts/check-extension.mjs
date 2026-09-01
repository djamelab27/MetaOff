import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const failures = [];
const required = [manifest.action?.default_popup, "app.html", "app.js", "worker.js"];

if (manifest.manifest_version !== 3) failures.push("manifest_version must be 3");
if ((manifest.permissions || []).length) failures.push("MetaOff should not require Chrome permissions");
for (const file of required) {
  if (!file || !fs.existsSync(path.join(root, file))) failures.push(`missing runtime file: ${file || "undefined"}`);
}

for (const file of walk(root)) {
  if (!/\.(?:js|html|json)$/i.test(file) || file.includes(`${path.sep}tests${path.sep}`)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (/<script[^>]+src=["']https?:/i.test(source)) failures.push(`remote script in ${path.relative(root, file)}`);
  if (/\beval\s*\(|new\s+Function\s*\(/.test(source)) failures.push(`dynamic code in ${path.relative(root, file)}`);
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(source)) failures.push(`network code in ${path.relative(root, file)}`);
  if (/\son[a-z]+\s*=/i.test(source) && file.endsWith(".html")) failures.push(`inline event handler in ${path.relative(root, file)}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join("\n"));
  process.exit(1);
}
console.log("✓ Manifest V3 with zero requested permissions");
console.log("✓ No remote, dynamic, network, or inline executable code");
console.log("✓ All runtime entry points are present");

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}
