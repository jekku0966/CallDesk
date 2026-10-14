# Validation — original checks from 2026-10-06

**Update — 11 October 2026:** the author reports successful Windows installation and live testing of all three Stream Deck actions: Answer, Decline and Hang Up. The record below preserves the earlier packaging checks; see [the current validation record](../VALIDATION.md) for subsequent results.

**Update — 14 October 2026:** store-triggered snapshots, RTC confirmation, long polling and command confirmation guards are covered by 13 native bridge tests and 4 renderer simulation tests. See [the current validation record](../VALIDATION.md) for integration checks and the manual checklist. Earlier live results do not validate this change.

Vencord checkout: `3374b8a9d8f6b051c64204917360293aad7f5d75` (package version 1.15.10).
Runtime: Node 24.19.0; pnpm 11.25.0.

Passed:
- Six native bridge integration tests: authorization, Origin/Host checks, unavailable renderer, HTTP methods, empty bodies, ambiguous calls, occupied voice channel, pending-action serialization, renderer acknowledgment, shutdown, timeout removal, stale heartbeat, status validation.
- Vencord TypeScript check with plugin included.
- Vencord desktop and standalone builds with plugin included.
- ESLint for the exact packaged plugin files: zero errors and warnings after correcting headers.
- PNG/GIF decoding, 144 × 144 dimensions, animation frames and infinite-loop metadata checked. Actual Stream Deck rendering remains untested.

Not tested here: Windows PowerShell scripts (reviewed only), Elgato HTTP action configuration, real Discord DM/group calls, actual decline semantics, voice connection establishment, Vesktop runtime, client modification account-policy outcomes. The archive is an alpha userplugin source release, not an upstream-approved plugin or verified daily driver.

Primary implementation references:
- https://docs.vencord.dev/plugins/native/
- https://docs.vencord.dev/installing/custom-plugins/
- https://github.com/Vendicated/Vencord/blob/3374b8a9d8f6b051c64204917360293aad7f5d75/packages/discord-types/src/stores/CallStore.d.ts
- https://github.com/Vendicated/Vencord/blob/3374b8a9d8f6b051c64204917360293aad7f5d75/packages/discord-types/src/stores/SelectedChannelStore.d.ts
- https://github.com/Vendicated/Vencord/blob/3374b8a9d8f6b051c64204917360293aad7f5d75/src/plugins/userVoiceShow/components.tsx

`CallStore`, `selectVoiceChannel`, and the stop-ringing REST endpoint are Discord internals; types/build success do not prove runtime behavior. No third-party plugin code was copied. GPL license text is included from Vencord; implementation is original.
