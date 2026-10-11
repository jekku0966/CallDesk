/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 NKS
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

import { Bridge, type Status } from "./bridge";
const bridge = new Bridge();
export const startBridge = (_event: IpcMainInvokeEvent, port: number, token: string) => bridge.start(port, token);
export const stopBridge = (_event: IpcMainInvokeEvent) => bridge.stop();
export const exchange = (_event: IpcMainInvokeEvent, status: Status) => bridge.exchange(status);
export const complete = (_event: IpcMainInvokeEvent, id: number, ok: boolean) => bridge.complete(id, ok);
