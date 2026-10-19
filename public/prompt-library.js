import { chunkToken, expandPromptChunks, findChunkQuery, renameChunkReferences, compilePromptText } from './prompt-tools.js';
import { createChunkEditor, chunkHue } from './chunk-editor.js';

const STATE_KEY = 'image-studio.prompt-library-state.v1';
const PAGE_SIZE = 6;
const $ = id => document.getElementById(id);
const text = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
};

async function thumbnail(dataUrl) {
    const image = new Image();
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось прочитать превью'));
        image.src = dataUrl;
    });
    const scale = Math.min(1, 384 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', .82);
}

export function createPromptLibrary({ dbGetAll, dbSave, dbDelete, getMode, prefixField, promptField, negativeField,
    getNegative, setNegative, getResult, onTextChanged, showMessage }) {
    const ui = Object.fromEntries(['context', 'styles-tab', 'chunks-tab', 'new', 'search', 'category', 'categories',
        'grid', 'previous', 'next', 'page', 'editor', 'editor-title', 'name', 'folder', 'tags', 'text', 'use-negative',
        'negative', 'negative-box', 'preview-box', 'preview', 'preview-upload', 'preview-result', 'preview-clear',
        'save', 'cancel', 'delete', 'help'].map(key => [key, $(`library-${key}`)]));
    let records = [];
    let initialized = false;
    let kind = '';
    let tab = 'style';
    let page = 0;
    let editingId = null;
    let preview = '';
    let busy = false;
    let lastField = promptField;
    let previewSerial = 0;
    let previewBusy = false;
    const bindings = [];
    let state;
    try { state = JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { state = {}; }
    if (typeof state !== 'object' || Array.isArray(state)) state = {};
    if (!state.drafts || typeof state.drafts !== 'object') state.drafts = {};

    const chunks = () => records.filter(item => item.type === 'chunk');
    const currentDraft = () => state.drafts[kind] || {};
    const activeKind = () => getMode() === 'novelai' ? 'novelai' : 'nanobanana';
    function persistState() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
    function rememberPrefix({ dirty = false } = {}) {
        if (!initialized) return;
        const draft = currentDraft();
        state.drafts[kind] = { ...draft, prefix: prefixField.value, styleId: dirty ? '' : (draft.styleId || '') };
        persistState();
    }
    function visibleRecords() {
        const query = ui.search.value.trim().toLocaleLowerCase();
        return records.filter(item => item.type === tab && (tab === 'chunk' || item.kind === kind)
            && (!ui.category.value || item.category === ui.category.value)
            && (!query || [item.name, item.category, item.tags, item.text].join(' ').toLocaleLowerCase().includes(query)))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    function renderCategories() {
        const selected = ui.category.value;
        const categories = [...new Set(records.filter(item => item.type === tab && (tab === 'chunk' || item.kind === kind))
            .map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        ui.category.replaceChildren(new Option('Все категории', ''));
        ui.categories.replaceChildren();
        for (const category of categories) {
            ui.category.add(new Option(category, category));
            ui.categories.append(new Option(category, category));
        }
        ui.category.value = categories.includes(selected) ? selected : '';
    }
    function render() {
        ui.context.textContent = kind === 'novelai' ? 'NovelAI' : 'Nano Banana / обычный режим';
        ui['chunks-tab'].classList.toggle('hidden', kind !== 'novelai');
        ui['styles-tab'].setAttribute('aria-pressed', String(tab === 'style'));
        ui['chunks-tab'].setAttribute('aria-pressed', String(tab === 'chunk'));
        ui.new.textContent = tab === 'chunk' ? '＋ Чанк' : '＋ Стиль';
        ui.help.textContent = tab === 'chunk'
            ? 'Вставляй чанки кнопкой, перетаскиванием или через @. Нажми цветную капсулу для просмотра, дважды — чтобы развернуть в текст. Крестик убирает чанк из поля. Имена чувствительны к регистру.'
            : 'Нажми на карточку, чтобы заменить только префикс / стиль. Превью не отправляется модели как референс. Стили NovelAI и Nano Banana хранятся отдельно.';
        const items = visibleRecords();
        const pages = Math.ceil(items.length / PAGE_SIZE);
        ui.page.parentElement.classList.toggle('hidden', pages <= 1);
        page = Math.min(page, Math.max(0, pages - 1));
        ui.previous.disabled = page === 0;
        ui.next.disabled = page + 1 >= pages;
        ui.page.textContent = `${page + 1} / ${pages || 1} · ${items.length}`;
        ui.grid.replaceChildren();
        for (const item of items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
            const card = text('article', 'library-card');
            card.dataset.id = item.id;
            card.classList.toggle('active', tab === 'style' && currentDraft().styleId === item.id);
            const button = text('button', 'library-apply');
            button.type = 'button';
            button.title = item.text;
            if (tab === 'style') {
                if (item.preview) {
                    const image = new Image(); image.src = item.preview; image.alt = item.name; image.loading = 'lazy'; button.append(image);
                } else button.append(text('div', 'library-no-preview', 'Aa'));
            } else {
                button.draggable = true;
                button.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', chunkToken(item.name)); event.dataTransfer.effectAllowed = 'copy'; });
            }
            const heading = text('strong', '', item.name);
            if (tab === 'chunk') { heading.className = 'chunk-library-name'; heading.style.setProperty('--chunk-hue', chunkHue(item.name)); }
            button.append(heading, text('span', 'library-card-note', item.category || (tab === 'chunk' ? item.text : item.tags || 'Без категории')));
            button.addEventListener('click', () => tab === 'chunk' ? insertChunk(lastField, item.name) : applyStyle(item));
            const edit = text('button', 'library-edit', '✎');
            edit.type = 'button'; edit.title = 'Редактировать'; edit.setAttribute('aria-label', `Редактировать ${item.name}`);
            edit.addEventListener('click', () => openEditor(item));
            card.append(button, edit); ui.grid.append(card);
        }
        if (!items.length) ui.grid.append(text('p', 'library-empty', tab === 'chunk' ? 'Пока нет чанков. Создай свой набор тегов.' : 'Сохрани первый стиль — его можно будет выбрать одним нажатием.'));
    }
    function applyStyle(item) {
        prefixField.value = item.text;
        if (item.useNegative) setNegative(item.negative || '');
        state.drafts[kind] = { prefix: item.text, styleId: item.id };
        persistState(); onTextChanged(); refreshBindings(); render();
        showMessage(`Стиль «${item.name}» применён`, 'success');
    }
    function updatePreview() {
        ui.preview.classList.toggle('hidden', !preview);
        if (preview) ui.preview.src = preview;
        else ui.preview.removeAttribute('src');
        ui['preview-clear'].disabled = !preview;
    }
    function closeEditor() {
        previewSerial++; previewBusy = false; ui.save.disabled = busy; editingId = null; preview = ''; ui.editor.classList.add('hidden'); updatePreview();
    }
    function openEditor(item = null) {
        if (busy) return;
        previewSerial++; previewBusy = false; ui.save.disabled = false; editingId = item?.id || null;
        ui['editor-title'].textContent = item ? `Редактировать: ${item.name}` : tab === 'chunk' ? 'Новый чанк' : 'Новый стиль';
        ui.name.value = item?.name || '';
        ui.folder.value = item?.category || '';
        ui.tags.value = item?.tags || '';
        const selectedText = lastField.value.slice(lastField.selectionStart, lastField.selectionEnd);
        ui.text.value = item?.text ?? (tab === 'chunk' ? selectedText : prefixField.value);
        ui['use-negative'].checked = Boolean(item?.useNegative);
        ui.negative.value = item?.negative ?? getNegative();
        ui['negative-box'].classList.toggle('hidden', tab === 'chunk');
        ui.negative.classList.toggle('hidden', !ui['use-negative'].checked);
        ui['preview-box'].classList.toggle('hidden', tab === 'chunk');
        ui.delete.classList.toggle('hidden', !item);
        preview = item?.preview || ''; updatePreview();
        ui.editor.classList.remove('hidden');
        ui.name.focus({ preventScroll: true });
    }
    async function saveEditor() {
        if (busy) return;
        if (previewBusy) return showMessage('Подожди, пока загрузится превью');
        const name = ui.name.value.trim();
        if (!name || !ui.text.value.trim()) return showMessage('Заполни имя и текст');
        if (name.length > 80 || ui.text.value.length > 100000 || ui.negative.value.length > 100000) return showMessage('Имя: до 80 символов, текст: до 100 000');
        const original = records.find(item => item.id === editingId);
        if (tab === 'chunk') {
            try { chunkToken(name); } catch (error) { return showMessage(error.message); }
            if (chunks().some(item => item.id !== editingId && item.name === name)) return showMessage('Чанк с таким именем уже существует');
        }
        const record = {
            id: editingId || crypto.randomUUID(), type: tab, kind: tab === 'chunk' ? 'novelai' : kind,
            name, text: ui.text.value, category: ui.folder.value.trim(), tags: ui.tags.value.trim(),
            preview: tab === 'style' ? preview : '', useNegative: tab === 'style' && ui['use-negative'].checked,
            negative: tab === 'style' && ui['use-negative'].checked ? ui.negative.value : '',
            updatedAt: Date.now(), createdAt: original?.createdAt || Date.now(),
        };
        let next = [...records.filter(item => item.id !== record.id), record];
        const renamed = original?.type === 'chunk' && original.name !== name;
        if (renamed) next = next.map(item => ({ ...item,
            text: renameChunkReferences(item.text, original.name, name), negative: renameChunkReferences(item.negative, original.name, name),
        }));
        busy = true; ui.save.disabled = true;
        try {
            // Only write changed records: an old tab must not resurrect unrelated deleted styles.
            const changed = next.filter(item => item.id === record.id || item.text !== records.find(old => old.id === item.id)?.text
                || item.negative !== records.find(old => old.id === item.id)?.negative);
            await dbSave(changed);
            records = next;
            if (renamed) {
                const previousNegative = negativeField.value;
                for (const binding of bindings) binding.field.value = renameChunkReferences(binding.field.value, original.name, name);
                if (negativeField.value !== previousNegative) setNegative(negativeField.value);
                for (const draft of Object.values(state.drafts)) draft.prefix = renameChunkReferences(draft.prefix, original.name, name);
                persistState(); onTextChanged();
            }
            closeEditor(); renderCategories(); refreshBindings();
            if (record.type === 'style' && record.kind === kind) applyStyle(records.find(item => item.id === record.id));
            else { render(); showMessage(record.type === 'chunk' ? 'Чанк сохранён' : 'Стиль сохранён', 'success'); }
        } catch (error) { showMessage(`Не удалось сохранить библиотеку: ${error.message}`); }
        finally { busy = false; ui.save.disabled = false; }
    }
    async function deleteEditor() {
        const item = records.find(record => record.id === editingId);
        if (!item || busy) return;
        if (!confirm(`Удалить ${item.type === 'chunk' ? 'чанк' : 'стиль'} «${item.name}»?${item.type === 'chunk' ? '\nСсылки на него в промптах потребуется заменить или развернуть заранее.' : '\nТекущий текст промпта и картинки останутся.'}`)) return;
        busy = true;
        try {
            await dbDelete(item.id); records = records.filter(record => record.id !== item.id);
            for (const draft of Object.values(state.drafts)) if (draft.styleId === item.id) draft.styleId = '';
            persistState(); closeEditor(); renderCategories(); render(); refreshBindings();
        } catch (error) { showMessage(error.message); }
        finally { busy = false; }
    }
    function insertChunk(field, name, query = null) {
        if (kind !== 'novelai') return;
        if (field.disabled || field.closest('.hidden')) { field = promptField; query = null; }
        const start = query?.start ?? field.selectionStart;
        const end = query?.end ?? field.selectionEnd;
        const suffix = field.value.slice(end);
        field.focus({ preventScroll: true });
        field.setRangeText(chunkToken(name) + (!suffix || !/^[,\s:)\]}]/.test(suffix) ? ', ' : ''), start, end, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function refreshBinding(binding, { suggest = false } = {}) {
        const { field, tools, suggestions, inspection } = binding;
        const enabled = kind === 'novelai';
        binding.editor.sync({ enabled });
        tools.classList.toggle('hidden', !enabled);
        if (!enabled) { suggestions.replaceChildren(); return; }
        inspection.classList.add('hidden');
        suggestions.replaceChildren(); binding.matches = []; binding.query = null; binding.highlight = 0;
        if (!suggest) return;
        const query = findChunkQuery(field.value, field.selectionStart);
        if (!query) return;
        binding.query = query;
        binding.matches = chunks().filter(item => item.name.toLocaleLowerCase().includes(query.query.toLocaleLowerCase())).slice(0, 6);
        for (const [index, item] of binding.matches.entries()) {
            const option = text('button', 'chunk-suggestion', `@${item.name} — ${item.category || item.text.slice(0, 80)}`);
            option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === 0));
            option.addEventListener('pointerdown', event => event.preventDefault());
            option.addEventListener('click', () => insertChunk(field, item.name, query));
            suggestions.append(option);
        }
    }
    function refreshBindings() { for (const binding of bindings) refreshBinding(binding); }
    function attachField(field) {
        const tools = text('div', 'chunk-field-tools hidden');
        const suggestions = text('div', 'chunk-suggestions'); suggestions.setAttribute('role', 'listbox'); suggestions.setAttribute('aria-label', 'Сохранённые чанки');
        const inspection = text('div', 'chunk-inspection hidden');
        tools.append(suggestions, inspection);
        field.closest('label').after(tools);
        const editor = createChunkEditor(field, {
            isKnown: name => chunks().some(item => item.name === name),
            inspect: ref => {
                inspection.classList.remove('hidden');
                try { inspection.textContent = expandPromptChunks(ref.token, chunks()); }
                catch (error) { inspection.textContent = error.message; }
            },
            expand: ref => {
                if (field.value.slice(ref.index, ref.index + ref.token.length) !== ref.token) return;
                try {
                    field.setRangeText(expandPromptChunks(ref.token, chunks()), ref.index, ref.index + ref.token.length, 'end');
                    field.dispatchEvent(new Event('input', { bubbles: true })); field.focus({ preventScroll: true });
                } catch (error) { showMessage(error.message); }
            },
        });
        const binding = { field, tools, suggestions, inspection, editor, matches: [], highlight: 0 };
        bindings.push(binding);
        field.addEventListener('focus', () => { if (![ui.text, ui.negative].includes(field)) lastField = field; refreshBinding(binding, { suggest: true }); });
        field.addEventListener('input', event => {
            if (field === prefixField) { rememberPrefix({ dirty: true }); render(); }
            refreshBinding(binding, { suggest: !event.isComposing });
        });
        field.addEventListener('click', () => refreshBinding(binding, { suggest: true }));
        field.addEventListener('blur', () => { setTimeout(() => suggestions.replaceChildren(), 180); });
        field.addEventListener('keydown', event => {
            if (!suggestions.children.length) return;
            if (event.key === 'Escape') { suggestions.replaceChildren(); event.preventDefault(); return; }
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault(); binding.highlight = (binding.highlight + (event.key === 'ArrowDown' ? 1 : -1) + binding.matches.length) % binding.matches.length;
                [...suggestions.children].forEach((node, index) => node.setAttribute('aria-selected', String(index === binding.highlight)));
            } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
                event.preventDefault(); event.stopPropagation(); insertChunk(field, binding.matches[binding.highlight].name, binding.query);
            }
        });
    }
    function syncMode() {
        if (!initialized) return;
        const next = activeKind();
        if (next !== kind) {
            rememberPrefix(); kind = next;
            prefixField.value = currentDraft().prefix || '';
            page = 0; tab = 'style'; closeEditor(); ui.search.value = ''; ui.category.value = '';
            onTextChanged();
        }
        renderCategories(); render(); refreshBindings();
    }
    async function setPreview(dataUrl) {
        const serial = ++previewSerial;
        previewBusy = true; ui.save.disabled = true;
        try { const result = await thumbnail(dataUrl); if (serial === previewSerial) { preview = result; updatePreview(); } }
        catch (error) { showMessage(error.message); }
        finally { if (serial === previewSerial) { previewBusy = false; ui.save.disabled = busy; } }
    }
    return {
        syncMode,
        textChanged() { rememberPrefix({ dirty: true }); refreshBindings(); render(); },
        compile(values) { return compilePromptText(values, chunks()); },
        async init() {
            records = (await dbGetAll()).filter(item => item && ['style', 'chunk'].includes(item.type));
            kind = activeKind();
            if (Object.hasOwn(currentDraft(), 'prefix')) prefixField.value = currentDraft().prefix;
            else state.drafts[kind] = { prefix: prefixField.value, styleId: '' };
            initialized = true; persistState();
            for (const field of [prefixField, promptField, negativeField, ui.text, ui.negative]) attachField(field);
            for (const type of ['style', 'chunk']) ui[`${type === 'style' ? 'styles' : 'chunks'}-tab`].addEventListener('click', () => {
                if (busy) return;
                tab = type; page = 0; closeEditor(); ui.category.value = ''; renderCategories(); render();
            });
            ui.new.addEventListener('click', () => openEditor());
            ui.save.addEventListener('click', saveEditor);
            ui.cancel.addEventListener('click', closeEditor);
            ui.delete.addEventListener('click', deleteEditor);
            ui['use-negative'].addEventListener('change', () => ui.negative.classList.toggle('hidden', !ui['use-negative'].checked));
            ui.search.addEventListener('input', () => { page = 0; render(); });
            ui.category.addEventListener('change', () => { page = 0; render(); });
            ui.previous.addEventListener('click', () => { page--; render(); });
            ui.next.addEventListener('click', () => { page++; render(); });
            ui['preview-clear'].addEventListener('click', () => { previewSerial++; previewBusy = false; ui.save.disabled = busy; preview = ''; updatePreview(); });
            ui['preview-result'].addEventListener('click', () => {
                const result = getResult();
                if (!result) return showMessage('Сначала сгенерируй или открой картинку из истории');
                setPreview(result.dataUrl);
            });
            ui['preview-upload'].addEventListener('change', async () => {
                const file = ui['preview-upload'].files[0]; ui['preview-upload'].value = '';
                if (!file) return;
                if (!file.type.startsWith('image/') || file.size > 30 * 1024 * 1024) return showMessage('Выбери изображение до 30 МБ');
                const url = URL.createObjectURL(file);
                try { await setPreview(url); } finally { URL.revokeObjectURL(url); }
            });
            syncMode(); onTextChanged();
        },
    };
}
