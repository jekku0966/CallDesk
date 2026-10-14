/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 NKS
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Person { id: string; name: string; avatar: string | null; }
export interface CallDisplay { channelId: string; kind: "dm" | "group" | "server"; name: string; participants: Person[]; total: number; }

const validId = (id: unknown): id is string => typeof id === "string" && /^\d{1,22}$/.test(id);
const label = (value: string | undefined, fallback: string) => (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || fallback;
export function avatarUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 300) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)
            && !url.username && !url.password && !url.port
            && /^\/(avatars\/\d{1,22}\/[a-zA-Z0-9_]+\.png|embed\/avatars\/[0-5]\.png)$/.test(url.pathname)
            && !url.hash && /^(\?size=(64|128|256))?$/.test(url.search) ? url.href : null;
    } catch { return null; }
}
export function validDisplay(value: unknown): value is CallDisplay | null {
    if (value === null) return true;
    if (!value || typeof value !== "object") return false;
    const d = value as CallDisplay;
    return validId(d.channelId) && ["dm", "group", "server"].includes(d.kind) && typeof d.name === "string" && d.name.length <= 80
        && Number.isInteger(d.total) && d.total >= 0 && d.total <= 1000 && Array.isArray(d.participants) && d.participants.length <= 4
        && d.participants.every(p => p && validId(p.id) && typeof p.name === "string" && p.name.length <= 80 && (p.avatar === null || avatarUrl(p.avatar) !== null))
        && new Set(d.participants.map(p => p.id)).size === d.participants.length;
}

interface DisplayStores {
    channel(id: string): { type: number; name?: string; recipients?: string[]; getRecipientId?(): string | undefined; } | undefined;
    user(id: string): { id: string; globalName?: string; username: string; getAvatarURL(guildId: null, size: number, animate: boolean, format: string): string; } | undefined;
    voices(id: string): Record<string, { userId: string; channelId?: string | null; }>;
    caller(id: string): string | undefined;
}
export function callDisplay(incoming: string[], selected: string | null, self: string, stores: DisplayStores): CallDisplay | null {
    const channelId = incoming.length === 1 ? incoming[0] : selected;
    if (!channelId) return null;
    const channel = stores.channel(channelId);
    if (!channel) return null;
    const kind = channel.type === 1 ? "dm" : channel.type === 3 ? "group" : "server";
    const person = (id: string): Person => {
        const user = stores.user(id);
        let avatar: string | null = null;
        try { avatar = avatarUrl(user?.getAvatarURL(null, 128, false, "png")); } catch { /* Initials remain usable. */ }
        return { id, name: label(user?.globalName || user?.username, "Unknown"), avatar };
    };
    if (kind === "dm") {
        const id = channel.getRecipientId?.() ?? channel.recipients?.find(id => id !== self);
        const p = id && validId(id) && id !== self ? person(id) : null;
        return { channelId, kind, name: p?.name ?? "Direct call", participants: p ? [p] : [], total: p ? 1 : 0 };
    }
    const ids = [...new Set(Object.values(stores.voices(channelId)).filter(v => v.channelId === channelId && validId(v.userId)).map(v => v.userId))].sort();
    const caller = stores.caller(channelId);
    if (caller && ids.includes(caller)) { ids.splice(ids.indexOf(caller), 1); ids.unshift(caller); }
    // A known initiator is a fallback portrait, never an invented participant count.
    const portraits = ids.length ? ids.slice(0, 4) : incoming.includes(channelId) && caller && caller !== self && validId(caller) ? [caller] : [];
    return { channelId, kind, name: label(channel.name, kind === "group" ? "Group call" : "Voice channel"), participants: portraits.map(person), total: Math.min(ids.length, 1000) };
}
