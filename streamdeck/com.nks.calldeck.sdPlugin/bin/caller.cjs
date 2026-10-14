/* CallDeck — GPL-3.0-or-later */
const https = require('node:https');
function allowedAvatar(value) {
    return typeof value === 'string' && value.length <= 300
        && /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/(avatars\/\d{1,22}\/[a-zA-Z0-9_]+\.png|embed\/avatars\/[0-5]\.png)(\?size=(64|128|256))?$/.test(value);
}
function validateDisplay(d) {
    return d === null || (d && typeof d.channelId === 'string' && /^\d{1,22}$/.test(d.channelId) && ['dm', 'group', 'server'].includes(d.kind)
        && typeof d.name === 'string' && d.name.length <= 80 && Number.isInteger(d.total) && d.total >= 0 && d.total <= 1000
        && Array.isArray(d.participants) && d.participants.length <= 4 && d.participants.every(p => p && typeof p.id === 'string' && /^\d{1,22}$/.test(p.id)
            && typeof p.name === 'string' && p.name.length <= 80 && (p.avatar === null || allowedAvatar(p.avatar)))
        && new Set(d.participants.map(p => p.id)).size === d.participants.length);
}
function fetchAvatar(url) {
    if (!allowedAvatar(url)) return Promise.reject(new Error('Invalid avatar URL'));
    return new Promise((resolve, reject) => {
        // Never forward bridge authorization or cookies. Redirects are not followed.
        const req = https.get(url, { headers: { Accept: 'image/png' } }, res => {
            if (res.statusCode !== 200) { res.resume(); reject(new Error('Avatar unavailable')); return; }
            const chunks = []; let size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > 131072) req.destroy(new Error('Avatar too large')); else chunks.push(chunk); });
            res.on('error', reject);
            res.on('end', () => {
                const png = Buffer.concat(chunks);
                if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
                    || png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) < 1 || png.readUInt32BE(16) > 256
                    || png.readUInt32BE(20) < 1 || png.readUInt32BE(20) > 256) { reject(new Error('Unexpected avatar image')); return; }
                resolve('data:image/png;base64,' + png.toString('base64'));
            });
        });
        const timer = setTimeout(() => req.destroy(new Error('Avatar timeout')), 2500);
        req.on('close', () => clearTimeout(timer)); req.on('error', reject);
    });
}
class AvatarCache {
    constructor(loader = fetchAvatar, now = Date.now) { this.loader = loader; this.now = now; this.entries = new Map(); }
    get(url, changed) {
        if (!allowedAvatar(url)) return null;
        let item = this.entries.get(url);
        if (item && (item.pending || item.expires > this.now())) return item.image;
        // Do not evict pending work: a burst of new identities cannot spawn unlimited requests.
        if (this.entries.size >= 32 && !item) {
            const evict = [...this.entries].find(([, value]) => !value.pending);
            if (!evict) return null;
            this.entries.delete(evict[0]);
        }
        item = { image: item?.image ?? null, pending: true, expires: 0 }; this.entries.set(url, item);
        Promise.resolve().then(() => this.loader(url)).then(image => {
            item.image = image; item.expires = this.now() + 300000;
        }, () => { item.image = null; item.expires = this.now() + 30000; }).finally(() => { item.pending = false; changed(); });
        return item.image;
    }
}
const xml = value => String(value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[ch]);
const short = (text, length = 14) => { const chars = Array.from(text); return xml(chars.length > length ? chars.slice(0, length - 1).join('') + '…' : text); };
function callerImage(status, enabled, avatar) {
    const d = status?.display;
    if (!d || !validateDisplay(d) || !(status.incoming.includes(d.channelId) || status.selected === d.channelId || status.connected === d.channelId)) return null;
    const incoming = status.incoming.includes(d.channelId);
    const connected = status.connected === d.channelId;
    const operation = status.operationChannelId === undefined || status.operationChannelId === d.channelId ? status.operation : null;
    const phase = operation === 'answer' ? status.voice === 'connecting' ? 'Connecting' : 'Answering'
        : operation === 'hangup' ? 'Disconnecting' : operation === 'decline' ? 'Declining' : incoming ? 'Incoming' : connected ? 'Connected'
            : status.voice === 'connecting' ? 'Connecting' : status.voice === 'error' ? 'Connection error' : 'Unknown';
    const color = connected ? '#22ed65' : ['Incoming','Connecting','Answering','Disconnecting','Declining'].includes(phase) ? '#f3b63c' : phase === 'Connection error' ? '#ff5555' : '#a0a0aa';
    let content = '';
    const grid = d.kind !== 'dm' && d.participants.length > 1;
    const people = d.participants.length ? d.participants : [{ name: d.kind === 'dm' ? '?' : 'Group', avatar: null }];
    for (let i = 0; i < people.length; i++) {
        const p = people[i]; const x = grid ? (i % 2) * 73 : 0, y = grid ? Math.floor(i / 2) * 49 : 0;
        const w = grid ? 71 : 144, h = grid ? 47 : 144;
        const image = p.avatar ? avatar(p.avatar) : null;
        content += image ? `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" xlink:href="${image}"/>`
            : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#28303e"/><text x="${x+w/2}" y="${y+h/2+8}" text-anchor="middle" fill="#ccd3e0" font-size="${grid ? 24 : 44}">${short(p.name, 2)}</text>`;
    }
    if (d.total > 4) content += `<rect x="105" y="3" width="36" height="24" rx="10" fill="#12141c"/><text x="123" y="20" text-anchor="middle" fill="white" font-size="14">+${d.total-4}</text>`;
    const stateLabel = phase === 'Incoming' && d.kind !== 'dm' && d.total ? `Incoming · ${d.total}` : phase;
    const phone = enabled ? '#22ed65' : '#65716b';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 144 144"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="black" stop-opacity="0"/><stop offset="1" stop-color="black" stop-opacity=".96"/></linearGradient></defs><rect width="144" height="144" fill="black"/>${content}<rect y="67" width="144" height="77" fill="url(#shade)"/><g font-family="Arial, sans-serif" text-anchor="middle"><circle cx="15" cy="99" r="4" fill="${color}"/><text x="80" y="103" font-size="11" fill="white">${xml(stateLabel)}</text><text x="72" y="121" font-size="15" font-weight="bold" fill="white">${short(d.name)}</text><path d="M36 128l5-2 4 6-3 3q3 5 8 6l3-3 6 3-2 5q-15 0-21-18z" transform="translate(0,-5)" fill="${phone}"/><text x="85" y="140" font-size="15" font-weight="bold" fill="${enabled ? 'white' : '#91959d'}">Answer</text></g></svg>`;
    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
module.exports = { allowedAvatar, validateDisplay, fetchAvatar, AvatarCache, callerImage };
