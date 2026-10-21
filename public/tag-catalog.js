import { BUILTIN_TAGS } from './novelai-tags.js';
import { createTagIndex, tagKey } from './tag-tools.js';

export function buildTagCatalog(base, custom = []) {
    const records = new Map(base.map(tag => [tagKey(tag.tag), tag]));
    for (const tag of [...BUILTIN_TAGS, ...custom]) {
        const key = tagKey(tag.tag), previous = records.get(key);
        records.set(key, { ...previous, ...tag, count: tag.count || previous?.count || 0,
            desc: tag.desc || previous?.desc || '', aliases: [...new Set([...(previous?.aliases || []), ...(tag.aliases || [])])] });
    }
    const index = createTagIndex([...records.values()]);
    return { index, metadata: { baseCount: base.length, builtinCount: BUILTIN_TAGS.length,
        customCount: custom.length, total: index.length,
        categories: [...new Set(index.map(tag => tag.category))].sort((a, b) => a.localeCompare(b)).slice(0, 500) } };
}
