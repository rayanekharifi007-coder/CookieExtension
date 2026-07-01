/**
 * r4yane extension — background.js
 * Service worker: handles badge updates and cookie change listener.
 */

// Update badge when cookies change
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.removed) {
    // Cookie was removed — badge will update on next popup open
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DELETE_ALL_COOKIES') {
    chrome.cookies.getAll({ domain: message.domain }, (cookies) => {
      const promises = cookies.map(cookie => {
        const protocol = cookie.secure ? 'https:' : 'http:';
        const url = `${protocol}//${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`;
        return chrome.cookies.remove({ url, name: cookie.name });
      });
      Promise.all(promises).then(() => {
        sendResponse({ success: true, count: cookies.length });
      });
    });
    return true; // Keep message channel open for async response
  }
});

// On install, show a welcome badge
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '🚀' });
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
});
