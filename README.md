# LinkedIn Post Muter

Hides LinkedIn posts that match selected keywords. Runs entirely client‑side as a Chrome extension.

Disclaimer
This project is provided for educational and personal use only. Use of automation on LinkedIn may violate LinkedIn’s Terms of Service, which explicitly prohibit automated scraping, crawling, or interactions with their site without prior permission.

## Install (Load Unpacked)

1. Open `chrome://extensions`.
2. Toggle on Developer mode (top-right).
3. Click "Load unpacked" and select this folder.
4. Visit linkedin.com and open the extension from the toolbar.

## Usage

- Popup
  - Enable LinkedIn Post Muter: turns the feature on/off (enabled by default).
  - Keywords (one per line): add phrases/regex (see Syntax below).
  - Open Debug: opens the debug panel.
  - Lights: quick session checks that the feed DOM is as expected:
    - Activity root: turns green when a post `urn:li:activity:*` is seen.
    - Hide button: turns green when a direct Hide button is present in a post.

- Debug panel
  - Enable debug logging (default: off): records route/feed logs to storage.
  - Dry-run (default: off): detect only, do not click/hide.
  - Max hides per feed load: number of posts to hide per feed load. Leave empty for no limit.
  - Lists: Detections, Hidden, Roots seen, and Feed Debug (with Clear buttons).

## Keyword syntax

- Plain phrases: case-insensitive contains match.
  - Supports `{any}` wildcard that matches across any characters.
  - Examples (from `keywords.json`):
    - `comment "{any}"`
    - `comment {any} and`
    - `comment {any} to`
    - `comment {any} below`

- Regex lines: prefix with `re:/.../flags`
  - The part between the slashes is the pattern; flags follow the last slash.
  - If you omit flags, `i` (case-insensitive) is used by default.
  - Example: `re:/drop\s+(your\s+)?email.*i(?:'|’)?ll\s+(send|share)/i`

## How it works

- Scope
  - The content script runs only on `https://www.linkedin.com/*` (Manifest v3 content scripts).
  - It activates logic only on `/feed` routes.

- Matching and hiding
  - Text is read from each post card; phrases (with optional `{any}`) and regexes are evaluated.
  - If matched and not in dry-run, it first tries a direct Hide button; otherwise opens the overflow menu and clicks a Hide-like item.
  - Interactions use small randomized delays to feel human (e.g., 150–1200 ms depending on the step) and a 3s removal wait.

- Limits
  - Per-load hide limit is controlled by "Max hides per feed load" (blank = no limit).
  - If unset, legacy behavior (allow one hide per load) is preserved for safety.

- Observers and routing
  - Uses `IntersectionObserver` to act only on posts that enter the viewport.
  - Observers attach on feed entry and detach off-feed. SPA navigations are detected via history patches and a location poller.

- Logging
  - Debug logs write to `chrome.storage.local` only when debug logging is enabled.
  - Detections/Hidden/Roots lists also respect the debug toggle (counters still increment for session stats).

## Files

- `manifest.json`: MV3 config (permissions: `storage`; hosts: `https://www.linkedin.com/*`).
- `content.js`: Core logic; selectors centralized in `SELECTORS`; keywords compiled from user input + `keywords.json` + built-ins.
- `popup.html` + `popup.js`: Enable toggle, keyword editor, link to debug, session lights.
- `debug.html` + `debug.js`: Debug toggles, limits, and live logs.
- `keywords.json`: Default phrase suggestions included with the extension.

## Privacy

- No data leaves your browser. No network requests beyond loading the packaged `keywords.json`.
- All state is stored in `chrome.storage.local`.

## Troubleshooting

- No logs? Ensure "Enable debug logging" is on in the debug panel.
- Navigated from a non-feed page? The script initializes on any LinkedIn page and activates when you reach `/feed`.
- DOM changed? Core selectors live at the top of `content.js` under `SELECTORS` for easy updates.
- When in doubt, hard refresh.

## License

MIT
