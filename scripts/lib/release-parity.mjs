export const RELEASE_PARITY_THRESHOLDS = Object.freeze({
  lcpMs: 1800,
  inpMs: 200,
  cls: 0.1,
  minimumTargetPx: 44,
});

export function assessReleaseParityCell(
  cell,
  thresholds = RELEASE_PARITY_THRESHOLDS,
) {
  const findings = [];
  if (!Number.isFinite(cell.vitals?.lcpMs)) {
    findings.push("lcp-missing");
  } else if (cell.vitals.lcpMs >= thresholds.lcpMs) {
    findings.push(`lcp-${Math.round(cell.vitals.lcpMs)}ms`);
  }
  if (!Number.isFinite(cell.vitals?.inpMs)) {
    findings.push("inp-missing");
  } else if (cell.vitals.inpMs > thresholds.inpMs) {
    findings.push(`inp-${Math.round(cell.vitals.inpMs)}ms`);
  }
  if (!Number.isFinite(cell.vitals?.cls)) {
    findings.push("cls-missing");
  } else if (cell.vitals.cls > thresholds.cls) {
    findings.push(`cls-${cell.vitals.cls.toFixed(3)}`);
  }
  if (cell.dom?.horizontalOverflowPx > 4) {
    findings.push(`horizontal-overflow-${cell.dom.horizontalOverflowPx}px`);
  }
  if (!cell.dom?.navigationReachable) findings.push("navigation-unreachable");
  if ((cell.dom?.smallTargets ?? []).length > 0) {
    findings.push(`small-targets-${cell.dom.smallTargets.length}`);
  }
  if (!cell.securityHeaders?.strictTransportSecurity) {
    findings.push("hsts-missing");
  }
  if (!cell.securityHeaders?.contentSecurityPolicy) {
    findings.push("csp-missing");
  }
  return { pass: findings.length === 0, findings };
}

export function summarizeReleaseParity(cells) {
  const findingCount = cells.reduce(
    (sum, cell) => sum + (cell.assessment?.findings?.length ?? 0),
    0,
  );
  return {
    pass: cells.length > 0 && findingCount === 0,
    cellCount: cells.length,
    findingCount,
    worst: {
      lcpMs: Math.max(...cells.map((cell) => cell.vitals.lcpMs)),
      inpMs: Math.max(...cells.map((cell) => cell.vitals.inpMs)),
      cls: Math.max(...cells.map((cell) => cell.vitals.cls)),
    },
  };
}
