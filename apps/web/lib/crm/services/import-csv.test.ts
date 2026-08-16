// 엑셀에서 들여오기 (dacrm FR-13, P0)
//
// **왜 이 가드가 특히 중요한가**: 임포트는 한 번에 수백 건을 만든다.
// 잘못 만들면 지우는 데 며칠이 걸리고, 그사이 누가 그 회사에 딜을 붙인다.
//
// 그래서 지키는 것은 셋이다 —
// ① **이미 있는 것을 덮지 않는다**(덮으면 사람이 CRM 에서 고친 값이 옛 엑셀 값으로 돌아간다)
// ② **파일 안의 중복도 잡는다**(같은 회사가 두 줄이면 두 개가 생긴다)
// ③ **못 알아본 칸을 숨기지 않는다**(숨기면 사람은 데이터가 들어간 줄 안다)
//
// 실측(브라우저): 6줄 파일 → 새로 2건·이미 있음 2건·못 넣음 1건으로 정확히 갈렸고,
// 넣은 뒤 회사 2건이 도메인·산업까지 그대로 들어갔다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  matchField, parseImportCsv, planImport, applyImport,
  IMPORT_LABEL, MAX_ROWS, type ImportKind,
} from './import-csv.ts'

const SRC = readFileSync(new URL('./import-csv.ts', import.meta.url), 'utf8')

/** 이미 있는 것을 흉내 내는 가짜 DB */
function fakeDb(companies: { name: string; domain: string | null }[] = [],
                people: { name: string; email: string | null }[] = []) {
  return {
    crmCompany: { findMany: async () => companies },
    crmPerson: { findMany: async () => people },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

test('한국어·영어 칸 이름을 알아본다 — 사람은 "업체"라고도 "Company"라고도 쓴다', () => {
  assert.equal(matchField('companies', '회사명'), 'name')
  assert.equal(matchField('companies', '업체'), 'name')
  assert.equal(matchField('companies', 'Company'), 'name')
  assert.equal(matchField('companies', '홈페이지'), 'domain')
  assert.equal(matchField('people', '담당자'), 'name')
  assert.equal(matchField('people', 'E-Mail'), 'email')
})

test('공백·밑줄·하이픈을 무시한다 — 엑셀 헤더는 사람마다 다르게 적는다', () => {
  assert.equal(matchField('companies', ' 회사 명 '), 'name')
  assert.equal(matchField('people', 'contact_name'), 'name')
})

test('★ 못 알아본 칸은 버린다 — 틀리게 넣느니 안 넣는 편이 낫다', () => {
  assert.equal(matchField('companies', '쓸모없는칸'), null)
  assert.equal(matchField('companies', ''), null)
})

test('★ 못 알아본 칸을 목록으로 돌려준다 — 숨기면 사람은 데이터가 들어간 줄 안다', () => {
  const p = parseImportCsv('companies', '회사명,도메인,쓸모없는칸\nA,a.com,x')
  assert.deepEqual(p.ignored, ['쓸모없는칸'])
  assert.deepEqual(p.mapped.map((m) => m.field), ['name', 'domain'])
})

test('★ 이름 칸이 없으면 아예 받지 않는다 — 이름 없는 회사를 수백 개 만들면 되돌릴 수 없다', () => {
  assert.throws(() => parseImportCsv('companies', '가격,수량\n1,2'), /이름 칸을 못 찾았어요/)
  assert.throws(() => parseImportCsv('companies', ''), /빈 파일/)
})

test('행 번호는 엑셀 기준이다 — 사람이 그 줄을 찾아가 고쳐야 한다', () => {
  const p = parseImportCsv('companies', '회사명\nA\nB')
  assert.deepEqual(p.rows.map((r) => r.line), [2, 3])
})

test('완전히 빈 줄은 건너뛴다 — 엑셀 파일 끝에 흔히 붙는다', () => {
  const p = parseImportCsv('companies', '회사명,도메인\nA,a.com\n,\n\nB,b.com')
  assert.equal(p.rows.length, 2)
})

test('같은 필드가 두 칸에 잡히면 앞의 것만 쓴다 — 뒤엣것이 덮으면 어느 칸이 들어갔는지 모른다', () => {
  const p = parseImportCsv('companies', '회사명,업체명\nA,B')
  assert.equal(p.mapped.filter((m) => m.field === 'name').length, 1)
  assert.deepEqual(p.ignored, ['업체명'])
  assert.equal(p.rows[0].values.name, 'A')
})

test('행 수 상한을 넘으면 잘렸다고 말한다 — 조용히 자르면 나머지가 들어간 줄 안다', () => {
  const lines = ['회사명', ...Array.from({ length: MAX_ROWS + 10 }, (_, i) => `회사${i}`)]
  const p = parseImportCsv('companies', lines.join('\n'))
  assert.equal(p.rows.length, MAX_ROWS)
  assert.equal(p.truncated, true)
})

test('★ 이미 있는 도메인은 새로 만들지 않는다 — 덮어쓰면 CRM 에서 고친 값이 사라진다', async () => {
  const parsed = parseImportCsv('companies', '회사명,도메인\n다른이름,a.com')
  const pv = await planImport(fakeDb([{ name: '원래이름', domain: 'a.com' }]), 'companies', parsed)
  assert.equal(pv.counts.exists, 1)
  assert.equal(pv.counts.create, 0)
  assert.match(pv.plans[0].reason, /같은 도메인/)
})

test('이름만 같아도 이미 있는 것으로 본다 — 도메인이 없는 회사가 흔하다', async () => {
  const parsed = parseImportCsv('companies', '회사명\n삼성SDS')
  const pv = await planImport(fakeDb([{ name: '삼성SDS', domain: null }]), 'companies', parsed)
  assert.equal(pv.counts.exists, 1)
  assert.match(pv.plans[0].reason, /같은 이름/)
})

test('★ 파일 안의 중복도 잡는다 — 같은 회사가 두 줄이면 두 개가 생긴다', async () => {
  const parsed = parseImportCsv('companies', '회사명,도메인\nA,a.com\nA,a.com')
  const pv = await planImport(fakeDb(), 'companies', parsed)
  assert.equal(pv.counts.create, 1)
  assert.equal(pv.counts.exists, 1)
})

test('이름이 빈 행은 못 넣는다고 말한다 — 왜 안 됐는지 알아야 파일을 고친다', async () => {
  const parsed = parseImportCsv('companies', '회사명,도메인\n,a.com')
  const pv = await planImport(fakeDb(), 'companies', parsed)
  assert.equal(pv.counts.skip, 1)
  assert.match(pv.plans[0].reason, /이름이 비어/)
})

test('인물은 이메일로 같은 사람을 가린다 — 동명이인이 흔하다', async () => {
  const parsed = parseImportCsv('people', '이름,이메일\n김철수,a@x.com')
  const pv = await planImport(fakeDb([], [{ name: '다른이름', email: 'a@x.com' }]), 'people', parsed)
  assert.equal(pv.counts.exists, 1)
  assert.match(pv.plans[0].reason, /같은 이메일/)
})

test('★ 실제로 넣을 때 create 만 만든다 — exists 를 만들면 중복 판정이 무의미해진다', async () => {
  const created: Record<string, unknown>[] = []
  const tx = {
    crmCompany: { create: async (a: { data: Record<string, unknown> }) => { created.push(a.data); return { id: 'c' } } },
    crmAuditLog: { create: async () => ({}) },
  }
  const parsed = parseImportCsv('companies', '회사명,도메인,산업\n새회사,new.com,IT\n헌회사,old.com,제조')
  const pv = await planImport(fakeDb([{ name: '헌회사', domain: 'old.com' }]), 'companies', parsed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await applyImport(tx as any, 'companies', pv, 'm1')

  assert.equal(out.created, 1)
  assert.equal(out.skipped, 1)
  assert.equal(created.length, 1)
  assert.equal(created[0].name, '새회사')
  assert.equal(created[0].industry, 'IT')
  assert.equal(created[0].source, 'IMPORT', '들여온 것임을 표시하지 않는다')
})

test('★ 한 행이 실패해도 나머지는 넣고, 실패한 행 번호를 돌려준다', async () => {
  let n = 0
  const tx = {
    crmCompany: { create: async () => { n++; if (n === 1) throw new Error('제약 위반'); return { id: 'c' } } },
    crmAuditLog: { create: async () => ({}) },
  }
  const parsed = parseImportCsv('companies', '회사명\nA\nB')
  const pv = await planImport(fakeDb(), 'companies', parsed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await applyImport(tx as any, 'companies', pv, null)

  assert.equal(out.created, 1)
  assert.equal(out.failed.length, 1)
  assert.equal(out.failed[0].line, 2, '엑셀에서 찾아갈 행 번호가 없다')
})

test('★ 인물은 회사 이름으로 붙는다 — 실측: __검증사람1 이 __검증상사A 에 붙었다', async () => {
  const created: Record<string, unknown>[] = []
  const tx = {
    crmCompany: { findMany: async () => [{ id: 'co1', name: '삼성SDS' }] },
    crmPerson: { create: async (a: { data: Record<string, unknown> }) => { created.push(a.data); return { id: 'p' } } },
    crmAuditLog: { create: async () => ({}) },
  }
  const parsed = parseImportCsv('people', '이름,회사\n김철수,삼성SDS\n박영희,없는회사')
  const pv = await planImport(fakeDb(), 'people', parsed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await applyImport(tx as any, 'people', pv, null)

  assert.equal(created[0].companyId, 'co1')
  // 회사를 못 찾아도 사람은 만든다 — 사람을 버리면 그 줄이 통째로 사라진다
  assert.equal(created[1].companyId, null)
  assert.equal(created.length, 2)
})

test('★ 누가 언제 무엇을 들여왔는지 남긴다 — 수백 건이 한 번에 생기는 일이다', async () => {
  const audits: Record<string, unknown>[] = []
  const tx = {
    crmCompany: { create: async () => ({ id: 'c' }) },
    crmAuditLog: { create: async (a: { data: Record<string, unknown> }) => { audits.push(a.data); return {} } },
  }
  const parsed = parseImportCsv('companies', '회사명\nA')
  const pv = await planImport(fakeDb(), 'companies', parsed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await applyImport(tx as any, 'companies', pv, 'm1')

  assert.equal(audits.length, 1)
  assert.equal(audits[0].action, 'import.csv')
})

test('★ CSV 파싱을 새로 만들지 않고 호스트 SSOT 를 쓴다 — 두 벌이면 여기서만 깨지는 파일이 생긴다', () => {
  assert.ok(SRC.includes("from '../../gpu/csv-intake.ts'"), '자체 파서를 쓴다')
})

test('★ 넣기 전에 반드시 보여 준다 — 미리보기를 안 보고 넣으면 되돌릴 일이 생긴다', () => {
  const ui = readFileSync(
    new URL('../../../app/(crm)/crm/settings/ImportCard.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('preview && !outcome'), '미리보기 없이 넣을 수 있다')
  assert.ok(ui.includes("send('preview')"), '먼저 보기가 없다')
  assert.ok(ui.includes('preview.ignored'), '못 알아본 칸을 화면이 숨긴다')
  assert.ok(ui.includes('outcome.failed'), '실패한 행을 화면이 숨긴다')
})

test('★ 넣는 것은 관리자만 — 수백 건이 한 번에 생기는 일이다', () => {
  const route = readFileSync(
    new URL('../../../app/api/crm/import/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes("session.role !== 'OWNER'"), '아무나 넣을 수 있다')
  assert.ok(route.includes('MAX_TEXT'), '파일 크기 상한이 없다')
})

test('★ 설정 화면에 실제로 붙어 있다 — 만들고 안 꽂으면 없는 기능이다', () => {
  const page = readFileSync(
    new URL('../../../app/(crm)/crm/settings/page.tsx', import.meta.url), 'utf8')
  assert.ok(page.includes('<ImportCard />'), '설정 화면에 카드가 없다')
})

test('두 종류에 사람이 읽는 이름이 있다', () => {
  const kinds: ImportKind[] = ['companies', 'people']
  for (const k of kinds) assert.ok(IMPORT_LABEL[k]?.length > 0, `${k} 이름이 없다`)
})
