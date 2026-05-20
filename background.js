// Background Service Worker for Zhihu Cleaner
// Handles extension lifecycle and storage

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Zhihu Cleaner] Extension installed');

    // Set default settings
    chrome.storage.local.set({
      delay: 2000,
      jitter: 20,
      removedCount: 0
    });
  } else if (details.reason === 'update') {
    console.log('[Zhihu Cleaner] Extension updated');
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[Zhihu Cleaner] Extension started');
});

// Keep service worker alive (prevent idle shutdown)
chrome.alarms.create('keepAlive', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Just ping to keep alive
  }
});

console.log('[Zhihu Cleaner] Background service worker loaded');
