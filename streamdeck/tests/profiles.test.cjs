const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IncomingProfiles, PROFILES, MARKER, profileConfig } = require('../com.nks.calldeck.sdPlugin/bin/profiles.cjs');
const idle = { state:'idle', incoming:[], connected:null, selected:null, voice:'idle', session:'one' };
const ring = { ...idle, state:'ringing', incoming:['123'] };
function fixture(options = {}) {
    const sent = [], tasks = new Map(); let next = 0;
    const p = new IncomingProfiles(m => sent.push(m), {
        setTimeout: fn => { tasks.set(++next, fn); return next; }, clearTimeout: id => tasks.delete(id)
    });
    p.configure({ autoSwitch:{ enabled:true, deviceIds:['deck'], ...options } }); p.connect('deck',0);
    const appear = (context = 'answer', device = 'deck') => p.appear({context,device,payload:{settings:{autoProfile:MARKER}}});
    const flush = () => { const pending=[...tasks.values()];tasks.clear();pending.forEach(fn=>fn()); };
    return {p,sent,tasks,appear,flush};
}
test('opt-in settings clamp delays, allow only known modes and sanitize device IDs', () => {
    assert.equal(profileConfig().enabled,false);
    assert.deepEqual(profileConfig({autoSwitch:{enabled:'true',deviceIds:['x','x',2],returnMode:'arbitrary',delayMs:99999}}),
        {enabled:false,deviceIds:['x'],returnMode:'after-call',delayMs:10000});
});
test('new incoming edges only, explicit supported devices, baseline and restarts never replay ringing', () => {
    const {p,sent} = fixture({deviceIds:['deck','mini','pedal','disconnected']});p.connect('mini',1);p.connect('pedal',5);
    p.observe(ring);assert.equal(sent.length,0);
    p.observe(idle);p.observe({...idle,state:'connected',selected:'123',connected:'123',voice:'connected'});assert.equal(sent.length,0);
    p.observe(ring);p.observe(ring);assert.equal(sent.length,2);
    assert.deepEqual(sent[0],{event:'switchToProfile',device:'deck',payload:{profile:PROFILES[0],page:0}});
    p.observe({...ring,session:'two'});assert.equal(sent.length,2);
});
test('return waits for confirmed appearance and real call end; command acknowledgment is insufficient', () => {
    const {p,sent,appear,flush,tasks}=fixture();p.observe(idle);p.observe(ring);appear();
    p.observe({...ring,operation:'answer'});assert.equal(tasks.size,0);
    p.observe({...idle,selected:'123',voice:'connecting'});assert.equal(tasks.size,0);
    p.observe({...idle,connected:'123',selected:'123',voice:'connected'});assert.equal(tasks.size,0);
    p.observe({...idle,voice:'unknown'});assert.equal(tasks.size,0);
    p.observe(idle);assert.equal(tasks.size,1);flush();
    assert.deepEqual(sent.at(-1),{event:'switchToProfile',device:'deck',payload:{}});
    p.observe(idle);flush();assert.equal(sent.length,2);
});
test('decline/missed call delay cancels on new ringing, transport loss and manual departure', () => {
    const {p,sent,appear,flush,tasks}=fixture();p.observe(idle);p.observe(ring);appear();
    p.observe(idle);p.observe({...ring,incoming:['456']});assert.equal(tasks.size,0);
    p.observe(idle);p.lost();flush();assert.equal(sent.length,1);
    p.observe(idle);appear('decline');p.disappear('answer');assert.equal(p.owners.size,1);
    p.disappear('decline');flush();assert.equal(sent.length,1);
    appear();p.observe(idle);flush();assert.equal(sent.length,1,'manual reentry does not earn return ownership');
});
test('return mode after-ringing, manual Back, unsupported/disabled devices and disconnect', () => {
    const f=fixture({returnMode:'after-ringing'});f.p.observe(idle);f.p.observe(ring);f.appear();
    f.p.observe({...idle,selected:'123',voice:'connecting'});f.flush();assert.equal(f.sent.length,2);
    const g=fixture({returnMode:'manual'});g.p.observe(idle);g.p.observe(ring);g.appear();g.p.observe(idle);g.flush();assert.equal(g.sent.length,1);
    g.p.back('deck');assert.equal(g.sent.length,2);g.flush();assert.equal(g.sent.length,2);
    const h=fixture();h.p.observe(idle);h.p.observe(ring);h.appear();h.p.observe(idle);h.p.disconnect('deck');h.flush();assert.equal(h.sent.length,1);
    const off=fixture({enabled:false});off.p.observe(idle);off.p.observe(ring);assert.equal(off.sent.length,0);
});
test('unconfirmed switch expires; visible bundled profile is never switched onto itself', () => {
    const f=fixture();f.p.observe(idle);f.p.observe(ring);f.p.observe(idle);f.flush();assert.equal(f.p.owners.size,0);assert.equal(f.sent.length,1);
    f.appear();f.p.observe(ring);assert.equal(f.sent.length,1);
    f.p.observe(idle);f.flush();assert.equal(f.sent.length,1);
});
test('settings changes and bridge failures cannot cause delayed return from stale observations', () => {
    const f=fixture();f.p.observe(idle);f.p.observe(ring);f.appear();f.p.observe(idle);
    f.p.configure({autoSwitch:{enabled:false}});f.flush();assert.equal(f.sent.length,1);
});
test('explicit setup preview uses only saved supported devices, never acquires automatic return', () => {
    const f=fixture({enabled:false});assert.match(f.p.preview(),/switch requested/);assert.equal(f.sent.length,1);f.appear();
    assert.match(f.p.preview(),/already visible/);assert.equal(f.sent.length,1);f.p.observe(idle);f.flush();assert.equal(f.sent.length,1);
    f.p.back('deck');assert.deepEqual(f.sent.at(-1).payload,{});
    f.p.disconnect('deck');assert.match(f.p.preview(),/No selected supported device/);assert.equal(f.sent.length,2);
    f.p.configure({});assert.match(f.p.preview(),/No saved target/);
});

// Read ZIP central-directory records with built-in Node only; validate the actual shipped archives.
function unzip(file) {
    const b=require('node:fs').readFileSync(file), files=new Map();
    let end=b.length-22;while(b.readUInt32LE(end)!==0x06054b50)end--;
    let cursor=b.readUInt32LE(end+16);
    for(let i=0;i<b.readUInt16LE(end+10);i++) {
        assert.equal(b.readUInt32LE(cursor),0x02014b50);
        const size=b.readUInt32LE(cursor+20),len=b.readUInt16LE(cursor+28),extra=b.readUInt16LE(cursor+30),comment=b.readUInt16LE(cursor+32),offset=b.readUInt32LE(cursor+42);
        const name=b.subarray(cursor+46,cursor+46+len).toString();
        const start=offset+30+b.readUInt16LE(offset+26)+b.readUInt16LE(offset+28),data=b.subarray(start,start+size);
        files.set(name,JSON.parse((b.readUInt16LE(cursor+10)===8?require('node:zlib').inflateRawSync(data):data).toString()));
        cursor+=46+len+extra+comment;
    }return files;
}
test('every manifest profile ships bounded device-specific controls and a marked Back, with no credentials', () => {
    const path=require('node:path'),root=path.resolve(__dirname,'../com.nks.calldeck.sdPlugin');
    const manifest=require(root+'/manifest.json');
    assert.equal(manifest.Profiles.length,Object.keys(PROFILES).length);
    for(const profile of manifest.Profiles) {
        assert.equal(profile.Name,PROFILES[profile.DeviceType]);assert.equal(profile.AutoInstall,false);assert.equal(profile.DontAutoSwitchWhenInstalled,true);
        const files=unzip(path.join(root,profile.Name+'.streamDeckProfile'));
        const page=[...files.values()].find(v=>v.Controllers&&Object.keys(v.Controllers[0].Actions).length);
        assert.ok(page);assert.equal(files.size,3);
        const actions=page.Controllers[0].Actions;assert.deepEqual(Object.keys(actions),['0,0','1,0','2,0','0,1']);
        assert.deepEqual(Object.values(actions).map(a=>a.UUID),['answer','decline','hangup','return'].map(a=>'com.nks.calldeck.'+a));
        for(const a of Object.values(actions))assert.deepEqual(a.Settings,{autoProfile:MARKER});
        assert.ok([...files.values()].some(v=>v.Device?.Model&&v.Device.UUID===''));
    }
});
