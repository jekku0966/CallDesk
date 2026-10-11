/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 NKS
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { CallStore, ChannelStore, RestAPI, SelectedChannelStore, UserStore } from "@webpack/common";

import type { Command, Status } from "./bridge";

const Native = VencordNative.pluginHelpers.CallDeck as PluginNative<typeof import("./native")>;
const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");
const logger = new Logger("CallDeck");
const settings = definePluginSettings({
    port: { type: OptionType.NUMBER, description: "Local HTTP port (1024–65535)", default: 9473, restartNeeded: true },
    accessToken: { type: OptionType.STRING, description: "64-character hex token. Generate with the supplied PowerShell script. This is NOT your Discord token.", default: "", restartNeeded: true }
});
let running = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let lifecycle = Promise.resolve();

function readStatus(): Status {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return { incoming: [], connected: null };
    return {
        incoming: CallStore.getCalls().filter(call => !call.unavailable && call.ringing.includes(userId) && [1, 3].includes(ChannelStore.getChannel(call.channelId)?.type)).map(call => call.channelId),
        connected: SelectedChannelStore.getVoiceChannelId() ?? null
    };
}

async function execute(command: Command) {
    if (!running || command.expires < Date.now()) return false;
    const status = readStatus();
    if (command.action === "hangup") {
        if (status.connected !== command.channelId) return false;
        await VoiceActions.selectVoiceChannel(null);
    } else {
        if (!status.incoming.includes(command.channelId)) return false;
        if (command.action === "answer") {
            if (status.connected && status.connected !== command.channelId) return false;
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
    try {
        const commands = await Native.exchange(readStatus());
        for (const command of commands) {
            if (!running || epoch !== generation) break;
            let ok = false;
            try { ok = await execute(command); } catch { logger.error("Discord call action failed. Check compatibility with this Discord build."); }
            await Native.complete(command.id, ok);
        }
    } catch { logger.error("CallDeck bridge unavailable; disable and re-enable the plugin after checking settings."); running = false; void Native.stopBridge(); }
    if (running && epoch === generation) timer = setTimeout(() => void poll(epoch), 200);
}

export default definePlugin({
    name: "CallDeck",
    description: "Answer, decline and hang up Discord calls through an authenticated localhost bridge for Stream Deck.",
    authors: [{ name: "NKS", id: 0n }], // Replace with your public Discord user ID before upstream submission.
    settings,
    start() {
        const epoch = ++generation;
        lifecycle = lifecycle.catch(() => {}).then(async () => {
            if (epoch !== generation) return;
            await Native.startBridge(settings.store.port, settings.store.accessToken);
            if (epoch !== generation) { await Native.stopBridge(); return; }
            running = true;
            void poll(epoch);
        }).catch(() => { logger.error("Could not start CallDeck. Set a valid access token and check whether the port is already in use."); });
    },
    stop() {
        ++generation;
        running = false;
        clearTimeout(timer);
        lifecycle = lifecycle.catch(() => {}).then(() => Native.stopBridge());
    }
});
