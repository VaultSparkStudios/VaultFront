import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";

export async function renderHtmlContent(htmlPath: string): Promise<string> {
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  return ejs.render(htmlContent, {
    gitCommit: JSON.stringify(process.env.GIT_COMMIT ?? "undefined"),
    instanceId: JSON.stringify(process.env.INSTANCE_ID ?? "undefined"),
  });
}

export function setHtmlNoCacheHeaders(res: Response): void {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("ETag", "");
  res.setHeader("Content-Type", "text/html");
}

export function sendRenderedHtml(res: Response, rendered: string): void {
  setHtmlNoCacheHeaders(res);
  res.send(rendered);
}

export function createRenderedHtmlDocument(
  htmlPath: string,
  load: (path: string) => Promise<string> = renderHtmlContent,
) {
  let rendered: Promise<string> | null = null;
  const warm = () => {
    rendered ??= load(htmlPath);
    return rendered;
  };
  return {
    warm,
    async send(res: Response): Promise<void> {
      sendRenderedHtml(res, await warm());
    },
  };
}

export async function renderHtml(
  res: Response,
  htmlPath: string,
): Promise<void> {
  const rendered = await renderHtmlContent(htmlPath);
  sendRenderedHtml(res, rendered);
}
