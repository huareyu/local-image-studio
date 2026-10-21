import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parseTagDictionary, normalizeTagRecords, searchTags } from '../public/tag-tools.js';
import { buildTagCatalog } from '../public/tag-catalog.js';

const directory = new URL('../public/data/', import.meta.url);
const bytes = await fs.readFile(new URL('danbooru.csv', directory));
const meta = JSON.parse(await fs.readFile(new URL('danbooru.meta.json', directory), 'utf8'));
const base = parseTagDictionary(bytes.toString('utf8'), 'danbooru.csv');
const catalog = buildTagCatalog(base);

test('bundled Danbooru is a large, unmodified, credited snapshot with aliases and popularity', async () => {
    assert.equal(base.length, 140782);
    assert.equal(base.length, meta.tags);
    assert.equal(bytes.length, meta.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), meta.blobSha);
    assert.ok(base.reduce((count, tag) => count + tag.aliases.length, 0) > 140000);
    assert.ok(base.some(tag => tag.count > 1e6));
    assert.match(await fs.readFile(new URL('DANBOORU-LICENSE.txt', directory), 'utf8'), /Copyright \(c\) 2022 Dominik Reh/);
    assert.ok(catalog.metadata.total >= 140782);
});

test('Russian curated explanations merge with Danbooru counts instead of replacing the big database', () => {
    const blueHair = searchTags(catalog.index, 'голубые волосы').items[0];
    assert.equal(blueHair.tag, 'blue hair');
    assert.ok(blueHair.count > 1000);
    assert.equal(searchTags(catalog.index, 'blue_ha', { limit: 6 }).items[0].tag, 'blue hair');
    assert.ok(catalog.metadata.categories.includes('Авторы'));
    assert.ok(catalog.metadata.categories.includes('Персонажи'));
    const aliasEntry = base.find(tag => tag.aliases.length && tag.aliases.some(alias => alias !== tag.tag));
    const alias = aliasEntry.aliases.find(value => value !== aliasEntry.tag);
    assert.ok(searchTags(catalog.index, alias, { limit: 200 }).items.some(tag => tag.tag === aliasEntry.tag));
});

test('custom dictionary overlays keep main database, counts and all other tags intact', () => {
    const custom = normalizeTagRecords([{ tag: 'blue_hair', desc: 'Мой перевод', category: 'Мои' }, { tag: 'ultra_glow', desc: 'Мой эффект' }]);
    const result = buildTagCatalog(base, custom);
    assert.equal(result.metadata.baseCount, 140782);
    assert.equal(result.metadata.customCount, 2);
    assert.equal(searchTags(result.index, 'мой перевод').items[0].tag, 'blue hair');
    assert.ok(searchTags(result.index, 'мой перевод').items[0].count > 1000);
    assert.equal(searchTags(result.index, 'мой эффект').items[0].tag, 'ultra glow');
});

test('search keeps exact/prefix/alias ranking, counts, exclusions and deep pages without sorting per request', () => {
    const index = buildTagCatalog(normalizeTagRecords([
        { tag: 'blue hair', count: 10 }, { tag: 'blue hair ribbon', count: 100 },
        { tag: 'dark blue hair', count: 1000 }, { tag: 'azure', aliases: ['blue hair'], count: 10000 },
    ])).index;
    assert.deepEqual(searchTags(index, 'blue hair', { category: 'Мои теги' }).items.map(item => item.tag), ['blue hair ribbon', 'dark blue hair', 'azure']);
    const used = new Set(['blue hair']);
    assert.equal(searchTags(catalog.index, 'blue hair', { used }).items.some(tag => tag.key === 'blue hair'), false);
    assert.deepEqual(searchTags(catalog.index, '', { offset: 100000, limit: 12 }).items, catalog.index.slice(100000, 100012));
    const begin = performance.now();
    for (const query of ['blue ha', 'long hair', 'looking at', 'asdfnotarealtag']) assert.ok(searchTags(catalog.index, query, { limit: 6 }).items.length <= 6);
    const elapsed = performance.now() - begin;
    assert.ok(elapsed < 2500, `Four dictionary queries took ${elapsed.toFixed(0)} ms`);
    console.log(`Danbooru local benchmark: 4 searches / ${catalog.index.length} tags in ${elapsed.toFixed(1)} ms (worker in browser)`);
});
