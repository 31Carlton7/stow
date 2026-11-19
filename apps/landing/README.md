# Stow's landing page

A static page: `index.html`, `styles.css`, `script.js` and `assets/`. No build step, no
dependencies, and nothing loaded from another origin.

## Preview

Open `index.html` in a browser, or serve this folder with any static server.

## The download button

`DOWNLOAD_URL` at the top of `script.js` is where every Download button goes. Without scripts the
buttons fall back to the releases page written in their `href`.

## The site's address and the share pictures

`SITE_URL` at the top of `scripts/share-images.mjs` is the one place the site's address is written.
Running it

    apps/desktop/node_modules/.bin/electron apps/landing/scripts/share-images.mjs

rewrites the `og:` and `twitter:` tags of the three pages from it, and draws `scripts/share.html`
in a window nobody can see into `assets/og-a.png`, `og-b.png` and `og-c.png`, then `og.png` and
`twitter.png` from the drawing named in `CHOSEN`.

## Remaking the pictures

The pictures of the app in `assets/` are captures of the built app on the fixture home
(`fixtures/home.mjs`), in a hidden window, in both faces at two pixels to the point:

    pnpm build
    node apps/landing/scripts/shots.mjs

Name screens to remake only those: `node apps/landing/scripts/shots.mjs review settings`. The
screens are library, review, health, sessions, servers and settings.

The window's frame and traffic lights are drawn by `styles.css` (`.window`). `assets/icon.png` is a
copy of `apps/desktop/build/logo.png`, and `favicon.png` and `touch-icon.png` are that picture made smaller. The agents' marks in `index.html` are the paths in
`packages/ui/src/brand-icons.ts`, and the cards' glyphs are the app's own from its Hugeicons set.

## What the page draws itself

The opening's tray and its eight sheets are drawn by `styles.css` (`.stow`): each agent's file lies
loose, squares up and drops into the tray, once. With reduced motion, or without scripts, the sheets
are already in the tray.

The tiles under "Tidy, with your say-so" are drawn by the page, not captured: a finding approved
and undone, the model's switch, copies gathering into one, bars and a storage bar, servers being
checked, and the accent swatches. Each shows something the app does. When the app changes, change
them with it, and add nothing here that the app lacks.

Every section, the bar and the foot share one width (`--page`).

The glass values in `styles.css` are copied from `apps/desktop/src/renderer/src/theme/mac.css`.

## Checking the page by eye

    apps/desktop/node_modules/.bin/electron apps/landing/scripts/page-shots.mjs [outDir]

writes the page a screenful at a time at 1440 and 390 wide in both faces, and the bar with words
scrolled under it, from a window nobody can see. It prints whether those words can be read through
the bar and whether every section shares the bar's left and right edges. Then it pictures Privacy
and Terms, and with motion allowed it watches the sheets go into the tray, presses the tiles and
pictures each chip of the real window, and prints what it found.
