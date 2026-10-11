import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createImageArchive, folderCommand } from '../lib/image-archive.mjs';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xq7vWQAAAABJRU5ErkJggg==';
const entry = { id: 'test-image', createdAt: 1720000000000, dataUrl: PIXEL };

async function temporaryFolder(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'image-studio-archive-'));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('image-studio-archive-'));
        await fs.rm(directory, { recursive: true, force: true });
    });
    return directory;
}

test('archive writes original bytes, preserves filenames on retries, never overwrites another image', async t => {
    const directory = await temporaryFolder(t);
    const archive = createImageArchive(directory);
    const saved = await archive.save(entry);
    assert.equal(saved.folderPath, path.resolve(directory));
    assert.match(saved.fileName, /^image-.*-test-image\.png$/);
    assert.deepEqual(await fs.readFile(path.join(directory, saved.fileName)), Buffer.from(PIXEL.split(',')[1], 'base64'));
    assert.deepEqual(await archive.save(entry), saved);
    assert.equal((await fs.readdir(directory)).length, 1);
    const differentBytes = Buffer.from(PIXEL.split(',')[1], 'base64');
    differentBytes[differentBytes.length - 1] ^= 1;
    await assert.rejects(archive.save({ ...entry, dataUrl: `data:image/png;base64,${differentBytes.toString('base64')}` }), /другое изображение/);
});

test('archive rejects path traversal, bad dates, executable content and invalid image headers', async t => {
    const directory = await temporaryFolder(t);
    const archive = createImageArchive(directory);
    for (const id of ['../escape', 'C:\\outside', 'image.png', 'a/b', '', null]) {
        await assert.rejects(archive.save({ ...entry, id }), /ID/);
    }
    for (const createdAt of [NaN, Infinity, null, '2026-10-11']) {
        await assert.rejects(archive.save({ ...entry, createdAt }), /дата/);
    }
    for (const dataUrl of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,bm90IGEgcGljdHVyZQ==', 'data:image/png;base64,@@@=']) {
        await assert.rejects(archive.save({ ...entry, dataUrl }));
    }
    assert.deepEqual(await fs.readdir(directory), []);
});

test('folder opening only receives the fixed archive directory and uses separate executable arguments', async t => {
    const directory = await temporaryFolder(t);
    const calls = [];
    const archive = createImageArchive(directory, { openFolder: async folder => calls.push(folder) });
    assert.deepEqual(await archive.open(), { folderPath: path.resolve(directory) });
    assert.deepEqual(calls, [path.resolve(directory)]);
    const unusualPath = 'D:\\My Pictures & stuff';
    assert.deepEqual(folderCommand(unusualPath, 'win32'), { command: 'explorer.exe', args: [unusualPath] });
    assert.deepEqual(folderCommand(unusualPath, 'darwin'), { command: 'open', args: [unusualPath] });
    assert.deepEqual(folderCommand(unusualPath, 'linux'), { command: 'xdg-open', args: [unusualPath] });
});
