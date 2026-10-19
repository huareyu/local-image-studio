import { chunkToken, chunkReferences } from './prompt-tools.js';

const valueProperty = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
const selectionStartProperty = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'selectionStart');
const selectionEndProperty = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'selectionEnd');
const nativeSelect = HTMLTextAreaElement.prototype.setSelectionRange;

export function chunkHue(name) {
    let hash = 2166136261;
    for (const character of name) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    return ((hash ^ (hash >>> 16)) >>> 0) % 360;
}

// A visual editor over the original textarea. The original value/selection remain
// the canonical API and draft format; editable DOM is never sent to the model.
export function createChunkEditor(field, { isKnown, inspect, expand }) {
    const view = document.createElement('div');
    view.className = 'chunk-rich-editor hidden';
    view.setAttribute('role', 'textbox');
    view.setAttribute('aria-multiline', 'true');
    view.setAttribute('aria-label', field.getAttribute('aria-label') || field.closest('label').querySelector('span')?.textContent || 'Промпт');
    view.dataset.field = field.id;
    view.style.setProperty('--chunk-rows', field.rows || 3);
    field.after(view);
    let enabled = false;
    let composing = false;
    let compositionBefore = null;
    let beforeInput = null;
    let rendered = null;
    let history = [];
    let historyIndex = 0;
    const getValue = () => valueProperty.get.call(field);
    const getStart = () => selectionStartProperty.get.call(field);
    const getEnd = () => selectionEndProperty.get.call(field);
    const snapshot = () => ({ value: getValue(), start: getStart(), end: getEnd() });
    const isCapsule = node => node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-chunk-name');

    function plain(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.data.replace(/\u00a0/g, ' ');
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        if (isCapsule(node)) return chunkToken(node.dataset.chunkName);
        if (node.tagName === 'BR') return node.hasAttribute('data-editor-end') ? '' : '\n';
        const content = [...node.childNodes].map(plain).join('');
        return content + (['DIV', 'P'].includes(node.tagName) && node !== view && node.nextSibling ? '\n' : '');
    }
    function offsetAt(target, offset) {
        let total = 0;
        let result = null;
        function walk(node) {
            if (result !== null) return;
            if (node === target) {
                result = total + (node.nodeType === Node.TEXT_NODE ? Math.min(offset, plain(node).length)
                    : isCapsule(node) ? (offset ? plain(node).length : 0)
                        : [...node.childNodes].slice(0, offset).map(plain).join('').length);
            } else if (isCapsule(node)) {
                if (node.contains(target)) result = total + (offset ? plain(node).length : 0);
                else total += plain(node).length;
            } else if (node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR') total += plain(node).length;
            else for (const child of node.childNodes) walk(child);
        }
        walk(view);
        return result ?? total;
    }
    function readSelection() {
        const selection = window.getSelection();
        if (!enabled || !selection?.rangeCount || !view.contains(selection.anchorNode) || !view.contains(selection.focusNode)) return null;
        const anchor = offsetAt(selection.anchorNode, selection.anchorOffset);
        const focus = offsetAt(selection.focusNode, selection.focusOffset);
        return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), direction: anchor > focus ? 'backward' : 'forward' };
    }
    function rememberSelection() {
        const selection = readSelection();
        if (selection) nativeSelect.call(field, selection.start, selection.end, selection.direction);
    }
    function pointAt(offset, end = false) {
        let remaining = Math.max(0, offset);
        for (const [index, node] of [...view.childNodes].entries()) {
            const length = plain(node).length;
            if (node.nodeType === Node.TEXT_NODE && remaining <= length) return [node, remaining];
            if (isCapsule(node) && remaining < length) return [view, index + (remaining > 0 || end ? 1 : 0)];
            remaining -= length;
        }
        return [view, view.childNodes.length];
    }
    function restoreSelection(start = getStart(), end = getEnd()) {
        if (!enabled) return;
        const range = document.createRange();
        range.setStart(...pointAt(start));
        range.setEnd(...pointAt(end, end > start));
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        rememberSelection();
    }
    function reference(capsule) {
        const index = offsetAt(capsule.parentNode, [...capsule.parentNode.childNodes].indexOf(capsule));
        return { name: capsule.dataset.chunkName, token: chunkToken(capsule.dataset.chunkName), index };
    }
    function render({ force = false } = {}) {
        if (composing || (!force && rendered === getValue())) return;
        const focused = document.activeElement === view;
        const start = getStart(); const end = getEnd();
        const source = getValue();
        const scrollTop = view.scrollTop;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const ref of chunkReferences(source)) {
            fragment.append(document.createTextNode(source.slice(cursor, ref.index)));
            const capsule = document.createElement('span');
            capsule.className = 'chunk-capsule';
            capsule.dataset.chunkName = ref.name;
            capsule.contentEditable = 'false';
            capsule.style.setProperty('--chunk-hue', chunkHue(ref.name));
            const known = isKnown(ref.name);
            capsule.classList.toggle('missing', !known);
            capsule.title = known ? 'Нажать — содержимое; дважды — развернуть' : 'Чанк не найден';
            const name = document.createElement('span');
            name.className = 'chunk-capsule-name'; name.textContent = ref.name;
            const remove = document.createElement('button');
            remove.className = 'chunk-capsule-remove'; remove.type = 'button'; remove.tabIndex = -1;
            remove.textContent = '×'; remove.setAttribute('aria-label', `Убрать чанк ${ref.name}`);
            remove.addEventListener('pointerdown', event => event.preventDefault());
            remove.addEventListener('click', event => {
                event.preventDefault(); event.stopPropagation();
                if (field.disabled || field.readOnly) return;
                const current = reference(capsule);
                replace('', current.index, current.index + current.token.length);
            });
            capsule.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); inspect(reference(capsule)); });
            capsule.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); expand(reference(capsule)); });
            capsule.append(name, remove); fragment.append(capsule);
            cursor = ref.index + ref.token.length;
        }
        fragment.append(document.createTextNode(source.slice(cursor)));
        if (!source || source.endsWith('\n')) {
            const endMarker = document.createElement('br'); endMarker.dataset.editorEnd = ''; fragment.append(endMarker);
        }
        view.replaceChildren(fragment); rendered = source;
        view.dataset.empty = String(!source);
        if (focused) restoreSelection(start, end);
        view.scrollTop = scrollTop;
    }
    function resetHistory() { history = [snapshot()]; historyIndex = 0; }
    function revealCaret() {
        const selection = window.getSelection();
        if (document.activeElement !== view || !selection?.rangeCount) return;
        const range = selection.getRangeAt(0).cloneRange(); range.collapse(false);
        const caret = range.getBoundingClientRect(); const box = view.getBoundingClientRect();
        if (!caret.height || !box.height) return;
        if (caret.bottom > box.bottom - 10) view.scrollTop += caret.bottom - box.bottom + 10;
        else if (caret.top < box.top + 10) view.scrollTop -= box.top + 10 - caret.top;
    }
    function record(before) {
        if (before.value === getValue()) return;
        if (history[historyIndex]?.value !== before.value) { history = [before]; historyIndex = 0; }
        else history[historyIndex] = before;
        history.splice(historyIndex + 1); history.push(snapshot());
        if (history.length > 80) history.shift();
        historyIndex = history.length - 1;
    }
    function notify(inputType = 'insertText') {
        field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, isComposing: composing }));
    }
    function replace(value, start = getStart(), end = getEnd(), { notifyChange = true, select = 'end' } = {}) {
        const before = snapshot();
        const source = getValue();
        const result = source.slice(0, start) + value + source.slice(end);
        valueProperty.set.call(field, result);
        const cursor = start + value.length;
        nativeSelect.call(field, select === 'select' ? start : cursor, cursor);
        rendered = null; render(); record(before); revealCaret();
        if (notifyChange) notify('insertReplacementText');
    }
    function undo(direction) {
        const next = historyIndex + direction;
        if (next < 0 || next >= history.length) return;
        historyIndex = next;
        const entry = history[next];
        valueProperty.set.call(field, entry.value); nativeSelect.call(field, entry.start, entry.end);
        rendered = null; render(); revealCaret(); notify(direction < 0 ? 'historyUndo' : 'historyRedo');
    }
    function commit(before = beforeInput || snapshot()) {
        const selection = readSelection();
        const start = selection?.start ?? getStart(); const end = selection?.end ?? getEnd();
        valueProperty.set.call(field, plain(view)); nativeSelect.call(field, start, end);
        view.dataset.empty = String(!getValue());
        if (!composing) { rendered = null; render(); record(before); revealCaret(); }
        notify(); beforeInput = null;
    }

    Object.defineProperty(field, 'value', { configurable: true, get: getValue, set(value) {
        if (getValue() === String(value ?? '')) return;
        valueProperty.set.call(field, value); composing = false; resetHistory(); rendered = null; render();
    } });
    const originalFocus = field.focus.bind(field);
    field.focus = options => {
        if (!enabled) return originalFocus(options);
        const start = getStart(); const end = getEnd();
        view.focus(options); restoreSelection(start, end); revealCaret();
    };
    field.setSelectionRange = (start, end, direction) => {
        nativeSelect.call(field, start, end, direction);
        if (enabled && document.activeElement === view) restoreSelection();
    };
    for (const [name, property] of [['selectionStart', selectionStartProperty], ['selectionEnd', selectionEndProperty]]) {
        Object.defineProperty(field, name, { configurable: true, get: () => property.get.call(field), set(value) {
            property.set.call(field, value);
            if (enabled && document.activeElement === view) restoreSelection();
        } });
    }
    const originalSetRangeText = field.setRangeText.bind(field);
    field.setRangeText = (value, start, end, select = 'preserve') => {
        if (!enabled) return start === undefined ? originalSetRangeText(value) : originalSetRangeText(value, start, end, select);
        replace(String(value), start ?? getStart(), end ?? getEnd(), { notifyChange: false, select });
    };
    view.addEventListener('focus', () => field.dispatchEvent(new Event('focus')));
    view.addEventListener('blur', () => field.dispatchEvent(new Event('blur')));
    view.addEventListener('click', () => { rememberSelection(); field.dispatchEvent(new Event('click')); });
    document.addEventListener('selectionchange', rememberSelection);
    view.addEventListener('compositionstart', () => { rememberSelection(); compositionBefore = snapshot(); composing = true; });
    view.addEventListener('compositionend', () => {
        composing = false; commit(compositionBefore || snapshot()); compositionBefore = null;
    });
    view.addEventListener('beforeinput', event => {
        if (event.isComposing || composing) return;
        rememberSelection(); beforeInput = snapshot();
        if (['historyUndo', 'historyRedo'].includes(event.inputType)) {
            event.preventDefault(); undo(event.inputType === 'historyUndo' ? -1 : 1); return;
        }
        if (['insertParagraph', 'insertLineBreak'].includes(event.inputType)) {
            event.preventDefault(); replace('\n'); return;
        }
        if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
            const start = getStart(); const end = getEnd();
            const ref = chunkReferences(getValue()).find(item => event.inputType === 'deleteContentBackward'
                ? item.index + item.token.length === start : item.index === start);
            if (start !== end || ref) {
                event.preventDefault(); replace('', start !== end ? start : ref.index, start !== end ? end : ref.index + ref.token.length);
            }
        }
    });
    view.addEventListener('input', event => { if (!event.isComposing && !composing) commit(); else commit(compositionBefore || snapshot()); });
    view.addEventListener('keydown', event => {
        rememberSelection();
        if (composing || event.isComposing) return;
        if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
            event.preventDefault(); event.stopPropagation();
            undo(event.key.toLowerCase() === 'y' || event.shiftKey ? 1 : -1); return;
        }
        const forwarded = new KeyboardEvent('keydown', { key: event.key, code: event.code, ctrlKey: event.ctrlKey,
            metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, cancelable: true });
        field.dispatchEvent(forwarded);
        if (forwarded.defaultPrevented) { event.preventDefault(); event.stopPropagation(); }
    });
    for (const type of ['copy', 'cut']) view.addEventListener(type, event => {
        rememberSelection();
        if (getStart() === getEnd()) return;
        event.preventDefault();
        event.clipboardData?.setData('text/plain', getValue().slice(getStart(), getEnd()));
        if (type === 'cut' && !field.disabled && !field.readOnly) replace('');
    });
    view.addEventListener('paste', event => {
        event.preventDefault();
        if (field.disabled || field.readOnly || event.clipboardData?.files.length) return;
        rememberSelection(); replace((event.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n'));
    });
    view.addEventListener('dragover', event => event.preventDefault());
    view.addEventListener('drop', event => {
        event.preventDefault();
        if (field.disabled || field.readOnly) return;
        const value = event.dataTransfer?.getData('text/plain');
        if (!value) return;
        const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        const start = caret && view.contains(caret.startContainer) ? offsetAt(caret.startContainer, caret.startOffset) : getStart();
        view.focus({ preventScroll: true }); replace(value, start, start);
    });
    function sync({ enabled: active = enabled, force = false } = {}) {
        enabled = active;
        field.classList.toggle('chunk-source', enabled);
        view.classList.toggle('hidden', !enabled || field.classList.contains('hidden') || field.hidden);
        view.contentEditable = String(!field.disabled && !field.readOnly);
        view.setAttribute('aria-disabled', String(field.disabled));
        view.dataset.placeholder = field.placeholder;
        view.setAttribute('aria-placeholder', field.placeholder);
        render({ force });
        for (const capsule of view.querySelectorAll('.chunk-capsule')) {
            const known = isKnown(capsule.dataset.chunkName);
            capsule.classList.toggle('missing', !known);
            capsule.title = known ? 'Нажать — содержимое; дважды — развернуть' : 'Чанк не найден';
        }
    }
    new MutationObserver(() => sync()).observe(field, { attributes: true, attributeFilter: ['disabled', 'readonly', 'hidden', 'class', 'placeholder'] });
    resetHistory();
    return { view, sync };
}
