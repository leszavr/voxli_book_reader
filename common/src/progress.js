import { progressKey, storageGet, storageSet } from "./storage.js";

export async function loadProgress(bookId) {
  return (await storageGet(progressKey(bookId))) || null;
}

export async function saveProgress(bookId, payload) {
  await storageSet(progressKey(bookId), payload);
}

export function debounce(fn, delay) {
  let timeoutId = null;
  let lastArgs = null;
  const debounced = (...args) => {
    lastArgs = args;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => { fn(...lastArgs); timeoutId = null; }, delay);
  };
  debounced.flush = () => {
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; fn(...(lastArgs ?? [])); }
  };
  return debounced;
}
