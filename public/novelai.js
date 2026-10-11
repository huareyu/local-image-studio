// Model rules adapted from Novarakk's novelaiParams.js and checked against
// https://image.novelai.net/docs/doc.json and NovelAI's model documentation.
export const NOVELAI_ENDPOINT = 'https://image.novelai.net';
export const NOVELAI_MODELS = [
    'nai-diffusion-5-full', 'nai-diffusion-5-full-medium', 'nai-diffusion-5-curated',
    'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full',
    'nai-diffusion-4-curated-preview', 'nai-diffusion-3', 'nai-diffusion-furry-3',
];
export const NOVELAI_SAMPLERS = [
    'k_euler', 'k_euler_ancestral', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m',
    'k_dpmpp_2m_sde', 'k_dpmpp_sde', 'ddim',
];
export const NOVELAI_SCHEDULERS = ['native', 'karras', 'exponential', 'polyexponential'];
export const NOVELAI_SIZES = [
    { value: 'Portrait', label: 'Портрет · 832×1216', width: 832, height: 1216 },
    { value: 'Landscape', label: 'Пейзаж · 1216×832', width: 1216, height: 832 },
    { value: 'Square', label: 'Квадрат · 1024×1024', width: 1024, height: 1024 },
];
export const DEFAULT_NOVELAI_NEGATIVE = 'low quality, worst quality, bad quality, normal quality, jpeg artifacts, signature, watermark, username, artist name, text, letters, blurry, ugly, deformed, disfigured, poor anatomy, bad anatomy, malformed hands, mutated hands, extra fingers, fewer fingers, poorly drawn hands, extra limbs, missing limbs, long neck, bad proportions, mutated, mutation, poorly drawn face, bad eyes, cross-eyed, asymmetrical eyes, cloned face, duplicate, bots';
export const NOVELAI_DEFAULTS = {
    novelaiSampler: 'k_euler_ancestral',
    novelaiScheduler: 'native',
    novelaiSteps: 28,
    novelaiScale: 5,
    novelaiCfgRescale: 0,
    novelaiSize: 'Portrait',
    novelaiSeed: -1,
    novelaiNegativePrompt: DEFAULT_NOVELAI_NEGATIVE,
    novelaiNegativePresetId: 'default-quality-anatomy',
    novelaiAnlasGuard: true,
    novelaiDecrisper: false,
    novelaiVarietyBoost: false,
    novelaiSm: false,
    novelaiSmDyn: false,
    novelaiEnableReferences: true,
    novelaiReferenceType: 'character&style',
    novelaiReferenceStrength: 1,
    novelaiReferenceFidelity: 0.75,
};

export function novelaiCapabilities(model) {
    const id = String(model || '').trim().toLowerCase();
    const v5 = /^nai-diffusion-5(?:-|$)/.test(id);
    const v4 = /^nai-diffusion-4(?:-|$)/.test(id);
    const medium = v5 && /-medium(?:-|$)/.test(id);
    return {
        v5, medium,
        structuredPrompt: v5 || v4,
        paramsVersion: v5 ? 4 : 3,
        fixedSteps: medium ? 14 : null,
        fixedSampler: medium ? 'k_euler_ancestral' : null,
        negativePrompt: !medium,
        cfgRescale: !medium,
        decrisper: !v5,
        varietyBoost: !v5,
        smea: !v5 && !v4,
        preciseReference: /^nai-diffusion-4-5(?:-|$)/.test(id)
            || (Boolean(id) && !/^nai-diffusion-\d/.test(id)),
    };
}

export function novelaiNumber(value, fallback, min, max) {
    if (value === '' || value == null) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function novelaiReferencesEnabled(profile) {
    return profile.novelaiEnableReferences !== false && novelaiCapabilities(profile.model).preciseReference;
}

export function novelaiDimensions(profile) {
    const size = NOVELAI_SIZES.find(item => item.value === profile.novelaiSize) || NOVELAI_SIZES[0];
    let { width, height } = size;
    let steps = novelaiCapabilities(profile.model).fixedSteps
        || Math.round(novelaiNumber(profile.novelaiSteps, 28, 1, 50));
    if (profile.novelaiAnlasGuard !== false) {
        steps = Math.min(28, steps);
        if (width * height > 1024 * 1024) {
            const ratio = Math.sqrt(1024 * 1024 / (width * height));
            width = Math.max(64, Math.floor(width * ratio / 64) * 64);
            height = Math.max(64, Math.floor(height * ratio / 64) * 64);
        }
    }
    return { width, height, steps };
}

export function applyNovelaiTagPresets(prompt, presets = []) {
    let result = prompt;
    for (const preset of Array.isArray(presets) ? presets : []) {
        if (!preset?.enabled || !preset.name || !preset.value) continue;
        const escaped = String(preset.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
        result = result.replace(pattern, () => String(preset.value));
    }
    return result;
}

export function buildNovelaiRequest(body, { random = Math.random } = {}) {
    const profile = { ...NOVELAI_DEFAULTS, ...body.profile };
    const model = String(profile.model || 'nai-diffusion-4-5-full').trim();
    const caps = novelaiCapabilities(model);
    const refs = novelaiReferencesEnabled({ ...profile, model }) && Array.isArray(body.references)
        ? body.references.slice(0, 5) : [];
    const refDescriptions = refs.map(ref => {
        const description = String(ref.description || '').trim();
        const label = String(ref.label || '').trim();
        return description ? `${label ? `${label}: ` : ''}${description}` : '';
    }).filter(Boolean);
    const input = applyNovelaiTagPresets([
        ...refDescriptions,
        String(body.prefix || '').trim(),
        String(body.prompt || '').trim(),
    ].filter(Boolean).join('\n\n'), profile.novelaiTagPresets);
    const negative = caps.negativePrompt ? String(profile.novelaiNegativePrompt ?? '') : '';
    const { width, height, steps } = novelaiDimensions({ ...profile, model });
    const seed = Number(profile.novelaiSeed);
    const sampler = caps.fixedSampler || profile.novelaiSampler || 'k_euler_ancestral';
    const parameters = {
        params_version: caps.paramsVersion,
        width, height, steps,
        scale: novelaiNumber(profile.novelaiScale, 5, 0, 30),
        cfg_rescale: caps.cfgRescale ? novelaiNumber(profile.novelaiCfgRescale, 0, 0, 1) : 0,
        seed: Number.isSafeInteger(seed) && seed >= 0 ? seed : Math.floor(random() * 9999999999),
        sampler,
        noise_schedule: profile.novelaiScheduler || 'native',
        n_samples: 1,
    };
    if (caps.negativePrompt) parameters.negative_prompt = negative;
    if (caps.structuredPrompt) {
        parameters.v4_prompt = {
            caption: { base_caption: input, char_captions: [] },
            use_coords: caps.v5, use_order: true,
        };
        parameters.v4_negative_prompt = {
            caption: { base_caption: negative, char_captions: [] }, legacy_uc: false,
        };
    }
    if (!caps.v5) {
        Object.assign(parameters, {
            prefer_brownian: true, ucPreset: 0, qualityToggle: false,
            add_original_image: false, controlnet_strength: 1,
            deliberate_euler_ancestral_bug: false,
            dynamic_thresholding: Boolean(profile.novelaiDecrisper),
            legacy: false, legacy_v3_extend: false,
            sm: caps.smea && sampler !== 'ddim' && Boolean(profile.novelaiSm),
            sm_dyn: caps.smea && sampler !== 'ddim' && Boolean(profile.novelaiSmDyn),
            uncond_scale: 1,
            skip_cfg_above_sigma: profile.novelaiVarietyBoost
                ? Math.sqrt(width * height / 1011712) * (model.includes('nai-diffusion-4-5') ? 58 : 19) : null,
            use_coords: false, characterPrompts: [],
            reference_image_multiple: [], reference_information_extracted_multiple: [], reference_strength_multiple: [],
        });
    }
    if (refs.length) {
        const type = ['character', 'style', 'character&style'].includes(profile.novelaiReferenceType)
            ? profile.novelaiReferenceType : 'character&style';
        Object.assign(parameters, {
            director_reference_images: refs.map(ref => String(ref.dataUrl || '').replace(/^data:[^,]+,/, '')),
            director_reference_descriptions: refs.map(() => ({
                caption: { base_caption: type, char_captions: [] }, legacy_uc: false,
            })),
            director_reference_information_extracted: refs.map(() => 1),
            director_reference_strength_values: refs.map(() => novelaiNumber(profile.novelaiReferenceStrength, 1, -1, 1)),
            director_reference_secondary_strength_values: refs.map(() => novelaiNumber(profile.novelaiReferenceFidelity, 0.75, -1, 1)),
        });
    }
    return { action: 'generate', input, model, parameters };
}

export async function normalizeNovelaiReference(dataUrl) {
    const image = new Image();
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось открыть референс для NovelAI'));
        image.src = dataUrl;
    });
    const ratio = image.naturalWidth / image.naturalHeight;
    const candidates = [[1024, 1536], [1472, 1472], [1536, 1024]];
    const [width, height] = candidates.reduce((best, item) =>
        Math.abs(Math.log(ratio / (item[0] / item[1]))) < Math.abs(Math.log(ratio / (best[0] / best[1]))) ? item : best);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = Math.round(image.naturalWidth * scale);
    const drawHeight = Math.round(image.naturalHeight * scale);
    context.drawImage(image, Math.round((width - drawWidth) / 2), Math.round((height - drawHeight) / 2), drawWidth, drawHeight);
    return canvas.toDataURL('image/png');
}
