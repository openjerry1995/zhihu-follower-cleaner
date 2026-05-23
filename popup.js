// Popup / Side Panel UI Controller
// Communicates with background.js for all operations

let isRunning = false;

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const totalValue = document.getElementById('totalValue');
const counterValue = document.getElementById('counterValue');
const skippedValue = document.getElementById('skippedValue');
const delayInput = document.getElementById('delayInput');
const jitterInput = document.getElementById('jitterInput');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const navigateBtn = document.getElementById('navigateBtn');
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');

function init() {
  loadSettings();
  setupEventListeners();
  checkExistingState();
}

function loadSettings() {
  chrome.storage.local.get(['delay', 'jitter'], result => {
    if (result.delay) delayInput.value = result.delay;
    if (result.jitter) jitterInput.value = result.jitter;
  });
}

function saveSettings() {
  chrome.storage.local.set({
    delay: parseInt(delayInput.value),
    jitter: parseInt(jitterInput.value)
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
  chrome.runtime.sendMessage({ action: 'getStatus' }, response => {
    if (chrome.runtime.lastError || !response) {
      updateStatus('idle');
      return;
    }
    if (response.isRunning) {
      isRunning = true;
      updateStatus('running');
      startBtn.disabled = true;
      stopBtn.disabled = false;
    }
    totalValue.textContent = response.totalVisible || '-';
    counterValue.textContent = response.removedCount || 0;
    skippedValue.textContent = response.skippedCount || 0;
    if (response.progress) statusText.textContent = response.progress;
  });
}

function updateStatus(status, message) {
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

function addLog(message, type) {
  const time = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const entry = document.createElement('div');
  entry.className = 'log-entry log-' + (type || 'info');
  entry.innerHTML = '<span class="log-time">' + time + '</span>' + message;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function clearLog() {
  logContainer.innerHTML = '<div class="log-entry log-info">Log cleared</div>';
}

function startRemoval() {
  const delay = parseInt(delayInput.value);
  const jitter = parseInt(jitterInput.value);
  if (delay < 500 || delay > 10000) { addLog('Delay: 500-10000ms', 'error'); return; }
  if (jitter < 0 || jitter > 50) { addLog('Jitter: 0-50%', 'error'); return; }

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) { addLog('No active tab', 'error'); return; }
    const tab = tabs[0];

    if (!tab.url?.includes('zhihu.com')) {
      addLog('Please navigate to Zhihu first', 'warning');
      return;
    }

    chrome.runtime.sendMessage({
      action: 'start',
      tabId: tab.id,
      tabUrl: tab.url,
      delay: delay,
      jitter: jitter
    }, response => {
      if (chrome.runtime.lastError) {
        addLog('Error: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      if (response?.success) {
        isRunning = true;
        updateStatus('running');
        startBtn.disabled = true;
        stopBtn.disabled = false;
      } else {
        addLog(response?.error || 'Failed to start', 'error');
      }
    });
  });
}

function stopRemoval() {
  chrome.runtime.sendMessage({ action: 'stop' }, response => {
    if (response?.success) {
      isRunning = false;
      updateStatus('idle');
      startBtn.disabled = false;
      stopBtn.disabled = true;
      addLog('Stopped', 'warning');
    }
  });
}

function navigateToFollowers() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    const tab = tabs[0];
    let url = '';
    const match = (tab.url || '').match(/zhihu\.com\/people\/([^\/]+)/);
    if (match) {
      url = 'https://www.zhihu.com/people/' + match[1] + '/followers';
    } else {
      addLog('Navigate to your Zhihu profile first', 'warning');
      return;
    }
    chrome.tabs.update(tab.id, { url: url });
    addLog('Navigating to followers page...', 'info');
  });
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateCounter') {
    counterValue.textContent = message.count;
  } else if (message.action === 'addLog') {
    addLog(message.message, message.type);
  } else if (message.action === 'updateStatus') {
    updateStatus(message.status, message.message);
    if (message.status === 'idle' || message.status === 'error') {
      isRunning = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  } else if (message.action === 'updateStats') {
    if (message.totalVisible !== undefined) totalValue.textContent = message.totalVisible;
    if (message.removedCount !== undefined) counterValue.textContent = message.removedCount;
    if (message.skippedCount !== undefined) skippedValue.textContent = message.skippedCount;
  }
  sendResponse({ received: true });
  return true;
});

init();
