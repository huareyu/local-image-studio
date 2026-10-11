import { inflateRawSync } from 'node:zlib';

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageResult(bytes, seed) {
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('NovelAI вернул некорректное PNG-изображение');
    }
    return { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, ...(seed == null ? {} : { seed }) };
}

// Some compatible endpoints still return ZIP even when JSON was requested.
// Read only a bounded PNG entry; no files are extracted to disk.
function pngFromZip(buffer) {
    let end = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
            end = i;
            break;
        }
    }
    if (end < 0) throw new Error('Некорректный ZIP-ответ NovelAI');
    const count = buffer.readUInt16LE(end + 10);
    let offset = buffer.readUInt32LE(end + 16);
    for (let i = 0; i < count; i++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const size = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const local = buffer.readUInt32LE(offset + 42);
        const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        if (/\.png$/i.test(name)) {
            if (size > MAX_IMAGE_BYTES || local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) break;
            if (buffer.readUInt16LE(local + 6) & 1) throw new Error('Зашифрованный ZIP-ответ не поддерживается');
            const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
            if (start + compressedSize > buffer.length) break;
            const entry = buffer.subarray(start, start + compressedSize);
            const bytes = method === 0 ? entry
                : method === 8 ? inflateRawSync(entry, { maxOutputLength: MAX_IMAGE_BYTES }) : null;
            if (!bytes || bytes.length !== size) break;
            return bytes;
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error('В ZIP-ответе NovelAI нет доступного PNG');
}

export function decodeNovelaiResult(buffer) {
    if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return imageResult(buffer);
    if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return imageResult(pngFromZip(buffer));
    let payload;
    try { payload = JSON.parse(buffer.toString('utf8')); }
    catch { throw new Error('Неизвестный формат ответа NovelAI'); }
    const image = payload?.images?.[0];
    const base64 = typeof image === 'string' ? image : image?.image;
    if (typeof base64 !== 'string' || !base64) throw new Error(payload?.message || 'NovelAI не вернул изображение');
    return imageResult(Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64'), image?.seed);
}
