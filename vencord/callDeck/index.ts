/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 NKS
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { CallStore, ChannelStore, MessageStore, RestAPI, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import type { Command, Status } from "./bridge";
import { callDisplay } from "./display";
import { voiceStatus } from "./state";

const Native = VencordNative.pluginHelpers.CallDeck as PluginNative<typeof import("./native")>;
const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");
const RTCStore = findByPropsLazy("getRTCConnection", "getLastRTCConnectionState");
const logger = new Logger("CallDeck");
const settings = definePluginSettings({
    port: { type: OptionType.NUMBER, description: "Local HTTP port (1024–65535)", default: 9473, restartNeeded: true },
    accessToken: { type: OptionType.STRING, description: "64-character hex token. Generate with the supplied PowerShell script. This is NOT your Discord token.", default: "", restartNeeded: true }
});
let running = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let lifecycle = Promise.resolve();
let exchanging = false;
let dirty = false;
let failures = 0;

function stateChanged() {
    dirty = true;
    if (!running || exchanging) return;
    clearTimeout(timer);
    timer = setTimeout(() => void poll(generation), 0);
}

function readStatus(): Status {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return { incoming: [], connected: null, selected: null, voice: "unknown" };
    const status = voiceStatus(
        CallStore.getCalls().filter(call => !call.unavailable && call.ringing.includes(userId) && [1, 3].includes(ChannelStore.getChannel(call.channelId)?.type)).map(call => call.channelId),
        SelectedChannelStore.getVoiceChannelId() ?? null, RTCStore.getChannelId() ?? null, RTCStore.getState()
    );
    // Identity failures must not break the established call controls or heartbeat.
    try {
        status.display = callDisplay(status.incoming, status.selected ?? null, userId, {
            channel: id => ChannelStore.getChannel(id), user: id => UserStore.getUser(id),
            voices: id => VoiceStateStore.getVoiceStatesForChannel(id),
            caller: id => {
                const messageId = CallStore.getCall(id)?.messageId;
                return messageId ? MessageStore.getMessage(id, messageId)?.author?.id : undefined;
            }
        });
    } catch { status.display = null; }
    return status;
}

async function execute(command: Command) {
    if (!running || command.expires < Date.now()) return false;
    const status = readStatus();
    if (command.action === "hangup") {
        if (status.selected !== command.channelId) return false;
        await VoiceActions.selectVoiceChannel(null);
    } else {
        if (!status.incoming.includes(command.channelId)) return false;
        if (command.action === "answer") {
            if (status.selected) return false;
            await VoiceActions.selectVoiceChannel(command.channelId);
        } else {
            // Suppress only our ringing; never stop ringing for every recipient.
            await RestAPI.post({ url: `/channels/${command.channelId}/call/stop-ringing`, body: { recipients: [UserStore.getCurrentUser().id] } });
        }
    }
    return true;
}

async function poll(epoch: number) {
    if (!running || epoch !== generation) return;
    if (exchanging) { timer = setTimeout(() => void poll(epoch), 200); return; }
    exchanging = true; dirty = false;
    try {
        const commands = await Native.exchange(readStatus());
        failures = 0;
        for (const command of commands) {
            if (!running || epoch !== generation) break;
            let ok = false;
            let uncertain = false;
            let deadline: ReturnType<typeof setTimeout> | undefined;
            try {
                ok = await Promise.race([
                    execute(command),
                    new Promise<boolean>(resolve => { deadline = setTimeout(() => { uncertain = true; resolve(false); }, Math.max(0, command.expires - Date.now())); })
                ]);
            } catch { logger.error("Discord call action failed. Check compatibility with this Discord build."); }
            finally { clearTimeout(deadline); }
            if (running && epoch === generation) await Native.complete(command.id, ok, uncertain);
        }
    } catch {
        failures++;
        if (failures === 1) logger.error("CallDeck state exchange failed; retrying. Check compatibility if it persists.");
    } finally { exchanging = false; }
    if (running && epoch === generation) timer = setTimeout(() => void poll(epoch), failures ? Math.min(5000, 200 * 2 ** Math.min(failures, 5)) : dirty ? 0 : 200);
}

async function startBridge(epoch: number) {
    if (epoch !== generation) return;
    try {
        await Native.startBridge(settings.store.port, settings.store.accessToken);
        if (epoch !== generation) { await Native.stopBridge(); return; }
        running = true;
        for (const store of [CallStore, SelectedChannelStore, ChannelStore, UserStore, RTCStore, VoiceStateStore, MessageStore]) store.addChangeListener(stateChanged);
        failures = 0;
        void poll(epoch);
    } catch {
        if (epoch !== generation) return;
        failures++;
        if (failures === 1) logger.error("Could not start CallDeck. Check the access token and port; retrying.");
        timer = setTimeout(() => {
            lifecycle = lifecycle.catch(() => {}).then(() => startBridge(epoch));
        }, Math.min(5000, 500 * 2 ** Math.min(failures - 1, 4)));
    }
}

export default definePlugin({
    name: "CallDeck",
    description: "Answer, decline and hang up Discord calls through an authenticated localhost bridge for Stream Deck.",
    authors: [{ name: "NKS", id: 0n }], // Replace with your public Discord user ID before upstream submission.
    settings,
    start() {
        const epoch = ++generation;
        failures = 0;
        lifecycle = lifecycle.catch(() => {}).then(() => startBridge(epoch));
    },
    stop() {
        ++generation;
        running = false;
        for (const store of [CallStore, SelectedChannelStore, ChannelStore, UserStore, RTCStore, VoiceStateStore, MessageStore]) store.removeChangeListener(stateChanged);
        clearTimeout(timer);
        lifecycle = lifecycle.catch(() => {}).then(() => Native.stopBridge());
    }
});
