# Control Felo from Hermes

Felo supplies 12 MCP tools plus an equivalent terminal client. The Python helper uses only the standard library and connects to a token-protected API on 127.0.0.1. Hermes uses its existing model; Felo does not require an AI API key.

## Setup

1. Open **Felo → Settings → Playback & Audio** and enable **Hermes playback control**.
2. Select **Copy Hermes MCP configuration** and merge the felo entry into the existing mcp_servers section in Hermes config.yaml.
3. Start a new Hermes session so it discovers the updated tools.
4. Keep Felo open or minimized. The helper can launch the installed Felo app when needed.

The bundled helper is resources/hermes/felo-control.py. On this computer Hermes points to E:\apps\fanxmusic\resources\hermes\felo-control.py and loads the skill from C:\Users\farid\Hermes\skills\felo-control\SKILL.md.

## Fast AI workflow

Ask “play Stay by The Kid LAROI”, “pause”, “skip”, “show my queue”, “add another song”, “jump to 1:30”, or “set volume to 40 percent”.

felo_play accepts either query + optional artist, a known song_id, or no arguments to resume. It searches and plays in one MCP call when the match is unambiguous. Ambiguity returns candidate IDs without changing playback. Search ignores case, accents and punctuation and matches words across title, artist and album.

Every mutation returns verified state, warnings and requestId. The AI can answer from that result without another status call. Playing at zero volume returns outputMuted=true and a warning. The helper never raises volume automatically. Player verification cannot prove that Windows speakers are audible.

Explicit song selection restarts that song and preserves the queue, appending new choices. Enqueue adds a song without starting it; queue reads are paginated. Remove only deletes queue entries, never library files, and refuses the currently selected track. Seek uses absolute seconds; seek(0) restarts. Modes set shuffle and repeat explicitly.

## Terminal

From the folder containing the helper, use the Windows wrapper (prefers py -3, then python):

~~~powershell
.\felo-control.cmd status
.\felo-control.cmd search "song title" --artist "artist name"
.\felo-control.cmd play "song title" --artist "artist name"
.\felo-control.cmd play --song-id "returned-id"
.\felo-control.cmd play
.\felo-control.cmd pause
.\felo-control.cmd next
.\felo-control.cmd previous
.\felo-control.cmd seek 90
.\felo-control.cmd volume 40
.\felo-control.cmd queue --offset 0 --limit 20
.\felo-control.cmd enqueue "song title"
.\felo-control.cmd remove "queued-song-id"
.\felo-control.cmd mode --shuffle on --repeat all
~~~

The MCP server uses the mcp subcommand. CLI success is JSON on stdout; failures are JSON on stderr with exit code 1. Named song selection uses stable IDs internally; file paths and the connection token are never returned.

## Reliability and protocol

Commands execute sequentially. Identical request IDs share one in-flight execution and keep their result for 60 seconds; reusing an ID with different arguments is rejected. Queue waiting and execution have deadlines. After a lost response, check status before retrying. The helper does not automatically retry uncertain mutations.

Disabling the Felo setting closes the local API and invalidates the token. The client bypasses system HTTP proxies for local requests. Minimized windows keep the playback bridge responsive.

The stdio helper negotiates supported MCP revisions through 2025-11-25. It returns structured results alongside JSON text, validates arguments at runtime and supplies read-only/idempotence annotations. See the [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## Checks

~~~powershell
node --test scripts/felo-control.test.mjs
py -3.12 scripts/test_felo_control.py
npm run build
hermes mcp test felo
~~~

The Node tests require Node 22.18+ for built-in TypeScript stripping. Regression coverage includes ranking/ambiguity, missing files, concurrent retry deduplication, queued-command cancellation, argument validation and JSON-RPC error handling.

