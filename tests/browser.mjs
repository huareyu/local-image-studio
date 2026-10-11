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
    return evaluate(`(() => {
        const field = document.querySelector(${JSON.stringify(selector)});
        ${typeof value === 'boolean' ? `field.checked = ${value};` : `field.value = ${JSON.stringify(String(value))};`}
        field.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    })()`);
}

async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
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
        return [...document.querySelectorAll('main, .panel, .section-heading, input, select, textarea, button')]
            .filter(node => node.getClientRects().length && !node.closest('template'))
            .filter(node => { const box = node.getBoundingClientRect(); return box.right > width + 1 || box.left < -1; })
            .map(node => node.id || node.className || node.tagName);
    })()`);
    assert.deepEqual(bad, [], 'Controls overflow viewport');
}

try {
    launch('server.mjs', { PORT: String(APP_PORT), IMAGE_STUDIO_IMAGES_DIR: imagesDir });
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
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open('local-image-studio', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
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
        const db = await new Promise(resolve => { const request = indexedDB.open('local-image-studio', 1); request.onsuccess = () => resolve(request.result); });
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
        const db = await new Promise(resolve => { const request = indexedDB.open('local-image-studio', 1); request.onsuccess = () => resolve(request.result); });
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
        const db = await new Promise(resolve => { const request = indexedDB.open('local-image-studio', 1); request.onsuccess = () => resolve(request.result); });
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
    await waitUntil(() => evaluate("!document.querySelector('#result-image').classList.contains('hidden')"), 'history preview after selection');
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
    assert.deepEqual(errors, [], 'Browser JS errors');
    console.log('Browser checks passed: folder button/legacy archive, paged and cross-page selective deletion, confirmation/cancellation, file/ref preservation, independent ordinary/NovelAI modes, automatic saving, credential/proxy isolation, legacy migration, per-mode profiles, settings/Medium preservation, ref isolation/normalization/profiles, negative presets, mobile layout');
} finally {
    socket?.close();
    for (const request of pending.values()) clearTimeout(request.timeout);
    for (const child of children) child.kill();
    await Promise.all(children.filter(child => child.exitCode === null).map(child => new Promise(resolve => child.once('exit', resolve))));
    assert.equal(path.dirname(path.resolve(imagesDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(imagesDir).startsWith('image-studio-browser-'));
    await fs.rm(imagesDir, { recursive: true, force: true });
}
