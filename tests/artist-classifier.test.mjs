import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyArtistImage, normalizeArtistResult, readArtistEvents } from '../lib/artist-classifier.mjs';
import { artistPromptTags, artistDanbooruUrl } from '../public/artist-tools.js';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==';
const output = ['', { data: [['untrusted HTML ignored']] }, JSON.stringify({ artist_a: .8, artist_b: .2 }), ''];
function stream(text) {
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('classifier uploads only raster data, submits correct Gradio inputs and fixed threshold, then parses SSE', async () => {
    const calls = [];
    const result = await classifyArtistImage({ dataUrl, topK: 2, consent: true, threshold: .9, apiKey: 'DO_NOT_SEND', prompt: 'PRIVATE_PROMPT', filename: 'private.png' }, {
        endpoint: 'http://mock.test', fetchImpl: async (url, options) => {
            calls.push({ url, options });
            if (url.endsWith('/upload')) return Response.json(['/tmp/gradio/public/reference.png']);
            if (url.endsWith('/call/predict')) return Response.json({ event_id: 'abc-123' });
            return stream(`event: heartbeat\r\ndata: null\r\n\r\nevent: complete\r\ndata: ${JSON.stringify(output)}\r\n\r\n`);
        },
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.body.get('files').name, 'reference.png');
    assert.equal(calls[0].options.body.get('files').type, 'image/png');
    assert.deepEqual(JSON.parse(calls[1].options.body).data, [{ path: '/tmp/gradio/public/reference.png', meta: { _type: 'gradio.FileData' } }, 'Kaloscope v2.0 ONNX', 2, 0]);
    assert.equal(JSON.stringify(calls).includes('DO_NOT_SEND'), false);
    assert.equal(JSON.stringify(calls).includes('PRIVATE_PROMPT'), false);
    assert.equal(result.artists[0].name, 'artist_a'); assert.equal(result.artists[0].score, .8);
    assert.equal(result.threshold, 0);
});

test('consent, parameters and image format are validated before any external request', async () => {
    let calls = 0;
    const fetchImpl = () => { calls++; throw new Error('Unexpected fetch'); };
    for (const body of [{ dataUrl }, { consent: true, dataUrl, topK: 26 }, { consent: true, dataUrl, topK: 1.5 },
        { consent: true, dataUrl, model: 'unknown' }, { consent: true, dataUrl: 'https://private.test/image' },
        { consent: true, dataUrl: 'data:image/png;base64,SGVsbG8=' }, { consent: true, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }]) {
        await assert.rejects(classifyArtistImage(body, { fetchImpl }), error => error.status === 400);
    }
    assert.equal(calls, 0);
});

test('HTML from tables/artist names is not used; scores, URLs, tag format and duplicates are safe', () => {
    const artists = normalizeArtistResult(['', '<script>bad</script>', JSON.stringify({ '<img src=x>': .99, 'artist:injected': .9, valid_artist: .7, invalid_score: 2, text_score: '.2' })], 25);
    assert.deepEqual(artists.map(artist => artist.name), ['valid_artist']);
    assert.equal(artists[0].url, artistDanbooruUrl('valid_artist'));
    assert.equal(artistPromptTags(['a', 'a', 'b_(artist)', '!macro:bad!']), 'artist:a, artist:b_(artist)');
    assert.equal(artistPromptTags(['a', 'b'], 'plain'), 'a, b');
});

test('SSE handles UTF-8, split CRLF, errors, broken connections and malformed outputs', async () => {
    assert.deepEqual(await readArtistEvents(stream(`event: complete\r\ndata: ${JSON.stringify(['Автор'])}\r\n\r\n`)), ['Автор']);
    await assert.rejects(readArtistEvents(stream('event: error\ndata: "Queue full"\n\n')), /Queue full/);
    await assert.rejects(readArtistEvents(stream('event: heartbeat\ndata: null\n\n')), /без результата/);
    await assert.rejects(readArtistEvents(stream('event: complete\ndata: invalid JSON\n\n')), /прочитать результат/);
    assert.throws(() => normalizeArtistResult(['wrong shape'], 5), /изменился/);
});

test('invalid upload paths/event IDs and rate limits fail rather than fetching arbitrary URLs', async () => {
    for (const response of [[], [''], { error: 'not upload' }]) await assert.rejects(classifyArtistImage({ consent: true, dataUrl }, { fetchImpl: async () => Response.json(response) }), /не подтвердил/);
    let calls = 0;
    await assert.rejects(classifyArtistImage({ consent: true, dataUrl }, { fetchImpl: async () => ++calls === 1 ? Response.json(['/tmp/public.png']) : Response.json({ event_id: '../../private' }) }), /ID анализа/);
    assert.equal(calls, 2);
    await assert.rejects(classifyArtistImage({ consent: true, dataUrl }, { fetchImpl: async () => new Response('Limit', { status: 429 }) }), /частоту/);
});
