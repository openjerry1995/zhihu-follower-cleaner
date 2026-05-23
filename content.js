// Content Script - Runs on Zhihu pages
// Removes followers via: block user -> unblock user
// Uses chrome.storage to persist state across page navigations

(function() {
  'use strict';

  if (window.__zhihuCleanerLoaded) return;
  window.__zhihuCleanerLoaded = true;

  const STATE_KEY = 'zhihuCleanerState';

  function notifyPopup(action, data = {}) {
    chrome.runtime.sendMessage({ action, ...data }).catch(() => {});
  }

  function log(message, type = 'info') {
    console.log('[Zhihu Cleaner] ' + message);
    notifyPopup('addLog', { message, type });
  }

  function getState() {
    return new Promise(function(resolve) {
      chrome.storage.local.get(STATE_KEY, function(result) {
        resolve(result[STATE_KEY] || {});
      });
    });
  }

  function setState(partial) {
    return new Promise(function(resolve) {
      chrome.storage.local.get(STATE_KEY, function(result) {
        const current = result[STATE_KEY] || {};
        const updated = Object.assign({}, current, partial);
        chrome.storage.local.set({ [STATE_KEY]: updated }, resolve);
      });
    });
  }

  function clearState() {
    return new Promise(function(resolve) {
      chrome.storage.local.remove(STATE_KEY, resolve);
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getDelay(baseDelay, jitterPercent) {
    const jitter = baseDelay * (jitterPercent / 100);
    const minDelay = baseDelay - jitter;
    const maxDelay = baseDelay + jitter;
    return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  }

  function findButtonByText(text) {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].textContent.trim().includes(text)) {
        return buttons[i];
      }
    }
    return null;
  }

  function findButtonInModal(text) {
    var modal = document.querySelector('.Modal:not(.Modal-backdrop)');
    if (!modal) return null;
    var buttons = modal.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].textContent.trim() === text) {
        return buttons[i];
      }
    }
    return null;
  }

  function getFollowerTokens() {
    var items = document.querySelectorAll('.List-item .UserLink-link');
    var tokens = [];
    items.forEach(function(link) {
      var href = link.getAttribute('href') || '';
      var match = href.match(/people\/([^/?]+)/);
      if (match && tokens.indexOf(match[1]) === -1) {
        tokens.push(match[1]);
      }
    });
    return tokens;
  }

  // Main logic: check state and act accordingly
  async function run() {
    var state = await getState();

    if (!state.running) return;

    if (state.phase === 'scrapeFollowers') {
      await scrapeFollowers(state);
    } else if (state.phase === 'blockUser') {
      await blockUser(state);
    } else if (state.phase === 'unblockUser') {
      await unblockUser(state);
    }
  }

  async function scrapeFollowers(state) {
    if (!window.location.href.includes('/followers')) {
      // Not on followers page, navigate
      log('Navigating to followers page...', 'info');
      window.location.href = state.followersUrl;
      return;
    }

    await sleep(2000);

    var tokens = getFollowerTokens();
    log('Found ' + tokens.length + ' followers on page', 'info');

    if (tokens.length === 0) {
      // Scroll and retry
      window.scrollBy(0, 800);
      await sleep(2000);
      tokens = getFollowerTokens();
      if (tokens.length === 0) {
        log('No more followers found. Done!', 'success');
        await clearState();
        notifyPopup('updateStatus', { status: 'idle', message: 'Finished' });
        return;
      }
    }

    // Pick first token that hasn't been skipped
    var skipped = state.skippedTokens || [];
    var token = null;
    for (var i = 0; i < tokens.length; i++) {
      if (skipped.indexOf(tokens[i]) === -1) {
        token = tokens[i];
        break;
      }
    }

    if (!token) {
      // All visible followers have been skipped/processed, scroll for more
      log('All current followers processed, scrolling...', 'info');
      window.scrollBy(0, 800);
      await sleep(2000);
      tokens = getFollowerTokens();
      for (var j = 0; j < tokens.length; j++) {
        if (skipped.indexOf(tokens[j]) === -1) {
          token = tokens[j];
          break;
        }
      }
      if (!token) {
        log('No more followers found. Done!', 'success');
        await clearState();
        notifyPopup('updateStatus', { status: 'idle', message: 'Finished' });
        return;
      }
    }

    log('Will block follower: ' + token, 'info');

    await setState({
      running: true,
      phase: 'blockUser',
      currentToken: token,
      followersUrl: state.followersUrl || window.location.href,
      removedCount: state.removedCount || 0,
      skippedTokens: skipped,
      delay: state.delay,
      jitter: state.jitter
    });

    // Navigate to user profile
    window.location.href = 'https://www.zhihu.com/people/' + token;
  }

  async function blockUser(state) {
    await sleep(1500);

    var blockBtn = findButtonByText('屏蔽用户');
    if (!blockBtn) {
      log('Block button not found for ' + state.currentToken + ', skipping (restricted user)', 'warning');
      var skipped = state.skippedTokens || [];
      skipped.push(state.currentToken);
      await setState({
        running: true,
        phase: 'scrapeFollowers',
        followersUrl: state.followersUrl,
        removedCount: state.removedCount || 0,
        skippedTokens: skipped,
        delay: state.delay,
        jitter: state.jitter
      });
      window.location.href = state.followersUrl;
      return;
    }

    blockBtn.click();
    log('Clicked block for ' + state.currentToken, 'info');
    await sleep(1000);

    // Handle confirmation modal — click "确定" button
    var confirmBtn = findButtonInModal('确定');
    if (confirmBtn) {
      confirmBtn.click();
      log('Confirmed block for ' + state.currentToken, 'info');
    } else {
      log('No confirmation dialog found, continuing...', 'warning');
    }
    await sleep(1000);

    await setState({
      running: true,
      phase: 'unblockUser',
      currentToken: state.currentToken,
      followersUrl: state.followersUrl,
      removedCount: state.removedCount || 0,
      skippedTokens: state.skippedTokens || [],
      delay: state.delay,
      jitter: state.jitter
    });

    // Stay on same page, switch to unblock phase
    await unblockUser(await getState());
  }

  async function unblockUser(state) {
    await sleep(500);

    var unblockBtn = findButtonByText('取消屏蔽');
    if (!unblockBtn) {
      log('Unblock button not found', 'warning');
    } else {
      unblockBtn.click();
      var newCount = (state.removedCount || 0) + 1;
      log('Unblocked ' + state.currentToken + ' — removed #' + newCount, 'success');
      notifyPopup('updateCounter', { count: newCount });
      state.removedCount = newCount;
    }

    await sleep(500);

    // Wait with jitter before returning
    var waitTime = getDelay(state.delay || 2000, state.jitter || 20);
    log('Waiting ' + waitTime + 'ms...', 'info');
    await sleep(waitTime);

    // Check if we should stop
    var currentState = await getState();
    if (!currentState.running) return;

    await setState({
      running: true,
      phase: 'scrapeFollowers',
      followersUrl: state.followersUrl,
      removedCount: state.removedCount,
      skippedTokens: state.skippedTokens || [],
      delay: state.delay,
      jitter: state.jitter
    });

    log('Returning to followers page...', 'info');
    window.location.href = state.followersUrl;
  }

  // Message handler
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'start':
        setState({
          running: true,
          phase: 'scrapeFollowers',
          followersUrl: window.location.href,
          removedCount: 0,
          delay: message.delay || 2000,
          jitter: message.jitter || 20
        }).then(function() {
          notifyPopup('updateStatus', { status: 'running', message: 'Running...' });
          log('Starting follower removal...', 'info');
          run();
          sendResponse({ success: true });
        });
        return true;

      case 'stop':
        clearState().then(function() {
          log('Stopped', 'warning');
          notifyPopup('updateStatus', { status: 'idle', message: 'Stopped' });
          sendResponse({ success: true });
        });
        return true;

      case 'getStatus':
        chrome.storage.local.get(STATE_KEY, function(result) {
          var s = result[STATE_KEY] || {};
          sendResponse({
            isRunning: s.running || false,
            removedCount: s.removedCount || 0,
            url: window.location.href
          });
        });
        return true;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    return true;
  });

  // On page load, check if there's an active task
  chrome.storage.local.get(STATE_KEY, function(result) {
    var state = result[STATE_KEY];
    if (state && state.running) {
      console.log('[Zhihu Cleaner] Resuming task, phase: ' + state.phase);
      // Small delay to let page fully render
      setTimeout(run, 1000);
    }
  });

  console.log('[Zhihu Cleaner] Content script loaded');
})();
