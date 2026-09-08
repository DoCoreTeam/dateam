// lib/crm/ui/task-due.test.ts — 「마감은 오늘부터」 가드
//
// 사용자 지적(2026-09-08): *"기본적으로 오늘 날짜 부터 잡아야지 비어 있으면 안되지"*
//
// 막는 것 둘:
//   ① 마감 칸이 다시 빈 채로 시작하는 것
//   ② 하나 만든 뒤 리셋이 빈 문자열로 돌아가는 것 — 두 번째부터 마감이 없어진다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initialDueDate, initialStartDate, toStartIso, toDueIso, startsAfterDue } from './task-due.ts'
import { kstTodayKey } from '../../datetime/kst.ts'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const CLIENT = 'app/(crm)/crm/tasks/TasksClient.tsx'

/* ── 판정 ────────────────────────────────────────────── */

test('★ 아무것도 없으면 오늘 — 빈 칸으로 시작하지 않는다', () => {
  assert.equal(initialDueDate(null, '2026-09-08'), '2026-09-08')
  assert.equal(initialDueDate(undefined, '2026-09-08'), '2026-09-08')
  assert.equal(initialDueDate('', '2026-09-08'), '2026-09-08')
})

test('★ 주소로 받은 날짜가 오늘보다 앞선다 — 공유 링크의 뜻을 덮지 않는다', () => {
  assert.equal(initialDueDate('2026-12-25', '2026-09-08'), '2026-12-25')
  // 지난 날짜여도 그대로 — 「어제까지였던 일」을 적는 것도 정상이다
  assert.equal(initialDueDate('2026-01-01', '2026-09-08'), '2026-01-01')
})

test('형식이 아닌 값은 무시하고 오늘 — 주소는 아무나 고칠 수 있다', () => {
  for (const bad of ['오늘', '2026-9-8', '2026/09/08', 'null', '20260908', '2026-09-08T00:00']) {
    assert.equal(initialDueDate(bad, '2026-09-08'), '2026-09-08', `${bad} 을 그대로 받았다`)
  }
})

test('기본 인자는 KST 오늘이다 — UTC 로 계산하면 자정 근처에 하루가 어긋난다', () => {
  assert.equal(initialDueDate(null), kstTodayKey())
  assert.match(initialDueDate(null), /^\d{4}-\d{2}-\d{2}$/)
})

/* ── 배선 — 만들고 안 쓰면 없는 규칙이다 ─────────────── */

test('★ 화면이 이 판정을 쓴다 — 빈 문자열로 초기화하지 않는다', () => {
  const src = read(CLIENT)
  assert.match(src, /useState\(\(\) => initialDueDate\(dueParam\)\)/,
    '마감 칸이 다시 빈 채로 시작한다')
  assert.ok(
    !/setDueDate\(''\)/.test(src),
    '하나 만든 뒤 빈 칸으로 되돌리면 두 번째부터 마감이 없어진다',
  )
  assert.match(src, /setDueDate\(initialDueDate\(null\)\)/, '리셋이 SSOT 를 안 거친다')
})

test('오늘 계산을 화면이 직접 하지 않는다 — KST SSOT 를 거친다', () => {
  const src = read(CLIENT)
  assert.ok(
    !/new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(src),
    'UTC 로 «오늘»을 만들면 자정 근처에 하루가 어긋난다(§datetime 정책)',
  )
})

/* ── 시작일 (v0.7.696 · 「할일도 시작과 종료일이 있어야 할 것 같아」) ── */

test('★ 시작일도 오늘부터 — 마감과 같은 이유다', () => {
  assert.equal(initialStartDate(null, '2026-09-08'), '2026-09-08')
  assert.equal(initialStartDate('2026-10-01', '2026-09-08'), '2026-10-01')
})

test('★ 시작은 그날 00:00, 마감은 23:59 — 같은 날을 골라도 순서가 뒤집히지 않는다', () => {
  assert.equal(toStartIso('2026-09-08'), '2026-09-08T00:00:00+09:00')
  assert.equal(toDueIso('2026-09-08'), '2026-09-08T23:59:00+09:00')
  // 같은 날이면 시작이 마감보다 앞선다 — 이 구분이 없으면 「시작이 마감보다 늦다」가 뜬다
  assert.ok(new Date(toStartIso('2026-09-08')!) < new Date(toDueIso('2026-09-08')!))
})

test('★ 오프셋 없는 문자열을 보내지 않는다 — UTC 로 적재돼 9시간 어긋난다', () => {
  for (const iso of [toStartIso('2026-09-08'), toDueIso('2026-09-08')]) {
    assert.match(iso!, /\+09:00$/, `${iso} 에 KST 앵커가 없다`)
  }
  assert.equal(toStartIso(''), null, '빈 값은 «안 정함»이다')
  assert.equal(toDueIso('오늘'), null, '형식이 아니면 보내지 않는다')
})

test('시작이 마감보다 늦은지 알아본다 — 막지는 않는다', () => {
  assert.equal(startsAfterDue('2026-09-10', '2026-09-08'), true)
  assert.equal(startsAfterDue('2026-09-08', '2026-09-08'), false, '같은 날은 정상이다')
  assert.equal(startsAfterDue('2026-09-01', '2026-09-08'), false)
  assert.equal(startsAfterDue('', '2026-09-08'), false, '안 정한 것은 판정하지 않는다')
})

/* ── 배선: 두 화면이 같은 규칙을 쓴다 ─────────────────── */

const PANEL = 'components/ui/crm/TaskPanel.tsx'

test('★ 목록과 딜 상세가 같은 규칙을 쓴다 — 한쪽만 고치면 같은 일을 다르게 만든다', () => {
  for (const f of [CLIENT, PANEL]) {
    const src = read(f)
    /*
      **초기 선언을 따로 본다.** 처음 판은 `initialStartDate(null)` 이 파일 어딘가에
      있기만 하면 통과했는데, 리셋 쪽 호출이 남아 있어 **초기값을 `''` 로 되돌려도
      잡지 못했다**(파괴 검증에서 드러남). 사용자가 겪는 것은 «처음 열었을 때»다.
    */
    assert.match(src, /useState\(\(\) => initialStartDate\(null\)\)/,
      `${f}: 시작일이 빈 칸으로 시작한다`)
    assert.match(src, /initialStartDate\(null\)/, `${f}: 시작일이 오늘부터가 아니다`)
    assert.match(src, /toStartIso\(/, `${f}: 시작일을 KST 앵커로 안 보낸다`)
    assert.match(src, /toDueIso\(/, `${f}: 마감을 KST 앵커로 안 보낸다`)
  }
})

test('★ 날짜를 오프셋 없이 보내지 않는다 — 예전 TaskPanel 이 그랬다', () => {
  for (const f of [CLIENT, PANEL]) {
    const src = read(f)
    assert.ok(!/dueAt: due \|\| null/.test(src), `${f}: 오프셋 없는 날짜를 그대로 보낸다`)
    assert.ok(
      !/dueAt: [^,\n]*\$\{[^}]*\}T23:59/.test(src),
      `${f}: 앵커를 인라인으로 만들면 두 화면이 또 갈린다 — toDueIso 를 쓴다`,
    )
  }
})
