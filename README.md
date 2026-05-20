# Zhihu Follower Cleaner

A Chrome extension that helps you remove Zhihu followers one by one with anti-detection features.

## Features

- **Manifest V3** compliant Chrome extension
- **Popup UI** with:
  - Start/Stop control buttons
  - Configurable delay (500-10000ms, default 2000ms)
  - Jitter setting (±20% randomization by default)
  - Live counter showing removed followers
  - Activity log with timestamps
- **Anti-detection**: Randomized delays prevent bot detection
- **Smart navigation**: Auto-navigates to followers page
- **Error handling**: Pauses on errors and shows detailed logs

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `/tmp/zhihu-cleaner` directory
5. The extension icon will appear in your toolbar

## Usage

### Basic Usage

1. **Navigate to Zhihu** (zhihu.com)
2. **Click the extension icon** in your toolbar
3. **Click "Go to Followers"** to navigate to your followers page, or navigate manually
4. **Set your preferred delay** (2000ms = 2 seconds between removals)
5. **Click "Start"** to begin removing followers
6. **Click "Stop"** anytime to pause the process

### Settings

- **Delay**: Time between each removal action (500-10000ms)
  - Higher values are safer but slower
  - Default: 2000ms (2 seconds)
- **Jitter**: Randomization percentage (0-50%)
  - Adds randomness to delay for anti-detection
  - Default: 20% (e.g., 2000ms ± 400ms = 1600-2400ms)

### Safety Tips

1. Start with **higher delays** (3000-5000ms) to avoid rate limits
2. Use **jitter (20-30%)** to make actions appear more human-like
3. **Stop immediately** if you see any warnings from Zhihu
4. Don't run for extended periods without breaks
5. The extension will pause automatically on errors

## Files

- `manifest.json` - Extension configuration (Manifest V3)
- `popup.html` - Popup interface
- `popup.css` - Popup styling
- `popup.js` - Popup logic and UI handling
- `content.js` - Script that runs on Zhihu pages to remove followers
- `background.js` - Service worker for extension lifecycle
- `icons/` - Extension icons

## How It Works

1. The **content script** is injected into Zhihu pages
2. When you click **Start**, it:
   - Finds follower list items on the page
   - Clicks the "..." (more options) button for each follower
   - Selects the "Remove follower" option
   - Confirms the removal dialog
   - Waits for the configured delay (with random jitter)
   - Repeats for the next follower
3. The **popup** shows real-time status and logs

## Troubleshooting

### "No active tab found"
- Make sure you have a tab open and Zhihu is loaded

### "Failed to communicate with page"
- Refresh the Zhihu page and try again

### "No followers found"
- Make sure you're on the followers page (click "Go to Followers")
- Check that you actually have followers listed

### Buttons aren't being clicked
- Zhihu may have changed their UI. The extension tries multiple selectors but may need updates.

## Notes

- This extension works with your own Zhihu account to manage your followers
- Use responsibly and in accordance with Zhihu's terms of service
- The creators are not responsible for any account restrictions

## License

MIT License - Use at your own risk
