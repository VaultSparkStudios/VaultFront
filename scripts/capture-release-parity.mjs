#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  assessReleaseParityCell,
  RELEASE_PARITY_THEMES,
  RELEASE_PARITY_THRESHOLDS,
  RELEASE_PARITY_VIEWPORTS,
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
    "usage: node scripts/capture-release-parity.mjs --url <origin> [--output <json>] [--screenshots <dir>] [--viewport <matrix-id>] [--width <360|390|414|768|1440>] [--theme <vaultfront|light|competitive>]",
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
const allowedWidths = [360, 390, 414, 768, 1440];
const requestedWidth = flag("--width");
const requestedViewport = flag("--viewport");
const requestedTheme = flag("--theme");
const width = requestedWidth === null ? null : Number(requestedWidth);
if (width !== null && !allowedWidths.includes(width)) {
  console.error(`unsupported release-parity width: ${requestedWidth}`);
  process.exit(2);
}
if (
  requestedTheme !== null &&
  !RELEASE_PARITY_THEMES.includes(requestedTheme)
) {
  console.error(`unsupported release-parity theme: ${requestedTheme}`);
  process.exit(2);
}
if (
  requestedViewport !== null &&
  !RELEASE_PARITY_VIEWPORTS.some(
    (viewport) => viewport.id === requestedViewport,
  )
) {
  console.error(`unsupported release-parity viewport: ${requestedViewport}`);
  process.exit(2);
}
if (requestedViewport !== null && width !== null) {
  console.error("--viewport and --width are mutually exclusive");
  process.exit(2);
}
const viewports =
  requestedViewport !== null
    ? RELEASE_PARITY_VIEWPORTS.filter(
        (viewport) => viewport.id === requestedViewport,
      )
    : width !== null
      ? RELEASE_PARITY_VIEWPORTS.filter(
          (viewport) =>
            viewport.deviceWidth === width &&
            viewport.orientation === "portrait",
        )
      : RELEASE_PARITY_VIEWPORTS;
const themes =
  requestedTheme === null ? RELEASE_PARITY_THEMES : [requestedTheme];
const observedAt = new Date().toISOString();
const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const captureScreenshot = async (page, screenshotPath) => {
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return "playwright";
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;

    // Playwright waits indefinitely for a stalled web font before screenshotting.
    // Chromium can still capture the pixels already rendered with the browser's
    // fallback font; retain and disclose that bounded fallback in the receipt.
    const session = await page.context().newCDPSession(page);
    try {
      const metrics = await session.send("Page.getLayoutMetrics");
      const contentSize = metrics.cssContentSize ?? metrics.contentSize;
      const result = await session.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: Math.ceil(contentSize.width),
          height: Math.ceil(contentSize.height),
          scale: 1,
        },
      });
      fs.writeFileSync(screenshotPath, Buffer.from(result.data, "base64"));
      return "cdp-font-timeout-fallback";
    } finally {
      await session.detach();
    }
  }
};

fs.mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const cells = [];
let revision = null;

try {
  const revisionResponse = await fetch(new URL("/commit.txt", url));
  if (revisionResponse.ok) {
    const candidateRevision = (await revisionResponse.text()).trim();
    if (/^[0-9a-f]{40}$/i.test(candidateRevision)) {
      revision = candidateRevision.toLowerCase();
    }
  }

  for (const theme of themes) {
    for (const viewport of viewports) {
      const {
        deviceWidth,
        height,
        id: viewportId,
        orientation,
        width,
      } = viewport;
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: theme === "light" ? "light" : "dark",
      });
      const page = await context.newPage();
      const browserErrors = [];
      page.on("pageerror", (error) => {
        browserErrors.push(`pageerror:${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          browserErrors.push(`console:${message.text()}`);
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 400) {
          browserErrors.push(`http-${response.status()}:${response.url()}`);
        }
      });
      let closingContext = false;
      const pendingDialogDismissals = new Set();
      page.on("dialog", (dialog) => {
        const dismissal = dialog
          .dismiss()
          .catch((error) => {
            if (!closingContext && !page.isClosed()) throw error;
          })
          .finally(() => pendingDialogDismissals.delete(dismissal));
        pendingDialogDismissals.add(dismissal);
      });
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
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (!response || response.status() >= 400) {
        throw new Error(
          `${url} returned ${response?.status() ?? "no response"} at ${width}px`,
        );
      }
      try {
        await page.waitForFunction(
          () =>
            !document.documentElement.classList.contains("preload") &&
            document.documentElement.dataset.vfLayoutReady === "true",
          null,
          { timeout: 10_000 },
        );
      } catch (error) {
        const readiness = await page.evaluate(() => ({
          href: location.href,
          preload: document.documentElement.classList.contains("preload"),
          layoutReady: document.documentElement.dataset.vfLayoutReady ?? null,
          readyState: document.readyState,
        }));
        throw new Error(
          `layout readiness failed for ${theme}/${viewportId}: ${JSON.stringify(readiness)}; browser errors: ${browserErrors.join(" | ") || "none"}`,
          { cause: error },
        );
      }
      await page.waitForTimeout(500);

      let mobileDrawer = null;
      let drawerScreenshot = null;
      let drawerScreenshotDigest = null;
      let drawerScreenshotMethod = null;
      if (width < 1024) {
        await page.locator("#hamburger-btn").click();
        await page
          .locator("#sidebar-menu")
          .waitFor({ state: "visible", timeout: 5_000 });
        await page.waitForFunction(
          () => {
            const sidebar = document.getElementById("sidebar-menu");
            const rect = sidebar?.getBoundingClientRect();
            return Boolean(
              sidebar?.classList.contains("open") &&
              rect &&
              Math.abs(rect.left) <= 1 &&
              rect.right <= innerWidth + 1,
            );
          },
          null,
          { timeout: 2_000 },
        );
        mobileDrawer = await page.evaluate((minimumTargetPx) => {
          const sidebar = document.getElementById("sidebar-menu");
          const scrollRegion = document.querySelector(
            "[data-mobile-nav-scroll-region]",
          );
          const close = document.getElementById("mobile-menu-close");
          const sidebarRect = sidebar?.getBoundingClientRect();
          const closeRect = close?.getBoundingClientRect();
          const overflowY = scrollRegion
            ? getComputedStyle(scrollRegion).overflowY
            : null;
          return {
            visible:
              Boolean(sidebar?.classList.contains("open")) &&
              Boolean(sidebarRect && sidebarRect.width > 0),
            containedInViewport: Boolean(
              sidebarRect &&
              sidebarRect.left >= -1 &&
              sidebarRect.right <= innerWidth + 1 &&
              sidebarRect.top >= -1 &&
              sidebarRect.bottom <= innerHeight + 1 &&
              Math.abs(sidebarRect.width - Math.min(innerWidth * 0.82, 384)) <=
                2,
            ),
            scrollRegionPresent: Boolean(scrollRegion),
            scrollableWhenNeeded: Boolean(
              scrollRegion &&
              (scrollRegion.scrollHeight <= scrollRegion.clientHeight + 1 ||
                overflowY === "auto" ||
                overflowY === "scroll"),
            ),
            dynamicViewportHeight: Boolean(
              sidebar?.classList.contains("h-dvh"),
            ),
            safeAreaPadding: Boolean(
              scrollRegion
                ?.getAttribute("class")
                ?.includes("safe-area-inset-bottom"),
            ),
            closeReachable: Boolean(
              closeRect &&
              closeRect.width >= minimumTargetPx &&
              closeRect.height >= minimumTargetPx &&
              closeRect.left >= 0 &&
              closeRect.right <= innerWidth &&
              closeRect.top >= 0 &&
              closeRect.bottom <= innerHeight,
            ),
            rect: sidebarRect
              ? {
                  left: Math.round(sidebarRect.left),
                  right: Math.round(sidebarRect.right),
                  top: Math.round(sidebarRect.top),
                  bottom: Math.round(sidebarRect.bottom),
                  width: Math.round(sidebarRect.width),
                  height: Math.round(sidebarRect.height),
                }
              : null,
            scrollLockActive:
              document.documentElement.classList.contains("overflow-hidden"),
            scrollHeight: scrollRegion?.scrollHeight ?? null,
            clientHeight: scrollRegion?.clientHeight ?? null,
            overflowY,
          };
        }, RELEASE_PARITY_THRESHOLDS.minimumTargetPx);
        const drawerScreenshotPath = path.join(
          screenshots,
          `${theme}-${viewportId}-drawer-open.png`,
        );
        drawerScreenshotMethod = await captureScreenshot(
          page,
          drawerScreenshotPath,
        );
        drawerScreenshot = path
          .relative(root, drawerScreenshotPath)
          .replaceAll(path.sep, "/");
        drawerScreenshotDigest = sha256(fs.readFileSync(drawerScreenshotPath));
        await page.locator("#mobile-menu-close").click();
        await page.waitForFunction(
          () =>
            !document
              .getElementById("sidebar-menu")
              ?.classList.contains("open"),
        );
        mobileDrawer = {
          ...mobileDrawer,
          scrollLockReleased: !(await page
            .locator("html")
            .evaluate((element) =>
              element.classList.contains("overflow-hidden"),
            )),
          closedAriaSynchronized:
            (await page
              .locator("#sidebar-menu")
              .getAttribute("aria-hidden")) === "true" &&
            (await page.locator("#sidebar-menu").getAttribute("aria-modal")) ===
              null &&
            (await page
              .locator("#hamburger-btn")
              .getAttribute("aria-expanded")) === "false",
        };
      } else {
        await page.locator("#lang-selector:visible").click();
        await page.keyboard.press("Escape");
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reducedMotionRespected = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".vf-main-shell"), "::before")
            .animationName === "none",
      );
      await page.waitForTimeout(250);

      const measured = await page.evaluate(
        ({ isMobileDevice, minimumTargetPx }) => {
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
          const smallTargets = isMobileDevice
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
            theme: document.documentElement.getAttribute(
              "data-vaultfront-theme",
            ),
            vitals: {
              lcpMs: Math.max(0, ...window.__vfReleaseVitals.lcp),
              inpMs: Math.max(0, ...interactions),
              cls: Number(window.__vfReleaseVitals.cls.toFixed(4)),
            },
            navigation: {
              type: navigation?.type ?? null,
              domainLookupStartMs: Math.round(
                navigation?.domainLookupStart ?? 0,
              ),
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
        },
        {
          isMobileDevice: deviceWidth <= 768,
          minimumTargetPx: RELEASE_PARITY_THRESHOLDS.minimumTargetPx,
        },
      );
      measured.dom.mobileDrawer = mobileDrawer;
      measured.dom.reducedMotionRespected = reducedMotionRespected;

      const headers = await response.allHeaders();
      const screenshotPath = path.join(
        screenshots,
        `${theme}-${viewportId}.png`,
      );
      const screenshotMethod = await captureScreenshot(page, screenshotPath);
      const cell = {
        theme,
        viewportId,
        deviceWidth,
        orientation,
        width,
        height,
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
        screenshotMethod,
        drawerScreenshot,
        drawerScreenshotDigest,
        drawerScreenshotMethod,
      };
      cell.assessment = assessReleaseParityCell(cell);
      cells.push(cell);
      closingContext = true;
      await Promise.allSettled([...pendingDialogDismissals]);
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
