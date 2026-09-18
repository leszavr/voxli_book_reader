import { STORAGE_KEYS, storageGet, storageSet } from "./storage.js";

const ALLOWED_FONTS = ["Georgia", "Times New Roman", "Arial", "Verdana", "system-ui"];

export const DEFAULT_SETTINGS = {
  fontSize: 18,
  fontFamily: "Georgia",
  lineHeight: 1.8,
  textAlign: "justify",
  contentWidth: 80,
  theme: "light",
};

export async function loadSettings() {
  const saved = await storageGet(STORAGE_KEYS.readerSettings);
  return saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings) {
  await storageSet(STORAGE_KEYS.readerSettings, settings);
}

export function applySettings(settings) {
  const root = document.documentElement;
  const safeFont = ALLOWED_FONTS.includes(settings.fontFamily) ? settings.fontFamily : DEFAULT_SETTINGS.fontFamily;
  root.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
  root.style.setProperty("--reader-font-family", safeFont);
  root.style.setProperty("--reader-line-height", String(settings.lineHeight));
  root.style.setProperty("--reader-text-align", settings.textAlign);
  root.style.setProperty("--reader-content-width", `${settings.contentWidth}%`);

  document.body.classList.remove("reader-light", "reader-dark", "reader-sepia");
  document.body.classList.add(`reader-${settings.theme}`);
}
