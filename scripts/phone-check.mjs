// Phone layout checks (DESIGN.md › Layout, Phone) in headless Edge,
// emulating a 390×844 touchscreen, in light and dark: horizontal scroll,
// the header in one row (also at 360 px), the bottom sheet lowered/raised
// by tap and drag, typing with it raised, the stamps library, menus,
// dialogs, the drawer's long-press drag to the bottom edge, and every
// control's size measured from the rendered DOM (44×44 px minimum).
// Prints a JSON report and writes screenshots to <outDir>.
//
//   npm run build && npx vite preview --port 4179 --strictPort
//   node scripts/phone-check.mjs <outDir> <a PDF of 10+ pages> [light|dark]
//
// EDGE (browser path) and APP_URL override the defaults.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , outDir, pdfPath, only] = process.argv;
const URL_ = process.env.APP_URL ?? 'http://localhost:4179/';
const EDGE = process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = join(outDir, 'edge-profile-phone');
mkdirSync(profile, { recursive: true });
const port = 9337;
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  } catch { await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const waitFor = async (expression, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(`!!(${expression})`)) return;
    await sleep(120);
  }
  throw new Error(`timed out: ${expression}`);
};
const shoot = async (name) => {
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
};
const rectOf = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, bottom: b.bottom, right: b.right }; })()`);
const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) });
const tap = async (x, y) => {
  await touch('touchStart', [[x, y]]);
  await sleep(40);
  await touch('touchEnd', []);
  await sleep(150);
};
const tapEl = async (sel) => {
  const r = await rectOf(sel);
  if (!r) throw new Error(`no ${sel}`);
  await tap(r.x + r.w / 2, r.y + r.h / 2);
};

// Every visible control smaller than 44 × 44 CSS px. Checkboxes and radios
// count by their label (the real tap target).
const SMALL = `(() => {
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=menuitem], [tabindex]:not([tabindex="-1"]), .annotation__handle';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    let box = el;
    if (el.matches('input[type=checkbox], input[type=radio]')) box = el.closest('label') ?? el;
    if (el.matches('input[type=file]')) continue;
    // An annotation is document content at its own size, not a control.
    if (el.matches('.annotation')) continue;
    const r = box.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (box.closest('[hidden]')) continue;
    // Off-screen (e.g. the closed drawer) isn't on screen to tap.
    if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) continue;
    if (r.width < 44 - 0.5 || r.height < 44 - 0.5) {
      out.push((el.getAttribute('aria-label') || el.textContent.trim() || el.className || el.tagName).slice(0, 40) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
    }
  }
  return out;
})()`;
const noHScroll = `(() => ({ doc: document.documentElement.scrollWidth - innerWidth, body: document.body.scrollWidth - innerWidth }))()`;

const report = {};
try {
  await send('Page.enable');
  await send('DOM.enable');
  await send('Runtime.enable');
  for (const mode of only ? [only] : ['light', 'dark']) {
    const r = (report[mode] = {});
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
    await send('Page.navigate', { url: URL_ });
    await waitFor(`!!document.querySelector('.empty-state')`);
    await evaluate(`(localStorage.clear(), document.fonts.ready.then(() => true))`);
    r.theme = await evaluate(`document.documentElement.dataset.theme`);
    r.emptyHScroll = await evaluate(noHScroll);
    r.emptySmall = await evaluate(SMALL);
    await shoot(`phone-${mode}-empty`);

    // Open the 12-page PDF.
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[aria-label="Open PDF files"]' });
    await send('DOM.setFileInputFiles', { nodeId, files: [pdfPath] });
    await waitFor(`!!document.querySelector('.viewer__canvas') && document.querySelector('.inspector__summary')`);
    await sleep(700);
    r.zoom = await evaluate(`document.querySelector('.inspector--sheet .tool-row__label--zoom')?.textContent`);
    const canvas = await rectOf('.viewer__canvas');
    const scroll = await rectOf('.viewer__scroll');
    r.pageFits = { canvasLeft: Math.round(canvas.x), canvasRight: Math.round(canvas.right), scrollLeft: Math.round(scroll.x), scrollRight: Math.round(scroll.right) };
    r.hScroll = await evaluate(noHScroll);
    r.header = await evaluate(`(() => { const h = document.querySelector('.toolbar'); const kids = [...h.querySelectorAll('.toolbar__group > *:not(input)')].filter((e) => e.getBoundingClientRect().width > 0); const mids = kids.map((e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; }); const rows = Math.max(...mids) - Math.min(...mids) > 12 ? 2 : 1; return { height: Math.round(h.getBoundingClientRect().height), rows, overflow: h.scrollWidth - h.clientWidth }; })()`);
    r.toolRow = await evaluate(`[...document.querySelectorAll('.tool-row__btn')].map((b) => Math.round(b.getBoundingClientRect().height))`);
    r.lowered = await rectOf('.inspector--sheet');
    r.summaryLowered = await evaluate(`document.querySelector('.inspector__summary').textContent`);
    r.smallLowered = await evaluate(SMALL);
    await shoot(`phone-${mode}-lowered`);

    // Raise by tapping the summary.
    await tapEl('.inspector__summary');
    await waitFor(`document.querySelector('.inspector--raised')`);
    r.raised = await rectOf('.inspector--sheet');
    r.raisedBodyScrolls = await evaluate(`(() => { const b = document.querySelector('.inspector__sheet-body'); return { scrollHeight: b.scrollHeight, clientHeight: b.clientHeight, overflowY: getComputedStyle(b).overflowY }; })()`);
    r.smallRaised = await evaluate(SMALL);
    await shoot(`phone-${mode}-raised`);
    // Lower by dragging the handle down.
    const h = await rectOf('.inspector__handle');
    await touch('touchStart', [[h.x + h.w / 2, h.y + h.h / 2]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[h.x + h.w / 2, h.y + h.h / 2 + i * 15]]); await sleep(16); }
    await touch('touchEnd', []);
    await sleep(300);
    r.loweredByDrag = !(await evaluate(`!!document.querySelector('.inspector--raised')`));
    // Raise by dragging the handle up.
    const h2 = await rectOf('.inspector__handle');
    await touch('touchStart', [[h2.x + h2.w / 2, h2.y + h2.h / 2]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[h2.x + h2.w / 2, h2.y + h2.h / 2 - i * 15]]); await sleep(16); }
    await touch('touchEnd', []);
    await sleep(300);
    r.raisedByDrag = await evaluate(`!!document.querySelector('.inspector--raised')`);
    await tapEl('.inspector__summary'); // lower again
    await sleep(250);

    // Text: place a box low on the visible page, type, raise the sheet, type more.
    await tapEl('[aria-label="Add text"]');
    const lowered = await rectOf('.inspector--sheet');
    const layer = await rectOf('.annotation-layer');
    const ty = Math.min(layer.bottom, lowered.y) - 60;
    await tap(layer.x + 40, ty);
    await waitFor(`!!document.querySelector('textarea')`);
    await send('Input.insertText', { text: 'Claim ' });
    // Done typing (the box stays selected), then raise the sheet: the box
    // must scroll into view above it.
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
    r.selectedAfterTyping = await evaluate(`!!document.querySelector('.annotation--selected')`);
    await tapEl('.inspector__summary');
    await waitFor(`document.querySelector('.inspector--raised')`);
    await sleep(600);
    r.scrolledIntoView = await evaluate(`(() => {
      const box = document.querySelector('.annotation--selected').getBoundingClientRect();
      const sheet = document.querySelector('.inspector--sheet').getBoundingClientRect();
      const scroll = document.querySelector('.viewer__scroll').getBoundingClientRect();
      return { boxTop: Math.round(box.top), boxBottom: Math.round(box.bottom), sheetTop: Math.round(sheet.top), viewTop: Math.round(scroll.top), ok: box.bottom <= sheet.top && box.top >= scroll.top };
    })()`);
    // Type into it with the sheet raised: Enter on the selected box edits it.
    await evaluate(`document.querySelector('.annotation--selected').focus(), true`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(`!!document.querySelector('textarea')`);
    await evaluate(`(() => { const t = document.querySelector('textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true; })()`);
    await send('Input.insertText', { text: 'łódka' });
    await sleep(400);
    r.typing = await evaluate(`(() => {
      const t = document.querySelector('textarea');
      const box = (document.querySelector('.annotation--editing') ?? t).getBoundingClientRect();
      const sheet = document.querySelector('.inspector--sheet').getBoundingClientRect();
      return { raised: !!document.querySelector('.inspector--raised'), value: t.value, focused: document.activeElement === t, boxBottom: Math.round(box.bottom), sheetTop: Math.round(sheet.top), visibleAboveSheet: box.bottom <= sheet.top && box.top >= 0, summary: document.querySelector('.inspector__summary').textContent };
    })()`);
    // Raised with a text box selected: capped at 50% of the height, the nav
    // row hidden, and at least 300 px of page showing above it, box in view.
    r.raisedCap = await evaluate(`(() => {
      const sheet = document.querySelector('.inspector--sheet').getBoundingClientRect();
      const view = document.querySelector('.viewer__scroll').getBoundingClientRect();
      const page = document.querySelector('.viewer__canvas').getBoundingClientRect();
      const box = document.querySelector('.annotation--editing, .annotation--selected').getBoundingClientRect();
      const pageShown = Math.max(0, Math.min(page.bottom, sheet.top) - Math.max(page.top, view.top));
      return {
        sheetHeight: Math.round(sheet.height),
        cap: Math.round(innerHeight * 0.5),
        withinCap: sheet.height <= innerHeight * 0.5 + 1,
        navHidden: !document.querySelector('.inspector--sheet .tool-row__group--nav'),
        pageShown: Math.round(pageShown),
        pageShownOk: pageShown >= 300,
        boxInView: box.top >= view.top && box.bottom <= sheet.top,
      };
    })()`);
    await shoot(`phone-${mode}-typing-raised`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
    await evaluate(`document.querySelector('[aria-label="Add text"][aria-pressed="true"]')?.click(), true`);
    // Summary with the text box selected.
    await evaluate(`document.querySelector('.annotation--text')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`);

    // Stamps in the sheet.
    await evaluate(`(document.querySelector('.inspector--raised') && document.querySelector('.inspector__summary').click(), true)`);
    await tapEl('[aria-controls="stamps-panel"]');
    await waitFor(`!!document.querySelector('.inspector--raised #stamps-panel')`);
    r.stampsSummary = await evaluate(`document.querySelector('.inspector__summary').textContent`);
    r.smallStamps = await evaluate(SMALL);
    await shoot(`phone-${mode}-stamps`);
    await tapEl('[aria-controls="stamps-panel"]');
    await sleep(200);
    await evaluate(`(document.querySelector('.inspector--raised') && document.querySelector('.inspector__summary').click(), true)`);
    await sleep(200);

    // Menus.
    await tapEl('[aria-label="File"]');
    await waitFor(`!!document.querySelector('[role=menu]')`);
    r.fileMenu = await evaluate(`[...document.querySelectorAll('[role=menuitem]')].map((m) => m.textContent)`);
    r.smallFileMenu = await evaluate(SMALL);
    await shoot(`phone-${mode}-file-menu`);
    await tap(200, 400);
    await tapEl('[aria-label="More export options"]');
    await waitFor(`!!document.querySelector('[role=menu]')`);
    r.smallExportMenu = await evaluate(SMALL);
    r.menuInView = await evaluate(`(() => { const b = document.querySelector('[role=menu]').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; })()`);
    await tap(200, 400);

    // Dialogs: one each from the menu and the inspector.
    r.dialogs = {};
    for (const [label, how] of [
      ['Export with password…', 'menu'], ['Extract pages…', 'menu'], ['Export images…', 'menu'], ['Compress…', 'menu'],
      ['Page numbers…', 'inspector'], ['Watermark…', 'inspector'],
    ]) {
      if (how === 'menu') {
        await tapEl('[aria-label="More export options"]');
        await waitFor(`!!document.querySelector('[role=menu]')`);
        await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find((m) => m.textContent === ${JSON.stringify(label)}).click(), true`);
      } else {
        await evaluate(`(document.querySelector('.inspector--raised') || document.querySelector('.inspector__summary').click(), true)`);
        await sleep(250);
        await evaluate(`[...document.querySelectorAll('.inspector__setting')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click(), true`);
      }
      await waitFor(`!!document.querySelector('.confirm-dialog')`);
      await sleep(250);
      r.dialogs[label] = { small: await evaluate(SMALL), hScroll: await evaluate(noHScroll) };
      if (label === 'Watermark…') await shoot(`phone-${mode}-dialog-watermark`);
      await evaluate(`[...document.querySelectorAll('.confirm-dialog button')].find((b) => b.textContent.trim() === 'Cancel').click(), true`);
      await sleep(200);
      await evaluate(`(document.querySelector('.inspector--raised') && document.querySelector('.inspector__summary').click(), true)`);
      await sleep(200);
    }

    // Drawer: long press thumbnail 1 and drag to the bottom edge.
    await tapEl('[aria-label="Toggle thumbnails"]');
    await waitFor(`!!document.querySelector('.sidebar--open')`);
    await sleep(400);
    r.smallDrawer = await evaluate(SMALL);
    const drawer = await rectOf('.sidebar');
    const scrollEl = await rectOf('.sidebar__scroll');
    r.drawer = { top: Math.round(drawer.y), bottom: Math.round(drawer.bottom), right: Math.round(drawer.right), innerHeight: await evaluate('innerHeight') };
    // What's on top across the drawer's bottom auto-scroll zone (56 px)?
    r.drawerBottomZoneTop = await evaluate(`(() => {
      const d = document.querySelector('.sidebar');
      const b = d.getBoundingClientRect();
      const out = new Set();
      for (let y = b.bottom - 56; y < b.bottom; y += 8) for (let x = b.left + 4; x < b.right; x += 20) {
        const el = document.elementFromPoint(x, y);
        out.add(d.contains(el) ? 'drawer' : (el?.className || el?.tagName));
      }
      return [...out];
    })()`);
    const t1 = await rectOf('.sidebar__thumb');
    const before = await evaluate(`[...document.querySelectorAll('[data-source-page]')].map((e) => +e.dataset.sourcePage)`);
    const scrollBefore = await evaluate(`document.querySelector('.sidebar__scroll').scrollTop`);
    const sx = t1.x + t1.w / 2;
    let sy = t1.y + t1.h / 2;
    await touch('touchStart', [[sx, sy]]);
    await sleep(650); // long press
    r.lifted = await evaluate(`!!document.querySelector('.sidebar__thumb--lifted')`);
    const edgeY = scrollEl.bottom - 6;
    for (let i = 1; i <= 20; i++) {
      sy = t1.y + t1.h / 2 + ((edgeY - (t1.y + t1.h / 2)) * i) / 20;
      await touch('touchMove', [[sx, sy]]);
      await sleep(30);
    }
    await sleep(1800); // held in the bottom zone: auto-scroll
    r.drawerAutoScrolled = (await evaluate(`document.querySelector('.sidebar__scroll').scrollTop`)) - scrollBefore;
    await shoot(`phone-${mode}-drawer-drag`);
    await touch('touchEnd', []);
    await sleep(400);
    const after = await evaluate(`[...document.querySelectorAll('[data-source-page]')].map((e) => +e.dataset.sourcePage)`);
    r.reorder = { before: before.join(','), after: after.join(',') };
    await tap(370, 300); // scrim closes the drawer
    await sleep(300);

    // Header at 360 px.
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    r.header360 = await evaluate(`(() => { const h = document.querySelector('.toolbar'); const kids = [...h.querySelectorAll('.toolbar__group > *:not(input)')].filter((e) => e.getBoundingClientRect().width > 0); const mids = kids.map((e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; }); const rows = Math.max(...mids) - Math.min(...mids) > 12 ? 2 : 1; return { height: Math.round(h.getBoundingClientRect().height), rows, overflow: h.scrollWidth - h.clientWidth, hScroll: document.documentElement.scrollWidth - innerWidth }; })()`);
    r.small360 = await evaluate(SMALL);
    await shoot(`phone-${mode}-360`);
  }
  console.log(JSON.stringify(report, null, 1));
} finally {
  ws.close();
  edge.kill();
}
