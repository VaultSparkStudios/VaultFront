import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const arg = process.argv.indexOf("--artifact");
const artifact = path.resolve(
  root,
  arg >= 0 ? process.argv[arg + 1] : "static",
);
const required = [
  "index.html",
  "404.html",
  "agents.json",
  "sitemap.xml",
  "robots.txt",
  ".well-known/llms.txt",
  "contact/index.html",
  "privacy/index.html",
  "terms/index.html",
  "ip/index.html",
];
const missing = required.filter(
  (file) => !fs.existsSync(path.join(artifact, file)),
);
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "deploy-pages.yml"),
  "utf8",
);
if (!/npm run build:pages/.test(workflow) || !/path:\s*static/.test(workflow)) {
  missing.push("workflow:build-and-upload-static");
}
if (/path:\s*pages-stub/.test(workflow)) missing.push("workflow:pages-stub");
if (missing.length) {
  console.error(`Pages artifact contract failed: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`Pages artifact contract: ${required.length}/${required.length}`);
