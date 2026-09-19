const STORAGE_KEYS = {
  lastBook: "lastBook",
};

async function storageGet(key) {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

chrome.action.onClicked.addListener(async () => {
  const last = await storageGet(STORAGE_KEYS.lastBook);
  if (last && Array.isArray(last.chapters) && last.chapters.length > 0) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("reader.html?last=1") });
    return;
  }

  // Tabs work in Firefox Desktop and Firefox for Android; windows.create does not.
  await chrome.tabs.create({ url: chrome.runtime.getURL("filepicker.html") });
});
