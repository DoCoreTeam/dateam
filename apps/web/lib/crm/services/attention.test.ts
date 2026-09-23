// 지금 봐야 할 것 (dacrm FR-12)
//
// **왜 이 가드가 있는가**: 알림 센터는 만들기는 쉽고 죽기도 쉽다.
// 죽는 이유는 늘 같다 — ① 왜 떴는지 안 쓰거나 ② 조치해도 안 사라지거나
// ③ 한 종류가 목록을 다 먹어서 나머지를 못 보거나.
//
// 그래서 여기서 지키는 것은 "알림이 뜬다"가 아니라 **"뜬 것을 처리하면 사라진다"**다.
// 실측(브라우저): 기한 지난 할 일을 DONE 으로 바꾸자 알림에서 즉시 사라졌다(2건 → 1건).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAttention, attentionSummary, KIND_LABEL, KIND_ORDER, ALL_SCOPE } from './attention.ts'

const SRC = readFileSync(new URL('./attention.ts', import.meta.url), 'utf8')
const UI = readFileSync(
  new URL('../../../components/crm/AttentionBell.tsx', import.meta.url), 'utf8')

const NOW = new Date('2026-08-17T03:00:00.000Z') // KST 8/17 12:00

/** 이 종류만 답하고 나머지는 빈 결과를 주는 가짜 DB */
function fakeDb(over: {
  tasks?: { id: string; title: string; dueAt: Date }[]
  pending?: number
  deals?: { id: string; name: string; updatedAt: Date; stage: { name: string } | null }[]
  fail?: ('tasks' | 'pending' | 'deals')[]
}) {
  const fails = new Set(over.fail ?? [])
  return {
    crmTask: {
      findMany: async () => {
        if (fails.has('tasks')) throw new Error('할 일 조회 실패')
        return over.tasks ?? []
      },
    },
    crmAiSuggestion: {
      count: async () => {
        if (fails.has('pending')) throw new Error('제안 조회 실패')
        return over.pending ?? 0
      },
    },
    crmDeal: {
      findMany: async () => {
        if (fails.has('deals')) throw new Error('딜 조회 실패')
        return over.deals ?? []
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const dayBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

test('아무것도 없으면 0건 — 없는 것을 있는 척하지 않는다', async () => {
  const a = await buildAttention(fakeDb({}), ALL_SCOPE, NOW)
  assert.equal(a.total, 0)
  assert.deepEqual(a.items, [])
  assert.equal(attentionSummary(a), '지금 볼 게 없어요')
})

test('★ 기한이 지난 것과 오늘까지인 것을 구분한다 — 같이 묶으면 뭐가 급한지 모른다', async () => {
  const a = await buildAttention(fakeDb({
    tasks: [
      { id: 't1', title: '지난 것', dueAt: dayBefore(6) },
      { id: 't2', title: '오늘 것', dueAt: new Date('2026-08-17T01:00:00.000Z') },
    ],
  }), ALL_SCOPE, NOW)
  assert.equal(a.counts.overdue, 1)
  assert.equal(a.counts.due_today, 1)
  assert.match(a.items[0].reason, /6일 지났어요/)
  assert.match(a.items[1].reason, /오늘까지/)
})

test('아직 안 온 기한은 뜨지 않는다 — 미리 알리면 매일 같은 걸 본다', async () => {
  const a = await buildAttention(fakeDb({
    tasks: [{ id: 't', title: '다음 주', dueAt: new Date('2026-08-25T00:00:00.000Z') }],
  }), ALL_SCOPE, NOW)
  assert.equal(a.total, 0)
})

test('★ 급한 것이 위에 온다 — 화면은 위에서 아래로 읽힌다', async () => {
  const a = await buildAttention(fakeDb({
    tasks: [{ id: 't', title: '지난 것', dueAt: dayBefore(3) }],
    pending: 2,
    deals: [{ id: 'd', name: '멈춘 딜', updatedAt: dayBefore(30), stage: { name: '제안' } }],
  }), ALL_SCOPE, NOW)
  const kinds = a.items.map((i) => i.kind)
  for (let i = 1; i < kinds.length; i++) {
    assert.ok(
      KIND_ORDER.indexOf(kinds[i - 1]) <= KIND_ORDER.indexOf(kinds[i]),
      `순서가 뒤집혔다: ${kinds.join(',')}`,
    )
  }
})

test('★ 한 종류가 목록을 다 먹지 않는다 — 먹으면 나머지를 영영 못 본다', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`, title: `밀린 것 ${i}`, dueAt: dayBefore(i + 1),
  }))
  const a = await buildAttention(fakeDb({ tasks: many, pending: 3 }), ALL_SCOPE, NOW)
  assert.ok(a.counts.overdue <= 5, `상한을 넘었다: ${a.counts.overdue}`)
  assert.equal(a.truncated, true, '잘렸는데 안 알렸다')
  assert.ok(a.items.some((i) => i.kind === 'suggestion'), '제안이 밀려났다')
})

test('★ 왜 떴는지 반드시 쓴다 — 이유가 없으면 사람은 무시하는 법부터 배운다', async () => {
  const a = await buildAttention(fakeDb({
    tasks: [{ id: 't', title: 'x', dueAt: dayBefore(2) }],
    pending: 1,
    deals: [{ id: 'd', name: 'y', updatedAt: dayBefore(30), stage: { name: '제안' } }],
  }), ALL_SCOPE, NOW)
  for (const i of a.items) assert.ok(i.reason.length > 0, `${i.kind} 에 이유가 없다`)
})

test('오래 멈춘 딜은 어느 단계에서 며칠째인지 말한다 — "오래됨"만으론 뭘 할지 모른다', async () => {
  const a = await buildAttention(fakeDb({
    deals: [{ id: 'd', name: '삼성SDS', updatedAt: dayBefore(30), stage: { name: '견적·제안' } }],
  }), ALL_SCOPE, NOW)
  assert.match(a.items[0].reason, /견적·제안에 30일째/)
  assert.equal(a.items[0].href, '/crm/deals/d')
})

test('막 움직인 딜은 멈춘 게 아니다 — 어제 옮긴 딜이 뜨면 알림이 소음이 된다', async () => {
  const a = await buildAttention(fakeDb({
    deals: [],  // 서비스가 cutoff 로 걸러 아예 안 가져온다
  }), ALL_SCOPE, NOW)
  assert.equal(a.counts.stalled, 0)
  assert.ok(SRC.includes('updatedAt: { lt: cutoff }'), '오래된 것만 고르지 않는다')
})

test('만료된 제안은 세지 않는다 — 지난 값을 지금 값처럼 보여주면 안 된다', () => {
  assert.ok(SRC.includes('expiresAt: { gt: now }'), '만료를 거르지 않는다')
})

test('★ 한 종류가 실패해도 나머지는 보인다 — 헤더가 통째로 안 뜨면 그게 더 큰 사고다', async () => {
  const a = await buildAttention(fakeDb({
    tasks: [{ id: 't', title: '살아남을 것', dueAt: dayBefore(1) }],
    pending: 2,
    fail: ['deals'],
  }), ALL_SCOPE, NOW)
  assert.equal(a.counts.overdue, 1)
  assert.equal(a.counts.suggestion, 2)
})

test('전부 실패해도 던지지 않는다 — 알림은 부가 정보다', async () => {
  const a = await buildAttention(fakeDb({ fail: ['tasks', 'pending', 'deals'] }), ALL_SCOPE, NOW)
  assert.equal(a.total, 0)
})

test('요약이 무엇이 급한지 말한다 — 숫자만 보이면 안 누른다', async () => {
  const a = await buildAttention(fakeDb({
    tasks: [{ id: 't', title: 'x', dueAt: dayBefore(2) }],
    pending: 3,
  }), ALL_SCOPE, NOW)
  const s = attentionSummary(a)
  assert.match(s, /기한 지난 할 일 1건/)
  assert.match(s, /확인 기다리는 제안 3건/)
})

test('네 종류에 사람이 읽는 이름이 있다', () => {
  for (const k of KIND_ORDER) assert.ok(KIND_LABEL[k]?.length > 0, `${k} 이름이 없다`)
})

test('★ 알림 테이블을 새로 만들지 않는다 — 같은 사실이 두 곳에 있으면 하나만 사라진다', () => {
  const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8')
  assert.ok(!/model CrmNotification/.test(schema), '알림 테이블이 생겼다')
  // 지금 상태를 읽는다 — 사건을 쌓는 write 가 없어야 한다
  assert.ok(!/\.create\(/.test(SRC), '알림을 쌓고 있다')
})

test('★ 조치하면 사라진다 — 끝난 할 일을 계속 보여 주면 아무도 안 본다(실측: 2건→1건)', () => {
  assert.ok(SRC.includes("status: { in: ['TODO', 'DOING'] }"), '끝난 할 일도 센다')
})

test('★ 헤더에 실제로 붙어 있다 — 만들고 안 꽂으면 없는 기능이다', () => {
  const layout = readFileSync(new URL('../../../app/(crm)/layout.tsx', import.meta.url), 'utf8')
  assert.ok(layout.includes('<AttentionBell />'), 'CRM 셸에 안 붙었다')
  assert.ok(UI.includes("'/api/crm/attention'"), '화면이 API 를 안 부른다')
})

test('열 때마다 다시 읽는다 — 그사이 할 일을 끝냈을 수 있다', () => {
  assert.ok(UI.includes('if (open) void load()'), '열 때 갱신하지 않는다')
})

test('ESC 와 바깥 클릭으로 닫힌다 — 여는 법만 있으면 갇힌다', () => {
  assert.ok(UI.includes("e.key === 'Escape'"), 'ESC 로 못 닫는다')
  assert.ok(UI.includes('mousedown'), '바깥을 눌러도 안 닫힌다')
})

test('★ 뱃지 숫자가 아이콘을 밀어내지 않는다 — 세 자리가 되면 헤더가 깨진다', () => {
  assert.ok(UI.includes("total > 99 ? '99+'"), '숫자 상한이 없다')
})

// ── 누구 것을 보나 ────────────────────────────────────────
//
// **실제 사고**(사용자 지적 2026-09-22): 「아무계정이나 들어가도 동일한 목록이 나오고 있음」.
// `buildAttention` 이 보는 사람을 아예 안 받아서, 어느 계정으로 들어와도 워크스페이스
// 전체가 나왔다. 그래서 여기서 보는 것은 «인자가 있다»가 아니라
// **«그 값이 질의 조건까지 실제로 갔는가»**다 — 선언만 하고 안 넘기는 것이 이 저장소의 단골 결함이다.

/** 질의에 실린 `where` 를 그대로 받아 적는 가짜 DB */
function spyDb() {
  const seen: { task?: Record<string, unknown>; deal?: Record<string, unknown> } = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = {
    crmTask: {
      findMany: async (args: { where: Record<string, unknown> }) => { seen.task = args.where; return [] },
    },
    crmAiSuggestion: { count: async () => 0 },
    crmDeal: {
      findMany: async (args: { where: Record<string, unknown> }) => { seen.deal = args.where; return [] },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { db, seen }
}

test('담당자로 좁힌 값이 할 일과 딜 질의에 그대로 실린다', async () => {
  const { db, seen } = spyDb()
  await buildAttention(db, { ownerMemberIds: ['m1', 'm2'] }, NOW)

  assert.deepEqual(seen.task?.assigneeId, { in: ['m1', 'm2'] }, '할 일이 담당자로 안 좁혀졌다')
  assert.deepEqual(seen.deal?.ownerId, { in: ['m1', 'm2'] }, '딜이 담당자로 안 좁혀졌다')
})

test('제한 없음이면 담당자 조건을 아예 안 붙인다 — 빈 목록으로 좁히지 않는다', async () => {
  const { db, seen } = spyDb()
  await buildAttention(db, ALL_SCOPE, NOW)

  assert.equal('assigneeId' in (seen.task ?? {}), false)
  assert.equal('ownerId' in (seen.deal ?? {}), false)
})

test('담당이 하나도 없는 사람은 빈 조건을 받는다 — 전체로 미끄러지지 않는다', async () => {
  const { db, seen } = spyDb()
  await buildAttention(db, { ownerMemberIds: [] }, NOW)

  // `{ in: [] }` 는 아무것도 안 맞는다. 조건을 통째로 빼면 전체가 나가므로 그러면 안 된다
  assert.deepEqual(seen.task?.assigneeId, { in: [] })
  assert.deepEqual(seen.deal?.ownerId, { in: [] })
})

test('범위 인자에 기본값이 없다 — 안 넘기면 조용히 전체가 나가는 길을 막는다', () => {
  const sig = SRC.slice(SRC.indexOf('export async function buildAttention'))
  const head = sig.slice(0, sig.indexOf(')'))
  assert.ok(/scope:\s*AttentionScope\s*,/.test(head), '범위를 필수 인자로 안 받는다')
  assert.ok(!/scope:\s*AttentionScope\s*=/.test(head), '범위에 기본값이 생겼다')
})
