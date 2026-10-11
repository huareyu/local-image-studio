import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
    buildNovelaiRequest, novelaiDimensions, novelaiCapabilities,
    applyNovelaiTagPresets, DEFAULT_NOVELAI_NEGATIVE,
} from '../public/novelai.js';
import { decodeNovelaiResult } from '../lib/novelai-result.mjs';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xq7vWQAAAABJRU5ErkJggg==', 'base64');

function zipImage(method = 8) {
    const data = method === 8 ? deflateRawSync(pixel) : pixel;
    const name = Buffer.from('image_0.png');
    // A streamed ZIP: sizes live in the directory and descriptor, not local header.
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50);
    descriptor.writeUInt32LE(data.length, 8);
    descriptor.writeUInt32LE(pixel.length, 12);
    const local = Buffer.concat([header, name, data, descriptor]);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(pixel.length, 24);
    directory.writeUInt16LE(name.length, 28);
    const central = Buffer.concat([directory, name]);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(local.length, 16);
    return Buffer.concat([local, central, end]);
}

test('JSON, raw PNG, and streamed ZIP replies produce the same image', () => {
    const expected = `data:image/png;base64,${pixel.toString('base64')}`;
    const json = Buffer.from(JSON.stringify({ images: [{ image: pixel.toString('base64'), seed: 12 }] }));
    assert.deepEqual(decodeNovelaiResult(json), { dataUrl: expected, seed: 12 });
    for (const bytes of [pixel, zipImage(0), zipImage(8)]) assert.equal(decodeNovelaiResult(bytes).dataUrl, expected);
});

test('malformed responses fail instead of displaying invalid images', () => {
    for (const bytes of [Buffer.from('{}'), Buffer.from('not an image'), zipImage().subarray(0, 50)]) {
        assert.throws(() => decodeNovelaiResult(bytes));
    }
    const bomb = zipImage();
    const central = bomb.indexOf(Buffer.from([80, 75, 1, 2]));
    bomb.writeUInt32LE(100 * 1024 * 1024, central + 24);
    assert.throws(() => decodeNovelaiResult(bomb));
});

test('Guard caps steps; Medium fixes sampler, UC and rescale without mutating stored settings', () => {
    const profile = {
        model: 'nai-diffusion-5-full-medium', novelaiSteps: 50, novelaiSampler: 'ddim',
        novelaiCfgRescale: 0.9, novelaiNegativePrompt: 'USER UC', novelaiScale: 7,
    };
    const saved = structuredClone(profile);
    const p = buildNovelaiRequest({ prompt: 'test', profile }).parameters;
    assert.equal(p.steps, 14);
    assert.equal(p.sampler, 'k_euler_ancestral');
    assert.equal(p.scale, 7);
    assert.equal(p.cfg_rescale, 0);
    assert.equal(p.v4_negative_prompt.caption.base_caption, '');
    assert.ok(!('negative_prompt' in p));
    assert.deepEqual(profile, saved);
    const high = { ...profile, model: 'nai-diffusion-5-full' };
    assert.equal(novelaiDimensions(high).steps, 28);
    assert.equal(novelaiDimensions({ ...high, novelaiAnlasGuard: false }).steps, 50);
});

test('NovelAI negative is separate from generic negative and preserves literal prompt syntax', () => {
    const prompt = '{{artist:test}}, -2::chibi::, 1boy';
    const request = buildNovelaiRequest({ prompt, negativePrompt: 'GENERIC NEGATIVE', profile: { model: 'nai-diffusion-5-full' } });
    assert.equal(request.input, prompt);
    assert.equal(request.parameters.negative_prompt, DEFAULT_NOVELAI_NEGATIVE);
    assert.ok(!request.input.includes('Avoid:'));
});

test('disabled references are isolated and V4.5 reference arrays stay aligned at five images', () => {
    const references = Array.from({ length: 7 }, (_, i) => ({ dataUrl: `data:image/png;base64,IMAGE${i}`, description: `REF${i}` }));
    for (const model of ['nai-diffusion-5-full', 'nai-diffusion-5-full-medium', 'nai-diffusion-4-full', 'nai-diffusion-3']) {
        const request = buildNovelaiRequest({ prompt: 'test', references, profile: { model, novelaiEnableReferences: true } });
        assert.equal(request.input, 'test');
        assert.ok(!request.parameters.director_reference_images);
    }
    const off = buildNovelaiRequest({ prompt: 'test', references, profile: { model: 'nai-diffusion-4-5-full', novelaiEnableReferences: false } });
    assert.equal(off.input, 'test');
    const on = buildNovelaiRequest({ prompt: 'test', references, profile: { model: 'nai-diffusion-4-5-full' } });
    for (const [key, value] of Object.entries(on.parameters)) if (key.startsWith('director_reference_')) assert.equal(value.length, 5);
    assert.equal(novelaiCapabilities('my-custom-model').preciseReference, true);
});

test('tag substitutions respect words, Unicode, regex characters and literal dollar signs', () => {
    const presets = [
        { enabled: true, name: 'Zach', value: '1boy, $&' },
        { enabled: true, name: 'Зак', value: 'heterochromia' },
        { enabled: true, name: 'A+B', value: '1girl' },
        { enabled: false, name: 'ignored', value: 'leak' },
    ];
    assert.equal(applyNovelaiTagPresets('ZACH, Zachary, Зак, Закария, A+B, ignored', presets),
        '1boy, $&, Zachary, heterochromia, Закария, 1girl, ignored');
});
