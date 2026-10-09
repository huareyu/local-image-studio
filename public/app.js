const $ = (selector) => document.querySelector(selector);

const STORAGE_KEYS = {
    profiles: 'image-studio.profiles.v1',
    activeProfile: 'image-studio.active-profile.v1',
    secrets: 'image-studio.session-secrets.v1',
    draft: 'image-studio.draft.v1',
};

const PROVIDER_DEFAULTS = {
    gemini: 'https://generativelanguage.googleapis.com',
    openai: 'https://api.openai.com',
    openrouter: 'https://openrouter.ai/api/v1',
};

const els = {
    profileSelect: $('#profile-select'),
    profileName: $('#profile-name'),
    provider: $('#provider'),
    endpoint: $('#endpoint'),
    rawEndpoint: $('#raw-endpoint'),
    apiKey: $('#api-key'),
    rememberKey: $('#remember-key'),
    model: $('#model'),
    modelOptions: $('#model-options'),
    loadModels: $('#load-models'),
    profileSave: $('#profile-save'),
    profileNew: $('#profile-new'),
    profileDelete: $('#profile-delete'),
    toggleKey: $('#toggle-key'),
    upload: $('#reference-upload'),
    dropZone: $('#drop-zone'),
    referenceList: $('#reference-list'),
    referenceCount: $('#reference-count'),
    referenceTemplate: $('#reference-template'),
    prefix: $('#prefix'),
    prompt: $('#prompt'),
    negativePrompt: $('#negative-prompt'),
    promptCounter: $('#prompt-counter'),
    aspectRatio: $('#aspect-ratio'),
    imageSize: $('#image-size'),
    openaiSize: $('#openai-size'),
    quality: $('#quality'),
    canvas: $('#canvas'),
    emptyState: $('.empty-state'),
    loadingState: $('#loading-state'),
    resultImage: $('#result-image'),
    resultTitle: $('#result-title'),
    resultActions: $('#result-actions'),
    downloadResult: $('#download-result'),
    resultToReference: $('#result-to-reference'),
    generate: $('#generate'),
    cancel: $('#cancel-generation'),
    message: $('#message'),
    historyList: $('#history-list'),
    clearHistory: $('#clear-history'),
};

const defaultProfile = () => ({
    id: crypto.randomUUID(),
    name: 'Основной',
    provider: 'gemini',
    endpoint: PROVIDER_DEFAULTS.gemini,
    rawEndpoint: false,
    apiKey: '',
    rememberKey: true,
    model: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    size: '1024x1024',
    quality: '',
});

let profiles = [];
let activeProfileId = '';
let references = [];
let currentResult = null;
let generationController = null;
let saveDraftTimer = null;

function readJson(storage, key, fallback) {
    try {
        const parsed = JSON.parse(storage.getItem(key));
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function loadProfiles() {
    const stored = readJson(localStorage, STORAGE_KEYS.profiles, []);
    const sessionSecrets = readJson(sessionStorage, STORAGE_KEYS.secrets, {});
    profiles = Array.isArray(stored) && stored.length ? stored : [defaultProfile()];
    profiles = profiles.map(profile => ({
        ...defaultProfile(),
        ...profile,
        apiKey: profile.rememberKey === false ? (sessionSecrets[profile.id] || '') : (profile.apiKey || ''),
    }));
    activeProfileId = localStorage.getItem(STORAGE_KEYS.activeProfile) || profiles[0].id;
    if (!profiles.some(profile => profile.id === activeProfileId)) activeProfileId = profiles[0].id;
}

function persistProfiles() {
    const secrets = {};
    const safeProfiles = profiles.map(profile => {
        if (profile.rememberKey === false) {
            secrets[profile.id] = profile.apiKey || '';
            return { ...profile, apiKey: '' };
        }
        return profile;
    });
    localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(safeProfiles));
    localStorage.setItem(STORAGE_KEYS.activeProfile, activeProfileId);
    sessionStorage.setItem(STORAGE_KEYS.secrets, JSON.stringify(secrets));
}

function currentProfile() {
    return profiles.find(profile => profile.id === activeProfileId) || profiles[0];
}

function providerLabel(provider) {
    return provider === 'gemini' ? 'Gemini' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
}

function renderProfileOptions() {
    els.profileSelect.innerHTML = '';
    for (const profile of profiles) {
        const option = new Option(`${profile.name} · ${providerLabel(profile.provider)}`, profile.id);
        option.selected = profile.id === activeProfileId;
        els.profileSelect.add(option);
    }
}

function putProfileIntoForm(profile) {
    els.profileName.value = profile.name || '';
    els.provider.value = profile.provider || 'gemini';
    els.endpoint.value = profile.endpoint || PROVIDER_DEFAULTS[profile.provider] || '';
    els.rawEndpoint.checked = Boolean(profile.rawEndpoint);
    els.apiKey.value = profile.apiKey || '';
    els.rememberKey.checked = profile.rememberKey !== false;
    els.model.value = profile.model || '';
    els.aspectRatio.value = profile.aspectRatio || '';
    els.imageSize.value = profile.imageSize || '';
    els.openaiSize.value = profile.size || '';
    els.quality.value = profile.quality || '';
    syncProviderFields();
}

function readProfileFromForm(profile = currentProfile()) {
    return {
        ...profile,
        name: els.profileName.value.trim() || 'Без названия',
        provider: els.provider.value,
        endpoint: els.endpoint.value.trim(),
        rawEndpoint: els.rawEndpoint.checked,
        apiKey: els.apiKey.value.trim(),
        rememberKey: els.rememberKey.checked,
        model: els.model.value.trim(),
        aspectRatio: els.aspectRatio.value,
        imageSize: els.imageSize.value,
        size: els.openaiSize.value,
        quality: els.quality.value,
    };
}

function saveActiveProfile({ notify = true } = {}) {
    const index = profiles.findIndex(profile => profile.id === activeProfileId);
    if (index < 0) return;
    profiles[index] = readProfileFromForm(profiles[index]);
    persistProfiles();
    renderProfileOptions();
    if (notify) showMessage('Профиль сохранён', 'success');
}

function syncProviderFields() {
    const provider = els.provider.value;
    els.imageSize.closest('label')?.classList.toggle('hidden', provider !== 'gemini' && provider !== 'openrouter');
    els.aspectRatio.closest('label')?.classList.toggle('hidden', provider === 'openai');
    els.openaiSize.closest('label')?.classList.toggle('hidden', provider !== 'openai');
}

function showMessage(text, type = 'error') {
    els.message.textContent = text;
    els.message.classList.remove('hidden', 'success');
    if (type === 'success') els.message.classList.add('success');
    if (type === 'success') {
        setTimeout(() => {
            if (els.message.textContent === text) els.message.classList.add('hidden');
        }, 2200);
    }
}

function clearMessage() {
    els.message.classList.add('hidden');
    els.message.textContent = '';
}

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('local-image-studio', 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('references')) db.createObjectStore('references', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbRequest(storeName, mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let request;
        try { request = operation(store); } catch (error) { reject(error); return; }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

const dbGetAll = store => dbRequest(store, 'readonly', objectStore => objectStore.getAll());
const dbPut = (store, value) => dbRequest(store, 'readwrite', objectStore => objectStore.put(value));
const dbDelete = (store, key) => dbRequest(store, 'readwrite', objectStore => objectStore.delete(key));
const dbClear = store => dbRequest(store, 'readwrite', objectStore => objectStore.clear());

async function fileToDataUrl(file) {
    if (!file.type.startsWith('image/')) throw new Error(`${file.name}: это не изображение`);
    const bitmap = await createImageBitmap(file);
    const maxSide = 2048;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    return canvas.toDataURL(mime, .92);
}

async function addReferenceFiles(fileList) {
    const files = [...fileList].filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    els.dropZone.classList.add('dragging');
    try {
        for (const file of files) {
            const entry = {
                id: crypto.randomUUID(),
                name: file.name,
                label: file.name.replace(/\.[^.]+$/, ''),
                description: '',
                dataUrl: await fileToDataUrl(file),
                enabled: true,
                createdAt: Date.now(),
            };
            await dbPut('references', entry);
            references.unshift(entry);
        }
        renderReferences();
    } catch (error) {
        showMessage(error.message || String(error));
    } finally {
        els.dropZone.classList.remove('dragging');
        els.upload.value = '';
    }
}

function updateReferenceCount() {
    const active = references.filter(reference => reference.enabled).length;
    els.referenceCount.textContent = active === references.length ? String(active) : `${active}/${references.length}`;
}

function renderReferences() {
    els.referenceList.innerHTML = '';
    for (const reference of references) {
        const card = els.referenceTemplate.content.firstElementChild.cloneNode(true);
        card.dataset.id = reference.id;
        card.classList.toggle('enabled', reference.enabled !== false);
        const image = card.querySelector('img');
        image.src = reference.dataUrl;
        image.alt = reference.label || reference.name;
        const labelInput = card.querySelector('.reference-label');
        const descriptionInput = card.querySelector('.reference-description');
        labelInput.value = reference.label || '';
        descriptionInput.value = reference.description || '';

        card.querySelector('.reference-toggle').addEventListener('click', async () => {
            reference.enabled = !reference.enabled;
            card.classList.toggle('enabled', reference.enabled);
            await dbPut('references', reference);
            updateReferenceCount();
        });
        const saveFields = async () => {
            reference.label = labelInput.value.trim();
            reference.description = descriptionInput.value.trim();
            await dbPut('references', reference);
        };
        labelInput.addEventListener('change', saveFields);
        descriptionInput.addEventListener('change', saveFields);
        card.querySelector('.reference-delete').addEventListener('click', async () => {
            await dbDelete('references', reference.id);
            references = references.filter(item => item.id !== reference.id);
            renderReferences();
        });
        els.referenceList.append(card);
    }
    updateReferenceCount();
}

async function loadReferences() {
    references = (await dbGetAll('references')).sort((a, b) => b.createdAt - a.createdAt);
    renderReferences();
}

function saveDraftSoon() {
    clearTimeout(saveDraftTimer);
    saveDraftTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify({
            prefix: els.prefix.value,
            prompt: els.prompt.value,
            negativePrompt: els.negativePrompt.value,
        }));
    }, 300);
    els.promptCounter.textContent = String(els.prompt.value.length);
}

function loadDraft() {
    const draft = readJson(localStorage, STORAGE_KEYS.draft, {});
    els.prefix.value = draft.prefix || '';
    els.prompt.value = draft.prompt || '';
    els.negativePrompt.value = draft.negativePrompt || '';
    els.promptCounter.textContent = String(els.prompt.value.length);
}

function setGenerating(isGenerating) {
    els.generate.disabled = isGenerating;
    els.emptyState.classList.toggle('hidden', isGenerating || Boolean(currentResult));
    els.loadingState.classList.toggle('hidden', !isGenerating);
    els.resultImage.classList.toggle('hidden', isGenerating || !currentResult);
    if (isGenerating) els.resultActions.classList.add('hidden');
    else els.resultActions.classList.toggle('hidden', !currentResult);
    els.canvas.classList.toggle('empty', !currentResult && !isGenerating);
}

function displayResult(entry) {
    currentResult = entry;
    els.resultImage.src = entry.dataUrl;
    els.resultImage.alt = entry.prompt || 'Сгенерированное изображение';
    els.resultTitle.textContent = `${entry.model || 'Результат'} · ${providerLabel(entry.provider)}`;
    setGenerating(false);
}

function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
}

async function generate() {
    clearMessage();
    saveActiveProfile({ notify: false });
    const profile = currentProfile();
    if (!els.prompt.value.trim()) {
        showMessage('Сначала напиши промпт');
        els.prompt.focus();
        return;
    }
    if (!profile.model) {
        showMessage('Укажи модель в профиле подключения');
        els.model.focus();
        return;
    }
    generationController = new AbortController();
    setGenerating(true);
    const activeRefs = references.filter(reference => reference.enabled !== false).map(reference => ({
        dataUrl: reference.dataUrl,
        label: reference.label,
        description: reference.description,
    }));
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: generationController.signal,
            body: JSON.stringify({
                profile,
                prompt: els.prompt.value.trim(),
                prefix: els.prefix.value.trim(),
                negativePrompt: els.negativePrompt.value.trim(),
                references: activeRefs,
                aspectRatio: profile.aspectRatio,
                imageSize: profile.imageSize,
                size: profile.size,
                quality: profile.quality,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error([result.error, result.details].filter(Boolean).join('\n'));
        const entry = {
            id: crypto.randomUUID(),
            dataUrl: result.dataUrl,
            provider: result.provider || profile.provider,
            model: result.model || profile.model,
            profileName: profile.name,
            prompt: els.prompt.value.trim(),
            prefix: els.prefix.value.trim(),
            negativePrompt: els.negativePrompt.value.trim(),
            createdAt: Date.now(),
            referenceCount: activeRefs.length,
        };
        await dbPut('history', entry);
        displayResult(entry);
        await renderHistory();
        showMessage('Изображение готово', 'success');
    } catch (error) {
        if (error.name === 'AbortError') showMessage('Генерация остановлена');
        else showMessage(error.message || String(error));
        setGenerating(false);
    } finally {
        generationController = null;
    }
}

async function renderHistory() {
    const history = (await dbGetAll('history')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
    els.historyList.innerHTML = '';
    for (const entry of history) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-item';
        button.title = entry.prompt || '';
        const image = new Image();
        image.src = entry.dataUrl;
        image.alt = entry.prompt || '';
        const label = document.createElement('span');
        label.textContent = entry.model || entry.profileName || 'image';
        button.append(image, label);
        button.addEventListener('click', () => {
            displayResult(entry);
            els.prompt.value = entry.prompt || '';
            els.prefix.value = entry.prefix || '';
            els.negativePrompt.value = entry.negativePrompt || '';
            saveDraftSoon();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        els.historyList.append(button);
    }
}

async function loadModelList() {
    saveActiveProfile({ notify: false });
    const profile = currentProfile();
    els.loadModels.disabled = true;
    els.loadModels.textContent = '…';
    clearMessage();
    try {
        const response = await fetch('/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error([result.error, result.details].filter(Boolean).join('\n'));
        els.modelOptions.innerHTML = '';
        for (const model of result.models || []) els.modelOptions.append(new Option(model, model));
        showMessage(`Загружено моделей: ${result.models?.length || 0}`, 'success');
        els.model.focus();
    } catch (error) {
        showMessage(error.message || String(error));
    } finally {
        els.loadModels.disabled = false;
        els.loadModels.textContent = '↻';
    }
}

function bindEvents() {
    els.profileSelect.addEventListener('change', () => {
        saveActiveProfile({ notify: false });
        activeProfileId = els.profileSelect.value;
        localStorage.setItem(STORAGE_KEYS.activeProfile, activeProfileId);
        putProfileIntoForm(currentProfile());
    });
    els.profileSave.addEventListener('click', () => saveActiveProfile());
    els.profileNew.addEventListener('click', () => {
        saveActiveProfile({ notify: false });
        const source = readProfileFromForm(currentProfile());
        const profile = { ...source, id: crypto.randomUUID(), name: `${source.name} — копия` };
        profiles.push(profile);
        activeProfileId = profile.id;
        persistProfiles();
        renderProfileOptions();
        putProfileIntoForm(profile);
        showMessage('Создан новый профиль', 'success');
    });
    els.profileDelete.addEventListener('click', () => {
        if (profiles.length <= 1) return showMessage('Нельзя удалить единственный профиль');
        if (!confirm(`Удалить профиль «${currentProfile().name}»?`)) return;
        profiles = profiles.filter(profile => profile.id !== activeProfileId);
        activeProfileId = profiles[0].id;
        persistProfiles();
        renderProfileOptions();
        putProfileIntoForm(currentProfile());
    });
    els.provider.addEventListener('change', (event) => {
        const previousProvider = currentProfile().provider;
        const oldDefault = PROVIDER_DEFAULTS[previousProvider];
        if (!els.endpoint.value.trim() || els.endpoint.value.trim() === oldDefault) {
            els.endpoint.value = PROVIDER_DEFAULTS[event.target.value];
        }
        syncProviderFields();
    });
    els.toggleKey.addEventListener('click', () => {
        els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
    });
    els.loadModels.addEventListener('click', loadModelList);

    els.upload.addEventListener('change', () => addReferenceFiles(els.upload.files));
    els.dropZone.addEventListener('click', () => els.upload.click());
    for (const eventName of ['dragenter', 'dragover']) {
        els.dropZone.addEventListener(eventName, event => {
            event.preventDefault();
            els.dropZone.classList.add('dragging');
        });
    }
    for (const eventName of ['dragleave', 'drop']) {
        els.dropZone.addEventListener(eventName, event => {
            event.preventDefault();
            els.dropZone.classList.remove('dragging');
        });
    }
    els.dropZone.addEventListener('drop', event => addReferenceFiles(event.dataTransfer.files));
    window.addEventListener('paste', event => {
        const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
        if (files.length) addReferenceFiles(files);
    });

    for (const field of [els.prefix, els.prompt, els.negativePrompt]) field.addEventListener('input', saveDraftSoon);
    els.generate.addEventListener('click', generate);
    els.cancel.addEventListener('click', () => generationController?.abort());
    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            if (!els.generate.disabled) generate();
        }
    });
    els.downloadResult.addEventListener('click', () => {
        if (!currentResult) return;
        downloadDataUrl(currentResult.dataUrl, `image-${new Date(currentResult.createdAt).toISOString().replace(/[:.]/g, '-')}.png`);
    });
    els.resultToReference.addEventListener('click', async () => {
        if (!currentResult) return;
        const entry = {
            id: crypto.randomUUID(),
            name: `result-${currentResult.id}.png`,
            label: currentResult.prompt.slice(0, 80),
            description: '',
            dataUrl: currentResult.dataUrl,
            enabled: true,
            createdAt: Date.now(),
        };
        await dbPut('references', entry);
        references.unshift(entry);
        renderReferences();
        showMessage('Результат добавлен в референсы', 'success');
    });
    els.clearHistory.addEventListener('click', async () => {
        if (!confirm('Очистить всю локальную историю изображений?')) return;
        await dbClear('history');
        await renderHistory();
    });
}

async function init() {
    loadProfiles();
    renderProfileOptions();
    putProfileIntoForm(currentProfile());
    loadDraft();
    bindEvents();
    try {
        await Promise.all([loadReferences(), renderHistory()]);
    } catch (error) {
        showMessage(`Не удалось открыть локальную базу: ${error.message}`);
    }
}

init();
