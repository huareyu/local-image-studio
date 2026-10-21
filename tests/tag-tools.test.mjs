import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTagRecords, parseTagDictionary, createTagIndex, searchTags, promptTags,
    findTagQuery, removePromptTag, movePromptTag, changeTagWeight, MAX_TAGS } from '../public/tag-tools.js';
import { BUILTIN_TAGS } from '../public/novelai-tags.js';

test('local vocabulary has unique tags and searches Russian descriptions and English prefixes', () => {
    const tags = normalizeTagRecords(BUILTIN_TAGS);
    assert.equal(tags.length, BUILTIN_TAGS.length);
    assert.ok(tags.length > 150);
    const index = createTagIndex(tags);
    assert.equal(searchTags(index, 'голубые волосы').items[0].tag, 'blue hair');
    assert.equal(searchTags(index, 'blue ha').items[0].tag, 'blue hair');
    assert.ok(searchTags(index, 'глаза', { category: 'Лицо и глаза' }).total >= 8);
    assert.equal(searchTags(index, 'blue ha', { used: new Set(['blue hair']) }).total, 0);
});

test('import accepts the source project category JSON and array JSON without inheriting object keys', () => {
    const result = parseTagDictionary('{"Hair":[{"tag":"blue_hair","desc":"Голубые волосы"},"long_hair"]}', 'tags.JSON');
    assert.equal(result[0].tag, 'blue hair');
    assert.equal(result[0].desc, 'Голубые волосы');
    assert.equal(result[0].category, 'Hair');
    assert.equal(parseTagDictionary('[{"tag":"smile","description":"Улыбка"}]', 'tags.json')[0].desc, 'Улыбка');
    const proto = parseTagDictionary('{"__proto__":[{"tag":"smile","desc":"literal"}]}', 'tags.json');
    assert.equal(proto[0].category, '__proto__');
    assert.equal({}.literal, undefined);
});

test('TXT and CSV imports handle BOM, comments, quoted commas and popularity/category variants', () => {
    assert.deepEqual(parseTagDictionary('\uFEFF# custom\rblue_hair\rlong_hair', 'tags.txt').map(item => item.tag), ['blue hair', 'long hair']);
    const plain = parseTagDictionary('tag,count,description\r\nblue_hair,2000,"Голубые, синие волосы"\r\nsmile,50,"A ""smile"""', 'tags.csv');
    assert.equal(plain[0].desc, 'Голубые, синие волосы');
    assert.equal(plain[1].desc, 'A "smile"');
    assert.equal(plain[0].count, 2000);
    assert.equal(parseTagDictionary('blue_hair,2000\nsmile,100', 'tags.csv')[0].count, 2000);
    const booru = parseTagDictionary('blue_hair,0,12345,"azure_hair,sky_hair"', 'tags.csv')[0];
    assert.equal(booru.category, 'Общие'); assert.equal(booru.count, 12345);
    assert.equal(searchTags(createTagIndex([booru]), 'azure').items[0].tag, 'blue hair');
});

test('bad/oversized dictionaries fail without partial success; duplicate tags are normalized', () => {
    for (const [text, name] of [['{}', 'tags.json'], ['null', 'tags.json'], ['{"Hair":42}', 'tags.json'], ['"blue hair', 'tags.csv'], ['x', 'tags.exe']]) {
        assert.throws(() => parseTagDictionary(text, name));
    }
    assert.throws(() => normalizeTagRecords(Array(MAX_TAGS + 1).fill('tag')));
    assert.equal(normalizeTagRecords(['blue_hair', 'BLUE HAIR', null, { tag: 'x\ny' }]).length, 1);
});

test('prompt splitting respects artist braces, numeric emphasis, escaped names, quotes and chunk names', () => {
    const source = '{{artist:foo}}, 1.2::rain, night::, -2::text, letters::, !macro:A, B!, blue hair, "hello, world", name \\(series\\)';
    const tags = promptTags(source);
    assert.deepEqual(tags.map(item => item.text), ['{{artist:foo}}', '1.2::rain, night::', '-2::text, letters::', '!macro:A, B!', 'blue hair', '"hello, world"', 'name \\(series\\)']);
    for (const tag of tags) assert.equal(source.slice(tag.start, tag.end), tag.text);
    assert.deepEqual(promptTags('1boy, {blue hair, green eyes}, [text, watermark], ').map(item => item.text), ['1boy', '{blue hair, green eyes}', '[text, watermark]']);
});

test('completion replaces only the current fragment, preserving braces, weights, text on either side and chunks', () => {
    for (const [source, caret, expected] of [['1boy, blue ha', 13, 'blue ha'], ['{{blue ha}}', 9, 'blue ha'], ['1.2::blue ha::', 12, 'blue ha'], ['1boy, blue hair, forest', 13, 'blue ha']]) {
        const query = findTagQuery(source, caret);
        assert.equal(query?.query, expected, source);
        const result = source.slice(0, query.start) + 'blue hair' + source.slice(query.end);
        assert.ok(result.includes('blue hair'));
        assert.equal(result.includes('blue hairir'), false);
    }
    for (const source of ['@Look', '!macro:blue hair!', '{{artist:abc}}', '!macro:unfinished', 'x']) assert.equal(findTagQuery(source, source.length), null, source);
    const afterChunk = '!macro:Итан!, blue ha';
    assert.equal(findTagQuery(afterChunk, afterChunk.length)?.query, 'blue ha');
});

test('moving and removing a group preserve all other prompt syntax and separators', () => {
    const source = '{{artist:a}}, 1.2::rain, night::, !macro:Итан!, blue hair';
    assert.equal(movePromptTag(source, 1, 3), '{{artist:a}}, !macro:Итан!, blue hair, 1.2::rain, night::');
    assert.equal(movePromptTag(source, -1, 0), source);
    assert.equal(removePromptTag(source, 1), '{{artist:a}}, !macro:Итан!, blue hair');
    assert.equal(removePromptTag(source, 3), '{{artist:a}}, 1.2::rain, night::, !macro:Итан!');
    assert.equal(removePromptTag('one, two', 0), 'two');
    assert.equal(removePromptTag('only, ', 0), '');
});

test('weight buttons work across models without rewriting numeric emphasis or artist IDs', () => {
    assert.equal(changeTagWeight('blue hair', true), '{blue hair}');
    assert.equal(changeTagWeight('{blue hair}', false), 'blue hair');
    assert.equal(changeTagWeight('[blue hair]', true), 'blue hair');
    assert.equal(changeTagWeight('1.2::rain, night::', true), '{1.2::rain, night::}');
    assert.equal(changeTagWeight('{{artist:foo}}', true), '{{{artist:foo}}}');
    assert.equal(changeTagWeight('{a} text {b}', false), '[{a} text {b}]');
});
