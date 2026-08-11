import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBulkIds, bulkSoftDelete, MAX_BULK_IDS } from './soft-delete-bulk.ts'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'

// ── normalizeBulkIds (순수 함수) ──────────────────────────────────────────

test('normalizeBulkIds keeps valid uuids and trims whitespace', () => {
  assert.deepEqual(normalizeBulkIds([` ${UUID_A} `, UUID_B]), [UUID_A, UUID_B])
})

test('normalizeBulkIds drops duplicates preserving first occurrence', () => {
  assert.deepEqual(normalizeBulkIds([UUID_A, UUID_B, UUID_A]), [UUID_A, UUID_B])
})

test('normalizeBulkIds rejects non-uuid values so PostgREST .in() cannot break', () => {
  assert.deepEqual(normalizeBulkIds(['', 'not-a-uuid', null, 42, {}, `${UUID_A}'--`]), [])
})

test('normalizeBulkIds caps at MAX_BULK_IDS', () => {
  const many = Array.from({ length: MAX_BULK_IDS + 50 }, (_, i) =>
    `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
  )
  assert.equal(normalizeBulkIds(many).length, MAX_BULK_IDS)
})

// ── bulkSoftDelete (가짜 supabase 클라이언트) ─────────────────────────────

interface Row {
  id: string
  user_id: string
  deleted_at: string | null
}

interface UpdateCall {
  patch: Record<string, unknown>
  ids: string[]
  userIds: string[]
}

/** PostgREST 체이닝(.select().in().eq().is()/.not() → await)을 흉내내는 최소 fake. */
function createFakeAdmin(rows: Row[], opts?: { selectError?: unknown; updateError?: unknown }) {
  const updates: UpdateCall[] = []

  function makeSelect() {
    let filtered = rows
    const api = {
      in: (col: keyof Row, values: string[]) => {
        filtered = filtered.filter((r) => values.includes(String(r[col])))
        return api
      },
      eq: (col: keyof Row, v: unknown) => {
        filtered = filtered.filter((r) => r[col] === v)
        return api
      },
      is: (col: keyof Row, v: unknown) => {
        filtered = filtered.filter((r) => r[col] === v)
        return api
      },
      not: (col: keyof Row, _op: string, v: unknown) => {
        filtered = filtered.filter((r) => r[col] !== v)
        return api
      },
      then: (resolve: (r: unknown) => void) =>
        resolve(
          opts?.selectError
            ? { data: null, error: opts.selectError }
            : { data: filtered.map((r) => ({ id: r.id })), error: null },
        ),
    }
    return api
  }

  function makeUpdate(patch: Record<string, unknown>) {
    const call: UpdateCall = { patch, ids: [], userIds: [] }
    const api = {
      in: (_col: string, values: string[]) => {
        call.ids = values
        return api
      },
      eq: (_col: string, v: string) => {
        call.userIds.push(v)
        return api
      },
      then: (resolve: (r: unknown) => void) => {
        updates.push(call)
        resolve({ error: opts?.updateError ?? null })
      },
    }
    return api
  }

  const admin = {
    from: () => ({ select: makeSelect, update: makeUpdate }),
  }
  return { admin, updates }
}

const OWNER = 'user-1'

test('bulkSoftDelete stamps deleted_at only on rows the caller owns', async () => {
  const { admin, updates } = createFakeAdmin([
    { id: UUID_A, user_id: OWNER, deleted_at: null },
    { id: UUID_B, user_id: 'someone-else', deleted_at: null },
  ])

  const r = await bulkSoftDelete(admin, {
    table: 'ai_analysis_sessions',
    userId: OWNER,
    ids: [UUID_A, UUID_B],
    action: 'delete',
    notFoundError: '세션을 찾을 수 없습니다',
  })

  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.affectedIds, [UUID_A])
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0].ids, [UUID_A])
  assert.equal(typeof updates[0].patch.deleted_at, 'string')
  // TOCTOU 방어 — update에도 user_id 재검증이 걸려야 한다
  assert.deepEqual(updates[0].userIds, [OWNER])
})

test('bulkSoftDelete skips already-deleted rows (partial success)', async () => {
  const { admin } = createFakeAdmin([
    { id: UUID_A, user_id: OWNER, deleted_at: null },
    { id: UUID_B, user_id: OWNER, deleted_at: '2026-01-01T00:00:00Z' },
  ])

  const r = await bulkSoftDelete(admin, {
    table: 'ai_analysis_sessions',
    userId: OWNER,
    ids: [UUID_A, UUID_B],
    action: 'delete',
    notFoundError: '세션을 찾을 수 없습니다',
  })

  assert.deepEqual(r.ok && r.affectedIds, [UUID_A])
})

test('bulkSoftDelete restore clears deleted_at only on deleted rows', async () => {
  const { admin, updates } = createFakeAdmin([
    { id: UUID_A, user_id: OWNER, deleted_at: '2026-01-01T00:00:00Z' },
    { id: UUID_B, user_id: OWNER, deleted_at: null },
  ])

  const r = await bulkSoftDelete(admin, {
    table: 'ai_analysis_documents',
    userId: OWNER,
    ids: [UUID_A, UUID_B],
    action: 'restore',
    notFoundError: '삭제된 문서를 찾을 수 없습니다',
  })

  assert.deepEqual(r.ok && r.affectedIds, [UUID_A])
  assert.deepEqual(updates[0].patch, { deleted_at: null })
})

test('bulkSoftDelete returns the domain not-found error when nothing matches', async () => {
  const { admin, updates } = createFakeAdmin([{ id: UUID_A, user_id: 'other', deleted_at: null }])

  const r = await bulkSoftDelete(admin, {
    table: 'ai_analysis_sessions',
    userId: OWNER,
    ids: [UUID_A, UUID_C],
    action: 'delete',
    notFoundError: '세션을 찾을 수 없습니다',
  })

  assert.deepEqual(r, { ok: false, error: '세션을 찾을 수 없습니다' })
  assert.equal(updates.length, 0)
})

test('bulkSoftDelete rejects an empty selection without touching the db', async () => {
  const { admin, updates } = createFakeAdmin([{ id: UUID_A, user_id: OWNER, deleted_at: null }])

  const r = await bulkSoftDelete(admin, {
    table: 'ai_analysis_sessions',
    userId: OWNER,
    ids: ['nope'],
    action: 'delete',
    notFoundError: '세션을 찾을 수 없습니다',
  })

  assert.deepEqual(r, { ok: false, error: '대상을 선택하세요' })
  assert.equal(updates.length, 0)
})

test('bulkSoftDelete surfaces db errors instead of reporting success', async () => {
  const { admin } = createFakeAdmin([{ id: UUID_A, user_id: OWNER, deleted_at: null }], {
    updateError: { message: 'boom', code: '42703' },
  })

  const r = await bulkSoftDelete(admin, {
    table: 'ai_analysis_sessions',
    userId: OWNER,
    ids: [UUID_A],
    action: 'delete',
    notFoundError: '세션을 찾을 수 없습니다',
  })

  assert.deepEqual(r, { ok: false, error: '삭제 중 오류가 발생했습니다' })
})
