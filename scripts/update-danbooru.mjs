// Reproducible vendor-data download; never downloads executable code or user images.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseTagDictionary } from '../public/tag-tools.js';

const commit = '209b1dd76b69e95ba6b1619ea5d13e68446607b7';
const blobSha = '7a3cba59a8cd75bad45b0097338f8f882714a040';
const url = `https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/${commit}/tags/danbooru.csv`;
const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`Danbooru source HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if (actual !== blobSha) throw new Error('Source checksum mismatch');
const tags = parseTagDictionary(bytes.toString('utf8'), 'danbooru.csv');
if (tags.length < 90000) throw new Error('Unexpectedly small Danbooru dictionary');
const directory = new URL('../public/data/', import.meta.url);
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(new URL('danbooru.csv', directory), bytes);
const metadata = { source: 'DominikDoom/a1111-sd-webui-tagcomplete', url, commit, blobSha,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, tags: tags.length,
    aliases: tags.reduce((count, tag) => count + tag.aliases.length, 0), license: 'MIT',
    sourceLicense: `https://github.com/DominikDoom/a1111-sd-webui-tagcomplete/blob/${commit}/LICENSE` };
await fs.writeFile(new URL('danbooru.meta.json', directory), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata));
