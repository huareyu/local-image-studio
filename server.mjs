import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fetch, ProxyAgent } from 'undici';
import { NOVELAI_ENDPOINT, NOVELAI_MODELS, buildNovelaiRequest } from './public/novelai.js';
import { decodeNovelaiResult } from './lib/novelai-result.mjs';
import { createImageArchive } from './lib/image-archive.mjs';
import { classifyArtistImage } from './lib/artist-classifier.mjs';
import { tagImage } from './lib/image-tagger.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const imageArchive = createImageArchive(process.env.IMAGE_STUDIO_IMAGES_DIR || path.join(ROOT, 'generated-images'));
const PORT = Number(process.env.PORT || 3210);
const MAX_BODY_BYTES = 90 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const proxyAgents = new Map();

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
};

class HttpError extends Error {
    constructor(status, message, details = '') {
        super(message);
        this.status = status;
        this.details = details;
    }
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

async function readJson(req, maxBytes = MAX_BODY_BYTES) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) throw new HttpError(413, 'Запрос слишком большой');
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new HttpError(400, 'Некорректный JSON');
    }
}

function cleanEndpoint(value, fallback) {
    return String(value || fallback || '').trim().replace(/\/+$/, '');
}

function appendPath(endpoint, suffix, rawEndpoint = false) {
    if (rawEndpoint) return endpoint;
    if (!endpoint) return suffix;
    const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
    if (endpoint.toLowerCase().endsWith(normalizedSuffix.toLowerCase())) return endpoint;
    for (const apiRoot of ['/v1beta', '/v1']) {
        if (endpoint.toLowerCase().endsWith(apiRoot) && normalizedSuffix.toLowerCase().startsWith(`${apiRoot}/`)) {
            return `${endpoint}${normalizedSuffix.slice(apiRoot.length)}`;
        }
    }
    return `${endpoint}${normalizedSuffix}`;
}

function dataUrlParts(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
    if (!match) throw new HttpError(400, 'Один из референсов имеет неверный формат');
    return { mimeType: match[1] || 'image/png', base64: match[2] };
}

function refPromptBlock(references) {
    if (!references.length) return '';
    const lines = references.map((ref, index) => {
        const label = String(ref.label || '').trim();
        const description = String(ref.description || '').trim();
        return `Image ${index + 1}${label ? ` is ${label}` : ''}${description ? ` — ${description}` : ''}.`;
    });
    return [
        'Use the attached reference images faithfully. Preserve identities, appearance, clothing and important visual details.',
        ...lines,
    ].join('\n');
}

function buildPrompt(body) {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new HttpError(400, 'Введите промпт');
    const prefix = String(body.prefix || '').trim();
    const negative = String(body.negativePrompt || '').trim();
    const refs = Array.isArray(body.references) ? body.references : [];
    const sections = [refPromptBlock(refs), prefix, prompt];
    if (negative) sections.push(`Avoid: ${negative}`);
    return sections.filter(Boolean).join('\n\n');
}

function authHeaders(profile) {
    const key = String(profile.apiKey || '').trim();
    return key ? { Authorization: `Bearer ${key}` } : {};
}

function safeUrlForLog(value) {
    try {
        const url = new URL(value);
        if (url.username) url.username = '***';
        if (url.password) url.password = '***';
        for (const key of ['key', 'api_key', 'token', 'access_token']) {
            if (url.searchParams.has(key)) url.searchParams.set(key, '***');
        }
        return url.toString();
    } catch {
        return String(value || '');
    }
}

function proxyDispatcher(profile = {}) {
    if (!profile.proxyEnabled) return undefined;
    const rawUrl = String(profile.proxyUrl || '').trim();
    if (!rawUrl) throw new HttpError(400, 'Прокси включён, но его адрес не указан');
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new HttpError(400, 'Некорректный адрес прокси', 'Используйте адрес вида http://127.0.0.1:8080');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new HttpError(400, 'Неподдерживаемый тип прокси', 'Поддерживаются HTTP- и HTTPS-прокси.');
    }
    const embeddedUsername = decodeURIComponent(url.username || '');
    const embeddedPassword = decodeURIComponent(url.password || '');
    const username = String(profile.proxyUsername || embeddedUsername).trim();
    const password = String(profile.proxyPassword || embeddedPassword);
    url.username = '';
    url.password = '';
    const token = username || password
        ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
        : undefined;
    const key = `${url.toString()}\n${token || ''}`;
    if (!proxyAgents.has(key)) proxyAgents.set(key, new ProxyAgent({ uri: url.toString(), token }));
    return proxyAgents.get(key);
}

function describeConnectionError(error, url) {
    const causes = Array.isArray(error?.cause?.errors)
        ? error.cause.errors
        : [error?.cause || error].filter(Boolean);
    const codes = [...new Set(causes.map(item => item?.code).filter(Boolean))];
    const messages = [...new Set(causes.map(item => item?.message).filter(Boolean))].slice(0, 3);
    const hint = codes.includes('EACCES')
        ? 'Windows запретила исходящее соединение этому процессу. Перезапустите приложение через start-local.bat и проверьте разрешение Node.js в брандмауэре.'
        : codes.some(code => ['ENOTFOUND', 'EAI_AGAIN'].includes(code))
            ? 'Не удалось разрешить домен. Проверьте адрес endpoint, DNS или VPN.'
            : codes.some(code => ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code))
                ? 'Сервер недоступен или отклонил соединение. Проверьте endpoint, прокси/VPN и доступность API.'
                : 'Проверьте endpoint, интернет/VPN, сертификат API и разрешение Node.js в брандмауэре.';
    return [
        `URL: ${safeUrlForLog(url)}`,
        codes.length ? `Код: ${codes.join(', ')}` : '',
        messages.length ? `Причина: ${messages.join(' | ')}` : '',
        hint,
    ].filter(Boolean).join('\n');
}

async function fetchWithTimeout(url, options = {}, incomingRequest = null, profile = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), REQUEST_TIMEOUT_MS);
    const abortFromClient = () => controller.abort(new Error('Client disconnected'));
    incomingRequest?.once('aborted', abortFromClient);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            dispatcher: proxyDispatcher(profile),
        });
    } catch (error) {
        if (error instanceof HttpError) throw error;
        if (controller.signal.aborted) {
            const reason = controller.signal.reason?.message || 'Запрос отменён';
            throw new HttpError(499, reason, `URL: ${safeUrlForLog(url)}`);
        }
        throw new HttpError(502, 'Не удалось подключиться к API', describeConnectionError(error, url));
    } finally {
        clearTimeout(timeout);
        incomingRequest?.off('aborted', abortFromClient);
    }
}

async function parseRemoteError(response) {
    const text = await response.text().catch(() => '');
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* text response */ }
    const source = payload?.error;
    const message = typeof source === 'string'
        ? source
        : source?.message || payload?.message || payload?.detail || text || `HTTP ${response.status}`;
    return String(message).slice(0, 1800);
}

async function remoteImageToDataUrl(url, req, profile) {
    const response = await fetchWithTimeout(url, {}, req, profile);
    if (!response.ok) throw new HttpError(502, 'Не удалось скачать результат', await parseRemoteError(response));
    const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png';
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${mime};base64,${bytes.toString('base64')}`;
}

function extractOpenAiImage(result) {
    const item = result?.data?.[0] || result?.output?.[0] || null;
    const b64 = item?.b64_json || item?.b64 || item?.image_base64;
    if (b64) return { dataUrl: `data:image/png;base64,${b64}` };
    const url = item?.url || item?.image_url;
    if (url) return { url };
    throw new HttpError(502, 'API не вернул изображение');
}

async function generateOpenAi(body, req) {
    const profile = body.profile || {};
    const references = Array.isArray(body.references) ? body.references : [];
    const endpoint = cleanEndpoint(profile.endpoint, 'https://api.openai.com');
    const fullPrompt = buildPrompt(body);
    const model = String(profile.model || '').trim();
    if (!model) throw new HttpError(400, 'В профиле не выбрана модель');

    let response;
    if (references.length > 0) {
        const url = appendPath(endpoint, '/v1/images/edits', profile.rawEndpoint);
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', fullPrompt);
        form.append('n', '1');
        if (body.size) form.append('size', String(body.size));
        if (body.quality) form.append('quality', String(body.quality));
        references.forEach((reference, index) => {
            const { mimeType, base64 } = dataUrlParts(reference.dataUrl);
            const blob = new Blob([Buffer.from(base64, 'base64')], { type: mimeType });
            const field = references.length > 1 ? 'image[]' : 'image';
            form.append(field, blob, `reference-${index}.${mimeType.split('/')[1] || 'png'}`);
        });
        response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: authHeaders(profile),
            body: form,
        }, req, profile);
    } else {
        const url = appendPath(endpoint, '/v1/images/generations', profile.rawEndpoint);
        const payload = { model, prompt: fullPrompt, n: 1 };
        if (body.size) payload.size = body.size;
        if (body.quality) payload.quality = body.quality;
        if (!/^gpt-image/i.test(model)) payload.response_format = 'b64_json';
        response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { ...authHeaders(profile), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }, req, profile);
    }

    if (!response.ok) throw new HttpError(response.status, 'Ошибка API генерации', await parseRemoteError(response));
    const result = extractOpenAiImage(await response.json());
    const dataUrl = result.dataUrl || await remoteImageToDataUrl(result.url, req, profile);
    return { dataUrl, provider: 'openai', model };
}

function geminiHeaders(profile, endpoint) {
    const key = String(profile.apiKey || '').trim();
    if (/googleapis\.com/i.test(endpoint)) {
        return { 'Content-Type': 'application/json', 'x-goog-api-key': key };
    }
    return { ...authHeaders(profile), 'Content-Type': 'application/json' };
}

function extractGeminiImage(result) {
    for (const candidate of result?.candidates || []) {
        for (const part of candidate?.content?.parts || []) {
            const inline = part.inlineData || part.inline_data;
            if (inline?.data) {
                return `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`;
            }
        }
    }
    throw new HttpError(502, 'Gemini не вернул изображение');
}

async function generateGemini(body, req) {
    const profile = body.profile || {};
    const references = Array.isArray(body.references) ? body.references : [];
    const endpoint = cleanEndpoint(profile.endpoint, 'https://generativelanguage.googleapis.com');
    const model = String(profile.model || '').trim();
    if (!model) throw new HttpError(400, 'В профиле не выбрана модель');
    const pathModel = model.split('/').map(encodeURIComponent).join('/');
    const url = profile.rawEndpoint
        ? endpoint
        : appendPath(endpoint, `/v1beta/models/${pathModel}:generateContent`);
    const parts = references.map((reference) => {
        const { mimeType, base64 } = dataUrlParts(reference.dataUrl);
        return { inlineData: { mimeType, data: base64 } };
    });
    parts.push({ text: buildPrompt(body) });
    const imageConfig = {};
    if (body.aspectRatio) imageConfig.aspectRatio = body.aspectRatio;
    if (body.imageSize) imageConfig.imageSize = body.imageSize;
    const payload = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
        },
    };
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: geminiHeaders(profile, endpoint),
        body: JSON.stringify(payload),
    }, req, profile);
    if (!response.ok) throw new HttpError(response.status, 'Ошибка Gemini API', await parseRemoteError(response));
    return { dataUrl: extractGeminiImage(await response.json()), provider: 'gemini', model };
}

function extractOpenRouterImage(result) {
    const message = result?.choices?.[0]?.message;
    const imageUrl = message?.images?.[0]?.image_url?.url
        || message?.images?.[0]?.url;
    if (imageUrl) return imageUrl;
    for (const part of Array.isArray(message?.content) ? message.content : []) {
        const value = part?.image_url?.url || part?.image_url || part?.url;
        if (typeof value === 'string' && value.startsWith('data:image/')) return value;
    }
    throw new HttpError(502, 'OpenRouter не вернул изображение');
}

async function generateOpenRouter(body, req) {
    const profile = body.profile || {};
    const references = Array.isArray(body.references) ? body.references : [];
    const endpoint = cleanEndpoint(profile.endpoint, 'https://openrouter.ai/api/v1');
    const model = String(profile.model || '').trim();
    if (!model) throw new HttpError(400, 'В профиле не выбрана модель');
    const url = appendPath(endpoint, '/chat/completions', profile.rawEndpoint);
    const content = [{ type: 'text', text: buildPrompt(body) }];
    for (const reference of references) {
        content.push({ type: 'image_url', image_url: { url: reference.dataUrl } });
    }
    const payload = {
        model,
        messages: [{ role: 'user', content: references.length ? content : content[0].text }],
        modalities: ['image', 'text'],
    };
    const imageConfig = {};
    if (body.aspectRatio) imageConfig.aspect_ratio = body.aspectRatio;
    if (body.imageSize) imageConfig.image_size = body.imageSize;
    if (Object.keys(imageConfig).length) payload.image_config = imageConfig;
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            ...authHeaders(profile),
            'Content-Type': 'application/json',
            'HTTP-Referer': `http://127.0.0.1:${PORT}`,
            'X-Title': 'Local Image Studio',
        },
        body: JSON.stringify(payload),
    }, req, profile);
    if (!response.ok) throw new HttpError(response.status, 'Ошибка OpenRouter API', await parseRemoteError(response));
    const image = extractOpenRouterImage(await response.json());
    return {
        dataUrl: image.startsWith('data:') ? image : await remoteImageToDataUrl(image, req, profile),
        provider: 'openrouter',
        model,
    };
}

function novelaiProfile(profile = {}) {
    const apiKey = String(profile.apiKey || '').trim().replace(/^Bearer\s+/i, '');
    if (!apiKey) throw new HttpError(400, 'Вставьте свой Persistent API Token NovelAI в поле API-ключа');
    return { ...profile, apiKey };
}

async function generateNovelai(body, req) {
    const profile = novelaiProfile(body.profile);
    if (!String(body.prompt || '').trim()) throw new HttpError(400, 'Введите промпт');
    if (!String(profile.model || '').trim()) throw new HttpError(400, 'В профиле не выбрана модель');
    const payload = buildNovelaiRequest({ ...body, profile });
    for (const image of payload.parameters.director_reference_images || []) {
        if (!image || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new HttpError(400, 'Некорректный референс NovelAI');
    }
    const endpoint = cleanEndpoint(profile.endpoint, NOVELAI_ENDPOINT);
    const url = appendPath(endpoint, '/ai/generate-image', profile.rawEndpoint);
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { ...authHeaders(profile), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
    }, req, profile);
    if (!response.ok) {
        const reason = await parseRemoteError(response);
        const hint = response.status === 401 ? 'Проверьте Persistent API Token'
            : response.status === 402 ? 'Недостаточно Anlas'
                : response.status === 429 ? 'Лимит запросов: попробуйте позже' : 'Ошибка генерации NovelAI';
        throw new HttpError(response.status, `${hint} (HTTP ${response.status})`, reason);
    }
    let result;
    try { result = decodeNovelaiResult(Buffer.from(await response.arrayBuffer())); }
    catch (error) { throw new HttpError(502, error.message); }
    return {
        ...result, provider: 'novelai', model: payload.model,
        seed: result.seed ?? payload.parameters.seed,
        width: payload.parameters.width, height: payload.parameters.height,
        referenceCount: payload.parameters.director_reference_images?.length || 0,
        negativePrompt: payload.parameters.negative_prompt || '',
    };
}

async function handleNovelaiStatus(req, res) {
    const body = await readJson(req);
    const profile = novelaiProfile(body.profile);
    if (profile.rawEndpoint) throw new HttpError(400, 'Для проверки ключа укажите базовый endpoint, а не полный путь генерации');
    const endpoint = cleanEndpoint(profile.endpoint, NOVELAI_ENDPOINT);
    const response = await fetchWithTimeout(appendPath(endpoint, '/user/subscription'), {
        headers: authHeaders(profile),
    }, req, profile);
    if (!response.ok) throw new HttpError(response.status, 'Не удалось проверить ключ NovelAI', await parseRemoteError(response));
    const subscription = await response.json();
    sendJson(res, 200, {
        active: subscription.active, tier: subscription.tier,
        anlas: subscription.trainingStepsLeft,
    });
}

async function handleGenerate(req, res) {
    requireLocalImageAction(req);
    const body = await readJson(req);
    const provider = String(body?.profile?.provider || 'openai');
    let result;
    if (provider === 'gemini') result = await generateGemini(body, req);
    else if (provider === 'openrouter') result = await generateOpenRouter(body, req);
    else if (provider === 'novelai') result = await generateNovelai(body, req);
    else result = await generateOpenAi(body, req);
    result.id = randomUUID();
    result.createdAt = Date.now();
    try {
        result.archive = await imageArchive.save(result);
    } catch (error) {
        // A disk problem must not discard an already-paid generation.
        result.archiveError = `Не удалось сохранить файл: ${error.message}`;
    }
    sendJson(res, 200, result);
}

function requireLocalImageAction(req) {
    let host;
    try { host = new URL(`http://${req.headers.host}`); } catch { throw new HttpError(403, 'Недопустимый адрес'); }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)
        || (req.headers.origin && req.headers.origin !== host.origin)
        || req.headers['sec-fetch-site'] === 'cross-site') {
        throw new HttpError(403, 'Действие доступно только из локального Image Studio');
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        throw new HttpError(415, 'Требуется application/json');
    }
}

async function handleArchiveImage(req, res) {
    requireLocalImageAction(req);
    const entry = await readJson(req);
    try { sendJson(res, 200, await imageArchive.save(entry)); }
    catch (error) { throw new HttpError(400, error.message); }
}

async function handleArtistClassification(req, res) {
    requireLocalImageAction(req);
    const body = await readJson(req, 12 * 1024 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Нужен объект с параметрами анализа');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Kaloscope timeout')), 180000);
    const closed = () => { if (!res.writableEnded) controller.abort(new Error('Client disconnected')); };
    res.once('close', closed);
    try {
        const proxy = body.proxy || {};
        const result = await classifyArtistImage(body, { signal: controller.signal,
            endpoint: process.env.IMAGE_STUDIO_KALOSCOPE_ENDPOINT || undefined,
            dispatcher: proxyDispatcher({ proxyEnabled: proxy.proxyEnabled === true, proxyUrl: proxy.proxyUrl,
                proxyUsername: proxy.proxyUsername, proxyPassword: proxy.proxyPassword }) });
        if (!res.destroyed) sendJson(res, 200, result);
    } catch (error) {
        if (res.destroyed) return;
        if (controller.signal.aborted) throw new HttpError(504, 'Не дождались ответа Kaloscope. Space может загружать модель или стоять в очереди.');
        if (error.status) throw error;
        throw new HttpError(502, 'Не удалось подключиться к Kaloscope. Проверь интернет, VPN или прокси.');
    } finally { clearTimeout(timeout); res.off('close', closed); }
}

async function handleOpenImageFolder(req, res) {
    requireLocalImageAction(req);
    try { sendJson(res, 200, await imageArchive.open()); }
    catch (error) { throw new HttpError(500, 'Не удалось открыть папку изображений', `${imageArchive.folderPath}\n${error.message}`); }
}

async function handleImageTagging(req, res) {
    requireLocalImageAction(req);
    const body = await readJson(req, 12 * 1024 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Нужен объект с параметрами анализа');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Tagger timeout')), 180000);
    const closed = () => { if (!res.writableEnded) controller.abort(new Error('Client disconnected')); };
    res.once('close', closed);
    try {
        const proxy = body.proxy || {};
        const result = await tagImage(body, { signal: controller.signal,
            endpoint: body.service === 'pixai' ? process.env.IMAGE_STUDIO_PIXAI_ENDPOINT : process.env.IMAGE_STUDIO_WD_ENDPOINT,
            dispatcher: proxyDispatcher({ proxyEnabled: proxy.proxyEnabled === true, proxyUrl: proxy.proxyUrl,
                proxyUsername: proxy.proxyUsername, proxyPassword: proxy.proxyPassword }) });
        if (!res.destroyed) sendJson(res, 200, result);
    } catch (error) {
        if (res.destroyed) return;
        if (controller.signal.aborted) throw new HttpError(504, 'Не дождались ответа теггера. Space может загружать модель или стоять в очереди.');
        if (error.status) throw error;
        throw new HttpError(502, 'Не удалось подключиться к теггеру. Проверь интернет, VPN или прокси.');
    } finally { clearTimeout(timeout); res.off('close', closed); }
}

async function handleModels(req, res) {
    const body = await readJson(req);
    const profile = body.profile || {};
    if (profile.provider === 'novelai') return sendJson(res, 200, { models: NOVELAI_MODELS, catalog: true });
    if (profile.rawEndpoint) throw new HttpError(400, 'Для полного endpoint список моделей недоступен');
    const provider = String(profile.provider || 'openai');
    const endpoint = cleanEndpoint(profile.endpoint,
        provider === 'gemini' ? 'https://generativelanguage.googleapis.com'
            : provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
                : 'https://api.openai.com');
    let url;
    let headers;
    if (provider === 'gemini') {
        url = appendPath(endpoint, '/v1beta/models');
        headers = geminiHeaders(profile, endpoint);
    } else {
        url = appendPath(endpoint, '/models');
        headers = authHeaders(profile);
    }
    const response = await fetchWithTimeout(url, { headers }, req, profile);
    if (!response.ok) throw new HttpError(response.status, 'Не удалось получить модели', await parseRemoteError(response));
    const result = await response.json();
    const values = provider === 'gemini'
        ? (result.models || []).map(item => String(item.name || '').replace(/^models\//, ''))
        : (result.data || result.models || []).map(item => typeof item === 'string' ? item : item.id || item.name).filter(Boolean);
    sendJson(res, 200, { models: [...new Set(values)].sort() });
}

async function serveStatic(req, res) {
    const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, relative);
    if (!filePath.startsWith(`${path.resolve(PUBLIC_DIR)}${path.sep}`) && filePath !== path.resolve(PUBLIC_DIR, 'index.html')) {
        throw new HttpError(403, 'Forbidden');
    }
    try {
        const data = await fs.readFile(filePath);
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    } catch (error) {
        if (error.code === 'ENOENT') throw new HttpError(404, 'Not found');
        throw error;
    }
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'POST' && req.url === '/api/generate') return await handleGenerate(req, res);
        if (req.method === 'POST' && req.url === '/api/models') return await handleModels(req, res);
        if (req.method === 'POST' && req.url === '/api/novelai/status') return await handleNovelaiStatus(req, res);
        if (req.method === 'POST' && req.url === '/api/images/archive') return await handleArchiveImage(req, res);
        if (req.method === 'POST' && req.url === '/api/images/open-folder') return await handleOpenImageFolder(req, res);
        if (req.method === 'POST' && req.url === '/api/artists/classify') return await handleArtistClassification(req, res);
        if (req.method === 'POST' && req.url === '/api/images/tag') return await handleImageTagging(req, res);
        if (req.method === 'GET') return await serveStatic(req, res);
        throw new HttpError(405, 'Method not allowed');
    } catch (error) {
        const status = Number(error.status) || 500;
        console.error('[image-studio]', error);
        sendJson(res, status, {
            error: error.message || 'Внутренняя ошибка',
            details: error.details || '',
        });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Local Image Studio: http://127.0.0.1:${PORT}`);
});
