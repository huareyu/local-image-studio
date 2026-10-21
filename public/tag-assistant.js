import { BUILTIN_TAGS } from './novelai-tags.js';
import { createTagIndex, searchTags, tagKey, promptTags,
    findTagQuery, removePromptTag, movePromptTag, changeTagWeight, MAX_DICTIONARY_BYTES } from './tag-tools.js';
import { createTagSearchClient } from './tag-search-client.js';

const STATE_KEY = 'image-studio.tag-assistant.v1';
const PAGE_SIZE = 12;
const node = (tag, className, content) => {
    const element = document.createElement(tag); element.className = className;
    if (content != null) element.textContent = content;
    return element;
};

export function createTagAssistant({ fields, getMode, loadDictionary, saveDictionary, showMessage }) {
    const ui = Object.fromEntries(['assistant', 'enabled', 'target', 'search', 'category', 'results', 'count', 'previous', 'next',
        'page', 'upload', 'reset', 'dictionary', 'current', 'selected', 'left', 'right', 'stronger', 'weaker', 'remove', 'base-status', 'retry']
        .map(id => [id, document.getElementById(`tag-${id}`)]));
    let settings;
    try { settings = JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { settings = {}; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
    const fallbackIndex = createTagIndex(BUILTIN_TAGS);
    let page = 0, selected = -1, mutating = false, busy = false, initialized = false;
    let client = null, loading = null, metadata = null, panelSerial = 0;
    const bindings = [];
    const enabled = () => getMode() === 'novelai';
    const target = () => fields[ui.target.value] || fields.prompt;
    ui.enabled.checked = settings.enabled !== false;
    ui.target.value = Object.hasOwn(fields, settings.target) ? settings.target : 'prompt';
    function persist() {
        try { localStorage.setItem(STATE_KEY, JSON.stringify({ enabled: ui.enabled.checked, target: ui.target.value })); }
        catch { showMessage('Не удалось сохранить настройки подсказок в браузере'); }
    }
    function clearSuggestions(binding) {
        binding.serial = (binding.serial || 0) + 1;
        binding.list.replaceChildren(); binding.matches = []; binding.query = null;
    }
    function applyCatalog(result) {
        metadata = result;
        panelSerial++;
        for (const binding of bindings) clearSuggestions(binding);
        const category = ui.category.value;
        ui.category.replaceChildren(new Option('Все категории', ''));
        for (const name of result.categories) ui.category.add(new Option(name, name));
        if ([...ui.category.options].some(option => option.value === category)) ui.category.value = category;
        page = 0;
        const format = count => count.toLocaleString('ru-RU');
        const summary = `Danbooru: ${format(result.baseCount)} · Всего тегов: ${format(result.total)}`;
        ui['base-status'].textContent = result.warning || summary;
        ui.dictionary.textContent = `${summary} · Русские пояснения: ${result.builtinCount}${result.customCount ? ` · Из файла: ${result.customCount}` : ''}. Это локальный снимок базы, а не официальный словарь NovelAI.`;
        ui.assistant.dataset.catalogReady = 'true';
        ui.assistant.dataset.baseCount = String(result.baseCount);
        ui.retry.classList.toggle('hidden', !result.warning);
        ui.reset.disabled = busy || !result.customCount;
        renderResults();
        for (const binding of bindings) if (document.activeElement?.dataset.field === binding.field.id || document.activeElement === binding.field) suggestions(binding);
    }
    function ensureCatalog() {
        if (loading) return loading;
        ui.assistant.dataset.catalogReady = 'loading';
        ui['base-status'].textContent = 'Загружаю большую базу Danbooru в фоновом режиме…';
        loading = (async () => {
            const record = await loadDictionary();
            client = createTagSearchClient();
            const result = await client.request('init', { custom: record?.tags || [] });
            applyCatalog(result);
            return result;
        })().catch(error => {
            ui.assistant.dataset.catalogReady = 'error';
            ui['base-status'].textContent = `${error.message}. Пока доступны 208 стартовых тегов.`;
            ui.retry.classList.remove('hidden');
            throw error;
        });
        return loading;
    }
    async function queryCatalog(query, options) {
        let service;
        try {
            await ensureCatalog();
            service = client;
            return await service.request('search', { query, options: { ...options, used: [...(options.used || [])] } });
        } catch (error) {
            if (service && service === client) {
                ui.assistant.dataset.catalogReady = 'error';
                ui.assistant.dataset.baseCount = '0';
                ui['base-status'].textContent = `${error.message}. Пока доступны только 208 стартовых тегов.`;
                ui.retry.classList.remove('hidden');
            }
            return searchTags(fallbackIndex, query, options);
        }
    }
    function used(field) { return new Set(promptTags(field.value).map(item => tagKey(item.text))); }
    function emit(field) {
        mutating = true;
        try { field.dispatchEvent(new Event('input', { bubbles: true })); }
        finally { mutating = false; }
    }
    function edit(field, value, start, end) {
        if (!enabled() || field.disabled || field.readOnly) return false;
        field.setRangeText(value, start, end, 'end'); emit(field); return true;
    }
    function appendTag(item) {
        const field = target();
        if (used(field).has(item.key)) return;
        const source = field.value;
        const separator = !source.trim() ? '' : /[,\n]\s*$/.test(source) ? (/\s$/.test(source) ? '' : ' ') : ', ';
        selected = -1;
        if (edit(field, `${separator}${item.tag}, `, source.length, source.length)) { renderResults(); renderCurrent(); }
    }
    function choose(binding, item) {
        const { field, query, source } = binding;
        if (!query || field.value !== source || !enabled() || !ui.enabled.checked) return;
        field.focus({ preventScroll: true });
        const suffix = field.value.slice(query.end).trim() ? '' : ', ';
        edit(field, item.tag + suffix, query.start, query.end);
        clearSuggestions(binding);
    }
    async function suggestions(binding) {
        const { field, list } = binding;
        binding.caret = field.selectionStart;
        clearSuggestions(binding);
        if (!enabled() || !ui.enabled.checked || binding.composing || field.disabled || field.readOnly) return;
        const query = findTagQuery(field.value, field.selectionStart);
        if (!query) return;
        const serial = binding.serial, source = field.value, caret = field.selectionStart;
        const result = await queryCatalog(query.query, { used: used(field), limit: 6 });
        if (serial !== binding.serial || !enabled() || !ui.enabled.checked || field.disabled || field.value !== source || field.selectionStart !== caret) return;
        binding.query = query; binding.source = field.value; binding.highlight = 0;
        binding.matches = result.items;
        for (const [i, item] of binding.matches.entries()) {
            const button = node('button', 'tag-suggestion');
            button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(i === 0));
            button.append(node('strong', '', item.tag), node('small', '', item.desc || `${item.category}${item.count ? ` · ${item.count.toLocaleString('ru-RU')} работ` : ''}`));
            button.addEventListener('pointerdown', event => event.preventDefault());
            button.addEventListener('click', () => choose(binding, item)); list.append(button);
        }
    }
    function attach(field) {
        const list = node('div', 'tag-suggestions');
        list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Подсказки тегов NovelAI');
        list.dataset.field = field.id;
        field.closest('label').after(list);
        const binding = { field, list, matches: [], query: null, source: '', highlight: 0 };
        bindings.push(binding);
        field.addEventListener('input', event => {
            binding.composing = Boolean(event.isComposing);
            if (!event.isComposing) suggestions(binding); else clearSuggestions(binding);
            if (!mutating && field === target()) selected = -1;
            if (field === target()) renderCurrent();
        });
        for (const type of ['focus', 'click']) field.addEventListener(type, () => suggestions(binding));
        field.addEventListener('blur', () => setTimeout(() => {
            const active = document.activeElement;
            if (active !== field && active?.dataset.field !== field.id) clearSuggestions(binding);
        }, 160));
        field.addEventListener('keydown', event => {
            if (event.defaultPrevented || event.isComposing || !list.children.length || !enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'Escape') { event.preventDefault(); clearSuggestions(binding); }
            else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault(); binding.highlight = (binding.highlight + (event.key === 'ArrowDown' ? 1 : -1) + binding.matches.length) % binding.matches.length;
                [...list.children].forEach((button, i) => button.setAttribute('aria-selected', String(i === binding.highlight)));
            } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault(); event.stopPropagation(); choose(binding, binding.matches[binding.highlight]);
            }
        });
    }
    async function renderResults() {
        const serial = ++panelSerial;
        if (!enabled() || !ui.assistant.open) return;
        const field = target();
        ui.results.dataset.loading = 'true';
        ui.results.setAttribute('aria-busy', 'true');
        const result = await queryCatalog(ui.search.value, { category: ui.category.value, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
        if (serial !== panelSerial || !enabled() || !ui.assistant.open || field !== target()) return;
        const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        if (page >= pages) { page = pages - 1; return renderResults(); }
        ui.count.textContent = `Найдено: ${result.total}`;
        ui.page.textContent = `${page + 1} / ${pages}`;
        ui.previous.disabled = page === 0; ui.next.disabled = page === pages - 1;
        ui.results.replaceChildren();
        const present = used(field);
        for (const item of result.items) {
            const button = node('button', 'tag-choice'); button.type = 'button'; button.dataset.tag = item.tag;
            button.title = item.desc || item.tag;
            button.disabled = field.disabled || field.readOnly || present.has(item.key);
            button.append(node('strong', '', `${present.has(item.key) ? '✓ ' : '＋ '}${item.tag}`), node('small', '', item.desc || `${item.category}${item.count ? ` · ${item.count.toLocaleString('ru-RU')} работ` : ''}`));
            button.addEventListener('click', () => appendTag(item)); ui.results.append(button);
        }
        if (!result.total) ui.results.append(node('p', 'hint', 'Такого тега в локальном словаре нет. Можно написать его вручную или импортировать свой словарь.'));
        ui.results.dataset.loading = 'false';
        ui.results.setAttribute('aria-busy', 'false');
    }
    function updateActions() {
        const tags = promptTags(target().value), blocked = target().disabled || target().readOnly || selected < 0 || selected >= tags.length;
        ui.left.disabled = blocked || selected === 0;
        ui.right.disabled = blocked || selected === tags.length - 1;
        for (const id of ['stronger', 'weaker', 'remove']) ui[id].disabled = blocked;
        ui.selected.textContent = target().disabled ? 'Для этой модели поле недоступно' : selected >= 0 && tags[selected]
            ? `Выбрано: ${tags[selected].text.replace(/!macro:([^!]+)!/g, '@$1')}` : `Групп тегов: ${tags.length}. Нажми на группу, чтобы изменить её.`;
    }
    function renderCurrent() {
        if (!enabled() || !ui.assistant.open) return;
        const field = target(), tags = promptTags(field.value);
        if (selected >= tags.length) selected = -1;
        ui.current.replaceChildren();
        for (const [i, tag] of tags.slice(0, 60).entries()) {
            const button = node('button', 'tag-current-token', tag.text.replace(/!macro:([^!]+)!/g, '@$1'));
            button.type = 'button'; button.title = tag.text; button.dataset.index = String(i);
            button.setAttribute('aria-pressed', String(selected === i)); button.disabled = field.disabled || field.readOnly;
            button.draggable = !button.disabled;
            button.addEventListener('click', () => { selected = i; renderCurrent(); ui.current.querySelector(`[data-index="${i}"]`)?.focus({ preventScroll: true }); });
            button.addEventListener('dragstart', event => event.dataTransfer.setData('application/x-image-studio-tag', JSON.stringify({ field: field.id, value: field.value, index: i })));
            button.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-image-studio-tag')) event.preventDefault(); });
            button.addEventListener('drop', event => {
                event.preventDefault();
                try { const data = JSON.parse(event.dataTransfer.getData('application/x-image-studio-tag'));
                    if (data.field === field.id && data.value === field.value) move(data.index, i);
                } catch { /* Ignore external drops. */ }
            });
            button.addEventListener('keydown', event => {
                if (event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                    event.preventDefault(); move(i, i + (event.key === 'ArrowLeft' ? -1 : 1));
                }
            });
            ui.current.append(button);
        }
        if (tags.length > 60) ui.current.append(node('p', 'hint', 'Здесь показаны первые 60 групп. Остальной текст остаётся в промпте без изменений.'));
        updateActions();
    }
    function replaceAll(value) {
        const field = target();
        edit(field, value, 0, field.value.length); renderCurrent(); renderResults();
        for (const binding of bindings) clearSuggestions(binding);
    }
    function move(from, to) {
        const field = target(), tags = promptTags(field.value);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= tags.length || to >= tags.length) return;
        selected = to; replaceAll(movePromptTag(field.value, from, to));
        ui.current.querySelector(`[data-index="${selected}"]`)?.focus({ preventScroll: true });
    }
    function weight(stronger) {
        const field = target(), tag = promptTags(field.value)[selected];
        if (!tag) return;
        edit(field, changeTagWeight(tag.text, stronger), tag.start, tag.end); renderCurrent();
    }
    async function importFile(file) {
        if (!file || busy) return;
        if (file.size > MAX_DICTIONARY_BYTES) return showMessage('Выбери словарь до 25 МБ (до 250 000 тегов)');
        busy = true; ui.upload.disabled = true; ui.reset.disabled = true;
        try {
            await ensureCatalog();
            const tags = await client.request('parse', { text: await file.text(), filename: file.name });
            await saveDictionary(tags);
            applyCatalog(await client.request('set-custom', { tags }));
            showMessage(`Добавлен словарь: ${tags.length} тегов. Промпт не изменён.`, 'success');
        } catch (error) { showMessage(`Не удалось загрузить словарь: ${error.message}`); }
        finally { busy = false; ui.upload.disabled = false; ui.reset.disabled = !metadata?.customCount; }
    }
    ui.assistant.addEventListener('toggle', () => { renderResults(); renderCurrent(); });
    ui.enabled.addEventListener('change', () => { persist(); for (const binding of bindings) clearSuggestions(binding); });
    ui.target.addEventListener('change', () => { selected = -1; persist(); renderResults(); renderCurrent(); });
    ui.search.addEventListener('input', () => { page = 0; renderResults(); });
    ui.category.addEventListener('change', () => { page = 0; renderResults(); });
    ui.previous.addEventListener('click', () => { page--; renderResults(); });
    ui.next.addEventListener('click', () => { page++; renderResults(); });
    ui.left.addEventListener('click', () => move(selected, selected - 1));
    ui.right.addEventListener('click', () => move(selected, selected + 1));
    ui.stronger.addEventListener('click', () => weight(true));
    ui.weaker.addEventListener('click', () => weight(false));
    ui.remove.addEventListener('click', () => { if (selected >= 0) { const value = removePromptTag(target().value, selected); selected = -1; replaceAll(value); } });
    ui.upload.addEventListener('change', () => { const file = ui.upload.files[0]; ui.upload.value = ''; importFile(file); });
    ui.reset.addEventListener('click', async () => {
        if (busy || !confirm('Убрать импортированный словарь? Встроенные теги, промпты и чанки останутся.')) return;
        busy = true; ui.reset.disabled = true; ui.upload.disabled = true;
        try { await ensureCatalog(); await saveDictionary([]); applyCatalog(await client.request('set-custom', { tags: [] })); }
        catch (error) { showMessage(error.message); }
        finally { busy = false; ui.reset.disabled = !metadata?.customCount; ui.upload.disabled = false; }
    });
    ui.retry.addEventListener('click', () => {
        if (busy || ui.assistant.dataset.catalogReady === 'loading') return;
        client?.close(); client = null; loading = null; metadata = null;
        ensureCatalog().then(() => { for (const binding of bindings) if (document.activeElement?.dataset.field === binding.field.id) suggestions(binding); }).catch(() => {});
    });
    document.addEventListener('selectionchange', () => {
        if (!enabled() || !ui.enabled.checked) return;
        const active = document.activeElement;
        const binding = bindings.find(item => active === item.field || active?.dataset.field === item.field.id);
        if (binding && binding.caret !== binding.field.selectionStart) {
            binding.caret = binding.field.selectionStart; suggestions(binding);
        }
    });
    return {
        syncMode() {
            ui.assistant.classList.toggle('hidden', !enabled());
            for (const binding of bindings) clearSuggestions(binding);
            if (initialized && enabled()) ensureCatalog().catch(() => {});
            renderResults(); renderCurrent();
        },
        async init() {
            for (const field of Object.values(fields)) attach(field);
            initialized = true;
            if (enabled()) await ensureCatalog().catch(() => {});
            this.syncMode(); ui.assistant.dataset.ready = 'true';
        },
    };
}
