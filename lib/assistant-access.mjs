import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { NOVELAI_DEFAULTS } from '../public/novelai.js';

const error = (status, message) => Object.assign(new Error(message), { status });
const PROFILE_FIELDS = ['id', 'name', 'provider', 'endpoint', 'rawEndpoint', 'proxyEnabled', 'proxyUrl', 'proxyUsername',
    'proxyPassword', 'apiKey', 'model', 'aspectRatio', 'imageSize', 'size', 'quality', ...Object.keys(NOVELAI_DEFAULTS)];
const REQUEST_FIELDS = new Set(['prompt', 'prefix', 'negativePrompt', 'aspectRatio', 'imageSize', 'size', 'quality', 'references']);
const ASPECTS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
const IMAGE_SIZES = new Set(['1K', '2K', '4K']);

function snapshotProfile(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw error(400, 'Выбери профиль подключения');
    const profile = {};
    for (const key of PROFILE_FIELDS) {
        const value = input[key];
        if (value !== undefined && ['string', 'number', 'boolean'].includes(typeof value)) profile[key] = value;
    }
    if (!['gemini', 'openai', 'openrouter', 'novelai'].includes(profile.provider)) throw error(400, 'Неизвестный тип API');
    if (typeof profile.model !== 'string' || !profile.model.trim()) throw error(400, 'Сначала укажи модель в профиле');
    if (profile.name !== undefined && typeof profile.name !== 'string') throw error(400, 'Неверное название профиля');
    if (profile.apiKey !== undefined && typeof profile.apiKey !== 'string') throw error(400, 'Неверный формат ключа');
    if (profile.model.length > 300 || (profile.name || '').length > 300) throw error(400, 'Слишком длинное название профиля или модели');
    if (profile.endpoint) {
        let url;
        try { url = new URL(profile.endpoint); } catch { throw error(400, 'Проверь endpoint в профиле'); }
        if (!['http:', 'https:'].includes(url.protocol)) throw error(400, 'Endpoint должен использовать HTTP или HTTPS');
    }
    if (profile.provider === 'novelai' && !profile.apiKey?.trim()) throw error(400, 'Сначала укажи ключ NovelAI');
    // No browser draft, aliases/chunks, reference descriptions or other profiles enter the snapshot.
    profile.name = profile.name || 'Без названия';
    return profile;
}

export function assistantRequest(input, profile) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw error(400, 'Нужен объект с промптом');
    if (Object.keys(input).some(key => !REQUEST_FIELDS.has(key))) throw error(400, 'Помощник не может менять профиль, endpoint, ключ или модель');
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 30000) throw error(400, 'Нужен промпт от 1 до 30000 символов');
    for (const key of ['prefix', 'negativePrompt']) if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 15000)) throw error(400, 'Слишком длинный или неверный текст промпта');
    if (input.aspectRatio !== undefined && !ASPECTS.has(input.aspectRatio)) throw error(400, 'Неподдерживаемое соотношение сторон');
    if (input.imageSize !== undefined && !IMAGE_SIZES.has(input.imageSize)) throw error(400, 'Выбери разрешение 1K, 2K или 4K');
    if (input.size !== undefined && !/^(?:auto|\d{2,4}x\d{2,4})$/.test(input.size)) throw error(400, 'Неверный размер изображения');
    if (input.quality !== undefined && !['', 'auto', 'low', 'medium', 'high', 'standard', 'hd'].includes(input.quality)) throw error(400, 'Неверное качество изображения');
    const references = input.references ?? [];
    if (!Array.isArray(references) || references.length > 5) throw error(400, 'Можно передать до пяти референсов');
    if (profile.provider === 'novelai' && references.length) throw error(400, 'Референсы NovelAI используй через интерфейс студии: там выполняется подготовка размеров');
    let referenceBytes = 0;
    const safeReferences = references.map(ref => {
        const match = typeof ref?.dataUrl === 'string' && ref.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match || match[2].length % 4) throw error(400, 'Референс должен быть PNG, JPEG или WebP, а не URL или путь');
        referenceBytes += match[2].length;
        if (referenceBytes > 44 * 1024 * 1024) throw error(413, 'Референсы слишком большие');
        const bytes = Buffer.from(match[2], 'base64');
        const valid = match[1] === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
            : match[1] === 'image/jpeg' ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff'
                : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
        if (!valid) throw error(400, 'Данные референса не соответствуют формату');
        return { dataUrl: ref.dataUrl, label: typeof ref.label === 'string' ? ref.label.slice(0, 200) : '',
            description: typeof ref.description === 'string' ? ref.description.slice(0, 2000) : '' };
    });
    return { profile: { ...profile, ...(profile.provider === 'novelai' ? { novelaiEnableReferences: false,
        ...(input.negativePrompt !== undefined ? { novelaiNegativePrompt: input.negativePrompt } : {}) } : {}) },
        prompt: input.prompt.trim(), prefix: input.prefix || '', negativePrompt: input.negativePrompt || '', references: safeReferences,
        aspectRatio: input.aspectRatio ?? profile.aspectRatio, imageSize: input.imageSize ?? profile.imageSize,
        size: input.size ?? profile.size, quality: input.quality ?? profile.quality };
}

export function createAssistantAccess({ directory, origin, cliPath, now = Date.now, limit = 20 }) {
    let grant = null, active = null;
    const calls = [];
    let mutations = Promise.resolve();
    const connectionFile = path.join(directory, 'connection.json');
    const serialize = action => {
        const result = mutations.then(action); mutations = result.catch(() => {}); return result;
    };
    function trimCalls() { while (calls.length && calls[0] <= now() - 3600000) calls.shift(); }
    function status() {
        trimCalls();
        return { enabled: Boolean(grant), busy: Boolean(active), limitPerHour: limit, usedLastHour: calls.length, cliPath,
            ...(grant ? { profile: { id: grant.profile.id, name: grant.profile.name, provider: grant.profile.provider, model: grant.profile.model }, enabledAt: grant.enabledAt } : {}) };
    }
    function authenticate(authorization) {
        if (!grant) throw error(403, 'Доступ помощнику выключен. Включи его кнопкой в профиле студии');
        const token = typeof authorization === 'string' && authorization.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token || !timingSafeEqual(Buffer.from(token), Buffer.from(grant.token))) throw error(401, 'Нет доступа к студии. Разреши выбранный профиль заново');
        return grant;
    }
    return {
        status, authenticate,
        enable(input) { return serialize(async () => {
            if (input?.consent !== true) throw error(400, 'Подтверди разрешение использовать профиль');
            if (active) throw error(409, 'Дождись текущей генерации или отключи доступ, чтобы прервать ожидание');
            const profile = snapshotProfile(input.profile), token = randomBytes(32).toString('hex');
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
            // Only a local capability token is written; provider keys and proxy passwords stay in RAM.
            // Replacing the file changes the token; an already running server never trusts this file as a grant.
            const temporary = path.join(directory, `connection-${randomBytes(8).toString('hex')}.tmp`);
            try {
                await fs.writeFile(temporary, JSON.stringify({ version: 1, origin, token }), { mode: 0o600, flag: 'wx' });
                await fs.rename(temporary, connectionFile);
            } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
            grant = { profile, token, enabledAt: now() };
            return status();
        }); },
        revoke() { return serialize(async () => {
            grant = null; active?.abort(new Error('Assistant access revoked'));
            await fs.rm(connectionFile, { force: true });
            return status();
        }); },
        async generate(authorization, input, execute, signal) {
            await mutations;
            const approved = authenticate(authorization);
            const body = assistantRequest(input, approved.profile);
            if (active) throw error(409, 'Помощник уже генерирует картинку. Дождись результата');
            trimCalls();
            if (calls.length >= limit) throw error(429, `Лимит помощника: ${limit} запросов за час. Ошибочные попытки тоже учитываются`);
            if (signal?.aborted) throw error(499, 'Ожидание генерации прервано');
            const controller = new AbortController(); active = controller; calls.push(now());
            const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
            try { return await execute(body, combined); }
            finally { if (active === controller) active = null; }
        },
    };
}
