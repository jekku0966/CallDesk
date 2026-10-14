import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avatarUrl, callDisplay, validDisplay } from '../callDeck/display.ts';
const avatar = 'https://cdn.discordapp.com/avatars/123/abcdef.png?size=128';
const stores = (type: number, ids: string[] = []) => ({
    channel: () => ({ type, name: 'The crew', recipients: ['99', '123'], getRecipientId: () => '123' }),
    user: (id: string) => ({ id, username: 'user' + id, globalName: id === '123' ? 'Alex' : undefined, getAvatarURL: () => avatar }),
    voices: () => Object.fromEntries(ids.map(id => [id, { userId: id, channelId: '456' }])),
    caller: () => '123'
});
test('idle and ambiguous calls have no invented identity; incoming DM and active DM use counterpart', () => {
    assert.equal(callDisplay([], null, '99', stores(1)), null);
    assert.equal(callDisplay(['456', '789'], null, '99', stores(1)), null);
    const incoming = callDisplay(['456'], null, '99', stores(1))!;
    assert.equal(incoming.name, 'Alex'); assert.equal(incoming.participants[0].id, '123'); assert.equal(incoming.kind, 'dm');
    assert.deepEqual(callDisplay([], '456', '99', stores(1)), incoming);
});
test('group portraits use voice participants, count everyone, cap four, prioritize known initiator', () => {
    const s = stores(3, ['99','111','222','333','123','444','555']);
    const d = callDisplay(['456'], null, '99', s)!;
    assert.equal(d.total, 7); assert.equal(d.participants.length, 4); assert.equal(d.participants[0].id, '123');
    assert.ok(d.participants.every(p => ['99','111','222','333','123','444','555'].includes(p.id)));
    const fallback = callDisplay(['456'], null, '99', stores(3))!;
    assert.equal(fallback.total, 0); assert.equal(fallback.participants[0].id, '123', 'caller fallback does not invent count');
    const absent = callDisplay([], '456', '99', stores(3))!;
    assert.equal(absent.participants.length, 0, 'active group without voice data does not list chat recipients');
});
test('server voice and unavailable user data retain usable placeholders', () => {
    const d = callDisplay([], '456', '99', stores(2, ['99','123']))!;
    assert.equal(d.kind, 'server'); assert.equal(d.name, 'The crew');
    const missing = callDisplay(['456'], null, '99', { ...stores(1), user: () => undefined })!;
    assert.equal(missing.name, 'Unknown'); assert.equal(missing.participants[0].avatar, null);
});
test('avatar and metadata validation reject external URLs, credentials, redirects and oversized data', () => {
    assert.equal(avatarUrl(avatar), avatar);
    for (const url of ['http://cdn.discordapp.com/avatars/123/a.png', 'https://evil.test/a.png',
        'https://cdn.discordapp.com@evil.test/avatars/123/a.png', 'https://cdn.discordapp.com:443/avatars/123/a.png?url=x',
        'https://cdn.discordapp.com/avatars/123/a.png?size=9999', 'https://cdn.discordapp.com/avatars/123/a.svg']) assert.equal(avatarUrl(url), null);
    const d = callDisplay(['456'], null, '99', stores(1))!;
    assert.equal(validDisplay(d), true); assert.equal(validDisplay({ ...d, total: -1 }), false);
    assert.equal(validDisplay({ ...d, name: 'x'.repeat(81) }), false);
});
