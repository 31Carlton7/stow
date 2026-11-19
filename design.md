# How Stow looks

Stow is a Mac app and should be taken for one. Some of its parts were lifted from Realm for
how they behave (the editors, the sheet, the toasts). None of them keep Realm's surface: the look is
the Mac's.

The values live in `apps/desktop/src/renderer/src/theme/mac.css`. This file says what they are for.
Use a name from there before writing a number.

## The window

- The whole window is the system's material: the main process asks for vibrancy and the page stays
  transparent. The sidebar sits bare on it.
- What is read sits on one panel, 8px in from the window's top, right and bottom edges, with a
  continuous corner. The list and the reader are two columns of that panel with a hairline between
  them; the reader is one step lighter.
- Three columns: a 280px sidebar, a 340px list, the reader taking the rest. The sidebar's top rows
  choose the section.
- The top row is one line. The traffic lights' middle is the middle of the panel's head (30px down),
  and their left edge is the sidebar icons'. A list's title starts where its rows' words start, and
  the last button of its head ends where the rows' ground ends.
- A head drags the window, so a control in one must be named out of the drag (`.col-head` does this
  for buttons, fields, labels and links). A scripted click cannot tell: the live checks ask
  `unreachable()` instead.
- Nothing translucent is stacked on something translucent of the same weight. A sheet, a menu and a
  toast are a thicker material of their own (`--float-ground`, blurred) so they read over anything.

## Type

- The system face, at the Mac's sizes: 13px for chrome and rows, 11 to 12px for a row's second and
  third line, 14px for prose that is read, 26px bold for a page's title.
- No tracking is added, except -0.02em on a page title. The system face carries its own.
- Weight makes the hierarchy before size does: a row's name is semibold, what is under it regular.
- Monospace is the system's, for paths, commands and code.

## Colour

- Text is the system's label colours: `--ink`, `--ink-2`, `--ink-3`. They are part see-through on
  purpose, so they sit right over the material.
- A control or a card is drawn with a system fill, `--fill-1` (heaviest) to `--fill-4`, never with a
  border.
- The accent is the Mac's own accent colour until the person chooses one of the Mac's eight or a
  colour of their own (Settings). The app hands the stylesheet that one colour as `--accent-base`,
  and every shade is made from it in `mac.css`: nothing else names an accent colour.
- The accent is used where the Mac uses it and nowhere else: a primary button, the chosen row in a
  list, a link, a focus ring, a switch that is on, the count beside Review, the glyph of the chosen
  row in the sidebar. It is not decoration: a thing that is not a state or an action stays ink.
- Accent as text is `--accent-ink`, never `--accent`: it is brought up on dark and down on light so
  any colour reads (4.9:1 or better for the eight). A filled button is `--accent-fill` under
  `--on-accent`: the fill is deepened until white reads on it (3.3:1 for green, the lowest, to 4.1),
  and a pale colour such as yellow keeps itself and takes a dark label.
- Green, orange and red say fixed, needs a look and gone, whatever the accent is, and each has a
  darker ink for light mode, where the fill colours are too faint to read as text.
- An agent's mark is drawn in the agent's own colour wherever a source is named, by `SourceMark`.
  A mark whose vendor draws it in no one colour (OpenAI, Cursor, opencode) is ink, so it reads on
  both faces. Hermes and OpenClaw are the pictures their own tools ship, Hermes with a drawing for
  each face.
- Both faces are designed. Check a new screen in light and in dark before calling it done.
- `prefers-reduced-transparency` gets solid grounds; `prefers-contrast: more` gets lines that show.

## Shape

- Every corner is a squircle (`corner-shape: squircle`): 11px for a field, 14px for a row in a list
  and a block of code, 18px for a card, 16px for the panel, 22px for a sheet. A button and a chip
  are capsules. An icon button is a circle.
- A card is anything that groups a few lines on a ground of its own: a notice, a set of settings, a
  model's tool. It takes `--r-card` and at least 14px of padding, 16px at its sides.
- Cards side by side are a grid of equal columns that reflows with the window, 12px apart and 16px
  in from the panel's edges, and the cards of a row are one height. A card that opens something
  lifts a little under the pointer and gives under a press.
- A row in the sidebar is 30px tall and a control 28px: a pointer's sizes, not a finger's.
- A switch is the Mac's: a capsule track that fills with the accent, a white knob.
- A segmented control is a capsule with one thumb that slides to the chosen segment.

## Favourites, sharing and dragging out

- Anything in a list can be starred: a library file, a skill, a server, a hook, a session. The star
  is the pack's glyph, filled with the accent when on. In a row it holds its 16px at the end of the
  head whether shown or not, so nothing shifts; it shows under the pointer and stays when on. In a
  reader's bar it is a glass icon button, first in the bar.
- Each section's sidebar has a Favorites row with a count, under its "All" row, and Favorites is a
  section of its own that lists everything starred as cards, by kind.
- Share is a glass icon button in every reader's bar, after the star. It opens the Mac's own share
  sheet with the file or folder, or, for a server or a hook, its definition as text with every
  secret left out.
- A row or a card drags out of the window as the real file behind it (a copy, so a drop that moves
  cannot take the original). Main decides what may leave: only what is under the home the app reads,
  and never a login file.

## Motion

- A press is answered on the way down: a button gives a little (`scale: 0.97`), a switch's knob
  stretches toward where it is going.
- Things that move use `--spring`, which does not overshoot. Only what a press throws (the switch)
  uses `--spring-throw`.
- A column, a page and the first rows of a list each arrive once, a short way. Nothing loops, and no
  animation is something to wait for.
- Under `prefers-reduced-motion` the arrivals are off; colour and opacity changes stay.

## Glass

- A control that floats over content is glass: the segmented control, every button in a column's
  head, worded or not, and a search or filter field. A reader's bar is such a head: the page scrolls
  up under it and its buttons stay readable because of it.
- Glass is the `--glass-*` names: a tint, a blur of what is behind, the light on its edges and the
  face, a shadow that lifts it. A filled button in the bar keeps its colour under the same light.
- The blur is made solid before it is tinted (`#glass-solid` in `index.html`, named in
  `--glass-blur`). The panel is see-through, so a plain blur of it is see-through too and is laid
  over the sharp words, which then still show. Any new blur over the panel needs the same step.
- Nothing else is glass: not a row, a field, the panel, or a control inside a sheet or a toast.
  Glass is never laid on glass.
- A card in a grid is glass lightly (`--card-glass-*`): the same light on its face and edge and the
  same kind of lift, a good deal fainter, and with no blur, because nothing passes behind a card.
  The chosen row of a list is the same card, in the accent's tint.
- It is drawn by the page. The Mac's own glass view (macOS 26 on) can sit under the whole page or
  over it, never between a control's label and the text scrolling beneath, and Electron has no call
  for it.
- Glass arrives by coming into focus (blur and scale together), and gives under a press like any
  other control. Asked for less transparency it is solid; asked for more contrast it has a line.
- An arrival that holds its last frame (`both`) keeps a layer that glass cannot blur. Use
  `backwards`.

## Checking it

The live checks picture a hidden window over a stand-in for the material, so they show what is
translucent but not the real material. Only the window on screen shows that: open the app and look
before saying a material looks right.

The stand-in is solid, and a blur always covers over a solid ground. Whether glass hides what is
under it is measured on the page with nothing behind it, as the window has it (`glass-live.mjs`).
