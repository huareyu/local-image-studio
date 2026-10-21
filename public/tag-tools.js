export const MAX_TAGS = 250000;
export const MAX_DICTIONARY_BYTES = 25 * 1024 * 1024;
export const tagKey = value => String(value).replaceAll('_', ' ').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

export function normalizeTagRecords(records) {
    if (!Array.isArray(records) || records.length > MAX_TAGS) throw new Error(`В словаре должно быть не более ${MAX_TAGS} тегов`);
    const unique = new Map();
    for (const item of records) {
        const record = typeof item === 'string' ? { tag: item } : item;
        if (!record || typeof record !== 'object' || typeof (record.tag ?? record.name) !== 'string') continue;
        const tag = (record.tag ?? record.name).replaceAll('_', ' ').trim();
        if (!tag || tag.length > 160 || /[\r\n\x00-\x1f]/.test(tag)) continue;
        const aliases = Array.isArray(record.aliases) ? record.aliases : typeof record.aliases === 'string' ? record.aliases.split(',') : [];
        const value = { tag, desc: String(record.desc ?? record.description ?? '').slice(0, 500),
            category: String(record.category || 'Мои теги').slice(0, 80),
            count: Math.max(0, Math.min(Number(record.count ?? record.popularity) || 0, 1e12)),
            aliases: aliases.filter(alias => typeof alias === 'string').slice(0, 16).map(alias => alias.slice(0, 80)) };
        if (!unique.has(tagKey(tag))) unique.set(tagKey(tag), value);
    }
    return [...unique.values()];
}

function csvRows(source) {
    const rows = [];
    let row = [], value = '', quoted = false;
    for (let i = 0; i <= source.length; i++) {
        const c = source[i];
        if (c === '"') {
            if (quoted && source[i + 1] === '"') { value += '"'; i++; }
            else if (quoted || !value) quoted = !quoted;
            else value += c;
        } else if (!quoted && (c === ',' || c === '\n' || c === undefined)) {
            row.push(value.replace(/\r$/, '').trim()); value = '';
            if (row.length > 30) throw new Error('Слишком много колонок в CSV');
            if (c !== ',') { if (row.some(Boolean)) rows.push(row); row = []; }
            if (rows.length > MAX_TAGS + 1) throw new Error(`Максимум ${MAX_TAGS} тегов`);
        } else if (c !== undefined) value += c;
    }
    if (quoted) throw new Error('В CSV не закрыта кавычка');
    return rows;
}

export function parseTagDictionary(text, filename) {
    if (text.length > MAX_DICTIONARY_BYTES) throw new Error('Словарь слишком большой (максимум 25 МБ)');
    text = text.replace(/^\uFEFF/, '');
    const extension = filename.toLowerCase().split('.').at(-1);
    let records;
    if (extension === 'json') {
        const data = JSON.parse(text);
        if (Array.isArray(data)) records = data;
        else if (data && typeof data === 'object') {
            records = [];
            for (const [category, items] of Object.entries(data)) {
                if (!Array.isArray(items)) throw new Error('JSON: ожидается массив тегов или объект {"Категория": [{"tag": "…", "desc": "…"}]}');
                if (records.length + items.length > MAX_TAGS) throw new Error(`Максимум ${MAX_TAGS} тегов`);
                for (const item of items) records.push(typeof item === 'string' ? { tag: item, category } : { ...item, category });
            }
        } else throw new Error('Неподходящий формат JSON');
    } else if (extension === 'txt') records = text.split(/\r\n?|\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    else if (extension === 'csv') {
        const rows = csvRows(text);
        const headers = rows[0]?.map(value => value.toLowerCase()) || [];
        const hasHeader = ['tag', 'name'].includes(headers[0]);
        const codes = { 0: 'Общие', 1: 'Авторы', 3: 'Произведения', 4: 'Персонажи', 5: 'Мета' };
        records = rows.slice(hasHeader ? 1 : 0).map(row => {
            if (hasHeader) return Object.fromEntries(headers.map((header, index) => [header, row[index] || '']));
            const booru = row.length >= 3 && /^\d$/.test(row[1]) && /^\d+$/.test(row[2]);
            return { tag: row[0], count: row[booru ? 2 : 1], category: booru ? codes[row[1]] || 'Общие' : 'Мои теги', aliases: booru ? row[3] : '' };
        });
    } else throw new Error('Поддерживаются JSON, TXT и CSV');
    const result = normalizeTagRecords(records);
    if (!result.length) throw new Error('В файле не найдено подходящих тегов');
    return result;
}

export function createTagIndex(records) {
    return records.map(record => ({ ...record, key: tagKey(record.tag),
        search: tagKey([record.tag, record.desc, ...(record.aliases || [])].join(' ')) }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function searchTags(index, query = '', { category = '', used = new Set(), limit = 16, offset = 0 } = {}) {
    const key = tagKey(query), words = key.split(/\s+/).filter(Boolean);
    if (!words.length && !category && !used.size) return { total: index.length, items: index.slice(offset, offset + limit) };
    // The index is already popularity-sorted. Keep only the requested window per rank,
    // instead of allocating and sorting every match for each keystroke.
    const buckets = [[], [], [], []];
    let total = 0;
    for (const entry of index) {
        if (category && entry.category !== category) continue;
        if (used.has(entry.key) || !words.every(word => entry.search.includes(word))) continue;
        const rank = !key ? 3 : entry.key === key ? 0 : entry.key.startsWith(key) ? 1 : entry.key.includes(key) ? 2 : 3;
        total++;
        if (buckets[rank].length < offset + limit) buckets[rank].push(entry);
    }
    return { total, items: buckets.flat().slice(offset, offset + limit) };
}

// A comma inside a chunk name, quote, brackets, or numerical emphasis is not a tag separator.
export function promptTags(source) {
    const tags = [], stack = [];
    let start = 0, quoted = false, weighted = false;
    function add(end) {
        const raw = source.slice(start, end), text = raw.trim();
        if (text) { const at = start + raw.indexOf(text); tags.push({ text, start: at, end: at + text.length }); }
        start = end + 1;
    }
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '\\') { i++; continue; }
        if (source.startsWith('!macro:', i)) { const end = source.indexOf('!', i + 7); if (end >= 0) { i = end; continue; } }
        if (c === '"') { quoted = !quoted; continue; }
        if (quoted) continue;
        if (source.startsWith('::', i)) {
            weighted = /(?:^|[\s,])[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(source.slice(0, i));
            stack.length = 0; i++; continue;
        }
        if ('{[('.includes(c)) stack.push(c);
        else if ('}])'.includes(c) && stack.at(-1) === { '}': '{', ']': '[', ')': '(' }[c]) stack.pop();
        else if ((c === ',' || c === '\n') && !stack.length && !weighted) add(i);
    }
    add(source.length);
    return tags;
}

export function findTagQuery(source, caret) {
    if (caret < 0 || caret > source.length) return null;
    const macro = source.lastIndexOf('!macro:', caret);
    if (macro >= 0 && source.indexOf('!', macro + 7) >= caret) return null;
    let start = Math.max(source.lastIndexOf(',', caret - 1), source.lastIndexOf('\n', caret - 1)) + 1;
    const prefix = source.slice(start, caret).match(/^\s*(?:[\[{]+\s*|[-+]?(?:\d+(?:\.\d*)?|\.\d+)::\s*)*/)?.[0] || '';
    start += prefix.length;
    const query = source.slice(start, caret).trimEnd();
    if (query.length < 2 || query.length > 64 || /[@!:{}\[\]"<>]/.test(query)) return null;
    let end = caret;
    while (end < source.length && !/[,\n\r{}\[\]:!]/.test(source[end])) end++;
    const tail = source.slice(caret, end);
    end -= tail.length - tail.trimEnd().length;
    return { start, end, query };
}

export function removePromptTag(source, index) {
    const tags = promptTags(source), tag = tags[index];
    if (!tag) return source;
    if (tags.length === 1) return '';
    if (index < tags.length - 1) return source.slice(0, tag.start) + source.slice(tags[index + 1].start);
    return source.slice(0, tags[index - 1].end) + source.slice(tag.end);
}

export function movePromptTag(source, from, to) {
    const tags = promptTags(source);
    if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < tags.length)) return source;
    const values = tags.map(tag => tag.text);
    values.splice(to, 0, values.splice(from, 1)[0]);
    let output = '', position = 0;
    for (let i = 0; i < tags.length; i++) { output += source.slice(position, tags[i].start) + values[i]; position = tags[i].end; }
    return output + source.slice(position);
}

export function changeTagWeight(text, stronger) {
    const opposite = stronger ? ['[', ']'] : ['{', '}'];
    if (text.startsWith(opposite[0]) && text.endsWith(opposite[1])) {
        let depth = 0, entire = true;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\\') { i++; continue; }
            if (text[i] === opposite[0]) depth++;
            if (text[i] === opposite[1]) depth--;
            if (!depth && i !== text.length - 1) { entire = false; break; }
        }
        if (entire && !depth) return text.slice(1, -1);
    }
    return stronger ? `{${text}}` : `[${text}]`;
}
