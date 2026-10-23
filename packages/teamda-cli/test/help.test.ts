import { test, expect } from 'bun:test'
import { runCli, tempDir } from './helpers.ts'

const HANGUL = new RegExp("[" + String.fromCharCode(0xac00) + "-" + String.fromCharCode(0xd7a3) + "]")

test('help --json prints one JSON object listing every command', async () => {
  const r = await runCli(['help', '--json'], { TEAMDA_CONFIG_DIR: tempDir() })
  expect(r.code).toBe(0)
  expect(r.stderr).toBe('')
  const lines = r.stdout.trim().split('\n')
  expect(lines.length).toBe(1)
  const h = JSON.parse(r.stdout)
  expect(h.specSource).toBe('embedded')
  expect(h.commands.length).toBeGreaterThan(700)
  for (const c of h.commands) {
    expect(Object.keys(c).sort()).toEqual(['cli', 'method', 'path', 'scope', 'summary'])
    expect(typeof c.cli).toBe('string')
    expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(c.method)
  }
  expect(h.commands.some((c: { summary: string }) => HANGUL.test(c.summary))).toBe(true)
})

test('help --json with a word filters by prefix', async () => {
  const r = await runCli(['help', '--json', 'crm'], { TEAMDA_CONFIG_DIR: tempDir() })
  const h = JSON.parse(r.stdout)
  expect(h.commands.length).toBeGreaterThan(0)
  expect(h.commands.every((c: { cli: string }) => c.cli.startsWith('crm '))).toBe(true)
})

test('plain help is human-readable text', async () => {
  const r = await runCli(['help'], { TEAMDA_CONFIG_DIR: tempDir() })
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('usage: teamda')
  expect(r.stdout).toContain('exit codes:')
  expect(r.stdout).toMatch(/commands \(\d+\)/)
})

test('a partial command is a usage error with candidates', async () => {
  const r = await runCli(['crm', 'quote'], { TEAMDA_CONFIG_DIR: tempDir(), TEAMDA_API_KEY: 'ax_live_0123456789abcdef' })
  expect(r.code).toBe(2)
  expect(r.stdout).toBe('')
  const e = JSON.parse(r.stderr).error
  expect(e.code).toBe('unknown_command')
  expect(e.candidates.length).toBeGreaterThan(0)
})
