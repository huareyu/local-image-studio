export function createImageViewer({ read, readThumbnail, download, usePrompt, addReference, providerLabel }) {
    const dialog = document.querySelector('#image-viewer');
    const find = id => dialog.querySelector(`#viewer-${id}`);
    const image = find('image');
    let entries = [], index = 0, current = null, revision = 0, trigger = null, touch = null;
    const dateLabel = value => new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

    function actionState(disabled) {
        for (const id of ['download', 'use-prompt', 'reference']) find(id).disabled = disabled;
    }

    function clearImage() {
        image.removeAttribute('src');
        delete image.dataset.id;
        image.classList.add('hidden');
        current = null;
        actionState(true);
    }

    function paintStrip(token) {
        const strip = find('strip');
        const restoreStripFocus = strip.contains(document.activeElement);
        strip.replaceChildren();
        const start = Math.max(0, Math.min(index - 4, entries.length - 9));
        for (let i = start; i < Math.min(entries.length, start + 9); i++) {
            const entry = entries[i];
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'viewer-thumb';
            button.setAttribute('aria-label', `Изображение ${i + 1}: ${entry.prompt || entry.model || ''}`);
            button.setAttribute('aria-current', String(i === index));
            button.dataset.id = entry.id;
            const thumb = new Image();
            thumb.alt = '';
            button.append(thumb);
            button.addEventListener('click', () => show(i));
            strip.append(button);
            readThumbnail(entry.id, () => token === revision && thumb.isConnected).then(dataUrl => {
                if (dataUrl && token === revision && thumb.isConnected) thumb.src = dataUrl;
            }).catch(() => {});
        }
        // Only this strip scrolls; never move the document or the modal itself.
        const active = strip.querySelector('[aria-current="true"]');
        if (active) strip.scrollLeft = active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
        if (restoreStripFocus) active?.focus({ preventScroll: true });
    }

    async function show(next) {
        index = Math.max(0, Math.min(entries.length - 1, next));
        const token = ++revision;
        clearImage();
        const entry = entries[index];
        find('counter').textContent = `${index + 1} / ${entries.length}`;
        find('previous').disabled = index === 0;
        find('next').disabled = index === entries.length - 1;
        find('title').textContent = entry.model || 'Изображение';
        find('meta').textContent = [providerLabel(entry.provider), entry.profileName, dateLabel(entry.createdAt),
            entry.width && entry.height ? `${entry.width}×${entry.height}` : '', entry.seed == null ? '' : `Seed: ${entry.seed}`].filter(Boolean).join(' · ');
        find('prompt').textContent = [entry.resolvedPrefix ?? entry.prefix, entry.resolvedPrompt ?? entry.prompt].filter(Boolean).join('\n\n') || 'Промпт не сохранён';
        find('status').textContent = 'Загружаю изображение…';
        paintStrip(token);
        try {
            const full = await read(entry.id);
            if (token !== revision || !dialog.open) return;
            if (!full?.dataUrl) throw new Error('Изображение недоступно. Возможно, оно удалено в другой вкладке.');
            current = full;
            image.dataset.id = full.id;
            image.alt = full.prompt || 'Изображение из истории';
            image.src = full.dataUrl;
            image.classList.remove('hidden');
            find('status').textContent = '';
            actionState(false);
        } catch (error) {
            if (token === revision && dialog.open) find('status').textContent = error.message;
        }
    }

    function move(direction) { if (dialog.open && entries.length) show(index + direction); }
    function cleanup() {
        revision++;
        clearImage();
        entries = [];
        touch = null;
        find('strip').replaceChildren();
        document.body.classList.remove('viewer-open');
        trigger?.focus({ preventScroll: true });
        trigger = null;
    }
    function close() { if (dialog.open) { dialog.close(); cleanup(); } }
    find('close').addEventListener('click', close);
    find('previous').addEventListener('click', () => move(-1));
    find('next').addEventListener('click', () => move(1));
    find('download').addEventListener('click', () => { if (current) download(current); });
    find('use-prompt').addEventListener('click', () => { if (current) { const entry = current; close(); usePrompt(entry); } });
    find('reference').addEventListener('click', async () => {
        if (!current) return;
        const token = revision, entry = current;
        find('reference').disabled = true;
        try { await addReference(entry); if (token === revision && dialog.open) find('status').textContent = 'Добавлено в активный профиль референсов'; }
        catch (error) { if (token === revision && dialog.open) find('status').textContent = error.message; }
        finally { if (token === revision && dialog.open) find('reference').disabled = !current; }
    });
    dialog.addEventListener('close', () => { if (!dialog.open) cleanup(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    document.addEventListener('keydown', event => {
        if (!dialog.open || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'Home') show(0);
            else if (event.key === 'End') show(entries.length - 1);
            else move(event.key === 'ArrowLeft' ? -1 : 1);
        }
    });
    const stage = find('stage');
    stage.addEventListener('touchstart', event => {
        touch = event.touches.length === 1 && !event.target.closest('button')
            ? { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() } : null;
    }, { passive: true });
    stage.addEventListener('touchmove', event => { if (event.touches.length !== 1) touch = null; }, { passive: true });
    stage.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
    stage.addEventListener('touchend', event => {
        if (!touch || !event.changedTouches.length) return;
        const dx = event.changedTouches[0].clientX - touch.x, dy = event.changedTouches[0].clientY - touch.y;
        if (event.touches.length === 0 && Date.now() - touch.at < 800 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
        touch = null;
    }, { passive: true });
    image.addEventListener('error', () => { if (dialog.open && image.getAttribute('src')) find('status').textContent = 'Не удалось отобразить изображение'; });

    return {
        open(id, scope) {
            if (!scope.length) return;
            entries = scope.slice();
            const position = entries.findIndex(entry => entry.id === id);
            if (position < 0) return;
            trigger = document.activeElement;
            if (!dialog.open) dialog.showModal();
            document.body.classList.add('viewer-open');
            find('details').open = false;
            show(position);
        },
        get isOpen() { return dialog.open; },
    };
}
