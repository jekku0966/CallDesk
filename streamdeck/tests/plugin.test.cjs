const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const root = path.resolve(__dirname, '../com.nks.calldeck.sdPlugin');
const { WebSocketServer } = require(root + '/bin/ws');
const { config, available, validateStatus, bridge } = require(root + '/bin/core.cjs');
const token = 'a'.repeat(64);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 4000) {
    const start = Date.now();
    while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out'); await delay(20); }
}
test('configuration, status validation and call eligibility', () => {
    assert.throws(() => config({ token: 'discord-account-token' }));
    assert.throws(() => config({ token, port: 80 }));
    assert.throws(() => validateStatus({ state: 'idle', incoming: ['bad'], connected: null }));
    const idle = { state: 'idle', incoming: [], connected: null };
    assert.equal(available('answer', idle), false);
    assert.equal(available('answer', { ...idle, incoming: ['123'] }), true);
    assert.equal(available('answer', { ...idle, incoming: ['123'], connected: '456' }), false);
    assert.equal(available('decline', { ...idle, incoming: ['123'], connected: '456' }), true);
    assert.equal(available('decline', { ...idle, incoming: ['123', '456'] }), false);
    assert.equal(available('hangup', { ...idle, connected: '456' }), true);
});
test('HTTP client authenticates empty POST and rejects errors / redirects / timeout', async t => {
    let mode = 'ok';
    const server = http.createServer((req, res) => {
        assert.equal(req.headers.authorization, `Bearer ${token}`);
        let body = '';
        req.on('data', data => { body += data; });
        req.on('end', () => {
            assert.equal(body, '');
            if (mode === 'timeout') return;
            res.writeHead(mode === 'error' ? 401 : mode === 'redirect' ? 302 : 200,
                { 'Content-Type': 'application/json', Location: 'http://example.invalid' });
            res.end(JSON.stringify({ ok: true }));
        });
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const settings = { port: server.address().port, token };
    assert.deepEqual(await bridge(settings, '/answer', 'POST'), { ok: true });
    mode = 'error'; await assert.rejects(bridge(settings, '/status'), /Wrong bridge token/);
    mode = 'redirect'; await assert.rejects(bridge(settings, '/status'), /HTTP 302/);
    mode = 'timeout'; await assert.rejects(bridge(settings, '/status', 'GET', 50), /timeout/);
});
test('Stream Deck process: registration, shared settings, idle/ringing frames, button-only POST, busy guard, offline recovery', async t => {
    let state = { state: 'idle', incoming: [], connected: null };
    const posts = [], requests = [], messages = [];
    const httpServer = http.createServer((req, res) => {
        requests.push(req.url);
        assert.equal(req.headers.authorization, `Bearer ${token}`);
        if (req.method === 'POST') {
            posts.push(req.url);
            setTimeout(() => { state = { state: 'connected', incoming: [], connected: '123' };
                res.end(JSON.stringify({ ok: true })); }, 150);
        } else { res.end(JSON.stringify(state)); }
    });
    httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening');
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(wss, 'listening');
    const child = spawn(process.execPath, [root + '/bin/plugin.cjs', '-port', String(wss.address().port),
        '-pluginUUID', 'test-registration', '-registerEvent', 'registerPlugin'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr=''; child.stderr.on('data', data => { stderr+=data; });
    t.after(() => { child.kill(); for (const client of wss.clients) client.terminate(); wss.close();
        httpServer.closeAllConnections(); httpServer.close(); });
    const [socket] = await once(wss, 'connection');
    const settings = { token, port: httpServer.address().port };
    const emit = event => socket.send(JSON.stringify(event));
    socket.on('message', raw => {
        const message = JSON.parse(String(raw)); messages.push(message);
        if (message.event === 'getGlobalSettings') emit({ event: 'didReceiveGlobalSettings', payload: { settings } });
    });
    await until(() => messages.some(m => m.event === 'registerPlugin'));
    for (const action of ['answer', 'decline', 'hangup']) emit({ event: 'willAppear', action: 'com.nks.calldeck.' + action,
        context: action, payload: { settings: {} } });
    await until(() => requests.includes('/status'));
    await delay(650);
    const idleCount = messages.filter(m => m.event === 'setImage').length;
    await delay(250); assert.equal(messages.filter(m => m.event === 'setImage').length, idleCount);
    assert.equal(posts.length, 0);
    state = { state: 'ringing', incoming: ['123'], connected: null };
    await until(() => messages.filter(m => m.event === 'setImage' && m.context === 'answer').length > 3);
    assert.equal(posts.length, 0, 'ringing status never auto-answers');
    emit({ event: 'keyDown', context: 'answer' }); emit({ event: 'keyDown', context: 'answer' });
    await until(() => posts.length === 1);
    await until(() => messages.some(m => m.event === 'showOk'));
    assert.deepEqual(posts, ['/answer']);
    await delay(700);
    const stopped = messages.filter(m => m.event === 'setImage').length;
    await delay(250); assert.equal(messages.filter(m => m.event === 'setImage').length, stopped);
    emit({ event: 'keyDown', context: 'answer' });
    await until(() => messages.filter(m => m.event === 'showAlert').length >= 2);
    assert.equal(posts.length, 1, 'unavailable Answer does not POST');
    emit({ event: 'didReceiveGlobalSettings', payload: { settings: { token: 'bad' } } });
    await delay(100); emit({ event: 'keyDown', context: 'hangup' }); await delay(100);
    assert.equal(posts.length, 1, 'invalid shared settings disable all actions');
    emit({ event: 'didReceiveGlobalSettings', payload: { settings } });
    emit({ event: 'keyDown', context: 'hangup' }); await until(() => posts.length === 2);
    assert.equal(posts[1], '/hangup');
    for (const context of ['answer','decline','hangup']) emit({ event: 'willDisappear', context });
    await delay(1700); const count=requests.length; await delay(650); assert.equal(requests.length,count);
    assert.equal(stderr, '');
});
test('property inspector shares validated settings using its registration ID', () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const script = fs.readFileSync(root + '/ui/settings.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
    const elements = Object.fromEntries(['token','port','status','save'].map(id => [id, { value:'', textContent:'', disabled:true }]));
    const messages=[]; let socket;
    const env={ document:{ getElementById:id=>elements[id] }, window:{}, WebSocket:class {
        constructor() { socket=this;this.readyState=1; } send(text) { messages.push(JSON.parse(text)); }
    }};
    vm.runInNewContext(script,env);
    env.window.connectElgatoStreamDeckSocket('1234','pi-registration','registerPropertyInspector','{}',
        JSON.stringify({ context:'answer-context', action:'com.nks.calldeck.answer' }));
    socket.onopen();
    elements.token.value=token;elements.port.value='9473';elements.save.onclick();
    const saved=messages.find(m=>m.event==='setGlobalSettings');
    assert.equal(saved.context,'pi-registration');assert.deepEqual(saved.payload,{token,port:9473});
    elements.token.value='bad';elements.save.onclick();
    assert.equal(messages.filter(m=>m.event==='setGlobalSettings').length,1);
    socket.onmessage({data:JSON.stringify({event:'sendToPropertyInspector',payload:{state:'ringing',message:''}})});
    assert.equal(elements.status.textContent,'Bridge connected — ringing.');
});
