/**
 * Where a file response goes. stdout stays one JSON value, so the bytes go to `--out <path>`.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { usage } from './exit.ts'
import { isFileBody } from './http.ts'

export interface SavedFile {
  file: string
  bytes: number
  contentType: string
}

/** JSON results pass through untouched; a file is written to `out` and summarised. */
export function deliver(result: unknown, out: string | undefined): unknown {
  if (!isFileBody(result)) return result
  if (out === undefined || out === '' || out === 'true') {
    throw usage('out_required', `the response is a file (${result.contentType}); pass --out <path>`)
  }
  const file = resolve(out)
  writeFileSync(file, result.bytes)
  return { file, bytes: result.bytes.byteLength, contentType: result.contentType } satisfies SavedFile
}
