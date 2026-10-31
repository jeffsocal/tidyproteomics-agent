export type ThemeMode = "dark" | "dim" | "light";

const THEME_STORAGE_KEY = "tpa-theme";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "dim" || stored === "light") {
      return stored;
    }
  } catch (_) { }
  return "dark";
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", mode);
  
  // Keep meta color-scheme in sync per modern-web-guidance `dark-mode-toggle`
  const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
  if (meta) {
    meta.content = mode === "light" ? "light" : "dark";
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch (_) { }

  window.dispatchEvent(new CustomEvent("tpa-theme-change", { detail: { theme: mode } }));
}

