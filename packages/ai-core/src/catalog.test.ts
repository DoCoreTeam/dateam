import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canRead, readableFields, validateCatalog, fieldPath,
  type Catalog, type ReadScope,
} from './catalog.ts'

const CATALOG: Catalog = {
  entities: [
    {
      key: 'deal',
      fields: [
        { name: 'title', sensitivity: 'open', describes: 'what the deal is called' },
        { name: 'amount', sensitivity: 'internal', describes: 'contract value in KRW' },
        { name: 'cost', sensitivity: 'secret', describes: 'what we paid, never leaves' },
      ],
    },
  ],
  unlocked: ['deal.amount'],
}

const SCOPE: ReadScope = { allowedIds: ['d1', 'd2'], actorId: 'u1' }

test('an open field reads inside the scope', () => {
  assert.deepEqual(canRead(CATALOG, 'deal', 'title', 'd1', SCOPE), { allowed: true })
})

test('an open field still cannot reach a row outside the scope', () => {
  const r = canRead(CATALOG, 'deal', 'title', 'd9', SCOPE)
  assert.equal(r.allowed, false)
  assert.equal(r.allowed === false && r.reason, 'row_out_of_scope')
})

test('a field nobody unlocked stays closed, the default is not open', () => {
  const locked: Catalog = { ...CATALOG, unlocked: [] }
  const r = canRead(locked, 'deal', 'amount', 'd1', SCOPE)
  assert.equal(r.allowed === false && r.reason, 'field_closed')
})

test('a field unlocked on purpose reads', () => {
  assert.deepEqual(canRead(CATALOG, 'deal', 'amount', 'd1', SCOPE), { allowed: true })
})

test('a secret field does not leave even when someone unlocks it', () => {
  const opened: Catalog = { ...CATALOG, unlocked: ['deal.cost'] }
  const r = canRead(opened, 'deal', 'cost', 'd1', SCOPE)
  assert.equal(r.allowed === false && r.reason, 'field_secret')
  assert.ok(validateCatalog(opened).some((p) => p.includes('secret field cannot be unlocked')))
})

test('an unknown entity or field is refused rather than waved through', () => {
  assert.equal(canRead(CATALOG, 'nope', 'title', 'd1', SCOPE).allowed, false)
  assert.equal(canRead(CATALOG, 'deal', 'nope', 'd1', SCOPE).allowed, false)
})

test('the field list for a prompt excludes secret and still-locked fields', () => {
  const names = readableFields(CATALOG, 'deal').map((f) => f.name)
  assert.deepEqual(names, ['title', 'amount'])
  const locked = readableFields({ ...CATALOG, unlocked: [] }, 'deal').map((f) => f.name)
  assert.deepEqual(locked, ['title'], 'a locked field does not reach the prompt either')
})

test('a field that says nothing about itself makes the catalog wrong', () => {
  const blank: Catalog = {
    entities: [{ key: 'deal', fields: [{ name: 'x', sensitivity: 'open', describes: '  ' }] }],
    unlocked: [],
  }
  assert.ok(validateCatalog(blank).some((p) => p.includes('says nothing about itself')))
})

test('unlocking an already open field is a mistake', () => {
  const dup: Catalog = { ...CATALOG, unlocked: ['deal.title'] }
  assert.ok(validateCatalog(dup).some((p) => p.includes('does not need unlocking')))
})

test('a field is addressed with its entity, never by name alone', () => {
  assert.equal(fieldPath('deal', 'amount'), 'deal.amount')
})
