// Explicit online smoke check. Creates its own synthetic raster; never reads user images or API keys.
import { deflateSync } from 'node:zlib';
import { classifyArtistImage } from '../lib/artist-classifier.mjs';

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
}
const side = 128;
const header = Buffer.alloc(13); header.writeUInt32BE(side, 0); header.writeUInt32BE(side, 4); header[8] = 8; header[9] = 2;
const raster = Buffer.alloc(side * (1 + side * 3));
for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = y * (1 + side * 3) + 1 + x * 3;
    raster[i] = x * 2; raster[i + 1] = y * 2; raster[i + 2] = 128;
}
const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raster)), chunk('IEND', Buffer.alloc(0))]);
const result = await classifyArtistImage({ dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, consent: true,
    topK: 1, model: process.argv[2] || 'Kaloscope v2.0 ONNX' }, { signal: AbortSignal.timeout(90000) });
console.log(JSON.stringify({ live: true, synthetic: true, model: result.model, artists: result.artists.length, threshold: result.threshold }));
