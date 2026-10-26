/**
 * The embedded spec carries the registry's request bodies (P0173).
 *
 * It used to embed only the generated table, so `gpu quote --items ...` sent items as a query
 * parameter with no body and the server refused it as a body that is not JSON, until the user
 * ran `teamda sync`. The four public writes below have their bodies only in the registry.
 */
import { test, expect } from 'bun:test'
import embedded from '../src/generated/spec.json'
import { buildCommandTree, resolveCommand, type OpenApiSpec } from '../src/spec.ts'
import { buildRequest } from '../src/commands/invoke.ts'
import { parseArgs } from '../src/args.ts'

const tree = buildCommandTree(embedded as OpenApiSpec)

function built(argv: string[]) {
  const parsed = parseArgs(argv)
  const hit = resolveCommand(tree, parsed.positionals)
  if (!hit) throw new Error(`no command: ${argv.join(' ')}`)
  return buildRequest(hit.command, parsed, hit.rest)
}

test('gpu quote sends items in the body, not the query', () => {
  const r = built(['gpu', 'quote', '--items', '[{"product_id":"p","quantity":1}]'])
  expect(r.body).toEqual({ items: [{ product_id: 'p', quantity: 1 }] })
  expect([...r.query.keys()]).toEqual([])
})

for (const cli of ['gpu quote', 'gpu pool-stock create-v1', 'gpu settings update-v1', 'gpu supplier create-v1']) {
  test(`${cli} has a request body in the embedded spec`, () => {
    const cmd = tree.byCli.get(cli)
    expect(cmd?.hasBody).toBe(true)
    expect(cmd?.bodyFields?.length ?? 0).toBeGreaterThan(0)
  })
}
