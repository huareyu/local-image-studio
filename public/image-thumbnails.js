// Small, bounded in-memory previews. Do not keep dozens of original 2K/4K images decoded.
export function createThumbnailLoader(read) {
    const cache = new Map(), pending = new Map(), queue = [];
    let running = 0;
    async function thumbnail(id) {
        const entry = await read(id);
        if (!entry?.dataUrl) return null;
        const image = new Image();
        try {
            image.src = entry.dataUrl;
            await image.decode();
            const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/webp', .78);
        } finally { image.removeAttribute('src'); }
    }
    function pump() {
        while (running < 2 && queue.length) {
            const job = queue.shift();
            if (!job.wanted.some(check => check())) {
                pending.delete(job.id);
                job.resolve(null);
                continue;
            }
            running++;
            thumbnail(job.id).then(value => {
                if (value) {
                    cache.set(job.id, value);
                    if (cache.size > 64) cache.delete(cache.keys().next().value);
                }
                job.resolve(value);
            }, job.reject).finally(() => { pending.delete(job.id); running--; pump(); });
        }
    }
    return (id, isWanted = () => true) => {
        if (cache.has(id)) return Promise.resolve(cache.get(id));
        if (pending.has(id)) { pending.get(id).wanted.push(isWanted); return pending.get(id).promise; }
        const job = { id, wanted: [isWanted] };
        job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
        pending.set(id, job);
        queue.push(job);
        pump();
        return job.promise;
    };
}
