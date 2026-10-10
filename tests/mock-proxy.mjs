import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.env.PROXY_PORT || 3214);
const EXPECTED_AUTH = `Basic ${Buffer.from('proxy-user:proxy-pass').toString('base64')}`;
let forwarded = 0;

function authorized(headers) {
    return headers['proxy-authorization'] === EXPECTED_AUTH;
}

function deny(socketOrResponse) {
    if ('writeHead' in socketOrResponse) {
        socketOrResponse.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="test"' });
        socketOrResponse.end('proxy authentication required');
    } else {
        socketOrResponse.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\n\r\n');
    }
}

const server = http.createServer((req, res) => {
    if (req.url === '/__stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ forwarded }));
    }
    if (!authorized(req.headers)) return deny(res);
    let target;
    try {
        target = new URL(req.url);
    } catch {
        res.writeHead(400);
        return res.end('absolute URL required');
    }
    forwarded += 1;
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-authorization'];
    const upstream = http.request(target, { method: req.method, headers }, upstreamResponse => {
        res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
    });
    upstream.on('error', error => {
        res.writeHead(502);
        res.end(error.message);
    });
    req.pipe(upstream);
});

server.on('connect', (req, clientSocket, head) => {
    if (!authorized(req.headers)) return deny(clientSocket);
    const separator = req.url.lastIndexOf(':');
    const host = req.url.slice(0, separator);
    const port = Number(req.url.slice(separator + 1));
    forwarded += 1;
    const upstream = net.connect(port, host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
});

server.listen(PORT, '127.0.0.1', () => console.log(`proxy:${PORT}`));
