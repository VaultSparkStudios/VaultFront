import { HudPreset } from "../HudLayout";

export const MOBILE_PRIORITY_MAX_VIEWPORT_WIDTH = 980;

export function viewportWidth(): number {
  return typeof window !== "undefined" ? window.innerWidth : 1920;
}

export function isMobilePriorityMode(params: {
  hudVariant: "default" | "mobile_priority";
  hudPreset: HudPreset;
  viewportWidth: number;
}): boolean {
  return (
    params.hudVariant === "mobile_priority" ||
    params.hudPreset === "mobile" ||
    params.viewportWidth < MOBILE_PRIORITY_MAX_VIEWPORT_WIDTH
  );
}
