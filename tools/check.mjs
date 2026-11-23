// Browser check: screenshots (phone 390px, desktop 1440px) + form behaviour.
// Needs the preview server (node tools/dev-server.mjs) and Google Chrome.
// Usage: node tools/check.mjs [baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '/tmp/finda-check';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const MOCK = 'https://rsvp-mock.invalid/exec';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
rmSync('/tmp/chrome-finda-cdp', { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chrome-finda-cdp',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

const results = [];
const problems = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) problems.push(`${name} ${detail}`);
}

let ws;
let nextId = 0;
const pending = new Map();
const listeners = new Set();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function waitEvent(method, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.delete(fn);
      reject(new Error(`timeout waiting for ${method}`));
    }, timeout);
    const fn = (msg) => {
      if (msg.method === method) {
        clearTimeout(timer);
        listeners.delete(fn);
        resolve(msg.params);
      }
    };
    listeners.add(fn);
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function screenshot(file, clip) {
  const params = { format: 'png', captureBeyondViewport: Boolean(clip) };
  if (clip) params.clip = { ...clip, scale: 1 };
  const { data } = await send('Page.captureScreenshot', params);
  writeFileSync(`${OUT}/${file}`, Buffer.from(data, 'base64'));
}
async function open(url) {
  const loaded = waitEvent('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
  await evaluate('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300)))');
}

// Network mock: patch app.js with a fake endpoint and answer the POSTs.
const posts = [];
let mockReply = { ok: true, updated: false };
let mockDelay = 0;
let patchEndpoint = false;
async function onPaused(p) {
  const { requestId, request, responseStatusCode } = p;
  if (request.url.startsWith(MOCK)) {
    posts.push(request.postData || '');
    if (mockDelay) await sleep(mockDelay);
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
      ],
      body: Buffer.from(JSON.stringify(mockReply)).toString('base64'),
    });
    return;
  }
  if (request.url.includes('/app.js') && responseStatusCode) {
    const { body, base64Encoded } = await send('Fetch.getResponseBody', { requestId });
    let js = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
    if (patchEndpoint) js = js.replace(/endpoint: '[^']*'/, `endpoint: '${MOCK}'`);
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }],
      body: Buffer.from(js).toString('base64'),
    });
    return;
  }
  await send('Fetch.continueRequest', { requestId });
}

try {
  let targets;
  for (let i = 0; i < 60 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    } catch {
      await sleep(250);
    }
  }
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) {
      if (msg.method === 'Fetch.requestPaused') onPaused(msg.params).catch((e) => problems.push(String(e)));
      if (msg.method === 'Runtime.exceptionThrown') problems.push(`JS error: ${msg.params.exceptionDetails.exception?.description}`);
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push(`console: ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
      for (const fn of listeners) fn(msg);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*app.js*', requestStage: 'Response' },
      { urlPattern: `${MOCK}*`, requestStage: 'Request' },
    ],
  });

  // ── Phone ───────────────────────────────────────────────
  await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await open(BASE);

  const layout = await evaluate(`(() => {
    const w = document.documentElement;
    const over = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && (r.right > w.clientWidth + 0.5 || r.left < -0.5) && !el.closest('.hp, dialog, .toast');
    }).map((el) => el.tagName + (el.id ? '#' + el.id : '') + ' ' + (el.textContent || '').trim().slice(0, 20));
    return { width: w.clientWidth, scrollWidth: w.scrollWidth, height: w.scrollHeight, over: over.slice(0, 8),
      heroH: document.querySelector('.hero').getBoundingClientRect().height,
      font: getComputedStyle(document.querySelector('h1')).fontFamily,
      fontsOk: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight) };
  })()`);
  check('phone: no horizontal overflow', layout.scrollWidth === layout.width && layout.over.length === 0, JSON.stringify(layout.over));
  check('phone: hero is 880px like design A', Math.round(layout.heroH) === 880, String(layout.heroH));
  check('phone: web fonts loaded', layout.fontsOk.length >= 3, layout.fontsOk.join(', '));
  await screenshot('phone-full.png', { x: 0, y: 0, width: 390, height: layout.height });

  const countdown = await evaluate(`({ d: document.querySelector('[data-cd="d"]').textContent, s: document.querySelector('[data-cd="s"]').textContent, msg: document.querySelector('[data-cd-message]').textContent.trim() })`);
  await sleep(1200);
  const s2 = await evaluate(`document.querySelector('[data-cd="s"]').textContent`);
  check('countdown runs', countdown.d !== '0' && s2 !== countdown.s, JSON.stringify({ ...countdown, s2 }));

  const toggle = await evaluate(`(() => {
    document.querySelector('[data-att="no"]').click();
    const yes = document.querySelector('[data-att="yes"]'), no = document.querySelector('[data-att="no"]');
    return { yes: yes.getAttribute('aria-pressed'), no: no.getAttribute('aria-pressed'), noBg: no.style.background, yesBg: yes.style.background };
  })()`);
  check('attendance toggle', toggle.yes === 'false' && toggle.no === 'true' && toggle.yesBg === 'transparent', JSON.stringify(toggle));

  const empty = await evaluate(`(() => {
    document.querySelector('#rsvp-submit').click();
    return { name: !document.querySelector('#a-name-error').hidden, consent: !document.querySelector('#agree-privacy-error').hidden,
      phone: !document.querySelector('#a-phone-error').hidden, focused: document.activeElement.id, toast: document.querySelector('[data-toast]').textContent };
  })()`);
  check('empty submit shows errors', empty.name && empty.consent && !empty.phone && empty.focused === 'a-name', JSON.stringify(empty));
  await screenshot('phone-errors.png', { x: 0, y: await evaluate(`document.querySelector('#rsvp-form').getBoundingClientRect().top + scrollY - 40`), width: 390, height: 760 });

  const typed = await evaluate(`(() => {
    const p = document.querySelector('#a-phone');
    p.value = '010-1234-5678ab'; p.dispatchEvent(new Event('input', { bubbles: true }));
    const all = document.querySelector('#agree-all'); all.click();
    return { phone: p.value, privacy: document.querySelector('#agree-privacy').checked, marketing: document.querySelector('#agree-marketing').checked };
  })()`);
  check('phone keeps digits only + agree all', typed.phone === '01012345678' && typed.privacy && typed.marketing, JSON.stringify(typed));

  const dialog = await evaluate(`(() => {
    document.querySelector('[data-open="privacy-dialog"]').click();
    const d = document.querySelector('#privacy-dialog'); const open = d.open; d.close();
    return { open, closed: !d.open };
  })()`);
  check('privacy details dialog', dialog.open && dialog.closed, JSON.stringify(dialog));

  const noEndpoint = await evaluate(`(() => {
    const n = document.querySelector('#a-name'); n.value = '홍길동'; n.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#rsvp-submit').click();
    return { toast: document.querySelector('[data-toast]').textContent, done: !document.querySelector('#rsvp-done').hidden };
  })()`);
  check('without endpoint: no fake success', !noEndpoint.done && noEndpoint.toast.includes('준비'), JSON.stringify(noEndpoint));

  // ── Submit with mocked Apps Script ──────────────────────
  patchEndpoint = true;
  mockDelay = 600;
  await open(BASE);
  await evaluate(`(() => {
    const n = document.querySelector('#a-name'); n.value = '홍길동'; n.dispatchEvent(new Event('input', { bubbles: true }));
    const p = document.querySelector('#a-phone'); p.value = '01012345678'; p.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#agree-privacy').click();
    const b = document.querySelector('#rsvp-submit'); b.click(); b.click(); document.querySelector('#rsvp-form').requestSubmit();
    return true;
  })()`);
  const busy = await evaluate(`({ disabled: document.querySelector('#rsvp-submit').disabled, text: document.querySelector('#rsvp-submit').textContent })`);
  await sleep(1200);
  const sent = await evaluate(`({ done: !document.querySelector('#rsvp-done').hidden, form: !document.querySelector('#rsvp-form').hidden, title: document.querySelector('#rsvp-done-title').textContent, text: document.querySelector('#rsvp-done-text').textContent })`);
  const body = Object.fromEntries(new URLSearchParams(posts[0] || ''));
  check('submit: button locked while sending', busy.disabled && busy.text.includes('제출하는 중'), JSON.stringify(busy));
  check('submit: exactly one request', posts.length === 1, String(posts.length));
  check('submit: payload', body.name === '홍길동' && body.phone === '01012345678' && body.attendance === 'yes' && body.consent === 'true' && body.marketing === 'false' && body.id, JSON.stringify(body));
  check('submit: success panel', sent.done && !sent.form && sent.text.includes('보사우러스'), JSON.stringify(sent));
  await screenshot('phone-done.png', { x: 0, y: await evaluate(`document.querySelector('#rsvp-done').getBoundingClientRect().top + scrollY - 120`), width: 390, height: 600 });

  mockReply = { ok: false, error: 'invalid' };
  mockDelay = 0;
  await evaluate(`document.querySelector('#rsvp-edit').click(); document.querySelector('#rsvp-submit').click(); true`);
  await sleep(500);
  const failed = await evaluate(`({ toast: document.querySelector('[data-toast]').textContent, form: !document.querySelector('#rsvp-form').hidden, enabled: !document.querySelector('#rsvp-submit').disabled })`);
  check('submit: server rejection shows error, form stays', failed.toast.includes('제출하지 못했습니다') && failed.form && failed.enabled, JSON.stringify(failed));
  check('submit: new id after success', new URLSearchParams(posts[1] || '').get('id') !== body.id, '');

  // ── Desktop ─────────────────────────────────────────────
  patchEndpoint = false;
  await send('Emulation.setUserAgentOverride', { userAgent: DESKTOP_UA });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await open(BASE);
  const desk = await evaluate(`(() => {
    const hero = document.querySelector('.hero').getBoundingClientRect();
    const content = document.querySelector('.content').getBoundingClientRect();
    return { heroW: hero.width, heroH: hero.height, contentW: content.width, scrollWidth: document.documentElement.scrollWidth };
  })()`);
  check('desktop: split layout', desk.heroW > 700 && Math.round(desk.heroH) === 900 && desk.contentW >= 480 && desk.scrollWidth === 1440, JSON.stringify(desk));
  await screenshot('desktop-1.png');
  await evaluate('window.scrollTo(0, 1500); new Promise((r) => setTimeout(r, 200))');
  const stuck = await evaluate(`document.querySelector('.hero').getBoundingClientRect().top`);
  check('desktop: cover stays while scrolling', Math.round(stuck) === 0, String(stuck));
  await screenshot('desktop-2.png');
  await evaluate(`document.querySelector('#rsvp-form').scrollIntoView({ block: 'center' }); new Promise((r) => setTimeout(r, 200))`);
  await screenshot('desktop-3.png');
  const tmap = await evaluate(`(() => { document.querySelector('[data-app-link]').click(); return document.querySelector('[data-toast]').textContent; })()`);
  check('desktop: tmap explains phone-only', tmap.includes('휴대폰'), tmap);

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 640, deviceScaleFactor: 1, mobile: false });
  await open(BASE);
  const short = await evaluate(`(() => {
    const hero = document.querySelector('.hero'); const last = hero.lastElementChild.getBoundingClientRect();
    return { bottom: last.bottom, heroBottom: hero.getBoundingClientRect().bottom };
  })()`);
  check('desktop (short screen): cover text fits', short.bottom <= short.heroBottom, JSON.stringify(short));
  await screenshot('desktop-short.png');
} catch (error) {
  problems.push(`check crashed: ${error.stack || error}`);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  ${r.detail}`}`);
const extra = problems.filter((p) => !results.some((r) => !r.ok && p.startsWith(r.name)));
for (const p of extra) console.log(`WARN  ${p}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed · screenshots: ${OUT}`);
process.exit(results.every((r) => r.ok) && extra.length === 0 ? 0 : 1);
