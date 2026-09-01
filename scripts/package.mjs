import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const destination = path.join(root, "dist");
fs.mkdirSync(destination, { recursive: true });
const output = path.join(destination, `metaoff-${manifest.version}.zip`);
const files = ["manifest.json", "app.html", "app.css", "app.js", "popup.html", "popup.css", "popup.js", "worker.js", "src"];
execFileSync("zip", ["-q", "-r", output, ...files], { cwd: root });
console.log(output);
