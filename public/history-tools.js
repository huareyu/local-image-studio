const searchableText = entry => [entry.prompt, entry.resolvedPrompt, entry.prefix, entry.resolvedPrefix,
    entry.model, entry.profileName, entry.provider, entry.archive?.fileName, entry.seed]
    .filter(value => value != null).join(' ').normalize('NFKC').toLocaleLowerCase();

export function filterHistory(entries, { search = '', provider = '', date = '', order = 'newest' } = {}) {
    const words = search.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const from = date ? new Date(`${date}T00:00:00`).getTime() : null;
    const until = date ? new Date(`${date}T00:00:00`) : null;
    until?.setDate(until.getDate() + 1);
    return entries.filter(entry => {
        if (provider && entry.provider !== provider) return false;
        if (date && !(entry.createdAt >= from && entry.createdAt < until.getTime())) return false;
        if (!words.length) return true;
        const text = searchableText(entry);
        return words.every(word => text.includes(word));
    })
        .sort((a, b) => (order === 'oldest' ? 1 : -1) * (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
}

export function pageNumbers(page, count) {
    return [...new Set([0, count - 1, page - 1, page, page + 1])]
        .filter(index => index >= 0 && index < count).sort((a, b) => a - b);
}
