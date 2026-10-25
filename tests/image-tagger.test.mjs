import test from 'node:test';
import assert from 'node:assert/strict';
import { tagImage, normalizeTaggerResult } from '../lib/image-tagger.mjs';
import { readGradioEvents } from '../lib/gradio.mjs';
import { imageTagPrompt, appendImageTags } from '../public/image-tagger-tools.js';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==';
const label = entries => ({ label: entries[0]?.[0] ?? null, confidences: entries.map(([label, confidence]) => ({ label, confidence })) });
const general = label([['1girl', .99], ['long hair', .9], ['low_score', .1], ['<script>bad</script>', .99], ['!macro:bad!', .99], ['bad_score', 4], ['text_score', '.8']]);
const characters = label([['test_character', .96], ['long_hair', .86]]);
const output = service => service === 'pixai' ? ['IGNORE_TEXT', '', 'IGNORE_TEXT', characters, general, 'IGNORE_MARKDOWN']
    : ['IGNORE_TEXT', 'IGNORE_RATING', characters, general];
function stream(text) {
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
}
test('WD and PixAI upload only raster data and use the correct Gradio input order', async () => {
    for (const service of ['wd', 'pixai']) {
        const calls = [], signal = new AbortController().signal, dispatcher = {};
        const result = await tagImage({ dataUrl, service, consent: true, apiKey: 'PRIVATE_KEY', filename: 'PRIVATE_FILE.png', prompt: 'PRIVATE_PROMPT', endpoint: 'https://evil.test' }, {
            endpoint: 'http://mock.test', signal, dispatcher, fetchImpl: async (url, options) => {
                calls.push({ url, options });
                if (url.endsWith('/upload')) return Response.json(['/tmp/gradio/image.png']);
                if (options.method === 'POST') return Response.json({ event_id: 'test-id' });
                return stream(`event: heartbeat\r\ndata: null\r\n\r\nevent: complete\r\ndata: ${JSON.stringify(output(service))}\r\n\r\n`);
            },
        });
        assert.equal(calls.length, 3);
        assert.equal(calls[0].options.body.get('files').name, 'reference.png');
        assert.equal(calls[0].options.body.get('files').type, 'image/png');
        const inputs = JSON.parse(calls[1].options.body).data;
        assert.deepEqual(inputs[0], { path: '/tmp/gradio/image.png', meta: { _type: 'gradio.FileData' } });
        assert.deepEqual(inputs.slice(1), service === 'wd' ? ['SmilingWolf/wd-eva02-large-tagger-v3', .35, false, .85, false] : [.3, .75, false, true]);
        assert.ok(calls[1].url.endsWith(service === 'wd' ? '/call/predict' : '/call/run_inference'));
        assert.ok(calls.every(call => call.options.signal === signal && call.options.dispatcher === dispatcher && call.options.redirect === 'error'));
        assert.equal(/PRIVATE_|evil\.test/.test(JSON.stringify(calls)), false);
        assert.deepEqual(result.tags.map(row => row.name), ['1girl', 'test_character', 'long_hair']);
        assert.equal(result.tags.find(row => row.name === 'long_hair').group, 'general');
    }
});
test('no external call without consent, allowed service/model, valid thresholds and a raster', async () => {
    let calls = 0; const fetchImpl = () => { calls++; throw new Error('Unexpected external call'); };
    for (const patch of [{ consent: false }, { service: '__proto__' }, { service: 'other' }, { model: 'custom/arbitrary' },
        { generalThreshold: '0.3' }, { generalThreshold: -1 }, { generalThreshold: NaN }, { characterThreshold: 1.1 },
        { dataUrl: 'https://private.test/a' }, { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, { dataUrl: 'data:image/png;base64,SGVsbG8=' }]) {
        await assert.rejects(tagImage({ consent: true, service: 'wd', dataUrl, ...patch }, { fetchImpl }), error => error.status === 400);
    }
    assert.equal(calls, 0);
});
test('safe result normalization filters thresholds, deduplicates tags, rejects malformed/failed responses', () => {
    assert.deepEqual(normalizeTaggerResult(output('wd'), 'wd', .95, .99).map(row => row.name), ['1girl']);
    assert.deepEqual(normalizeTaggerResult(['', '', label([]), label([])], 'wd', .35, .85), []);
    assert.deepEqual(normalizeTaggerResult(['', '', {}, general], 'wd', .35, .85).map(row => row.name), ['1girl', 'long_hair']);
    assert.deepEqual(normalizeTaggerResult(['', '', '', {}, {}], 'pixai', .3, .75), []);
    assert.throws(() => normalizeTaggerResult(['', '', { label: 'missing_scores' }, general], 'wd', .35, .85), /Формат/);
    assert.throws(() => normalizeTaggerResult([], 'wd', .35, .85), /Формат/);
    assert.throws(() => normalizeTaggerResult(['', 'Error: broken', '', characters, general], 'pixai', .3, .75), /не смог/);
    assert.equal(normalizeTaggerResult(['', '', label([]), label(Array.from({ length: 600 }, (_, i) => [`tag_${i}`, .5]))], 'wd', 0, 0).length, 500);
});
test('prompt format preserves kaomoji and parentheses, append does not replace existing text or repeat plain tags', () => {
    assert.equal(imageTagPrompt(['long hair', 'long_hair', 'name_(series)', '0_0', '!macro:bad!']), 'long_hair, name_(series), 0_0');
    assert.equal(imageTagPrompt(['long_hair', 'name_(series)', '0_0'], 'spaces'), 'long hair, name (series), 0_0');
    assert.equal(appendImageTags('my scene, long hair, ', 'long_hair, 1girl'), '1girl, ');
    assert.equal(appendImageTags('my scene', '1girl'), ', 1girl, ');
    assert.equal(appendImageTags('', '1girl'), '1girl, ');
    assert.equal(appendImageTags('1GIRL, ', '1girl'), '');
});
test('bounded SSE supports UTF-8 and CRLF, propagates failures and rejects broken streams', async () => {
    assert.deepEqual(await readGradioEvents(stream('event: complete\r\ndata: ["тег"]\r\n\r\n'), 'WD Tagger'), ['тег']);
    await assert.rejects(readGradioEvents(stream('event: error\ndata: "queue full"\n\n'), 'PixAI Tagger'), /PixAI Tagger.*queue full/);
    await assert.rejects(readGradioEvents(stream('event: heartbeat\ndata: null\n\n')), /без результата/);
    await assert.rejects(readGradioEvents(stream('event: complete\ndata: broken\n\n')), /прочитать результат/);
    await assert.rejects(readGradioEvents(new Response('limit', { status: 429 })), /частоту/);
});
test('malformed upload paths and event IDs never trigger arbitrary fetches', async () => {
    for (const response of [[], [''], { path: 'bad' }]) await assert.rejects(tagImage({ consent: true, dataUrl }, { fetchImpl: async () => Response.json(response) }), /не подтвердил/);
    let calls = 0;
    await assert.rejects(tagImage({ consent: true, dataUrl }, { fetchImpl: async () => ++calls === 1 ? Response.json(['/tmp/image.png']) : Response.json({ event_id: '../../private' }) }), /ID анализа/);
    assert.equal(calls, 2);
});
