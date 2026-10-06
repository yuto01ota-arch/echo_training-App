import { useEffect, useState } from "react";
import { applyTheme, preferredTheme, saveTheme } from "../theme.js";

export default function ThemeToggle({ onChange } = {}) {
  const [theme, setTheme] = useState(preferredTheme);
  const dark = theme === "dark";
  const label = dark ? "ライトモードに切り替え" : "ダークモードに切り替え";

  useEffect(() => applyTheme(theme), [theme]);

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = dark ? "light" : "dark";
        saveTheme(next);
        applyTheme(next);
        onChange?.(next);
        setTheme(next);
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        {dark ? <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </> : <path d="M20.5 13.2A8.6 8.6 0 0 1 10.8 3.5a8.6 8.6 0 1 0 9.7 9.7Z" />}
      </svg>
      <span>{dark ? "ライトモード" : "ダークモード"}</span>
    </button>
  );
}
