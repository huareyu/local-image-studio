import { KALOSCOPE_MODELS, validArtistName, artistDanbooruUrl, artistPromptTags } from './artist-tools.js';

const SETTINGS_KEY = 'image-studio.artist-classifier.v1';
const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text != null) node.textContent = text;
    return node;
};

async function prepareImage(source) {
    if (typeof source === 'string' && (!/^data:image\/(?:png|jpeg|webp);base64,/.test(source) || source.length > 42 * 1024 * 1024)) throw new Error('Нужна локальная растровая картинка до 30 МБ');
    const file = typeof source === 'string' ? await fetch(source).then(response => response.blob()) : source;
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Выбери PNG, JPEG или WebP');
    if (file.size > 30 * 1024 * 1024) throw new Error('Исходная картинка должна быть не больше 30 МБ');
    const bitmap = await createImageBitmap(file);
    try {
        if (bitmap.width * bitmap.height > 60000000) throw new Error('Картинка слишком большая по размерам');
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return { dataUrl: canvas.toDataURL('image/jpeg', .94), width: canvas.width, height: canvas.height };
    } finally { bitmap.close(); }
}

export function createArtistClassifier({ getResult, getMode, getProxy, useTags }) {
    const ui = Object.fromEntries(['page', 'upload', 'drop', 'preview', 'empty', 'caption', 'current', 'clear', 'model', 'top-k',
        'top-k-value', 'consent', 'proxy', 'run', 'cancel', 'status', 'results', 'empty-results', 'result-box', 'selection',
        'select-all', 'select-none', 'format', 'tags', 'copy', 'use']
        .map(id => [id, document.getElementById(`artist-${id}`)]));
    const studio = document.getElementById('studio-workspace'), nav = document.getElementById('nav-artists');
    let prepared = null, rows = [], selected = new Set(), controller = null, uploadSerial = 0, runSerial = 0, busy = false;
    let settings;
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { settings = {}; }
    if (!settings || typeof settings !== 'object') settings = {};
    for (const model of KALOSCOPE_MODELS) ui.model.add(new Option(model, model));
    ui.model.value = KALOSCOPE_MODELS.includes(settings.model) ? settings.model : KALOSCOPE_MODELS[0];
    ui['top-k'].value = String(Number.isInteger(settings.topK) && settings.topK >= 1 && settings.topK <= 25 ? settings.topK : 5);
    ui.format.value = ['novelai', 'plain'].includes(settings.format) ? settings.format : getMode() === 'novelai' ? 'novelai' : 'plain';
    let formatChosen = Boolean(settings.format);
    function persist() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ model: ui.model.value, topK: Number(ui['top-k'].value), format: ui.format.value })); }
        catch { /* Nonessential UI preferences; images and consent are never persisted. */ }
    }
    function message(text, kind = '') { ui.status.textContent = text; ui.status.dataset.kind = kind; }
    function controls() {
        ui.run.disabled = busy || !prepared || !ui.consent.checked;
        ui.cancel.classList.toggle('hidden', !busy);
        ui.run.textContent = busy ? 'Ожидаю ответ Kaloscope…' : '✦ Найти похожих художников';
        ui.current.disabled = busy || !getResult()?.dataUrl;
        for (const field of [ui.upload, ui.model, ui['top-k'], ui.consent, ui.proxy]) field.disabled = busy;
        ui.page.setAttribute('aria-busy', String(busy));
    }
    function showStudio() {
        ui.page.classList.add('hidden'); studio.classList.remove('hidden');
        nav.setAttribute('aria-pressed', 'false');
    }
    function showArtists() {
        studio.classList.add('hidden'); ui.page.classList.remove('hidden');
        nav.setAttribute('aria-pressed', 'true');
        if (!formatChosen) ui.format.value = getMode() === 'novelai' ? 'novelai' : 'plain';
        renderTags(); controls();
        history.replaceState(null, '', '#artists'); window.scrollTo({ top: 0, behavior: 'instant' });
    }
    nav.addEventListener('click', showArtists);
    for (const id of ['nav-studio', 'nav-gallery']) document.getElementById(id).addEventListener('click', showStudio);
    function renderTags() {
        ui.tags.value = artistPromptTags(rows.filter(row => selected.has(row.name)).map(row => row.name), ui.format.value);
        ui.selection.textContent = `Выбрано: ${selected.size} из ${rows.length}`;
        ui.copy.disabled = !ui.tags.value; ui.use.disabled = !ui.tags.value;
        for (const input of ui.results.querySelectorAll('input')) input.checked = selected.has(input.value);
    }
    async function copy(text) {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else {
                const field = element('textarea', 'sr-only'); field.value = text; document.body.append(field); field.select();
                const success = document.execCommand('copy'); field.remove();
                if (!success) throw new Error('Не удалось скопировать автоматически');
            }
            message('Скопировано', 'success');
        } catch { message('Не удалось скопировать. Выдели теги в поле и скопируй вручную.', 'error'); }
    }
    function clearResults() {
        rows = []; selected.clear(); ui.results.replaceChildren();
        ui['result-box'].classList.add('hidden'); ui['empty-results'].classList.remove('hidden'); renderTags();
    }
    async function setImage(source, label) {
        const serial = ++uploadSerial;
        controller?.abort(); controller = null; runSerial++; busy = false;
        prepared = null; ui.consent.checked = false; ui.caption.textContent = ''; clearResults(); controls();
        ui.preview.removeAttribute('src'); ui.preview.classList.add('hidden'); ui.empty.classList.remove('hidden');
        message('Подготавливаю картинку локально…');
        try {
            const result = await prepareImage(source);
            if (serial !== uploadSerial) return;
            prepared = result.dataUrl; ui.preview.src = prepared; ui.preview.classList.remove('hidden'); ui.empty.classList.add('hidden');
            ui.caption.textContent = `${label} · ${result.width}×${result.height}`;
            message('Превью готово. Подтверди отправку в Kaloscope и нажми кнопку анализа.');
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
        uploadSerial++; runSerial++; controller?.abort(); controller = null; busy = false; prepared = null;
        ui.consent.checked = false; ui.preview.removeAttribute('src'); ui.preview.classList.add('hidden'); ui.empty.classList.remove('hidden');
        ui.caption.textContent = ''; clearResults(); controls(); message('Картинка и результаты убраны из этой вкладки.');
    });
    function renderResults() {
        ui.results.replaceChildren();
        for (const [index, artist] of rows.entries()) {
            const row = element('li', 'artist-result-row');
            const check = element('label', 'artist-result-check');
            const input = document.createElement('input'); input.type = 'checkbox'; input.value = artist.name;
            input.setAttribute('aria-label', `Выбрать ${artist.name}`);
            input.addEventListener('change', () => { if (input.checked) selected.add(artist.name); else selected.delete(artist.name); renderTags(); });
            check.append(input, element('small', '', String(index + 1)));
            const link = element('a', 'artist-result-name', artist.name); link.href = artistDanbooruUrl(artist.name);
            link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = 'Открыть работы на Danbooru (возможен контент 18+)';
            const score = element('span', 'artist-result-score', artist.score.toLocaleString('ru-RU', { style: 'percent', maximumFractionDigits: 2 }));
            const copyButton = element('button', 'artist-row-copy', '⧉'); copyButton.type = 'button';
            copyButton.setAttribute('aria-label', `Скопировать имя ${artist.name}`); copyButton.addEventListener('click', () => copy(artist.name));
            row.append(check, link, score, copyButton); ui.results.append(row);
        }
        ui['result-box'].classList.remove('hidden'); ui['empty-results'].classList.add('hidden'); renderTags();
    }
    async function run() {
        if (busy || !prepared || !ui.consent.checked) return;
        let proxy;
        if (ui.proxy.checked) {
            proxy = getProxy();
            if (!proxy?.proxyEnabled || !proxy.proxyUrl?.trim()) return message('В активном профиле подключения не настроен прокси. Настрой его в студии или выключи эту галочку.', 'error');
        }
        const serial = ++runSerial;
        controller = new AbortController(); const signal = controller.signal;
        busy = true; clearResults(); controls(); persist(); message('Картинка отправляется в Kaloscope. Ответ может занять время: Space просыпается, загружает модель или ждёт очередь.');
        try {
            const response = await fetch('/api/artists/classify', { method: 'POST', signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl: prepared, model: ui.model.value, topK: Number(ui['top-k'].value), consent: true, ...(proxy ? { proxy } : {}) }) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
            if (serial !== runSerial) return;
            rows = (Array.isArray(data.artists) ? data.artists : []).filter(item => validArtistName(item.name) && typeof item.score === 'number' && item.score >= 0 && item.score <= 1).slice(0, 25);
            selected = new Set(rows.slice(0, 1).map(row => row.name)); renderResults();
            message(rows.length ? 'Готово. Это сходство стиля по оценке модели, не подтверждение авторства.' : 'Модель не вернула подходящих художников.', 'success');
        } catch (error) {
            if (serial === runSerial) message(error.name === 'AbortError'
                ? 'Ожидание остановлено. Уже загруженная картинка и задача могут оставаться на стороне внешнего сервиса.'
                : error.message || 'Не удалось получить результат Kaloscope', error.name === 'AbortError' ? '' : 'error');
        } finally { if (serial === runSerial) { busy = false; controller = null; controls(); } }
    }
    ui.run.addEventListener('click', run); ui.cancel.addEventListener('click', () => controller?.abort());
    ui.consent.addEventListener('change', controls);
    ui['top-k'].addEventListener('input', () => { ui['top-k-value'].textContent = ui['top-k'].value; persist(); });
    ui['top-k-value'].textContent = ui['top-k'].value;
    ui.model.addEventListener('change', persist);
    ui.format.addEventListener('change', () => { formatChosen = true; persist(); renderTags(); });
    ui['select-all'].addEventListener('click', () => { selected = new Set(rows.map(row => row.name)); renderTags(); });
    ui['select-none'].addEventListener('click', () => { selected.clear(); renderTags(); });
    ui.copy.addEventListener('click', () => copy(ui.tags.value));
    ui.use.addEventListener('click', () => {
        if (!ui.tags.value) return;
        showStudio(); history.replaceState(null, '', '#prompt-panel'); useTags(ui.tags.value);
    });
    controls(); renderTags();
    if (location.hash === '#artists') showArtists();
    return { get isActive() { return !ui.page.classList.contains('hidden'); }, refresh: controls };
}
