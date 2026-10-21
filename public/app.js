import {
    NOVELAI_ENDPOINT, NOVELAI_MODELS, NOVELAI_SAMPLERS, NOVELAI_SCHEDULERS, NOVELAI_SIZES,
    NOVELAI_DEFAULTS, DEFAULT_NOVELAI_NEGATIVE, novelaiCapabilities,
    novelaiReferencesEnabled, novelaiDimensions, normalizeNovelaiReference,
} from './novelai.js';
import { createPromptLibrary } from './prompt-library.js';
import { filterHistory, pageNumbers } from './history-tools.js';
import { createImageViewer } from './image-viewer.js';
import { createThumbnailLoader } from './image-thumbnails.js';
import { createTagAssistant } from './tag-assistant.js';
import { createArtistClassifier } from './artist-classifier.js';

const $ = (selector) => document.querySelector(selector);

const STORAGE_KEYS = {
    profiles: 'image-studio.profiles.v1',
    activeProfile: 'image-studio.active-profile.v1',
    mode: 'image-studio.mode.v1',
    activeProfilesByMode: 'image-studio.active-profiles-by-mode.v1',
    secrets: 'image-studio.session-secrets.v1',
    draft: 'image-studio.draft.v1',
    referenceProfiles: 'image-studio.reference-profiles.v1',
    activeReferenceProfile: 'image-studio.active-reference-profile.v1',
    novelaiNegativePresets: 'image-studio.novelai-negative-presets.v1',
};

const PROVIDER_DEFAULTS = {
    gemini: 'https://generativelanguage.googleapis.com',
    openai: 'https://api.openai.com',
    openrouter: 'https://openrouter.ai/api/v1',
    novelai: NOVELAI_ENDPOINT,
};

const els = {
    modeStandard: $('#mode-standard'),
    modeNovelai: $('#mode-novelai'),
    modeHint: $('#mode-hint'),
    apiKeyLabel: $('#api-key-label'),
    profileSelect: $('#profile-select'),
    profileName: $('#profile-name'),
    provider: $('#provider'),
    endpoint: $('#endpoint'),
    rawEndpoint: $('#raw-endpoint'),
    proxyEnabled: $('#proxy-enabled'),
    proxyFields: $('#proxy-fields'),
    proxyUrl: $('#proxy-url'),
    proxyUsername: $('#proxy-username'),
    proxyPassword: $('#proxy-password'),
    toggleProxyPassword: $('#toggle-proxy-password'),
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
    referenceProfileSelect: $('#reference-profile-select'),
    referenceProfileNew: $('#reference-profile-new'),
    referenceProfileRename: $('#reference-profile-rename'),
    referenceProfileDelete: $('#reference-profile-delete'),
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
    resultMeta: $('#result-meta'),
    resultActions: $('#result-actions'),
    downloadResult: $('#download-result'),
    expandResult: $('#expand-result'),
    resultToReference: $('#result-to-reference'),
    generate: $('#generate'),
    cancel: $('#cancel-generation'),
    message: $('#message'),
    historyList: $('#history-list'),
    clearHistory: $('#clear-history'),
    openImageFolder: $('#open-image-folder'),
    historyFolderHint: $('#history-folder-hint'),
    historySelect: $('#history-select'),
    historySelection: $('#history-selection'),
    historySelectedCount: $('#history-selected-count'),
    historySelectPage: $('#history-select-page'),
    historyDeselect: $('#history-deselect'),
    historyDeleteSelected: $('#history-delete-selected'),
    historyPagination: $('#history-pagination'),
    historyPrevious: $('#history-previous'),
    historyNext: $('#history-next'),
    historyPageLabel: $('#history-page-label'),
    historySearch: $('#history-search'),
    historyProvider: $('#history-provider'),
    historyDate: $('#history-date'),
    historyOrder: $('#history-order'),
    historyCount: $('#history-count'),
    historyReset: $('#history-reset'),
    historyEmpty: $('#history-empty'),
    historyPages: $('#history-pages'),
    historyPage: $('#history-page'),
    novelaiPanel: $('#novelai-panel'),
    novelaiKeyHint: $('#novelai-key-hint'),
    novelaiModelHint: $('#novelai-model-hint'),
    novelaiReferenceHint: $('#novelai-reference-hint'),
    novelaiReferenceOptions: $('#novelai-reference-options'),
    novelaiTestKey: $('#novelai-test-key'),
    novelaiNegativePreset: $('#novelai-negative-preset'),
    novelaiNegativeSave: $('#novelai-negative-save'),
    novelaiNegativeNew: $('#novelai-negative-new'),
    novelaiNegativeRename: $('#novelai-negative-rename'),
    novelaiNegativeDelete: $('#novelai-negative-delete'),
    novelaiTagList: $('#novelai-tag-list'),
    novelaiTagAdd: $('#novelai-tag-add'),
};

const NOVELAI_FIELDS = {
    novelaiSampler: $('#novelai-sampler'),
    novelaiScheduler: $('#novelai-scheduler'),
    novelaiSteps: $('#novelai-steps'),
    novelaiScale: $('#novelai-scale'),
    novelaiCfgRescale: $('#novelai-cfg-rescale'),
    novelaiSize: $('#novelai-size'),
    novelaiSeed: $('#novelai-seed'),
    novelaiNegativePrompt: $('#novelai-negative'),
    novelaiAnlasGuard: $('#novelai-anlas-guard'),
    novelaiDecrisper: $('#novelai-decrisper'),
    novelaiVarietyBoost: $('#novelai-variety-boost'),
    novelaiSm: $('#novelai-sm'),
    novelaiSmDyn: $('#novelai-sm-dyn'),
    novelaiEnableReferences: $('#novelai-enable-references'),
    novelaiReferenceType: $('#novelai-reference-type'),
    novelaiReferenceStrength: $('#novelai-reference-strength'),
    novelaiReferenceFidelity: $('#novelai-reference-fidelity'),
};

const defaultProfile = () => ({
    id: crypto.randomUUID(),
    name: 'Основной',
    provider: 'gemini',
    endpoint: PROVIDER_DEFAULTS.gemini,
    rawEndpoint: false,
    proxyEnabled: false,
    proxyUrl: '',
    proxyUsername: '',
    proxyPassword: '',
    apiKey: '',
    rememberKey: true,
    model: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    size: '1024x1024',
    quality: '',
    ...NOVELAI_DEFAULTS,
    novelaiTagPresets: [],
});

function profileMode(profile) {
    return profile.provider === 'novelai' ? 'novelai' : 'standard';
}

function defaultModeProfile(mode) {
    const profile = defaultProfile();
    return mode === 'novelai' ? {
        ...profile, name: 'NovelAI', provider: 'novelai',
        endpoint: NOVELAI_ENDPOINT, model: 'nai-diffusion-4-5-full',
    } : profile;
}

let profiles = [];
let activeProfileId = '';
let activeMode = 'standard';
let activeProfilesByMode = {};
let references = [];
let referenceProfiles = [];
let activeReferenceProfileId = '';
let currentResult = null;
let generationController = null;
let saveDraftTimer = null;
let novelaiValues = { ...NOVELAI_DEFAULTS };
let novelaiTagPresets = [];
let novelaiNegativePresets = [];
const HISTORY_PAGE_SIZE = 12;
let historyEntries = [];
let filteredHistoryEntries = [];
let historyPage = 0;
let historySelectionMode = false;
let historyBusy = false;
const selectedHistoryIds = new Set();
const readThumbnail = createThumbnailLoader(id => dbGet('history', id));
const imageViewer = createImageViewer({
    read: id => dbGet('history', id),
    readThumbnail,
    download: downloadEntry,
    usePrompt: useHistoryEntry,
    addReference: addResultReference,
    providerLabel,
});
const promptLibrary = createPromptLibrary({
    dbGetAll: () => dbGetAll('promptLibrary'),
    dbSave: records => savePromptLibrary(records),
    dbDelete: id => dbDelete('promptLibrary', id),
    getMode: () => els.provider.value,
    prefixField: els.prefix, promptField: els.prompt, negativeField: NOVELAI_FIELDS.novelaiNegativePrompt,
    getNegative: () => els.provider.value === 'novelai' ? NOVELAI_FIELDS.novelaiNegativePrompt.value : els.negativePrompt.value,
    setNegative: value => {
        if (els.provider.value === 'novelai') {
            NOVELAI_FIELDS.novelaiNegativePrompt.value = value;
            novelaiValues.novelaiNegativePrompt = value;
            novelaiValues.novelaiNegativePresetId = '';
            renderNovelaiNegativePresets();
        } else els.negativePrompt.value = value;
    },
    getResult: () => currentResult,
    onTextChanged: () => saveDraftSoon(),
    showMessage,
});
const tagAssistant = createTagAssistant({
    fields: { prompt: els.prompt, prefix: els.prefix, negative: NOVELAI_FIELDS.novelaiNegativePrompt },
    getMode: () => els.provider.value,
    loadDictionary: () => dbGet('promptLibrary', 'novelai-tag-dictionary'),
    saveDictionary: tags => dbPut('promptLibrary', { id: 'novelai-tag-dictionary', type: 'tagDictionary', tags }),
    showMessage,
});
const artistClassifier = createArtistClassifier({
    getResult: () => currentResult,
    getMode: () => els.provider.value,
    getProxy: () => ({ proxyEnabled: els.proxyEnabled.checked, proxyUrl: els.proxyUrl.value,
        proxyUsername: els.proxyUsername.value, proxyPassword: els.proxyPassword.value }),
    useTags: tags => {
        const source = els.prefix.value;
        const separator = !source.trim() ? '' : /[,\n]\s*$/.test(source) ? (/\s$/.test(source) ? '' : ' ') : ', ';
        els.prefix.setRangeText(separator + tags + ', ', source.length, source.length, 'end');
        els.prefix.dispatchEvent(new Event('input', { bubbles: true }));
        els.prefix.closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        els.prefix.focus({ preventScroll: true });
        showMessage('Выбранные художники добавлены в префикс / стиль', 'success');
    },
});

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
    profiles = profiles.map(profile => {
        const sessionSecret = sessionSecrets[profile.id];
        const legacyApiKey = typeof sessionSecret === 'string' ? sessionSecret : '';
        const secret = sessionSecret && typeof sessionSecret === 'object' ? sessionSecret : {};
        return {
            ...defaultProfile(),
            ...profile,
            apiKey: profile.rememberKey === false ? (secret.apiKey || legacyApiKey) : (profile.apiKey || ''),
            proxyPassword: profile.rememberKey === false ? (secret.proxyPassword || '') : (profile.proxyPassword || ''),
        };
    });
    activeProfileId = localStorage.getItem(STORAGE_KEYS.activeProfile) || profiles[0].id;
    if (!profiles.some(profile => profile.id === activeProfileId)) activeProfileId = profiles[0].id;
    const legacyProfile = currentProfile();
    const storedMode = localStorage.getItem(STORAGE_KEYS.mode);
    activeMode = ['standard', 'novelai'].includes(storedMode) ? storedMode : profileMode(legacyProfile);
    const storedActiveProfiles = readJson(localStorage, STORAGE_KEYS.activeProfilesByMode, {});
    activeProfilesByMode = {};
    for (const mode of ['standard', 'novelai']) {
        const savedId = storedActiveProfiles?.[mode];
        let profile = profiles.find(item => item.id === savedId && profileMode(item) === mode)
            || (profileMode(legacyProfile) === mode ? legacyProfile : null)
            || profiles.find(item => profileMode(item) === mode);
        if (!profile) {
            profile = defaultModeProfile(mode);
            profiles.push(profile);
        }
        activeProfilesByMode[mode] = profile.id;
    }
    activeProfileId = activeProfilesByMode[activeMode];
    persistProfiles();
}

function persistProfiles() {
    activeProfilesByMode[activeMode] = activeProfileId;
    const secrets = {};
    const safeProfiles = profiles.map(profile => {
        if (profile.rememberKey === false) {
            secrets[profile.id] = {
                apiKey: profile.apiKey || '',
                proxyPassword: profile.proxyPassword || '',
            };
            return { ...profile, apiKey: '', proxyPassword: '' };
        }
        return profile;
    });
    localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(safeProfiles));
    localStorage.setItem(STORAGE_KEYS.activeProfile, activeProfileId);
    localStorage.setItem(STORAGE_KEYS.mode, activeMode);
    localStorage.setItem(STORAGE_KEYS.activeProfilesByMode, JSON.stringify(activeProfilesByMode));
    sessionStorage.setItem(STORAGE_KEYS.secrets, JSON.stringify(secrets));
}

function currentProfile() {
    return profiles.find(profile => profile.id === activeProfileId) || profiles[0];
}

function providerLabel(provider) {
    return { gemini: 'Gemini', openrouter: 'OpenRouter', openai: 'OpenAI', novelai: 'NovelAI' }[provider] || provider;
}

function renderProfileOptions() {
    els.profileSelect.innerHTML = '';
    for (const profile of profiles.filter(item => profileMode(item) === activeMode)) {
        const option = new Option(`${profile.name} · ${providerLabel(profile.provider)}`, profile.id);
        option.selected = profile.id === activeProfileId;
        els.profileSelect.add(option);
    }
    els.profileDelete.disabled = els.profileSelect.options.length <= 1;
}

function switchMode(mode) {
    if (mode === activeMode) return;
    saveActiveProfile({ notify: false });
    activeMode = mode;
    activeProfileId = activeProfilesByMode[mode];
    persistProfiles();
    renderProfileOptions();
    putProfileIntoForm(currentProfile());
}

function putProfileIntoForm(profile) {
    els.profileName.value = profile.name || '';
    els.provider.value = profile.provider || 'gemini';
    els.provider.dataset.current = els.provider.value;
    els.endpoint.value = profile.endpoint || PROVIDER_DEFAULTS[profile.provider] || '';
    els.rawEndpoint.checked = Boolean(profile.rawEndpoint);
    els.proxyEnabled.checked = Boolean(profile.proxyEnabled);
    els.proxyUrl.value = profile.proxyUrl || '';
    els.proxyUsername.value = profile.proxyUsername || '';
    els.proxyPassword.value = profile.proxyPassword || '';
    els.apiKey.value = profile.apiKey || '';
    els.apiKey.type = 'password';
    els.proxyPassword.type = 'password';
    els.rememberKey.checked = profile.rememberKey !== false;
    els.model.value = profile.model || '';
    els.aspectRatio.value = profile.aspectRatio || '';
    els.imageSize.value = profile.imageSize || '';
    els.openaiSize.value = profile.size || '';
    els.quality.value = profile.quality || '';
    novelaiValues = { ...NOVELAI_DEFAULTS, ...Object.fromEntries(Object.keys(NOVELAI_DEFAULTS).map(key => [key, profile[key] ?? NOVELAI_DEFAULTS[key]])) };
    novelaiTagPresets = structuredClone(profile.novelaiTagPresets || []);
    for (const [key, field] of Object.entries(NOVELAI_FIELDS)) {
        if (field.type === 'checkbox') field.checked = Boolean(novelaiValues[key]);
        else field.value = novelaiValues[key];
    }
    renderNovelaiNegativePresets();
    renderNovelaiTagPresets();
    syncProviderFields();
    syncNovelaiControls({ capture: false });
    syncProxyFields();
}

function readProfileFromForm(profile = currentProfile()) {
    captureNovelaiValues();
    return {
        ...profile,
        name: els.profileName.value.trim() || 'Без названия',
        provider: els.provider.value,
        endpoint: els.endpoint.value.trim(),
        rawEndpoint: els.rawEndpoint.checked,
        proxyEnabled: els.proxyEnabled.checked,
        proxyUrl: els.proxyUrl.value.trim(),
        proxyUsername: els.proxyUsername.value.trim(),
        proxyPassword: els.proxyPassword.value,
        apiKey: els.apiKey.value.trim(),
        rememberKey: els.rememberKey.checked,
        model: els.model.value.trim(),
        aspectRatio: els.aspectRatio.value,
        imageSize: els.imageSize.value,
        size: els.openaiSize.value,
        quality: els.quality.value,
        ...novelaiValues,
        novelaiTagPresets: structuredClone(novelaiTagPresets),
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
    const isNovelai = provider === 'novelai';
    els.modeStandard.setAttribute('aria-pressed', String(!isNovelai));
    els.modeNovelai.setAttribute('aria-pressed', String(isNovelai));
    els.modeHint.textContent = isNovelai
        ? 'Свой ключ, endpoint и модель NovelAI. Обычное подключение не меняется; переключение сохраняет настройки.'
        : 'Gemini, OpenAI и OpenRouter. Подключение NovelAI хранится отдельно; переключение сохраняет настройки.';
    els.provider.closest('label').classList.toggle('hidden', isNovelai);
    $('#profile-details').classList.toggle('two', !isNovelai);
    els.apiKeyLabel.textContent = isNovelai ? 'Ключ NovelAI · Persistent API Token' : 'API-ключ';
    els.novelaiPanel.classList.toggle('hidden', !isNovelai);
    els.novelaiKeyHint.classList.toggle('hidden', !isNovelai);
    els.negativePrompt.closest('label').classList.toggle('hidden', isNovelai);
    $('.params-grid').classList.toggle('hidden', isNovelai);
    els.modelOptions.innerHTML = '';
    if (isNovelai) for (const model of NOVELAI_MODELS) els.modelOptions.append(new Option(model, model));
    els.loadModels.title = isNovelai ? 'Показать встроенный список моделей NovelAI' : 'Загрузить список моделей';
    els.imageSize.closest('label')?.classList.toggle('hidden', provider !== 'gemini' && provider !== 'openrouter');
    els.aspectRatio.closest('label')?.classList.toggle('hidden', provider === 'openai');
    els.openaiSize.closest('label')?.classList.toggle('hidden', provider !== 'openai');
    promptLibrary.syncMode();
    tagAssistant.syncMode();
}

function captureNovelaiValues() {
    for (const [key, field] of Object.entries(NOVELAI_FIELDS)) {
        if (field.disabled) continue;
        novelaiValues[key] = field.type === 'checkbox' ? field.checked
            : field.type === 'number' ? (field.value === '' ? NOVELAI_DEFAULTS[key] : Number(field.value)) : field.value;
    }
}

function syncNovelaiControls({ capture = true } = {}) {
    if (capture) captureNovelaiValues();
    const isNovelai = els.provider.value === 'novelai';
    const caps = novelaiCapabilities(els.model.value);
    const setControl = (key, supported, fixed = null) => {
        const field = NOVELAI_FIELDS[key];
        field.disabled = !supported;
        if (field.type === 'checkbox') field.checked = supported && Boolean(novelaiValues[key]);
        else field.value = fixed ?? novelaiValues[key];
    };
    setControl('novelaiSteps', !caps.medium, caps.fixedSteps);
    setControl('novelaiSampler', !caps.medium, caps.fixedSampler);
    setControl('novelaiCfgRescale', caps.cfgRescale, caps.cfgRescale ? null : 0);
    setControl('novelaiNegativePrompt', caps.negativePrompt);
    setControl('novelaiDecrisper', caps.decrisper);
    setControl('novelaiVarietyBoost', caps.varietyBoost);
    const smeaAvailable = caps.smea && NOVELAI_FIELDS.novelaiSampler.value !== 'ddim';
    setControl('novelaiSm', smeaAvailable);
    setControl('novelaiSmDyn', smeaAvailable);
    setControl('novelaiEnableReferences', caps.preciseReference);
    const refsEnabled = novelaiReferencesEnabled({ ...novelaiValues, model: els.model.value });
    $('.references-panel').classList.toggle('hidden', isNovelai && !refsEnabled);
    els.novelaiReferenceOptions.classList.toggle('hidden', !refsEnabled);
    $('#novelai-negative-box').classList.toggle('hidden', !caps.negativePrompt);
    const { width, height, steps } = novelaiDimensions({ ...novelaiValues, model: els.model.value });
    const restrictions = caps.medium
        ? 'V5 Medium: 14 шагов, Euler Ancestral, без пользовательского негатива и CFG Rescale.'
        : caps.v5 ? 'V5: шаги, сэмплер, scheduler, CFG и негатив доступны. Референсы, Decrisper, Variety+ и SMEA недоступны.'
            : /^nai-diffusion-4-5(?:-|$)/i.test(els.model.value) ? 'V4.5: доступны Precise Reference, Decrisper и Variety+. SMEA недоступен.'
                : caps.preciseReference ? 'Свой ID модели: совместимость дополнительных параметров и референсов зависит от endpoint.'
                    : 'Референсы Precise Reference для этой модели недоступны.';
    els.novelaiModelHint.textContent = `${restrictions} В запрос пойдёт ${width}×${height}, ${steps} шагов.`;
    els.novelaiReferenceHint.textContent = !caps.preciseReference
        ? 'Precise Reference доступен только на V4.5. Картинки и связанные описания не отправляются.'
        : refsEnabled ? `${/^nai-diffusion-4-5(?:-|$)/i.test(els.model.value) ? '' : 'Для своего ID отправка экспериментальная. '}До 5 референсов. Каждый увеличивает стоимость; несколько персонажей могут смешиваться.`
            : 'Выключено: картинки и связанные описания не отправляются. Наборы сохранены.';
    updateReferenceCount();
    tagAssistant.syncMode();
}

function loadNovelaiNegativePresets() {
    const stored = readJson(localStorage, STORAGE_KEYS.novelaiNegativePresets, null);
    novelaiNegativePresets = Array.isArray(stored) ? stored.filter(item => item && typeof item.id === 'string') : [{
        id: 'default-quality-anatomy', name: 'Качество и анатомия', value: DEFAULT_NOVELAI_NEGATIVE,
    }];
}

function renderNovelaiNegativePresets() {
    els.novelaiNegativePreset.innerHTML = '';
    els.novelaiNegativePreset.append(new Option('Свой текст · без шаблона', ''));
    for (const preset of novelaiNegativePresets) els.novelaiNegativePreset.append(new Option(preset.name, preset.id));
    els.novelaiNegativePreset.value = novelaiValues.novelaiNegativePresetId || '';
    if (els.novelaiNegativePreset.selectedIndex < 0) els.novelaiNegativePreset.value = '';
    novelaiValues.novelaiNegativePresetId = els.novelaiNegativePreset.value;
    const hasPreset = Boolean(els.novelaiNegativePreset.value);
    els.novelaiNegativeSave.disabled = !hasPreset;
    els.novelaiNegativeRename.disabled = !hasPreset;
    els.novelaiNegativeDelete.disabled = !hasPreset;
}

function persistNovelaiNegativePresets() {
    localStorage.setItem(STORAGE_KEYS.novelaiNegativePresets, JSON.stringify(novelaiNegativePresets));
    renderNovelaiNegativePresets();
}

function renderNovelaiTagPresets() {
    els.novelaiTagList.replaceChildren();
    for (const preset of novelaiTagPresets) {
        const row = document.createElement('div');
        row.className = 'novelai-tag-row';
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.checked = preset.enabled !== false;
        enabled.setAttribute('aria-label', 'Включить замену');
        const name = document.createElement('input');
        name.placeholder = 'Имя или ключ';
        name.value = preset.name || '';
        const value = document.createElement('textarea');
        value.placeholder = 'Теги, которые подставить';
        value.value = preset.value || '';
        const remove = document.createElement('button');
        remove.className = 'icon-button danger';
        remove.textContent = '×';
        remove.title = 'Удалить замену';
        enabled.addEventListener('change', () => { preset.enabled = enabled.checked; });
        name.addEventListener('input', () => { preset.name = name.value.trim(); });
        value.addEventListener('input', () => { preset.value = value.value.trim(); });
        remove.addEventListener('click', () => {
            novelaiTagPresets = novelaiTagPresets.filter(item => item !== preset);
            renderNovelaiTagPresets();
        });
        row.append(enabled, name, remove, value);
        els.novelaiTagList.append(row);
    }
}

function syncProxyFields() {
    els.proxyFields.classList.toggle('hidden', !els.proxyEnabled.checked);
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
        const request = indexedDB.open('local-image-studio', 2);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('references')) db.createObjectStore('references', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('promptLibrary')) db.createObjectStore('promptLibrary', { keyPath: 'id' });
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
        let result;
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('Операция с базой отменена')); };
        try { request = operation(store); } catch (error) { tx.abort(); reject(error); return; }
        request.onsuccess = () => { result = request.result; };
    });
}

const dbGetAll = store => dbRequest(store, 'readonly', objectStore => objectStore.getAll());
const dbGet = (store, key) => dbRequest(store, 'readonly', objectStore => objectStore.get(key));
const dbPut = (store, value) => dbRequest(store, 'readwrite', objectStore => objectStore.put(value));
const dbDelete = (store, key) => dbRequest(store, 'readwrite', objectStore => objectStore.delete(key));

async function savePromptLibrary(records) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('promptLibrary', 'readwrite');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('Не удалось сохранить библиотеку')); };
        for (const record of records) tx.objectStore('promptLibrary').put(record);
    });
}

async function historyTransaction(operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('history', 'readwrite');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('Не удалось изменить историю')); };
        try { operation(tx.objectStore('history')); } catch (error) { tx.abort(); reject(error); }
    });
}

async function historyMetadata() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const entries = [];
        const tx = db.transaction('history', 'readonly');
        tx.oncomplete = () => { db.close(); resolve(entries); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('Не удалось прочитать историю')); };
        const request = tx.objectStore('history').openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            // Keep only metadata in memory; full images are loaded for the visible page.
            const { dataUrl, ...metadata } = cursor.value;
            entries.push(metadata);
            cursor.continue();
        };
    });
}

function currentReferenceProfile() {
    return referenceProfiles.find(profile => profile.id === activeReferenceProfileId) || referenceProfiles[0];
}

function persistReferenceProfiles() {
    localStorage.setItem(STORAGE_KEYS.referenceProfiles, JSON.stringify(referenceProfiles));
    localStorage.setItem(STORAGE_KEYS.activeReferenceProfile, activeReferenceProfileId);
}

function loadReferenceProfiles() {
    const stored = readJson(localStorage, STORAGE_KEYS.referenceProfiles, []);
    const validIds = new Set(references.map(reference => reference.id));
    referenceProfiles = Array.isArray(stored) ? stored.map(profile => ({
        id: profile.id || crypto.randomUUID(),
        name: String(profile.name || 'Без названия'),
        referenceIds: [...new Set(Array.isArray(profile.referenceIds) ? profile.referenceIds : [])]
            .filter(id => validIds.has(id)),
    })) : [];
    if (!referenceProfiles.length) {
        referenceProfiles = [{
            id: crypto.randomUUID(),
            name: 'Основные референсы',
            referenceIds: references.filter(reference => reference.enabled !== false).map(reference => reference.id),
        }];
    }
    activeReferenceProfileId = localStorage.getItem(STORAGE_KEYS.activeReferenceProfile) || referenceProfiles[0].id;
    if (!referenceProfiles.some(profile => profile.id === activeReferenceProfileId)) {
        activeReferenceProfileId = referenceProfiles[0].id;
    }
    persistReferenceProfiles();
}

function isReferenceEnabled(referenceId) {
    return currentReferenceProfile()?.referenceIds.includes(referenceId) || false;
}

function setReferenceEnabled(referenceId, enabled) {
    const profile = currentReferenceProfile();
    if (!profile) return;
    const ids = new Set(profile.referenceIds);
    if (enabled) ids.add(referenceId);
    else ids.delete(referenceId);
    profile.referenceIds = [...ids];
    persistReferenceProfiles();
    renderReferenceProfileOptions();
}

function addReferenceToActiveProfile(referenceId) {
    setReferenceEnabled(referenceId, true);
}

function renderReferenceProfileOptions() {
    els.referenceProfileSelect.innerHTML = '';
    const validIds = new Set(references.map(reference => reference.id));
    for (const profile of referenceProfiles) {
        const count = profile.referenceIds.filter(id => validIds.has(id)).length;
        const option = new Option(`${profile.name} · ${count}`, profile.id);
        option.selected = profile.id === activeReferenceProfileId;
        els.referenceProfileSelect.add(option);
    }
    els.referenceProfileDelete.disabled = referenceProfiles.length <= 1;
}

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
            addReferenceToActiveProfile(entry.id);
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
    const canSend = els.provider.value !== 'novelai'
        || novelaiReferencesEnabled({ ...novelaiValues, model: els.model.value });
    const active = canSend ? references.filter(reference => isReferenceEnabled(reference.id)).length : 0;
    els.referenceCount.textContent = active === references.length ? String(active) : `${active}/${references.length}`;
}

function renderReferences() {
    els.referenceList.innerHTML = '';
    for (const reference of references) {
        const card = els.referenceTemplate.content.firstElementChild.cloneNode(true);
        card.dataset.id = reference.id;
        card.classList.toggle('enabled', isReferenceEnabled(reference.id));
        const image = card.querySelector('img');
        image.src = reference.dataUrl;
        image.alt = reference.label || reference.name;
        const labelInput = card.querySelector('.reference-label');
        const descriptionInput = card.querySelector('.reference-description');
        labelInput.value = reference.label || '';
        descriptionInput.value = reference.description || '';

        card.querySelector('.reference-toggle').addEventListener('click', () => {
            const enabled = !isReferenceEnabled(reference.id);
            setReferenceEnabled(reference.id, enabled);
            card.classList.toggle('enabled', enabled);
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
            for (const profile of referenceProfiles) {
                profile.referenceIds = profile.referenceIds.filter(id => id !== reference.id);
            }
            persistReferenceProfiles();
            renderReferenceProfileOptions();
            renderReferences();
        });
        els.referenceList.append(card);
    }
    updateReferenceCount();
}

async function loadReferences() {
    references = (await dbGetAll('references')).sort((a, b) => b.createdAt - a.createdAt);
    loadReferenceProfiles();
    renderReferenceProfileOptions();
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
    els.resultMeta.textContent = [entry.width && entry.height ? `${entry.width}×${entry.height}` : '', entry.seed == null ? '' : `Seed: ${entry.seed}`].filter(Boolean).join(' · ');
    els.resultMeta.classList.toggle('hidden', !els.resultMeta.textContent);
    setGenerating(false);
    artistClassifier.refresh();
}

function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
}

function downloadEntry(entry) {
    downloadDataUrl(entry.dataUrl, entry.archive?.fileName || `image-${new Date(entry.createdAt).toISOString().replace(/[:.]/g, '-')}.png`);
}

async function addResultReference(result) {
    const entry = {
        id: crypto.randomUUID(), name: `result-${result.id}.png`, label: (result.prompt || '').slice(0, 80),
        description: '', dataUrl: result.dataUrl, enabled: true, createdAt: Date.now(),
    };
    await dbPut('references', entry);
    references.unshift(entry);
    addReferenceToActiveProfile(entry.id);
    renderReferences();
    showMessage('Результат добавлен в референсы', 'success');
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
    if (profile.provider === 'novelai' && !profile.apiKey) {
        showMessage('Вставь свой Persistent API Token NovelAI в поле API-ключа');
        els.apiKey.focus();
        return;
    }
    generationController = new AbortController();
    const controller = generationController;
    setGenerating(true);
    const refsAllowed = profile.provider !== 'novelai' || novelaiReferencesEnabled(profile);
    let activeRefs = (refsAllowed ? references : []).filter(reference => isReferenceEnabled(reference.id)).map(reference => ({
        dataUrl: reference.dataUrl,
        label: reference.label,
        description: reference.description,
    }));
    const prompt = els.prompt.value.trim();
    const prefix = els.prefix.value.trim();
    const negativePrompt = profile.provider === 'novelai' ? profile.novelaiNegativePrompt : els.negativePrompt.value.trim();
    try {
        const compiled = promptLibrary.compile({ prompt, prefix, negativePrompt, novelai: profile.provider === 'novelai',
            supportsNegative: profile.provider !== 'novelai' || novelaiCapabilities(profile.model).negativePrompt });
        const requestProfile = profile.provider === 'novelai' ? { ...profile, novelaiNegativePrompt: compiled.negativePrompt } : profile;
        if (profile.provider === 'novelai') {
            activeRefs = await Promise.all(activeRefs.slice(0, 5).map(async reference => ({
                ...reference, dataUrl: await normalizeNovelaiReference(reference.dataUrl),
            })));
        }
        if (controller.signal.aborted) throw new DOMException('Generation cancelled', 'AbortError');
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                profile: requestProfile,
                prompt: compiled.prompt,
                prefix: compiled.prefix,
                negativePrompt: compiled.negativePrompt,
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
            id: result.id || crypto.randomUUID(),
            dataUrl: result.dataUrl,
            provider: result.provider || profile.provider,
            model: result.model || profile.model,
            profileName: profile.name,
            prompt,
            prefix,
            negativePrompt: result.negativePrompt ?? negativePrompt,
            resolvedPrompt: compiled.prompt,
            resolvedPrefix: compiled.prefix,
            sourceNegativePrompt: negativePrompt,
            createdAt: result.createdAt || Date.now(),
            archive: result.archive,
            referenceCount: result.referenceCount ?? activeRefs.length,
            seed: result.seed,
            width: result.width,
            height: result.height,
        };
        await dbPut('history', entry);
        displayResult(entry);
        await renderHistory();
        if (result.archiveError) showMessage(`Изображение готово. ${result.archiveError}. Оно осталось в истории браузера.`);
        else showMessage(result.archive?.fileName ? 'Изображение готово и сохранено в папку' : 'Изображение готово', 'success');
    } catch (error) {
        if (error.name === 'AbortError') showMessage('Генерация остановлена');
        else showMessage(error.message || String(error));
        setGenerating(false);
    } finally {
        generationController = null;
    }
}

async function renderHistory() {
    historyEntries = (await historyMetadata()).sort((a, b) => b.createdAt - a.createdAt);
    if (!historyEntries.length) historySelectionMode = false;
    const validIds = new Set(historyEntries.map(entry => entry.id));
    for (const id of selectedHistoryIds) if (!validIds.has(id)) selectedHistoryIds.delete(id);
    applyHistoryFilters();
}

function syncHistoryControls() {
    const pages = Math.ceil(filteredHistoryEntries.length / HISTORY_PAGE_SIZE);
    els.historySelect.textContent = historySelectionMode ? 'Отмена выбора' : 'Выбрать';
    els.historySelect.disabled = historyBusy || !historyEntries.length;
    els.historySelection.classList.toggle('hidden', !historySelectionMode);
    els.historySelectedCount.textContent = `Выбрано: ${selectedHistoryIds.size}`;
    els.historyDeleteSelected.textContent = `Удалить выбранные (${selectedHistoryIds.size})`;
    els.historyDeleteSelected.disabled = historyBusy || !selectedHistoryIds.size;
    els.historyDeselect.disabled = historyBusy || !selectedHistoryIds.size;
    els.historySelectPage.disabled = historyBusy || !filteredHistoryEntries.length;
    els.clearHistory.disabled = historyBusy || !historyEntries.length;
    els.openImageFolder.disabled = historyBusy;
    els.historyPagination.classList.toggle('hidden', pages <= 1);
    els.historyPageLabel.textContent = `${historyPage + 1} / ${pages || 1} · ${filteredHistoryEntries.length} изображений`;
    els.historyPage.max = String(pages || 1);
    els.historyPage.value = String(historyPage + 1);
    els.historyPage.disabled = historyBusy;
    els.historyPrevious.disabled = historyBusy || historyPage === 0;
    els.historyNext.disabled = historyBusy || historyPage + 1 >= pages;
    els.historyPages.replaceChildren();
    let previous = -1;
    for (const page of pageNumbers(historyPage, pages)) {
        if (page > previous + 1) {
            const gap = document.createElement('span');
            gap.textContent = '…';
            els.historyPages.append(gap);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-page-number';
        button.textContent = String(page + 1);
        button.setAttribute('aria-label', `Страница ${page + 1}`);
        if (page === historyPage) button.setAttribute('aria-current', 'page');
        button.disabled = historyBusy;
        button.addEventListener('click', () => goToHistoryPage(page));
        els.historyPages.append(button);
        previous = page;
    }
    for (const card of els.historyList.children) {
        const selected = selectedHistoryIds.has(card.dataset.id);
        card.classList.toggle('selected', selected);
        const checkbox = card.querySelector('input');
        checkbox.checked = selected;
        checkbox.disabled = historyBusy;
        card.querySelector('.history-checkbox').classList.toggle('hidden', !historySelectionMode);
        card.querySelector('.history-delete').classList.toggle('hidden', historySelectionMode);
        card.querySelector('.history-delete').disabled = historyBusy;
    }
}

function toggleHistorySelection(id) {
    if (historyBusy) return;
    if (selectedHistoryIds.has(id)) selectedHistoryIds.delete(id);
    else selectedHistoryIds.add(id);
    syncHistoryControls();
}

function useHistoryEntry(entry) {
    if (!generationController) displayResult(entry);
    els.prompt.value = entry.resolvedPrompt ?? entry.prompt ?? '';
    els.prefix.value = entry.resolvedPrefix ?? entry.prefix ?? '';
    if (els.provider.value === 'novelai') {
        NOVELAI_FIELDS.novelaiNegativePrompt.value = entry.negativePrompt || '';
        novelaiValues.novelaiNegativePrompt = entry.negativePrompt || '';
    } else els.negativePrompt.value = entry.negativePrompt || '';
    saveDraftSoon();
    promptLibrary.textChanged();
    els.prompt.closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyHistoryFilters({ resetPage = false } = {}) {
    filteredHistoryEntries = filterHistory(historyEntries, {
        search: els.historySearch.value, provider: els.historyProvider.value,
        date: els.historyDate.value, order: els.historyOrder.value,
    });
    if (resetPage) historyPage = 0;
    historyPage = Math.max(0, Math.min(historyPage, Math.ceil(filteredHistoryEntries.length / HISTORY_PAGE_SIZE) - 1));
    const filtered = Boolean(els.historySearch.value || els.historyProvider.value || els.historyDate.value || els.historyOrder.value !== 'newest');
    els.historyReset.classList.toggle('hidden', !filtered);
    els.historyCount.textContent = filtered ? `Найдено: ${filteredHistoryEntries.length} из ${historyEntries.length}` : `Всего: ${historyEntries.length}`;
    els.historyEmpty.textContent = historyEntries.length ? 'Ничего не найдено. Попробуй другой запрос или сбрось фильтры.' : 'История пуста. Здесь появятся твои генерации.';
    els.historyEmpty.classList.toggle('hidden', filteredHistoryEntries.length > 0);
    paintHistoryPage();
}

function goToHistoryPage(page) {
    if (historyBusy || !Number.isFinite(page)) return;
    historyPage = Math.max(0, Math.min(Math.trunc(page), Math.ceil(filteredHistoryEntries.length / HISTORY_PAGE_SIZE) - 1));
    paintHistoryPage();
}

function paintHistoryPage() {
    els.historyList.innerHTML = '';
    for (const entry of filteredHistoryEntries.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)) {
        const card = document.createElement('article');
        card.className = 'history-item';
        card.dataset.id = entry.id;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-preview';
        button.title = entry.prompt || '';
        button.setAttribute('aria-label', `Открыть: ${entry.prompt || entry.model || 'изображение'}`);
        const image = new Image();
        image.alt = entry.prompt || '';
        image.loading = 'lazy';
        const label = document.createElement('span');
        label.className = 'history-caption';
        const captionTitle = document.createElement('strong');
        captionTitle.textContent = entry.prompt || entry.model || 'Изображение';
        const captionMeta = document.createElement('span');
        captionMeta.textContent = `${new Date(entry.createdAt).toLocaleDateString('ru-RU')} · ${entry.model || entry.profileName || 'image'}`;
        label.append(captionTitle, captionMeta);
        button.append(image, label);
        button.addEventListener('click', () => {
            if (historySelectionMode) toggleHistorySelection(entry.id);
            else imageViewer.open(entry.id, filteredHistoryEntries);
        });
        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = 'history-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', `Выбрать: ${entry.prompt || entry.model || 'изображение'}`);
        checkbox.addEventListener('change', () => toggleHistorySelection(entry.id));
        checkboxLabel.append(checkbox);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'history-delete';
        remove.textContent = '×';
        remove.title = 'Удалить из истории';
        remove.setAttribute('aria-label', 'Удалить это изображение из истории');
        remove.addEventListener('click', () => deleteHistoryEntries([entry.id]));
        card.append(button, checkboxLabel, remove);
        els.historyList.append(card);
        readThumbnail(entry.id, () => image.isConnected).then(dataUrl => {
            if (dataUrl && image.isConnected) image.src = dataUrl;
        }).catch(() => { image.alt = 'Не удалось загрузить изображение'; });
    }
    syncHistoryControls();
}

async function deleteHistoryEntries(ids, { all = false } = {}) {
    if (historyBusy || !ids.length) return;
    const question = all ? `Очистить всю историю (${ids.length} изображений)?`
        : `Удалить из истории ${ids.length === 1 ? 'это изображение' : `выбранные изображения (${ids.length})`}?`;
    if (!confirm(`${question}\nФайлы в папке и изображения в референсах останутся.`)) return;
    historyBusy = true;
    syncHistoryControls();
    try {
        await historyTransaction(store => { for (const id of ids) store.delete(id); });
        for (const id of ids) selectedHistoryIds.delete(id);
        if (currentResult && ids.includes(currentResult.id)) {
            currentResult = null;
            els.resultImage.removeAttribute('src');
            els.resultTitle.textContent = 'Холст';
            els.resultMeta.classList.add('hidden');
            setGenerating(Boolean(generationController));
        }
        await renderHistory();
        showMessage(`Удалено из истории: ${ids.length}. Файлы сохранены.`, 'success');
    } catch (error) { showMessage(`Не удалось удалить изображения: ${error.message}`); }
    finally { historyBusy = false; syncHistoryControls(); }
}

async function postImageAction(route, body = {}) {
    const response = await fetch(route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error([result.error || `Ошибка ${response.status}`, result.details].filter(Boolean).join('\n'));
    return result;
}

async function openImageFolder() {
    if (historyBusy) return;
    historyBusy = true;
    syncHistoryControls();
    const originalLabel = els.openImageFolder.textContent;
    els.historyFolderHint.classList.remove('hidden');
    const failed = [];
    try {
        const missing = (await historyMetadata()).filter(entry => !entry.archive?.fileName);
        for (let index = 0; index < missing.length; index++) {
            els.openImageFolder.textContent = `Сохраняю ${index + 1}/${missing.length}…`;
            els.historyFolderHint.textContent = 'Копирую старые изображения из браузера в папку. История и референсы останутся на месте.';
            try {
                const entry = await dbGet('history', missing[index].id);
                if (!entry) continue;
                const archive = await postImageAction('/api/images/archive', { id: entry.id, dataUrl: entry.dataUrl, createdAt: entry.createdAt });
                await historyTransaction(store => {
                    const request = store.get(entry.id);
                    request.onsuccess = () => {
                        if (request.result) store.put({ ...request.result, archive });
                    };
                });
                if (currentResult?.id === entry.id) currentResult.archive = archive;
            } catch (error) { failed.push(error.message); }
        }
        els.openImageFolder.textContent = 'Открываю…';
        const result = await postImageAction('/api/images/open-folder');
        els.historyFolderHint.textContent = `Папка: ${result.folderPath}. Открывается на компьютере, где запущен Image Studio.`;
        if (failed.length) showMessage(`Папка открыта, но ${failed.length} старых изображений не сохранились: ${failed[0]}`);
    } catch (error) {
        els.historyFolderHint.textContent = `Не удалось открыть папку: ${error.message}`;
        showMessage(error.message || String(error));
    } finally {
        els.openImageFolder.textContent = originalLabel;
        historyBusy = false;
        await renderHistory().catch(error => showMessage(error.message));
    }
}

async function testNovelaiKey() {
    saveActiveProfile({ notify: false });
    els.novelaiTestKey.disabled = true;
    clearMessage();
    try {
        const response = await fetch('/api/novelai/status', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: currentProfile() }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error([result.error, result.details].filter(Boolean).join('\n'));
        const balance = result.anlas;
        const amount = balance ? Number(balance.fixedTrainingStepsLeft || 0) + Number(balance.purchasedTrainingSteps || 0) : null;
        showMessage(`Ключ NovelAI работает${result.active === false ? ' · подписка неактивна' : ''}${amount == null ? '' : ` · Anlas: ${amount}`}`, 'success');
    } catch (error) {
        showMessage(error.message || String(error));
    } finally {
        els.novelaiTestKey.disabled = false;
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
        showMessage(`${result.catalog ? 'Встроенный список моделей' : 'Загружено моделей'}: ${result.models?.length || 0}`, 'success');
        els.model.focus();
    } catch (error) {
        showMessage(error.message || String(error));
    } finally {
        els.loadModels.disabled = false;
        els.loadModels.textContent = '↻';
    }
}

function bindEvents() {
    els.modeStandard.addEventListener('click', () => switchMode('standard'));
    els.modeNovelai.addEventListener('click', () => switchMode('novelai'));
    els.profileSelect.addEventListener('change', () => {
        const selectedId = els.profileSelect.value;
        saveActiveProfile({ notify: false });
        activeProfileId = selectedId;
        persistProfiles();
        renderProfileOptions();
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
        if (profiles.filter(profile => profileMode(profile) === activeMode).length <= 1) {
            return showMessage('Нельзя удалить единственный профиль этого режима');
        }
        if (!confirm(`Удалить профиль «${currentProfile().name}»?`)) return;
        profiles = profiles.filter(profile => profile.id !== activeProfileId);
        activeProfileId = profiles.find(profile => profileMode(profile) === activeMode).id;
        persistProfiles();
        renderProfileOptions();
        putProfileIntoForm(currentProfile());
    });
    els.provider.addEventListener('change', (event) => {
        const previousProvider = els.provider.dataset.current || currentProfile().provider;
        const oldDefault = PROVIDER_DEFAULTS[previousProvider];
        if (!els.endpoint.value.trim() || els.endpoint.value.trim() === oldDefault) {
            els.endpoint.value = PROVIDER_DEFAULTS[event.target.value];
        }
        const profile = currentProfile();
        profile.modelsByProvider = { ...profile.modelsByProvider, [previousProvider]: els.model.value };
        els.model.value = profile.modelsByProvider[event.target.value]
            || (event.target.value === 'novelai' ? 'nai-diffusion-4-5-full' : '');
        els.provider.dataset.current = event.target.value;
        syncProviderFields();
        syncNovelaiControls();
    });
    els.toggleKey.addEventListener('click', () => {
        els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
    });
    els.proxyEnabled.addEventListener('change', syncProxyFields);
    els.toggleProxyPassword.addEventListener('click', () => {
        els.proxyPassword.type = els.proxyPassword.type === 'password' ? 'text' : 'password';
    });
    els.loadModels.addEventListener('click', loadModelList);
    els.model.addEventListener('input', () => syncNovelaiControls());
    for (const field of Object.values(NOVELAI_FIELDS)) {
        field.addEventListener('change', () => syncNovelaiControls());
    }
    els.novelaiTestKey.addEventListener('click', testNovelaiKey);
    els.novelaiNegativePreset.addEventListener('change', () => {
        novelaiValues.novelaiNegativePresetId = els.novelaiNegativePreset.value;
        const preset = novelaiNegativePresets.find(item => item.id === els.novelaiNegativePreset.value);
        if (preset) {
            novelaiValues.novelaiNegativePrompt = preset.value;
            NOVELAI_FIELDS.novelaiNegativePrompt.value = preset.value;
        }
        renderNovelaiNegativePresets();
    });
    els.novelaiNegativeNew.addEventListener('click', () => {
        const name = window.prompt('Название шаблона негатива')?.trim();
        if (!name) return;
        const preset = { id: crypto.randomUUID(), name, value: NOVELAI_FIELDS.novelaiNegativePrompt.value };
        novelaiNegativePresets.push(preset);
        novelaiValues.novelaiNegativePresetId = preset.id;
        persistNovelaiNegativePresets();
    });
    els.novelaiNegativeSave.addEventListener('click', () => {
        const preset = novelaiNegativePresets.find(item => item.id === els.novelaiNegativePreset.value);
        if (!preset) return;
        preset.value = NOVELAI_FIELDS.novelaiNegativePrompt.value;
        persistNovelaiNegativePresets();
        showMessage('Шаблон негатива сохранён', 'success');
    });
    els.novelaiNegativeRename.addEventListener('click', () => {
        const preset = novelaiNegativePresets.find(item => item.id === els.novelaiNegativePreset.value);
        if (!preset) return;
        const name = window.prompt('Новое название шаблона', preset.name)?.trim();
        if (!name) return;
        preset.name = name;
        persistNovelaiNegativePresets();
    });
    els.novelaiNegativeDelete.addEventListener('click', () => {
        const preset = novelaiNegativePresets.find(item => item.id === els.novelaiNegativePreset.value);
        if (!preset || !confirm(`Удалить шаблон «${preset.name}»? Текущий текст останется.`)) return;
        novelaiNegativePresets = novelaiNegativePresets.filter(item => item.id !== preset.id);
        novelaiValues.novelaiNegativePresetId = '';
        persistNovelaiNegativePresets();
    });
    els.novelaiTagAdd.addEventListener('click', () => {
        novelaiTagPresets.push({ id: crypto.randomUUID(), enabled: true, name: '', value: '' });
        renderNovelaiTagPresets();
    });

    els.referenceProfileSelect.addEventListener('change', () => {
        activeReferenceProfileId = els.referenceProfileSelect.value;
        persistReferenceProfiles();
        renderReferences();
    });
    els.referenceProfileNew.addEventListener('click', () => {
        const source = currentReferenceProfile();
        const suggested = source ? `${source.name} — копия` : 'Новый набор';
        const name = window.prompt('Название набора референсов', suggested)?.trim();
        if (!name) return;
        const profile = {
            id: crypto.randomUUID(),
            name,
            referenceIds: [...(source?.referenceIds || [])],
        };
        referenceProfiles.push(profile);
        activeReferenceProfileId = profile.id;
        persistReferenceProfiles();
        renderReferenceProfileOptions();
        renderReferences();
        showMessage('Набор референсов создан', 'success');
    });
    els.referenceProfileRename.addEventListener('click', () => {
        const profile = currentReferenceProfile();
        if (!profile) return;
        const name = window.prompt('Новое название набора', profile.name)?.trim();
        if (!name) return;
        profile.name = name;
        persistReferenceProfiles();
        renderReferenceProfileOptions();
    });
    els.referenceProfileDelete.addEventListener('click', () => {
        if (referenceProfiles.length <= 1) return showMessage('Нельзя удалить единственный набор');
        const profile = currentReferenceProfile();
        if (!profile || !confirm(`Удалить набор «${profile.name}»? Сами картинки останутся в галерее.`)) return;
        referenceProfiles = referenceProfiles.filter(item => item.id !== profile.id);
        activeReferenceProfileId = referenceProfiles[0].id;
        persistReferenceProfiles();
        renderReferenceProfileOptions();
        renderReferences();
    });

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
        if (artistClassifier.isActive) return;
        const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
        if (files.length) addReferenceFiles(files);
    });

    for (const field of [els.prefix, els.prompt, els.negativePrompt]) field.addEventListener('input', saveDraftSoon);
    els.generate.addEventListener('click', generate);
    els.cancel.addEventListener('click', () => generationController?.abort());
    document.addEventListener('keydown', event => {
        if (imageViewer.isOpen || artistClassifier.isActive) return;
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            if (!els.generate.disabled) generate();
        }
    });
    els.downloadResult.addEventListener('click', () => {
        if (!currentResult) return;
        downloadEntry(currentResult);
    });
    const expandResult = () => {
        if (currentResult) imageViewer.open(currentResult.id, filteredHistoryEntries.some(entry => entry.id === currentResult.id) ? filteredHistoryEntries : [currentResult]);
    };
    els.expandResult.addEventListener('click', expandResult);
    els.resultImage.addEventListener('click', expandResult);
    els.resultToReference.addEventListener('click', async () => {
        if (!currentResult) return;
        try { await addResultReference(currentResult); }
        catch (error) { showMessage(error.message); }
    });
    els.openImageFolder.addEventListener('click', openImageFolder);
    els.historySelect.addEventListener('click', () => {
        if (historyBusy) return;
        historySelectionMode = !historySelectionMode;
        if (!historySelectionMode) selectedHistoryIds.clear();
        syncHistoryControls();
    });
    els.historySelectPage.addEventListener('click', () => {
        for (const entry of filteredHistoryEntries.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)) selectedHistoryIds.add(entry.id);
        syncHistoryControls();
    });
    els.historyDeselect.addEventListener('click', () => { selectedHistoryIds.clear(); syncHistoryControls(); });
    els.historyDeleteSelected.addEventListener('click', () => deleteHistoryEntries([...selectedHistoryIds]));
    els.clearHistory.addEventListener('click', () => deleteHistoryEntries(historyEntries.map(entry => entry.id), { all: true }));
    els.historyPrevious.addEventListener('click', () => goToHistoryPage(historyPage - 1));
    els.historyNext.addEventListener('click', () => goToHistoryPage(historyPage + 1));
    els.historySearch.addEventListener('input', () => applyHistoryFilters({ resetPage: true }));
    for (const field of [els.historyProvider, els.historyDate, els.historyOrder]) field.addEventListener('change', () => applyHistoryFilters({ resetPage: true }));
    const jumpPage = () => goToHistoryPage(Number(els.historyPage.value) - 1);
    els.historyPage.addEventListener('change', jumpPage);
    els.historyPage.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); jumpPage(); } });
    els.historyReset.addEventListener('click', () => {
        for (const field of [els.historySearch, els.historyProvider, els.historyDate]) field.value = '';
        els.historyOrder.value = 'newest';
        applyHistoryFilters({ resetPage: true });
    });
}

async function init() {
    for (const [key, options] of [
        ['novelaiSampler', NOVELAI_SAMPLERS], ['novelaiScheduler', NOVELAI_SCHEDULERS],
    ]) {
        for (const value of options) NOVELAI_FIELDS[key].append(new Option(value, value));
    }
    for (const size of NOVELAI_SIZES) NOVELAI_FIELDS.novelaiSize.append(new Option(size.label, size.value));
    loadNovelaiNegativePresets();
    loadProfiles();
    renderProfileOptions();
    putProfileIntoForm(currentProfile());
    loadDraft();
    bindEvents();
    try {
        await Promise.all([loadReferences(), renderHistory(), promptLibrary.init(), tagAssistant.init()]);
    } catch (error) {
        showMessage(`Не удалось открыть локальную базу: ${error.message}`);
    }
}

init();
