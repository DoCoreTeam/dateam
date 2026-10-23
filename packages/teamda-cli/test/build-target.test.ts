import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Measured 2026-10-23 on Windows 10 ARM (x64 emulation, no AVX): the default
// bun-windows-x64 binary printed nothing and exited 255; the baseline binary
// exited 0 with output byte-identical to the macOS build.
test('windows build targets the baseline x64 runtime so it runs without AVX2', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'))
  const script: string = pkg.scripts['build:win']
  const target = script.match(/--target=(\S+)/)?.[1]
  expect(target).toBe('bun-windows-x64-baseline')
})
