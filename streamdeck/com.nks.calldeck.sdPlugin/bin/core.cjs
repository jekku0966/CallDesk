/* CallDeck — GPL-3.0-or-later */
const { request } = require('node:http');
const { validateDisplay } = require('./caller.cjs');

function config(value = {}) {
    const port = Number(value.port ?? 9473);
    const token = String(value.token ?? '').trim();
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024–65535.');
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Paste the 64-character CallDeck bridge token.');
    return { port, token };
}
function validateStatus(s) {
    if (!s || !['idle', 'ringing', 'connected'].includes(s.state) || !Array.isArray(s.incoming)
        || !s.incoming.every(id => typeof id === 'string' && /^\d+$/.test(id))
        || !(s.connected === null || (typeof s.connected === 'string' && /^\d+$/.test(s.connected)))) {
        throw new Error('Unexpected bridge status.');
    }
    if ((s.selected !== undefined && s.selected !== null && (typeof s.selected !== 'string' || !/^\d{1,22}$/.test(s.selected)))
        || (s.voice !== undefined && !['idle', 'connecting', 'connected', 'error', 'unknown'].includes(s.voice))
        || (s.operation !== undefined && s.operation !== null && !['answer', 'decline', 'hangup'].includes(s.operation))
        || (s.session !== undefined && (typeof s.session !== 'string' || !Number.isSafeInteger(s.revision) || s.revision < 0))) {
        throw new Error('Unexpected bridge synchronization metadata.');
    }
    if (s.display !== undefined && !validateDisplay(s.display)) throw new Error('Unexpected caller display.');
    if (s.operationChannelId !== undefined && s.operationChannelId !== null
        && (typeof s.operationChannelId !== 'string' || !/^\d{1,22}$/.test(s.operationChannelId))) throw new Error('Unexpected operation target.');
    return s;
}
function available(action, status) {
    if (!status) return false;
    if (status.operation && !(action === 'hangup' && status.operation === 'answer')) return false;
    const selected = status.selected === undefined ? status.connected : status.selected;
    if (action === 'hangup') return selected !== null;
    if (action === 'decline') return status.incoming.length === 1;
    if (action === 'answer') return status.incoming.length === 1 && selected === null;
    return false;
}
function bridge(settings, path, method = 'GET', timeout = 1500, signal) {
    const c = config(settings);
    if (!['/status', '/answer', '/decline', '/hangup'].includes(path.split('?')[0])) throw new Error('Unknown action.');
    return new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: c.port, path, method, signal,
            headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json' } }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                text += chunk;
                if (text.length > 16384) req.destroy(new Error('Bridge response too large.'));
            });
            res.on('error', reject);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    const message = res.statusCode === 401 ? 'Wrong bridge token.'
                        : res.statusCode === 409 ? 'Call changed, unavailable or another action is pending.'
                        : res.statusCode === 503 ? 'Vesktop bridge is not ready.'
                        : res.statusCode === 504 ? 'Action timed out. Check Discord before retrying.'
                        : `Bridge returned HTTP ${res.statusCode}.`;
                    reject(new Error(message)); return;
                }
                try { resolve(JSON.parse(text)); } catch { reject(new Error('Invalid bridge response.')); }
            });
        });
        const timer = setTimeout(() => req.destroy(new Error('Bridge timeout.')), timeout);
        req.on('close', () => clearTimeout(timer));
        req.on('error', error => reject(new Error(error.code === 'ECONNREFUSED'
            ? 'Bridge offline. Check Vesktop and CallDeck.' : error.message)));
        req.end();
    });
}
function newer(current, next) {
    return !current || !next.session || current.session !== next.session || next.revision >= current.revision;
}
function statusPath(status) {
    return status?.longPoll && typeof status.session === 'string' && Number.isSafeInteger(status.revision)
        ? `/status?session=${encodeURIComponent(status.session)}&revision=${status.revision}` : '/status';
}
module.exports = { config, validateStatus, available, bridge, newer, statusPath };
