export type VaultFrontBrandTheme = "vaultfront" | "light" | "competitive";

const THEME_STORAGE_KEY = "vf-theme";

export function applyVaultFrontBrandTheme(theme: VaultFrontBrandTheme): void {
  document.documentElement.setAttribute("data-vaultfront-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing or storage unavailable — ignore
  }
}

export function loadSavedVaultFrontTheme(): void {
  try {
    const saved = localStorage.getItem(
      THEME_STORAGE_KEY,
    ) as VaultFrontBrandTheme | null;
    if (
      saved === "light" ||
      saved === "competitive" ||
      saved === "vaultfront"
    ) {
      applyVaultFrontBrandTheme(saved);
      return;
    }
  } catch {
    // Storage unavailable
  }
  // Default: respect prefers-color-scheme
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyVaultFrontBrandTheme(prefersDark ? "vaultfront" : "light");
}

export function getCurrentVaultFrontTheme(): VaultFrontBrandTheme {
  const attr = document.documentElement.getAttribute("data-vaultfront-theme");
  if (attr === "light" || attr === "competitive") return attr;
  return "vaultfront";
}
