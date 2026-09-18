import { applyI18n, initI18n, t } from "./i18n.js";
import { STORAGE_KEYS, storageGet, storageSet } from "./storage.js";

const modeSelect = document.getElementById("locale-mode");
const localeSelect = document.getElementById("locale-select");
const saveButton = document.getElementById("save-options");
const statusNode = document.getElementById("options-status");

function syncDisabledState() {
  localeSelect.disabled = modeSelect.value !== "manual";
}

async function loadState() {
  const mode = (await storageGet(STORAGE_KEYS.localeMode)) || "auto";
  const override = (await storageGet(STORAGE_KEYS.localeOverride)) || "en";

  modeSelect.value = mode;
  localeSelect.value = override;
  syncDisabledState();
}

async function saveState() {
  try {
    await storageSet(STORAGE_KEYS.localeMode, modeSelect.value);
    await storageSet(STORAGE_KEYS.localeOverride, localeSelect.value);
    statusNode.textContent = t("settingsSaved");
    
    // Auto-close after 2 seconds if window was opened from popup
    setTimeout(() => {
      window.close();
    }, 2000);
  } catch (err) {
    statusNode.textContent = t(err.message) || err.message;
  }
}

async function init() {
  await initI18n();
  applyI18n();

  await loadState();
  modeSelect.addEventListener("change", syncDisabledState);
  saveButton.addEventListener("click", saveState);
}

await init();
