import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkToken, chunkReferences, expandPromptChunks, findChunkQuery, renameChunkReferences, compilePromptText } from '../public/prompt-tools.js';

const chunks = [
    { name: 'Artist', text: '{{artist:kamochiru}}, 1.2::loose brushwork::, ' },
    { name: 'Свет', text: 'soft lighting, pale colors, ' },
    { name: 'Style', text: '!macro:Artist!, !macro:Свет!' },
];

test('case-sensitive chunks expand recursively without changing NovelAI weighting or artist syntax', () => {
    const result = expandPromptChunks('!macro:Style!, 1boy, -2::text::', chunks);
    assert.equal(result, '{{artist:kamochiru}}, 1.2::loose brushwork::, soft lighting, pale colors, 1boy, -2::text::');
    assert.throws(() => expandPromptChunks('!macro:artist!', chunks), /не найден/);
    assert.equal(expandPromptChunks('Text: "a,,b", !macro:Свет!', chunks), 'Text: "a,,b", soft lighting, pale colors, ');
});

test('replacement strings remain literal and empty chunks are supported', () => {
    assert.equal(expandPromptChunks('!macro:Money!', [{ name: 'Money', text: '$& $1 $$' }]), '$& $1 $$');
    assert.equal(expandPromptChunks('before!macro:Empty!after', [{ name: 'Empty', text: '' }]), 'beforeafter');
    const source = '{{artist:123}}, 1.2::tag::, @ordinary';
    assert.equal(expandPromptChunks(source, chunks), source);
});

test('cycles, missing chunks and expansion bombs fail before an API request can be made', () => {
    assert.throws(() => expandPromptChunks('!macro:A!', [{ name: 'A', text: '!macro:B!' }, { name: 'B', text: '!macro:A!' }]), /Циклический/);
    assert.throws(() => expandPromptChunks('!macro:Missing!', chunks), /не найден/);
    assert.throws(() => expandPromptChunks('!macro:A!', [{ name: 'A', text: 'a'.repeat(100001) }]), /длинный/);
    assert.throws(() => expandPromptChunks('!macro:A!'.repeat(257), [{ name: 'A', text: 'a' }]), /много/);
});

test('autocomplete handles Unicode/spaces but not email addresses or completed macros', () => {
    assert.deepEqual(findChunkQuery('1boy, @Свет', 11), { start: 6, end: 11, query: 'Свет' });
    assert.equal(findChunkQuery('me@example.com', 14), null);
    assert.equal(findChunkQuery('!macro:Artist!', 14), null);
    assert.equal(findChunkQuery('@Style, rest', 12), null);
    assert.equal(findChunkQuery('@Soft Light', 11).query, 'Soft Light');
});

test('renames only replace exact macro tokens and never interpret dollar substitutions', () => {
    assert.equal(renameChunkReferences('!macro:Artist! !macro:artist!', 'Artist', '$&'), '!macro:$&! !macro:artist!');
    assert.throws(() => chunkToken('bad!name'));
    assert.deepEqual(chunkReferences('x !macro:Свет!'), [{ name: 'Свет', token: '!macro:Свет!', index: 2 }]);
});

test('positive and negative chunks are expanded separately; Medium ignores unused negative chunks', () => {
    const compiled = compilePromptText({ prompt: '1boy', prefix: '!macro:Style!', negativePrompt: '!macro:Artist!', novelai: true }, chunks);
    assert.ok(!compiled.prefix.includes('!macro:'));
    assert.match(compiled.negativePrompt, /artist:kamochiru/);
    assert.equal(compilePromptText({ prompt: 'test', prefix: '', negativePrompt: '!macro:Missing!', novelai: true, supportsNegative: false }, chunks).negativePrompt, '');
    assert.throws(() => compilePromptText({ prompt: '!macro:Style!', prefix: '', negativePrompt: '', novelai: false }, chunks), /только в NovelAI/);
});
