/**
 * Everything the CLI touches outside itself, passed in so tests can run it in-process.
 */
import pkg from '../package.json'

export const VERSION: string = (pkg as { version: string }).version

export type Env = Record<string, string | undefined>

export interface Context {
  env: Env
  out: (text: string) => void
  err: (text: string) => void
  readStdin: () => Promise<string>
  fetch: typeof fetch
  platform: string
  /** Wait between retries. Tests pass a recorder so nothing actually waits. */
  sleep?: (ms: number) => Promise<void>
}

export function defaultContext(): Context {
  return {
    env: process.env,
    out: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t),
    readStdin: async () => await new Response(Bun.stdin.stream()).text(),
    fetch: globalThis.fetch,
    platform: process.platform,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  }
}

/** Print shown for a key. Never more than this many characters of a secret leave the process. */
export const KEY_VISIBLE_CHARS = 12

export function maskKey(key: string): string {
  return `${key.slice(0, KEY_VISIBLE_CHARS)}...`
}

/** Replace any full occurrence of the key in outgoing text. Belt and braces over every print. */
export function redact(text: string, key: string | null): string {
  if (!key || key.length <= KEY_VISIBLE_CHARS) return text
  return text.split(key).join(maskKey(key))
}
