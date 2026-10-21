import { buildTagCatalog } from './tag-catalog.js';
import { normalizeTagRecords, parseTagDictionary, searchTags } from './tag-tools.js';

let base = [], catalog = null, warning = '';
let queue = Promise.resolve();
async function handle({ id, type, payload }) {
    try {
        let result;
        if (type === 'init') {
            warning = '';
            try {
                const response = await fetch(new URL('./data/danbooru.csv', import.meta.url), { signal: AbortSignal.timeout(20000) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                base = parseTagDictionary(await response.text(), 'danbooru.csv');
                if (base.length < 90000) throw new Error('Файл большой базы неполный');
            } catch (error) { base = []; warning = `Danbooru не загрузилась: ${error.message}`; }
            catalog = buildTagCatalog(base, normalizeTagRecords(payload.custom || []));
            result = { ...catalog.metadata, warning };
        } else if (type === 'search') {
            if (!catalog) throw new Error('Словарь ещё загружается');
            result = searchTags(catalog.index, payload.query, { ...payload.options, used: new Set(payload.options?.used || []) });
            result.items = result.items.map(({ search, aliases, ...tag }) => tag);
        } else if (type === 'parse') result = parseTagDictionary(payload.text, payload.filename);
        else if (type === 'set-custom') {
            catalog = buildTagCatalog(base, normalizeTagRecords(payload.tags || []));
            result = { ...catalog.metadata, warning };
        } else throw new Error('Неизвестная операция со словарём');
        self.postMessage({ id, result });
    } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
}
self.onmessage = event => { queue = queue.then(() => handle(event.data)); };
