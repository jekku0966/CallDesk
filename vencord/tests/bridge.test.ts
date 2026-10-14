import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bridge } from '../callDeck/bridge.ts';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { voiceStatus } from '../callDeck/state.ts';
const token = 'a'.repeat(64);
async function setup(t: any) {
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as any).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const bridge = new Bridge();
    await bridge.start(port, token);
    t.after(() => bridge.stop());
    const request = (path: string, options: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, Connection: 'close', ...options.headers } });
    return { bridge, request };
}
test('authentication, browser rejection, heartbeat and methods', async t => {
    const { bridge, request } = await setup(t);
    assert.equal((await request('/status')).status, 503);
    bridge.exchange({ incoming: [], connected: null });
    assert.equal((await request('/status', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await request('/status', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const hostResult = await new Promise<number>(resolve => { const req = httpRequest({ hostname: '127.0.0.1', port: (bridge as any).server.address().port, path: '/status', headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, res => { res.resume(); resolve(res.statusCode!); }); req.end(); });
    assert.equal(hostResult, 403);
    assert.equal((await request('/status')).status, 200);
    assert.equal((await request('/answer')).status, 405);
    assert.equal((await request('/answer', { method: 'POST' })).status, 409);
});
test('commands wait for renderer completion and retain target', async t => {
    const { bridge, request } = await setup(t);
    bridge.exchange({ incoming: ['123'], connected: null });
    const result = request('/answer', { method: 'POST' });
    let commands: ReturnType<Bridge['exchange']> = [];
    for (let i = 0; i < 50 && !commands.length; i++) { await new Promise(r => setTimeout(r, 10)); commands = bridge.exchange({ incoming: ['123'], connected: null }); }
    assert.equal(commands.length, 1);
    assert.equal(commands[0].channelId, '123');
    assert.equal((await request('/decline', { method: 'POST' })).status, 409);
    bridge.complete(commands[0].id, true);
    assert.equal((await result).status, 200);
});
test('ambiguous ringing, connected call and invalid state are rejected', async t => {
    const { bridge, request } = await setup(t);
    bridge.exchange({ incoming: ['123', '456'], connected: null });
    assert.equal((await request('/answer', { method: 'POST' })).status, 409);
    bridge.exchange({ incoming: ['123'], connected: '456' });
    assert.equal((await request('/answer', { method: 'POST' })).status, 409);
    assert.equal((await request('/decline', { method: 'POST', body: '{}' })).status, 400);
    assert.throws(() => bridge.exchange({ incoming: ['bad'], connected: null }));
});
test('shutdown resolves pending requests', async t => {
    const { bridge, request } = await setup(t);
    bridge.exchange({ incoming: [], connected: '123' });
    const result = request('/hangup', { method: 'POST' });
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 10)); if (bridge.exchange({ incoming: [], connected: '123' }).length) break; }
    await bridge.stop();
    assert.equal((await result).status, 503);
});
test('timeout removes commands instead of replaying later', async t => {
    const { bridge, request } = await setup(t);
    bridge.exchange({ incoming: ['123'], connected: null });
    const result = await request('/answer', { method: 'POST' });
    assert.equal(result.status, 504);
    assert.deepEqual(bridge.exchange({ incoming: ['123'], connected: null }), []);
});
test('stale renderer blocks actions', async t => {
    const { bridge, request } = await setup(t);
    bridge.exchange({ incoming: ['123'], connected: null });
    (bridge as any).heartbeat = Date.now() - 4000;
    assert.equal((await request('/answer', { method: 'POST' })).status, 503);
    assert.deepEqual(bridge.exchange({ incoming: ['123'], connected: null }), []);
});

async function dispatch(bridge: Bridge, request: any, action: string, status: any) {
    const response = request(`/${action}`, { method: 'POST' });
    let commands: ReturnType<Bridge['exchange']> = [];
    for (let i = 0; i < 50 && !commands.length; i++) {
        await new Promise(r => setTimeout(r, 10)); commands = bridge.exchange(status);
    }
    assert.equal(commands.length, 1);
    bridge.complete(commands[0].id, true);
    assert.equal((await response).status, 200);
}

test('RTC confirmation is distinct from selection, connecting, failure and unknown', () => {
    for (const state of ['CONNECTING', 'RTC_CONNECTING', 'AUTHENTICATING', 'ICE_CHECKING', 'DTLS_CONNECTING', 'AWAITING_ENDPOINT']) {
        const s = voiceStatus(['123'], '123', '123', state);
        assert.equal(s.voice, 'connecting'); assert.equal(s.connected, null);
    }
    assert.equal(voiceStatus([], '123', '123', 'RTC_CONNECTED').connected, '123');
    assert.equal(voiceStatus([], '123', '456', 'RTC_CONNECTED').voice, 'unknown');
    assert.equal(voiceStatus([], null, '123', 'RTC_CONNECTED').connected, null);
    assert.equal(voiceStatus([], '123', '123', 'NO_ROUTE').voice, 'error');
    assert.equal(voiceStatus([], '123', '123', 'NEW_DISCORD_STATE').voice, 'unknown');
    assert.equal(voiceStatus([], null, null, 'DISCONNECTED').voice, 'idle');
});

test('long polling wakes on changes; duplicate snapshots and reordered incoming lists keep revision', async t => {
    const { bridge, request } = await setup(t);
    bridge.exchange({ incoming: ['456', '123', '123'], connected: null });
    const first = await (await request('/status')).json();
    bridge.exchange({ incoming: ['123', '456'], connected: null });
    assert.equal((await (await request('/status')).json()).revision, first.revision);
    const path = `/status?session=${first.session}&revision=${first.revision}`;
    const observers = [request(path), request(path)];
    await new Promise(r => setTimeout(r, 30));
    bridge.exchange({ incoming: [], connected: '789' });
    for (const pending of observers) {
        const next = await (await pending).json();
        assert.equal(next.connected, '789'); assert.equal(next.revision, first.revision + 1);
    }
    assert.equal((await request(path, { headers: { Authorization: 'wrong' } })).status, 401);
});

test('Answer dispatch stays pending, blocks duplicates, permits Hang Up while connecting', async t => {
    const { bridge, request } = await setup(t);
    const ringing = voiceStatus(['123'], null, null, 'DISCONNECTED');
    bridge.exchange(ringing);
    await dispatch(bridge, request, 'answer', ringing);
    let s = await (await request('/status')).json();
    assert.equal(s.phase, 'answer-requested'); assert.equal(s.connected, null);
    assert.equal((await request('/answer', { method: 'POST' })).status, 409);
    assert.equal((await request('/decline', { method: 'POST' })).status, 409);
    const connecting = voiceStatus([], '123', '123', 'RTC_CONNECTING');
    bridge.exchange(connecting);
    await dispatch(bridge, request, 'hangup', connecting);
    s = await (await request('/status')).json(); assert.equal(s.phase, 'disconnecting');
    bridge.exchange(voiceStatus([], null, null, 'DISCONNECTED'));
    s = await (await request('/status')).json(); assert.equal(s.operation, null); assert.equal(s.phase, 'idle');
});

test('successful Answer, failed connection, Decline and server voice Hang Up reconcile', async t => {
    const { bridge, request } = await setup(t);
    const ringing = voiceStatus(['123'], null, null, 'DISCONNECTED');
    bridge.exchange(ringing); await dispatch(bridge, request, 'answer', ringing);
    bridge.exchange(voiceStatus([], '123', '123', 'RTC_CONNECTED'));
    let s = await (await request('/status')).json(); assert.equal(s.operation, null); assert.equal(s.connected, '123');
    bridge.exchange(ringing); await dispatch(bridge, request, 'answer', ringing);
    bridge.exchange(voiceStatus([], '123', '123', 'NO_ROUTE'));
    s = await (await request('/status')).json(); assert.equal(s.connected, null); assert.match(s.error, /failed/);
    bridge.exchange(ringing); await dispatch(bridge, request, 'decline', ringing);
    bridge.exchange(voiceStatus([], null, null, 'DISCONNECTED'));
    assert.equal((await (await request('/status')).json()).operation, null);
    const server = voiceStatus([], '456', '456', 'RTC_CONNECTED');
    bridge.exchange(server); await dispatch(bridge, request, 'hangup', server);
    bridge.exchange(voiceStatus([], null, null, 'DISCONNECTED'));
    assert.equal((await (await request('/status')).json()).connected, null);
});

test('held snapshots fail on stale heartbeat and restart requires a fresh snapshot', async t => {
    const { bridge, request } = await setup(t);
    bridge.exchange({ incoming: ['123'], connected: null });
    const first = await (await request('/status')).json();
    const path = `/status?session=${first.session}&revision=${first.revision}`;
    const held = request(path);
    await new Promise(r => setTimeout(r, 30));
    (bridge as any).heartbeat = Date.now() - 4000;
    assert.equal((await held).status, 503);
    const port = (bridge as any).server.address().port;
    await bridge.stop(); await bridge.start(port, token);
    assert.equal((await request('/status')).status, 503);
    bridge.exchange({ incoming: [], connected: null });
    const next = await (await request(path)).json();
    assert.notEqual(next.session, first.session); assert.deepEqual(next.incoming, []);
});

test('confirmation timeout reports uncertainty and late completion cannot create a connection', async t => {
    const { bridge, request } = await setup(t);
    const ringing = { incoming: ['123'], connected: null };
    bridge.exchange(ringing); await dispatch(bridge, request, 'answer', ringing);
    (bridge as any).operation.expires = Date.now() - 1;
    await new Promise(r => setTimeout(r, 550));
    const s = await (await request('/status')).json();
    assert.equal(s.operation, null); assert.equal(s.connected, null); assert.match(s.error, /timed out/);
    bridge.complete(1, true);
    assert.equal((await (await request('/status')).json()).connected, null);
});

test('uncertain dispatch retains duplicate guard until an authoritative effect is observed', async t => {
    const { bridge, request } = await setup(t);
    bridge.exchange({ incoming: ['123'], connected: null });
    const result = request('/decline', { method: 'POST' });
    let commands: ReturnType<Bridge['exchange']> = [];
    for (let i = 0; i < 50 && !commands.length; i++) {
        await new Promise(r => setTimeout(r, 10)); commands = bridge.exchange({ incoming: ['123'], connected: null });
    }
    bridge.complete(commands[0].id, false, true);
    assert.equal((await result).status, 504);
    assert.equal((await request('/decline', { method: 'POST' })).status, 409);
    const s = await (await request('/status')).json(); assert.equal(s.operation, 'decline'); assert.match(s.error, /timed out/);
    bridge.exchange({ incoming: [], connected: null });
    assert.equal((await (await request('/status')).json()).operation, null);
});
