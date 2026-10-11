# Validation

## Live results reported by the author — 11 October 2026

- Windows Stream Deck companion installed and used with official Discord + custom Vencord.
- Incoming-call Answer works.
- Decline works.
- All three Stream Deck actions are reported working as intended.
- Hang Up works; earlier server voice-channel Hang Up also reported working.
- Updated Vencord build restores ServerInfo Friends and retains CallDeck functionality.

Exact Discord, Stream Deck and updated Vencord commit versions were not recorded. This repository packages the existing local CallDeck source; the source on the author's Windows PC was not byte-compared against it. Live results are reported observations, not independent testing by the packaging environment.

Not yet separately documented: caller-side effects of Decline, incoming group calls, simultaneous calls, sleep/wake, Vesktop on the updated source and hardware animation details.

## Automated packaging checks — 11 October 2026

Run using Node 24.19.0:

- Native bridge tests: 6 passed, 0 failed.
- Stream Deck companion tests: 4 passed, 0 failed.
- Official Elgato CLI 1.10.1 manifest validation: passed.
- CallDeck executable source is unchanged from the existing local source package.

No new Windows runtime tests or current Vencord TypeScript/build checks were performed in this packaging environment. Windows installation instructions were reviewed, not executed here.

## Earlier Vencord integration checks

The original implementation passed TypeScript, ESLint, desktop and standalone builds against Vencord commit `3374b8a9d8f6b051c64204917360293aad7f5d75` (1.15.10) on 6 October 2026. That is historical build evidence, not the current recommended Vencord checkout. See [the original record](vencord/VALIDATION.md).
