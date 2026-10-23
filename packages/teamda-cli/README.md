# @ax/teamda-cli

`teamda`, a command line client for the teamda public API. Every command comes from the OpenAPI
spec; none is written by hand. Runs under bun, no runtime dependencies.

## Commands

- Spec commands: `teamda <x-cli words...> [--param value] [--json body|@file] [--dry-run] [--idempotency-key k] [--out file]`
- `teamda help` lists commands as text, `teamda help --json` as one JSON object (`cli method path scope summary` per command), `teamda help crm` filters by prefix
- `teamda sync` downloads `/api/public/v1/openapi.json` and caches it only when its sha256 changed
- `teamda api <METHOD> <path> [--json body]` is the raw escape hatch; a path not starting with `/api/` is relative to `/api/public/v1`
- `teamda auth login --key-file <path>` or `--key-file -` (stdin), `teamda auth status`, `teamda auth logout`
- `teamda config set base-url <url>`, `teamda config get`

## How a command becomes a request

- Each operation with `x-cli` is one command; words are the `x-cli` value, longest match wins (`gpu quote list` before `gpu quote`)
- Path params such as `{id}` come from `--id` or from positionals after the command words, in order
- GET, and any operation without a request body, sends the remaining flags as query parameters
- Otherwise the body is `--json` merged with the flags; flags win
- When the body schema names its fields, an unknown flag is a usage error; an open schema takes any flag
- Server actions (`POST /api/public/v1/actions/<name>`) take named flags (`x-args`) or leftover positionals as the `args` array
- Flag values are strings; a value starting with `{` or `[` is parsed as JSON; use `--json` when a number or boolean matters
- `--dry-run` adds `dryRun=1`; `--idempotency-key` becomes the `Idempotency-Key` header
- `--out <path>` is never sent; when the response is a file (PDF, image) its bytes are written there unchanged

```sh
teamda crm quote get q_123
teamda crm quote approve q_123 --idempotency-key 7f1c
teamda crm company create --json @company.json --dry-run
teamda api GET crm/quotes --limit 5
teamda crm quote export q_123 --format pdf --out quote.pdf
```

## Output contract

- Success: exactly one JSON value on stdout (the response body as the server sent it), exit 0
- File response: the bytes go to `--out <path>` and stdout gets `{"file","bytes","contentType"}`; without `--out` it is a usage error (`out_required`, exit 2)
- Failure: one envelope on stderr, `{"error":{"code","message","status","requiredScope","approvalId"}}`, fields present only when known

| Exit | Meaning |
|---|---|
| 0 | ok |
| 1 | unknown: unexpected client failure, network failure or timeout (no HTTP status) |
| 2 | input: unknown command, missing value, secret on argv, HTTP 400 or 422, other 4xx (405 410 413 ...) |
| 3 | auth or scope: no key, 401, 403 |
| 4 | not found (404) |
| 5 | version conflict (409) |
| 6 | rate limited (429) |
| 7 | approval required (202, `approvalId` in the envelope) |
| 8 | server error (5xx) |
| 9 | saved value mismatch (reserved, no command checks it yet) |

No call is retried yet; 429 and 5xx exit on the first response.

The table is exported as `EXIT`:

```ts
import { EXIT, buildCommandTree } from '@ax/teamda-cli'
```

Headers sent on every call: `X-API-Key`, `X-Agent: teamda/<version>`, `X-Request-Id` (random uuid), `Idempotency-Key` when given.

## Keys

- A key is read only from a file or stdin; `--key`, `--api-key`, `--token`, `--secret`, `--password` are refused with exit 2 because argv is visible in `ps` and shell history
- Stored in the OS credential store, never in a plain file; the config file holds the base URL only
- macOS: `security -i` with the command on stdin, so the key is never on a process argv. `security add-generic-password -w <key>` would expose it in `ps` for a moment, and `-w` without a value prompts on a TTY, which an agent cannot answer
- Windows: PowerShell calling `CredWrite` and `CredRead` in advapi32, key passed on stdin
- Linux: `secret-tool store`, key passed on stdin; needs a running keyring
- `TEAMDA_API_KEY` is accepted for CI and wins over the store
- Output shows at most the first 12 characters; any full occurrence of the key in output is replaced

## Environment

| Variable | Use |
|---|---|
| `TEAMDA_BASE_URL` | server origin, wins over `config set base-url` |
| `TEAMDA_API_KEY` | key for CI |
| `TEAMDA_CONFIG_DIR` | config directory, default `~/.config/teamda` or `%APPDATA%\teamda` |
| `TEAMDA_TIMEOUT_MS` | request timeout, default 30000 |
| `TEAMDA_CREDENTIAL_BACKEND` | `macos` `windows` `linux` `memory`; `memory` is for tests and forgets on exit |

## Spec sources

- `src/generated/spec.json` is a copy of `apps/web/lib/actions/generated/openapi.json`, written by `bun scripts/embed-spec.ts` and embedded at build time
- A spec cached by `teamda sync` (`<config dir>/spec.json` plus `spec.sha256`) wins over the embedded one
- A synced spec with no `x-cli` operation is refused and the cache is left as it was

## Build and test

```sh
pnpm test         # bun test
pnpm build        # dist/teamda for this machine
pnpm build:win    # dist/teamda.exe for Windows x64
```

Run them inside `packages/teamda-cli`. `dist/` is ignored by git.
