export function createTagSearchClient() {
    const worker = new Worker(new URL('./tag-search-worker.js', import.meta.url), { type: 'module' });
    const pending = new Map(), cache = new Map();
    let serial = 0, stopped = false;
    function fail(message) {
        stopped = true;
        for (const job of pending.values()) { clearTimeout(job.timeout); job.reject(new Error(message)); }
        pending.clear(); cache.clear(); worker.terminate();
    }
    worker.addEventListener('error', () => fail('Не удалось запустить фоновый поиск тегов'));
    worker.addEventListener('messageerror', () => fail('Не удалось прочитать ответ поиска тегов'));
    worker.addEventListener('message', ({ data }) => {
        const job = pending.get(data.id);
        if (!job) return;
        clearTimeout(job.timeout); pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
    });
    function request(type, payload = {}) {
        if (stopped) return Promise.reject(new Error('Фоновый поиск остановлен. Нажми «Повторить загрузку».'));
        if (type !== 'search') cache.clear();
        const key = JSON.stringify(payload);
        if (type === 'search' && cache.has(key)) return cache.get(key);
        const promise = new Promise((resolve, reject) => {
            const id = ++serial;
            const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Поиск не ответил вовремя. Попробуй повторить загрузку.')); }, 30000);
            pending.set(id, { resolve, reject, timeout });
            worker.postMessage({ id, type, payload });
        });
        if (type === 'search') {
            cache.set(key, promise);
            if (cache.size > 32) cache.delete(cache.keys().next().value);
            promise.catch(() => cache.delete(key));
        }
        return promise;
    }
    return { request, close: () => fail('Словарь перезагружается') };
}
