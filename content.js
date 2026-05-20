// Content Script - Runs on Zhihu pages
// Responsible for finding and clicking remove follower buttons

(function() {
  'use strict';

  let isRunning = false;
  let shouldStop = false;
  let delay = 2000;
  let jitterPercent = 20;
  let removedCount = 0;

  // Notify popup of status
  function notifyPopup(action, data = {}) {
    chrome.runtime.sendMessage({
      action,
      ...data
    }).catch(() => {
      // Popup might be closed, ignore error
    });
  }

  // Get randomized delay with jitter
  function getDelay() {
    const jitter = delay * (jitterPercent / 100);
    const minDelay = delay - jitter;
    const maxDelay = delay + jitter;
    return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  }

  // Sleep function
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Log to popup
  function log(message, type = 'info') {
    console.log(`[Zhihu Cleaner] ${message}`);
    notifyPopup('addLog', { message, type });
  }

  // Update counter
  function updateCounter() {
    removedCount++;
    notifyPopup('updateCounter', { count: removedCount });
  }

  // Find and click remove follower button for a specific list item
  async function removeFollower listItem) {
    try {
      // Zhihu's DOM structure for followers list:
      // Each follower is in a list item with various possible selectors

      // Method 1: Look for the more options button (...)
      // This is typically an icon button with aria-label or specific class
      const moreButton = listItem.querySelector(`
        button[aria-label*="更多"],
        button[aria-label*="more"],
        .List-itemToolbar button,
        .Popover-button,
        button[class*="More"],
        button[class*="more"],
        .Button--plain
      `);

      if (!moreButton) {
        log('Could not find more options button', 'warning');
        return false;
      }

      // Scroll item into view
      listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);

      // Click the more button
      moreButton.click();
      await sleep(300);

      // Look for remove follower option in the dropdown
      // Wait for dropdown to appear
      await sleep(500);

      // Try to find the remove/unfollow option
      const removeOption = findRemoveOption();

      if (!removeOption) {
        // Close the dropdown and try next
        document.body.click();
        await sleep(200);
        log('No remove option found, skipping', 'warning');
        return false;
      }

      // Click remove option
      removeOption.click();
      await sleep(500);

      // Handle confirmation dialog if present
      const confirmed = await handleConfirmationDialog();

      if (confirmed) {
        log(`Removed follower #${removedCount + 1}`, 'success');
        updateCounter();
        return true;
      } else {
        log('Remove action cancelled or failed', 'warning');
        return false;
      }

    } catch (error) {
      log(`Error removing follower: ${error.message}`, 'error');
      return false;
    }
  }

  // Find the remove option in dropdown menu
  function findRemoveOption() {
    // Zhihu uses various popup/overlay mechanisms
    // Look in common dropdown containers
    const selectors = [
      // Direct dropdown menu items
      `[aria-label="移除粉丝"]`,
      `[aria-label="Remove"]`,
      `button:contains("移除粉丝")`,
      `a:contains("移除粉丝")`,
      // Menu items in various containers
      `.Popover-menu button`,
      `.menu-item`,
      `.MenuItem`,
      `[role="menuitem"]`,
    ];

    // Check all possible dropdown menus
    const menus = document.querySelectorAll(`
      .Popover-menu,
      .dropdown-menu,
      [role="menu"],
      .menu
    `);

    for (const menu of menus) {
      if (menu.offsetParent === null) continue; // Skip hidden menus

      // Look for remove follower text
      const buttons = menu.querySelectorAll('button, a, div[role="menuitem"]');

      for (const btn of buttons) {
        const text = btn.textContent?.trim() || '';
        if (text.includes('移除') || text.includes('删除') ||
            text.includes('Remove') || text.includes('Delete')) {
          return btn;
        }
      }
    }

    // Try query selector approach
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) {
          // Check text content for remove-related keywords
          const text = el.textContent?.trim() || '';
          if (text.includes('移除') || text.includes('Remove')) {
            return el;
          }
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }

    return null;
  }

  // Handle confirmation dialog
  async function handleConfirmationDialog() {
    await sleep(500);

    // Look for confirmation dialog
    const selectors = [
      'button:contains("确认")',
      'button:contains("确定")',
      'button:contains("Confirm")',
      '.Modal-confirmButton',
      '.confirm-button',
      '[data-confirm="true"]'
    ];

    // Check if dialog exists
    const dialog = document.querySelector(`
      .Modal,
      .modal,
      [role="dialog"],
      .confirm-dialog
    `);

    if (!dialog || dialog.offsetParent === null) {
      // Some actions might not require confirmation
      return true;
    }

    // Find confirm button
    const confirmButtons = document.querySelectorAll('button');
    for (const btn of confirmButtons) {
      const text = btn.textContent?.trim() || '';
      if (text === '确认' || text === '确定' ||
          text === 'Confirm' || text === 'OK') {
        btn.click();
        await sleep(500);
        return true;
      }
    }

    return false;
  }

  // Get all follower list items
  function getFollowersList() {
    // Zhihu uses various list containers
    const selectors = [
      '.List-item',
      '.UserProfile-following-listItem',
      '[data-za-extra-module="FollowingItem"]',
      '.follower-item',
      'li[class*="ListItem"]'
    ];

    for (const selector of selectors) {
      const items = document.querySelectorAll(selector);
      if (items.length > 0) {
        return Array.from(items);
      }
    }

    return [];
  }

  // Main removal loop
  async function startRemoval() {
    isRunning = true;
    shouldStop = false;

    log('Starting follower removal...', 'info');
    notifyPopup('updateStatus', { status: 'running', message: 'Running...' });

    while (!shouldStop && isRunning) {
      try {
        // Get current list of followers
        const followers = getFollowersList();

        if (followers.length === 0) {
          log('No more followers found on current page', 'info');

          // Try to scroll down to load more
          window.scrollBy(0, 500);
          await sleep(2000);

          const moreFollowers = getFollowersList();
          if (moreFollowers.length === 0) {
            log('No followers found. Are you on the followers page?', 'warning');
            break;
          }
          continue;
        }

        // Get first follower
        const follower = followers[0];

        // Try to remove this follower
        const success = await removeFollower(follower);

        // Wait before next action
        const waitTime = getDelay();
        log(`Waiting ${waitTime}ms...`, 'info');

        // Check for stop signal during wait
        const waitStart = Date.now();
        while (Date.now() - waitStart < waitTime) {
          if (shouldStop) {
            log('Stopping...', 'warning');
            break;
          }
          await sleep(100);
        }

        if (shouldStop) break;

        // Scroll down to load more if needed
        const scrollPercent = (window.scrollY + window.innerHeight) / document.body.scrollHeight;
        if (scrollPercent > 0.9) {
          window.scrollBy(0, 300);
          await sleep(1000);
        }

      } catch (error) {
        log(`Error in main loop: ${error.message}`, 'error');

        // Pause on error
        notifyPopup('updateStatus', { status: 'error', message: 'Error - paused' });
        await sleep(3000);

        if (!shouldStop) {
          notifyPopup('updateStatus', { status: 'running', message: 'Running...' });
        }
      }
    }

    isRunning = false;
    notifyPopup('updateStatus', {
      status: shouldStop ? 'idle' : 'idle',
      message: shouldStop ? 'Stopped' : 'Finished'
    });

    if (removedCount > 0) {
      log(`Completed. Removed ${removedCount} followers.`, 'success');
    }
  }

  // Message handler
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'start':
        if (isRunning) {
          sendResponse({ success: false, error: 'Already running' });
          return true;
        }

        delay = message.delay || 2000;
        jitterPercent = message.jitter || 20;

        // Start removal process
        startRemoval();

        sendResponse({ success: true });
        return true;

      case 'stop':
        shouldStop = true;
        isRunning = false;

        log('Stopping...', 'warning');
        sendResponse({ success: true });
        return true;

      case 'getStatus':
        sendResponse({
          isRunning,
          removedCount,
          url: window.location.href
        });
        return true;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }

    return true;
  });

  // Notify that content script is loaded
  console.log('[Zhihu Cleaner] Content script loaded');
})();
