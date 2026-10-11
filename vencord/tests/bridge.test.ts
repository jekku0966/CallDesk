import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bridge } from '../callDeck/bridge.ts';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
const token = 'a'.repeat(64);
async function setup(t: any) {
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as any).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const bridge = new Bridge();
    await bridge.start(port, token);
    t.after(() => bridge.stop());
    const request = (path: string, options: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
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
