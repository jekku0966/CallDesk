/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 NKS
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";

export type Action = "answer" | "decline" | "hangup";
export interface Status { incoming: string[]; connected: string | null; }
export interface Command { id: number; action: Action; channelId: string; expires: number; }
const validId = (id: unknown): id is string => typeof id === "string" && /^\d{1,22}$/.test(id);

export class Bridge {
    private server?: Server;
    private status: Status = { incoming: [], connected: null };
    private heartbeat = 0;
    private nextId = 0;
    private queued: Command[] = [];
    private pending = new Map<number, { response: ServerResponse; timer: ReturnType<typeof setTimeout>; }>();

    async start(port: number, token: string) {
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port");
        if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Set a 64-character hexadecimal access token first");
        await this.stop();
        const server = createServer((req, res) => {
            const send = (code: number, value: unknown) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
            // Literal Host prevents DNS rebinding. Browser requests are never allowed.
            if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin || req.headers["sec-fetch-site"]) return send(403, { error: "Forbidden client" });
            const supplied = req.headers.authorization;
            const expected = `Bearer ${token}`;
            if (typeof supplied !== "string" || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return send(401, { error: "Unauthorized" });
            if (Date.now() - this.heartbeat > 3000) return send(503, { error: "Discord renderer unavailable" });
            if (req.url === "/status" && req.method === "GET") return send(200, { state: this.status.incoming.length ? "ringing" : this.status.connected ? "connected" : "idle", incoming: this.status.incoming, connected: this.status.connected });
            if (!["/answer", "/decline", "/hangup"].includes(req.url ?? "")) return send(404, { error: "Unknown endpoint" });
            if (req.method !== "POST") return send(405, { error: "Use POST" });
            if (req.headers["transfer-encoding"] || (req.headers["content-length"] && req.headers["content-length"] !== "0")) return send(400, { error: "Request body must be empty" });
            if (this.pending.size) return send(409, { error: "Another action is pending" });
            const action = req.url!.slice(1) as Action;
            const channelId = action === "hangup" ? this.status.connected : this.status.incoming.length === 1 ? this.status.incoming[0] : null;
            if (!channelId) return send(409, { error: "No unambiguous target call" });
            if (action === "answer" && this.status.connected && this.status.connected !== channelId) return send(409, { error: "Already connected to another voice channel" });
            const id = ++this.nextId;
            const timer = setTimeout(() => { this.pending.delete(id); this.queued = this.queued.filter(c => c.id !== id); send(504, { error: "Action timed out; inspect Discord before retrying" }); }, 5000);
            this.pending.set(id, { response: res, timer });
            this.queued.push({ id, action, channelId, expires: Date.now() + 4500 });
            res.on("close", () => { const item = this.pending.get(id); if (item) clearTimeout(item.timer); this.pending.delete(id); this.queued = this.queued.filter(c => c.id !== id); });
        });
        server.requestTimeout = 6000;
        server.headersTimeout = 6000;
        server.maxConnections = 16;
        await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
        server.on("error", () => { this.heartbeat = 0; });
        this.server = server;
    }

    exchange(status: Status): Command[] {
        if (!status || !Array.isArray(status.incoming) || status.incoming.length > 100 || !status.incoming.every(validId) || !(status.connected === null || validId(status.connected))) throw new Error("Invalid status");
        this.status = { incoming: [...new Set(status.incoming)], connected: status.connected };
        this.heartbeat = Date.now();
        const commands = this.queued;
        this.queued = [];
        return commands;
    }

    complete(id: number, ok: boolean) {
        const item = this.pending.get(id);
        if (!item) return;
        clearTimeout(item.timer);
        this.pending.delete(id);
        item.response.writeHead(ok ? 200 : 409, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        item.response.end(JSON.stringify(ok ? { ok: true, result: "Action dispatched; check /status for state" } : { error: "Call changed or Discord action failed" }));
    }

    async stop() {
        this.heartbeat = 0;
        this.queued = [];
        for (const { response, timer } of this.pending.values()) { clearTimeout(timer); response.writeHead(503); response.end('{"error":"Bridge stopped"}'); }
        this.pending.clear();
        const { server } = this;
        this.server = undefined;
        if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    }
}
