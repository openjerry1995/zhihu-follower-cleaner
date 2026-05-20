// State
let isRunning = false;
let removedCount = 0;

// DOM Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const counterValue = document.getElementById('counterValue');
const delayInput = document.getElementById('delayInput');
const jitterInput = document.getElementById('jitterInput');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const navigateBtn = document.getElementById('navigateBtn');
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');

// Initialize
function init() {
  loadSettings();
  setupEventListeners();
  checkExistingState();
}

function loadSettings() {
  chrome.storage.local.get(['delay', 'jitter', 'removedCount'], (result) => {
    if (result.delay) delayInput.value = result.delay;
    if (result.jitter) jitterInput.value = result.jitter;
    if (result.removedCount) {
      removedCount = result.removedCount;
      counterValue.textContent = removedCount;
    }
  });
}

function saveSettings() {
  chrome.storage.local.set({
    delay: parseInt(delayInput.value),
    jitter: parseInt(jitterInput.value),
    removedCount: removedCount
  });
}

function setupEventListeners() {
  startBtn.addEventListener('click', startRemoval);
  stopBtn.addEventListener('click', stopRemoval);
  navigateBtn.addEventListener('click', navigateToFollowers);
  clearLogBtn.addEventListener('click', clearLog);

  delayInput.addEventListener('change', saveSettings);
  jitterInput.addEventListener('change', saveSettings);
}

function checkExistingState() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError) {
          updateStatus('idle');
          return;
        }
        if (response?.isRunning) {
          isRunning = true;
          updateStatus('running');
          startBtn.disabled = true;
          stopBtn.disabled = false;
        }
      });
    }
  });
}

function updateStatus(status, message = '') {
  statusDot.className = 'status-dot';

  switch (status) {
    case 'running':
      statusDot.classList.add('active');
      statusText.textContent = message || 'Running...';
      break;
    case 'paused':
      statusDot.classList.add('paused');
      statusText.textContent = message || 'Paused';
      break;
    case 'error':
      statusDot.classList.add('error');
      statusText.textContent = message || 'Error';
      break;
    default:
      statusText.textContent = message || 'Ready';
  }
}

function addLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span>${message}`;

  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  // Keep only last 50 entries
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function clearLog() {
  logContainer.innerHTML = '<div class="log-entry log-info">Log cleared</div>';
}

function updateCounter(count) {
  removedCount = count;
  counterValue.textContent = count;
  saveSettings();
}

function startRemoval() {
  const delay = parseInt(delayInput.value);
  const jitter = parseInt(jitterInput.value);

  if (delay < 500 || delay > 10000) {
    addLog('Delay must be between 500-10000ms', 'error');
    return;
  }

  if (jitter < 0 || jitter > 50) {
    addLog('Jitter must be between 0-50%', 'error');
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      addLog('No active tab found', 'error');
      return;
    }

    const tab = tabs[0];

    if (!tab.url?.includes('zhihu.com')) {
      addLog('Please navigate to Zhihu first', 'warning');
      return;
    }

    // Check if we're on the followers page
    if (!tab.url?.includes('/followers')) {
      addLog('Navigating to followers page...', 'info');
      chrome.tabs.update(tab.id, { url: getFollowersUrl(tab.url) }, () => {
        // Wait for navigation then start
        setTimeout(() => {
          sendStartMessage(tab.id, delay, jitter);
        }, 2000);
      });
      return;
    }

    sendStartMessage(tab.id, delay, jitter);
  });
}

function getFollowersUrl(currentUrl) {
  // Extract user ID from current URL and construct followers URL
  const match = currentUrl.match(/zhihu\.com\/people\/([^\/]+)/);
  if (match) {
    return `https://www.zhihu.com/people/${match[1]}/followers`;
  }
  return 'https://www.zhihu.com/settings/followers';
}

function sendStartMessage(tabId, delay, jitter) {
  chrome.tabs.sendMessage(tabId, {
    action: 'start',
    delay: delay,
    jitter: jitter
  }, (response) => {
    if (chrome.runtime.lastError) {
      addLog('Failed to communicate with page. Try refreshing.', 'error');
      updateStatus('error', 'Connection error');
      return;
    }

    if (response?.success) {
      isRunning = true;
      updateStatus('running');
      startBtn.disabled = true;
      stopBtn.disabled = false;
      addLog('Started removing followers', 'success');
    } else {
      addLog(response?.error || 'Failed to start', 'error');
    }
  });
}

function stopRemoval() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;

    chrome.tabs.sendMessage(tabs[0].id, { action: 'stop' }, (response) => {
      if (chrome.runtime.lastError) {
        addLog('Failed to stop process', 'error');
        return;
      }

      isRunning = false;
      updateStatus('idle');
      startBtn.disabled = false;
      stopBtn.disabled = true;
      addLog('Stopped', 'warning');
    });
  });
}

function navigateToFollowers() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;

    const tab = tabs[0];
    let followersUrl = 'https://www.zhihu.com/settings/followers';

    if (tab.url?.includes('zhihu.com/people/')) {
      followersUrl = getFollowersUrl(tab.url);
    }

    chrome.tabs.update(tab.id, { url: followersUrl });
    addLog('Navigating to followers page...', 'info');
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateCounter') {
    updateCounter(message.count);
  }

  if (message.action === 'addLog') {
    addLog(message.message, message.type);
  }

  if (message.action === 'updateStatus') {
    updateStatus(message.status, message.message);
    if (message.status === 'idle' || message.status === 'error') {
      isRunning = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }

  sendResponse({ received: true });
  return true;
});

// Initialize on load
init();
