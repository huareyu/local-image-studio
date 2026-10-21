import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 3213);
// Valid CRCs are required by createImageBitmap/Pillow, unlike some tolerant <img> decoders.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==';
const novelaiRequests = [];
const artistRequests = [];
const artistJobs = new Map();

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function json(res, value) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
}

http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === '/__novelai-requests') return json(res, novelaiRequests);
    if (req.url === '/__artist-requests') return json(res, artistRequests);
    if (req.url === '/gradio_api/upload') {
        artistRequests.push({ type: 'upload', authorization: req.headers.authorization || '', body: body.toString('latin1') });
        return json(res, ['/tmp/gradio/mock/reference.jpg']);
    }
    if (req.url === '/gradio_api/call/predict') {
        const payload = JSON.parse(body.toString());
        artistRequests.push({ type: 'predict', authorization: req.headers.authorization || '', payload });
        const id = `artist-job-${artistJobs.size}`; artistJobs.set(id, payload);
        return json(res, { event_id: id });
    }
    if (req.url.startsWith('/gradio_api/call/predict/')) {
        const job = artistJobs.get(req.url.split('/').at(-1));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: heartbeat\ndata: null\n\n');
        const data = ['', { headers: ['Rank', 'Artist', '', 'Score'], data: [] }, JSON.stringify({ kamochiru: .42, to_e: .19, '<img src=x onerror=alert(1)>': .99 }), ''];
        setTimeout(() => {
            if (res.destroyed) return;
            res.end(job?.data?.[2] === 7 ? 'event: error\ndata: "mock service unavailable"\n\n' : `event: complete\ndata: ${JSON.stringify(data)}\n\n`);
        }, job?.data?.[2] === 8 ? 1500 : 70);
        return;
    }
    if (req.url === '/user/subscription') {
        if (req.headers.authorization !== 'Bearer test-token') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ message: 'Invalid token' }));
        }
        return json(res, { active: true, tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 20 } });
    }
    if (req.url === '/ai/generate-image') {
        if (req.headers.authorization !== 'Bearer test-token') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ message: 'Invalid token' }));
        }
        const payload = JSON.parse(body.toString('utf8'));
        novelaiRequests.push(payload);
        if (req.headers.accept !== 'application/json') {
            res.writeHead(400);
            return res.end('Expected JSON response negotiation');
        }
        return json(res, { images: [{ image: PIXEL, index: 0, seed: payload.parameters.seed }] });
    }
    if (req.url === '/v1/models' || req.url === '/models') {
        return json(res, { data: [{ id: 'mock-image-model' }] });
    }
    if (req.url === '/v1beta/models') {
        return json(res, { models: [{ name: 'models/mock-gemini-image' }] });
    }
    if (req.url?.includes(':generateContent')) {
        const payload = JSON.parse(body.toString('utf8'));
        if (!payload.contents?.[0]?.parts?.some(part => part.text)) throw new Error('Gemini prompt missing');
        return json(res, {
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PIXEL } }] } }],
        });
    }
    if (req.url === '/v1/images/generations') {
        const payload = JSON.parse(body.toString('utf8'));
        if (!payload.prompt || !payload.model) throw new Error('OpenAI payload incomplete');
        return json(res, { data: [{ b64_json: PIXEL }] });
    }
    if (req.url === '/v1/images/edits') {
        if (!String(req.headers['content-type']).includes('multipart/form-data')) throw new Error('Expected multipart');
        if (!body.includes(Buffer.from('reference-0'))) throw new Error('Reference file missing');
        return json(res, { data: [{ b64_json: PIXEL }] });
    }
    if (req.url === '/chat/completions') {
        const payload = JSON.parse(body.toString('utf8'));
        if (!payload.messages?.length || !payload.modalities?.includes('image')) throw new Error('OpenRouter payload incomplete');
        return json(res, {
            choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PIXEL}` } }] } }],
        });
    }
    res.writeHead(404);
    res.end('not found');
}).listen(PORT, '127.0.0.1', () => console.log(`mock:${PORT}`));
