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
- **Right: the inspector.** It changes with what's selected, in this order: the selected annotation (text box format controls and the missing-character warning), then the selected pages (rotate, extract, delete), then Document (page numbers, watermark, password). With Stamps active, it shows the stamps library: ticks, initials, signatures.
- **Nothing floats over the page.** The text format bar and the page-controls panel are both replaced by the inspector.
- **Phone (under 640 px):** the inspector becomes a bottom sheet. Lowered, it shows a one-line summary plus page navigation and zoom. Raised, it shows the full sections and stops short of the selected annotation. Thumbnails stay in the ☰ drawer, with long-press drag. Pages open fitted to the width. The tool row spans the screen. Controls are at least 44 px.

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
| scrim | `rgba(19,32,27,0.42)` | `rgba(4,10,8,0.62)` |
| shadow | `rgba(19,40,32,0.16)` | `rgba(2,10,7,0.60)` |

Radii: 18 px panels, 24 px dialogs, pill (half the height) for buttons and chips, 14 px for tiles inside panels.

## Geometry: prohibitions
- Never square corners on chrome. The page and thumbnails keep 4–6 px, so they read as paper.
- Never a control that floats over the page.
- Never more than one row of header or tools at any width. Controls that don't fit go into File ▾ or Export ▾.
- Never a control smaller than 44 px on the phone layout.

## What colour means
- **Accent = the current thing:** the active tool, the selected pages, the current page number, the primary action, settings that are On, and the seal.
- **The page and everything on it is the user's content, and the palette stops at its edge.** Stamp colours, marker yellow, text colours and the white page are content, never tokens. The only chrome drawn on the page is the selection outline, which uses `selection-on-page` in both modes, because the dark accent measures only 2.06:1 on white.
- **Danger always has wording** ("Delete box", "Delete 2 pages") and a trash icon where space is short. Accent and danger measure **1.03:1 against each other in both modes**, so colour alone never carries danger.
- `divider` is decorative and never the only edge of a control. Use `outline` for that.

## Contrast
- Text 4.5:1 and non-text 3:1 in both modes, with a margin, not a bare pass. Measured by script, never by eye.
- Measured on 20 Oct (WCAG formula): text roles 5.2–16.8:1. On-accent 6.4:1 light, 7.5:1 dark. Danger 5.3–8.5:1. Outline 3.2–4.4:1 light, 3.9–5.0:1 dark. `divider` (1.35–1.5:1) is decorative only, by design.
- No coloured text on translucent tints. Selected states use a solid fill or an outline.

## Enforcement
- No colour, font or radius literal outside `src/styles/tokens.css`, except in document content (see What colour means): `src/lib/stamps.js` colours, user-picked colours, and the font previews in the font picker.
- `npm run lint:styles`: stylelint with `declaration-strict-value` on `color`, `background`, `background-color`, `border`, `border-color`, `outline`, `box-shadow`, `fill`, `stroke`, `font`, `font-family` and `border-radius`, which must use `var(--…)`. `inherit`, `currentColor`, `transparent` and `0` are allowed.
- `npm run check:literals` (a Node script, not grep): JSX/JS outside `src/lib/` and `src/styles/` contains no hex or `rgb(`/`hsl(` colours, no quoted font names in `fontFamily`/`font`, and no numeric `borderRadius`. Values must be `var(...)`.
- Each check is proven both ways: silent on the real code, and catching one planted literal of each kind (colour, quoted font, px radius) in each file type it covers.
- `color-scheme` and the mode toggle switch the token set on `:root[data-theme]`. No component reads the mode directly.

## Icon
Not picked: Nick skipped the icon round on 20 Oct. The existing icon stays.

## Not settled here
This file does not settle the palette. Rendering and judging on the laptop and the A32 does.
