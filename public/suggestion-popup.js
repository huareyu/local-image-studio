// Shared, out-of-flow suggestions for plain textareas and their chunk-rich-editor views.
// Panels use backdrop-filter, which creates a containing block for fixed descendants.
// Portal to body so coordinates really refer to the viewport and other panels cannot clip the popup.
export function createSuggestionPopup(field, list) {
    list.classList.add('suggestion-popup');
    document.body.append(list);
    let frame = 0, resetScroll = false;
    function position() {
        frame = 0;
        const active = document.activeElement;
        const focused = active === field || active?.dataset.field === field.id;
        if (!list.children.length || !focused || field.disabled || field.readOnly) {
            list.hidden = true; list.style.visibility = 'hidden'; list.setAttribute('aria-hidden', 'true'); return;
        }
        const candidate = field.nextElementSibling;
        const anchor = candidate?.classList.contains('chunk-rich-editor') && candidate.getClientRects().length ? candidate : field;
        const box = anchor.getBoundingClientRect();
        const visible = box.width > 0 && box.height > 0;
        list.hidden = !visible;
        list.style.visibility = visible ? 'visible' : 'hidden'; list.setAttribute('aria-hidden', String(!visible));
        if (!visible) return;
        if (resetScroll) { list.scrollTop = 0; resetScroll = false; }
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
        const bottom = top + height;
        const below = Math.max(0, bottom - box.bottom - 8), above = Math.max(0, box.top - top - 8);
        // Placement depends on available space, not the number of matches (no flip/flop while typing).
        const down = below >= Math.min(200, height * .4) || below >= above;
        const maxHeight = Math.max(0, Math.min(300, (down ? below : above) - 6));
        if (maxHeight < 35 || box.bottom < top || box.top > bottom) {
            list.hidden = true; list.style.visibility = 'hidden'; list.setAttribute('aria-hidden', 'true'); return;
        }
        const popupWidth = Math.min(box.width, Math.max(0, width - 16));
        list.style.width = `${popupWidth}px`;
        list.style.maxHeight = `${maxHeight}px`;
        list.style.left = `${Math.max(left + 8, Math.min(box.left, left + width - 8 - popupWidth))}px`;
        list.style.top = `${down ? box.bottom + 6 : Math.max(top + 8, box.top - 6 - list.getBoundingClientRect().height)}px`;
        list.dataset.placement = down ? 'below' : 'above';
    }
    function update() {
        if (!frame) frame = requestAnimationFrame(position);
    }
    function reveal(index) {
        const item = list.children[index];
        if (!item) return;
        // scrollIntoView would also scroll the document; only scroll this list.
        const itemBox = item.getBoundingClientRect(), listBox = list.getBoundingClientRect();
        if (itemBox.bottom > listBox.bottom - 5) list.scrollTop += itemBox.bottom - listBox.bottom + 5;
        else if (itemBox.top < listBox.top + 5) list.scrollTop -= listBox.top + 5 - itemBox.top;
    }
    new MutationObserver(update).observe(list, { childList: true });
    new ResizeObserver(update).observe(field.closest('label'));
    document.addEventListener('focusin', update);
    window.addEventListener('scroll', event => { if (!(event.target instanceof Node) || !list.contains(event.target)) update(); }, { capture: true, passive: true });
    window.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('scroll', update, { passive: true });
    position();
    return { update, reveal, reset() { resetScroll = true; update(); } };
}
