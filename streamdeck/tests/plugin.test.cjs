const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const root = path.resolve(__dirname, '../com.nks.calldeck.sdPlugin');
const { WebSocketServer } = require(root + '/bin/ws');
const { config, available, validateStatus, bridge, newer, statusPath } = require(root + '/bin/core.cjs');
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

test('snapshot versions reject stale data and support fresh sessions and legacy bridges', () => {
    const s = { state: 'idle', incoming: [], connected: null, session: 'one', revision: 4, longPoll: true };
    assert.equal(newer(s, { ...s, revision: 3 }), false);
    assert.equal(newer(s, { ...s, revision: 4 }), true);
    assert.equal(newer(s, { ...s, session: 'two', revision: 0 }), true);
    assert.equal(statusPath(s), '/status?session=one&revision=4');
    assert.equal(statusPath({ state: 'idle' }), '/status');
    assert.throws(() => validateStatus({ ...s, revision: -1 }));
    assert.equal(available('answer', { ...s, incoming: ['123'], selected: '456', voice: 'connecting' }), false);
    assert.equal(available('answer', { ...s, incoming: ['123'], operation: 'answer' }), false);
    assert.equal(available('hangup', { ...s, selected: '123', operation: 'answer' }), true);
    assert.equal(available('hangup', { ...s, selected: '123', operation: 'hangup' }), false);
});

test('companion ignores out-of-order reads and an old session after a newer button snapshot', async () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const sent = [], pending = [], timers = new Map(); let socket, timerId = 0;
    class FakeSocket {
        static OPEN = 1;
        constructor() { socket = this; this.readyState = 1; this.handlers = {}; }
        on(event, fn) { this.handlers[event] = fn; }
        send(text) { sent.push(JSON.parse(text)); }
    }
    const core = require(root + '/bin/core.cjs');
    const env = { __dirname: root + '/bin', process: { argv: ['node', 'plugin', '-pluginUUID', 'test', '-port', '1234'], exit() {} },
        AbortController, setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {},
        require: name => name === './ws' ? FakeSocket : name === './caller.cjs' ? require(root + '/bin/caller.cjs') : name === './core.cjs'
            ? { ...core, bridge: (_settings, path) => new Promise(resolve => pending.push({ path, resolve })) } : require(name) };
    vm.runInNewContext(fs.readFileSync(root + '/bin/plugin.cjs', 'utf8'), env);
    const emit = event => socket.handlers.message(JSON.stringify(event));
    const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    emit({ event: 'didReceiveGlobalSettings', payload: { settings: { token, port: 9473 } } });
    emit({ event: 'willAppear', context: 'hangup', action: 'com.nks.calldeck.hangup' });
    assert.equal(pending.length, 1);
    emit({ event: 'keyDown', context: 'hangup' });
    assert.equal(pending.length, 2);
    const idle = { state: 'idle', incoming: [], connected: null, session: 'new', revision: 1, longPoll: true };
    pending[1].resolve(idle); await settle();
    assert.ok(sent.some(m => m.event === 'showAlert'));
    const count = sent.filter(m => m.event === 'setImage').length;
    pending[0].resolve({ ...idle, state: 'connected', connected: '123', session: 'old', revision: 100 }); await settle();
    assert.equal(sent.filter(m => m.event === 'setImage').length, count, 'late old session must not light Hang Up');
    for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
    assert.equal(pending[2].path, '/status?session=new&revision=1');
    emit({ event: 'keyDown', context: 'hangup' });
    pending[3].resolve({ ...idle, revision: 3 }); await settle();
    pending[2].resolve({ ...idle, state: 'connected', connected: '123', revision: 2 }); await settle();
    assert.equal(sent.filter(m => m.event === 'setImage').length, count, 'lower revision from earlier read must not light Hang Up');
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

test('real bridge long polling shares snapshots, confirms connection and recovers across restarts', async t => {
    const { Bridge } = await import('../../vencord/callDeck/bridge.ts');
    const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const bridgePort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    let native = new Bridge(); await native.start(bridgePort, token);
    let state = { incoming: [], connected: null, selected: null, voice: 'idle' };
    let statusRequests = 0;
    const watch = () => native.server.on('request', req => { if (req.url.startsWith('/status')) statusRequests++; });
    watch(); native.exchange(state);
    const commands = [];
    const heartbeat = setInterval(() => { const next = native.exchange(state); commands.push(...next);
        for (const c of next) native.complete(c.id, true); }, 50);
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(wss, 'listening');
    let child, socket, messages = [], errors = '';
    const emit = event => socket.send(JSON.stringify(event));
    async function launch() {
        messages = [];
        child = spawn(process.execPath, [root + '/bin/plugin.cjs', '-port', String(wss.address().port),
            '-pluginUUID', 'sync-test', '-registerEvent', 'registerPlugin'], { stdio: ['ignore', 'ignore', 'pipe'] });
        child.stderr.on('data', data => { errors += data; });
        [socket] = await once(wss, 'connection');
        socket.on('message', raw => {
            const message = JSON.parse(String(raw)); messages.push(message);
            if (message.event === 'getGlobalSettings') emit({ event: 'didReceiveGlobalSettings', payload: { settings: { token, port: bridgePort } } });
        });
        await until(() => messages.some(m => m.event === 'registerPlugin'));
        for (const [context, action] of [['answer1','answer'],['answer2','answer'],['hangup','hangup']]) {
            emit({ event: 'willAppear', context, action: 'com.nks.calldeck.' + action });
        }
        await until(() => messages.filter(m => m.event === 'setImage').length >= 3);
    }
    t.after(async () => { clearInterval(heartbeat); child?.kill();
        for (const client of wss.clients) client.terminate(); wss.close(); await native.stop(); });
    await launch();
    await delay(100); const idleRequests = statusRequests;
    await delay(650); assert.equal(statusRequests, idleRequests, 'idle uses a held request, not 500 ms polling');
    state = { incoming: ['123'], connected: null, selected: null, voice: 'idle' }; native.exchange(state);
    await until(() => messages.filter(m => m.event === 'setImage' && m.context === 'answer1').length > 2);
    assert.equal(messages.filter(m => m.event === 'setImage' && m.context === 'answer1').at(-1).payload.image,
        messages.filter(m => m.event === 'setImage' && m.context === 'answer2').at(-1).payload.image);
    emit({ event: 'keyDown', context: 'answer1' });
    await until(() => commands.length === 1 && messages.some(m => m.event === 'showOk'));
    const art = JSON.parse(require('node:fs').readFileSync(root + '/imgs/frames.json', 'utf8'));
    state = { incoming: [], connected: null, selected: '123', voice: 'connecting' }; native.exchange(state);
    await delay(150);
    assert.equal(messages.filter(m => m.event === 'setImage' && m.context === 'hangup').at(-1).payload.image, art.hangup.idle);
    state = { incoming: [], connected: '123', selected: '123', voice: 'connected' }; native.exchange(state);
    await until(() => messages.filter(m => m.event === 'setImage' && m.context === 'hangup').at(-1).payload.image === art.hangup.active);
    await native.stop();
    await until(() => messages.filter(m => m.event === 'setImage' && m.context === 'hangup').at(-1).payload.image === art.hangup.idle);
    native = new Bridge(); await native.start(bridgePort, token); watch();
    state = { incoming: ['456'], connected: null, selected: null, voice: 'idle' }; native.exchange(state);
    const count = messages.filter(m => m.event === 'setImage' && m.context === 'answer1').length;
    await until(() => messages.filter(m => m.event === 'setImage' && m.context === 'answer1').length > count + 2, 7000);
    child.kill(); await once(child, 'exit');
    await launch();
    await until(() => messages.filter(m => m.event === 'setImage' && m.context === 'answer1').length > 2);
    for (const context of ['answer1','answer2','hangup']) emit({ event: 'willDisappear', context });
    await delay(150); const hiddenRequests = statusRequests; await delay(650);
    assert.equal(statusRequests, hiddenRequests); assert.equal(errors, '');
});

test('Answer process combines identity with control, shares keys, and restores exact idle artwork', async t => {
    const display = { channelId:'123', kind:'dm', name:'Alex', participants:[{ id:'456', name:'Alex', avatar:null }], total:1 };
    let state = { state:'ringing', incoming:['123'], selected:null, connected:null, voice:'idle', display };
    const posts=[], messages=[];
    const server=http.createServer((req,res)=>{
        if(req.method==='POST'){posts.push(req.url); state={...state,operation:'answer',operationChannelId:'123'};res.end('{"ok":true}');}
        else res.end(JSON.stringify(state));
    }); server.listen(0,'127.0.0.1'); await once(server,'listening');
    const wss=new WebSocketServer({port:0,host:'127.0.0.1'}); await once(wss,'listening');
    const child=spawn(process.execPath,[root+'/bin/plugin.cjs','-port',String(wss.address().port),'-pluginUUID','caller-test','-registerEvent','registerPlugin'],{stdio:['ignore','ignore','pipe']});
    let errors='';child.stderr.on('data',data=>{errors+=data});
    t.after(()=>{child.kill();for(const client of wss.clients)client.terminate();wss.close();server.closeAllConnections();server.close()});
    const [socket]=await once(wss,'connection'); const emit=e=>socket.send(JSON.stringify(e));
    socket.on('message',raw=>{const m=JSON.parse(String(raw));messages.push(m);if(m.event==='getGlobalSettings')emit({event:'didReceiveGlobalSettings',payload:{settings:{token,port:server.address().port}}})});
    await until(()=>messages.some(m=>m.event==='registerPlugin'));
    for(const context of ['one','two'])emit({event:'willAppear',context,action:'com.nks.calldeck.answer'});
    const last=context=>messages.filter(m=>m.event==='setImage'&&m.context===context).at(-1)?.payload.image;
    await until(()=>last('one')?.startsWith('data:image/svg+xml'));
    assert.equal(last('one'),last('two'));
    assert.match(Buffer.from(last('one').split(',')[1],'base64').toString(),/Alex/);
    emit({event:'keyDown',context:'one'});await until(()=>posts.length===1);
    await until(()=>last('one')?.startsWith('data:image/svg+xml')&&Buffer.from(last('one').split(',')[1],'base64').toString().includes('Answering'));
    assert.deepEqual(posts,['/answer']);
    state={...state,incoming:[],selected:'123',connected:'123',voice:'connected',operation:null};
    await until(()=>last('one')?.startsWith('data:image/svg+xml')&&Buffer.from(last('one').split(',')[1],'base64').toString().includes('Connected'));
    emit({event:'keyDown',context:'one'});await until(()=>messages.some(m=>m.event==='showAlert'));assert.equal(posts.length,1);
    state={state:'idle',incoming:[],selected:null,connected:null,voice:'idle',display:null};
    const art=JSON.parse(require('node:fs').readFileSync(root+'/imgs/frames.json','utf8'));
    await until(()=>last('one')===art.answer.idle);assert.equal(last('two'),art.answer.idle);assert.equal(errors,'');
});
