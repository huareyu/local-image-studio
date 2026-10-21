import { fetch } from 'undici';
import { KALOSCOPE_ENDPOINT, KALOSCOPE_MODELS, KALOSCOPE_SPACE, validArtistName, artistDanbooruUrl } from '../public/artist-tools.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
function error(status, message) { return Object.assign(new Error(message), { status }); }
function imageData(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 100) throw error(413, 'Картинка слишком большая (максимум 8 МБ после уменьшения)');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[2].length % 4) throw error(400, 'Нужна картинка PNG, JPEG или WebP');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : match[1] === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
            : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!valid || bytes.length > MAX_IMAGE_BYTES) throw error(400, 'Данные картинки не соответствуют её формату');
    return { bytes, mime: match[1], extension: match[1] === 'image/png' ? 'png' : match[1] === 'image/jpeg' ? 'jpg' : 'webp' };
}
async function limitedText(response, maxBytes = 128 * 1024) {
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > maxBytes) throw error(502, 'Kaloscope прислал слишком большой ответ');
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}
async function jsonReply(response) {
    const text = await limitedText(response);
    if (!response.ok) {
        const hint = response.status === 429 ? 'Сервис ограничил частоту запросов. Подожди немного.'
            : response.status === 401 || response.status === 403 ? 'Сервис отклонил доступ. Открой исходный Space и проверь его доступность.'
                : 'Space может спать, загружать модель или быть перегружен. Попробуй позже.';
        throw error(502, `Kaloscope: HTTP ${response.status}. ${hint}`);
    }
    try { return JSON.parse(text); } catch { throw error(502, 'Kaloscope вернул не JSON. Проверь доступность Space.'); }
}
export function normalizeArtistResult(data, topK) {
    if (!Array.isArray(data) || typeof data[2] !== 'string') throw error(502, 'Формат результата Kaloscope изменился');
    let scores;
    try { scores = JSON.parse(data[2]); } catch { throw error(502, 'Kaloscope вернул некорректный список художников'); }
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)) throw error(502, 'Нет списка художников в ответе Kaloscope');
    return Object.entries(scores).filter(([name, score]) => validArtistName(name) && typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1)
        .sort((a, b) => b[1] - a[1]).slice(0, topK)
        .map(([name, score]) => ({ name: name.trim(), score, url: artistDanbooruUrl(name.trim()) }));
}
export async function readArtistEvents(response) {
    if (!response.ok) return await jsonReply(response);
    if (!response.body) throw error(502, 'Kaloscope не открыл поток результата');
    let buffer = '', received = 0;
    const decoder = new TextDecoder();
    function event(block) {
        const lines = block.split(/\r?\n/);
        const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const value = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (type === 'error') {
            let details = '';
            try { const data = JSON.parse(value); details = typeof data === 'string' ? data : data?.message || data?.error || ''; } catch { /* Optional public error text. */ }
            throw error(502, `Kaloscope не смог обработать картинку. Модель может загружаться или сервис перегружен; попробуй позже.${typeof details === 'string' && details ? ` ${details.slice(0, 400)}` : ''}`);
        }
        if (type === 'complete') {
            try { return { value: JSON.parse(value) }; } catch { throw error(502, 'Не удалось прочитать результат Kaloscope'); }
        }
        return null;
    }
    for await (const chunk of response.body) {
        received += chunk.length;
        if (received > 2 * 1024 * 1024) throw error(502, 'Слишком большой поток ответа Kaloscope');
        buffer += decoder.decode(chunk, { stream: true });
        let separator;
        while ((separator = buffer.match(/\r?\n\r?\n/))) {
            const result = event(buffer.slice(0, separator.index)); buffer = buffer.slice(separator.index + separator[0].length);
            if (result) return result.value;
        }
    }
    buffer += decoder.decode();
    const last = buffer.trim() ? event(buffer) : null;
    if (last) return last.value;
    throw error(502, 'Соединение Kaloscope закрылось без результата. Попробуй ещё раз.');
}

export async function classifyArtistImage(body, { fetchImpl = fetch, endpoint = KALOSCOPE_ENDPOINT, signal, dispatcher } = {}) {
    if (body?.consent !== true) throw error(400, 'Подтверди отправку картинки во внешний сервис Kaloscope / Hugging Face');
    const model = body.model || KALOSCOPE_MODELS[0], topK = Number(body.topK ?? 5);
    if (!KALOSCOPE_MODELS.includes(model)) throw error(400, 'Неизвестная модель Kaloscope');
    if (!Number.isInteger(topK) || topK < 1 || topK > 25) throw error(400, 'Выбери от 1 до 25 художников');
    const image = imageData(body.dataUrl);
    const base = endpoint.replace(/\/+$/, '');
    const request = (route, options = {}) => fetchImpl(`${base}/gradio_api${route}`, { ...options, signal, dispatcher, redirect: 'error' });
    const form = new FormData();
    // Fixed filename and raster bytes only; do not send the local filename, metadata, API keys or prompt.
    form.append('files', new Blob([image.bytes], { type: image.mime }), `reference.${image.extension}`);
    const uploaded = await jsonReply(await request('/upload', { method: 'POST', body: form }));
    if (!Array.isArray(uploaded) || typeof uploaded[0] !== 'string' || !uploaded[0] || uploaded[0].length > 2048) throw error(502, 'Kaloscope не подтвердил загрузку картинки');
    const submitted = await jsonReply(await request('/call/predict', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ path: uploaded[0], meta: { _type: 'gradio.FileData' } }, model, topK, 0] }),
    }));
    if (typeof submitted?.event_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(submitted.event_id)) throw error(502, 'Kaloscope не вернул ID анализа');
    const data = await readArtistEvents(await request(`/call/predict/${submitted.event_id}`));
    return { artists: normalizeArtistResult(data, topK), model, topK, threshold: 0, source: KALOSCOPE_SPACE };
}
