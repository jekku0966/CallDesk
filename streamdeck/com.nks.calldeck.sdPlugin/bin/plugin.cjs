/* CallDeck — GPL-3.0-or-later */
const WebSocket = require('./ws');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { config, validateStatus, available, bridge } = require('./core.cjs');
const args = process.argv.slice(2);
const argument = name => args[args.indexOf(name) + 1];
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
const send = message => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
const actionName = action => action?.split('.').at(-1);
function notify(message = lastError) {
    for (const context of inspectors) send({ event: 'sendToPropertyInspector', context,
        action: contexts.get(context)?.action, payload: { message, state: status?.state ?? 'offline' } });
}
function render() {
    for (const [context, key] of contexts) {
        const name = actionName(key.action);
        const enabled = available(name, status);
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
        actionName(key.action) !== 'hangup' && available(actionName(key.action), status));
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
    if (polling || !settings || !contexts.size) return;
    polling = true;
    const epoch = generation;
    try {
        const next = validateStatus(await bridge(settings, '/status'));
        if (epoch === generation) { status = next; lastError = ''; }
    } catch (error) {
        if (epoch === generation) { status = null; lastError = error.message; }
    } finally {
        polling = false;
        updateAnimation(); notify();
        if (settings && contexts.size) pollTimer = setTimeout(poll, 500);
    }
}
function applySettings(value) {
    generation++; status = null;
    try { settings = config(value); lastError = ''; }
    catch (error) { settings = null; lastError = error.message; }
    clearTimeout(pollTimer); updateAnimation(); notify();
    if (!polling) void poll();
}
async function press(context) {
    const key = contexts.get(context);
    if (!key || busy || !settings) { send({ event: 'showAlert', context }); return; }
    busy = true;
    const epoch = generation, connection = settings, action = actionName(key.action);
    try {
        const fresh = validateStatus(await bridge(connection, '/status'));
        if (epoch !== generation || !available(action, fresh)) throw new Error('No suitable call for this button.');
        await bridge(connection, `/${action}`, 'POST', 8000);
        if (epoch === generation) {
            // Acknowledgment is dispatch, not proof of voice connection.
            status = null; updateAnimation();
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
        if (!['answer', 'decline', 'hangup'].includes(actionName(e.action))) return;
        contexts.set(e.context, { action: e.action }); updateAnimation(); void poll();
    } else if (e.event === 'willDisappear') {
        contexts.delete(e.context); inspectors.delete(e.context);
        if (!contexts.size) { clearTimeout(pollTimer); status = null; }
        updateAnimation();
    } else if (e.event === 'keyDown') void press(e.context);
    else if (e.event === 'propertyInspectorDidAppear') { inspectors.add(e.context); notify(); }
    else if (e.event === 'propertyInspectorDidDisappear') inspectors.delete(e.context);
    else if (e.event === 'sendToPlugin' && e.payload?.command === 'refresh') {
        send({ event: 'getGlobalSettings', context: uuid }); void poll();
    }
});
ws.on('error', () => { /* Stream Deck owns startup/restart; never log tokens. */ });
ws.on('close', () => { clearInterval(animationTimer); clearTimeout(pollTimer); process.exit(0); });
