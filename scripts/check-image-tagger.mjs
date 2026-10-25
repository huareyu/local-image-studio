// Explicit online check: uploads only a synthetic gradient, never user images, keys or prompts.
import { deflateSync } from 'node:zlib';
import { tagImage } from '../lib/image-tagger.mjs';
import { fetch } from 'undici';
import { readGradioEvents } from '../lib/gradio.mjs';

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
let failed = false;
for (const service of process.argv[2] ? [process.argv[2]] : ['wd', 'pixai']) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
        const result = await tagImage({ dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, consent: true, service }, {
            signal: controller.signal,
            fetchImpl: async (url, options) => {
                const response = await fetch(url, options);
                if (process.env.IMAGE_STUDIO_INSPECT_TAGGER === '1' && !options.method && response.ok) {
                    const data = await readGradioEvents(response, service);
                    console.log(JSON.stringify({ synthetic: true, service, output: data }));
                    return new Response(`event: complete\ndata: ${JSON.stringify(data)}\n\n`);
                }
                return response;
            },
        });
        console.log(JSON.stringify({ live: true, synthetic: true, service, model: result.model, tags: result.tags.length }));
    } catch (error) { failed = true; console.error(JSON.stringify({ live: true, synthetic: true, service, error: error.message })); }
    finally { clearTimeout(timeout); }
}
if (failed) process.exitCode = 1;
