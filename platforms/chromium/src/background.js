import { STORAGE_KEYS, storageGet } from "./storage.js";

// Track the filepicker window id to prevent duplicates
let filepickerWindowId = null;

chrome.action.onClicked.addListener(async () => {
  try {
    const last = await storageGet(STORAGE_KEYS.lastBook);
    if (last && Array.isArray(last.chapters) && last.chapters.length > 0) {
      await chrome.tabs.create({ url: chrome.runtime.getURL("reader.html?last=1") });
      return;
    }

    // No recent book — open filepicker popup to let user select file
    
    // Check if filepicker window is already open
    if (filepickerWindowId !== null) {
      try {
        // Try to focus existing window
        await chrome.windows.update(filepickerWindowId, { focused: true });
        return;
      } catch (e) {
        // Window was closed, reset the id
        filepickerWindowId = null;
      }
    }

    // Create new filepicker window
    const window = await chrome.windows.create({ 
      url: chrome.runtime.getURL("filepicker.html"), 
      type: "popup", 
      width: 560, 
      height: 360 
    });
    
    if (window && window.id) {
      filepickerWindowId = window.id;
      
      // Listen for window close to reset the id
      const handleWindowRemoved = (windowId) => {
        if (windowId === filepickerWindowId) {
          filepickerWindowId = null;
          chrome.windows.onRemoved.removeListener(handleWindowRemoved);
        }
      };
      
      chrome.windows.onRemoved.addListener(handleWindowRemoved);
    }
  } catch (error) {
    // Fallback: reset id and open reader page
    filepickerWindowId = null;
    await chrome.tabs.create({ url: chrome.runtime.getURL("reader.html") });
  }
});
