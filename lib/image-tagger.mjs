import { analysisError, rasterData, callImageAnalysis } from './gradio.mjs';
import { TAGGER_SERVICES, WD_TAGGER_MODELS, validImageTag, normalizeImageTag } from '../public/image-tagger-tools.js';

function threshold(value, fallback) {
    const number = value == null ? fallback : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1) throw analysisError(400, 'Порог уверенности должен быть числом от 0 до 1');
    return number;
}
// Empty gr.Label results are {}, even though the published schema describes confidences.
function labelRows(value, group) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw analysisError(502, 'Формат результата теггера изменился: нет оценок тегов');
    if (!Object.keys(value).length) return [];
    if (!Array.isArray(value.confidences)) throw analysisError(502, 'Формат результата теггера изменился: нет оценок тегов');
    return value.confidences.filter(item => item && validImageTag(item.label) && typeof item.confidence === 'number'
        && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1)
        .map(item => ({ name: normalizeImageTag(item.label), score: item.confidence, group }));
}
export function normalizeTaggerResult(data, service, generalThreshold, characterThreshold) {
    if (!Array.isArray(data)) throw analysisError(502, 'Формат результата теггера изменился');
    if (service === 'pixai' && typeof data[1] === 'string' && /^Error:/i.test(data[1])) throw analysisError(502, 'PixAI не смог обработать картинку. Попробуй позже или выбери WD Tagger.');
    const general = labelRows(data[service === 'pixai' ? 4 : 3], 'general').filter(row => row.score >= generalThreshold);
    const characters = labelRows(data[service === 'pixai' ? 3 : 2], 'character').filter(row => row.score >= characterThreshold);
    const unique = new Map();
    for (const row of [...general, ...characters].sort((a, b) => b.score - a.score)) {
        if (!unique.has(row.name)) unique.set(row.name, row);
    }
    // Ignore remote Markdown, free text, copyright guesses and rating labels entirely.
    return [...unique.values()].slice(0, 500);
}
export async function tagImage(body, { endpoint, signal, dispatcher, fetchImpl } = {}) {
    if (body?.consent !== true) throw analysisError(400, 'Подтверди отправку этой картинки в выбранный теггер / Hugging Face');
    const service = body.service ?? 'wd';
    if (!Object.hasOwn(TAGGER_SERVICES, service)) throw analysisError(400, 'Неизвестный теггер');
    const config = TAGGER_SERVICES[service];
    const model = service === 'wd' ? body.model ?? WD_TAGGER_MODELS[0] : 'pixai-tagger-v0.9';
    if (service === 'wd' && !WD_TAGGER_MODELS.includes(model)) throw analysisError(400, 'Неизвестная модель WD Tagger');
    const generalThreshold = threshold(body.generalThreshold, config.generalThreshold);
    const characterThreshold = threshold(body.characterThreshold, config.characterThreshold);
    const image = rasterData(body.dataUrl);
    const data = await callImageAnalysis({ image, endpoint: endpoint || config.endpoint, service: config.name,
        apiName: service === 'pixai' ? 'run_inference' : 'predict',
        inputs: service === 'pixai' ? [generalThreshold, characterThreshold, false, true]
            : [model, generalThreshold, false, characterThreshold, false], signal, dispatcher, fetchImpl });
    return { tags: normalizeTaggerResult(data, service, generalThreshold, characterThreshold), service, model,
        generalThreshold, characterThreshold, source: config.space };
}
