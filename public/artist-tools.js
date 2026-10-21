export const KALOSCOPE_SPACE = 'https://huggingface.co/spaces/DraconicDragon/Kaloscope-artist-style-classifier';
export const KALOSCOPE_ENDPOINT = 'https://draconicdragon-kaloscope-artist-style-classifier.hf.space';
export const KALOSCOPE_MODELS = ['Kaloscope v2.0 ONNX', 'Kaloscope v3.0 Preview', 'Kaloscope v2.0',
    'Kaloscope v1.1 ONNX', 'Kaloscope v1.1', 'Kaloscope v1.0 ONNX', 'Kaloscope v1.0', 'Kaloscope v1.0 ema'];

export function validArtistName(value) {
    return typeof value === 'string' && Boolean(value.trim()) && value.length <= 160 && !/[\x00-\x1f<>!{}\[\],:]/.test(value);
}
export function artistDanbooruUrl(name) {
    return `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(name.replaceAll(' ', '_'))}`;
}
export function artistPromptTags(names, format = 'novelai') {
    return [...new Set(names.filter(validArtistName).map(name => name.trim().replace(/\s+/g, '_')))]
        .map(name => format === 'novelai' ? `artist:${name}` : name).join(', ');
}
