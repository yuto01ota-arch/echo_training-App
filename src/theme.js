const storageKey = "echo-training-theme";
const valid = (value) => value === "light" || value === "dark";
export function savedTheme() {
  try {
    const value = localStorage.getItem(storageKey);
    return valid(value) ? value : null;
  } catch { return null; }
}
export function preferredTheme() {
  return document.documentElement.dataset.theme || savedTheme() ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", theme === "dark" ? "#121b20" : "#f7f9fa",
  );
}
export function saveTheme(theme) {
  try { localStorage.setItem(storageKey, theme); }
  catch { /* Switching still works when storage is unavailable. */ }
}
export function themeURL(value, theme = preferredTheme()) {
  const url = new URL(value, window.location.href);
  url.searchParams.set("theme", theme);
  return url.href;
}
export function initializeTheme() {
  const url = new URL(window.location.href);
  const incoming = url.searchParams.get("theme");
  if (valid(incoming)) {
    saveTheme(incoming);
    applyTheme(incoming);
  } else {
    applyTheme(preferredTheme());
  }
  if (url.searchParams.has("theme")) {
    url.searchParams.delete("theme");
    history.replaceState(history.state, "", url);
  }
}
