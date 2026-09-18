import { applyI18n, initI18n, t } from "./i18n.js";
import { parseBookFile } from "./parsers/index.js";
import { loadProgress, saveProgress, debounce } from "./progress.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, applySettings } from "./settings.js";
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from "./storage.js";
import { escapeHtml, sanitizeHtml } from "./utils.js";

const BOOK_CACHE_SCHEMA_VERSION = 3;

const state = {
  book: null,
  chapterIndex: 0,
  settings: { ...DEFAULT_SETTINGS },
  activePanel: null,
  autoHideTimer: null,
  panelHovered: false,
  headerForcedVisible: false,
  chapterTransitionUntil: 0,
  // Флаг: true на один кадр после commitSettings, чтобы скролл от перекомпоновки
  // не закрывал панель настроек
  preventScrollClose: false,
  // Счётчик wheel-тиков на дне главы для эффекта "прилипания"
  bottomScrollTicks: 0,
};

const elements = {
  header: document.querySelector(".reader-header"),
  headerHoverZone: document.getElementById("header-hover-zone"),
  fileInput: document.getElementById("file-input"),
  pickFile: document.getElementById("pick-file"),
  openLast: document.getElementById("open-last-in-reader"),
  toggleSettings: document.getElementById("toggle-settings"),
  toggleToc: document.getElementById("toggle-toc"),
  tocPanel: document.getElementById("toc-panel"),
  tocList: document.getElementById("toc-list"),
  settingsPanel: document.getElementById("settings-panel"),
  resetSettings: document.getElementById("reset-settings"),
  readerContent: document.getElementById("reader-content"),
  bookTitle: document.getElementById("book-title"),
  aboutBtn: document.getElementById("about-btn"),
  aboutModal: document.getElementById("about-modal"),
  aboutClose: document.getElementById("about-close"),
  controls: {
    fontSize: document.getElementById("font-size"),
    fontSizeValue: document.getElementById("font-size-value"),
    fontFamily: document.getElementById("font-family"),
    lineHeight: document.getElementById("line-height"),
    lineHeightValue: document.getElementById("line-height-value"),
    contentWidth: document.getElementById("content-width"),
    contentWidthValue: document.getElementById("content-width-value"),
    textAlign: document.getElementById("text-align"),
    theme: document.getElementById("theme"),
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function chapterReadableSize(chapter) {
  const titleSize = String(chapter?.title || "").trim().length;
  const contentText = String(chapter?.content || "")
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return Math.max(1, titleSize + contentText.length);
}

function withBookMetrics(book) {
  const chapterSizes = book.chapters.map((chapter) => chapterReadableSize(chapter));
  const totalBookSize = chapterSizes.reduce((sum, value) => sum + value, 0);
  return {
    ...book,
    chapterSizes,
    totalBookSize: Math.max(1, totalBookSize),
  };
}

async function sha256ForFile(file) {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function updateMeta() {
  const metaEl = elements.readerContent.querySelector(".chapter-nav-meta");
  if (!metaEl || !state.book) return;
  const currentChapter = state.chapterIndex + 1;
  const total = state.book.chapters.length;
  metaEl.textContent = `${t("chapter")} ${currentChapter}/${total}`;
}

function updateTocActive() {
  elements.tocList.querySelectorAll(".toc-row").forEach((row, i) => {
    row.classList.toggle("active", i === state.chapterIndex);
  });
}

function renderToc() {
  if (!state.book) {
    elements.tocList.innerHTML = "";
    return;
  }

  const tocItems = [];
  let lastPartTitle = "";

  state.book.chapters.forEach((chapter, index) => {
    const partTitle = String(chapter.partTitle || "").trim();
    if (partTitle && partTitle !== lastPartTitle) {
      tocItems.push(`<li class="toc-group"><span class="toc-group-label">${escapeHtml(partTitle)}</span></li>`);
      lastPartTitle = partTitle;
    }

    const activeClass = index === state.chapterIndex ? "toc-row active" : "toc-row";
    const title = escapeHtml(chapter.title || `${t("chapter")} ${index + 1}`);
    tocItems.push(`<li class="${activeClass}" data-chapter-index="${index}"><a href="#" class="toc-link"><span class="toc-index">${index + 1}.</span><span class="toc-title">${title}</span></a></li>`);
  });

  elements.tocList.innerHTML = tocItems.join("");

  elements.tocList.querySelectorAll("li[data-chapter-index]").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      const index = Number(item.dataset.chapterIndex);
      renderChapter(index, 0);
      debouncedProgressSave();
    });
  });
}

function renderChapter(index, restoreScrollTop = 0) {
  if (!state.book) return;
  const safeIndex = clamp(index, 0, state.book.chapters.length - 1);
  state.chapterIndex = safeIndex;
  const chapter = state.book.chapters[safeIndex];
  const total = state.book.chapters.length;

  const footnotes = chapter.footnotes || [];
  const footnotesItemsHtml = footnotes
    .map((note) => {
      const safeLabel = escapeHtml(String(note.label ?? ""));
      return `<div class="note-item"><span class="note-label">[${safeLabel}]</span>${note.content}</div>`;
    })
    .join("");
  const footnotesHtml = footnotes.length
    ? `<section class="footnotes"><h3>${t("footnotes")}</h3>${footnotesItemsHtml}</section>`
    : "";

  const navHtml = `<div class="chapter-nav">
    <button class="btn chapter-nav-prev"${safeIndex === 0 ? " disabled" : ""}>${t("prevChapter")}</button>
    <span class="chapter-nav-meta"></span>
    <button class="btn chapter-nav-next"${safeIndex === total - 1 ? " disabled" : ""}>${t("nextChapter")}</button>
    <span class="chapter-nav-progress"></span>
  </div>`;

  elements.readerContent.innerHTML = sanitizeHtml(chapter.content + footnotesHtml) + navHtml;
  elements.readerContent.scrollTop = Math.max(0, restoreScrollTop);

  elements.readerContent.querySelector(".chapter-nav-prev")?.addEventListener("click", () => {
    if (!state.book) return;
    renderChapter(state.chapterIndex - 1, 0);
    debouncedProgressSave();
  });
  elements.readerContent.querySelector(".chapter-nav-next")?.addEventListener("click", () => {
    if (!state.book) return;
    renderChapter(state.chapterIndex + 1, 0);
    debouncedProgressSave();
  });

  updateTocActive();
  updateMeta();
  syncProgressMeta();
}

function clearPanelTimer() {
  if (state.autoHideTimer) {
    clearTimeout(state.autoHideTimer);
    state.autoHideTimer = null;
  }
}

function closePanels() {
  elements.settingsPanel.classList.add("hidden");
  elements.tocPanel.classList.add("hidden");
  state.activePanel = null;
  clearPanelTimer();
  updateHeaderFadeByScroll();
}

function schedulePanelAutoHide() {
  clearPanelTimer();
  // Если курсор над панелью — не запускаем таймер; он запустится при уходе курсора
  if (state.panelHovered) return;
  state.autoHideTimer = setTimeout(() => {
    closePanels();
  }, 5000);
}

function openPanel(panelName) {
  if (panelName === "settings") {
    elements.tocPanel.classList.add("hidden");
    elements.settingsPanel.classList.remove("hidden");
    state.activePanel = "settings";
  } else if (panelName === "toc") {
    elements.settingsPanel.classList.add("hidden");
    elements.tocPanel.classList.remove("hidden");
    state.activePanel = "toc";
  }
  document.body.classList.remove("header-faded");
  schedulePanelAutoHide();
}

function togglePanel(panelName) {
  if (state.activePanel === panelName) {
    closePanels();
    return;
  }
  openPanel(panelName);
}

function updateHeaderFadeByScroll() {
  const shouldFade = elements.readerContent.scrollTop > 24 && !state.headerForcedVisible && !state.activePanel;
  document.body.classList.toggle("header-faded", shouldFade);
}

function forceHeaderVisible(value) {
  state.headerForcedVisible = value;
  document.body.classList.toggle("header-force-visible", value);
  if (value) {
    document.body.classList.remove("header-faded");
    return;
  }
  updateHeaderFadeByScroll();
}


function buildProgressPayload() {
  const currentChapterIndex = state.chapterIndex;
  const currentChapter = state.chapterIndex + 1;

  const completedTextBefore = state.book.chapterSizes
    .slice(0, currentChapterIndex)
    .reduce((sum, value) => sum + value, 0);

  const maxScrollable = Math.max(1, elements.readerContent.scrollHeight - elements.readerContent.clientHeight);
  const chapterScrollRatio = clamp(elements.readerContent.scrollTop / maxScrollable, 0, 1);
  const currentChapterSize = state.book.chapterSizes[currentChapterIndex] || 1;
  const readInCurrentChapter = Math.round(currentChapterSize * chapterScrollRatio);
  const readTextTotal = completedTextBefore + readInCurrentChapter;
  const progress = clamp(Math.round((readTextTotal / state.book.totalBookSize) * 100), 0, 100);

  return {
    currentChapter,
    currentPosition: {
      chapter: currentChapter,
      scrollTop: elements.readerContent.scrollTop,
      scrollHeight: elements.readerContent.scrollHeight,
      clientHeight: elements.readerContent.clientHeight,
      timestamp: Date.now(),
    },
    progress,
  };
}

function canAutoAdvanceChapter() {
  return Boolean(
    state.book
    && state.chapterIndex < state.book.chapters.length - 1
    && Date.now() >= state.chapterTransitionUntil
  );
}

function isReaderAtBottom() {
  return elements.readerContent.scrollTop + elements.readerContent.clientHeight >= elements.readerContent.scrollHeight - 2;
}

// Сколько wheel-тиков у самого дна главы нужно для перехода.
// Замедление в зоне 80–100% уже создаёт задержку, поэтому достаточно 2 тиков.
const BOTTOM_STICK_TICKS = 2;

// Процент прокрутки, начиная с которого скролл начинает плавно замедляться.
const SLOW_ZONE_START = 0.8;
// Процент прокрутки, до которого скролл плавно ускоряется (зеркало SLOW_ZONE_START).
const FAST_ZONE_END = 0.2;

function goToNextChapterFromScroll() {
  if (!canAutoAdvanceChapter() || !isReaderAtBottom()) {
    state.bottomScrollTicks = 0;
    return false;
  }
  state.bottomScrollTicks += 1;
  if (state.bottomScrollTicks < BOTTOM_STICK_TICKS) return false;
  state.bottomScrollTicks = 0;
  state.chapterTransitionUntil = Date.now() + 700;
  renderChapter(state.chapterIndex + 1, 0);
  debouncedProgressSave();
  return true;
}

function syncProgressMeta() {
  const progressEl = elements.readerContent.querySelector(".chapter-nav-progress");
  if (!progressEl || !state.book) return;
  const payload = buildProgressPayload();
  progressEl.textContent = `${t("progress")}: ${payload.progress}%`;
}

const debouncedProgressSave = debounce(async () => {
  if (!state.book) return;
  const payload = buildProgressPayload();
  await saveProgress(state.book.id, payload);
  syncProgressMeta();
}, 900);

const debouncedSyncMeta = debounce(syncProgressMeta, 150);

async function persistLastBook() {
  if (!state.book) return;
  await storageSet(STORAGE_KEYS.lastBook, {
    id: state.book.id,
    title: state.book.title,
    format: state.book.format,
    chapters: state.book.chapters,
    cacheSchemaVersion: BOOK_CACHE_SCHEMA_VERSION,
    savedAt: Date.now(),
  });
}

async function openBookFromFile(file) {
  const parsed = await parseBookFile(file);
  const fingerprint = await sha256ForFile(file);

  state.book = {
    ...parsed,
    id: fingerprint,
  };

  state.book = withBookMetrics(state.book);

  elements.bookTitle.textContent = state.book.title;
  renderToc();

  await persistLastBook();

  const savedProgress = await loadProgress(state.book.id);
  if (savedProgress?.currentPosition?.chapter) {
    const chapterIndex = clamp(savedProgress.currentPosition.chapter - 1, 0, state.book.chapters.length - 1);
    renderChapter(chapterIndex, savedProgress.currentPosition.scrollTop || 0);
  } else {
    renderChapter(0, 0);
  }
}

async function openLastBook() {
  const cached = await storageGet(STORAGE_KEYS.lastBook);
  if (cached?.cacheSchemaVersion !== BOOK_CACHE_SCHEMA_VERSION) {
    alert(t("cacheOutdated"));
    return;
  }

  if (!cached?.chapters?.length) {
    alert(t("noRecentBook"));
    return;
  }

  showLoadingOverlay();

  try {
    state.book = {
      id: cached.id,
      title: cached.title,
      format: cached.format,
      chapters: cached.chapters,
    };

    state.book = withBookMetrics(state.book);

    elements.bookTitle.textContent = state.book.title;
    renderToc();
    const savedProgress = await loadProgress(state.book.id);
    if (savedProgress?.currentPosition?.chapter) {
      const chapterIndex = clamp(savedProgress.currentPosition.chapter - 1, 0, state.book.chapters.length - 1);
      renderChapter(chapterIndex, savedProgress.currentPosition.scrollTop || 0);
    } else {
      renderChapter(0, 0);
    }
  } finally {
    hideLoadingOverlay();
  }
}

function applySettingsToControls(settings) {
  elements.controls.fontSize.value = String(settings.fontSize);
  elements.controls.fontSizeValue.textContent = `${settings.fontSize}px`;

  elements.controls.fontFamily.value = settings.fontFamily;

  elements.controls.lineHeight.value = String(settings.lineHeight);
  elements.controls.lineHeightValue.textContent = settings.lineHeight.toFixed(1);

  elements.controls.contentWidth.value = String(settings.contentWidth);
  elements.controls.contentWidthValue.textContent = `${settings.contentWidth}%`;

  elements.controls.textAlign.value = settings.textAlign;
  elements.controls.theme.value = settings.theme;
}

async function commitSettings(nextSettings) {
  state.settings = { ...nextSettings };
  // Блокируем закрытие панели по scroll на два кадра браузера:
  // первый rAF — задержка до следующего рендера, второй — до кадра после него,
  // когда браузер реально доставляет scroll-событие от перекомпоновки DOM.
  state.preventScrollClose = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { state.preventScrollClose = false; });
  });
  applySettings(state.settings);
  applySettingsToControls(state.settings);
  await saveSettings(state.settings);
}

function bindSettings() {
  elements.controls.fontSize.addEventListener("input", async (event) => {
    schedulePanelAutoHide();
    const fontSize = Number(event.target.value);
    await commitSettings({ ...state.settings, fontSize });
  });

  elements.controls.fontFamily.addEventListener("change", async (event) => {
    schedulePanelAutoHide();
    await commitSettings({ ...state.settings, fontFamily: event.target.value });
  });

  elements.controls.lineHeight.addEventListener("input", async (event) => {
    schedulePanelAutoHide();
    const lineHeight = Number(event.target.value);
    await commitSettings({ ...state.settings, lineHeight });
  });

  elements.controls.contentWidth.addEventListener("input", async (event) => {
    schedulePanelAutoHide();
    const contentWidth = Number(event.target.value);
    await commitSettings({ ...state.settings, contentWidth });
  });

  elements.controls.textAlign.addEventListener("change", async (event) => {
    schedulePanelAutoHide();
    await commitSettings({ ...state.settings, textAlign: event.target.value });
  });

  elements.controls.theme.addEventListener("change", async (event) => {
    schedulePanelAutoHide();
    await commitSettings({ ...state.settings, theme: event.target.value });
  });

  elements.resetSettings.addEventListener("click", async () => {
    schedulePanelAutoHide();
    await commitSettings({ ...DEFAULT_SETTINGS });
  });
}

function showLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.remove("hidden");
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.classList.add("hidden");
}

async function handleFileInputChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  showLoadingOverlay();

  try {
    await openBookFromFile(file);
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const localizedMsg = t(rawMsg) || rawMsg;
    alert(`${t("openFailed")}: ${localizedMsg}`);
  } finally {
    hideLoadingOverlay();
  }
}

async function handleOpenLastClick() {
  try {
    await openLastBook();
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    const localizedMsg = t(rawMsg) || rawMsg;
    alert(`${t("openFailed")}: ${localizedMsg}`);
  }
}

async function fileFromPendingPayload(payload) {
  const rawBase64 = String(payload?.dataBase64 || "").trim();
  if (!rawBase64) return null;

  const binary = atob(rawBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }

  const fileName = String(payload?.name || "book.epub");
  const fileType = String(payload?.type || "application/octet-stream");
  const lastModified = Number(payload?.lastModified || Date.now());

  return new File([bytes], fileName, { type: fileType, lastModified });
}

async function openPendingBookFromStorage() {
  const payload = await storageGet(STORAGE_KEYS.pendingBookUpload);
  if (!payload) return false;

  await storageRemove(STORAGE_KEYS.pendingBookUpload);
  const pendingFile = await fileFromPendingPayload(payload);
  if (!pendingFile) return false;
  await openBookFromFile(pendingFile);
  return true;
}

function bindPanelActivityReset() {
  [elements.settingsPanel, elements.tocPanel].forEach((panel) => {
    ["mousemove", "wheel", "keydown", "click"].forEach((eventName) => {
      panel.addEventListener(eventName, () => {
        if (state.activePanel) {
          schedulePanelAutoHide();
        }
      });
    });

    panel.addEventListener("focusin", () => {
      clearPanelTimer();
    });

    panel.addEventListener("focusout", (event) => {
      if (!panel.contains(event.relatedTarget)) {
        if (state.activePanel) {
          schedulePanelAutoHide();
        }
      }
    });
  });

  document.addEventListener("mouseup", () => {
    if (state.activePanel) {
      schedulePanelAutoHide();
    }
  });
}

function bindReaderScrollHandlers() {
  elements.readerContent.addEventListener("scroll", () => {
    if (state.activePanel && !state.preventScrollClose) {
      closePanels();
    }
    debouncedProgressSave();
    debouncedSyncMeta();
    updateHeaderFadeByScroll();
  });

  elements.readerContent.addEventListener("wheel", (event) => {
    if (event.deltaY <= 0) return;

    const el = elements.readerContent;
    const maxScrollable = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = clamp(el.scrollTop / maxScrollable, 0, 1);

    if (state.book && ratio < FAST_ZONE_END) {
      event.preventDefault();
      const tFast = ratio / FAST_ZONE_END;
      const speedFactor = 0.1 + 0.9 * tFast;
      el.scrollTop += event.deltaY * speedFactor;
    } else if (state.book && ratio >= SLOW_ZONE_START) {
      event.preventDefault();
      const tSlow = (ratio - SLOW_ZONE_START) / (1 - SLOW_ZONE_START);
      const speedFactor = 1 - 0.9 * tSlow;
      el.scrollTop += event.deltaY * speedFactor;
    }

    if (goToNextChapterFromScroll()) {
      event.preventDefault();
    }
  }, { passive: false });
}

function bindKeyboardNavigation() {
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (isReaderAtBottom() && canAutoAdvanceChapter()) {
      event.preventDefault();
      state.bottomScrollTicks = 0;
      state.chapterTransitionUntil = Date.now() + 700;
      renderChapter(state.chapterIndex + 1, 0);
      debouncedProgressSave();
    }
  });
}

function bindHeaderHoverHandlers() {
  elements.headerHoverZone.addEventListener("mouseenter", () => forceHeaderVisible(true));
  elements.headerHoverZone.addEventListener("mouseleave", () => forceHeaderVisible(false));
  elements.header.addEventListener("mouseenter", () => forceHeaderVisible(true));
  elements.header.addEventListener("mouseleave", () => forceHeaderVisible(false));
}

function bindPanelHoverHandlers() {
  const panels = [elements.tocPanel, elements.settingsPanel];
  panels.forEach((panel) => {
    panel.addEventListener("mouseenter", () => {
      // Курсор зашёл на панель — останавливаем таймер автоскрытия
      state.panelHovered = true;
      clearPanelTimer();
    });
    panel.addEventListener("mouseleave", () => {
      // Курсор ушёл с панели — запускаем обратный отсчёт
      state.panelHovered = false;
      if (state.activePanel) schedulePanelAutoHide();
    });
  });
}

function bindOutsidePanelCloseHandler() {
  document.addEventListener("click", (event) => {
    if (!state.activePanel) return;
    const target = event.target;
    const inSettings = elements.settingsPanel.contains(target);
    const inToc = elements.tocPanel.contains(target);
    const onSettingsBtn = elements.toggleSettings.contains(target);
    const onTocBtn = elements.toggleToc.contains(target);
    if (!inSettings && !inToc && !onSettingsBtn && !onTocBtn) {
      closePanels();
    }
  });
}

function bindUnloadFlush() {
  window.addEventListener("beforeunload", () => {
    debouncedProgressSave.flush();
  });
}



function bindReaderEvents() {
  if (elements.pickFile) elements.pickFile.addEventListener("click", () => elements.fileInput?.click());
  if (elements.fileInput) elements.fileInput.addEventListener("change", handleFileInputChange);

  if (elements.openLast) elements.openLast.addEventListener("click", handleOpenLastClick);

  if (elements.toggleSettings) elements.toggleSettings.addEventListener("click", () => {
    togglePanel("settings");
  });

  if (elements.toggleToc) elements.toggleToc.addEventListener("click", () => {
    togglePanel("toc");
  });

  bindPanelActivityReset();
  bindReaderScrollHandlers();
  bindKeyboardNavigation();
  bindHeaderHoverHandlers();
  bindPanelHoverHandlers();
  bindOutsidePanelCloseHandler();
  bindUnloadFlush();
}

async function maybeAutoActionFromUrl() {
  const params = new URLSearchParams(location.search);

  if (params.get("pending") === "1") {
    showLoadingOverlay();
    try {
      await openPendingBookFromStorage();
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      const localizedMsg = t(rawMsg) || rawMsg;
      alert(`${t("openFailed")}: ${localizedMsg}`);
    } finally {
      hideLoadingOverlay();
    }
    return;
  }

  if (params.get("pick") === "1") {
    if (elements.fileInput) {
      elements.fileInput.click();
    } else {
      elements.pickFile?.focus();
    }
    return;
  }

  if (params.get("last") === "1") {
    await openLastBook();
  }
}

function bindAbout() {
  if (!elements.aboutBtn || !elements.aboutModal) return;

  elements.aboutBtn.addEventListener("click", () => {
    elements.aboutModal.showModal();
  });

  if (elements.aboutClose) {
    elements.aboutClose.addEventListener("click", () => {
      elements.aboutModal.close();
    });
  }

  elements.aboutModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    elements.aboutModal.close();
  });

  // Клик по оверлею (вне блока) закрывает модалку
  elements.aboutModal.addEventListener("click", (event) => {
    if (event.target === elements.aboutModal) {
      elements.aboutModal.close();
    }
  });
}

async function init() {
  await initI18n();
  applyI18n();

  state.settings = await loadSettings();
  applySettings(state.settings);
  applySettingsToControls(state.settings);

  bindSettings();
  bindReaderEvents();
  bindAbout();
  updateHeaderFadeByScroll();

  await maybeAutoActionFromUrl();
}

await init();
