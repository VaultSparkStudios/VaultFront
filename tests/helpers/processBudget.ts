// Synchronous Node integration fixtures contend for CPU and process startup on
// Windows when Vitest exercises the repository-owned four-worker ceiling. Keep
// that contention explicit and bounded instead of inheriting the 5s unit-test
// default or treating scheduler delay as a product regression.
export const PROCESS_INTEGRATION_SLO_MS = 50_000;
export const PROCESS_INTEGRATION_TIMEOUT_MS = 60_000;
