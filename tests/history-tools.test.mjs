import test from 'node:test';
import assert from 'node:assert/strict';
import { filterHistory, pageNumbers } from '../public/history-tools.js';

const entries = [
    { id: 'first', createdAt: new Date(2026, 9, 20, 0).getTime(), provider: 'gemini', model: 'nano-banana', prompt: 'Итан с котом', profileName: 'Мягкий стиль', seed: 12345, archive: { fileName: 'ethan-one.png' } },
    { id: 'second', createdAt: new Date(2026, 9, 21, 0).getTime(), provider: 'novelai', model: 'nai-diffusion-5-full', prompt: '!macro:Zach!', resolvedPrompt: 'Boy with brown hair', prefix: 'artist:foo' },
    { id: 'third', createdAt: new Date(2026, 9, 20, 23, 59, 59).getTime(), provider: 'gemini', prompt: 'Итан в лесу' },
];

test('gallery searches all metadata fields with case-insensitive AND terms, not image bytes', () => {
    assert.deepEqual(filterHistory(entries, { search: '  ИТАН котом  ' }).map(entry => entry.id), ['first']);
    for (const search of ['nano-banana', 'мягкий', 'ethan-one', '12345']) assert.equal(filterHistory(entries, { search })[0].id, 'first');
    for (const search of ['zach', 'brown hair', 'artist:foo', 'ＮＡＩ']) assert.equal(filterHistory(entries, { search })[0].id, 'second');
    assert.deepEqual(filterHistory(entries, { search: 'не существует' }), []);
    assert.deepEqual(filterHistory([{ ...entries[0], dataUrl: 'secret image bytes' }], { search: 'secret' }), []);
});

test('provider and local date filters combine with search and include the whole day', () => {
    assert.deepEqual(filterHistory(entries, { date: '2026-10-20' }).map(entry => entry.id), ['third', 'first']);
    assert.deepEqual(filterHistory(entries, { provider: 'gemini', date: '2026-10-21' }), []);
    assert.deepEqual(filterHistory(entries, { provider: 'gemini', date: '2026-10-20', search: 'котом' }).map(entry => entry.id), ['first']);
});

test('sort changes do not mutate history and ties have a stable ID order', () => {
    assert.deepEqual(filterHistory(entries).map(entry => entry.id), ['second', 'third', 'first']);
    assert.deepEqual(filterHistory(entries, { order: 'oldest' }).map(entry => entry.id), ['first', 'third', 'second']);
    assert.deepEqual(entries.map(entry => entry.id), ['first', 'second', 'third']);
    assert.deepEqual(filterHistory([{ id: 'b', createdAt: 0 }, { id: 'a', createdAt: 0 }]).map(entry => entry.id), ['a', 'b']);
});

test('page shortcuts include endpoints and neighbors without creating thousands of buttons', () => {
    assert.deepEqual(pageNumbers(0, 0), []);
    assert.deepEqual(pageNumbers(0, 1), [0]);
    assert.deepEqual(pageNumbers(0, 3), [0, 1, 2]);
    assert.deepEqual(pageNumbers(54, 1000), [0, 53, 54, 55, 999]);
    assert.deepEqual(pageNumbers(999, 1000), [0, 998, 999]);
});
