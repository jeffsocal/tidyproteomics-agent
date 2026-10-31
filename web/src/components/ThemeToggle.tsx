import React, { useEffect, useState } from "react";
import { Moon, CloudMoon, Sun } from "lucide-react";
import { ThemeMode, getStoredTheme, applyTheme } from "../utils/theme";

interface ThemeToggleProps {
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false }) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: ThemeMode }>;
      if (customEvent.detail?.theme) {
        setCurrentTheme(customEvent.detail.theme);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "tpa-theme" && (e.newValue === "dark" || e.newValue === "dim" || e.newValue === "light")) {
        setCurrentTheme(e.newValue as ThemeMode);
      }
    };

    window.addEventListener("tpa-theme-change", handleThemeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("tpa-theme-change", handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const handleSelect = (mode: ThemeMode) => {
    setCurrentTheme(mode);
    applyTheme(mode);
  };

  const options: Array<{ mode: ThemeMode; label: string; icon: React.ReactNode }> = [
    { mode: "dark", label: "Dark", icon: <Moon size={11} /> },
    { mode: "dim", label: "Dim", icon: <CloudMoon size={11} /> },
    { mode: "light", label: "Light", icon: <Sun size={11} /> },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Color scheme theme"
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: "var(--card-bg)",
        border: "1px solid var(--border-strong)",
        borderRadius: "6px",
        padding: "2px",
        gap: "2px",
        userSelect: "none",
      }}
    >
      {options.map(({ mode, label, icon }) => {
        const isActive = currentTheme === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => handleSelect(mode)}
            title={`Switch to ${label} mode`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: compact ? "0px" : "4px",
              padding: compact ? "3px 6px" : "3px 8px",
              fontSize: "11px",
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--fg-bright)" : "var(--muted)",
              background: isActive ? "var(--primary)" : "transparent",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              transition: "all 0.12s ease",
              lineHeight: 1,
            }}
          >
            {icon}
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
};

