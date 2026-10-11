import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const FORMATS = {
    'image/png': { extension: 'png', valid: bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
    'image/jpeg': { extension: 'jpg', valid: bytes => bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) },
    'image/webp': { extension: 'webp', valid: bytes => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' },
    'image/gif': { extension: 'gif', valid: bytes => /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) },
};

export function folderCommand(directory, platform = process.platform) {
    if (platform === 'win32') return { command: 'explorer.exe', args: [directory] };
    if (platform === 'darwin') return { command: 'open', args: [directory] };
    return { command: 'xdg-open', args: [directory] };
}

async function openNativeFolder(directory) {
    const { command, args } = folderCommand(directory);
    await new Promise((resolve, reject) => {
        // No shell or client-supplied command/path; only the application's image folder.
        const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore' });
        child.once('error', reject);
        if (process.platform === 'win32') {
            child.once('spawn', () => { child.unref(); resolve(); });
        } else {
            child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Не удалось открыть папку (${command}, код ${code})`)));
        }
    });
}

export function createImageArchive(directory, { openFolder = openNativeFolder } = {}) {
    const folderPath = path.resolve(directory);
    return {
        folderPath,
        async save(entry) {
            if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id)) throw new Error('Некорректный ID изображения');
            const date = new Date(entry.createdAt);
            if (!Number.isFinite(date.getTime()) || typeof entry.createdAt !== 'number') throw new Error('Некорректная дата изображения');
            const match = typeof entry.dataUrl === 'string' && entry.dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/]+={0,2})$/);
            if (!match || match[2].length % 4 !== 0) throw new Error('Неподдерживаемый формат изображения: нужны PNG, JPEG, WebP или GIF');
            const format = FORMATS[match[1]];
            const bytes = Buffer.from(match[2], 'base64');
            if (bytes.length > 64 * 1024 * 1024) throw new Error('Изображение слишком большое для сохранения');
            if (!format.valid(bytes)) throw new Error('Данные изображения не соответствуют его формату');
            const timestamp = date.toISOString().replace(/[:.]/g, '-');
            const fileName = `image-${timestamp}-${entry.id}.${format.extension}`;
            const filePath = path.join(folderPath, fileName);
            await fs.mkdir(folderPath, { recursive: true });
            try {
                await fs.writeFile(filePath, bytes, { flag: 'wx' });
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
                // An import can be retried safely, but must never overwrite a different image.
                const existing = await fs.readFile(filePath);
                if (!existing.equals(bytes)) throw new Error('Файл с этим ID уже существует и содержит другое изображение');
            }
            return { fileName, folderPath };
        },
        async open() {
            await fs.mkdir(folderPath, { recursive: true });
            await openFolder(folderPath);
            return { folderPath };
        },
    };
}
