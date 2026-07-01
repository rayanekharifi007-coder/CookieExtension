chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.removed) {
  
  }
});


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
    return true; 
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '🚀' });
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
});
