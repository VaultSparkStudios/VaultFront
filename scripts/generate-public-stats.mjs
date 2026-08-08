#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const START = "<!-- stats-surface:content:start -->";
const END = "<!-- stats-surface:content:end -->";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMetric(metric) {
  return [
    '        <article class="metric-card">',
    "          <h2>" + escapeHtml(metric.label) + "</h2>",
    '          <p class="metric-value">' + escapeHtml(metric.value) + "</p>",
    '          <p class="metric-period">' + escapeHtml(metric.period) + "</p>",
    "          <p>" +
      escapeHtml(metric.unitOrDenominator).replace(/[.]$/u, "") +
      ".</p>",
    '          <p class="metric-source">Source: ' +
      escapeHtml(metric.source).replace(/[.]$/u, "") +
      ".</p>",
    '          <p class="metric-reading">' +
      escapeHtml(metric.interpretation) +
      "</p>",
    "        </article>",
  ].join("\n");
}

function renderContent(descriptor) {
  const computedAt = descriptor.metrics[0]?.computedAt ?? "unavailable";
  return [
    START,
    "      <!-- prettier-ignore -->",
    '      <div class="stats-generated">',
    '      <section class="truth-banner" aria-labelledby="measurement-status">',
    '        <h2 id="measurement-status">Measurement has not started.</h2>',
    "        <p>",
    "          <strong>Unmeasured is not zero.</strong> VaultFront has no qualifying",
    "          production cohort while its public runtime, isolated data plane, and",
    "          Obelisk identity gate remain offline. These cards state that absence",
    "          directly instead of fabricating launch metrics from tests.",
    "        </p>",
    "      </section>",
    "",
    '      <div class="metrics-grid">',
    descriptor.metrics.map(renderMetric).join("\n\n"),
    "      </div>",
    "",
    '      <p class="stats-meta">',
    '        Precomputed at <time datetime="' +
      escapeHtml(computedAt) +
      '">' +
      escapeHtml(computedAt) +
      "</time> ·",
    '        <a href="' +
      escapeHtml(descriptor.machineReadable) +
      '">Machine-readable JSON</a> · Structure is',
    "        automatically checked; underlying measurements remain review-enforced.",
    "      </p>",
    "      </div>",
    "      " + END,
  ].join("\n");
}

function replaceGeneratedBlock(page, content) {
  const start = page.indexOf(START);
  const end = page.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error("stats page is missing generated-content markers");
  }
  return page.slice(0, start) + content + page.slice(end + END.length);
}

export function generatePublicStats(root = process.cwd(), write = false) {
  const descriptorPath = path.join(root, "public", "stats-surface.json");
  const machinePath = path.join(root, "public", "stats.json");
  const pagePath = path.join(root, "public", "stats", "index.html");
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  if (!Array.isArray(descriptor.metrics) || descriptor.metrics.length === 0) {
    throw new Error("stats descriptor must contain at least one metric");
  }
  for (const metric of descriptor.metrics) {
    for (const field of [
      "id",
      "label",
      "value",
      "period",
      "computedAt",
      "unitOrDenominator",
      "source",
      "interpretation",
    ]) {
      if (!metric[field]) {
        throw new Error(String(metric.id ?? "metric") + " missing " + field);
      }
    }
  }

  const expectedMachine = JSON.stringify(descriptor, null, 2) + "\n";
  const currentPage = fs.readFileSync(pagePath, "utf8");
  const expectedPage = replaceGeneratedBlock(
    currentPage,
    renderContent(descriptor),
  );
  const outputs = [
    [machinePath, expectedMachine],
    [pagePath, expectedPage],
  ];
  const changed = outputs
    .filter(([file, expected]) => fs.readFileSync(file, "utf8") !== expected)
    .map(([file]) => path.relative(root, file).split(path.sep).join("/"));
  if (write) {
    for (const [file, expected] of outputs) fs.writeFileSync(file, expected);
  }
  return {
    ok: write || changed.length === 0,
    mode: write ? "write" : "check",
    changed,
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = generatePublicStats(
      process.cwd(),
      process.argv.includes("--write"),
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
