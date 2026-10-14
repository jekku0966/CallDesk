import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { voiceStatus } from '../callDeck/state.ts';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(10); }
    assert.fail('Renderer simulation timed out');
}
function harness(t: any) {
    const state = { user: '99', calls: [] as any[], selected: null as string | null, channel: null as string | null, rtc: 'DISCONNECTED', commands: [] as any[] };
    const snapshots: any[] = [], completions: any[] = [], selections: any[] = [], declines: any[] = [];
    let failures = 0, concurrent = 0, maxConcurrent = 0, hangDecline = false;
    const listeners = new Set<() => void>();
    const store = (methods: any) => ({ ...methods, addChangeListener: (fn: () => void) => listeners.add(fn), removeChangeListener: (fn: () => void) => listeners.delete(fn) });
    const calls = store({ getCalls: () => state.calls });
    const channels = store({ getChannel: (id: string) => ({ type: id === '777' ? 2 : id === '456' ? 3 : 1 }) });
    const user = store({ getCurrentUser: () => state.user ? { id: state.user } : null });
    const selected = store({ getVoiceChannelId: () => state.selected });
    const rtc = store({ getRTCConnection: () => null, getLastRTCConnectionState: () => null, getChannelId: () => state.channel, getState: () => state.rtc });
    const native = {
        startBridge: async () => {}, stopBridge: async () => {},
        exchange: async (s: any) => {
            concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
            try { await delay(5); if (failures) { failures--; throw new Error('simulated IPC failure'); }
                snapshots.push(s); const next = state.commands; state.commands = []; return next;
            } finally { concurrent--; }
        },
        complete: async (id: number, ok: boolean, uncertain: boolean) => { completions.push({ id, ok, ...(uncertain ? { uncertain } : {}) }); }
    };
    const env: any = { setTimeout, clearTimeout, Date, Promise, voiceStatus,
        VencordNative: { pluginHelpers: { CallDeck: native } },
        definePluginSettings: () => ({ store: { port: 9473, accessToken: 'a'.repeat(64) } }),
        definePlugin: (plugin: any) => plugin, OptionType: { NUMBER: 1, STRING: 2 }, Logger: class { error() {} },
        CallStore: calls, ChannelStore: channels, SelectedChannelStore: selected, UserStore: user,
        RestAPI: { post: async (value: any) => { declines.push(value); if (hangDecline) await new Promise(() => {}); } },
        findByPropsLazy: (prop: string) => prop === 'selectVoiceChannel'
            ? { selectVoiceChannel: async (id: any) => { selections.push(id); } } : rtc };
    const source = stripTypeScriptTypes(readFileSync(new URL('../callDeck/index.ts', import.meta.url), 'utf8'))
        .replace(/^import .*;\r?$/gm, '').replace('export default definePlugin', 'globalThis.plugin = definePlugin');
    runInNewContext(source, env);
    t.after(async () => { env.plugin.stop(); await delay(20); });
    const emit = () => { for (const fn of listeners) fn(); };
    const command = (id: number, action: string, channelId: string, expires = Date.now() + 1000) => {
        state.commands.push({ id, action, channelId, expires }); emit();
    };
    return { state, snapshots, completions, selections, declines, emit, command, plugin: env.plugin, listeners,
        fail: () => { failures++; }, hangDecline: () => { hangDecline = true; }, maxConcurrent: () => maxConcurrent };
}

test('renderer events filter incoming DM/group calls and require RTC confirmation', async t => {
    const h = harness(t); h.plugin.start(); await until(() => h.snapshots.length > 0);
    h.state.calls = [
        { channelId: '123', ringing: ['99'] }, { channelId: '456', ringing: ['99'] },
        { channelId: '777', ringing: ['99'] }, { channelId: '888', ringing: ['88'] },
        { channelId: '999', ringing: ['99'], unavailable: true }
    ]; h.emit();
    await until(() => h.snapshots.at(-1).incoming.length === 2);
    assert.deepEqual(Array.from(h.snapshots.at(-1).incoming), ['123', '456']);
    h.state.selected = '456'; h.state.channel = '456'; h.state.rtc = 'RTC_CONNECTING'; h.emit();
    await until(() => h.snapshots.at(-1).voice === 'connecting'); assert.equal(h.snapshots.at(-1).connected, null);
    h.state.rtc = 'RTC_CONNECTED'; h.emit(); await until(() => h.snapshots.at(-1).connected === '456');
    h.state.rtc = 'NO_ROUTE'; h.emit(); await until(() => h.snapshots.at(-1).voice === 'error');
    assert.equal(h.snapshots.at(-1).connected, null);
});

test('renderer captures targets, handles Answer/Hang Up, decline recipient and expired commands', async t => {
    const h = harness(t); h.state.calls = [{ channelId: '123', ringing: ['99'] }];
    h.plugin.start(); await until(() => h.snapshots.length > 0);
    h.command(1, 'answer', '123'); await until(() => h.completions.length === 1);
    assert.deepEqual(h.selections, ['123']); assert.equal(h.snapshots.at(-1).connected, null);
    h.state.selected = '123'; h.state.channel = '123'; h.state.rtc = 'RTC_CONNECTING';
    h.command(2, 'hangup', '123'); await until(() => h.completions.length === 2);
    assert.deepEqual(h.selections, ['123', null]);
    h.command(3, 'decline', '123'); await until(() => h.completions.length === 3);
    assert.equal(h.declines[0].url, '/channels/123/call/stop-ringing');
    assert.deepEqual(Array.from(h.declines[0].body.recipients), ['99']);
    h.command(4, 'answer', '456'); h.command(5, 'hangup', '123', Date.now() - 1);
    await until(() => h.completions.length === 5);
    assert.deepEqual(h.completions.slice(-2), [{ id: 4, ok: false }, { id: 5, ok: false }]);
    assert.equal(h.maxConcurrent(), 1);
});

test('renderer retries transient exchange failures and cleans listeners across restart', async t => {
    const h = harness(t); h.plugin.start(); await until(() => h.snapshots.length > 0);
    h.fail(); h.emit(); await delay(30);
    const before = h.snapshots.length; await until(() => h.snapshots.length > before);
    h.plugin.stop(); assert.equal(h.listeners.size, 0);
    await delay(30); const stopped = h.snapshots.length; await delay(250); assert.equal(h.snapshots.length, stopped);
    h.state.user = ''; h.plugin.start(); await until(() => h.snapshots.length > stopped);
    assert.equal(h.snapshots.at(-1).voice, 'unknown'); assert.equal(h.maxConcurrent(), 1);
});

test('unresponsive Discord action has uncertain outcome and cannot stall reconciliation forever', async t => {
    const h = harness(t); h.state.calls = [{ channelId: '123', ringing: ['99'] }]; h.hangDecline();
    h.plugin.start(); await until(() => h.snapshots.length > 0);
    h.command(1, 'decline', '123', Date.now() + 60);
    await until(() => h.completions.length === 1);
    assert.deepEqual(h.completions[0], { id: 1, ok: false, uncertain: true });
    const before = h.snapshots.length; h.emit(); await until(() => h.snapshots.length > before);
});
