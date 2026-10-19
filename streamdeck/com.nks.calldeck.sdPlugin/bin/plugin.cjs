/* CallDeck — GPL-3.0-or-later */
const WebSocket = require('./ws');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { config, validateStatus, available, bridge, newer, statusPath } = require('./core.cjs');
const { AvatarCache, callerImage } = require('./caller.cjs');
const { IncomingProfiles, profileConfig, PROFILES } = require('./profiles.cjs');
const avatars = new AvatarCache();
const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const uuid = argument('-pluginUUID');
const port = Number(argument('-port'));
if (!uuid || !Number.isInteger(port) || port < 1 || port > 65535) process.exit(1);
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const contexts = new Map();
const inspectors = new Set();
const images = JSON.parse(readFileSync(join(__dirname, '../imgs/frames.json'), 'utf8'));
let settings = null, status = null, lastError = 'Configure the bridge token.', generation = 0;
let polling = false, busy = false, frame = 0;
let pollTimer, animationTimer;
let requestId = 0, appliedId = 0, failures = 0;
let notified = '';
let pollController;
let forceSnapshot = false;
const send = message => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
const profiles = new IncomingProfiles(message => send({ ...message, context: uuid }));
try { for (const device of JSON.parse(argument('-info') ?? '{}').devices ?? []) profiles.connect(device.id, device.type); } catch { /* No devices: fail closed. */ }
const monitoring = () => settings && (contexts.size || (profiles.options.enabled && profiles.options.deviceIds.some(id => PROFILES[profiles.devices.get(id)])));
let settingsFingerprint = '';
function accept(next, epoch, id) {
    if (epoch !== generation || !monitoring() || id < appliedId || !newer(status, next)) return false;
    appliedId = id; status = next; lastError = ''; failures = 0;
    profiles.observe(next);
    return true;
}
const actionName = action => action?.split('.').at(-1);
function notify(message = lastError) {
    if (!message) message = status?.error ?? (status?.operation ? `Waiting for Discord: ${status.phase ?? status.operation}.`
        : ['connecting', 'error', 'unknown'].includes(status?.phase) ? `Discord voice state: ${status.phase}.` : '');
    const fingerprint = JSON.stringify([message, status?.phase, status?.state]);
    if (fingerprint === notified) return;
    notified = fingerprint;
    for (const context of inspectors) send({ event: 'sendToPropertyInspector', context,
        action: contexts.get(context)?.action, payload: { message, state: status?.state ?? 'offline' } });
}
function render() {
    for (const [context, key] of contexts) {
        const name = actionName(key.action);
        if (name === 'return') continue;
        const enabled = available(name, status) && (name !== 'hangup' || status?.connected !== null);
        const portrait = name === 'answer' ? callerImage(status, enabled, url => avatars.get(url, () => {
            if (contexts.size && status?.display?.participants.some(p => p.avatar === url)) render();
        })) : null;
        if (portrait) {
            if (key.image !== portrait) { key.image = portrait; send({ event: 'setImage', context, payload: { target: 0, image: portrait } }); }
            continue;
        }
        const shaking = enabled && status?.incoming.length === 1 && name !== 'hangup';
        const variant = shaking ? `${name}:frame:${frame % images[name].frames.length}`
            : `${name}:${enabled ? 'active' : 'idle'}`;
        if (key.image === variant) continue;
        key.image = variant;
        send({ event: 'setImage', context, payload: { target: 0,
            image: shaking ? images[name].frames[frame % images[name].frames.length]
                : images[name][enabled ? 'active' : 'idle'] } });
    }
}
function updateAnimation() {
    const ringing = status?.incoming.length === 1 && [...contexts.values()].some(key =>
        actionName(key.action) !== 'hangup' && !(actionName(key.action) === 'answer' && status?.display) && available(actionName(key.action), status));
    if (ringing && !animationTimer) {
        frame = 0;
        animationTimer = setInterval(() => { frame++; render(); }, 100);
    } else if (!ringing && animationTimer) {
        clearInterval(animationTimer); animationTimer = null; frame = 0;
    }
    render();
}
async function poll() {
    clearTimeout(pollTimer);
    if (polling || !monitoring()) return;
    polling = true;
    const epoch = generation;
    const id = ++requestId, path = forceSnapshot ? '/status' : statusPath(status);
    forceSnapshot = false;
    pollController = new AbortController();
    try {
        const next = validateStatus(await bridge(settings, path, 'GET', path === '/status' ? 1500 : 23000, pollController.signal));
        accept(next, epoch, id);
    } catch (error) {
        if (!pollController?.signal.aborted && epoch === generation && id >= appliedId) { appliedId = id; status = null; profiles.lost(); lastError = error.message; failures++; }
    } finally {
        polling = false; pollController = null;
        updateAnimation(); notify();
        if (monitoring()) pollTimer = setTimeout(poll, forceSnapshot ? 0 : failures ? Math.min(5000, 500 * 2 ** Math.min(failures - 1, 4)) : status?.longPoll ? 0 : 500);
    }
}
function applySettings(value) {
    const fingerprint = JSON.stringify([value?.token, value?.port, profileConfig(value)]);
    if (fingerprint === settingsFingerprint) { notify(); return; }
    settingsFingerprint = fingerprint;
    profiles.configure(value);
    generation++; status = null; failures = 0;
    pollController?.abort();
    try { settings = config(value); lastError = ''; }
    catch (error) { settings = null; lastError = error.message; }
    clearTimeout(pollTimer); updateAnimation(); notify();
    if (!polling) void poll();
}
async function press(context) {
    const key = contexts.get(context);
    if (key && actionName(key.action) === 'return') { profiles.back(key.device); return; }
    if (!key || busy || !settings) { send({ event: 'showAlert', context }); return; }
    busy = true;
    const epoch = generation, connection = settings, action = actionName(key.action);
    try {
        const id = ++requestId;
        const fresh = validateStatus(await bridge(connection, '/status'));
        if (epoch !== generation) throw new Error('Bridge settings changed.');
        accept(fresh, epoch, id);
        updateAnimation(); notify();
        if (!available(action, fresh)) throw new Error('No suitable call for this button.');
        await bridge(connection, `/${action}`, 'POST', 8000);
        if (epoch === generation) {
            // Acknowledgment is dispatch, not proof of voice connection.
            appliedId = ++requestId;
            pollController?.abort();
            // Keep the portrait with explicitly pending feedback; immediately reconcile, never infer connection.
            forceSnapshot = true;
            status = status?.display ? { ...status, operation: action,
                operationChannelId: action === 'hangup' ? (fresh.selected ?? fresh.connected) : fresh.incoming[0] } : null;
            updateAnimation();
            send({ event: 'showOk', context }); notify('Command sent. Checking call state…');
        }
    } catch (error) {
        send({ event: 'showAlert', context });
        if (epoch === generation) notify(error.message);
    } finally { busy = false; void poll(); }
}
ws.on('open', () => {
    send({ event: argument('-registerEvent'), uuid });
    send({ event: 'getGlobalSettings', context: uuid });
});
ws.on('message', raw => {
    let e;
    try { e = JSON.parse(String(raw)); } catch { return; }
    if (e.event === 'didReceiveGlobalSettings') applySettings(e.payload.settings);
    else if (e.event === 'willAppear') {
        if (!['answer', 'decline', 'hangup', 'return'].includes(actionName(e.action))) return;
        contexts.set(e.context, { action: e.action, device: e.device }); profiles.appear(e); updateAnimation(); void poll();
    } else if (e.event === 'willDisappear') {
        contexts.delete(e.context); inspectors.delete(e.context);
        profiles.disappear(e.context);
        if (!monitoring()) { generation++; pollController?.abort(); clearTimeout(pollTimer); status = null; }
        updateAnimation();
    } else if (e.event === 'deviceDidConnect' || e.event === 'deviceDidChange') {
        profiles.connect(e.device, e.deviceInfo.type); void poll();
    } else if (e.event === 'deviceDidDisconnect') {
        profiles.disconnect(e.device);
        for (const [context, key] of contexts) if (key.device === e.device) { contexts.delete(context); inspectors.delete(context); }
        if (!monitoring()) { generation++; pollController?.abort(); clearTimeout(pollTimer); status = null; }
        updateAnimation();
    } else if (e.event === 'keyDown') void press(e.context);
    else if (e.event === 'propertyInspectorDidAppear') { inspectors.add(e.context); notified = ''; notify(); }
    else if (e.event === 'propertyInspectorDidDisappear') inspectors.delete(e.context);
    else if (e.event === 'sendToPlugin' && e.payload?.command === 'refresh') {
        send({ event: 'getGlobalSettings', context: uuid });
        // A UI test must bypass the held /status?revision observer and deduped feedback.
        forceSnapshot = true; notified = '';
        notify(settings ? 'Checking bridge…' : lastError);
        pollController?.abort();
        if (!polling) void poll();
    } else if (e.event === 'sendToPlugin' && e.payload?.command === 'previewProfile') {
        send({event:'sendToPropertyInspector',action:e.action,context:e.context,
            payload:{profilePreview:true,message:profiles.preview()}});
    }
});
ws.on('error', () => { /* Stream Deck owns startup/restart; never log tokens. */ });
ws.on('close', () => { profiles.cancel(); pollController?.abort(); clearInterval(animationTimer); clearTimeout(pollTimer); process.exit(0); });
