# divyakumar

Personal site of Divyakumar Prajapati. Plain HTML, CSS and JavaScript with no build step.

```
index.html          the page
styles.css          all styles (colour tokens at the top)
js/main.js          intro zoom, ad wall, stars, reveals, counters, clock, captions
js/court.js         the live CourtNG court (one simulation per <canvas data-court>)
assets/             resume PDF, portrait, browser icons, link preview image
favicon.ico         browser icon for older browsers
tools/og.html       source for assets/og.png
tools/icon.html     source for the browser icons
tools/serve.py      local preview server with caching turned off
```

## How the intro works

The intro tells a short story in five scenes: Hello, the story so far (a constellation of
milestones), William O’Neil, CourtNG and Vulrend. It is a 580vh section with a sticky
stage inside it. As you scroll, `js/main.js` opens each next scene inside a growing circle
(`clip-path`) while the current one zooms past, with a glowing lens rim on the edge. The
first lens opens out of the photo on the hello screen. The zoom eases toward the scroll
position, and every per-frame effect is a transform or opacity change, so it stays smooth
with a mouse wheel as well as a trackpad.

Each scene keeps its words at the top and its visual in a `.scene__stage` below them. The
script measures the words and sets `--safe-top` on the scene, so text and animation never
overlap on any screen. The constellation is laid out in pixels for the current screen
(a rising line on wide screens, a vertical one on phones) and draws itself as you scroll.

"Scroll for my story" glides to the next scene, and "Skip the story" jumps to About.
Visitors who turn off animations get the five scenes stacked as normal sections.

## Run locally

```bash
python3 tools/serve.py 4321
```

Then open http://localhost:4321. This server tells the browser not to cache, so a reload
always shows the latest files.

`index.html` loads the stylesheet and scripts with a version tag (`styles.css?v=...`).
When you change CSS or JS, bump that tag so visitors' browsers fetch the new files instead
of a cached copy.

## Deploy

Live at https://divyakumarprajapati.github.io, served by GitHub Pages from the `main`
branch of `divyakumarprajapati/divyakumarprajapati.github.io`. To publish a change,
commit and push to `main`; Pages rebuilds in about 30 seconds.

## Updating

- **Resume:** replace `assets/Divyakumar_Prajapati_Resume.pdf` and keep the file name.
- **Portrait:** replace `assets/portrait.webp` (square, face centred).
- **Preview image:** serve the folder, open `/tools/og.html` in a 1200x630 window and save a screenshot as `assets/og.png`.
- **Browser icon:** serve the folder, open `/tools/icon.html` in a 512x512 window, screenshot it and resize to `assets/favicon-32.png`, `assets/favicon-192.png`, `assets/apple-touch-icon.png` (use `/tools/icon.html#full`, no rounded corners) and `favicon.ico`.
- **Years of experience** are counted automatically from June 2021.
