// Decode/re-encode locally before asking for consent to upload. Strips file metadata and name.
export async function prepareAnalysisImage(source) {
    if (typeof source === 'string' && (!/^data:image\/(?:png|jpeg|webp);base64,/.test(source) || source.length > 42 * 1024 * 1024)) throw new Error('Нужна локальная растровая картинка до 30 МБ');
    const file = typeof source === 'string' ? await fetch(source).then(response => response.blob()) : source;
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Выбери PNG, JPEG или WebP');
    if (file.size > 30 * 1024 * 1024) throw new Error('Исходная картинка должна быть не больше 30 МБ');
    const bitmap = await createImageBitmap(file);
    try {
        if (bitmap.width * bitmap.height > 60000000) throw new Error('Картинка слишком большая по размерам');
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return { dataUrl: canvas.toDataURL('image/jpeg', .94), width: canvas.width, height: canvas.height };
    } finally { bitmap.close(); }
}
