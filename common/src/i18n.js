import { RUNTIME_MESSAGES, SUPPORTED_LOCALES } from "./locales.js";
import { STORAGE_KEYS, storageGet } from "./storage.js";

let activeLocale = null;
let loadedMessages = {};

async function loadLocaleMessages(locale) {
  if (!locale) return {};

  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const response = await fetch(url);
    if (!response.ok) return {};

    const raw = await response.json();
    const flattened = {};
    Object.entries(raw || {}).forEach(([key, value]) => {
      flattened[key] = value?.message ?? "";
    });
    return flattened;
  } catch {
    return {};
  }
}

function browserLocaleToSupported(browserLocale) {
  if (!browserLocale) return "en";
  const normalized = browserLocale.replaceAll("-", "_");
  if (SUPPORTED_LOCALES.includes(normalized)) {
    return normalized;
  }
  const short = normalized.split("_")[0];
  if (SUPPORTED_LOCALES.includes(short)) {
    return short;
  }
  if (short === "zh") {
    return normalized.toLowerCase().includes("hant") || normalized.includes("TW") ? "zh_Hant" : "zh_Hans";
  }
  return "en";
}

export async function initI18n() {
  const mode = (await storageGet(STORAGE_KEYS.localeMode)) || "auto";
  const override = await storageGet(STORAGE_KEYS.localeOverride);

  if (mode === "manual" && override && SUPPORTED_LOCALES.includes(override)) {
    activeLocale = override;
    loadedMessages = await loadLocaleMessages(activeLocale);
    return;
  }

  const browserLocale = chrome.i18n?.getUILanguage?.() || "en";
  activeLocale = browserLocaleToSupported(browserLocale);
  loadedMessages = await loadLocaleMessages(activeLocale);
}

export function t(key) {
  if (Object.hasOwn(loadedMessages, key)) {
    return loadedMessages[key];
  }

  try {
    const fromChromeI18n = chrome.i18n.getMessage(key);
    if (fromChromeI18n) return fromChromeI18n;
  } catch {
    // fall through
  }

  const runtimeFallback = activeLocale ? RUNTIME_MESSAGES[activeLocale]?.[key] : null;
  return runtimeFallback || key;
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (!key) return;
    const value = t(key);
    if (value && value !== key) {
      element.textContent = value;
    }
  });
}
