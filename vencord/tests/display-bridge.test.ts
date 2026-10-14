import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bridge } from '../callDeck/bridge.ts';
test('bridge copies caller metadata, versions identity changes, and rejects oversized or external portraits', () => {
    const bridge = new Bridge();
    const display = { channelId:'123', kind:'dm' as const, name:'Alex', participants:[{ id:'456', name:'Alex', avatar:null }], total:1 };
    bridge.exchange({ incoming:['123'], connected:null, display });
    const revision = (bridge as any).revision;
    display.participants[0].name = 'Changed';
    assert.equal((bridge as any).status.display.participants[0].name, 'Alex');
    bridge.exchange({ incoming:['123'], connected:null, display });
    assert.equal((bridge as any).revision, revision+1);
    assert.throws(() => bridge.exchange({ incoming:['123'], connected:null, display:{ ...display, name:'x'.repeat(81) } }));
    assert.throws(() => bridge.exchange({ incoming:['123'], connected:null, display:{ ...display, participants:[{ id:'456', name:'Alex', avatar:'https://evil.test/avatar.png' }] } }));
    bridge.exchange({ incoming:[], connected:null, display:null });
    assert.equal((bridge as any).status.display, null);
});
