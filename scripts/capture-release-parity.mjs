#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  assessReleaseParityCell,
  RELEASE_PARITY_THRESHOLDS,
  summarizeReleaseParity,
} from "./lib/release-parity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = flag("--url");
if (!url) {
  console.error(
    "usage: node scripts/capture-release-parity.mjs --url <origin> [--output <json>] [--screenshots <dir>] [--width <390|768|1440>] [--theme <vaultfront|light|competitive>]",
  );
  process.exit(2);
}
const output = path.resolve(
  root,
  flag("--output", ".cache/release-parity.json"),
);
const screenshots = path.resolve(
  root,
  flag("--screenshots", "output/playwright/release-parity"),
);
const allowedWidths = [390, 768, 1440];
const allowedThemes = ["vaultfront", "light", "competitive"];
const requestedWidth = flag("--width");
const requestedTheme = flag("--theme");
const width = requestedWidth === null ? null : Number(requestedWidth);
if (width !== null && !allowedWidths.includes(width)) {
  console.error(`unsupported release-parity width: ${requestedWidth}`);
  process.exit(2);
}
if (requestedTheme !== null && !allowedThemes.includes(requestedTheme)) {
  console.error(`unsupported release-parity theme: ${requestedTheme}`);
  process.exit(2);
}
const widths = width === null ? allowedWidths : [width];
const themes = requestedTheme === null ? allowedThemes : [requestedTheme];
const observedAt = new Date().toISOString();
const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

fs.mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const cells = [];
let revision = null;

try {
  const revisionResponse = await fetch(new URL("/commit.txt", url));
  if (revisionResponse.ok) revision = (await revisionResponse.text()).trim();

  for (const theme of themes) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: width <= 480 ? 844 : 900 },
        colorScheme: theme === "light" ? "light" : "dark",
      });
      const page = await context.newPage();
      await page.addInitScript((selectedTheme) => {
        const describeNode = (node) => {
          if (!(node instanceof Element)) return null;
          const className =
            typeof node.className === "string"
              ? node.className.trim().replace(/\s+/g, ".").slice(0, 120)
              : "";
          return [
            node.tagName.toLowerCase(),
            node.id ? `#${node.id}` : "",
            className ? `.${className}` : "",
          ].join("");
        };
        const describeRect = (rect) =>
          rect
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            : null;
        localStorage.setItem("vf-theme", selectedTheme);
        localStorage.setItem("settings.brandTheme", selectedTheme);
        window.__vfReleaseVitals = {
          lcp: [],
          lcpEntries: [],
          cls: 0,
          layoutShifts: [],
          interactions: {},
        };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__vfReleaseVitals.lcp.push(entry.startTime);
            window.__vfReleaseVitals.lcpEntries.push({
              startTimeMs: Math.round(entry.startTime),
              size: Math.round(entry.size ?? 0),
              element: describeNode(entry.element),
              url: entry.url
                ? new URL(entry.url, location.href).pathname
                : null,
            });
            window.__vfReleaseVitals.lcpEntries =
              window.__vfReleaseVitals.lcpEntries.slice(-20);
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              window.__vfReleaseVitals.cls += entry.value;
              window.__vfReleaseVitals.layoutShifts.push({
                value: Number(entry.value.toFixed(6)),
                startTimeMs: Math.round(entry.startTime),
                sources: [...(entry.sources ?? [])]
                  .slice(0, 5)
                  .map((source) => ({
                    node: describeNode(source.node),
                    previousRect: describeRect(source.previousRect),
                    currentRect: describeRect(source.currentRect),
                  })),
              });
              window.__vfReleaseVitals.layoutShifts =
                window.__vfReleaseVitals.layoutShifts.slice(-20);
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.interactionId) continue;
            const previous =
              window.__vfReleaseVitals.interactions[entry.interactionId] ?? 0;
            window.__vfReleaseVitals.interactions[entry.interactionId] =
              Math.max(previous, entry.duration);
          }
        }).observe({
          type: "event",
          buffered: true,
          durationThreshold: 0,
        });
      }, theme);

      const response = await page.goto(url, {
        waitUntil: "load",
        timeout: 30_000,
      });
      if (!response || response.status() >= 400) {
        throw new Error(
          `${url} returned ${response?.status() ?? "no response"} at ${width}px`,
        );
      }
      await page.waitForFunction(
        () =>
          !document.documentElement.classList.contains("preload") &&
          document.documentElement.dataset.vfLayoutReady === "true",
        null,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(500);

      const interactionTarget =
        width < 1024
          ? page.locator("#hamburger-btn")
          : page.locator("#lang-selector:visible");
      await interactionTarget.click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);

      const measured = await page.evaluate((minimumTargetPx) => {
        const body = document.documentElement;
        const targetVisible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < innerWidth &&
            rect.top < innerHeight &&
            style.visibility !== "hidden" &&
            style.display !== "none"
          );
        };
        const smallTargets =
          innerWidth <= 480
            ? [
                ...document.querySelectorAll(
                  "a,button,[role=button],input[type=submit]",
                ),
              ]
                .filter(targetVisible)
                .map((element) => {
                  const rect = element.getBoundingClientRect();
                  return {
                    label: (
                      element.innerText ||
                      element.getAttribute("aria-label") ||
                      element.tagName
                    )
                      .trim()
                      .slice(0, 60),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                  };
                })
                .filter(
                  (target) =>
                    target.width < minimumTargetPx ||
                    target.height < minimumTargetPx,
                )
            : [];
        const navSelectors = [
          "nav",
          "[role=navigation]",
          "[aria-label*=menu i]",
          "#hamburger-btn",
        ];
        const interactions = Object.values(
          window.__vfReleaseVitals.interactions,
        );
        const navigation = performance.getEntriesByType("navigation")[0];
        const resourceTimings = performance
          .getEntriesByType("resource")
          .map((entry) => ({
            path: (() => {
              try {
                const resourceUrl = new URL(entry.name, location.href);
                return resourceUrl.origin === location.origin
                  ? resourceUrl.pathname
                  : resourceUrl.origin;
              } catch {
                return "unparseable";
              }
            })(),
            durationMs: Math.round(entry.duration),
            transferSize: Math.round(entry.transferSize ?? 0),
          }))
          .sort((left, right) => right.durationMs - left.durationMs)
          .slice(0, 10);
        return {
          theme: document.documentElement.getAttribute("data-vaultfront-theme"),
          vitals: {
            lcpMs: Math.max(0, ...window.__vfReleaseVitals.lcp),
            inpMs: Math.max(0, ...interactions),
            cls: Number(window.__vfReleaseVitals.cls.toFixed(4)),
          },
          navigation: {
            type: navigation?.type ?? null,
            domainLookupStartMs: Math.round(navigation?.domainLookupStart ?? 0),
            domainLookupEndMs: Math.round(navigation?.domainLookupEnd ?? 0),
            connectStartMs: Math.round(navigation?.connectStart ?? 0),
            secureConnectionStartMs: Math.round(
              navigation?.secureConnectionStart ?? 0,
            ),
            connectEndMs: Math.round(navigation?.connectEnd ?? 0),
            requestStartMs: Math.round(navigation?.requestStart ?? 0),
            responseStartMs: Math.round(navigation?.responseStart ?? 0),
            responseEndMs: Math.round(navigation?.responseEnd ?? 0),
            domContentLoadedMs: Math.round(
              navigation?.domContentLoadedEventEnd ?? 0,
            ),
            loadMs: Math.round(navigation?.loadEventEnd ?? 0),
            transferSize: Math.round(navigation?.transferSize ?? 0),
          },
          diagnostics: {
            lcpEntries: window.__vfReleaseVitals.lcpEntries,
            layoutShifts: window.__vfReleaseVitals.layoutShifts,
            slowResources: resourceTimings,
          },
          dom: {
            horizontalOverflowPx: Math.max(0, body.scrollWidth - innerWidth),
            navigationReachable: navSelectors.some((selector) =>
              [...document.querySelectorAll(selector)].some(targetVisible),
            ),
            smallTargets,
          },
        };
      }, RELEASE_PARITY_THRESHOLDS.minimumTargetPx);

      const headers = await response.allHeaders();
      const screenshotPath = path.join(screenshots, `${theme}-${width}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const cell = {
        theme,
        width,
        ...measured,
        httpStatus: response.status(),
        securityHeaders: {
          strictTransportSecurity: headers["strict-transport-security"] ?? null,
          contentSecurityPolicy: headers["content-security-policy"] ?? null,
        },
        screenshot: path
          .relative(root, screenshotPath)
          .replaceAll(path.sep, "/"),
        screenshotDigest: sha256(fs.readFileSync(screenshotPath)),
      };
      cell.assessment = assessReleaseParityCell(cell);
      cells.push(cell);
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const report = {
  schemaVersion: 1,
  project: "vaultfront",
  origin: url,
  observedAt,
  revision,
  thresholds: RELEASE_PARITY_THRESHOLDS,
  summary: summarizeReleaseParity(cells),
  cells,
};
report.digest = sha256(JSON.stringify(report));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report.summary));
console.log(`release parity receipt: ${path.relative(root, output)}`);
process.exit(report.summary.pass ? 0 : 1);
