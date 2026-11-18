// A local-only client. Never print the capability token, provider keys, prompt or base64 image bytes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = {
    prompt: { type: 'string' }, 'prompt-file': { type: 'string' }, prefix: { type: 'string' }, negative: { type: 'string' },
    output: { type: 'string' }, aspect: { type: 'string' }, resolution: { type: 'string' }, size: { type: 'string' }, quality: { type: 'string' },
    reference: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' },
};
async function readConnection() {
    const directory = process.env.IMAGE_STUDIO_ASSISTANT_DIR || path.join(root, '.assistant-access');
    let data;
    try { data = JSON.parse(await fs.readFile(path.join(directory, 'connection.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Не удалось прочитать локальный доступ. Разреши профиль кнопкой в студии заново'); }
    let url;
    try { url = new URL(data.origin); } catch { throw new Error('Неверный адрес студии в локальном подключении'); }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || !/^[a-f0-9]{64}$/.test(data.token || '')) throw new Error('Небезопасное локальное подключение: нужен http://127.0.0.1 и ключ доступа');
    return { origin: url.origin, token: data.token };
}
async function post(connection, action, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 11 * 60 * 1000);
    const interrupt = () => controller.abort(); process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
        const response = await fetch(`${connection.origin}/api/assistant/${action}`, { method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` }, body: JSON.stringify(body) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 700) : `Студия вернула HTTP ${response.status}`);
        return data;
    } catch (error) {
        if (controller.signal.aborted) throw new Error('Ожидание остановлено. Запрос не повторяется автоматически; удалённая генерация всё ещё может быть оплачена');
        if (error.message === 'fetch failed') throw new Error('Не удалось подключиться к студии. Запусти её и разреши доступ выбранному профилю');
        throw error;
    } finally { clearTimeout(timeout); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
}
async function reference(file) {
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    const type = types[path.extname(file).toLowerCase()];
    if (!type) throw new Error('Референсы: только PNG, JPEG или WebP');
    if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('Референс не должен превышать 8 МБ');
    return { dataUrl: `data:${type};base64,${(await fs.readFile(file)).toString('base64')}`, label: '', description: '' };
}
async function main() {
    const { values, positionals } = parseArgs({ options, allowPositionals: true });
    if (values.help || !positionals.length) {
        console.log('Local Image Studio (только этот компьютер)\n  node scripts/studio-assistant.mjs status\n  node scripts/studio-assistant.mjs generate --prompt "описание" --output "assets/image.png"\n  Вместо --prompt: --prompt-file path.txt\n  Дополнительно: --aspect 16:9 --resolution 2K --reference image.png (до 5) --prefix "стиль" --negative "текст"\n  Доступ включается и отключается только кнопками в студии. Платные запросы не повторяются автоматически.');
        return;
    }
    const command = positionals[0];
    if (positionals.length !== 1 || !['status', 'generate'].includes(command)) throw new Error('Доступны только команды status и generate. См. --help');
    const connection = await readConnection();
    if (!connection) {
        if (command === 'status') { console.log(JSON.stringify({ enabled: false, message: 'Выбери профиль в студии и нажми «Разрешить помощнику использовать этот профиль»' })); return; }
        throw new Error('Доступ выключен. Выбери профиль в студии и нажми «Разрешить помощнику использовать этот профиль»');
    }
    if (command === 'status') { console.log(JSON.stringify(await post(connection, 'info', {}))); return; }
    if (Boolean(values.prompt) === Boolean(values['prompt-file'])) throw new Error('Укажи один источник: --prompt или --prompt-file');
    const prompt = values['prompt-file'] ? await fs.readFile(values['prompt-file'], 'utf8') : values.prompt;
    if (!prompt.trim() || prompt.length > 30000) throw new Error('Нужен промпт от 1 до 30000 символов');
    const references = values.reference || [];
    if (references.length > 5) throw new Error('Можно передать до пяти референсов');
    const request = { prompt, references: await Promise.all(references.map(reference)) };
    for (const [option, key] of [['aspect', 'aspectRatio'], ['resolution', 'imageSize'], ['size', 'size'], ['quality', 'quality'], ['prefix', 'prefix'], ['negative', 'negativePrompt']]) {
        if (values[option] !== undefined) request[key] = values[option];
    }
    // Avoid paying for a generation when the requested output is already an existing file.
    if (values.output) {
        try { await fs.access(path.resolve(values.output)); throw new Error('Файл результата уже существует. Выбери новое имя; существующие файлы не перезаписываются'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const result = await post(connection, 'generate', request);
    const match = typeof result.dataUrl === 'string' && result.dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[2].length > 90 * 1024 * 1024) throw new Error('Студия вернула неверный формат картинки');
    const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
    let filePath = result.archive?.folderPath && result.archive?.fileName ? path.join(result.archive.folderPath, result.archive.fileName) : null;
    if (values.output || !filePath) {
        const desired = path.resolve(values.output || path.join('assistant-results', `${result.id || Date.now()}${extensions[match[1]]}`));
        const ext = path.extname(desired), expected = extensions[match[1]];
        const output = ext.toLowerCase() === expected || (match[1] === 'image/jpeg' && ext.toLowerCase() === '.jpeg')
            ? desired : desired.slice(0, ext ? -ext.length : undefined) + expected;
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, Buffer.from(match[2], 'base64'), { flag: 'wx' }); filePath = output;
    }
    console.log(JSON.stringify({ id: result.id, provider: result.provider, model: result.model, filePath, mimeType: match[1],
        seed: result.seed, width: result.width, height: result.height, ...(result.archiveError ? { warning: result.archiveError } : {}) }));
}
main().catch(error => { console.error(error.message || 'Ошибка локального подключения к студии'); process.exitCode = 1; });
