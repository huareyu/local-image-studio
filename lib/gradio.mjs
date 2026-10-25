// Small, bounded Gradio HTTP client for image analysis.
import { fetch } from 'undici';

export function analysisError(status, message) { return Object.assign(new Error(message), { status }); }
export function rasterData(dataUrl) {
    const maxBytes = 8 * 1024 * 1024;
    if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(maxBytes / 3) * 4 + 100) throw analysisError(413, 'Картинка слишком большая (максимум 8 МБ после уменьшения)');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[2].length % 4) throw analysisError(400, 'Нужна картинка PNG, JPEG или WebP');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : match[1] === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
            : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!valid || bytes.length > maxBytes) throw analysisError(400, 'Данные картинки не соответствуют её формату');
    return { bytes, mime: match[1], extension: match[1] === 'image/png' ? 'png' : match[1] === 'image/jpeg' ? 'jpg' : 'webp' };
}
async function jsonReply(response, service) {
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > 128 * 1024) throw analysisError(502, `${service} прислал слишком большой ответ`);
        chunks.push(Buffer.from(chunk));
    }
    if (!response.ok) {
        const hint = response.status === 429 ? 'Сервис ограничил частоту запросов. Подожди немного.'
            : response.status === 401 || response.status === 403 ? 'Сервис отклонил доступ. Открой исходный Space и проверь его доступность.'
                : 'Space может спать, загружать модель или быть перегружен. Попробуй позже.';
        throw analysisError(502, `${service}: HTTP ${response.status}. ${hint}`);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw analysisError(502, `${service} вернул не JSON. Проверь доступность Space.`); }
}
export async function readGradioEvents(response, service = 'Сервис анализа') {
    if (!response.ok) return await jsonReply(response, service);
    if (!response.body) throw analysisError(502, `${service} не открыл поток результата`);
    let buffer = '', received = 0;
    const decoder = new TextDecoder();
    function event(block) {
        const lines = block.split(/\r?\n/);
        const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const value = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (type === 'error') {
            let details = '';
            try { const data = JSON.parse(value); details = typeof data === 'string' ? data : data?.message || data?.error || ''; } catch { /* Optional public error. */ }
            throw analysisError(502, `${service} не смог обработать картинку. Модель может загружаться или сервис перегружен; попробуй позже.${typeof details === 'string' && details ? ` ${details.slice(0, 400)}` : ''}`);
        }
        if (type === 'complete') {
            try { return { value: JSON.parse(value) }; } catch { throw analysisError(502, `Не удалось прочитать результат ${service}`); }
        }
        return null;
    }
    for await (const chunk of response.body) {
        received += chunk.length;
        if (received > 2 * 1024 * 1024) throw analysisError(502, `Слишком большой поток ответа ${service}`);
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
    throw analysisError(502, `Соединение ${service} закрылось без результата. Попробуй ещё раз.`);
}
export async function callImageAnalysis({ image, endpoint, apiName, inputs, service, signal, dispatcher, fetchImpl = fetch }) {
    const base = endpoint.replace(/\/+$/, '');
    const request = (route, options = {}) => fetchImpl(`${base}/gradio_api${route}`, { ...options, signal, dispatcher, redirect: 'error' });
    const form = new FormData();
    // Never send a local filename, prompt, metadata, provider key or other reference images.
    form.append('files', new Blob([image.bytes], { type: image.mime }), `reference.${image.extension}`);
    const uploaded = await jsonReply(await request('/upload', { method: 'POST', body: form }), service);
    if (!Array.isArray(uploaded) || typeof uploaded[0] !== 'string' || !uploaded[0] || uploaded[0].length > 2048) throw analysisError(502, `${service} не подтвердил загрузку картинки`);
    const submitted = await jsonReply(await request(`/call/${apiName}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ path: uploaded[0], meta: { _type: 'gradio.FileData' } }, ...inputs] }),
    }), service);
    if (typeof submitted?.event_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(submitted.event_id)) throw analysisError(502, `${service} не вернул ID анализа`);
    return readGradioEvents(await request(`/call/${apiName}/${submitted.event_id}`), service);
}
