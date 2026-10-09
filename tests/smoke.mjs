import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const APP_PORT = 3212;
const MOCK_PORT = 3213;
const root = new URL('../', import.meta.url);
const children = [];

function launch(file, env = {}) {
    const child = spawn(process.execPath, [fileURLToPath(new URL(file, root))], {
        cwd: fileURLToPath(root),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    children.push(child);
    return child;
}

async function waitFor(url) {
    for (let attempt = 0; attempt < 40; attempt++) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch { /* wait */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${url}`);
}

async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:${APP_PORT}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${path}: ${JSON.stringify(result)}`);
    return result;
}

try {
    launch('tests/mock-provider.mjs', { MOCK_PORT: String(MOCK_PORT) });
    launch('server.mjs', { PORT: String(APP_PORT) });
    await Promise.all([
        waitFor(`http://127.0.0.1:${APP_PORT}`),
        waitFor(`http://127.0.0.1:${MOCK_PORT}/models`),
    ]);

    const base = {
        prompt: 'portrait test',
        prefix: 'soft light',
        negativePrompt: 'text',
        aspectRatio: '1:1',
        imageSize: '1K',
        size: '1024x1024',
        quality: '',
        references: [],
    };
    const endpoint = `http://127.0.0.1:${MOCK_PORT}`;

    const openai = await post('/api/generate', {
        ...base,
        profile: { provider: 'openai', endpoint, apiKey: 'test', model: 'mock-image-model' },
    });
    if (!openai.dataUrl?.startsWith('data:image/png;base64,')) throw new Error('OpenAI result invalid');

    const openaiEdit = await post('/api/generate', {
        ...base,
        profile: { provider: 'openai', endpoint, apiKey: 'test', model: 'gpt-image-mock' },
        references: [{ dataUrl: openai.dataUrl, label: 'face', description: 'keep identity' }],
    });
    if (!openaiEdit.dataUrl) throw new Error('OpenAI edit result invalid');

    const gemini = await post('/api/generate', {
        ...base,
        profile: { provider: 'gemini', endpoint, apiKey: 'test', model: 'mock-gemini-image' },
        references: [{ dataUrl: openai.dataUrl, label: 'face' }],
    });
    if (!gemini.dataUrl) throw new Error('Gemini result invalid');

    const openrouter = await post('/api/generate', {
        ...base,
        profile: { provider: 'openrouter', endpoint, apiKey: 'test', model: 'mock-router-image' },
        references: [{ dataUrl: openai.dataUrl, label: 'face' }],
    });
    if (!openrouter.dataUrl) throw new Error('OpenRouter result invalid');

    const models = await post('/api/models', {
        profile: { provider: 'openai', endpoint, apiKey: 'test' },
    });
    if (!models.models.includes('mock-image-model')) throw new Error('Model discovery failed');

    console.log('Smoke tests passed: static, OpenAI generate/edit, Gemini, OpenRouter, model discovery');
} finally {
    for (const child of children) child.kill();
}
