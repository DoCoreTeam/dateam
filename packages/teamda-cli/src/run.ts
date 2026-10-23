/**
 * Entry logic. Returns an exit code; never calls process.exit, so tests run it in-process.
 *
 * Output contract: on success exactly one JSON value on stdout (plain `help` prints text);
 * a file response is written to `--out <path>` and the JSON value describes it;
 * on failure one error envelope `{"error":{...}}` on stderr and a non-zero exit code.
 */
import type { Context } from './context.ts'
import { redact } from './context.ts'
import { parseArgs, rejectSecretFlags, takeFlag } from './args.ts'
import { deliver } from './file-out.ts'
import { resolveKey } from './credentials.ts'
import { CliError, EXIT, usage, type ExitCode } from './exit.ts'
import { buildCommandTree, commandsUnder, loadSpec, resolveCommand } from './spec.ts'
import { helpJson, helpText } from './commands/help.ts'
import { specHash, sync } from './commands/sync.ts'
import { api, auth, config } from './commands/admin.ts'
import { invoke } from './commands/invoke.ts'

const MAX_CANDIDATES = 30

function emitError(ctx: Context, e: CliError, key: string | null): ExitCode {
  const body = Object.fromEntries(Object.entries(e.body).filter(([, v]) => v !== undefined))
  ctx.err(`${redact(JSON.stringify({ error: body }), key)}\n`)
  return e.exit
}

function emitJson(ctx: Context, value: unknown, key: string | null): void {
  ctx.out(`${redact(JSON.stringify(value ?? null), key)}\n`)
}

async function dispatch(ctx: Context, argv: string[], keyRef: { key: string | null }): Promise<ExitCode> {
  rejectSecretFlags(argv)
  const parsed = parseArgs(argv)
  // a built-in flag, never sent to the server: where a file response is written
  const out = takeFlag(parsed.flags, 'out')
  const [first, ...more] = parsed.positionals
  const needKey = async () => {
    keyRef.key = (await resolveKey(ctx))?.key ?? null
    return keyRef.key
  }

  if (first === undefined || first === 'help' || parsed.flags.get('help') === 'true') {
    const { spec, source } = loadSpec(ctx)
    // `help --json crm` parses "crm" as the flag value; treat it as a filter word
    const jsonFlag = parsed.flags.get('json')
    const words = first === 'help' ? more : parsed.positionals
    const filter = jsonFlag && jsonFlag !== 'true' ? [...words, jsonFlag] : words
    const h = helpJson(buildCommandTree(spec), source, specHash(ctx, source, spec), filter)
    if (jsonFlag !== undefined) emitJson(ctx, h, null)
    else ctx.out(helpText(h))
    return EXIT.OK
  }
  if (first === 'sync' && more.length === 0) { emitJson(ctx, await sync(ctx, await needKey()), keyRef.key); return EXIT.OK }
  if (first === 'auth') {
    const result = await auth(ctx, more[0], parsed)
    emitJson(ctx, result, null)
    return EXIT.OK
  }
  if (first === 'config') { emitJson(ctx, config(ctx, more), null); return EXIT.OK }
  if (first === 'api') { emitJson(ctx, deliver(await api(ctx, more, parsed, await needKey()), out), keyRef.key); return EXIT.OK }

  const { spec } = loadSpec(ctx)
  const tree = buildCommandTree(spec)
  const hit = resolveCommand(tree, parsed.positionals)
  if (!hit) {
    const under = commandsUnder(tree, parsed.positionals).slice(0, MAX_CANDIDATES).map((c) => c.cli)
    throw usage('unknown_command', `unknown command: ${parsed.positionals.join(' ')}`, under.length ? { candidates: under } : {})
  }
  emitJson(ctx, deliver(await invoke(ctx, hit.command, tree.serverPath, parsed, hit.rest, await needKey()), out), keyRef.key)
  return EXIT.OK
}

export async function run(argv: string[], ctx: Context): Promise<ExitCode> {
  const keyRef: { key: string | null } = { key: null }
  try {
    return await dispatch(ctx, argv, keyRef)
  } catch (e) {
    if (e instanceof CliError) return emitError(ctx, e, keyRef.key)
    const message = e instanceof Error ? e.message : String(e)
    return emitError(ctx, new CliError(EXIT.SERVER, { code: 'internal_error', message }), keyRef.key)
  }
}
