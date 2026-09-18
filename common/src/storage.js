export const STORAGE_KEYS = {
  readerSettings: "readerSettings",
  lastBook: "lastBook",
  pendingBookUpload: "pendingBookUpload",
  localeMode: "localeMode",
  localeOverride: "localeOverride",
};

export function progressKey(bookId) {
  return `progress:${bookId}`;
}

export async function storageGet(key) {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

export async function storageSet(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (error) {
    if (String(error?.message).includes("QUOTA_BYTES")) throw new Error("storageFull");
    throw error;
  }
}

export async function storageRemove(key) {
  await chrome.storage.local.remove(key);
}
