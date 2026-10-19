/* CallDeck — GPL-3.0-or-later */
// Only these bundled layouts may be selected. Never accept a profile path from settings.
const PROFILES = Object.freeze({ 0: 'profiles/CallDeck-Standard', 1: 'profiles/CallDeck-Mini',
    2: 'profiles/CallDeck-XL', 7: 'profiles/CallDeck-Plus', 9: 'profiles/CallDeck-Neo' });
const MARKER = 'calldeck-incoming-v1';
function profileConfig(value = {}) {
    const s = value?.autoSwitch ?? {};
    return { enabled: s.enabled === true,
        deviceIds: Array.isArray(s.deviceIds) ? [...new Set(s.deviceIds.filter(id => typeof id === 'string' && id.length <= 256))].slice(0, 32) : [],
        returnMode: ['after-call', 'after-ringing', 'manual'].includes(s.returnMode) ? s.returnMode : 'after-call',
        delayMs: Number.isInteger(s.delayMs) ? Math.max(0, Math.min(10000, s.delayMs)) : 1000 };
}
class IncomingProfiles {
    constructor(send, timers = { setTimeout, clearTimeout }) {
        this.send = send; this.timers = timers; this.devices = new Map(); this.visible = new Map();
        this.owners = new Map(); this.options = profileConfig(); this.previous = null; this.latest = null;
    }
    configure(value) { this.cancel(); this.options = profileConfig(value); this.previous = null; }
    cancel() {
        for (const owner of this.owners.values()) this.timers.clearTimeout(owner.timer);
        this.owners.clear();
    }
    connect(id, type) { if (typeof id === 'string' && Number.isInteger(type)) this.devices.set(id, type); }
    disconnect(id) {
        this.devices.delete(id); this.drop(id);
        for (const [context, key] of this.visible) if (key.device === id) this.visible.delete(context);
    }
    drop(id) { this.timers.clearTimeout(this.owners.get(id)?.timer); this.owners.delete(id); }
    appear(e) {
        if (e.payload?.settings?.autoProfile !== MARKER) return;
        this.visible.set(e.context, { device: e.device });
        const owner = this.owners.get(e.device);
        if (owner) { owner.confirmed = true; this.timers.clearTimeout(owner.timer); owner.timer = null; this.schedule(e.device, owner); }
    }
    disappear(context) {
        const key = this.visible.get(context); this.visible.delete(context);
        // The SDK has no current-profile API. Losing our final marked key is a departure.
        if (key && !this.isVisible(key.device)) this.drop(key.device);
    }
    isVisible(id) { return [...this.visible.values()].some(key => key.device === id); }
    switch(id, payload) { this.send({ event: 'switchToProfile', device: id, payload }); }
    preview() {
        let requested = 0;
        for (const id of this.options.deviceIds) {
            const profile = PROFILES[this.devices.get(id)];
            if (profile && !this.owners.has(id) && !this.isVisible(id)) { this.switch(id, { profile, page: 0 }); requested++; }
        }
        if (requested) return 'Profile switch requested. Accept installation in Stream Deck if prompted; use Back to return.';
        if (!this.options.deviceIds.length) return 'No saved target device. Select a Stream Deck and click Save & test.';
        if (this.options.deviceIds.some(id => this.isVisible(id))) return 'The CallDeck profile is already visible on a selected device.';
        if (this.options.deviceIds.some(id => this.owners.has(id))) return 'A call profile switch is already pending. Wait, or use Back on the deck.';
        return 'No selected supported device is available. Reconnect it, reselect it and Save & test.';
    }
    back(id) { this.drop(id); if (this.isVisible(id)) this.switch(id, {}); }
    lost() {
        this.latest = null;
        for (const [id, owner] of this.owners) {
            if (!owner.confirmed) { this.drop(id); continue; }
            this.timers.clearTimeout(owner.timer); owner.timer = null;
        }
    }
    ended(owner) {
        const s = this.latest;
        if (!s || s.operation || s.incoming.length) return false;
        if (this.options.returnMode === 'manual') return false;
        if (this.options.returnMode === 'after-ringing') return true;
        // Do not interpret connecting/unknown/error as a completed call.
        return s.connected === null && (s.selected === undefined || s.selected === null)
            && (s.voice === undefined || s.voice === 'idle');
    }
    schedule(id, owner) {
        if (!owner.confirmed) return;
        if (!this.ended(owner)) {
            this.timers.clearTimeout(owner.timer); owner.timer = null; return;
        }
        if (owner.timer) return;
        owner.timer = this.timers.setTimeout(() => {
            owner.timer = null;
            if (this.owners.get(id) === owner && this.isVisible(id) && this.ended(owner)) {
                this.drop(id); this.switch(id, {}); // Omit BOTH profile and page: host restores previous layout.
            }
        }, this.options.delayMs);
    }
    observe(s) {
        this.latest = s;
        const previous = this.previous;
        this.previous = { session: s.session, incoming: [...s.incoming] };
        // First snapshot/restarted bridge establishes a baseline; never replay an existing ring.
        const fresh = previous && previous.session === s.session && s.incoming.length === 1
            && !previous.incoming.includes(s.incoming[0]) && !s.operation;
        if (this.options.enabled && fresh) {
            for (const id of this.options.deviceIds) {
                const profile = PROFILES[this.devices.get(id)];
                if (!profile || this.owners.has(id) || this.isVisible(id)) continue;
                const owner = { call: s.incoming[0], confirmed: false, timer: null };
                this.owners.set(id, owner);
                this.switch(id, { profile, page: 0 });
                // No acknowledgment exists. A rejected/import-pending switch earns no return rights.
                owner.timer = this.timers.setTimeout(() => {
                    owner.timer = null; if (!owner.confirmed) this.drop(id);
                }, 5000);
            }
        }
        for (const [id, owner] of this.owners) this.schedule(id, owner);
    }
}
module.exports = { IncomingProfiles, PROFILES, MARKER, profileConfig };
