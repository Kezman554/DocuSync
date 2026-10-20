# DocuSync — Design

Status: provisional. Values hold until judged on the laptop and the Samsung A32 (390 px wide).
Canvas: https://claude.ai/artifact/1roWSBi9tdGTni3GVsRnrT (round 3 is the spec; rounds 1–2 are the options it came from)

## Purpose and conditions of use
- Display: laptop first, phone second. A public demo, so strangers' screens are unknown: design with margin, don't tune.
- Use: close up, at a desk or holding a phone; attention on one document, often a private one (insurance, payslips).
- Looked at most: the page. Everything else serves it, and the page always stays white.
- Modes: light and dark. Follows the device by default, with a toggle that is remembered in this browser.

## Direction
A private document tool that says so: calm green-grey panels around a white page, and a permanent "On this device · nothing uploaded" seal in the header. Chosen on the canvas: look C ("Sealed") with layout L4 ("Inspector"). Look C is provisional, and Nick may revisit it.

## Layout (L4)
- **Header, one row:** thumbnails toggle, name, seal, file name, **File ▾** (Open another, Add PDF, From images, Close), **Export PDF** as a split button whose menu holds Export with password, Extract pages, Export images and Compress.
- **Left:** page thumbnails. **Centre:** one tool row (Marker, Text, Image, Redact, Stamps), with page navigation and zoom at its right end, then the page.
- **Right: the inspector.** It changes with what's selected, in this order: the selected annotation (text box format controls and the missing-character warning), then the selected pages (rotate, extract, delete), then Document (page numbers, watermark, password). With Stamps active, the stamps library (ticks, initials, signatures) is its top section, and the selected-pages and Document sections stay below it.
- **Nothing floats over the page.** The text format bar and the page-controls panel are both replaced by the inspector.
- **Phone (under 640 px):** the inspector becomes a bottom sheet. Lowered, it shows a one-line summary plus page navigation and zoom. Raised, it is at most 50% of the screen's height, its sections scroll inside it, the navigation and zoom row hides until it's lowered, and the page scrolls so the selected annotation stays in view above it (at least 300 px of page shows on a 390×844 screen). Thumbnails stay in the ☰ drawer, with long-press drag. The tool row spans the screen. The light/dark switch moves into File ▾. Controls are at least 44 px.
- **Notices:** a strip across the top of the workspace, directly under the header, with a × to dismiss. It pushes the tool row, thumbnails, inspector and sheet down while it's visible and never covers anything; on a phone it wraps onto as many lines as it needs. Errors keep the danger edge; information is a neutral outlined note in the text colour. The kind comes from what happened, not the wording.
- **No document open:** no thumbnail column, and no ☰ drawer toggle on the phone. The tool row stays, so Stamps works before a PDF is open. The well behind the open-a-PDF card is lit, not empty. A dot grid (1.2 px dots on a 22 px pitch, centred) fades out towards the edges. Soft window light comes from the top left. Two A4 paper outlines (300 × 424 px, 6 px corners, ruled lines, never real content) fan out behind the card at −11° and +8°, each tucked 50 px under it. The card carries the `shadow`. All of that is `aria-hidden` and lets a dropped file through to the drop zone. 28 px under the card is a feature strip: six tiles (Pages, Sign and stamp, Redact, Password, Number and watermark, Images and PDF), each an accent icon, a bold title and a line of `text-secondary`. They are information, not controls: no hover, no pointer, not focusable. Six in a row (at most 1090 px) where they fit, otherwise three. On the phone they are two per row, the empty state scrolls inside the well so they can be reached, and the fanned sheets are hidden. The dots and the light stay at every width. None of it shows once a document is open.
- **Opening a page, any width:** a page wider than the viewer at 100% opens fitted to the viewer's width, so its left edge is never cut off; zoom still goes back to 100%.

## Tokens
Typeface: Manrope, weights 400/500/600/700, bundled with `@fontsource` (never fetched).

| Role | Light | Dark |
|---|---|---|
| ground | `#E4E9E6` | `#0F1714` |
| surface (panels, header controls) | `#F4F7F5` | `#17221E` |
| raised (menus, dialogs, inputs) | `#FFFFFF` | `#1D2A25` |
| well (behind the page) | `#D6DDD9` | `#0B110F` |
| text | `#13201B` | `#E3EBE7` |
| text-secondary | `#4D5E57` | `#93A59D` |
| accent | `#1D6B57` | `#5CC7A6` |
| accent-fill / on-accent | `#1D6B57` / `#FFFFFF` | `#5CC7A6` / `#062A20` |
| danger | `#A33A2C` | `#F49A8C` |
| divider (decorative only) | `#C3CEC8` | `#2A3934` |
| outline (control edges, drop zone) | `#6A7C75` | `#71877C` |
| selection-on-page | `#1D6B57` | `#1D6B57` |
| danger-on-page (Redacted badge, annotation delete ×) | `#C01C28` | `#C01C28` |
| danger-on-page-hover | `#9B1620` | `#9B1620` |
| on-danger-on-page | `#FFFFFF` | `#FFFFFF` |
| scrim | `rgba(19,32,27,0.42)` | `rgba(4,10,8,0.62)` |
| shadow | `rgba(19,40,32,0.16)` | `rgba(2,10,7,0.60)` |
| accent-fill-hover | `#175546` | `#7DD4B9` |
| danger-fill-hover | `#8A3024` | `#F7B3A8` |
| on-danger (text on a danger fill) | `#FFFFFF` | `#3A0D07` |
| well-dot (decorative: the dot grid behind the empty state) | `rgba(19,32,27,0.18)` | `rgba(227,235,231,0.14)` |
| well-light (decorative: the window light in the empty well) | `rgba(255,255,255,0.65)` | `rgba(92,199,166,0.12)` |
| sheet-edge (decorative: the fanned sheets' edge) | `rgba(19,32,27,0.16)` | `rgba(227,235,231,0.12)` |
| sheet-fill (decorative: the fanned sheets' fill) | `rgba(255,255,255,0.32)` | `rgba(255,255,255,0.025)` |
| sheet-rule (decorative: the fanned sheets' ruled lines) | `rgba(19,32,27,0.08)` | `rgba(227,235,231,0.07)` |

The well-* and sheet-* roles are decorative only. They carry no text and are not measured, and the strip's text is `text` and `text-secondary` on `surface`, which are.

These stay the same in both modes. They are content, or chrome that sits on the white page:

| Role | Light | Dark |
|---|---|---|
| page | `#FFFFFF` | `#FFFFFF` |
| page-veil (behind text being edited) | `rgba(255,255,255,0.85)` | `rgba(255,255,255,0.85)` |
| on-paper (text on white, e.g. initials style names) | `#13201B` | `#13201B` |
| on-paper-muted ("Sign here" prompt) | `#4D5E57` | `#4D5E57` |
| paper-mark (signing line, unchosen page-number spots) | `#C3CEC8` | `#C3CEC8` |
| selection-ring | 1 px `page` halo, then 3 px `selection-on-page` | same |
| marker-fill / marker-edge (the highlight, multiplied; export uses the same) | `rgba(255,213,0,0.45)` / `rgba(230,170,0,0.9)` | same |
| redaction-edge | `#C01C28` | `#C01C28` |
| redaction-hatch | `rgba(17,17,17,0.6)` / `rgba(17,17,17,0.15)` stripes | same |
| checker (behind a cut-out signature) | `#E3E5E8` squares on `page` | same |
| source-1 … source-6 (which file a page came from) | `#7FB0F8` `#E5A50A` `#2EC27E` `#F08A3C` `#D58CDC` `#F66151` | same |
| on-source | `#13201B` | `#13201B` |

Radii: 18 px panels, 24 px dialogs, pill (half the height) for buttons and chips, 14 px for tiles inside panels, 4 px for the page (`radius-paper`), 6 px for the empty state's fanned sheets (`radius-sheet`).

## Geometry: prohibitions
- Never square corners on chrome. The page and thumbnails keep 4–6 px, so they read as paper.
- Never a control that floats over the page.
- Never more than one row of header or tools at any width. Controls that don't fit go into File ▾ or Export ▾.
- Never a control smaller than 44 px on the phone layout.

## What colour means
- **Accent = the current thing:** the active tool, the selected pages, the current page number, the primary action, settings that are On, and the seal.
- **The page and everything on it is the user's content, and the palette stops at its edge.** Stamp colours, marker yellow, text colours and the white page are content, never tokens. Chrome drawn on the page or a thumbnail uses the `-on-page` roles, the same in both modes: the selection outline uses `selection-on-page` (the dark accent measures only 2.06:1 on white), and anything in the danger colour (the Redacted badge, the annotation delete ×) uses `danger-on-page` (the dark danger measures only 2.13:1 on white).
- **Three tiers.** Danger is for destructive actions, errors and redaction. Cautions, such as missing characters and the redaction warning before export, are `text`-coloured notes with an `outline` edge. Offers, such as the re-lock offer, are outlined in `accent`.
- **Danger always has wording** ("Delete box", "Delete 2 pages") and a trash icon where space is short. Accent and danger measure **1.03:1 against each other in both modes**, so colour alone never carries danger.
- `divider` is decorative and never the only edge of a control. Use `outline` for that.

## Contrast
- Text 4.5:1 and non-text 3:1 in both modes, with a margin, not a bare pass. Measured by script, never by eye.
- Measured on 20 Oct (WCAG formula): text roles 5.2–16.8:1. On-accent 6.4:1 light, 7.5:1 dark. Danger 5.3–8.5:1. Outline 3.2–4.4:1 light, 3.9–5.0:1 dark. `divider` (1.35–1.5:1) is decorative only, by design.
- No coloured text on translucent tints. Selected states use a solid fill or an outline.

## Enforcement
- No colour, font or radius literal outside `src/styles/tokens.css`, except in document content (see What colour means): `src/lib/stamps.js` colours, user-picked colours, and the font previews in the font picker. The icon (`public/icon.svg`, see Icon) keeps its own fixed brand colours.
- `npm run lint:styles`: stylelint with `declaration-strict-value` on `color`, `background`, `background-color`, `border` (and `border-top`/`-right`/`-bottom`/`-left`), `border-color`, `outline`, `box-shadow`, `fill`, `stroke`, `font`, `font-family` and `border-radius`, which must use `var(--…)`. `inherit`, `currentColor`, `transparent` and `0` are allowed.
- `npm run check:literals` (a Node script, not grep): JSX/JS outside `src/lib/` and `src/styles/` contains no hex or `rgb(`/`hsl(` colours, no quoted font names in `fontFamily`/`font`, and no numeric `borderRadius`. Values must be `var(...)`.
- Each check is proven both ways: silent on the real code, and catching one planted literal of each kind (colour, quoted font, px radius) in each file type it covers.
- `color-scheme` and the mode toggle switch the token set on `:root[data-theme]`. No component reads the mode directly.

## Icon
**"Fanned, signed."** Two sheets fanned on a green tile, the front one signed.

- **Grid:** 32 × 32 units.
- **Tile:** the full 32 × 32, corner radius 8, `#1D6B57`.
- **Back sheet:** 12 × 16 at (6.5, 8), radius 1.5, turned −12° about (12.5, 16), `#A9CFC2`.
- **Front sheet:** 12 × 17 at (13, 7), radius 1.5, `#FFFFFF`.
- **Signature:** a looped stroke from (15, 17.5), 1.7 wide, round caps and joins, `#1D6B57`. In the 16 px render only it is 2.4 wide; at 1.7 it faded to a pale smudge at that size.
- **Signing line:** (15, 21) to (23, 21), 1.1 wide, round caps, `#1D6B57`.

The colours are fixed brand values, not theme tokens: the icon looks the same in light and dark browsers.

**Source:** `public/icon.svg`, the single source for every icon. `npm run icons` (`scripts/icons.mjs`, using sharp) regenerates `favicon.ico` (16, 32, 48 px), `apple-touch-icon.png` (180) and `icon-192.png` / `icon-512.png` in `public/`. `index.html` links the SVG as the icon, the .ico as the fallback, and the apple-touch-icon.

## Not settled here
This file does not settle the palette. Rendering and judging on the laptop and the A32 does.
