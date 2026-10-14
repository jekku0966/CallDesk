const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AvatarCache, callerImage, allowedAvatar } = require('../com.nks.calldeck.sdPlugin/bin/caller.cjs');
const { fetchAvatar } = require('../com.nks.calldeck.sdPlugin/bin/caller.cjs');
const { validateStatus } = require('../com.nks.calldeck.sdPlugin/bin/core.cjs');
const avatar = 'https://cdn.discordapp.com/avatars/123/abcdef.png?size=128';
const person = id => ({ id: String(id), name: 'Alex <&"', avatar });
const status = (kind = 'dm', count = 1) => ({ incoming: ['456'], connected: null, selected: null, state: 'ringing', voice: 'idle',
    display: { channelId: '456', kind, name: 'Alex <&"', participants: Array.from({ length: Math.min(4,count) }, (_, i) => person(i+1)), total: count } });
const svg = image => Buffer.from(image.split(',')[1], 'base64').toString();
test('combined Answer renders identity and status with escaped names; idle/stale data returns original artwork', () => {
    const s = status(); const image = svg(callerImage(s, true, () => null));
    assert.match(image, /Incoming/); assert.match(image, /Answer/); assert.match(image, /Alex &lt;&amp;&quot;/);
    assert.doesNotMatch(image, /https:/); assert.match(image, /#22ed65/);
    assert.equal(callerImage(null, false, () => null), null);
    assert.equal(callerImage({ ...s, incoming: [] }, false, () => null), null);
    const connected = svg(callerImage({ ...s, incoming: [], selected:'456', connected:'456', voice:'connected' }, false, () => null));
    assert.match(connected, /Connected/); assert.match(connected, /#65716b/); assert.doesNotMatch(connected, /Hang Up/);
    assert.match(svg(callerImage({ ...s, operation:'answer' }, false, () => null)), /Answering/);
    const unrelated = svg(callerImage({ ...s, operation:'answer', operationChannelId:'999' }, false, () => null));
    assert.match(unrelated, /Incoming/); assert.doesNotMatch(unrelated, /Answering/);
});
test('group grid caps portraits and shows additional participant count without individual tiny names', () => {
    const image = svg(callerImage(status('group', 7), true, () => null));
    assert.match(image, /\+3/); assert.match(image, /Incoming · 7/);
    assert.equal((image.match(/fill="#28303e"/g) || []).length, 4);
    assert.throws(() => validateStatus({ ...status(), display: { ...status().display, participants: [person(1),person(1)] } }));
    assert.throws(() => validateStatus({ ...status(), display: { ...status().display, total: 1001 } }));
    assert.equal(allowedAvatar('https://localhost/avatars/123/a.png'), false);
});
test('avatar cache coalesces keys, refreshes success, backs off failure and bounds pending requests', async () => {
    let now = 0, calls = 0, updates = 0, resolve;
    const cache = new AvatarCache(() => { calls++; return new Promise(r => { resolve=r; }); }, () => now);
    const changed = () => updates++;
    cache.get(avatar, changed); cache.get(avatar, changed); await new Promise(setImmediate);
    assert.equal(calls, 1); resolve('data:image/png;base64,example'); await new Promise(setImmediate);
    assert.equal(updates, 1); assert.equal(cache.get(avatar, changed), 'data:image/png;base64,example');
    now = 300001; cache.get(avatar, changed); await new Promise(setImmediate); assert.equal(calls, 2);
    const failing = new AvatarCache(() => { calls++; return Promise.reject(new Error('offline')); }, () => now);
    failing.get(avatar, changed); await new Promise(setImmediate); const afterFailure = calls;
    failing.get(avatar, changed); await new Promise(setImmediate); assert.equal(calls, afterFailure);
    now += 30001; failing.get(avatar, changed); await new Promise(setImmediate); assert.equal(calls, afterFailure + 1);
    const bounded = new AvatarCache(() => new Promise(() => {}));
    for (let i=1;i<=40;i++) bounded.get(`https://cdn.discordapp.com/avatars/${i}/a.png`, changed);
    assert.equal(bounded.entries.size, 32);
});

test('avatar HTTP fetch rejects redirects and oversized images and sends no credentials', async t => {
    const https=require('node:https'), {EventEmitter}=require('node:events');
    const original=https.get; let mode='redirect', calls=0;
    t.after(()=>{https.get=original});
    https.get=(url,options,callback)=>{
        calls++;assert.equal(url,avatar);assert.deepEqual(options.headers,{Accept:'image/png'});
        const req=new EventEmitter();req.destroy=error=>{req.emit('error',error);req.emit('close')};
        const res=new EventEmitter();res.statusCode=mode==='redirect'?302:200;res.resume=()=>{};
        setImmediate(()=>{callback(res);if(mode==='oversized'){res.emit('data',Buffer.alloc(131073));}
            else if(mode==='invalid'){res.emit('data',Buffer.from('<svg/>'));res.emit('end');req.emit('close');}
            else req.emit('close');});return req;
    };
    await assert.rejects(fetchAvatar(avatar),/unavailable/);assert.equal(calls,1);
    mode='oversized';await assert.rejects(fetchAvatar(avatar),/too large/);
    mode='invalid';await assert.rejects(fetchAvatar(avatar),/Unexpected/);
    const before=calls;await assert.rejects(fetchAvatar('https://evil.test/avatar.png'),/Invalid/);assert.equal(calls,before);
});
