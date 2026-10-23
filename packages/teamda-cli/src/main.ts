#!/usr/bin/env bun
/**
 * teamda binary entry. All logic lives in run.ts.
 *
 * Sets exitCode instead of calling process.exit: exit() can cut off a large stdout write
 * that is still draining into a pipe (help --json is about 100 KB).
 */
import { defaultContext } from './context.ts'
import { run } from './run.ts'

process.exitCode = await run(process.argv.slice(2), defaultContext())
