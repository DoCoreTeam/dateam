// 내보내기 (dacrm FR-13, P0)
//
// **왜 이 가드가 있는가**: 영업은 "엑셀로 뽑아 줘"를 매주 듣는다.
// 못 하면 사람은 CRM 을 다시 엑셀로 옮겨 적고, 그 순간 CRM 은 이중 입력 도구가 된다.
//
// 붙이자마자 실브라우저에서 결함이 나왔다: **회사 내보내기만 500** 이었다.
// 스키마에 없는 `size`·`memo` 를 골랐기 때문이다(실제 이름은 `employeeRange`·`descriptionMd`).
// tsc 는 `(db as any)` 라 못 잡았다 — 그래서 이 가드는 **스키마와 직접 대조**한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EXPORT_LABEL, exportCrm, type ExportKind } from './export.ts'

const SRC = readFileSync(new URL('./export.ts', import.meta.url), 'utf8')
const SCHEMA = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8')

/** 모델 블록 안의 필드 이름만 뽑는다 */
function fieldsOf(model: string): Set<string> {
  const m = SCHEMA.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'))
  assert.ok(m, `${model} 모델이 스키마에 없다`)
  const out = new Set<string>()
  for (const line of m![1].split('\n')) {
    const f = line.trim().match(/^([a-zA-Z][a-zA-Z0-9_]*)\s+\S/)
    if (f) out.add(f[1])
  }
  return out
}

/**
 * `select: { ... }` 블록에서 `키: true` 를 뽑는다.
 *
 * **창을 넉넉히 잡으면 안 된다** — 다음 조회의 select 까지 먹어서
 * 없는 필드를 있다고 우긴다(이 가드를 처음 쓸 때 실제로 그랬다: 미팅이 할 일의 status 를 삼켰다).
 * 그래서 중괄호 짝을 세어 그 블록에서 정확히 끊는다.
 */
function selectedKeys(afterModel: string): string[] {
  const at = SRC.indexOf(`${afterModel}.findMany(`)
  assert.ok(at > 0, `${afterModel} 조회가 없다`)
  const start = SRC.indexOf('select: {', at)
  assert.ok(start > 0, `${afterModel} 에 select 가 없다`)

  let depth = 0
  let end = start
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  const block = SRC.slice(start, end)
  // 중첩 relation(`company: { select: { name: true } }`)의 안쪽은 그 모델의 필드라 여기서 보지 않는다
  const flat = block.replace(/\{[^{}]*\}/g, '')
  return [...flat.matchAll(/(\w+):\s*true/g)].map((m) => m[1])
}

const MODELS: Record<string, string> = {
  crmCompany: 'CrmCompany', crmPerson: 'CrmPerson',
  crmDeal: 'CrmDeal', crmMeeting: 'CrmMeeting', crmTask: 'CrmTask',
}

test('★ 고르는 칸이 전부 스키마에 실재한다 — 없는 칸 하나가 그 종류만 500 으로 만든다(실측: 회사)', () => {
  for (const [client, model] of Object.entries(MODELS)) {
    const fields = fieldsOf(model)
    for (const key of selectedKeys(client)) {
      assert.ok(fields.has(key), `${model} 에 ${key} 가 없다 — 내보내면 500 이 난다`)
    }
  }
})

test('★ 금액을 minor 정수로 내보내지 않는다 — 300000000 을 받은 사람은 3억인지 300만인지 모른다', async () => {
  const rows = [{
    name: '삼성 계약', status: 'WON', amountMinor: 300_000_000n, currency: 'KRW',
    expectedCloseDate: null, wonAt: null, lostReason: null, createdAt: null,
    company: { name: '삼성SDS' }, stage: { name: '계약' }, pipeline: { name: 'GPU' },
  }]
  const db = { crmDeal: { findMany: async () => rows } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await exportCrm(db as any, 'deals')
  assert.match(out.csv, /삼성 계약,삼성SDS,GPU,계약,성사,300000000,KRW/)
})

test('소수 통화는 100 으로 나눈다 — USD 1234 는 12.34 달러다', async () => {
  const db = { crmDeal: { findMany: async () => [{
    name: 'x', status: 'OPEN', amountMinor: 1234n, currency: 'USD',
    expectedCloseDate: null, wonAt: null, lostReason: null, createdAt: null,
    company: null, stage: null, pipeline: null,
  }] } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await exportCrm(db as any, 'deals')
  assert.match(out.csv, /,12\.34,USD/)
})

test('★ 수식 인젝션을 막는다 — 받는 사람 엑셀에서 실행되면 우리가 보낸 파일이 공격이다', async () => {
  const db = { crmTask: { findMany: async () => [
    { title: '=SUM(A1:A9)', status: 'TODO', dueAt: null, completedAt: null, createdAt: null },
    { title: '쉼표, 그리고 "따옴표"', status: 'DONE', dueAt: null, completedAt: null, createdAt: null },
  ] } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await exportCrm(db as any, 'tasks')
  assert.ok(out.csv.includes("'=SUM(A1:A9)"), '수식이 그대로 나간다')
  assert.ok(out.csv.includes('"쉼표, 그리고 ""따옴표"""'), '쉼표·따옴표가 칸을 깨뜨린다')
})

test('★ 이스케이프를 새로 만들지 않고 호스트 SSOT 를 쓴다 — 두 벌이면 안 고친 쪽으로 파일이 나간다', () => {
  assert.ok(SRC.includes("from '../../admin/daily-monitoring.ts'"), '자체 구현을 쓴다')
  assert.ok(SRC.includes('csvCell'), '이스케이프를 거치지 않는다')
})

test('★ 엑셀이 한글을 읽게 BOM 을 붙인다 — 없으면 받는 사람 화면이 전부 깨진다', async () => {
  const db = { crmTask: { findMany: async () => [] } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await exportCrm(db as any, 'tasks')
  assert.equal(out.csv.charCodeAt(0), 0xfeff)
  // 보이지 않는 문자를 소스에 직접 두지 않는다 — 나중에 누가 모르고 지운다
  assert.ok(SRC.includes("'\\uFEFF'"), 'BOM 을 이스케이프로 쓰지 않았다')
})

test('★ 잘렸으면 잘렸다고 말한다 — 조용히 자르면 "이게 전부"로 읽고 보고에 쓴다', async () => {
  const many = Array.from({ length: 5001 }, (_, i) => ({
    title: `t${i}`, status: 'TODO', dueAt: null, completedAt: null, createdAt: null,
  }))
  const db = { crmTask: { findMany: async () => many } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await exportCrm(db as any, 'tasks')
  assert.equal(out.truncated, true)
  assert.equal(out.rows, 5000)
  const ui = readFileSync(new URL('../../../app/(crm)/crm/settings/ExportCard.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('truncated ?'), '화면이 잘림을 말하지 않는다')
})

test('빈 데이터도 머리글만 있는 파일을 준다 — 파일이 안 열리면 사람은 고장으로 본다', async () => {
  const db = { crmMeeting: { findMany: async () => [] } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await exportCrm(db as any, 'meetings')
  assert.equal(out.rows, 0)
  assert.match(out.csv, /제목,일시,장소/)
})

test('파일명에 날짜와 종류가 들어간다 — download.csv 가 쌓이면 어느 게 무엇인지 모른다', async () => {
  const db = { crmMeeting: { findMany: async () => [] } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await exportCrm(db as any, 'meetings')
  assert.match(out.filename, /^crm_미팅_\d{4}-\d{2}-\d{2}\.csv$/)
})

test('다섯 종류에 사람이 읽는 이름이 있다', () => {
  const kinds: ExportKind[] = ['companies', 'people', 'deals', 'meetings', 'tasks']
  for (const k of kinds) assert.ok(EXPORT_LABEL[k]?.length > 0, `${k} 이름이 없다`)
})

test('★ 화면이 실제로 이 API 를 부른다 — 만들고 안 꽂으면 없는 기능이다', () => {
  const page = readFileSync(new URL('../../../app/(crm)/crm/settings/page.tsx', import.meta.url), 'utf8')
  assert.ok(page.includes('<ExportCard />'), '설정 화면에 카드가 없다')
  const ui = readFileSync(new URL('../../../app/(crm)/crm/settings/ExportCard.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('/api/crm/export?kind='), '화면이 API 를 부르지 않는다')
})

test('★ 파일 응답도 로그인·멤버십을 확인한다 — JSON 봉투를 못 써도 인증은 못 건너뛴다', () => {
  const route = readFileSync(new URL('../../../app/api/crm/export/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes('resolveCrmAccess('), '접근 판정을 하지 않는다')
  assert.ok(route.includes('status: 403'), '거부하지 않는다')
})
