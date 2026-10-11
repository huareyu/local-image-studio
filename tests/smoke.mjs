import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const APP_PORT = 3212;
const MOCK_PORT = 3213;
const PROXY_PORT = 3214;
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
    launch('tests/mock-proxy.mjs', { PROXY_PORT: String(PROXY_PORT) });
    launch('server.mjs', { PORT: String(APP_PORT) });
    await Promise.all([
        waitFor(`http://127.0.0.1:${APP_PORT}`),
        waitFor(`http://127.0.0.1:${MOCK_PORT}/models`),
        waitFor(`http://127.0.0.1:${PROXY_PORT}/__stats`),
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

    const proxiedModels = await post('/api/models', {
        profile: {
            provider: 'openai',
            endpoint,
            apiKey: 'test',
            proxyEnabled: true,
            proxyUrl: `http://127.0.0.1:${PROXY_PORT}`,
            proxyUsername: 'proxy-user',
            proxyPassword: 'proxy-pass',
        },
    });
    if (!proxiedModels.models.includes('mock-image-model')) throw new Error('Proxied model discovery failed');
    const proxyStats = await fetch(`http://127.0.0.1:${PROXY_PORT}/__stats`).then(response => response.json());
    if (proxyStats.forwarded < 1) throw new Error('Proxy was not used');

    const novelaiProfile = {
        provider: 'novelai', endpoint, apiKey: 'test-token', model: 'nai-diffusion-4-5-full',
        novelaiSteps: 42, novelaiSampler: 'k_dpmpp_2m', novelaiScheduler: 'karras',
        novelaiScale: 6.5, novelaiCfgRescale: 0.6, novelaiSize: 'Landscape',
        novelaiNegativePrompt: 'custom negative', novelaiAnlasGuard: false, novelaiSeed: 12345,
        novelaiEnableReferences: true, novelaiReferenceType: 'style',
        novelaiReferenceStrength: 0.8, novelaiReferenceFidelity: 0.4,
        novelaiDecrisper: true, novelaiVarietyBoost: true,
        novelaiTagPresets: [{ enabled: true, name: 'portrait', value: '1boy, portrait' }],
        proxyEnabled: true, proxyUrl: `http://127.0.0.1:${PROXY_PORT}`,
        proxyUsername: 'proxy-user', proxyPassword: 'proxy-pass',
    };
    const naiRefs = [{ dataUrl: openai.dataUrl, label: 'face', description: 'REFERENCE_ONLY_MARKER' }];
    const nai = await post('/api/generate', { ...base, profile: novelaiProfile, references: naiRefs });
    assert.equal(nai.dataUrl, openai.dataUrl);
    assert.equal(nai.seed, 12345);
    assert.equal(nai.width, 1216);
    assert.equal(nai.height, 832);
    assert.equal(nai.referenceCount, 1);
    await post('/api/generate', { ...base, profile: { ...novelaiProfile, novelaiEnableReferences: false }, references: naiRefs });
    await post('/api/generate', { ...base, profile: { ...novelaiProfile, model: 'nai-diffusion-5-full' }, references: naiRefs });
    await post('/api/generate', { ...base, profile: { ...novelaiProfile, model: 'nai-diffusion-5-full-medium' }, references: naiRefs });
    await post('/api/generate', { ...base, profile: { ...novelaiProfile, model: 'nai-diffusion-3', novelaiSm: true }, references: naiRefs });
    const [v45, noRefs, v5, medium, v3] = await fetch(`${endpoint}/__novelai-requests`).then(response => response.json());
    assert.equal(v45.action, 'generate');
    assert.equal(v45.parameters.params_version, 3);
    assert.equal(v45.parameters.steps, 42);
    assert.equal(v45.parameters.cfg_rescale, 0.6);
    assert.equal(v45.parameters.sampler, 'k_dpmpp_2m');
    assert.equal(v45.parameters.noise_schedule, 'karras');
    assert.equal(v45.parameters.negative_prompt, 'custom negative');
    assert.equal(v45.parameters.director_reference_descriptions[0].caption.base_caption, 'style');
    assert.deepEqual(v45.parameters.director_reference_strength_values, [0.8]);
    assert.deepEqual(v45.parameters.director_reference_secondary_strength_values, [0.4]);
    assert.match(v45.input, /1boy, portrait/);
    assert.ok(!v45.input.includes('Avoid:'));
    assert.equal(v45.parameters.director_reference_images[0], openai.dataUrl.split(',')[1]);
    for (const request of [noRefs, v5, medium, v3]) {
        assert.ok(!request.input.includes('REFERENCE_ONLY_MARKER'), 'Disabled reference description leaked');
        assert.ok(!request.parameters.director_reference_images, 'Disabled reference image leaked');
    }
    for (const request of [v5, medium]) {
        assert.equal(request.parameters.params_version, 4);
        for (const name of ['sm', 'sm_dyn', 'dynamic_thresholding', 'skip_cfg_above_sigma', 'reference_image_multiple']) {
            assert.ok(!(name in request.parameters), `V5 received unsupported field: ${name}`);
        }
    }
    assert.equal(v5.parameters.steps, 42);
    assert.equal(medium.parameters.steps, 14);
    assert.equal(medium.parameters.sampler, 'k_euler_ancestral');
    assert.equal(medium.parameters.cfg_rescale, 0);
    assert.ok(!('negative_prompt' in medium.parameters));
    assert.equal(medium.parameters.v4_negative_prompt.caption.base_caption, '');
    assert.equal(v3.parameters.sm, true);
    assert.ok(!('v4_prompt' in v3.parameters));
    const status = await post('/api/novelai/status', { profile: novelaiProfile });
    assert.equal(status.active, true);
    assert.equal(status.anlas.fixedTrainingStepsLeft, 100);
    const invalidKeyResponse = await fetch(`http://127.0.0.1:${APP_PORT}/api/novelai/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { ...novelaiProfile, apiKey: 'invalid' } }),
    });
    assert.equal(invalidKeyResponse.status, 401);
    const naiModels = await post('/api/models', { profile: novelaiProfile });
    assert.ok(naiModels.catalog && naiModels.models.includes('nai-diffusion-5-full'));

    console.log('Smoke tests passed: all providers, NovelAI personal token/JSON/proxy, V3/V4.5/V5/Medium parameters, reference isolation, key check');
} finally {
    for (const child of children) child.kill();
}
