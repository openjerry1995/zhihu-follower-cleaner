// Background Service Worker - Main Orchestrator
// Phase 1: Collect all followers by scrolling
// Phase 2: Block them one by one (no need to go back to followers list)

const STATE_KEY = 'zhihuCleanerState';
const SKIPPED_KEY = 'zhihuCleanerSkipped';
var loopActive = false;

function getState() {
  return new Promise(r => chrome.storage.local.get(STATE_KEY, res => r(res[STATE_KEY] || {})));
}
function setState(partial) {
  return new Promise(r => {
    chrome.storage.local.get(STATE_KEY, res => {
      const updated = Object.assign({}, res[STATE_KEY] || {}, partial);
      chrome.storage.local.set({ [STATE_KEY]: updated }, r);
    });
  });
}
function clearState() {
  return new Promise(r => chrome.storage.local.remove(STATE_KEY, r));
}
function getSkipped() {
  return new Promise(r => chrome.storage.local.get(SKIPPED_KEY, res => r(res[SKIPPED_KEY] || [])));
}
function setSkipped(tokens) {
  return new Promise(r => chrome.storage.local.set({ [SKIPPED_KEY]: tokens }, r));
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function getDelay(base, jitter) {
  var j = base * (jitter / 100);
  return Math.floor(Math.random() * (2 * j + 1)) + (base - j);
}
function log(msg, type) {
  console.log('[Zhihu Cleaner] ' + msg);
  chrome.runtime.sendMessage({ action: 'addLog', message: msg, type: type || 'info' }).catch(function() {});
}
function notify(action, data) {
  chrome.runtime.sendMessage(Object.assign({ action: action }, data || {})).catch(function() {});
}
function waitForTabLoad(tabId, timeout) {
  timeout = timeout || 15000;
  return new Promise(function(resolve) {
    var done = false;
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        done = true;
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(function() {
      if (!done) { chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }, timeout);
  });
}
async function findZhihuTab() {
  var tabs = await chrome.tabs.query({ url: '*://*.zhihu.com/*' });
  return tabs[0] || null;
}

// === Injected functions ===

// Get all tokens on current followers page
function injectGetAllTokens() {
  var items = document.querySelectorAll('.List-item .UserLink-link');
  var tokens = [];
  items.forEach(function(link) {
    var href = link.getAttribute('href') || '';
    var m = href.match(/people\/([^/?]+)/);
    if (m && tokens.indexOf(m[1]) === -1) tokens.push(m[1]);
  });
  return tokens;
}

// Click "下一页" button, returns true if clicked
function injectClickNextPage() {
  var btn = document.querySelector('.PaginationButton-next');
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
}

// Get total page count from pagination
function injectGetPageInfo() {
  var current = document.querySelector('.PaginationButton--current');
  var pageNum = 0;
  if (current) pageNum = parseInt(current.textContent.trim()) || 0;
  var buttons = document.querySelectorAll('.PaginationButton');
  var maxPage = 0;
  for (var i = 0; i < buttons.length; i++) {
    var n = parseInt(buttons[i].textContent.trim());
    if (n > maxPage) maxPage = n;
  }
  return { current: pageNum, total: maxPage };
}

function injectClickBlock() {
  var btns = document.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim().includes('屏蔽用户')) {
      btns[i].click();
      return true;
    }
  }
  return false;
}

function injectConfirmBlock() {
  var modal = document.querySelector('.Modal:not(.Modal-backdrop)');
  if (!modal) return false;
  var btns = modal.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === '确定') {
      btns[i].click();
      return true;
    }
  }
  return false;
}

function injectGetCurrentUser() {
  var links = document.querySelectorAll('a[href*="/people/"]');
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute('href') || '';
    var m = href.match(/people\/([^/?#]+)/);
    if (m) return m[1];
  }
  return null;
}

// === State Machine ===

async function runLoop() {
  if (loopActive) return;
  loopActive = true;
  try {
    await _runLoop();
  } catch (err) {
    log('Error: ' + err.message, 'error');
  } finally {
    loopActive = false;
  }
  var state = await getState();
  if (state.running) {
    setTimeout(function() { runLoop(); }, 500);
  }
}

async function _runLoop() {
  var state = await getState();
  if (!state.running || !state.followersUrl) return;

  var tab = await findZhihuTab();
  if (!tab) {
    log('No Zhihu tab, will retry...', 'warning');
    return;
  }

  // If off-track, navigate to followers or profile as needed
  var onFollowers = tab.url.includes('/followers');
  var onProfile = tab.url.includes('/people/') && !onFollowers;

  if (state.phase === 'collectFollowers' && !onFollowers) {
    log('Navigating to followers page...', 'info');
    await chrome.tabs.update(tab.id, { url: state.followersUrl });
    await waitForTabLoad(tab.id);
    await sleep(2000);
    return;
  }

  if (state.phase === 'blockAll' && !onProfile && state.currentIndex < state.allTokens.length) {
    var nextToken = state.allTokens[state.currentIndex];
    await chrome.tabs.update(tab.id, { url: 'https://www.zhihu.com/people/' + nextToken });
    await waitForTabLoad(tab.id);
    await sleep(1500);
    return;
  }

  if (state.phase === 'collectFollowers') {
    await collectFollowers(state, tab.id);
  } else if (state.phase === 'blockAll') {
    await blockNext(state, tab.id);
  }
}

// === Phase 1: Collect all followers via pagination ===

async function collectFollowers(state, tabId) {
  var skippedTokens = await getSkipped();
  var collected = state.allTokens || [];

  // Get total pages
  var pageInfo;
  try {
    var infoResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: injectGetPageInfo
    });
    pageInfo = infoResult[0].result;
  } catch (e) { return; }

  var totalPages = pageInfo.total || 1;
  var currentPage = pageInfo.current || 1;

  log('Collecting followers... Page ' + currentPage + '/' + totalPages, 'info');

  // Collect from current page
  var pageResult;
  try {
    pageResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: injectGetAllTokens
    });
  } catch (e) { return; }

  var pageTokens = pageResult[0].result;
  for (var i = 0; i < pageTokens.length; i++) {
    if (collected.indexOf(pageTokens[i]) === -1) {
      collected.push(pageTokens[i]);
    }
  }

  // If more pages, click next and save progress
  if (currentPage < totalPages) {
    // Save what we have so far
    await setState({ allTokens: collected });

    log('Page ' + currentPage + '/' + totalPages + ' — collected ' + collected.length + ' so far', 'info');

    // Click next page
    var nextResult;
    try {
      nextResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: injectClickNextPage
      });
    } catch (e) { return; }

    if (nextResult[0].result) {
      var waitTime = getDelay(state.delay || 2000, state.jitter || 20);
      await sleep(waitTime);
      // Stay in collectFollowers phase, next runLoop will continue
      return;
    }
  }

  // Done collecting — filter out skipped
  var toProcess = collected.filter(function(t) { return skippedTokens.indexOf(t) === -1; });

  log('Collection done! Total: ' + collected.length + ', To process: ' + toProcess.length + ', Skipped: ' + skippedTokens.length, 'success');

  if (toProcess.length === 0) {
    log('All followers are already skipped. Nothing to do.', 'warning');
    await clearState();
    notify('updateStatus', { status: 'idle', message: 'Nothing to do' });
    return;
  }

  await setState({
    phase: 'blockAll',
    allTokens: toProcess,
    currentIndex: 0,
    totalCollected: collected.length
  });

  notify('updateStats', {
    totalVisible: collected.length,
    removedCount: 0,
    skippedCount: skippedTokens.length
  });

  // Navigate to first follower
  var firstToken = toProcess[0];
  await chrome.tabs.update(tabId, { url: 'https://www.zhihu.com/people/' + firstToken });
  await waitForTabLoad(tabId);
  await sleep(1500);
}

// === Phase 2: Block followers one by one ===

async function blockNext(state, tabId) {
  var idx = state.currentIndex || 0;
  var tokens = state.allTokens || [];

  if (idx >= tokens.length) {
    log('All followers processed! Removed: ' + (state.removedCount || 0), 'success');
    await clearState();
    notify('updateStatus', { status: 'idle', message: 'Finished' });
    return;
  }

  var token = tokens[idx];
  log('Blocking ' + (idx + 1) + '/' + tokens.length + ': ' + token, 'info');

  // Click block
  var blockResult;
  try {
    blockResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: injectClickBlock
    });
  } catch (e) {
    log('Script injection failed, will retry...', 'warning');
    return;
  }

  if (!blockResult || !blockResult[0] || !blockResult[0].result) {
    // Block button not found — restricted user, skip
    log('Cannot block ' + token + ' (restricted?), skipping', 'warning');
    var skipped = (await getSkipped()).concat([token]);
    await setSkipped(skipped);
    notify('updateStats', { skippedCount: skipped.length });
    await setState({ currentIndex: idx + 1 });
    // Navigate to next
    if (idx + 1 < tokens.length) {
      await chrome.tabs.update(tabId, { url: 'https://www.zhihu.com/people/' + tokens[idx + 1] });
      await waitForTabLoad(tabId);
      await sleep(1500);
    }
    return;
  }

  log('Clicked block: ' + token, 'info');
  await sleep(1000);

  // Confirm dialog
  try {
    var confirmResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: injectConfirmBlock
    });
    if (confirmResult && confirmResult[0] && confirmResult[0].result) {
      log('Confirmed: ' + token, 'info');
    }
  } catch (e) {}

  var newCount = (state.removedCount || 0) + 1;
  await setState({ removedCount: newCount, currentIndex: idx + 1 });
  notify('updateCounter', { count: newCount });
  notify('updateStats', { removedCount: newCount });
  log('Removed #' + newCount + ': ' + token, 'success');

  // Wait with jitter
  var waitTime = getDelay(state.delay || 2000, state.jitter || 20);
  log('Waiting ' + waitTime + 'ms...', 'info');
  await sleep(waitTime);

  // Check stop
  var s = await getState();
  if (!s.running) return;

  // Navigate to next follower
  if (idx + 1 < tokens.length) {
    await chrome.tabs.update(tabId, { url: 'https://www.zhihu.com/people/' + tokens[idx + 1] });
    await waitForTabLoad(tabId);
    await sleep(1500);
  }
}

// === Start helper ===

function startWithUser(urlToken, tabId, message, sendResponse) {
  var followersUrl = 'https://www.zhihu.com/people/' + urlToken + '/followers';
  getSkipped().then(function(skippedTokens) {
    setState({
      running: true,
      phase: 'collectFollowers',
      followersUrl: followersUrl,
      tabId: tabId,
      allTokens: [],
      currentIndex: 0,
      removedCount: 0,
      totalCollected: 0,
      delay: message.delay || 2000,
      jitter: message.jitter || 20
    }).then(function() {
      log('Starting... (existing skipped: ' + skippedTokens.length + ')', 'info');
      notify('updateStatus', { status: 'running', message: 'Collecting followers...' });
      sendResponse({ success: true });
      runLoop();
    });
  });
}

// === Message Handler ===

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'start') {
    var tabId = message.tabId;
    var tabUrl = message.tabUrl || '';

    var match = tabUrl.match(/zhihu\.com\/people\/([^\/?#]+)/);
    if (match) {
      startWithUser(match[1], tabId, message, sendResponse);
      return true;
    }

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: injectGetCurrentUser
    }, function(results) {
      if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
        sendResponse({ success: false, error: 'Cannot detect your Zhihu profile.' });
        return;
      }
      startWithUser(results[0].result, tabId, message, sendResponse);
    });
    return true;
  }

  if (message.action === 'stop') {
    loopActive = false;
    clearState().then(function() {
      log('Stopped', 'warning');
      notify('updateStatus', { status: 'idle', message: 'Stopped' });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'getStatus') {
    getState().then(function(s) {
      getSkipped().then(function(skipped) {
        var total = (s.allTokens || []).length;
        var idx = s.currentIndex || 0;
        sendResponse({
          isRunning: s.running || false,
          removedCount: s.removedCount || 0,
          skippedCount: skipped.length,
          totalVisible: s.totalCollected || total,
          progress: total > 0 ? (idx + '/' + total) : '',
          currentToken: s.currentToken || ''
        });
      });
    });
    return true;
  }

  sendResponse({ success: false, error: 'Unknown action' });
  return true;
});

// === Keep alive & auto-resume ===

chrome.alarms.create('keepAlive', { periodInMinutes: 0.25 });

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'keepAlive') {
    getState().then(function(s) {
      if (s.running) {
        console.log('[Zhihu Cleaner] Alarm check, phase: ' + s.phase);
        runLoop();
      }
    });
  }
});

chrome.runtime.onStartup.addListener(function() {
  getState().then(function(s) {
    if (s.running) runLoop();
  });
});

console.log('[Zhihu Cleaner] Background service worker loaded');
