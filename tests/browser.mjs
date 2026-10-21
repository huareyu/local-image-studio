// Desktop/mobile browser checks against local mocks only; no paid API calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { WebSocket } from 'undici';

const root = fileURLToPath(new URL('../', import.meta.url));
const APP_PORT = 3218;
const MOCK_PORT = 3219;
const DEBUG_PORT = 9228;
const origin = `http://127.0.0.1:${APP_PORT}`;
const children = [];
const errors = [];
const imagesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-studio-browser-'));
let folderRequests = 0;
let socket;

function launch(file, env) {
    const child = spawn(process.execPath, [path.join(root, file)], {
        cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'],
    });
    children.push(child);
}

async function waitUntil(fn, label) {
    for (let i = 0; i < 100; i++) {
        try { if (await fn()) return; } catch { /* server/browser starting */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}`);
}

let nextId = 1;
const pending = new Map();
function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
    });
}

async function evaluate(expression) {
    const reply = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || 'Browser evaluation failed');
    return reply.result.value;
}

async function change(selector, value, event = 'change') {
    await evaluate(`(() => {
        const field = document.querySelector(${JSON.stringify(selector)});
        ${typeof value === 'boolean' ? `field.checked = ${value};` : `field.value = ${JSON.stringify(String(value))};`}
        field.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    })()`);
    if (['#tag-search', '#tag-category', '#tag-target'].includes(selector)) await waitTagResults();
}

async function waitTagResults() {
    await waitUntil(() => evaluate("!document.querySelector('#tag-assistant')?.open || document.querySelector('#tag-assistant').classList.contains('hidden') || document.querySelector('#tag-results').dataset.loading === 'false'"), 'asynchronous tag results');
}
async function click(selector) {
    if (selector.includes('tag-')) await waitTagResults();
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    if (selector.includes('tag-')) await waitTagResults();
}
async function press(key, code, virtualKey, modifiers = 0) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, modifiers });
}
async function libraryId(name) {
    return evaluate(`[...document.querySelectorAll('.library-card')].find(card => card.querySelector('strong').textContent === ${JSON.stringify(name)})?.dataset.id`);
}
async function saveLibraryRecord(type, name, content, { negative, preview = false } = {}) {
    await click(type === 'chunk' ? '#library-chunks-tab' : '#library-styles-tab');
    await click('#library-new');
    await change('#library-name', name);
    await change('#library-text', content, 'input');
    await change('#library-folder', type === 'chunk' ? 'Building blocks' : 'Art styles');
    await change('#library-tags', 'test, мягкий свет');
    if (negative !== undefined) {
        await change('#library-use-negative', true);
        await change('#library-negative', negative, 'input');
    }
    if (preview) {
        await click('#library-preview-result');
        await waitUntil(() => evaluate("!document.querySelector('#library-save').disabled && document.querySelector('#library-preview').src.startsWith('data:image/')"), 'style preview');
    }
    await click('#library-save');
    await waitUntil(() => evaluate("document.querySelector('#library-editor').classList.contains('hidden')"), 'save library record');
    return libraryId(name);
}
async function ready() {
    await waitUntil(() => evaluate("document.querySelector('#profile-select')?.options.length > 0 && document.querySelector('#reference-list')?.children.length === 2"), 'UI ready');
}
async function reload() { await cdp('Page.reload'); await ready(); }
async function connection() {
    return evaluate(`(() => {
        const value = id => document.getElementById(id).value;
        return {
            profileId: value('profile-select'), provider: value('provider'),
            endpoint: value('endpoint'), apiKey: value('api-key'), model: value('model'),
            rawEndpoint: document.getElementById('raw-endpoint').checked,
            proxyEnabled: document.getElementById('proxy-enabled').checked,
            proxyUrl: value('proxy-url'), proxyUsername: value('proxy-username'),
            proxyPassword: value('proxy-password'),
            rememberKey: document.getElementById('remember-key').checked,
        };
    })()`);
}
async function layoutCheck() {
    const bad = await evaluate(`(() => {
        const width = window.innerWidth;
        return [...document.querySelectorAll('main, .panel, .section-heading, input, select, textarea, button, .chunk-rich-editor, .chunk-capsule')]
            .filter(node => node.getClientRects().length && !node.closest('template, .viewer-strip'))
            .filter(node => { const box = node.getBoundingClientRect(); return box.right > width + 1 || box.left < -1; })
            .map(node => node.id || node.className || node.tagName);
    })()`);
    assert.deepEqual(bad, [], 'Controls overflow viewport');
}

try {
    launch('server.mjs', { PORT: String(APP_PORT), IMAGE_STUDIO_IMAGES_DIR: imagesDir, IMAGE_STUDIO_KALOSCOPE_ENDPOINT: `http://127.0.0.1:${MOCK_PORT}` });
    launch('tests/mock-provider.mjs', { MOCK_PORT: String(MOCK_PORT) });
    await waitUntil(() => fetch(origin).then(response => response.ok), 'local app');
    const browser = process.env.IMAGE_STUDIO_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const profileDir = path.join(root, `.edge-novelai-${Date.now()}`);
    const child = spawn(browser, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    children.push(child);
    await waitUntil(() => fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then(response => response.ok), 'headless browser');
    const target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(origin)}`, { method: 'PUT' }).then(response => response.json());
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Fetch.requestPaused') {
            folderRequests++;
            cdp('Fetch.fulfillRequest', {
                requestId: message.params.requestId, responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                body: Buffer.from(JSON.stringify({ folderPath: imagesDir })).toString('base64'),
            }).catch(error => errors.push(error.message));
        }
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
    });
    await cdp('Runtime.enable');
    await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitUntil(() => evaluate("document.querySelector('#reference-profile-select')?.options.length > 0"), 'first load');
    assert.equal(await evaluate("document.querySelector('#mode-standard').getAttribute('aria-pressed')"), 'true');
    await change('#api-key', 'ordinary-first-key');
    await change('#endpoint', 'http://ordinary.example');
    const firstOrdinary = await connection();
    await click('#mode-novelai');
    assert.equal((await connection()).apiKey, '', 'New NovelAI profile inherited ordinary key');
    assert.equal((await connection()).endpoint, 'https://image.novelai.net', 'NovelAI endpoint was not automatic');
    assert.equal((await connection()).provider, 'novelai');
    assert.equal((await connection()).rememberKey, true, 'NovelAI must remember its own key by default');
    await click('#mode-standard');
    assert.deepEqual(await connection(), firstOrdinary, 'Switching modes destroyed the first ordinary connection');
    await evaluate(`(async () => {
        localStorage.setItem('image-studio.profiles.v1', JSON.stringify([
            { id: 'nai', name: 'NovelAI test', provider: 'novelai', endpoint: 'http://127.0.0.1:${MOCK_PORT}', model: 'nai-diffusion-5-full', rememberKey: false, novelaiSteps: 42, novelaiAnlasGuard: false, novelaiNegativePrompt: 'NAI ONLY' },
            { id: 'gemini', name: 'Gemini test', provider: 'gemini', endpoint: 'http://127.0.0.1:${MOCK_PORT}', model: 'mock-gemini-image', apiKey: 'test' }
        ]));
        sessionStorage.setItem('image-studio.session-secrets.v1', JSON.stringify({ nai: 'test-token' }));
        localStorage.setItem('image-studio.active-profile.v1', 'nai');
        localStorage.removeItem('image-studio.mode.v1');
        localStorage.removeItem('image-studio.active-profiles-by-mode.v1');
        localStorage.setItem('image-studio.draft.v1', JSON.stringify({ prompt: '1boy, test', negativePrompt: 'GENERIC ONLY' }));
        localStorage.removeItem('image-studio.reference-profiles.v1');
        // Explicitly seed the old schema to check that upgrading preserves user data.
        await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase('local-image-studio'); request.onsuccess = resolve; request.onerror = reject; });
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('local-image-studio', 1);
            request.onupgradeneeded = () => { request.result.createObjectStore('references', { keyPath: 'id' }); request.result.createObjectStore('history', { keyPath: 'id' }); };
            request.onsuccess = () => resolve(request.result); request.onerror = reject;
        });
        await new Promise((resolve, reject) => {
            const tx = db.transaction('history', 'readwrite');
            tx.objectStore('history').put({ id: 'migration-sentinel', prompt: 'Old history survives upgrade', createdAt: 1, dataUrl: document.createElement('canvas').toDataURL() });
            tx.oncomplete = resolve; tx.onabort = reject;
        });
        await new Promise((resolve, reject) => {
            const tx = db.transaction('references', 'readwrite');
            for (const [id, color] of [['ref-a', '#f00'], ['ref-b', '#00f']]) {
                const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 30;
                const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 20, 30);
                tx.objectStore('references').put({ id, label: id, description: 'REFERENCE_ONLY_MARKER', dataUrl: canvas.toDataURL(), enabled: true, createdAt: Date.now() });
            }
            tx.oncomplete = resolve; tx.onerror = reject;
        });
        db.close();
    })()`);
    await reload();
    assert.deepEqual(await evaluate(`(async () => {
        const db = await new Promise(resolve => { const request = indexedDB.open('local-image-studio', 2); request.onsuccess = () => resolve(request.result); });
        const result = { version: db.version, hasLibrary: db.objectStoreNames.contains('promptLibrary') }; db.close(); return result;
    })()`), { version: 2, hasLibrary: true }, 'Library schema migration failed');
    assert.equal(await evaluate(`(async () => {
        const db = await new Promise(resolve => { const request = indexedDB.open('local-image-studio', 2); request.onsuccess = () => resolve(request.result); });
        const value = await new Promise(resolve => { const request = db.transaction('history').objectStore('history').get('migration-sentinel'); request.onsuccess = () => resolve(request.result); });
        await new Promise(resolve => { const tx = db.transaction('history', 'readwrite'); tx.objectStore('history').delete('migration-sentinel'); tx.oncomplete = resolve; });
        db.close(); return value.prompt;
    })()`), 'Old history survives upgrade');
    assert.equal(await evaluate("document.querySelector('#mode-novelai').getAttribute('aria-pressed')"), 'true', 'Legacy active NovelAI profile did not select NovelAI mode');
    assert.deepEqual(await evaluate("[...document.querySelector('#profile-select').options].map(option => option.value)"), ['nai']);
    assert.equal(await evaluate("document.querySelector('#api-key').value"), 'test-token', 'Legacy session secret not migrated');
    assert.equal(await evaluate("document.querySelector('.references-panel').classList.contains('hidden')"), true);
    assert.equal(await evaluate("document.querySelector('#novelai-negative').value"), 'NAI ONLY');
    await change('#model', 'nai-diffusion-5-full-medium', 'input');
    assert.equal(await evaluate("document.querySelector('#novelai-steps').value"), '14');
    assert.equal(await evaluate("document.querySelector('#novelai-sampler').disabled"), true);
    await click('#profile-save');
    await reload();
    await change('#model', 'nai-diffusion-5-full', 'input');
    assert.equal(await evaluate("document.querySelector('#novelai-steps').value"), '42', 'Medium destroyed saved steps');
    assert.equal(await evaluate("document.querySelector('#novelai-negative').value"), 'NAI ONLY', 'Medium destroyed saved negative');
    await change('#model', 'nai-diffusion-4-5-full', 'input');
    assert.equal(await evaluate("document.querySelector('.references-panel').classList.contains('hidden')"), false);
    await change('#novelai-enable-references', false);
    await click('#generate');
    await waitUntil(() => evaluate("!document.querySelector('#generate').disabled && document.querySelector('#result-image').src.startsWith('data:image/png')"), 'NovelAI generation without refs');
    await change('#novelai-enable-references', true);
    await click('#generate');
    await waitUntil(() => evaluate("!document.querySelector('#generate').disabled && document.querySelector('#message').textContent.includes('готово')"), 'NovelAI generation with refs');
    const requests = await fetch(`http://127.0.0.1:${MOCK_PORT}/__novelai-requests`).then(response => response.json());
    assert.equal(requests.length, 2);
    assert.ok(!requests[0].input.includes('REFERENCE_ONLY_MARKER'));
    assert.equal(requests[1].parameters.director_reference_images.length, 2);
    for (const ref of requests[1].parameters.director_reference_images) {
        const bytes = Buffer.from(ref, 'base64');
        assert.equal(bytes.readUInt32BE(16), 1024);
        assert.equal(bytes.readUInt32BE(20), 1536);
    }
    await waitUntil(() => evaluate("document.querySelector('#history-list').children.length === 2"), 'generated history');
    const generatedEntries = await evaluate(`(async () => {
        const db = await new Promise(resolve => { const request = indexedDB.open('local-image-studio', 2); request.onsuccess = () => resolve(request.result); });
        const entries = await new Promise(resolve => { const request = db.transaction('history').objectStore('history').getAll(); request.onsuccess = () => resolve(request.result); });
        db.close(); return entries;
    })()`);
    assert.equal(generatedEntries.length, 2);
    assert.equal(await evaluate("document.querySelector('#message').textContent"), 'Изображение готово и сохранено в папку');
    for (const entry of generatedEntries) {
        assert.ok(entry.archive?.fileName, 'New generation was not archived automatically');
        assert.deepEqual(await fs.readFile(path.join(imagesDir, entry.archive.fileName)), Buffer.from(entry.dataUrl.split(',')[1], 'base64'));
    }
    // Single deletion requires confirmation and preserves archived files and refs.
    const deletedId = await evaluate("document.querySelector('.history-item').dataset.id");
    await evaluate('window.confirm = () => false');
    await click('.history-delete');
    assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 2);
    await evaluate('window.confirm = () => true');
    await click('.history-delete');
    await waitUntil(() => evaluate("document.querySelector('#history-list').children.length === 1 && !document.querySelector('#history-select').disabled"), 'single history deletion');
    assert.equal(await evaluate("document.querySelector('#result-image').classList.contains('hidden')"), true, 'Deleted current result remained on the canvas');
    await fs.access(path.join(imagesDir, generatedEntries.find(entry => entry.id === deletedId).archive.fileName));
    // Legacy history on later pages is visible, selectable and copied to the folder.
    await evaluate(`(async () => {
        const db = await new Promise(resolve => { const request = indexedDB.open('local-image-studio', 2); request.onsuccess = () => resolve(request.result); });
        await new Promise((resolve, reject) => {
            const tx = db.transaction('history', 'readwrite');
            for (let i = 0; i < 27; i++) tx.objectStore('history').put({
                id: 'legacy-' + i, createdAt: 1720000000000 + i, provider: 'gemini', model: 'legacy-test',
                prompt: 'Legacy image ' + i, dataUrl: ${JSON.stringify(generatedEntries[0].dataUrl)},
            });
            tx.oncomplete = resolve; tx.onabort = reject;
        });
        db.close();
    })()`);
    await reload();
    await waitUntil(() => evaluate("document.querySelector('#history-page-label').textContent.includes('28 изображений')"), 'paged history');
    assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 12);
    // Gallery filters apply to all pages, retain selection, and never edit the draft.
    await change('#history-search', 'LEGACY image 26', 'input');
    assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 1);
    assert.equal(await evaluate("document.querySelector('#history-count').textContent"), 'Найдено: 1 из 28');
    await click('#history-select');
    await click('#history-select-page');
    await change('#history-provider', 'novelai');
    assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 0);
    assert.equal(await evaluate("document.querySelector('#history-select-page').disabled"), true);
    assert.equal(await evaluate("document.querySelector('#history-empty').classList.contains('hidden')"), false);
    assert.equal(await evaluate("document.querySelector('#history-selected-count').textContent"), 'Выбрано: 1');
    await click('#history-reset');
    await click('#history-select');
    await change('#history-order', 'oldest');
    assert.equal(await evaluate("document.querySelector('.history-item').dataset.id"), 'legacy-0');
    const legacyDate = await evaluate("(() => { const d = new Date(1720000000000); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })()");
    await change('#history-date', legacyDate);
    assert.equal(await evaluate("document.querySelector('#history-count').textContent"), 'Найдено: 27 из 28');
    await click('#history-reset');
    await change('#history-page', 3);
    assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 4);
    await click('.history-page-number[aria-label="Страница 2"]');
    assert.equal(await evaluate("document.querySelector('#history-page').value"), '2');
    await change('#history-search', 'legacy-test', 'input');
    assert.equal(await evaluate("document.querySelector('#history-page').value"), '1', 'Search did not reset the page');
    const draftBeforeViewing = await evaluate("document.querySelector('#prompt').value");
    await click('.history-preview');
    await waitUntil(() => evaluate("document.querySelector('#viewer-image').dataset.id === 'legacy-26'"), 'gallery viewer');
    assert.equal(await evaluate("document.querySelector('#viewer-counter').textContent"), '1 / 27');
    assert.equal(await evaluate("document.querySelector('#viewer-previous').disabled"), true);
    await press('ArrowRight', 'ArrowRight', 39);
    await waitUntil(() => evaluate("document.querySelector('#viewer-image').dataset.id === 'legacy-25'"), 'keyboard gallery next');
    await press('End', 'End', 35);
    await waitUntil(() => evaluate("document.querySelector('#viewer-image').dataset.id === 'legacy-0'"), 'viewer crosses page boundaries');
    assert.equal(await evaluate("document.querySelector('#viewer-counter').textContent"), '27 / 27');
    assert.equal(await evaluate("document.querySelector('#viewer-next').disabled"), true);
    await evaluate("for (let i=0; i<30; i++) document.querySelector('#viewer-previous').click();");
    await waitUntil(() => evaluate("document.querySelector('#viewer-image').dataset.id === 'legacy-26'"), 'rapid navigation discards stale image loads');
    await click('.viewer-thumb[data-id="legacy-23"]');
    await waitUntil(() => evaluate("document.querySelector('#viewer-image').dataset.id === 'legacy-23'"), 'filmstrip navigation');
    await press('ArrowRight', 'ArrowRight', 39);
    await waitUntil(() => evaluate("document.querySelector('#viewer-image').dataset.id === 'legacy-22'"), 'keyboard after filmstrip navigation');
    await press('End', 'End', 35);
    await waitUntil(() => evaluate("document.querySelector('#viewer-image').dataset.id === 'legacy-0'"), 'return to last image');
    await click('#viewer-details summary');
    assert.equal(await evaluate("document.querySelector('#viewer-prompt').textContent"), 'Legacy image 0');
    await evaluate("window.savedAnchorClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function() { window.lastDownload = { href: this.href, filename: this.download }; };");
    await click('#viewer-download');
    const lastDownload = await evaluate('window.lastDownload');
    assert.equal(lastDownload.href, generatedEntries[0].dataUrl);
    assert.ok(lastDownload.filename.includes(new Date(1720000000000).toISOString().replace(/[:.]/g, '-')), 'Download came from the previously viewed image');
    await evaluate('HTMLAnchorElement.prototype.click = window.savedAnchorClick');
    await press('Escape', 'Escape', 27);
    assert.equal(await evaluate("document.querySelector('#image-viewer').open"), false);
    assert.equal(await evaluate("document.body.classList.contains('viewer-open')"), false);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), draftBeforeViewing, 'Browsing overwrote the draft');
    await click('#history-reset');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/images/open-folder`, requestStage: 'Request' }] });
    await click('#open-image-folder');
    assert.equal(await evaluate("document.querySelector('#history-select').disabled"), true, 'Deleting during a legacy import was not blocked');
    await waitUntil(() => evaluate("!document.querySelector('#open-image-folder').disabled && document.querySelector('#history-folder-hint').textContent.startsWith('Папка:')"), 'legacy image folder import');
    assert.equal(folderRequests, 1, 'Folder button did not request a native folder opening');
    assert.equal((await fs.readdir(imagesDir)).length, 29, 'Legacy import missed off-page entries');
    await click('#open-image-folder');
    await waitUntil(() => folderRequests === 2 && evaluate("!document.querySelector('#open-image-folder').disabled"), 'second folder opening');
    assert.equal((await fs.readdir(imagesDir)).length, 29, 'Opening the folder duplicated images');
    await click('#history-select');
    const firstSelectedId = await evaluate("document.querySelector('.history-item').dataset.id");
    await click('.history-preview');
    assert.equal(await evaluate("document.querySelector('.history-checkbox input').checked"), true);
    await click('#history-next');
    const secondSelectedId = await evaluate("document.querySelector('.history-item').dataset.id");
    await click('.history-checkbox input');
    assert.equal(await evaluate("document.querySelector('#history-selected-count').textContent"), 'Выбрано: 2');
    await evaluate('window.confirm = () => false');
    await click('#history-delete-selected');
    assert.equal(await evaluate("document.querySelector('#history-page-label').textContent.includes('28 изображений')"), true);
    await evaluate('window.confirm = () => true');
    await click('#history-delete-selected');
    await waitUntil(() => evaluate("document.querySelector('#history-page-label').textContent.includes('26 изображений') && !document.querySelector('#history-select').disabled"), 'cross-page selective deletion');
    const remainingIds = await evaluate(`(async () => {
        const db = await new Promise(resolve => { const request = indexedDB.open('local-image-studio', 2); request.onsuccess = () => resolve(request.result); });
        const ids = await new Promise(resolve => { const request = db.transaction('history').objectStore('history').getAllKeys(); request.onsuccess = () => resolve(request.result); });
        db.close(); return ids;
    })()`);
    assert.equal(remainingIds.length, 26);
    assert.ok(!remainingIds.includes(firstSelectedId) && !remainingIds.includes(secondSelectedId));
    assert.equal((await fs.readdir(imagesDir)).length, 29, 'History deletion removed disk files');
    assert.equal(await evaluate("document.querySelector('#reference-list').children.length"), 2, 'History deletion affected refs');
    await click('#history-next');
    assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 2);
    await click('#history-select-page');
    assert.equal(await evaluate("document.querySelector('#history-selected-count').textContent"), 'Выбрано: 2');
    await click('#history-deselect');
    assert.equal(await evaluate("document.querySelector('#history-selected-count').textContent"), 'Выбрано: 0');
    await click('#history-select');
    await click('.history-preview');
    await waitUntil(() => evaluate("document.querySelector('#image-viewer').open && !document.querySelector('#viewer-use-prompt').disabled"), 'history preview after selection');
    await click('#viewer-use-prompt');
    await waitUntil(() => evaluate("!document.querySelector('#result-image').classList.contains('hidden')"), 'explicit history prompt reuse');
    await click('#expand-result');
    await waitUntil(() => evaluate("document.querySelector('#image-viewer').open && !document.querySelector('#viewer-download').disabled"), 'expand canvas result');
    await click('#viewer-close');
    // Loading a small preview must not reduce the original used for download/reference.
    const thumbnailSize = await evaluate("[...document.querySelectorAll('.history-preview img')].filter(img => img.complete && img.naturalWidth).map(img => Math.max(img.naturalWidth, img.naturalHeight))");
    assert.ok(thumbnailSize.length && thumbnailSize.every(size => size <= 256), 'Gallery displays full-sized original previews');
    await reload();
    await waitUntil(() => evaluate("document.querySelector('#history-page-label').textContent.includes('26 изображений')"), 'history deletion persisted');
    // Different ref sets keep independent checkmarks through switching/reload.
    await evaluate("window.prompt = () => 'Second set'; document.querySelector('#reference-profile-new').click()");
    await click('.reference-toggle');
    assert.equal(await evaluate("document.querySelectorAll('.reference-card.enabled').length"), 1);
    const sets = await evaluate("[...document.querySelector('#reference-profile-select').options].map(option => option.value)");
    await change('#reference-profile-select', sets[0]);
    assert.equal(await evaluate("document.querySelectorAll('.reference-card.enabled').length"), 2);
    await change('#reference-profile-select', sets[1]);
    await reload();
    assert.equal(await evaluate("document.querySelectorAll('.reference-card.enabled').length"), 1);
    await change('#novelai-negative', 'MY PRESET');
    await evaluate("window.prompt = () => 'My negative'; document.querySelector('#novelai-negative-new').click()");
    await click('#profile-save');
    await reload();
    assert.equal(await evaluate("document.querySelector('#novelai-negative-preset').selectedOptions[0].textContent"), 'My negative');
    assert.equal(await evaluate("document.querySelector('#novelai-negative').value"), 'MY PRESET');
    const sessionNovelai = await connection();
    await click('#mode-standard');
    assert.equal(await evaluate("document.querySelector('#provider').value"), 'gemini', 'Connection profile switch failed');
    assert.equal(await evaluate("document.querySelector('#negative-prompt').value"), 'GENERIC ONLY');
    assert.deepEqual(await evaluate("[...document.querySelector('#profile-select').options].map(option => option.value)"), ['gemini']);
    await change('#provider', 'openai');
    await change('#endpoint', 'http://ordinary.example/custom-image-api');
    await change('#raw-endpoint', true);
    await change('#api-key', 'ordinary-saved-key');
    await change('#model', 'ordinary-custom-image-model', 'input');
    await change('#proxy-enabled', true);
    await change('#proxy-url', 'http://ordinary-proxy.example:8080');
    await change('#proxy-username', 'ordinary-user');
    await change('#proxy-password', 'ordinary-password');
    const ordinary = await connection();
    await click('#toggle-key');
    await click('#mode-novelai');
    assert.deepEqual(await connection(), sessionNovelai, 'NovelAI credentials/settings were overwritten by ordinary mode');
    assert.equal(await evaluate("document.querySelector('#api-key').type"), 'password', 'Switching modes exposed the next key');
    await reload();
    assert.deepEqual(await connection(), sessionNovelai, 'Session-only NovelAI key lost after reload');
    const stored = await evaluate("JSON.parse(localStorage.getItem('image-studio.profiles.v1')).find(profile => profile.id === 'nai')");
    assert.equal(stored.apiKey, '', 'Session-only token persisted to localStorage');
    assert.equal(stored.novelaiNegativePrompt, 'MY PRESET');
    await click('#mode-standard');
    assert.deepEqual(await connection(), ordinary, 'Ordinary connection did not survive switching/reloading');
    // Each mode remembers its last connection profile, not merely the API type.
    await click('#profile-new');
    const ordinaryCopyId = (await connection()).profileId;
    await change('#api-key', 'ordinary-copy-key');
    await click('#mode-novelai');
    assert.equal((await connection()).apiKey, 'test-token');
    await click('#mode-standard');
    assert.equal((await connection()).profileId, ordinaryCopyId);
    assert.equal((await connection()).apiKey, 'ordinary-copy-key');
    await reload();
    assert.equal((await connection()).profileId, ordinaryCopyId);
    await change('#profile-select', 'gemini');
    assert.deepEqual(await connection(), ordinary);
    await click('#mode-novelai');
    await click('#mode-standard');
    assert.equal((await connection()).profileId, 'gemini', 'Last active profile was not remembered per mode');
    await change('#profile-select', ordinaryCopyId);
    await evaluate("window.confirm = () => true");
    await click('#profile-delete');
    assert.deepEqual(await connection(), ordinary, 'Deleting an ordinary profile selected a NovelAI profile');
    assert.equal(await evaluate("document.querySelector('#profile-delete').disabled"), true);
    // Persist a NovelAI key independently, then simulate a new browser session.
    await click('#mode-novelai');
    await change('#remember-key', true);
    await change('#api-key', 'novelai-saved-key');
    await change('#proxy-enabled', true);
    await change('#proxy-url', 'http://novelai-proxy.example:8080');
    await change('#proxy-username', 'novelai-user');
    await change('#proxy-password', 'novelai-password');
    const persistentNovelai = await connection();
    await click('#mode-standard');
    assert.deepEqual(await connection(), ordinary);
    await evaluate('sessionStorage.clear()');
    await reload();
    assert.equal(await evaluate("document.querySelector('#mode-standard').getAttribute('aria-pressed')"), 'true');
    assert.deepEqual(await connection(), ordinary);
    await click('#mode-novelai');
    assert.deepEqual(await connection(), persistentNovelai, 'Persistent NovelAI key/settings did not survive a new session');
    const savedProfiles = await evaluate("JSON.parse(localStorage.getItem('image-studio.profiles.v1'))");
    assert.equal(savedProfiles.find(profile => profile.id === 'nai').apiKey, 'novelai-saved-key');
    assert.equal(savedProfiles.find(profile => profile.id === 'gemini').apiKey, 'ordinary-saved-key');
    await reload();
    assert.equal(await evaluate("document.querySelector('#mode-novelai').getAttribute('aria-pressed')"), 'true');
    assert.deepEqual(await connection(), persistentNovelai);
    await layoutCheck();
    for (const width of [390, 430]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await layoutCheck();
        await click('#mode-standard');
        await layoutCheck();
        await click('#mode-novelai');
        await click('#history-select');
        await layoutCheck();
        await click('#history-select');
    }
    // Real touch events swipe the viewer on phones; vertical/multi-touch gestures do not navigate.
    await click('.history-preview');
    await waitUntil(() => evaluate("!document.querySelector('#viewer-download').disabled"), 'mobile viewer');
    await layoutCheck();
    const touchBox = await evaluate("(() => { const b = document.querySelector('#viewer-stage').getBoundingClientRect(); return { x: b.left + b.width*.7, y: b.top + b.height/2 }; })()");
    const beforeSwipe = await evaluate("document.querySelector('#viewer-counter').textContent");
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchBox.x, y: touchBox.y }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchBox.x - 120, y: touchBox.y + 2 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitUntil(() => evaluate(`document.querySelector('#viewer-counter').textContent !== ${JSON.stringify(beforeSwipe)} && !document.querySelector('#viewer-download').disabled`), 'real phone swipe');
    const afterSwipe = await evaluate("document.querySelector('#viewer-counter').textContent");
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchBox.x, y: touchBox.y }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchBox.x + 5, y: touchBox.y - 90 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await evaluate("document.querySelector('#viewer-counter').textContent"), afterSwipe, 'Vertical scrolling flipped the image');
    const viewerBounds = await evaluate("(() => { const b = document.querySelector('#image-viewer').getBoundingClientRect(); const close = document.querySelector('#viewer-close').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: innerHeight, closeTop: close.top }; })()");
    assert.ok(viewerBounds.top >= 0 && viewerBounds.bottom <= viewerBounds.height + 1 && viewerBounds.closeTop >= 0, 'Mobile viewer is clipped');
    const viewerScreenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(root, 'preview-gallery-viewer-mobile.png'), Buffer.from(viewerScreenshot.data, 'base64'));
    await click('#viewer-close');
    await change('#proxy-enabled', true);
    await layoutCheck();
    const screenshot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true, format: 'png' });
    await fs.writeFile(path.join(root, 'preview-novelai-mobile.png'), Buffer.from(screenshot.data, 'base64'));
    await click('#history-select');
    const historyClip = await evaluate(`(() => {
        const box = document.querySelector('.history-panel').getBoundingClientRect();
        return { x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height, scale: 1 };
    })()`);
    const historyScreenshot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true, format: 'png', clip: historyClip });
    await fs.writeFile(path.join(root, 'preview-history-mobile.png'), Buffer.from(historyScreenshot.data, 'base64'));
    await evaluate('window.confirm = () => false');
    await click('#clear-history');
    assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 12);
    await evaluate('window.confirm = () => true');
    await click('#clear-history');
    await waitUntil(() => evaluate("document.querySelector('#history-list').children.length === 0 && !document.querySelector('#open-image-folder').disabled"), 'clear all history');
    await reload();
    assert.equal(await evaluate("document.querySelector('#history-list').children.length"), 0);
    assert.equal((await fs.readdir(imagesDir)).length, 29, 'Clear history deleted archived images');
    assert.equal(await evaluate("document.querySelector('#reference-list').children.length"), 2);

    // Styles, local previews and NovelAI-compatible prompt chunks.
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await change('#proxy-enabled', false);
    await change('#endpoint', `http://127.0.0.1:${MOCK_PORT}`);
    await change('#raw-endpoint', false);
    await change('#api-key', 'test-token');
    await change('#model', 'nai-diffusion-4-5-full', 'input');
    await change('#prefix', 'initial NAI style', 'input');
    await change('#prompt', 'A quiet portrait scene', 'input');
    await change('#novelai-enable-references', false);
    await click('#generate');
    await waitUntil(() => evaluate("!document.querySelector('#generate').disabled && !document.querySelector('#result-image').classList.contains('hidden')"), 'result for style preview');
    const artistId = await saveLibraryRecord('chunk', 'Artist', '{{artist:kamochiru}}, pale colors,');
    await saveLibraryRecord('chunk', 'Look', '!macro:Artist!, 1boy,');
    await saveLibraryRecord('chunk', 'Cycle', '!macro:Cycle!');
    const styleId = await saveLibraryRecord('style', 'Soft Painter', '!macro:Look!, masterpiece,', { negative: 'text, watermark,', preview: true });
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'A quiet portrait scene', 'Applying a style overwrote the scene');
    assert.equal(await evaluate("document.querySelector('#prefix').value"), '!macro:Look!, masterpiece,');
    assert.equal(await evaluate("document.querySelector('#novelai-negative').value"), 'text, watermark,');
    assert.equal(await evaluate(`document.querySelector('.library-card[data-id="${styleId}"] img').src.startsWith('data:image/')`), true);
    await change('#novelai-enable-references', true);
    const selectedRefs = await evaluate("document.querySelectorAll('.reference-card.enabled').length");
    await click('#generate');
    await waitUntil(() => evaluate("!document.querySelector('#generate').disabled && document.querySelector('#message').textContent.includes('готово')"), 'generation using chunk style');
    const chunkRequests = await fetch(`http://127.0.0.1:${MOCK_PORT}/__novelai-requests`).then(response => response.json());
    const chunkRequest = chunkRequests.at(-1);
    assert.ok(chunkRequest.input.includes('{{artist:kamochiru}}, pale colors, 1boy, masterpiece,'));
    assert.ok(!chunkRequest.input.includes('!macro:') && !chunkRequest.input.includes('Soft Painter'));
    assert.equal(chunkRequest.parameters.negative_prompt, 'text, watermark,');
    assert.equal(chunkRequest.parameters.director_reference_images.length, selectedRefs, 'A style preview leaked as a reference');
    for (const [source, errorText] of [['!macro:Missing!', 'не найден'], ['!macro:Cycle!', 'Циклический']]) {
        await change('#prompt', source, 'input');
        await click('#generate');
        await waitUntil(() => evaluate(`!document.querySelector('#generate').disabled && document.querySelector('#message').textContent.includes(${JSON.stringify(errorText)})`), 'chunk error before generation');
    }
    assert.equal((await fetch(`http://127.0.0.1:${MOCK_PORT}/__novelai-requests`).then(response => response.json())).length, chunkRequests.length, 'Invalid chunks made a paid API request');
    await change('#prompt', '@Ar', 'input');
    assert.equal(await evaluate("document.querySelector('#prompt').closest('label').nextElementSibling.querySelectorAll('.chunk-suggestion').length"), 1);
    await evaluate("document.querySelector('#prompt').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '!macro:Artist!, ');
    await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt] .chunk-capsule').click()");
    assert.ok((await evaluate("document.querySelector('#prompt').closest('label').nextElementSibling.querySelector('.chunk-inspection').textContent")).includes('pale colors'));
    await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt] .chunk-capsule').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    assert.ok(!(await evaluate("document.querySelector('#prompt').value")).includes('!macro:'));
    await click('#library-chunks-tab');
    const dragged = await evaluate(`(() => {
        const dataTransfer = new DataTransfer();
        document.querySelector('.library-card[data-id="${artistId}"] .library-apply').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        return dataTransfer.getData('text/plain');
    })()`);
    assert.equal(dragged, '!macro:Artist!');
    await change('#prefix', '!macro:Artist!', 'input');
    await click(`.library-card[data-id="${artistId}"] .library-edit`);
    await change('#library-name', 'Artist New');
    await click('#library-save');
    await waitUntil(() => evaluate("document.querySelector('#library-editor').classList.contains('hidden')"), 'chunk rename');
    assert.equal(await evaluate("document.querySelector('#prefix').value"), '!macro:Artist New!');
    await reload();
    assert.equal(await evaluate("document.querySelector('#prefix').value"), '!macro:Artist New!', 'Chunk rename/draft lost after reload');
    await click('#library-chunks-tab');
    const lookId = await libraryId('Look');
    await click(`.library-card[data-id="${lookId}"] .library-edit`);
    assert.equal(await evaluate("document.querySelector('#library-text').value"), '!macro:Artist New!, 1boy,', 'Nested chunk references were not renamed');
    await click('#library-cancel');
    await click('#library-new');
    await change('#library-name', 'Artist New');
    await change('#library-text', 'duplicate');
    await click('#library-save');
    assert.equal(await evaluate("document.querySelector('#library-editor').classList.contains('hidden')"), false);
    assert.ok((await evaluate("document.querySelector('#message').textContent")).includes('уже существует'));
    await click('#library-cancel');
    await click('#library-styles-tab');
    await click(`.library-card[data-id="${styleId}"] .library-edit`);
    assert.equal(await evaluate("document.querySelector('#library-preview').src.startsWith('data:image/')"), true, 'Preview lost after reload');
    await evaluate(`(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 900;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#c7a4ee'; ctx.fillRect(0, 0, 600, 900);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'style-preview.png', { type: 'image/png' }));
        const field = document.querySelector('#library-preview-upload'); field.files = transfer.files; field.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitUntil(() => evaluate("!document.querySelector('#library-save').disabled && document.querySelector('#library-preview').naturalHeight === 384"), 'uploaded resized preview');
    await click('#library-save');
    await waitUntil(() => evaluate("document.querySelector('#library-editor').classList.contains('hidden')"), 'update style preview');
    const naiPrefix = await evaluate("document.querySelector('#prefix').value");
    const scene = await evaluate("document.querySelector('#prompt').value");
    await click('#mode-standard');
    assert.equal(await evaluate("document.querySelectorAll('.library-card').length"), 0, 'NovelAI styles leaked into NB library');
    assert.ok(!(await evaluate("document.querySelector('#prefix').value")).includes('!macro:'));
    const nbId = await saveLibraryRecord('style', 'NB Cinema', 'cinematic warm lighting, textured paint');
    assert.equal(await evaluate("document.querySelector('#prompt').value"), scene);
    await reload();
    assert.equal(await evaluate("document.querySelector('#prefix').value"), 'cinematic warm lighting, textured paint');
    assert.equal(await evaluate("document.querySelector('#library-chunks-tab').classList.contains('hidden')"), true);
    await click('#mode-novelai');
    assert.equal(await evaluate("document.querySelector('#prefix').value"), naiPrefix, 'NB style overwrote the NovelAI style');
    assert.ok(await libraryId('Soft Painter'));
    assert.equal(await libraryId('NB Cinema'), undefined);
    await click('#mode-standard');
    await click(`.library-card[data-id="${nbId}"] .library-edit`);
    await evaluate('window.confirm = () => true');
    await click('#library-delete');
    await waitUntil(() => evaluate("document.querySelectorAll('.library-card').length === 0"), 'delete NB style');
    assert.equal(await evaluate("document.querySelector('#prefix').value"), 'cinematic warm lighting, textured paint', 'Deleting a preset deleted the current text');
    await click('#mode-novelai');
    for (const width of [390, 430]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await layoutCheck();
        await click(`.library-card[data-id="${styleId}"] .library-edit`);
        await change('#library-text', '@Ar', 'input');
        await layoutCheck();
        await click('#library-cancel');
    }
    const libraryClip = await evaluate(`(() => {
        const box = document.querySelector('#prompt-library-panel').getBoundingClientRect();
        return { x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height, scale: 1 };
    })()`);
    const libraryScreenshot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true, format: 'png', clip: libraryClip });
    await fs.writeFile(path.join(root, 'preview-prompt-library-mobile.png'), Buffer.from(libraryScreenshot.data, 'base64'));

    // Real keyboard input in the visual capsule editor, not just textarea assignments.
    await saveLibraryRecord('chunk', 'Итан', '1boy, wavy blond hair,');
    await change('#prompt', '', 'input');
    await evaluate("document.querySelector('#prompt').focus(); document.querySelector('#prompt').setSelectionRange(0, 0)");
    await cdp('Input.insertText', { text: 'A😀 ' });
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'A😀 ', 'Typing moved the caret backwards or lost Unicode');
    await cdp('Input.insertText', { text: '@Ит' });
    await press('Enter', 'Enter', 13);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'A😀 !macro:Итан!, ', 'Autocomplete did not insert a capsule at the caret');
    assert.equal(await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt] .chunk-capsule-name').textContent"), 'Итан');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#prompt')).display"), 'none', 'Raw macro textarea is still visible');
    assert.ok(!(await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt]').textContent")).includes('!macro:'));
    await cdp('Input.insertText', { text: 'walking' });
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'A😀 !macro:Итан!, walking', 'Text inserted after a capsule at the wrong position');
    const copied = await evaluate(`(() => {
        const field = document.querySelector('#prompt'); const start = field.value.indexOf('!macro:');
        field.setSelectionRange(start, start + '!macro:Итан!'.length);
        const data = new DataTransfer();
        document.querySelector('.chunk-rich-editor[data-field=prompt]').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return data.getData('text/plain');
    })()`);
    assert.equal(copied, '!macro:Итан!', 'Copying a capsule lost its canonical reference');
    await evaluate(`(() => {
        const data = new DataTransfer();
        document.querySelector('.chunk-rich-editor[data-field=prompt]').dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: data }));
    })()`);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'A😀 , walking');
    await press('z', 'KeyZ', 90, 2);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'A😀 !macro:Итан!, walking', 'Undo did not restore the capsule');
    await press('Z', 'KeyZ', 90, 10);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'A😀 , walking', 'Redo did not repeat capsule removal');
    await press('z', 'KeyZ', 90, 2);
    await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt] .chunk-capsule-remove').click()");
    assert.equal(await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt]').querySelectorAll('.chunk-capsule').length"), 0);
    await change('#prompt', '!macro:Итан!', 'input');
    await evaluate("const field = document.querySelector('#prompt'); field.focus(); field.setSelectionRange(field.value.length, field.value.length)");
    await press('Backspace', 'Backspace', 8);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '', 'Backspace partially deleted a capsule');
    await press('z', 'KeyZ', 90, 2);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '!macro:Итан!');
    await evaluate("document.querySelector('#prompt').setSelectionRange(0, 0)");
    await press('Delete', 'Delete', 46);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '', 'Forward delete partially deleted a capsule');
    await evaluate(`(() => {
        const data = new DataTransfer(); data.setData('text/plain', '!macro:Итан!, <b>literal</b>');
        data.setData('text/html', '<img src=x onerror="window.capsuleXss=true">');
        document.querySelector('.chunk-rich-editor[data-field=prompt]').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    })()`);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '!macro:Итан!, <b>literal</b>');
    assert.equal(await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt]').querySelectorAll('img,b').length"), 0, 'HTML from the clipboard entered the editor DOM');
    assert.equal(await evaluate('Boolean(window.capsuleXss)'), false);
    await change('#prompt', '', 'input');
    await evaluate("document.querySelector('#prompt').focus(); document.querySelector('#prompt').setSelectionRange(0, 0)");
    await cdp('Input.imeSetComposition', { text: 'Ит', selectionStart: 2, selectionEnd: 2 });
    await cdp('Input.insertText', { text: 'Итан' });
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'Итан', 'IME composition duplicated or lost text');
    await press('Enter', 'Enter', 13);
    await cdp('Input.insertText', { text: 'next line' });
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'Итан\nnext line', 'Enter did not preserve a single newline');
    await change('#prompt', `${'long prompt line\n'.repeat(60)}!macro:Итан!`, 'input');
    await evaluate("(() => { const field = document.querySelector('#prompt'); field.focus(); field.setSelectionRange(field.value.length, field.value.length) })()");
    await cdp('Input.insertText', { text: ' tail' });
    assert.equal(await evaluate("document.querySelector('#prompt').value.endsWith('!macro:Итан! tail')"), true);
    assert.equal(await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt]').scrollTop > 0"), true, 'Caret did not scroll into view in a long prompt');
    await change('#prompt', '!macro:Итан!, !macro:Artist New!, !macro:Look!', 'input');
    const hues = await evaluate("[...document.querySelectorAll('.chunk-rich-editor[data-field=prompt] .chunk-capsule')].map(node => node.style.getPropertyValue('--chunk-hue'))");
    assert.ok(new Set(hues).size > 1, 'All capsules have the same color');
    for (const width of [390, 430]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await layoutCheck();
    }
    await waitUntil(() => evaluate("JSON.parse(localStorage.getItem('image-studio.draft.v1')).prompt === document.querySelector('#prompt').value"), 'capsule draft saved');
    await reload();
    await waitUntil(() => evaluate("document.querySelectorAll('.chunk-rich-editor[data-field=prompt] .chunk-capsule').length === 3"), 'capsules restored after reload');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.chunk-rich-editor[data-field=prompt] .chunk-capsule')].map(node => node.style.getPropertyValue('--chunk-hue'))"), hues);
    await evaluate("window.scrollTo(0, window.scrollY + document.querySelector('.prompt-panel').getBoundingClientRect().top - 90)");
    const capsuleClip = await evaluate(`(() => {
        const box = document.querySelector('.prompt-panel').getBoundingClientRect();
        return { x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height, scale: 1 };
    })()`);
    const capsuleScreenshot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true, format: 'png', clip: capsuleClip });
    await fs.writeFile(path.join(root, 'preview-chunk-capsules-mobile.png'), Buffer.from(capsuleScreenshot.data, 'base64'));

    // Local NovelAI tag help: real typing, preserving chunk/weight syntax, imports and mode isolation.
    const beforeTagRequests = (await fetch(`http://127.0.0.1:${MOCK_PORT}/__novelai-requests`).then(response => response.json())).length;
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitUntil(() => evaluate("document.querySelector('#tag-assistant').dataset.ready === 'true'"), 'tag helper ready');
    await waitUntil(() => evaluate("Number(document.querySelector('#tag-assistant').dataset.baseCount) > 140000"), 'large Danbooru catalog loaded');
    await change('#prompt', '1boy, ', 'input');
    await evaluate("document.querySelector('#prompt').focus(); document.querySelector('#prompt').setSelectionRange(6,6)");
    await cdp('Input.insertText', { text: 'blue ha' });
    await waitUntil(() => evaluate("document.querySelector('.tag-suggestions[data-field=prompt] strong')?.textContent === 'blue hair'"), 'tag autocomplete');
    await press('Enter', 'Enter', 13);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '1boy, blue hair, ');
    await press('z', 'KeyZ', 90, 2);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '1boy, blue ha', 'Tag insertion broke undo');
    await press('z', 'KeyZ', 90, 10);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '1boy, blue hair, ');
    await change('#prompt', '@И', 'input');
    await evaluate("document.querySelector('#prompt').focus(); document.querySelector('#prompt').setSelectionRange(2,2)");
    assert.equal(await evaluate("document.querySelector('.tag-suggestions[data-field=prompt]').children.length"), 0, 'Tag suggestions conflict with @ chunks');
    await press('Enter', 'Enter', 13);
    assert.equal(await evaluate("document.querySelector('#prompt').value.startsWith('!macro:Итан!')"), true);
    await change('#prompt', '!macro:Итан!, 1.2::blue ha::, 1boy', 'input');
    await evaluate("(() => { const f=document.querySelector('#prompt'); f.focus(); const at=f.value.indexOf('blue ha')+7; f.setSelectionRange(at,at); })()");
    await waitUntil(() => evaluate("document.querySelector('.tag-suggestions[data-field=prompt] strong')?.textContent === 'blue hair'"), 'completion inside numeric emphasis');
    await press('Enter', 'Enter', 13);
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '!macro:Итан!, 1.2::blue hair::, 1boy');
    assert.equal(await evaluate("document.querySelectorAll('.chunk-rich-editor[data-field=prompt] .chunk-capsule').length"), 1);
    await click('#tag-assistant > summary');
    await waitUntil(() => evaluate("document.querySelectorAll('.tag-current-token').length === 3"), 'prompt construction groups');
    await click('.tag-current-token[data-index="1"]');
    await click('#tag-stronger');
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '!macro:Итан!, {1.2::blue hair::}, 1boy');
    await click('#tag-weaker');
    await click('#tag-left');
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '1.2::blue hair::, !macro:Итан!, 1boy');
    await click('#tag-right');
    await change('#tag-search', 'коса', 'input');
    await click('.tag-choice[data-tag="braid"]');
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '!macro:Итан!, 1.2::blue hair::, 1boy, braid, ');
    assert.equal(await evaluate("document.querySelector('.tag-choice[data-tag=braid]').disabled"), true, 'Duplicate tag is not marked');
    await click('.tag-current-token[data-index="3"]');
    await click('#tag-remove');
    assert.equal(await evaluate("document.querySelector('#prompt').value"), '!macro:Итан!, 1.2::blue hair::, 1boy, ');
    await change('#tag-target', 'prefix');
    await change('#prefix', '{{artist:custom}}, ', 'input');
    await change('#tag-search', 'мягкое освещение', 'input');
    await click('.tag-choice[data-tag="soft lighting"]');
    assert.equal(await evaluate("document.querySelector('#prefix').value"), '{{artist:custom}}, soft lighting, ');
    await change('#tag-target', 'negative');
    await change('#novelai-negative', 'text, ', 'input');
    await change('#tag-search', 'водяной', 'input');
    await click('.tag-choice[data-tag="watermark"]');
    assert.equal(await evaluate("document.querySelector('#novelai-negative').value"), 'text, watermark, ');
    await change('#model', 'nai-diffusion-5-full-medium', 'input');
    assert.equal(await evaluate("[...document.querySelectorAll('.tag-choice')].every(button=>button.disabled)"), true, 'Helper edits unsupported Medium negative');
    await change('#model', 'nai-diffusion-4-5-full', 'input');
    await change('#tag-target', 'prompt');
    await change('#tag-enabled', false);
    await change('#prompt', 'blue ha', 'input');
    assert.equal(await evaluate("document.querySelector('.tag-suggestions[data-field=prompt]').children.length"), 0);
    await reload();
    assert.equal(await evaluate("document.querySelector('#tag-enabled').checked"), false, 'Suggestion toggle did not survive reload');
    await click('#mode-standard');
    assert.equal(await evaluate("document.querySelector('#tag-assistant').classList.contains('hidden')"), true);
    await change('#prompt', 'blue ha', 'input');
    assert.equal(await evaluate("document.querySelector('.tag-suggestions[data-field=prompt]').children.length"), 0, 'Tag helper leaked into ordinary mode');
    await click('#mode-novelai');
    await change('#tag-enabled', true);
    await click('#tag-assistant > summary');
    await change('#tag-search', 'сияние', 'input');
    assert.equal(await evaluate("document.querySelectorAll('.tag-choice').length"), 0);
    await evaluate(`(() => {
        const input=document.querySelector('#tag-upload'); const data=new DataTransfer();
        data.items.add(new File([JSON.stringify({ 'Мои эффекты': [{tag:'ultra_glow',desc:'Сияние <img src=x onerror="window.tagXss=true">'}] })], 'my-tags.json', {type:'application/json'}));
        input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await waitUntil(() => evaluate("document.querySelector('.tag-choice[data-tag=\"ultra glow\"]') && !document.querySelector('#tag-upload').disabled"), 'custom tag dictionary import');
    assert.equal(await evaluate("document.querySelector('#tag-results img') !== null || Boolean(window.tagXss)"), false, 'Imported description executed HTML');
    await click('.tag-choice[data-tag="ultra glow"]');
    assert.equal(await evaluate("document.querySelector('#prompt').value"), 'blue ha, ultra glow, ');
    await evaluate("(() => { const f=document.querySelector('#tag-upload'), d=new DataTransfer(); d.items.add(new File(['not JSON'],'bad.json')); f.files=d.files; f.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await waitUntil(() => evaluate("!document.querySelector('#tag-upload').disabled && document.querySelector('#message').textContent.includes('Не удалось загрузить словарь')"), 'bad dictionary error');
    assert.equal(await evaluate("document.querySelector('#tag-dictionary').textContent.includes('Из файла: 1')"), true, 'Invalid import erased the dictionary');
    await reload();
    await waitUntil(() => evaluate("document.querySelector('#tag-dictionary').textContent.includes('Из файла: 1')"), 'custom dictionary survives reload');
    await click('#tag-assistant > summary');
    await change('#tag-search', 'сияние', 'input');
    assert.equal(await evaluate("document.querySelector('.tag-choice strong').textContent.includes('ultra glow')"), true);
    await change('#tag-search', 'heterochromia', 'input');
    assert.equal(await evaluate("document.querySelector('.tag-choice strong').textContent.includes('heterochromia')"), true, 'Custom dictionary replaced Danbooru');
    await change('#tag-category', 'Авторы');
    await change('#tag-search', 'kamochiru', 'input');
    assert.ok(await evaluate("Number(document.querySelector('#tag-count').textContent.replace(/[^0-9]/g,'')) > 0"), 'Danbooru artist search not available');
    await change('#tag-search', 'moustachecatofdeath', 'input');
    assert.equal(await evaluate("document.querySelector('.tag-choice').dataset.tag"), 'kamochiru', 'Danbooru alias lookup did not find the canonical artist tag');
    await change('#tag-category', '');
    await change('#tag-search', 'wolf', 'input');
    assert.ok(await evaluate("Number(document.querySelector('#tag-count').textContent.replace(/[^0-9]/g,'')) > 12"), 'Large catalog did not expand matches');
    await click('#tag-next');
    assert.equal(await evaluate("document.querySelector('#tag-page').textContent.startsWith('2 /')"), true);
    // Stale background results must not overwrite the most recent search.
    await evaluate("for(const value of ['red ha','wolf','blue hair']) { const f=document.querySelector('#tag-search'); f.value=value; f.dispatchEvent(new Event('input',{bubbles:true})); }");
    await waitTagResults();
    assert.equal(await evaluate("document.querySelector('.tag-choice strong').textContent.includes('blue hair')"), true);
    await change('#tag-search', 'сияние', 'input');
    await evaluate('window.confirm = () => true');
    await click('#tag-reset');
    await waitUntil(() => evaluate("!document.querySelector('#tag-dictionary').textContent.includes('Из файла:')"), 'reset custom dictionary');
    assert.equal(await evaluate("document.querySelectorAll('.chunk-rich-editor[data-field=prompt]').length"), 1, 'Dictionary reset removed the editor');
    await change('#prompt', '1boy, !macro:Итан!, green eyes, brown hair', 'input');
    assert.equal(await evaluate("document.querySelector('.chunk-rich-editor[data-field=prompt] .chunk-capsule').classList.contains('missing')"), false, 'Dictionary reset deleted saved chunks');
    await change('#tag-search', 'волосы', 'input');
    for (const width of [390, 430]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await layoutCheck();
    }
    await evaluate("window.scrollTo(0, window.scrollY + document.querySelector('#tag-assistant').getBoundingClientRect().top - 80)");
    const tagClip = await evaluate("(() => {const b=document.querySelector('#tag-assistant').getBoundingClientRect();return {x:b.left+scrollX,y:b.top+scrollY,width:b.width,height:b.height,scale:1}})()");
    const tagScreenshot = await cdp('Page.captureScreenshot', {captureBeyondViewport:true, format:'png',clip:tagClip});
    await fs.writeFile(path.join(root, 'preview-tag-assistant-mobile.png'), Buffer.from(tagScreenshot.data,'base64'));
    assert.equal((await fetch(`http://127.0.0.1:${MOCK_PORT}/__novelai-requests`).then(response=>response.json())).length, beforeTagRequests, 'Local tag help made a generation request');

    // Kaloscope is a separate, opt-in tab. Local preparation/paste must not upload or add references.
    await click('#nav-artists');
    assert.equal(await evaluate("document.querySelector('#studio-workspace').classList.contains('hidden')"), true);
    assert.equal(await evaluate("document.querySelector('#artist-page').classList.contains('hidden')"), false);
    await evaluate(`(async () => {
        const data=new DataTransfer(); const canvas=document.createElement('canvas'); canvas.width=64; canvas.height=64;
        canvas.getContext('2d').fillRect(0,0,64,64); const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        data.items.add(new File([blob],'clipboard.png',{type:'image/png'}));
        window.dispatchEvent(new ClipboardEvent('paste',{cancelable:true,clipboardData:data}));
    })()`);
    await waitUntil(() => evaluate("document.querySelector('#artist-preview').src.startsWith('data:image/jpeg')"), 'local artist clipboard preview');
    assert.equal(await evaluate("document.querySelectorAll('.reference-card').length"), 2, 'Pasting in classifier added a generation reference');
    assert.equal((await fetch(`http://127.0.0.1:${MOCK_PORT}/__artist-requests`).then(response=>response.json())).length, 0, 'Preview automatically uploaded image');
    await click('#nav-gallery');
    await click('.history-preview');
    await waitUntil(() => evaluate("!document.querySelector('#viewer-use-prompt').disabled"), 'source from gallery');
    await click('#viewer-use-prompt');
    await click('#nav-artists');
    assert.equal(await evaluate("document.querySelector('#artist-current').disabled"), false);
    await click('#artist-current');
    await waitUntil(() => evaluate("document.querySelector('#artist-caption').textContent.startsWith('Картинка с холста')"), 'classify current canvas');
    await evaluate(`(() => {
        const canvas=document.createElement('canvas'); canvas.width=1800; canvas.height=1200;
        const ctx=canvas.getContext('2d'); const gradient=ctx.createLinearGradient(0,0,1800,1200); gradient.addColorStop(0,'#6b58a3'); gradient.addColorStop(1,'#dbb0b8'); ctx.fillStyle=gradient; ctx.fillRect(0,0,1800,1200);
        ctx.fillStyle='#f4e6dc'; ctx.fillRect(500,250,800,700); ctx.fillStyle='#735a75'; ctx.font='60px sans-serif'; ctx.fillText('Local test image',660,600);
        const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0)); const data=new DataTransfer();
        data.items.add(new File([bytes],'PRIVATE_ART_NAME.png',{type:'image/png'})); const input=document.querySelector('#artist-upload'); input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await waitUntil(() => evaluate("document.querySelector('#artist-caption').textContent.includes('1024×683')"), 'metadata-free scaled classifier image');
    assert.equal(await evaluate("document.querySelector('#artist-run').disabled"), true, 'Artist upload did not require consent');
    await click('#artist-run');
    assert.equal((await fetch(`http://127.0.0.1:${MOCK_PORT}/__artist-requests`).then(response=>response.json())).length, 0);
    await change('#artist-consent', true);
    await press('Enter', 'Enter', 13, 2);
    assert.equal((await fetch(`http://127.0.0.1:${MOCK_PORT}/__novelai-requests`).then(response=>response.json())).length, beforeTagRequests, 'Classifier shortcut generated an image');
    await click('#artist-run');
    await waitUntil(() => evaluate("document.querySelectorAll('.artist-result-row').length === 2 && !document.querySelector('#artist-run').disabled"), 'Kaloscope artist results');
    assert.equal(await evaluate("document.querySelector('.artist-result-name').textContent"), 'kamochiru');
    assert.equal(await evaluate("document.querySelector('.artist-result-name').href"), 'https://danbooru.donmai.us/posts?tags=kamochiru');
    assert.equal(await evaluate("document.querySelector('#artist-results img, #artist-results script') !== null"), false, 'Classifier rendered remote HTML');
    assert.equal(await evaluate("document.querySelector('#artist-tags').value"), 'artist:kamochiru');
    const classifierRequests = await fetch(`http://127.0.0.1:${MOCK_PORT}/__artist-requests`).then(response=>response.json());
    assert.equal(classifierRequests.some(request=>request.authorization), false);
    assert.equal(JSON.stringify(classifierRequests).includes('PRIVATE_ART_NAME'), false, 'Original filename sent to HF');
    assert.deepEqual(classifierRequests.find(request=>request.type==='predict').payload.data.slice(1), ['Kaloscope v2.0 ONNX',5,0]);
    await click('#artist-select-all');
    await change('#artist-format', 'plain');
    assert.equal(await evaluate("document.querySelector('#artist-tags').value"), 'kamochiru, to_e');
    await change('#artist-format', 'novelai');
    const beforeStyleTransfer = await evaluate("({prefix:document.querySelector('#prefix').value,prompt:document.querySelector('#prompt').value,negative:document.querySelector('#novelai-negative').value,refs:document.querySelectorAll('.reference-card.enabled').length})");
    await click('#artist-use');
    assert.equal(await evaluate("document.querySelector('#artist-page').classList.contains('hidden')"), true);
    const afterStyleTransfer = await evaluate("({prefix:document.querySelector('#prefix').value,prompt:document.querySelector('#prompt').value,negative:document.querySelector('#novelai-negative').value,refs:document.querySelectorAll('.reference-card.enabled').length})");
    assert.ok(afterStyleTransfer.prefix.startsWith(beforeStyleTransfer.prefix));
    assert.ok(afterStyleTransfer.prefix.endsWith('artist:kamochiru, artist:to_e, '));
    assert.equal(afterStyleTransfer.prompt,beforeStyleTransfer.prompt); assert.equal(afterStyleTransfer.negative,beforeStyleTransfer.negative); assert.equal(afterStyleTransfer.refs,beforeStyleTransfer.refs);
    await click('#nav-artists');
    await change('#artist-top-k',7,'input'); await click('#artist-run');
    await waitUntil(() => evaluate("document.querySelector('#artist-status').dataset.kind === 'error' && !document.querySelector('#artist-run').disabled"), 'artist service failure');
    await change('#artist-top-k',8,'input'); await click('#artist-run');
    await waitUntil(() => evaluate("!document.querySelector('#artist-cancel').classList.contains('hidden')"), 'artist pending request');
    await click('#artist-cancel');
    await waitUntil(() => evaluate("document.querySelector('#artist-status').textContent.includes('Ожидание остановлено') && !document.querySelector('#artist-run').disabled"), 'stop artist wait');
    await change('#artist-top-k',5,'input'); await click('#artist-run');
    await waitUntil(() => evaluate("document.querySelectorAll('.artist-result-row').length === 2 && !document.querySelector('#artist-run').disabled"), 'artist retry');
    for (const width of [390,430]) {
        await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true}); await layoutCheck();
    }
    const artistClip = await evaluate("(() => {const b=document.querySelector('#artist-page').getBoundingClientRect(); return {x:b.left+scrollX,y:b.top+scrollY,width:b.width,height:b.height,scale:1}})()");
    const artistScreenshot = await cdp('Page.captureScreenshot',{captureBeyondViewport:true,format:'png',clip:artistClip});
    await fs.writeFile(path.join(root,'preview-artist-classifier-mobile.png'),Buffer.from(artistScreenshot.data,'base64'));
    await reload();
    assert.equal(await evaluate("document.querySelector('#artist-consent').checked"), false, 'Classifier persisted consent');
    assert.equal(await evaluate("document.querySelector('#artist-preview').hasAttribute('src')"), false, 'Classifier persisted uploaded art');
    assert.equal(await evaluate("document.querySelector('#artist-run').disabled"), true);
    await click('#nav-studio');
    assert.deepEqual(errors, [], 'Browser JS errors');
    console.log('Browser checks passed: Kaloscope tab/upload/paste/canvas/consent/privacy/artist links/style transfer/errors/cancel/mobile, large 140k+ Danbooru worker catalog/aliases/categories/pagination/stale-query protection, local NovelAI tag suggestions/imports/Russian search/weights/reordering/undo/isolation, no generation calls for tag help, gallery search/provider/date/sort/page shortcuts, filtered full-screen browsing, real keyboard and phone swipes, rapid navigation, current-image download, small thumbnails, explicit prompt reuse, inline colored capsules, real keyboard/caret/Unicode/IME, copy/cut/plain paste, atomic deletion, undo/redo, reload, styles/previews/mode isolation, chunk autocomplete/expansion/renaming, no API calls for invalid chunks, database migration, history, profiles, mobile layout');
} finally {
    socket?.close();
    for (const request of pending.values()) clearTimeout(request.timeout);
    for (const child of children) child.kill();
    await Promise.all(children.filter(child => child.exitCode === null).map(child => new Promise(resolve => child.once('exit', resolve))));
    assert.equal(path.dirname(path.resolve(imagesDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(imagesDir).startsWith('image-studio-browser-'));
    await fs.rm(imagesDir, { recursive: true, force: true });
}
