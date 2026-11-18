import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssistantAccess, assistantRequest } from '../lib/assistant-access.mjs';

const profile = { id: 'nb', name: 'Nano Banana', provider: 'gemini', model: 'nano-banana-custom', endpoint: 'http://provider.test',
    apiKey: 'PROVIDER_SECRET', proxyPassword: 'PROXY_SECRET', imageSize: '2K', aspectRatio: '3:4' };
async function fixture(t, options = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'image-studio-assistant-'));
    t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); await fs.rm(directory, { recursive: true, force: true }); });
    const bridge = createAssistantAccess({ directory, origin: 'http://127.0.0.1:3210', cliPath: '/studio/scripts/studio-assistant.mjs', ...options });
    const token = async () => (JSON.parse(await fs.readFile(path.join(directory, 'connection.json'), 'utf8'))).token;
    return { directory, bridge, token };
}
test('access is disabled by default; granting stores only a capability, never provider credentials', async t => {
    const { bridge, directory, token } = await fixture(t);
    assert.equal(bridge.status().enabled, false);
    await assert.rejects(bridge.generate('', { prompt: 'test' }, () => assert.fail('must not run')), error => error.status === 403);
    await assert.rejects(bridge.enable({ profile }), error => error.status === 400);
    const shared = { ...profile, browserDraft: 'PRIVATE_DRAFT', otherProfiles: [{ apiKey: 'PRIVATE_OTHER' }], references: ['PRIVATE_REF'] };
    await bridge.enable({ consent: true, profile: shared });
    const connection = await fs.readFile(path.join(directory, 'connection.json'), 'utf8');
    assert.equal(/SECRET|PRIVATE_|nano-banana-custom/.test(connection), false);
    assert.match(await token(), /^[a-f0-9]{64}$/);
    assert.equal(/SECRET|PRIVATE_|endpoint|token/.test(JSON.stringify(bridge.status())), false);
    let actual;
    await bridge.generate(`Bearer ${await token()}`, { prompt: 'only this prompt' }, async body => { actual = body; });
    assert.equal(actual.profile.apiKey, profile.apiKey); assert.equal(actual.imageSize, '2K'); assert.equal(actual.aspectRatio, '3:4');
    assert.equal(actual.prompt, 'only this prompt'); assert.equal(actual.prefix, ''); assert.deepEqual(actual.references, []);
    assert.equal('browserDraft' in actual.profile || 'references' in actual.profile, false);
    assert.equal(JSON.stringify(actual).includes('PRIVATE_'), false);
    // Nothing rehydrates a grant or provider key from a leftover file after a server restart.
    assert.equal(createAssistantAccess({ directory }).status().enabled, false);
});
test('wrong tokens are rejected, rotating a profile invalidates the old token, disable removes access', async t => {
    const { bridge, token, directory } = await fixture(t);
    await bridge.enable({ consent: true, profile }); const old = await token();
    assert.throws(() => bridge.authenticate('Bearer bad'), error => error.status === 401);
    assert.throws(() => bridge.authenticate(`Bearer ${'0'.repeat(64)}`), error => error.status === 401);
    await bridge.enable({ consent: true, profile: { ...profile, name: 'Other', model: 'other-model' } });
    assert.notEqual(await token(), old);
    assert.throws(() => bridge.authenticate(`Bearer ${old}`), error => error.status === 401);
    await bridge.revoke(); assert.equal(bridge.status().enabled, false);
    await assert.rejects(fs.access(path.join(directory, 'connection.json')), error => error.code === 'ENOENT');
});
test('only one generation at a time; revoke aborts a running request and invalid input never costs a call', async t => {
    const { bridge, token } = await fixture(t); await bridge.enable({ consent: true, profile }); const authorization = `Bearer ${await token()}`;
    await assert.rejects(bridge.generate(authorization, { prompt: '' }, () => {}), error => error.status === 400);
    assert.equal(bridge.status().usedLastHour, 0);
    let started; const ready = new Promise(resolve => { started = resolve; });
    const running = bridge.generate(authorization, { prompt: 'test' }, (_, signal) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); started();
    }));
    // Attach rejection immediately: revocation can reject before its own filesystem work completes.
    const stopped = assert.rejects(running, /aborted/); await ready;
    assert.equal(bridge.status().busy, true);
    await assert.rejects(bridge.generate(authorization, { prompt: 'second' }, () => {}), error => error.status === 409);
    await assert.rejects(bridge.enable({ consent: true, profile }), error => error.status === 409);
    await bridge.revoke(); await stopped; assert.equal(bridge.status().busy, false);
});
test('rate limit includes failures and expires; aliases/drafts/endpoint overrides are not accepted', async t => {
    let time = 10000000; const { bridge, token } = await fixture(t, { now: () => time, limit: 2 });
    await bridge.enable({ consent: true, profile }); const authorization = `Bearer ${await token()}`;
    await assert.rejects(bridge.generate(authorization, { prompt: 'test' }, () => { throw new Error('provider failed'); }), /provider failed/);
    await bridge.generate(authorization, { prompt: 'test' }, () => {});
    await assert.rejects(bridge.generate(authorization, { prompt: 'third' }, () => {}), error => error.status === 429);
    time += 3600001; await bridge.generate(authorization, { prompt: 'after one hour' }, () => {});
    assert.equal(bridge.status().usedLastHour, 1);
    for (const extra of [{ profile }, { endpoint: 'http://evil' }, { apiKey: 'x' }, { n: 100 }, { model: 'expensive' }, { output: '/arbitrary/file' }]) {
        assert.throws(() => assistantRequest({ prompt: 'test', ...extra }, profile), error => error.status === 400);
    }
});
test('request overrides are bounded and reference URLs/paths/SVGs are not fetched', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==';
    const request = assistantRequest({ prompt: 'test', aspectRatio: '16:9', imageSize: '1K', references: [{ dataUrl: png }] }, profile);
    assert.equal(request.references.length, 1); assert.equal(request.aspectRatio, '16:9');
    for (const patch of [{ imageSize: '16K' }, { aspectRatio: '100:1' }, { prompt: 'a'.repeat(30001) }, { references: ['https://private.test'] },
        { references: [{ dataUrl: '/private.png' }] }, { references: [{ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }] }, { references: Array(6).fill({ dataUrl: png }) }]) {
        assert.throws(() => assistantRequest({ prompt: 'test', ...patch }, profile), error => [400, 413].includes(error.status));
    }
    assert.throws(() => assistantRequest({ prompt: 'test', references: [{ dataUrl: png }] }, { ...profile, provider: 'novelai' }), /интерфейс/);
});
