import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProfileInput, normalizeCapability, missingForAssessment,
  saveProfile, loadProfile, CHILD_TABLES,
} from './profile.ts'

test('빈 줄은 버린다 — 추가만 하고 안 채운 줄이 표에 들어가면 안 된다', () => {
  const p = normalizeProfileInput({
    basic: { companyName: '데이터얼라이언스' },
    certifications: [{ name: 'ISMS' }, { name: '   ' }, {}],
    trackRecords: [{ projectName: '통합 플랫폼' }, { client: '어느 기관' }],
    capabilities: [{ tag: 'AI' }, { level: 3 }],
    partners: [{ name: '협력사' }, { capabilities: ['x'] }],
  })
  assert.equal(p.certifications.length, 1)
  assert.equal(p.trackRecords.length, 1)   // projectName 없는 줄은 버린다
  assert.equal(p.capabilities.length, 1)
  assert.equal(p.partners.length, 1)
})

test('숙련도는 1~5 로 자른다 — 밖의 값이면 저장이 통째로 실패한다', () => {
  assert.equal(normalizeCapability({ tag: 'a', level: 9 })?.level, 5)
  assert.equal(normalizeCapability({ tag: 'a', level: 0 })?.level, 1)
  assert.equal(normalizeCapability({ tag: 'a' })?.level, 3)
})

test('금액은 쉼표가 섞여 와도 숫자가 된다', () => {
  const p = normalizeProfileInput({ trackRecords: [{ projectName: 'x', amountKrw: '1,200,000,000' }] })
  assert.equal(p.trackRecords[0].amountKrw, 1200000000)
})

test('무엇이 비었는지 이름으로 돌려준다 — 「부족합니다」만으로는 못 채운다', () => {
  const gaps = missingForAssessment(normalizeProfileInput({ basic: { companyName: '가' } }))
  assert.deepEqual(gaps, ['trackRecords', 'certifications', 'headcount'])
})

/** supabase-js 체이닝을 흉내 낸다. 어느 표에 무엇이 들어갔는지 기록한다 */
function fakeDb(existingVersion: number | null = null) {
  const inserted: Record<string, unknown[]> = {}
  const updated: string[] = []
  const client: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === 'rfp_company_profiles' && existingVersion !== null
            ? { version: existingVersion } : null,
          error: null,
        }),
        single: async () => ({ data: { id: 'p1', version: 1, status: 'active' }, error: null }),
        insert(rows: unknown) {
          inserted[table] = (inserted[table] ?? []).concat(rows as unknown[])
          return q
        },
        update() { updated.push(table); return q },
        then: undefined,
      }
      return q
    },
    async rpc() { return { data: null, error: null } },
  }
  return { client, inserted, updated }
}

test('자식 넷을 실제로 넣는다 — 예전에는 basic 만 저장하고 넷은 버려졌다', async () => {
  const f = fakeDb(3)
  await saveProfile(f.client, {
    orgId: 'org', createdBy: 'u1', status: 'active',
    profile: normalizeProfileInput({
      basic: { companyName: '데이터얼라이언스', headcount: 37 },
      certifications: [{ name: 'ISMS-P' }],
      trackRecords: [{ projectName: '통합 플랫폼', amountKrw: 100 }],
      capabilities: [{ tag: 'AI', level: 4 }],
      partners: [{ name: '협력사', capabilities: ['클라우드'] }],
    }),
  })
  assert.equal(f.inserted['rfp_company_profiles']?.length, 1)
  for (const table of Object.values(CHILD_TABLES)) {
    assert.equal(f.inserted[table]?.length, 1, `${table} 에 안 들어갔다`)
  }
})

test('새 판 번호는 마지막 판 다음이다 — 덮어쓰면 지난 판정을 설명할 수 없다', async () => {
  const f = fakeDb(7)
  await saveProfile(f.client, {
    orgId: 'org', createdBy: null, status: 'active',
    profile: normalizeProfileInput({ basic: { companyName: '가' } }),
  })
  const row = f.inserted['rfp_company_profiles'][0] as { version: number }
  assert.equal(row.version, 8)
})

test('활성으로 저장하면 앞 판을 보관으로 돌린다', async () => {
  const f = fakeDb(1)
  await saveProfile(f.client, {
    orgId: 'org', createdBy: null, status: 'active',
    profile: normalizeProfileInput({ basic: { companyName: '가' } }),
  })
  assert.ok(f.updated.includes('rfp_company_profiles'))
})

test('초안 저장은 활성 판을 안 건드린다 — 확인 전에는 판정에 안 쓰인다', async () => {
  const f = fakeDb(1)
  await saveProfile(f.client, {
    orgId: 'org', createdBy: null, status: 'draft',
    profile: normalizeProfileInput({ basic: { companyName: '가' } }),
  })
  assert.equal(f.updated.length, 0)
})

test('넣기가 실패하면 던진다 — supabase 는 오류를 돌려주지 실패하지 않는다', async () => {
  const db: any = {
    from() {
      const q: any = {
        select: () => q, order: () => q, limit: () => q, eq: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: { id: 'p1' }, error: null }),
        insert: () => ({ ...q, error: { message: '권한 없음' } }),
        update: () => q,
      }
      // 자식 insert 는 select 를 안 거치고 바로 await 된다
      q.insert = (rows: unknown) => {
        const r: any = Promise.resolve({ data: null, error: { message: '권한 없음' } })
        r.select = () => ({ single: async () => ({ data: null, error: { message: '권한 없음' } }) })
        void rows
        return r
      }
      return q
    },
    async rpc() { return { data: null, error: null } },
  }
  await assert.rejects(
    () => saveProfile(db, {
      orgId: 'o', createdBy: null, status: 'draft',
      profile: normalizeProfileInput({ basic: { companyName: '가' } }),
    }),
    /저장하지 못했다/,
  )
})

test('읽을 프로필이 없으면 null — 빈 프로필을 지어내지 않는다', async () => {
  const db: any = {
    from() {
      const q: any = { select: () => q, order: () => q, limit: () => q, eq: () => q }
      q.then = (res: any) => Promise.resolve({ data: [], error: null }).then(res)
      return q
    },
    async rpc() { return { data: null, error: null } },
  }
  assert.equal(await loadProfile(db), null)
})
