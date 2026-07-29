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
function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}
const javascriptArtifacts = walkFiles(artifact).filter((file) =>
  file.endsWith(".js"),
);
const serviceWorkerArtifacts = javascriptArtifacts.filter((file) =>
  /^sw-[A-Za-z0-9_-]+\.js$/u.test(path.basename(file)),
);
if (serviceWorkerArtifacts.length !== 1) {
  missing.push(
    `service-worker:expected-one-compiled-asset-found-${serviceWorkerArtifacts.length}`,
  );
} else {
  const workerSource = fs.readFileSync(serviceWorkerArtifacts[0], "utf8");
  if (!workerSource.includes("vaultfront-shell:")) {
    missing.push("service-worker:release-cache-prefix");
  }
}
if (
  javascriptArtifacts.some((file) =>
    fs.readFileSync(file, "utf8").includes("data:video/mp2t"),
  )
) {
  missing.push("service-worker:raw-typescript-data-url");
}
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
console.log(
  `Pages artifact contract: ${required.length}/${required.length} · service-worker 1/1`,
);
