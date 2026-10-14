# Hermes control for Felo — implementation plan

Status: implemented and verified on Windows.

## Goal

Let Hermes control songs already playable in the Felo local library through natural-language requests, while keeping playback in Felo's existing player. Hermes uses its configured model to interpret requests; Felo does not require a separate music AI or provider API key.

## Design

```text
Hermes MCP tools ─┐
                  ├→ token-authenticated localhost API → Electron IPC → Felo player
Terminal client ──┘
```

Felo binds the optional API to `127.0.0.1` on an OS-assigned port and writes a private, per-user connection record. The standard-library Python helper provides both the Hermes stdio MCP server and a terminal client. The renderer bridge maps validated commands to the existing player store and reports audio status back to the main process. The API accepts song IDs, not AI-supplied filesystem paths, and returns sanitized metadata.

## Implemented

- Desktop Settings toggle to enable or disable Hermes playback control and a button to copy a ready-to-merge Hermes MCP configuration.
- Authenticated, loopback-only status, local-song search, play/resume, pause, next, previous, and volume endpoints.
- Electron IPC bridge with sender checks, request IDs, deadlines, duplicate-request protection, listening-room restrictions, and audio-state confirmation.
- Python terminal client and MCP server with twelve validated tools, structured results and clear setup/runtime errors.
- Windows packaging of the helper under `resources/hermes`.
- Setup documentation at `docs/hermes-playback.md` and the reusable Hermes skill at `resources/hermes/skills/felo-control/SKILL.md`.
- Installed the skill into `C:\Users\farid\Hermes\skills\felo-control` and added Felo skill routing to that Hermes home's `AGENTS.md`.
- Configured and enabled the `felo` MCP server in the active Hermes installation.

## Verification

- `npm run build:unpack` completed, including TypeScript checks, Electron/Vite production builds, and Windows unpackaged assembly.
- Confirmed the assembled app contains `resources/hermes/felo-control.py` and the `felo-control` skill.
- `hermes mcp test felo` connected and discovered all twelve tools.
- Eleven regression tests cover search ambiguity, command deduplication/cancellation, input validation and protocol errors.
- A live stdio MCP smoke test verified song search, play, pause, resume, replay, seek, next/previous, queue addition/removal, volume/mute detection, shuffle and repeat. Playback tests ran at zero volume and restored the previous volume afterward.

## Control improvements

The first version required several AI tool turns to search, play and verify; mutation results were often only accepted acknowledgments. Named-song requests now resolve unique matches and return confirmed state in one MCP call. Ambiguous titles return choices without starting music.

Status and command results include player volume, explicit mute warnings and queue/mode details. Song selection preserves the queue and correctly restarts an already selected song. New tools support absolute seeking, queue inspection, adding/removing queued songs, and explicit shuffle/repeat settings. Concurrent retries share one execution, stale queued work expires, and the renderer stays responsive while minimized.

In the local live smoke run, search took 10 ms, named-song search-and-play 552 ms, pause 243 ms and next 463 ms. These are one-run measurements, not guaranteed latency; model inference and initial app launch add time.

## Operational notes

- Use only locally playable library tracks. Search first, compare title/artist/album, and ask the user when results remain ambiguous.
- Hermes uses the verified state returned by successful mutations, without an extra status call. A mute warning must be reported; Windows output audibility remains outside the API's verification.
- Felo must be running; the helper can launch the installed app when the API is unavailable. Closing Felo stops playback.
- Disabling the Settings option removes the connection record and invalidates the current token.
- Hermes MCP configuration changes take effect in a new Hermes chat/session.
