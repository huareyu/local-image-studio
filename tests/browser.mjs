// Desktop/mobile browser checks against local mocks only; no paid API calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { WebSocket } from 'undici';

const root = fileURLToPath(new URL('../', import.meta.url));
const APP_PORT = 3218;
const MOCK_PORT = 3219;
const DEBUG_PORT = 9228;
const origin = `http://127.0.0.1:${APP_PORT}`;
const children = [];
const errors = [];
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
    await waitUntil(() => evaluate("document.querySelector('#profile-select')?.options.length === 2 && document.querySelector('#reference-list')?.children.length === 2"), 'UI ready');
}
async function reload() { await cdp('Page.reload'); await ready(); }
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
    launch('server.mjs', { PORT: String(APP_PORT) });
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
    await waitUntil(() => evaluate("document.querySelector('#reference-profile-select')?.options.length > 0"), 'first load');
    await evaluate(`(async () => {
        localStorage.setItem('image-studio.profiles.v1', JSON.stringify([
            { id: 'nai', name: 'NovelAI test', provider: 'novelai', endpoint: 'http://127.0.0.1:${MOCK_PORT}', model: 'nai-diffusion-5-full', rememberKey: false, novelaiSteps: 42, novelaiAnlasGuard: false, novelaiNegativePrompt: 'NAI ONLY' },
            { id: 'gemini', name: 'Gemini test', provider: 'gemini', endpoint: 'http://127.0.0.1:${MOCK_PORT}', model: 'mock-gemini-image', apiKey: 'test' }
        ]));
        sessionStorage.setItem('image-studio.session-secrets.v1', JSON.stringify({ nai: 'test-token' }));
        localStorage.setItem('image-studio.active-profile.v1', 'nai');
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
    await change('#profile-select', 'gemini');
    assert.equal(await evaluate("document.querySelector('#provider').value"), 'gemini', 'Connection profile switch failed');
    assert.equal(await evaluate("document.querySelector('#negative-prompt').value"), 'GENERIC ONLY');
    await change('#profile-select', 'nai');
    await click('#profile-save');
    const stored = await evaluate("JSON.parse(localStorage.getItem('image-studio.profiles.v1')).find(profile => profile.id === 'nai')");
    assert.equal(stored.apiKey, '', 'Session-only token persisted to localStorage');
    assert.equal(stored.novelaiNegativePrompt, 'MY PRESET');
    await layoutCheck();
    for (const width of [390, 430]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await layoutCheck();
    }
    await change('#proxy-enabled', true);
    await layoutCheck();
    const screenshot = await cdp('Page.captureScreenshot', { captureBeyondViewport: true, format: 'png' });
    await fs.writeFile(path.join(root, 'preview-novelai-mobile.png'), Buffer.from(screenshot.data, 'base64'));
    assert.deepEqual(errors, [], 'Browser JS errors');
    console.log('Browser checks passed: settings/Medium preservation, personal token storage, ref isolation/normalization/profiles, negative presets, profile switching, mobile layout');
} finally {
    socket?.close();
    for (const request of pending.values()) clearTimeout(request.timeout);
    for (const child of children) child.kill();
}
