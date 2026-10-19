const MACRO_PATTERN = /!macro:([^!\r\n]+)!/g;
const MAX_PROMPT_LENGTH = 100000;

export function chunkToken(name) {
    if (typeof name !== 'string' || !name.trim() || /[!\r\n]/.test(name)) throw new Error('Имя чанка не должно содержать ! или перенос строки');
    return `!macro:${name}!`;
}

export function chunkReferences(text) {
    return [...String(text || '').matchAll(MACRO_PATTERN)].map(match => ({ name: match[1], token: match[0], index: match.index }));
}

function cleanDoubleCommas(text) {
    let output = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const character = text[i];
        if (character === '\\' && quoted) { output += text.slice(i, i + 2); i++; continue; }
        if (character === '"') quoted = !quoted;
        output += character;
        if (quoted || character !== ',') continue;
        const repeated = text.slice(i + 1).match(/^(?:\s*,)+\s*/);
        if (repeated) { i += repeated[0].length; if (i + 1 < text.length) output += ' '; }
    }
    return output;
}

export function expandPromptChunks(text, chunks) {
    const source = String(text || '');
    if (!chunkReferences(source).length) return source;
    const byName = new Map(chunks.map(chunk => [chunk.name, chunk]));
    let expansions = 0;
    function expand(value, stack) {
        if (value.length > MAX_PROMPT_LENGTH) throw new Error('Слишком длинный промпт после раскрытия чанков');
        if (stack.length > 16) throw new Error('Слишком глубокая вложенность чанков (максимум 16)');
        // A fresh RegExp is required at every recursive level.
        const output = value.replace(new RegExp(MACRO_PATTERN.source, 'g'), (_token, name) => {
            if (++expansions > 256) throw new Error('Слишком много вложенных чанков (максимум 256)');
            if (stack.includes(name)) throw new Error(`Циклический чанк: ${[...stack, name].join(' → ')}`);
            const chunk = byName.get(name);
            if (!chunk) throw new Error(`Чанк «${name}» не найден. Проверь имя: регистр имеет значение.`);
            return expand(String(chunk.text || ''), [...stack, name]);
        });
        if (output.length > MAX_PROMPT_LENGTH) throw new Error('Слишком длинный промпт после раскрытия чанков');
        return output;
    }
    return cleanDoubleCommas(expand(source, []));
}

export function findChunkQuery(text, caret) {
    const before = String(text || '').slice(0, caret);
    const index = before.lastIndexOf('@');
    if (index < 0 || (index > 0 && !/[\s,([{]/.test(before[index - 1]))) return null;
    const query = before.slice(index + 1);
    if (query.length > 80 || /[!\r\n,:]/.test(query)) return null;
    return { start: index, end: caret, query };
}

export function renameChunkReferences(text, oldName, newName) {
    return String(text || '').split(chunkToken(oldName)).join(chunkToken(newName));
}

export function compilePromptText({ prompt, prefix, negativePrompt, novelai, supportsNegative = true }, chunks) {
    if (!novelai) {
        if ([prompt, prefix, negativePrompt].some(text => chunkReferences(text).length)) {
            throw new Error('Чанки используются только в NovelAI. Разверни их в обычный текст перед переключением провайдера.');
        }
        return { prompt, prefix, negativePrompt };
    }
    return {
        prompt: expandPromptChunks(prompt, chunks),
        prefix: expandPromptChunks(prefix, chunks),
        negativePrompt: supportsNegative ? expandPromptChunks(negativePrompt, chunks) : '',
    };
}
