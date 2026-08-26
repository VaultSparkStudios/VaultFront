export const RELEASE_PARITY_THRESHOLDS = Object.freeze({
  lcpMs: 1800,
  inpMs: 200,
  cls: 0.1,
  minimumTargetPx: 44,
});

export const RELEASE_PARITY_THEMES = Object.freeze([
  "vaultfront",
  "light",
  "competitive",
]);

export const RELEASE_PARITY_VIEWPORTS = Object.freeze([
  {
    id: "phone-360-portrait",
    deviceWidth: 360,
    orientation: "portrait",
    width: 360,
    height: 800,
  },
  {
    id: "phone-360-landscape",
    deviceWidth: 360,
    orientation: "landscape",
    width: 800,
    height: 360,
  },
  {
    id: "phone-390-portrait",
    deviceWidth: 390,
    orientation: "portrait",
    width: 390,
    height: 844,
  },
  {
    id: "phone-390-landscape",
    deviceWidth: 390,
    orientation: "landscape",
    width: 844,
    height: 390,
  },
  {
    id: "phone-414-portrait",
    deviceWidth: 414,
    orientation: "portrait",
    width: 414,
    height: 896,
  },
  {
    id: "phone-414-landscape",
    deviceWidth: 414,
    orientation: "landscape",
    width: 896,
    height: 414,
  },
  {
    id: "tablet-768-portrait",
    deviceWidth: 768,
    orientation: "portrait",
    width: 768,
    height: 1024,
  },
  {
    id: "tablet-768-landscape",
    deviceWidth: 768,
    orientation: "landscape",
    width: 1024,
    height: 768,
  },
  {
    id: "desktop-1440",
    deviceWidth: 1440,
    orientation: "landscape",
    width: 1440,
    height: 900,
  },
]);

export const RELEASE_PARITY_EXPECTED_CELL_COUNT =
  RELEASE_PARITY_THEMES.length * RELEASE_PARITY_VIEWPORTS.length;

export function validateReleaseParityMatrix(cells) {
  const expected = new Map();
  for (const theme of RELEASE_PARITY_THEMES) {
    for (const viewport of RELEASE_PARITY_VIEWPORTS) {
      expected.set(`${theme}:${viewport.id}`, viewport);
    }
  }
  const errors = [];
  const observed = new Set();
  for (const cell of cells) {
    const key = `${cell.theme}:${cell.viewportId}`;
    const viewport = expected.get(key);
    if (!viewport) {
      errors.push(`unexpected-cell:${key}`);
      continue;
    }
    if (observed.has(key)) {
      errors.push(`duplicate-cell:${key}`);
      continue;
    }
    observed.add(key);
    for (const field of ["deviceWidth", "orientation", "width", "height"]) {
      if (cell[field] !== viewport[field]) {
        errors.push(
          `cell-${key}-${field}-${String(cell[field])}-expected-${String(viewport[field])}`,
        );
      }
    }
  }
  for (const key of expected.keys()) {
    if (!observed.has(key)) errors.push(`missing-cell:${key}`);
  }
  return {
    pass:
      errors.length === 0 &&
      cells.length === RELEASE_PARITY_EXPECTED_CELL_COUNT,
    expectedCellCount: RELEASE_PARITY_EXPECTED_CELL_COUNT,
    observedCellCount: cells.length,
    errors,
  };
}

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
  if (cell.deviceWidth <= 768 && !cell.dom?.reducedMotionRespected) {
    findings.push("reduced-motion-not-respected");
  }
  const drawer = cell.dom?.mobileDrawer;
  if (drawer) {
    if (!drawer.visible) findings.push("mobile-drawer-not-visible");
    if (!drawer.containedInViewport)
      findings.push("mobile-drawer-outside-viewport");
    if (!drawer.scrollRegionPresent)
      findings.push("mobile-drawer-scroll-region-missing");
    if (!drawer.scrollableWhenNeeded)
      findings.push("mobile-drawer-not-scrollable");
    if (!drawer.dynamicViewportHeight)
      findings.push("mobile-drawer-not-dynamic-viewport");
    if (!drawer.safeAreaPadding)
      findings.push("mobile-drawer-safe-area-missing");
    if (!drawer.closeReachable)
      findings.push("mobile-drawer-close-unreachable");
    if (!drawer.scrollLockActive)
      findings.push("mobile-drawer-scroll-lock-missing");
    if (!drawer.scrollLockReleased)
      findings.push("mobile-drawer-scroll-lock-not-released");
    if (!drawer.closedAriaSynchronized)
      findings.push("mobile-drawer-aria-not-synchronized");
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
  const matrix = validateReleaseParityMatrix(cells);
  const findingCount = cells.reduce(
    (sum, cell) => sum + (cell.assessment?.findings?.length ?? 0),
    0,
  );
  return {
    pass: matrix.pass && findingCount === 0,
    cellCount: cells.length,
    findingCount,
    matrix,
    worst: {
      lcpMs: Math.max(...cells.map((cell) => cell.vitals.lcpMs)),
      inpMs: Math.max(...cells.map((cell) => cell.vitals.inpMs)),
      cls: Math.max(...cells.map((cell) => cell.vitals.cls)),
    },
  };
}
