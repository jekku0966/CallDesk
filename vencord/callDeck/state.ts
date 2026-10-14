/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 NKS
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Status } from "./bridge";

// Selection is a target, not proof that voice transport has connected.
export function voiceStatus(incoming: string[], selected: string | null, rtcChannel: string | null, rtcState: string): Status {
    const connected = rtcState === "RTC_CONNECTED" && selected !== null && rtcChannel === selected ? selected : null;
    const voice = connected ? "connected"
        : rtcState === "NO_ROUTE" ? "error"
            : selected && ["AWAITING_ENDPOINT", "AUTHENTICATING", "CONNECTING", "RTC_CONNECTING", "ICE_CHECKING", "DTLS_CONNECTING"].includes(rtcState) ? "connecting"
                : !selected && ["DISCONNECTED", "RTC_DISCONNECTED"].includes(rtcState) ? "idle" : "unknown";
    return { incoming, connected, selected, voice };
}
