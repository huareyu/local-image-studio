import { TAGGER_SERVICES, WD_TAGGER_MODELS, validImageTag, imageTagPrompt } from './image-tagger-tools.js';
import { prepareAnalysisImage } from './analysis-image.js';

const SETTINGS_KEY = 'image-studio.image-tagger.v1';
const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text != null) node.textContent = text;
    return node;
};
export function createImageTagger({ getResult, getProxy, useTags }) {
    const ui = Object.fromEntries(['page', 'upload', 'drop', 'preview', 'empty', 'caption', 'current', 'clear', 'service',
        'model', 'model-field', 'service-link', 'general', 'general-value', 'character', 'character-value', 'consent', 'proxy',
        'run', 'cancel', 'status', 'empty-results', 'result-box', 'general-tags', 'character-tags', 'character-box', 'selection',
        'select-all', 'select-none', 'format', 'tags', 'copy', 'use', 'use-prefix']
        .map(id => [id, document.getElementById(`tagger-${id}`)]));
    const studio = document.getElementById('studio-workspace'), nav = document.getElementById('nav-tagger');
    let prepared = null, rows = [], selected = new Set(), controller = null, uploadSerial = 0, runSerial = 0, busy = false;
    let settings;
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { settings = {}; }
    if (!settings || typeof settings !== 'object') settings = {};
    const storedThreshold = (value, fallback) => typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback;
    const preferences = Object.fromEntries(Object.entries(TAGGER_SERVICES).map(([id, config]) => [id, {
        general: storedThreshold(settings[id]?.general, config.generalThreshold), character: storedThreshold(settings[id]?.character, config.characterThreshold),
    }]));
    for (const model of WD_TAGGER_MODELS) ui.model.add(new Option(model.replace('SmilingWolf/', ''), model));
    ui.model.value = WD_TAGGER_MODELS.includes(settings.model) ? settings.model : WD_TAGGER_MODELS[0];
    ui.service.value = Object.hasOwn(TAGGER_SERVICES, settings.service) ? settings.service : 'wd';
    ui.format.value = settings.format === 'spaces' ? 'spaces' : 'underscores';
    function persist() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...preferences, service: ui.service.value, model: ui.model.value, format: ui.format.value })); }
        catch { /* Only preferences persist, never images, consent or analysis results. */ }
    }
    function message(text, kind = '') { ui.status.textContent = text; ui.status.dataset.kind = kind; }
    function outputControls() {
        const empty = !ui.tags.value.trim();
        for (const field of [ui.copy, ui.use, ui['use-prefix']]) field.disabled = empty;
    }
    function controls() {
        ui.run.disabled = busy || !prepared || !ui.consent.checked;
        ui.cancel.classList.toggle('hidden', !busy);
        ui.run.textContent = busy ? 'Разбираю картинку…' : '✦ Разобрать на теги';
        ui.current.disabled = busy || !getResult()?.dataUrl;
        for (const field of [ui.upload, ui.drop, ui.service, ui.model, ui.general, ui.character, ui.consent, ui.proxy]) field.disabled = busy;
        ui.page.setAttribute('aria-busy', String(busy));
        outputControls();
    }
    function showStudio() {
        ui.page.classList.add('hidden'); studio.classList.remove('hidden'); nav.setAttribute('aria-pressed', 'false');
    }
    function showTagger() {
        studio.classList.add('hidden'); document.getElementById('artist-page').classList.add('hidden');
        document.getElementById('nav-artists').setAttribute('aria-pressed', 'false');
        ui.page.classList.remove('hidden'); nav.setAttribute('aria-pressed', 'true'); controls();
        history.replaceState(null, '', '#image-to-prompt'); window.scrollTo({ top: 0, behavior: 'instant' });
    }
    nav.addEventListener('click', showTagger);
    for (const id of ['nav-studio', 'nav-gallery']) document.getElementById(id).addEventListener('click', showStudio);
    function updateService() {
        const service = ui.service.value, config = TAGGER_SERVICES[service];
        ui['model-field'].classList.toggle('hidden', service !== 'wd');
        ui['service-link'].href = config.space; ui['service-link'].textContent = `Открыть ${config.name} ↗`;
        ui.general.value = preferences[service].general; ui.character.value = preferences[service].character;
        ui['general-value'].textContent = ui.general.value; ui['character-value'].textContent = ui.character.value;
    }
    function renderTags() {
        ui.tags.value = imageTagPrompt(rows.filter(row => selected.has(row.name)).map(row => row.name), ui.format.value);
        ui.selection.textContent = `Выбрано: ${selected.size} из ${rows.length}`;
        for (const chip of ui.page.querySelectorAll('.tagger-chip')) chip.setAttribute('aria-pressed', String(selected.has(chip.dataset.tag)));
        outputControls();
    }
    function clearResults() {
        rows = []; selected.clear(); ui['general-tags'].replaceChildren(); ui['character-tags'].replaceChildren();
        ui['result-box'].classList.add('hidden'); ui['empty-results'].classList.remove('hidden'); renderTags();
    }
    function resetImage() {
        prepared = null; ui.consent.checked = false; ui.caption.textContent = ''; clearResults();
        ui.preview.removeAttribute('src'); ui.preview.classList.add('hidden'); ui.empty.classList.remove('hidden');
    }
    async function setImage(source, label) {
        const serial = ++uploadSerial;
        controller?.abort(); controller = null; runSerial++; busy = false;
        resetImage(); controls(); message('Подготавливаю картинку локально…');
        try {
            const result = await prepareAnalysisImage(source);
            if (serial !== uploadSerial) return;
            prepared = result.dataUrl; ui.preview.src = prepared; ui.preview.classList.remove('hidden'); ui.empty.classList.add('hidden');
            ui.caption.textContent = `${label} · ${result.width}×${result.height}`;
            message('Превью готово. Выбери теггер, подтверди отправку и нажми «Разобрать на теги».');
        } catch (error) { if (serial === uploadSerial) message(`Не удалось открыть картинку: ${error.message}`, 'error'); }
        finally { if (serial === uploadSerial) controls(); }
    }
    ui.upload.addEventListener('change', () => { const file = ui.upload.files[0]; ui.upload.value = ''; if (file) setImage(file, file.name); });
    ui.drop.addEventListener('click', () => { if (!busy) ui.upload.click(); });
    for (const type of ['dragenter', 'dragover']) ui.drop.addEventListener(type, event => { event.preventDefault(); ui.drop.classList.add('dragging'); });
    for (const type of ['dragleave', 'drop']) ui.drop.addEventListener(type, event => { event.preventDefault(); ui.drop.classList.remove('dragging'); });
    ui.drop.addEventListener('drop', event => { const file = event.dataTransfer.files[0]; if (file && !busy) setImage(file, file.name); });
    window.addEventListener('paste', event => {
        if (ui.page.classList.contains('hidden')) return;
        const file = [...(event.clipboardData?.files || [])].find(file => file.type.startsWith('image/'));
        if (file) { event.preventDefault(); event.stopImmediatePropagation(); if (!busy) setImage(file, 'Из буфера обмена'); }
    });
    ui.current.addEventListener('click', () => { const result = getResult(); if (result?.dataUrl) setImage(result.dataUrl, 'Картинка с холста'); });
    ui.clear.addEventListener('click', () => {
        uploadSerial++; runSerial++; controller?.abort(); controller = null; busy = false;
        resetImage(); controls(); message('Картинка и результаты убраны из этой вкладки.');
    });
    ui.service.addEventListener('change', () => {
        // A different service needs a fresh consent; the image stays local until the next click.
        ui.consent.checked = false; clearResults(); updateService(); persist(); controls();
        message('Теггер изменён. Подтверди отправку картинки в выбранный сервис.');
    });
    ui.model.addEventListener('change', () => { clearResults(); persist(); });
    for (const name of ['general', 'character']) ui[name].addEventListener('input', () => {
        preferences[ui.service.value][name] = Number(ui[name].value); ui[`${name}-value`].textContent = ui[name].value; persist();
        if (rows.length) message('Порог изменён. Нажми «Разобрать на теги» для нового результата.');
    });
    ui.consent.addEventListener('change', controls);
    function renderResults() {
        ui['general-tags'].replaceChildren(); ui['character-tags'].replaceChildren();
        for (const row of rows) {
            const chip = element('button', `tagger-chip ${row.group === 'character' ? 'character' : ''}`);
            chip.type = 'button'; chip.dataset.tag = row.name; chip.setAttribute('aria-pressed', String(selected.has(row.name)));
            const percent = row.score.toLocaleString('ru-RU', { style: 'percent', maximumFractionDigits: 0 });
            chip.title = `${row.name} · уверенность модели ${percent}`;
            chip.append(element('span', '', row.name), element('small', '', percent));
            chip.addEventListener('click', () => { if (selected.has(row.name)) selected.delete(row.name); else selected.add(row.name); renderTags(); });
            ui[row.group === 'character' ? 'character-tags' : 'general-tags'].append(chip);
        }
        if (!rows.some(row => row.group === 'general')) ui['general-tags'].append(element('p', 'hint', 'Общих тегов при таком пороге не найдено.'));
        ui['character-box'].classList.toggle('hidden', !rows.some(row => row.group === 'character'));
        ui['result-box'].classList.remove('hidden'); ui['empty-results'].classList.add('hidden'); renderTags();
    }
    async function run() {
        if (busy || !prepared || !ui.consent.checked) return;
        let proxy;
        if (ui.proxy.checked) {
            proxy = getProxy();
            if (!proxy?.proxyEnabled || !proxy.proxyUrl?.trim()) return message('В активном подключении не настроен прокси. Настрой его в студии или выключи эту галочку.', 'error');
        }
        const serial = ++runSerial;
        controller = new AbortController(); const signal = controller.signal;
        busy = true; clearResults(); controls(); persist();
        message(`Отправляю картинку в ${TAGGER_SERVICES[ui.service.value].name}. Space может загружать модель или ждать очередь.`);
        try {
            const response = await fetch('/api/images/tag', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl: prepared, service: ui.service.value, model: ui.model.value,
                    generalThreshold: Number(ui.general.value), characterThreshold: Number(ui.character.value), consent: true,
                    ...(proxy ? { proxy } : {}) }) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
            if (serial !== runSerial) return;
            const seen = new Set();
            rows = (Array.isArray(data.tags) ? data.tags : []).filter(row => {
                if (!row || !validImageTag(row.name) || !['general', 'character'].includes(row.group)
                    || typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 1 || seen.has(row.name)) return false;
                seen.add(row.name); return true;
            }).slice(0, 500);
            selected = new Set(rows.filter(row => row.group === 'general').map(row => row.name)); renderResults();
            message(rows.length ? 'Готово. Нажимай на капсулки, чтобы убрать или вернуть теги. Персонажи не выбираются автоматически.'
                : 'При таком пороге тегов не найдено. Попробуй снизить порог или сменить модель.', 'success');
        } catch (error) {
            if (serial === runSerial) message(error.name === 'AbortError'
                ? 'Ожидание остановлено. Уже загруженная картинка и задача могут оставаться на стороне внешнего сервиса.'
                : error.message || 'Не удалось получить теги', error.name === 'AbortError' ? '' : 'error');
        } finally { if (serial === runSerial) { busy = false; controller = null; controls(); } }
    }
    ui.run.addEventListener('click', run); ui.cancel.addEventListener('click', () => controller?.abort());
    ui['select-all'].addEventListener('click', () => { selected = new Set(rows.map(row => row.name)); renderTags(); });
    ui['select-none'].addEventListener('click', () => { selected.clear(); renderTags(); });
    ui.format.addEventListener('change', () => { persist(); renderTags(); });
    ui.tags.addEventListener('input', outputControls);
    ui.copy.addEventListener('click', async () => {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(ui.tags.value);
            else { ui.tags.focus(); ui.tags.select(); if (!document.execCommand('copy')) throw new Error('Clipboard unavailable'); }
            message('Теги скопированы', 'success');
        } catch { message('Не удалось скопировать. Выдели текст в поле и скопируй вручную.', 'error'); }
    });
    for (const [field, target] of [[ui.use, 'prompt'], [ui['use-prefix'], 'prefix']]) field.addEventListener('click', () => {
        if (!ui.tags.value.trim()) return;
        showStudio(); history.replaceState(null, '', '#prompt-panel'); useTags(ui.tags.value.trim(), target);
    });
    updateService(); controls(); renderTags();
    if (location.hash === '#image-to-prompt') showTagger();
    return { get isActive() { return !ui.page.classList.contains('hidden'); }, refresh: controls };
}
