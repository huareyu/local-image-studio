export const TAGGER_SERVICES = {
    wd: { name: 'WD Tagger', space: 'https://huggingface.co/spaces/SmilingWolf/wd-tagger', endpoint: 'https://smilingwolf-wd-tagger.hf.space', generalThreshold: .35, characterThreshold: .85 },
    pixai: { name: 'PixAI Tagger', space: 'https://huggingface.co/spaces/DraconicDragon/PixAI-Tagger-v0.9-ONNX', endpoint: 'https://draconicdragon-pixai-tagger-v0-9-onnx.hf.space', generalThreshold: .30, characterThreshold: .75 },
};
export const WD_TAGGER_MODELS = ['SmilingWolf/wd-eva02-large-tagger-v3', 'SmilingWolf/wd-swinv2-tagger-v3',
    'SmilingWolf/wd-convnext-tagger-v3', 'SmilingWolf/wd-vit-tagger-v3', 'SmilingWolf/wd-vit-large-tagger-v3'];
export function validImageTag(value) {
    return typeof value === 'string' && Boolean(value.trim()) && value.length <= 160 && !/[\x00-\x1f<>!{}\[\],:]/.test(value);
}
export function normalizeImageTag(value) { return value.trim().replace(/\s+/g, '_'); }
const KAOMOJI = new Set(['0_0', '(o)_(o)', '+_+', '+_-', '._.', '<o>_<o>', '<|>_<|>', '=_=', '>_<', '3_3', '6_9', '>_o', '@_@', '^_^', 'o_o', 'u_u', 'x_x', '|_|', '||_||']);
export function imageTagPrompt(names, format = 'underscores') {
    return [...new Set(names.filter(validImageTag).map(normalizeImageTag))]
        .map(name => format === 'spaces' && !KAOMOJI.has(name) ? name.replaceAll('_', ' ') : name).join(', ');
}
export function appendImageTags(source, tags) {
    const existing = new Set(source.split(',').map(tag => tag.trim().toLowerCase().replace(/\s+/g, '_')));
    const extra = tags.split(',').map(tag => tag.trim()).filter(tag => {
        const key = tag.toLowerCase().replace(/\s+/g, '_');
        if (!tag || existing.has(key)) return false;
        existing.add(key); return true;
    });
    if (!extra.length) return '';
    const separator = !source.trim() ? '' : /[,\n]\s*$/.test(source) ? (/\s$/.test(source) ? '' : ' ') : ', ';
    return separator + extra.join(', ') + ', ';
}
