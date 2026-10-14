/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 NKS
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";

import type { CallDisplay } from "./display";

export type Action = "answer" | "decline" | "hangup";
export interface Status { incoming: string[]; connected: string | null; selected?: string | null; voice?: "idle" | "connecting" | "connected" | "error" | "unknown"; display?: CallDisplay | null; }
export interface Command { id: number; action: Action; channelId: string; expires: number; }
const validId = (id: unknown): id is string => typeof id === "string" && /^\d{1,22}$/.test(id);
const validDisplay = (d: CallDisplay | null) => d === null || (d && validId(d.channelId) && ["dm", "group", "server"].includes(d.kind)
    && typeof d.name === "string" && d.name.length <= 80 && Number.isInteger(d.total) && d.total >= 0 && d.total <= 1000
    && Array.isArray(d.participants) && d.participants.length <= 4 && d.participants.every(p => p && validId(p.id)
        && typeof p.name === "string" && p.name.length <= 80 && (p.avatar === null || (typeof p.avatar === "string" && p.avatar.length <= 300
            && /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/(avatars\/\d{1,22}\/[a-zA-Z0-9_]+\.png|embed\/avatars\/[0-5]\.png)(\?size=(64|128|256))?$/.test(p.avatar))))
    && new Set(d.participants.map(p => p.id)).size === d.participants.length);

export class Bridge {
    private server?: Server;
    private status: Status = { incoming: [], connected: null };
    private heartbeat = 0;
    private nextId = 0;
    private queued: Command[] = [];
    private pending = new Map<number, { response: ServerResponse; timer: ReturnType<typeof setTimeout>; }>();
    private session = randomUUID();
    private revision = 0;
    private waiters = new Map<ServerResponse, ReturnType<typeof setTimeout>>();
    private watchdog?: ReturnType<typeof setInterval>;
    private operation: { action: Action; channelId: string; expires: number; } | null = null;
    private operationError: string | null = null;

    private snapshot() {
        const voice = this.status.voice ?? (this.status.connected ? "connected" : "idle");
        const phase = this.operation?.action === "answer" ? "answer-requested" : this.operation?.action === "hangup" ? "disconnecting" : voice;
        return { ...this.status, state: this.status.incoming.length ? "ringing" : voice === "connected" ? "connected" : "idle",
            phase, operation: this.operation?.action ?? null, operationChannelId: this.operation?.channelId ?? null,
            error: this.operationError, session: this.session, revision: this.revision, longPoll: true };
    }

    private flush(code = 200) {
        for (const [response, timer] of this.waiters) {
            clearTimeout(timer);
            response.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            response.end(JSON.stringify(code === 200 ? this.snapshot() : { error: "Discord renderer unavailable" }));
        }
        this.waiters.clear();
    }

    private changed() { this.revision++; this.flush(Date.now() - this.heartbeat > 3000 ? 503 : 200); }

    async start(port: number, token: string) {
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port");
        if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Set a 64-character hexadecimal access token first");
        await this.stop();
        this.session = randomUUID(); this.revision = 0;
        this.status = { incoming: [], connected: null };
        this.operation = null; this.operationError = null;
        const server = createServer((req, res) => {
            const send = (code: number, value: unknown) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
            // Literal Host prevents DNS rebinding. Browser requests are never allowed.
            if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin || req.headers["sec-fetch-site"]) return send(403, { error: "Forbidden client" });
            const supplied = req.headers.authorization;
            const expected = `Bearer ${token}`;
            if (typeof supplied !== "string" || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return send(401, { error: "Unauthorized" });
            if (Date.now() - this.heartbeat > 3000) return send(503, { error: "Discord renderer unavailable" });
            let url: URL;
            try { url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`); }
            catch { return send(400, { error: "Invalid URL" }); }
            if (url.pathname === "/status" && req.method === "GET") {
                if (url.searchParams.get("session") !== this.session || url.searchParams.get("revision") !== String(this.revision)) return send(200, this.snapshot());
                if (this.waiters.size >= 8) return send(429, { error: "Too many status observers" });
                const timer = setTimeout(() => {
                    this.waiters.delete(res); send(200, this.snapshot());
                }, 20000);
                this.waiters.set(res, timer);
                res.on("close", () => { clearTimeout(timer); this.waiters.delete(res); });
                return;
            }
            if (!["/answer", "/decline", "/hangup"].includes(req.url ?? "")) return send(404, { error: "Unknown endpoint" });
            if (req.method !== "POST") return send(405, { error: "Use POST" });
            if (req.headers["transfer-encoding"] || (req.headers["content-length"] && req.headers["content-length"] !== "0")) return send(400, { error: "Request body must be empty" });
            if (this.pending.size) return send(409, { error: "Another action is pending" });
            const action = req.url!.slice(1) as Action;
            // Hang Up remains valid while Answer is connecting; duplicate or incompatible requests do not.
            if (this.operation && !(action === "hangup" && this.operation.action === "answer")) return send(409, { error: "Waiting for Discord state confirmation" });
            const selected = this.status.selected === undefined ? this.status.connected : this.status.selected;
            const channelId = action === "hangup" ? selected : this.status.incoming.length === 1 ? this.status.incoming[0] : null;
            if (!channelId) return send(409, { error: "No unambiguous target call" });
            if (action === "answer" && selected) return send(409, { error: "Already in or joining a voice channel" });
            const id = ++this.nextId;
            const timer = setTimeout(() => { this.pending.delete(id); this.queued = this.queued.filter(c => c.id !== id); send(504, { error: "Action timed out; inspect Discord before retrying" }); }, 5000);
            const command = { id, action, channelId, expires: Date.now() + 4500 };
            this.operation = { action, channelId, expires: Date.now() + 10000 }; this.operationError = null;
            this.pending.set(id, { response: res, timer });
            this.queued.push(command); this.changed();
            res.on("close", () => { const item = this.pending.get(id); if (item) clearTimeout(item.timer); this.pending.delete(id); this.queued = this.queued.filter(c => c.id !== id); });
        });
        server.requestTimeout = 6000;
        server.headersTimeout = 6000;
        server.maxConnections = 16;
        await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
        server.on("error", () => { this.heartbeat = 0; });
        this.server = server;
        this.watchdog = setInterval(() => {
            if (Date.now() - this.heartbeat > 3000) this.flush(503);
            if (this.operation && Date.now() >= this.operation.expires) {
                this.operation = null; this.operationError = "Discord state confirmation timed out; inspect Discord before retrying"; this.changed();
            }
        }, 500);
    }

    exchange(status: Status): Command[] {
        if (!status || !Array.isArray(status.incoming) || status.incoming.length > 100 || !status.incoming.every(validId) || !(status.connected === null || validId(status.connected))
            || !(status.selected === undefined || status.selected === null || validId(status.selected))
            || !(status.voice === undefined || ["idle", "connecting", "connected", "error", "unknown"].includes(status.voice))
            || !(status.display === undefined || validDisplay(status.display))) throw new Error("Invalid status");
        const next: Status = { incoming: [...new Set(status.incoming)].sort(), connected: status.connected,
            ...(status.selected !== undefined ? { selected: status.selected } : {}), ...(status.voice !== undefined ? { voice: status.voice } : {}),
            ...(status.display !== undefined ? { display: status.display === null ? null : { ...status.display, participants: status.display.participants.map(p => ({ ...p })) } } : {}) };
        const changed = JSON.stringify(next) !== JSON.stringify(this.status);
        this.status = next;
        this.heartbeat = Date.now();
        const op = this.operation;
        const selected = status.selected === undefined ? status.connected : status.selected;
        const settled = op && (op.action === "answer" ? status.connected === op.channelId || status.voice === "error"
            : op.action === "decline" ? !status.incoming.includes(op.channelId) : selected === null && status.connected === null);
        if (settled) { this.operation = null; this.operationError = status.voice === "error" ? "Discord voice connection failed" : null; }
        if (changed || settled) this.changed();
        const commands = this.queued;
        this.queued = [];
        return commands;
    }

    complete(id: number, ok: boolean, uncertain = false) {
        const item = this.pending.get(id);
        if (!item) return;
        clearTimeout(item.timer);
        this.pending.delete(id);
        if (!ok) {
            if (!uncertain) this.operation = null;
            this.operationError = uncertain ? "Action timed out; inspect Discord before retrying" : "Call changed or Discord action failed";
            this.changed();
        }
        item.response.writeHead(ok ? 200 : uncertain ? 504 : 409, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        item.response.end(JSON.stringify(ok ? { ok: true, result: "Action dispatched; check /status for state" } : { error: this.operationError }));
    }

    async stop() {
        this.heartbeat = 0;
        clearInterval(this.watchdog); this.watchdog = undefined;
        this.flush(503); this.operation = null;
        this.queued = [];
        for (const { response, timer } of this.pending.values()) { clearTimeout(timer); response.writeHead(503); response.end('{"error":"Bridge stopped"}'); }
        this.pending.clear();
        const { server } = this;
        this.server = undefined;
        if (server) await new Promise<void>(resolve => {
            // Give pending acknowledgments a chance to flush before forcing stalled sockets closed.
            const timer = setTimeout(() => server.closeAllConnections(), 100);
            server.close(() => { clearTimeout(timer); resolve(); });
        });
    }
}
