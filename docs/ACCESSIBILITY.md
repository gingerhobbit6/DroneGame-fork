# Accessibility

This document states how accessible Site Guard is today, measured against the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, from a static review of the frontend code. It is for anyone deciding whether the app suits a user with a disability, and for developers who want to close the gaps. In short: the login and profile screens come close to AA, the game's panels are partly usable by keyboard and screen reader, and the 3D view gives a screen reader user nothing, so the app does not conform to WCAG 2.2 AA today.

## Contents

- [How this was assessed](#how-this-was-assessed)
- [Keyboard](#keyboard)
- [Focus](#focus)
- [Names, roles, states and live regions](#names-roles-states-and-live-regions)
- [Colour](#colour)
- [Motion and timing](#motion-and-timing)
- [The 3D view and its text alternatives](#the-3d-view-and-its-text-alternatives)
- [Zoom, reflow, language and title](#zoom-reflow-language-and-title)
- [Target size](#target-size)
- [Login, account and recovery code forms](#login-account-and-recovery-code-forms)
- [WCAG 2.2 AA criteria](#wcag-22-aa-criteria)
- [Gaps in priority order, with fixes](#gaps-in-priority-order-with-fixes)
- [How to test accessibility](#how-to-test-accessibility)
- [Limits and simplifications](#limits-and-simplifications)
- [Where this lives in the code](#where-this-lives-in-the-code)

## How this was assessed

- **Read:** `frontend/index.html`, every stylesheet, every component under `frontend/src/ui`, [`labels.js`](../frontend/src/render/labels.js#L10), and the input handling in `game.js`, `render/placement.js` and `render/game-view.js`.
- **Not done:** no browser, screen reader or automated checker was run, and nothing was measured on screen. A Pass below means the code does what the criterion asks, not that a disabled user confirmed it.
- **Contrast:** computed with the WCAG relative luminance formula by a short Node script kept outside the repo, from the colours in the CSS. Translucent panels were composited over what lies behind them.
- **Target sizes:** computed from the CSS (font size times line height, plus padding and border). Widths of text buttons depend on the font, so they are approximate.
- **Terms:** the *accessible name* is what a screen reader announces for a control. *ARIA* attributes (such as `aria-label`, `aria-pressed` and `role`) tell assistive technology what an element is and what state it is in. A *live region* is an element whose changes a screen reader reads out without the user moving to it. `inert` is an HTML attribute that takes a whole subtree out of keyboard focus and out of the accessibility tree.

## Keyboard

### What works

- Panel controls are native buttons, inputs, selects and `<details>` summaries, so Tab reaches them. Catalogue cards are `div`s (Firefox will not start a drag from a button), but they carry `role="button"`, `tabIndex={0}` and an Enter and Space handler ([`SystemCard.jsx:26`](../frontend/src/ui/SystemCard.jsx#L26), [`SystemCard.jsx:33`](../frontend/src/ui/SystemCard.jsx#L33)). The pack tray's vehicle cards do the same ([`UnitTray.jsx:28`](../frontend/src/ui/account/UnitTray.jsx#L28)).
- A placed system can be selected without the map: the Nodes tab has a button per system that opens it in the Unit panel ([`NodesTab.jsx:17`](../frontend/src/ui/dock/NodesTab.jsx#L17)).
- Every box can be moved by keyboard: with its minimise button focused, the arrow keys move it 16 px, Shift moves it 64 px and Home puts it back ([`useMovable.js:49`](../frontend/src/ui/useMovable.js#L49), [`Movable.jsx:14`](../frontend/src/ui/Movable.jsx#L14)). This is unit-tested ([`movable.test.jsx:48`](../frontend/tests/movable.test.jsx#L48)).
- The start screen offers three keyboard ways to choose where to defend: Use my location, a typed position, and a "Jump to a map" list ([`WorldPicker.jsx:160`](../frontend/src/ui/WorldPicker.jsx#L160), [`WorldPicker.jsx:168`](../frontend/src/ui/WorldPicker.jsx#L168), [`WorldPicker.jsx:181`](../frontend/src/ui/WorldPicker.jsx#L181)). The Leaflet start map is created with Leaflet's defaults ([`site-map.js:64`](../frontend/src/ui/site-map.js#L64)), which include arrow-key panning and plus and minus zoom once the map has focus.
- The replay timeline is a native range input with step buttons ([`Timeline.jsx:37`](../frontend/src/ui/Timeline.jsx#L37), [`Timeline.jsx:41`](../frontend/src/ui/Timeline.jsx#L41)).
- No keyboard trap was found: nothing captures Tab, and the only handlers that swallow keys take the arrows and Home ([`useMovable.js:52`](../frontend/src/ui/useMovable.js#L52)) or Enter and Space on cards.

### Hotkeys

All hotkeys live in one window listener ([`useHotkeys.js:14`](../frontend/src/ui/useHotkeys.js#L14)).

| Key | Does | Code |
|---|---|---|
| 1 to 8, 0 | Pick a kind of system, then the next system of that kind on each press. With a deployment pack deployed, open that kind's list instead | [`useHotkeys.js:46`](../frontend/src/ui/useHotkeys.js#L46), [`systems.js:14`](../frontend/src/sim/config/systems.js#L14), [`game.js:123`](../frontend/src/game.js#L123), [`tools.js:42`](../frontend/src/tools.js#L42) |
| 9 | People tool | [`useHotkeys.js:34`](../frontend/src/ui/useHotkeys.js#L34) |
| X | Remove tool (the next click on a system removes it) | [`useHotkeys.js:33`](../frontend/src/ui/useHotkeys.js#L33), [`game.js:151`](../frontend/src/game.js#L151) |
| R, T, L | Range rings, truth overlay, labels | [`useHotkeys.js:30`](../frontend/src/ui/useHotkeys.js#L30) |
| P | Plan view | [`useHotkeys.js:35`](../frontend/src/ui/useHotkeys.js#L35) |
| G, C, M | Next grid, contours, next base map (real maps only) | [`useHotkeys.js:36`](../frontend/src/ui/useHotkeys.js#L36) |
| Space | Pause and resume, or play and pause a replay | [`useHotkeys.js:23`](../frontend/src/ui/useHotkeys.js#L23) |
| Left, Right | Step the replay back or forward | [`useHotkeys.js:21`](../frontend/src/ui/useHotkeys.js#L21) |
| Esc | See [Escape](#escape) | [`useHotkeys.js:29`](../frontend/src/ui/useHotkeys.js#L29) |

Guards that are already in place: hotkeys are off while the login or profile screen covers the game ([`useHotkeys.js:13`](../frontend/src/ui/useHotkeys.js#L13)); they ignore keys typed into inputs, selects, text areas and editable content ([`useHotkeys.js:16`](../frontend/src/ui/useHotkeys.js#L16)); they leave Ctrl, Alt and Cmd combinations and already handled keys to the browser or the control ([`useHotkeys.js:17`](../frontend/src/ui/useHotkeys.js#L17)); and Space on a focused button or summary presses it rather than pausing ([`useHotkeys.js:18`](../frontend/src/ui/useHotkeys.js#L18)). These guards are unit-tested ([`sizes.test.jsx:99`](../frontend/tests/sizes.test.jsx#L99)).

Conflicts:

- **Single-character shortcuts cannot be turned off or remapped,** and they work wherever focus is, not only when a component has focus. WCAG 2.1.4 asks for one of those three. Speech input users are most exposed: a stray dictated "x" turns on the Remove tool, and the next click on a system removes it with no confirmation ([`game.js:151`](../frontend/src/game.js#L151)).
- **Left and Right always reach the replay.** The replay object exists as soon as the view attaches ([`game.js:277`](../frontend/src/game.js#L277), [`game.js:294`](../frontend/src/game.js#L294)), so pressing Left on any focused button during a live run enters review at the last frame ([`replay-view.js:129`](../frontend/src/render/replay-view.js#L129)). The Map type list is marked up as a radio group ([`MapControls.jsx:202`](../frontend/src/ui/MapControls.jsx#L202)), where users expect the arrows to move between options; here they move the replay instead. On a box's minimise button the arrows move the box, which is intended but undiscoverable except through a `title` tooltip ([`Movable.jsx:14`](../frontend/src/ui/Movable.jsx#L14)).
- **Screen readers:** in browse mode, screen readers usually keep single letters for their own navigation, so the hotkeys only reach the page in focus (forms) mode. The app sets no `role="application"`, which is the right choice for panels full of text, but a screen reader user has to know to switch modes. Nothing in the app says so.

### Escape

Escape does the first of these that applies: leave the view from a mast, close the map panel, drop the picked tool, close the open list, clear the selection ([`useHotkeys.js:29`](../frontend/src/ui/useHotkeys.js#L29)). It does not close the [SAPIENT](SAPIENT.md) dock, the wizard, the Attack panel, the Area to defend panel, the map note, the Sandbox panel or the Tuning panel. It does nothing while focus is in an input or select, because the text-field guard runs first ([`useHotkeys.js:16`](../frontend/src/ui/useHotkeys.js#L16)), so Escape in the map panel's grid reference field leaves the panel open. When Escape closes a panel that held focus, focus falls back to the page body.

### Doing drag and map actions another way

WCAG 2.5.7 asks for a single-pointer way (a click, no drag) to do anything done by dragging; WCAG 2.1.1 asks for a keyboard way.

| Task | Without dragging | By keyboard |
|---|---|---|
| Place a system or a pack vehicle | Click the card, then click the map ([`SystemCard.jsx:35`](../frontend/src/ui/SystemCard.jsx#L35), [`UnitTray.jsx:30`](../frontend/src/ui/account/UnitTray.jsx#L30)) | Pick the card with Enter or Space. On a **real map** only, type a grid reference in the Map panel and press Go, which places the picked system there ([`MapControls.jsx:153`](../frontend/src/ui/MapControls.jsx#L153), [`MapControls.jsx:226`](../frontend/src/ui/MapControls.jsx#L226)). On **generated ground** there is no way |
| Place people | The People tool, then click the map ([`game.js:152`](../frontend/src/game.js#L152)). The pack tray's people cards are drag-only ([`UnitTray.jsx:62`](../frontend/src/ui/account/UnitTray.jsx#L62)) | None: the grid reference form places systems only ([`MapControls.jsx:159`](../frontend/src/ui/MapControls.jsx#L159)) |
| Select a placed system | Click it on the map | Nodes tab button ([`NodesTab.jsx:17`](../frontend/src/ui/dock/NodesTab.jsx#L17)) |
| Move a box | None (minimise it, or double-click its bar to put it back) | Arrows on its minimise button. The Sandbox panel's handle is a heading that cannot take focus, so it cannot be moved ([`Sandbox.jsx:47`](../frontend/src/ui/Sandbox.jsx#L47)) |
| Pan the 3D view | Click the minimap ([`minimap.js:96`](../frontend/src/ui/minimap.js#L96)), Centre on the site or on my location ([`MapControls.jsx:193`](../frontend/src/ui/MapControls.jsx#L193)), Look beside a people group ([`PeoplePicker.jsx:44`](../frontend/src/ui/PeoplePicker.jsx#L44)) | The same buttons, and a typed grid reference on a real map ([`MapControls.jsx:163`](../frontend/src/ui/MapControls.jsx#L163)). The camera controls take no keys ([`game-view.js:56`](../frontend/src/render/game-view.js#L56)) |
| Turn the 3D view | None: right-drag or Shift-drag only ([`game-view.js:64`](../frontend/src/render/game-view.js#L64)) | None; P switches to a straight-down view |
| Zoom the 3D view | None for a touch-only user: wheel or pinch ([`game-view.js:65`](../frontend/src/render/game-view.js#L65)) | None, except that Centre on my location closes in ([`MapControls.jsx:143`](../frontend/src/ui/MapControls.jsx#L143)) |
| Look round from a mast | None: drag only ([`EyeBar.jsx:14`](../frontend/src/ui/EyeBar.jsx#L14)) | None |
| Draw the area to defend or a patrol route | Clicks, not drags, with a Close the area button ([`ZonePanel.jsx:49`](../frontend/src/ui/ZonePanel.jsx#L49)) | No way to add corners. The wizard's "Use a 1 km ring" sets an area by keyboard ([`steps.jsx:95`](../frontend/src/ui/assistant/steps.jsx#L95)) |
| Wire one system to a network | Click its box on the network canvas, then Starlink or Cellular ([`NetworkTab.jsx:35`](../frontend/src/ui/dock/NetworkTab.jsx#L35)) | Only Auto-wire for everything at once ([`NetworkTab.jsx:66`](../frontend/src/ui/dock/NetworkTab.jsx#L66)); the per-system radio buttons only appear after a canvas click |
| Read one message or packet | Click its row | None: the rows are `div`s with click handlers ([`MessagesTab.jsx:92`](../frontend/src/ui/dock/MessagesTab.jsx#L92), [`NetworkSide.jsx:91`](../frontend/src/ui/dock/NetworkSide.jsx#L91), [`LearnTab.jsx:82`](../frontend/src/ui/dock/LearnTab.jsx#L82)) |
| Pick a bearing in the Range view | Click the polar plot ([`SiteRange.jsx:28`](../frontend/src/ui/SiteRange.jsx#L28)) | The bearing slider ([`SiteRange.jsx:105`](../frontend/src/ui/SiteRange.jsx#L105)) |

The wizard's "Show me a good spot" works out a spot and marks it on the map, but the player still has to click the map there ([`steps.jsx:31`](../frontend/src/ui/assistant/steps.jsx#L31)).

## Focus

- **Visible focus.** The game's stylesheet never removes the browser's focus outline, so buttons and inputs keep the browser's default ring. A few controls add their own: catalogue cards ([`catalogue.css:7`](../frontend/src/ui/catalogue.css#L7)), minimise buttons ([`movable.css:8`](../frontend/src/ui/movable.css#L8)) and the speed buttons ([`speed-control.css:8`](../frontend/src/ui/speed-control.css#L8)). The account screens draw a 2 px cyan ring on everything ([`account.css:9`](../frontend/src/ui/account/account.css#L9)); their inputs swap the outline for a cyan border and glow ([`account.css:65`](../frontend/src/ui/account/account.css#L65)), and that cyan is 11.69:1 against the card.
- **Focus order.** Tab follows the order in [`App.jsx:47`](../frontend/src/ui/App.jsx#L47). Two problems follow from it. The start card and the results card are rendered last ([`App.jsx:68`](../frontend/src/ui/App.jsx#L68)), on a dimmed backdrop that does not stop focus ([`style.css:242`](../frontend/src/style.css#L242)), so on the start screen Tab first walks through the toolbar and Controls hidden behind the card. And the list a toolbar row opens is rendered after the dock and Unit panel ([`App.jsx:61`](../frontend/src/ui/App.jsx#L61)), so after pressing a row, Tab reaches the list it opened only after every remaining toolbar row, the map rail, the whole Controls box and the wizard button.
- **Panels and dialogs.** No component moves focus when it opens or returns it when it closes: there is no `.focus()` call anywhere in `frontend/src`, only `autoFocus` on the first field of four forms. The map panel and the Area to defend panel are labelled `role="dialog"` ([`MapControls.jsx:200`](../frontend/src/ui/MapControls.jsx#L200), [`ZonePanel.jsx:41`](../frontend/src/ui/ZonePanel.jsx#L41)) but behave as ordinary panels. Closing a panel from its own close button removes the focused element, so focus drops to the page body. An approval request, the most time-critical control in the game, appears without taking focus ([`Panels.jsx:62`](../frontend/src/ui/Panels.jsx#L62)).
- **`inert` while the profile screen covers the game.** Done well. The whole game sits in a `div` that is `inert` whenever the login or profile screen is showing ([`Root.jsx:98`](../frontend/src/ui/account/Root.jsx#L98), with `covered` set at [`Root.jsx:72`](../frontend/src/ui/account/Root.jsx#L72)). The hotkeys switch off at the same time, the account screens stop key events bubbling ([`AuthScreen.jsx:147`](../frontend/src/ui/account/AuthScreen.jsx#L147), [`ProfileHub.jsx:137`](../frontend/src/ui/account/ProfileHub.jsx#L137)), and a lapsed session pauses a running wave ([`Root.jsx:57`](../frontend/src/ui/account/Root.jsx#L57)). The same technique is not used for the in-game start and results cards.
- **Focus not obscured (2.4.11).** Controls focused behind the start card can be entirely hidden by it. Boxes can also be dragged over one another, and the sticky Remove button at the foot of the toolbar ([`style.css:219`](../frontend/src/style.css#L219)) can cover a focused row while the toolbar scrolls.

## Names, roles, states and live regions

### Done well

- **Icon-only buttons with names:** the map rail ([`MapControls.jsx:193`](../frontend/src/ui/MapControls.jsx#L193)), the map panel's close ([`MapControls.jsx:201`](../frontend/src/ui/MapControls.jsx#L201)), play and pause ([`SpeedControl.jsx:19`](../frontend/src/ui/SpeedControl.jsx#L19)), list and Unit panel close buttons ([`SystemCard.jsx:50`](../frontend/src/ui/SystemCard.jsx#L50), [`UnitPanel.jsx:263`](../frontend/src/ui/UnitPanel.jsx#L263)), the wizard's collapse, close and step buttons ([`Wizard.jsx:129`](../frontend/src/ui/assistant/Wizard.jsx#L129), [`Wizard.jsx:135`](../frontend/src/ui/assistant/Wizard.jsx#L135)), every minimise button with `aria-expanded` ([`Movable.jsx:16`](../frontend/src/ui/Movable.jsx#L16)), the reset buttons beside settings ([`UnitEditor.jsx:45`](../frontend/src/ui/UnitEditor.jsx#L45)) and the pack editor's steppers ([`PackEditor.jsx:19`](../frontend/src/ui/account/PackEditor.jsx#L19)). Decorative SVG icons are `aria-hidden`.
- **Pressed and expanded states:** speed buttons ([`SpeedControl.jsx:25`](../frontend/src/ui/SpeedControl.jsx#L25)), map overlays and grids ([`MapControls.jsx:218`](../frontend/src/ui/MapControls.jsx#L218)), the Unit panel's Details, Range and Configure ([`UnitPanel.jsx:267`](../frontend/src/ui/UnitPanel.jsx#L267)), catalogue cards ([`SystemCard.jsx:33`](../frontend/src/ui/SystemCard.jsx#L33)), people roles and protection ([`PeoplePicker.jsx:24`](../frontend/src/ui/PeoplePicker.jsx#L24)), statistics waves ([`RunStats.jsx:131`](../frontend/src/ui/RunStats.jsx#L131)); toolbar rows and the Attack button say whether their list is open ([`Toolbar.jsx:37`](../frontend/src/ui/Toolbar.jsx#L37), [`ControlPanel.jsx:52`](../frontend/src/ui/ControlPanel.jsx#L52)).
- **Radio groups:** the map type cards are `role="radiogroup"` and `role="radio"` with `aria-checked` ([`MapControls.jsx:207`](../frontend/src/ui/MapControls.jsx#L207)); real radio inputs choose the world ([`WorldPicker.jsx:149`](../frontend/src/ui/WorldPicker.jsx#L149)), a system's network terminal ([`NetworkSide.jsx:41`](../frontend/src/ui/dock/NetworkSide.jsx#L41)) and the wizard's engagement authority, inside a `fieldset` with a `legend` ([`steps.jsx:291`](../frontend/src/ui/assistant/steps.jsx#L291)).
- **Live regions that exist:** the wizard's step title ([`Wizard.jsx:141`](../frontend/src/ui/assistant/Wizard.jsx#L141)), the site guide's title ([`SiteGuide.jsx:22`](../frontend/src/ui/assistant/SiteGuide.jsx#L22)), the mast view bar ([`EyeBar.jsx:13`](../frontend/src/ui/EyeBar.jsx#L13)), and on the account screens the password meter, the Caps Lock warning, errors (`role="alert"`) and notices (`role="status"`) ([`parts.jsx:38`](../frontend/src/ui/account/parts.jsx#L38), [`parts.jsx:57`](../frontend/src/ui/account/parts.jsx#L57), [`AuthScreen.jsx:52`](../frontend/src/ui/account/AuthScreen.jsx#L52), [`AuthScreen.jsx:45`](../frontend/src/ui/account/AuthScreen.jsx#L45)).
- **Tables** with header cells for statistics, costs, saved laydowns and the debrief, some with `scope` ([`Debrief.jsx:29`](../frontend/src/ui/assistant/Debrief.jsx#L29)).

### Gaps

| Control | Code | Problem |
|---|---|---|
| Toasts | [`Panels.jsx:54`](../frontend/src/ui/Panels.jsx#L54) | No live region. Toasts carry placement refusals, "Placed ...", map load failures and "Engagement request: your decision is needed" ([`simulation.js:65`](../frontend/src/sim/simulation.js#L65)), and vanish after 2.6 s ([`Panels.jsx:52`](../frontend/src/ui/Panels.jsx#L52)) |
| Approval requests | [`Panels.jsx:62`](../frontend/src/ui/Panels.jsx#L62) | Not announced and not focused |
| Run ended, leaks, kills | [`Hud.jsx:53`](../frontend/src/ui/Hud.jsx#L53), [`Overlay.jsx:116`](../frontend/src/ui/Overlay.jsx#L116) | Counters and the results card change silently |
| SAPIENT dock tabs | [`Dock.jsx:55`](../frontend/src/ui/dock/Dock.jsx#L55) | The chosen tab is shown by a CSS class only: no `role="tab"`, `aria-selected` or `aria-pressed` |
| Dock size and close | [`Dock.jsx:60`](../frontend/src/ui/dock/Dock.jsx#L60) | Named by the glyphs "⤢" and "×"; the `title` becomes a description, not the name |
| Timeline buttons | [`Timeline.jsx:37`](../frontend/src/ui/Timeline.jsx#L37) | Named "◀\|", "▶" and "\|▶" |
| Timeline slider | [`Timeline.jsx:41`](../frontend/src/ui/Timeline.jsx#L41) | No label |
| Figure reset | [`SourcesTab.jsx:40`](../frontend/src/ui/dock/SourcesTab.jsx#L40) | Named "↺"; it also sits inside the figure's `<label>`, so its glyph joins the input's name |
| Message type filters | [`MessagesTab.jsx:75`](../frontend/src/ui/dock/MessagesTab.jsx#L75) | On or off shown by opacity only, no `aria-pressed` |
| Message, packet and follow rows | [`MessagesTab.jsx:92`](../frontend/src/ui/dock/MessagesTab.jsx#L92), [`NetworkSide.jsx:91`](../frontend/src/ui/dock/NetworkSide.jsx#L91), [`LearnTab.jsx:82`](../frontend/src/ui/dock/LearnTab.jsx#L82) | Clickable `div`s with no role and no keyboard access |
| Unlabelled fields | [`SavedTab.jsx:42`](../frontend/src/ui/dock/SavedTab.jsx#L42), [`FigureSets.jsx:30`](../frontend/src/ui/dock/FigureSets.jsx#L30), [`MapControls.jsx:228`](../frontend/src/ui/MapControls.jsx#L228), [`MessagesTab.jsx:78`](../frontend/src/ui/dock/MessagesTab.jsx#L78), [`PlanTab.jsx:26`](../frontend/src/ui/dock/PlanTab.jsx#L26), [`LearnTab.jsx:76`](../frontend/src/ui/dock/LearnTab.jsx#L76) | Placeholder or neighbouring text only |
| Plan view toggle | [`MapControls.jsx:196`](../frontend/src/ui/MapControls.jsx#L196) | Its name flips between "2D" and "3D" as its pressed state flips, so "3D, pressed" means plan view is on |
| Map switcher | [`MapControls.jsx:190`](../frontend/src/ui/MapControls.jsx#L190) | Named only by its `title` |
| Account chip | [`Root.jsx:26`](../frontend/src/ui/account/Root.jsx#L26) | Named by the player's name; "opens your profile" is only in the `title` |
| Wizard progress | [`Wizard.jsx:135`](../frontend/src/ui/assistant/Wizard.jsx#L135) | Current step shown by colour; no `aria-current` |
| UTC clock | [`parts.jsx:94`](../frontend/src/ui/account/parts.jsx#L94) | `aria-label` on a plain `span`, which assistive technology ignores |
| Unit panel range and odds | [`UnitPanel.jsx:145`](../frontend/src/ui/UnitPanel.jsx#L145), [`UnitPanel.jsx:164`](../frontend/src/ui/UnitPanel.jsx#L164) | Tables drawn with `span`s in a CSS grid, so no row or column relationships |
| Game screen structure | [`Movable.jsx:15`](../frontend/src/ui/Movable.jsx#L15) | Box titles are `span`s, not headings, and the game has no `<main>` landmark; only some boxes are labelled regions |

## Colour

### Contrast

Text needs 4.5:1, or 3:1 when large (18.66 px bold or 24 px). Almost all text here is 10 to 14 px, so 4.5:1 applies. Panels are 82 % opaque ([`style.css:6`](../frontend/src/style.css#L6)), so the table gives two cases: over dark ground, and over pure white, the worst a pale map could do.

| Text | Code | Foreground | Background | Ratio | Result |
|---|---|---|---|---|---|
| Body text | [`style.css:2`](../frontend/src/style.css#L2) | #dbe4f0 | #0b1220 | 14.59:1 | Pass |
| Body text on a panel, pale map behind | [`style.css:6`](../frontend/src/style.css#L6) | #dbe4f0 | panel over white | 8.35:1 | Pass |
| Labels and muted text | [`style.css:8`](../frontend/src/style.css#L8), [`style.css:202`](../frontend/src/style.css#L202) | #7f93b2 | panel, dark | 5.92:1 | Pass |
| Labels and muted text, pale map behind | as above | #7f93b2 | panel over white | 3.43:1 | Fail |
| Box titles (10 px) and the legend hint | [`movable.css:4`](../frontend/src/ui/movable.css#L4), [`style.css:213`](../frontend/src/style.css#L213) | #5f7391 | panel, dark | 3.83:1 | Fail |
| Toolbar key line (10 px) | [`style.css:229`](../frontend/src/style.css#L229) | #6d82a3 | #1b2a45 | 3.67:1 | Fail |
| Unaffordable price (12 px) | [`style.css:232`](../frontend/src/style.css#L232) | #ef5350 | #1b2a45 | 4.12:1 | Fail |
| Button text | [`style.css:118`](../frontend/src/style.css#L118) | #dbe4f0 | #1b2a45 | 11.18:1 | Pass |
| Primary button | [`style.css:122`](../frontend/src/style.css#L122) | #ffffff | #1565c0 | 5.75:1 | Pass |
| Track labels at 0.8 opacity, dark ground | [`style.css:11`](../frontend/src/style.css#L11) | #8f9aab | #0b1220 | 4.61:1 | Pass |
| Speed buttons | [`speed-control.css:19`](../frontend/src/ui/speed-control.css#L19) | #8ea4c8 | speed pill | 7.67:1 | Pass |
| Wizard text, muted, warning | [`style.css:337`](../frontend/src/style.css#L337), [`style.css:364`](../frontend/src/style.css#L364) | #b9c7dc, #9fb2cf, #ffcf66 | #101a2c | 10.17, 8.08, 11.91:1 | Pass |
| Wizard main button | [`style.css:358`](../frontend/src/style.css#L358) | #0b1220 | #c6ff00 | 15.79:1 | Pass |
| Replay banner | [`style.css:56`](../frontend/src/style.css#L56) | #ffffff | #b71c1c | 6.57:1 | Pass |
| **Sandbox banner (12 px bold)** | [`style.css:97`](../frontend/src/style.css#L97) | #ffffff | #ff6f00 | 2.79:1 | Fail |
| Sources badges | [`style.css:182`](../frontend/src/style.css#L182) | three pairs | | 6.71, 7.13, 5.80:1 | Pass |
| Statistics tile captions (10 px) | [`run-stats.css:6`](../frontend/src/ui/run-stats.css#L6) | #7f93b2 | #13213a | 5.14:1 | Pass |
| Login text | [`account.css:4`](../frontend/src/ui/account/account.css#L4) | #dbe4f0 | #05080f | 15.62:1 | Pass |
| Login muted text on the card | [`account.css:4`](../frontend/src/ui/account/account.css#L4) | #7f93b2 | card | 6.10:1 | Pass |
| **Login faint text:** field hints, profile facts, footer | [`account.css:61`](../frontend/src/ui/account/account.css#L61), [`account.css:93`](../frontend/src/ui/account/account.css#L93), [`account.css:115`](../frontend/src/ui/account/account.css#L115) | #4d6080 | card | 3.00:1 | Fail |
| Login links, main button, errors, recovery code | [`account.css:80`](../frontend/src/ui/account/account.css#L80), [`account.css:82`](../frontend/src/ui/account/account.css#L82), [`account.css:91`](../frontend/src/ui/account/account.css#L91), [`account.css:94`](../frontend/src/ui/account/account.css#L94) | | | 9.86 to 14.68:1 | Pass |

Non-text contrast (WCAG 1.4.11) asks 3:1 for the edges that identify a control. Game input borders are #2f4468 on #0b1424, 1.88:1 ([`style.css:63`](../frontend/src/style.css#L63)), and login input borders are #2f4a78 on the card, 2.15:1 ([`account.css:63`](../frontend/src/ui/account/account.css#L63)): both fail. Game buttons are told apart by their text, as their fill is only 1.29:1 against a panel.

### Colour alone

| Where | Code | Backed up by text or shape? |
|---|---|---|
| Placement preview: green can place, red cannot, orange removes | [`placement.js:154`](../frontend/src/render/placement.js#L154) | Only after the click, by a toast that is not announced. Green and red are 2.44:1 apart in lightness and are the pair most often confused in colour vision deficiency |
| Timeline event markers (kill, leak, spotter, lost, casualty, miss, patrol, empty) | [`Timeline.jsx:8`](../frontend/src/ui/Timeline.jsx#L8) | No. Each has a `title`, but the marker strip ignores the pointer ([`style.css:17`](../frontend/src/style.css#L17)), so the tooltip never shows |
| Site integrity bar in the sandbox | [`Hud.jsx:26`](../frontend/src/ui/Hud.jsx#L26) | Bar length only; no number |
| Minimap: systems, tracks, drones, rings | [`minimap.js:56`](../frontend/src/ui/minimap.js#L56) | Partly: tracks are diamonds, systems squares and drones dots, but which system or drone is colour only |
| Fused track symbols in 3D | [`Panels.jsx:33`](../frontend/src/ui/Panels.jsx#L33) | Yes: frame shape (clover or peaked), a rotor mark, dashed for tentative, plus text labels with L |
| Drones in 3D | [`Panels.jsx:27`](../frontend/src/ui/Panels.jsx#L27) | Yes: each type has its own model, and labels name them |
| Wizard placing steps: now and done | [`catalogue.css:24`](../frontend/src/ui/catalogue.css#L24) | Done is struck through; the current step is colour only |
| Map rail and chip "on" states | [`map-panel.css:70`](../frontend/src/ui/map-panel.css#L70), [`map-panel.css:93`](../frontend/src/ui/map-panel.css#L93) | Visually colour only, though `aria-pressed` or `aria-expanded` tells a screen reader |
| Password strength | [`account.css:72`](../frontend/src/ui/account/account.css#L72) | Yes: number of bars and a text label |
| Server online or offline | [`AuthScreen.jsx:27`](../frontend/src/ui/account/AuthScreen.jsx#L27) | Yes: text |
| Message types | [`style.css:153`](../frontend/src/style.css#L153) | Yes: the type is a text column and a chip label |
| Plan coverage and spectrum | [`PlanTab.jsx:29`](../frontend/src/ui/dock/PlanTab.jsx#L29), [`SpectrumTab.jsx:16`](../frontend/src/ui/dock/SpectrumTab.jsx#L16) | Partly: a key and a percentage seen; the spectrum lists every jamming conflict in words |

## Motion and timing

- **Reduced motion.** Respected in most places that move by themselves: the login backdrop's radar sweep and blips stop ([`account.css:30`](../frontend/src/ui/account/account.css#L30)), the paused button stops pulsing ([`speed-control.css:29`](../frontend/src/ui/speed-control.css#L29)), explosions are shorter with no debris ([`effects.js:45`](../frontend/src/render/effects.js#L45)), and the camera jumps instead of gliding ([`game-view.js:147`](../frontend/src/render/game-view.js#L147)). The map loading spinner only slows down ([`map-panel.css:112`](../frontend/src/ui/map-panel.css#L112)). The game's own short transitions (toast fade, bars) are not affected ([`style.css:239`](../frontend/src/style.css#L239)). Without the operating system setting, the login backdrop animates for as long as the page is open and has no pause control (WCAG 2.2.2).
- **Waves run in real time, and the player controls the clock.** Space or the play button pauses at any moment, and the speed runs from 1x to 10x ([`SpeedControl.jsx:8`](../frontend/src/ui/SpeedControl.jsx#L8)). At 1x the game runs 5 simulated seconds per real second ([`world.js:19`](../frontend/src/sim/config/world.js#L19)); the Tuning panel's Time scale can go down to 0.5 ([`Panels.jsx:17`](../frontend/src/ui/Panels.jsx#L17)), ten times slower. Waves do not start on their own unless Auto-start is ticked, which is off by default ([`simulation.js:51`](../frontend/src/sim/simulation.js#L51)).
- **Approval requests.** A request lapses after 20 simulated seconds ([`world.js:99`](../frontend/src/sim/config/world.js#L99)), only 4 real seconds at 1x, but the game stops the clock as soon as one arrives and restarts it once all are decided ([`game.js:213`](../frontend/src/game.js#L213)). Simulated time does not pass while paused, so the request cannot lapse while the player decides.
- **Short windows elsewhere.** Two-click confirmations (Clear map, End deployment, Delete) forget the first click after 3 s ([`hooks.js:52`](../frontend/src/ui/hooks.js#L52)). Nothing is lost when the window passes, but a user with a slow pointer has to be quick. Toasts disappear after 2.6 s and are not kept anywhere, except the wizard's "Last try" line ([`steps.jsx:74`](../frontend/src/ui/assistant/steps.jsx#L74)).
- **Flashes.** Launch and gun flashes last 0.15 s ([`effects.js:30`](../frontend/src/render/effects.js#L30)) and are small, but their rate was not measured, so WCAG 2.3.1 (three flashes) is untested.

## The 3D view and its text alternatives

The 3D view is a WebGL `<canvas>` with no role, name or fallback content ([`App.jsx:28`](../frontend/src/ui/App.jsx#L28)). A screen reader announces nothing for it and cannot explore it. The name tags drawn over it are plain `div`s in a layer that is not hidden from assistive technology ([`App.jsx:29`](../frontend/src/ui/App.jsx#L29), [`labels.js:13`](../frontend/src/render/labels.js#L13)), so in browse mode a screen reader reads a stream of system, drone and track names in document order, with no position or meaning. The minimap, plan, network and spectrum views are also canvases; the minimap has only a `title` ([`Minimap.jsx:19`](../frontend/src/ui/Minimap.jsx#L19)).

What a screen reader user can get as text:

| Source | What it gives |
|---|---|
| Run box ([`Hud.jsx:50`](../frontend/src/ui/Hud.jsx#L50)) | Wave, kills, leaks, simulated casualties, ammunition, spend, spotter warning, enemy evasion |
| Nodes tab ([`NodesTab.jsx:11`](../frontend/src/ui/dock/NodesTab.jsx#L11)) | Every system with its SAPIENT type, mode, task, range, position and message counts, as a table |
| Unit panel ([`UnitPanel.jsx:259`](../frontend/src/ui/UnitPanel.jsx#L259)) | Everything about one system: status, health, magazine, range on each bearing, odds, network, position, price |
| Messages tab ([`MessagesTab.jsx:90`](../frontend/src/ui/dock/MessagesTab.jsx#L90)) | Every SAPIENT message with a one-line summary, including detections with bearing and range, tasks and alerts. The list reads, but a single message's JSON cannot be opened by keyboard |
| Learn tab ([`LearnTab.jsx:76`](../frontend/src/ui/dock/LearnTab.jsx#L76)) | A list of current tracks, and every message about the one chosen |
| Statistics and Magazine depth tabs | Tables of hit rates, ranges, costs, rounds and shots |
| Spectrum tab notes ([`SpectrumTab.jsx:16`](../frontend/src/ui/dock/SpectrumTab.jsx#L16)) | Each clash between your jamming and your links, in a sentence |
| Range view ([`SiteRange.jsx:28`](../frontend/src/ui/SiteRange.jsx#L28)) | Its two diagrams have `role="img"` and a name, and a table beside them |
| Deployment report and debrief ([`DeploymentReport.jsx:11`](../frontend/src/ui/DeploymentReport.jsx#L11), [`Debrief.jsx:28`](../frontend/src/ui/assistant/Debrief.jsx#L28)) | How the run ended, drones launched, intercepted and leaked, costs and losses, under real headings and in a table |
| Kill range chart ([`RunStats.jsx:43`](../frontend/src/ui/RunStats.jsx#L43)) | A labelled figure whose bars show their counts as text |

What is missing: nothing describes the live air picture as it changes (where each track is, which is closing, what was just hit or got through), and nothing announces events. A blind player can design a laydown on a real map by grid reference, read every figure, run a wave paused or slowed, and read the report afterwards, but cannot follow or fight a wave as it happens. Honest expectation: a real-time 3D simulation will never be fully equal without a separate text or audio picture, but a live, announced event log and a sortable track table would close much of the gap.

## Zoom, reflow, language and title

- **Language and title.** `<html lang="en">` ([`index.html:2`](../frontend/index.html#L2)) and the title "Site Guard" ([`index.html:6`](../frontend/index.html#L6)). The title never changes between the login page, the profile and the game.
- **Zoom.** The viewport tag allows pinch zoom ([`index.html:5`](../frontend/index.html#L5)), and sizes are in CSS pixels, which browser zoom scales. But the game page cannot scroll (`overflow: hidden` on `html` and `body`, [`style.css:2`](../frontend/src/style.css#L2)) and every box is fixed-position with a fixed width (for example 236 px, 190 px, 300 px). At 200 % zoom on a 1280 px wide screen the page is 640 CSS px wide and the boxes overlap. Long boxes scroll inside themselves, and every box can be minimised or moved, which is the only way to reach what is underneath.
- **Reflow (1.4.10).** The login and profile screens reflow to one column below 980 px and 560 px ([`account.css:152`](../frontend/src/ui/account/account.css#L152)), and the start card stacks below 900 px ([`map-panel.css:61`](../frontend/src/ui/map-panel.css#L61)). The game screen does not reflow; WCAG exempts the map itself, but not the panels around it.
- **Text spacing (1.4.12).** Many lines are cut off with an ellipsis rather than wrapping (box titles, toolbar key lines, message rows), so wider letter or word spacing will hide text. Not tested.
- **Selecting text.** The game sets `user-select: none` on the body ([`style.css:3`](../frontend/src/style.css#L3)), except in the Unit panel, the wizard and the account screens. Not a WCAG failure, but it stops users who select text to have it read aloud.

## Target size

WCAG 2.5.8 asks for targets of at least 24 by 24 CSS px, or enough space around a smaller one that a 24 px circle on it touches no other target. Sizes below are computed from the CSS, as described above.

| Control | Code | Computed size | Result |
|---|---|---|---|
| Small buttons (`button.mini`): Load, Update, Delete, Nodes tab buttons, Try again, paging | [`style.css:34`](../frontend/src/style.css#L34) | 16 px tall, side by side 6 px apart | Fail |
| Dock size and close | [`style.css:22`](../frontend/src/style.css#L22) | 20 px tall, adjacent | Fail |
| Minimise buttons on every box | [`movable.css:5`](../frontend/src/ui/movable.css#L5) | 16 px tall, about 20 px wide, inside the drag bar | Fail |
| Close and View from here in the Unit panel and lists | [`style.css:280`](../frontend/src/style.css#L280), [`style.css:442`](../frontend/src/style.css#L442) | 22.4 px and 21.4 px tall, 6 px apart | Fail |
| Area to defend and map note close | [`map-panel.css:105`](../frontend/src/ui/map-panel.css#L105) | 21.6 px tall | Fail |
| Message type chips | [`style.css:144`](../frontend/src/style.css#L144) | 21.4 px tall, 4 px apart | Fail |
| Figure reset (↺) | [`style.css:185`](../frontend/src/style.css#L185) | 16.8 px tall | Fail |
| People list Look and remove | [`style.css:437`](../frontend/src/style.css#L437) | 20 px tall | Fail |
| Statistics wave buttons | [`run-stats.css:11`](../frontend/src/ui/run-stats.css#L11) | 22.8 px tall, 4 px apart | Fail |
| Map overlay and grid chips | [`map-panel.css:92`](../frontend/src/ui/map-panel.css#L92) | 23.4 px tall, 4 px apart | Fail (just) |
| Speed buttons 1x to 10x | [`speed-control.css:18`](../frontend/src/ui/speed-control.css#L18) | 25.4 px tall but about 20.5 px wide, touching | Fail |
| Wizard progress steps | [`style.css:352`](../frontend/src/style.css#L352) | 12 px tall, about 31.5 px wide, 34.5 px between centres | Pass by spacing |
| Map rail | [`map-panel.css:68`](../frontend/src/ui/map-panel.css#L68) | 44 by 44 px | Pass |
| Wizard and start card actions | [`style.css:355`](../frontend/src/style.css#L355), [`style.css:404`](../frontend/src/style.css#L404) | at least 44 px tall | Pass |
| Play and pause, wizard head buttons, Sandbox minimise, setting reset | [`speed-control.css:5`](../frontend/src/ui/speed-control.css#L5), [`style.css:350`](../frontend/src/style.css#L350), [`style.css:81`](../frontend/src/style.css#L81), [`style.css:327`](../frontend/src/style.css#L327) | 24 to 28 px square | Pass |
| Pack editor steppers | [`account.css:143`](../frontend/src/ui/account/account.css#L143) | 26 by 26 px | Pass |
| Login checkboxes | [`account.css:79`](../frontend/src/ui/account/account.css#L79) | 16 px, but the whole label is clickable | Pass |

## Login, account and recovery code forms

Good:

- Every field has a visible `<label>` tied to its input ([`parts.jsx:50`](../frontend/src/ui/account/parts.jsx#L50), [`parts.jsx:66`](../frontend/src/ui/account/parts.jsx#L66)), and fields are marked `required`.
- `autocomplete` is set so password managers and browsers can fill them: `username` and `current-password` to sign in ([`AuthScreen.jsx:46`](../frontend/src/ui/account/AuthScreen.jsx#L46)), `name`, `username` and `new-password` to register ([`AuthScreen.jsx:90`](../frontend/src/ui/account/AuthScreen.jsx#L90), [`AuthScreen.jsx:67`](../frontend/src/ui/account/AuthScreen.jsx#L67)), and `one-time-code` for the recovery code ([`AuthScreen.jsx:115`](../frontend/src/ui/account/AuthScreen.jsx#L115)). Paste is never blocked. This meets WCAG 3.3.8 (accessible authentication).
- Errors are specific ("The two passwords do not match", the username rule in words) and announced with `role="alert"` ([`AuthScreen.jsx:62`](../frontend/src/ui/account/AuthScreen.jsx#L62), [`AuthScreen.jsx:84`](../frontend/src/ui/account/AuthScreen.jsx#L84)). The password has a Show button with a pressed state and a Caps Lock warning ([`parts.jsx:55`](../frontend/src/ui/account/parts.jsx#L55)). Deleting the account asks for the password and says in words that it cannot be undone ([`ProfileHub.jsx:70`](../frontend/src/ui/account/ProfileHub.jsx#L70)).
- Sign in and Create account are a `tablist` with `aria-selected` ([`AuthScreen.jsx:160`](../frontend/src/ui/account/AuthScreen.jsx#L160)). Both screens are a `<main>` landmark with an `h1` and `h2`, and the profile adds an `h3` per box.

Gaps:

- Field hints are inside the `<label>`, so they become part of the field's name. The password label also wraps the Show button and the strength text, so the field is named something like "New password At least 10 characters ... Show Weak: ..." and the name changes as the user types ([`parts.jsx:50`](../frontend/src/ui/account/parts.jsx#L50)). Hints and errors are not linked with `aria-describedby`, only two fields ever set `aria-invalid` ([`AuthScreen.jsx:70`](../frontend/src/ui/account/AuthScreen.jsx#L70), [`AuthScreen.jsx:91`](../frontend/src/ui/account/AuthScreen.jsx#L91)), and focus is not moved to an error.
- Submit buttons are disabled until the required fields are filled ([`AuthScreen.jsx:53`](../frontend/src/ui/account/AuthScreen.jsx#L53)), with no message saying why.
- The tabs have no `tabpanel` and no arrow-key movement, so they behave as two buttons that say they are tabs.
- The profile edit fields have no `autocomplete` (`name`, `organization-title`, `organization`) ([`ProfileHub.jsx:30`](../frontend/src/ui/account/ProfileHub.jsx#L30)), which WCAG 1.3.5 asks for on fields about the user.
- Faint hint text fails contrast (see [Contrast](#contrast)).

The recovery code flow ([`parts.jsx:74`](../frontend/src/ui/account/parts.jsx#L74)) has no time limit: the code stays on screen until the player ticks "I have saved it somewhere safe", which enables the continue button ([`parts.jsx:84`](../frontend/src/ui/account/parts.jsx#L84)). The code is real text, selectable, 19 px monospaced at 14.68:1 contrast, so a screen reader can read it character by character. Gaps: when the code screen replaces the form, the button that had focus disappears and focus drops to the page body, so a screen reader user is not told the code has appeared; "Copied" is not announced, and a failed copy says nothing ([`parts.jsx:77`](../frontend/src/ui/account/parts.jsx#L77)); and `word-break: break-all` ([`account.css:95`](../frontend/src/ui/account/account.css#L95)) can split a group of characters across lines on a narrow screen. On reset, dashes and capitals are ignored, as the hint says ([`AuthScreen.jsx:115`](../frontend/src/ui/account/AuthScreen.jsx#L115)).

## WCAG 2.2 AA criteria

Pass, Partial or Fail is a judgement from the code; nothing here has been confirmed with users or tools.

| Criterion | Result | Reason |
|---|---|---|
| 1.1.1 Non-text content | Fail | The 3D, minimap, plan, network and spectrum canvases have no text alternative or even a name |
| 1.2.x Time-based media | Not applicable | No audio or video |
| 1.3.1 Info and relationships | Partial | Real tables, fieldsets and form labels; but layout-grid tables in the Unit panel, box titles that are not headings, hints inside labels |
| 1.3.2 Meaningful sequence | Partial | DOM order puts the start card last and lists far from the toolbar that opens them |
| 1.3.3 Sensory characteristics | Partial | Some instructions lean on colour or place ("the lime ring", "a blue square"), though most also name the control |
| 1.3.4 Orientation | Pass | Nothing locks orientation |
| 1.3.5 Identify input purpose | Partial | Login and register fields have `autocomplete`; profile edit fields do not |
| 1.4.1 Use of colour | Fail | Timeline markers, placement preview and the sandbox integrity bar rely on colour |
| 1.4.3 Contrast (minimum) | Fail | Box titles, toolbar key line, unaffordable price, sandbox banner and login faint text are below 4.5:1 |
| 1.4.4 Resize text | Partial | Browser zoom works, but fixed boxes on an unscrollable page overlap at 200 % |
| 1.4.5 Images of text | Pass | Text is text; map tiles are exempt as maps |
| 1.4.10 Reflow | Partial | Account and start screens reflow; game panels do not |
| 1.4.11 Non-text contrast | Fail | Input borders at 1.88:1 and 2.15:1 |
| 1.4.12 Text spacing | Not tested | Ellipsis truncation suggests risk |
| 1.4.13 Content on hover or focus | Pass | Only native `title` tooltips, which the browser controls |
| 2.1.1 Keyboard | Fail | No keyboard way to place on generated ground, draw an area or route, turn or zoom the camera, wire one system, or open a message |
| 2.1.2 No keyboard trap | Pass | None found |
| 2.1.4 Character key shortcuts | Fail | Global single-key shortcuts with no way to turn them off or remap them |
| 2.2.1 Timing adjustable | Pass | Pause at any time, speed down to 1x, time scale down to 0.5, and the clock stops for approvals |
| 2.2.2 Pause, stop, hide | Partial | The login backdrop animates without a pause control; reduced motion stops it |
| 2.3.1 Three flashes | Not tested | Short weapon flashes; rate not measured |
| 2.4.1 Bypass blocks | Partial | Account screens use `<main>`; the game has no landmarks or headings to jump between boxes |
| 2.4.2 Page titled | Pass | "Site Guard", though it never changes |
| 2.4.3 Focus order | Fail | Start card last; no focus moved into opened panels or back on close; recovery code screen loses focus |
| 2.4.4 Link purpose | Pass | Source links use the source's name as text |
| 2.4.5 Multiple ways | Not applicable | One page |
| 2.4.6 Headings and labels | Partial | Good on account screens; game boxes have no headings and some fields no labels |
| 2.4.7 Focus visible | Pass | Browser rings kept in the game; custom rings on account screens |
| 2.4.11 Focus not obscured | Fail | Focusable controls behind the start and results cards; overlapping boxes |
| 2.5.1 Pointer gestures | Partial | The 3D view zooms by pinch or wheel only |
| 2.5.2 Pointer cancellation | Pass | Placement acts on release and ignores a moved pointer ([`placement.js:102`](../frontend/src/render/placement.js#L102)) |
| 2.5.3 Label in name | Pass | Visible text is part of every name checked |
| 2.5.4 Motion actuation | Not applicable | No device motion input |
| 2.5.7 Dragging movements | Partial | Placing has a click alternative; turning the camera, looking round from a mast and moving boxes do not |
| 2.5.8 Target size (minimum) | Fail | Many small buttons from 16 to 23.4 px tall, close together |
| 3.1.1 Language of page | Pass | `lang="en"` |
| 3.1.2 Language of parts | Pass | All English |
| 3.2.1 On focus | Pass | Nothing changes on focus |
| 3.2.2 On input | Pass | Choosing from a list changes a setting or the map, not the context |
| 3.2.3 Consistent navigation | Pass | One layout |
| 3.2.4 Consistent identification | Pass | Same controls named the same way |
| 3.2.6 Consistent help | Pass | The wizard button stays in one place |
| 3.3.1 Error identification | Partial | Account errors are clear and announced; game number fields silently revert a bad entry ([`NumberInput.jsx:19`](../frontend/src/ui/NumberInput.jsx#L19)) and refusals only toast |
| 3.3.2 Labels or instructions | Partial | Six fields rely on placeholder or nearby text |
| 3.3.3 Error suggestion | Partial | Account errors say how to fix them; game refusals say why but vanish |
| 3.3.4 Error prevention | Pass | Deleting an account needs the password; overwriting and deleting saves need two clicks |
| 3.3.7 Redundant entry | Pass | Only the new password is typed twice, which is allowed for security |
| 3.3.8 Accessible authentication | Pass | Password managers and paste work |
| 4.1.2 Name, role, value | Fail | Dock tabs, glyph-named buttons, unlabelled slider, clickable `div`s, filter chips |
| 4.1.3 Status messages | Fail | Toasts, approval requests and the end of a run are not announced |

WCAG 4.1.1 Parsing was removed in WCAG 2.2, so it is not listed.

## Gaps in priority order, with fixes

Smallest useful change first within each item. File references point to where the change goes.

1. **Announce what matters.** Give `#toast` `role="status"` ([`Panels.jsx:54`](../frontend/src/ui/Panels.jsx#L54)); it is always mounted, so this works as is. Give each approval request `role="alert"` and move focus to its Approve button when the first request arrives ([`Panels.jsx:62`](../frontend/src/ui/Panels.jsx#L62)); the clock is already paused then. Announce the end of a run and focus the results card heading.
2. **Fix focus order on the start and results cards.** Wrap the game panels in `inert` while `#overlay` is showing, the same pattern as [`Root.jsx:98`](../frontend/src/ui/account/Root.jsx#L98), or render the overlay first, and focus its heading.
3. **Name the unnamed controls.** `aria-label` on the dock's size and close buttons, the timeline buttons and slider, and the figure reset; `aria-pressed` (or a proper tab pattern) on the dock tabs and message type chips; real `<label>`s for the six fields in the table above; a fixed name such as "Plan view" on the 2D and 3D toggle.
4. **Make clickable rows keyboard-usable.** Turn message, packet and follow rows into buttons, or add `role="button"`, `tabIndex` and the existing `onKeys` helper ([`SystemCard.jsx:26`](../frontend/src/ui/SystemCard.jsx#L26)). Give the tray's people cards a click and key handler that picks the People tool with that group.
5. **Let keyboard users place anywhere.** Add "Place it here" beside the wizard's "Show me a good spot", calling `game.placeSystem` with the suggested spot ([`steps.jsx:31`](../frontend/src/ui/assistant/steps.jsx#L31)). Offer the position form on generated ground too, in metres east and north of the site.
6. **Shortcuts.** Add a "Keyboard shortcuts" checkbox in Controls that turns the single-key shortcuts off (this alone satisfies 2.1.4). Only step the replay with Left and Right when a replay is already active or the timeline has focus.
7. **Contrast.** Use #7f93b2 for box titles, the legend hint and the toolbar key line (5.90:1 on a panel; 4.59:1 on a button), #ff8a80 for the unaffordable price (6.28:1), dark text #0b1220 on the sandbox banner (6.71:1), `--a-muted` instead of `--a-faint` for login hints (6.10:1), and an input border such as #5a7bb0 (4.29:1).
8. **Colour alone.** Show "Can place here" or the refusal reason as text in the picker while a tool is held ([`ToolPicker.jsx:22`](../frontend/src/ui/ToolPicker.jsx#L22) already shows the range at the cursor); list timeline events as text, or let their markers take the pointer; add a percentage to the integrity bar.
9. **Target sizes.** Give the small buttons in the target size table `min-height: 24px` and `min-width: 24px`.
10. **Focus management.** When a toolbar row, the map switcher, the zone button, the Attack button or a Nodes button opens a panel, move focus to the panel's heading or first control, and return it to the opener on close. Let Escape close the dock, wizard, Attack and Area to defend panels as well.
11. **Account forms.** Move hints and errors to `aria-describedby` and the Show button out of the `<label>`; focus the heading when the recovery code appears; announce "Copied" and say when copying fails; add `autocomplete` to the profile fields.
12. **3D view.** Mark `#labels` `aria-hidden="true"` and give the canvas `role="img"` with a name. The larger piece is a text picture of the battle: a live, announced event log (leaks, kills, approvals, lost contact) and a track table with bearing, range and type.
13. **Zoom.** At narrow widths, let the HUD boxes stack in a scrolling column instead of floating.

## How to test accessibility

The repo has **no automated accessibility test today**, which was checked: `frontend/package.json` has no axe, jsx-a11y or similar package ([`package.json:21`](../frontend/package.json#L21)), there is no ESLint configuration, and the repo has no CI workflow. Some behaviour is unit-tested along the way: the hotkey guards ([`sizes.test.jsx:99`](../frontend/tests/sizes.test.jsx#L99)), moving a box by keyboard ([`movable.test.jsx:48`](../frontend/tests/movable.test.jsx#L48)), Escape ([`unit-panel.test.jsx:438`](../frontend/tests/unit-panel.test.jsx#L438)), and many tests find elements by role or label, which checks those names exist.

Start the app as in the README (the frontend dev server listens on port 5199, [`vite.config.js:7`](../frontend/vite.config.js#L7)), sign in, then:

**Manual keyboard pass (about 20 minutes).** Unplug or ignore the mouse.

1. Sign in, register and reset a password by keyboard only. Check each error is read out and that the recovery code screen can be found.
2. On the start screen, count Tab presses to reach the start card. Choose a real map site by typed grid reference, start, then pick a system from the toolbar with Enter and place it with the Map panel's grid reference box.
3. Repeat on generated ground and note that placement is impossible.
4. Open each dock tab, each box, and the wizard; check you can reach, use and close each, where focus goes on close, and whether Escape helps.
5. Start a wave, pause with Space, set authority to "Ask for every engagement" and decide a request by keyboard.
6. Watch the focus ring at every stop: is it always visible and never behind another box?

**Screen reader pass.** On Windows use NVDA with Firefox or Chrome; on a Mac use VoiceOver with Safari. Repeat steps 1, 2 and 5, listening for: names of icon buttons, the state of toggles, whether toasts and approval requests are spoken, and what is read when you arrow through the page past the 3D view.

**Automated checker.** Run a checker based on axe-core, such as the axe DevTools browser extension, on the login page, the profile, the start card, the game with each dock tab open, and the results card. An address-only command-line run will only ever see the login page, because the game sits behind sign-in. Automated checks catch problems such as missing names, low contrast and wrong roles; they cannot judge focus order, keyboard reach or whether announcements make sense. To keep regressions out, a later step could render components in the existing Vitest and Testing Library set-up and run axe-core on them, though jsdom cannot judge contrast or layout.

**Other checks.** Zoom the browser to 200 % and 400 %; turn on the operating system's reduced motion setting; and view the game through a colour vision deficiency simulator (Chrome's DevTools rendering panel has one) while placing systems and reading the timeline.

## Limits and simplifications

- This is a desk review of the code at one point in time. It has not been tried by disabled users, with assistive technology, or with an automated checker, so some Passes may not hold in a browser and some problems will have been missed.
- Contrast for text over the 3D view depends on what is behind it; the pale-map figures are a worst case, and the 3D scene's own colours (drones against sky, preview rings against ground) were not measured.
- Target sizes are computed from CSS rules, not measured, and assume the default font.
- Screen reader behaviour (browse and focus modes) is described from how screen readers generally work, not from a test of this app.
- The backend has no user interface of its own, so it is out of scope.

## Where this lives in the code

- [`frontend/index.html`](../frontend/index.html): language, title and viewport.
- [`frontend/src/style.css`](../frontend/src/style.css) and the other stylesheets in `frontend/src/ui`: colours, focus rings, target sizes, reduced motion.
- [`frontend/src/ui/useHotkeys.js`](../frontend/src/ui/useHotkeys.js): every keyboard shortcut and Escape.
- [`frontend/src/ui/Movable.jsx`](../frontend/src/ui/Movable.jsx) and [`useMovable.js`](../frontend/src/ui/useMovable.js): moving and minimising boxes, by pointer and keyboard.
- [`frontend/src/ui/App.jsx`](../frontend/src/ui/App.jsx): the order of everything on the game screen, which is the Tab order.
- [`frontend/src/ui/Panels.jsx`](../frontend/src/ui/Panels.jsx): toasts and approval requests.
- [`frontend/src/ui/MapControls.jsx`](../frontend/src/ui/MapControls.jsx): the map rail, map panel and grid reference placement.
- [`frontend/src/ui/SystemCard.jsx`](../frontend/src/ui/SystemCard.jsx): keyboard-usable catalogue cards and drag start.
- [`frontend/src/ui/account`](../frontend/src/ui/account): the login, profile and recovery code screens, and `inert` over the game.
- [`frontend/src/ui/assistant`](../frontend/src/ui/assistant): the wizard, its live step title and the spotlight ring.
- [`frontend/src/render/labels.js`](../frontend/src/render/labels.js) and [`placement.js`](../frontend/src/render/placement.js): name tags over the 3D view and the coloured placement preview.
- [`frontend/src/game.js`](../frontend/src/game.js): the clock, pausing for approvals, and what a map click does.
