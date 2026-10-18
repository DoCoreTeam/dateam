/**
 * 계약서 파일로 템플릿 만들기 (P0132 I07)
 *
 * **AI 는 글을 쓰지 않는다.** 원문에 그대로 있는 글자만 칸이 되고, 칸 자리 밖 글자는
 * 원문과 한 글자도 다르지 않다. AI 가 실패해도 글만 들인 초안은 나온다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  splitClauses, applySuggestions, replaceInText, restore, parseSuggestions, buildDraft, nameFromFile, sourceMimeOf,
  type Suggestion,
} from './contract-from-file.ts'
import { CrmError } from '../domain/errors.ts'
import { CONTRACT_FROM_FILE } from '../../terms/contract-doc.ts'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const SERVICE = read('lib/crm/services/contract-from-file.ts')
const ROUTE = read('app/api/crm/contract-templates/from-file/route.ts')
const TEMPLATE_SERVICE = read('lib/crm/services/contract-template.ts')

const SOURCE = [
  '용역 계약서',
  '주식회사 가나다(이하 「갑」)와 주식회사 라마바(이하 「을」)는 다음과 같이 계약한다.',
  '제1조 (목적)',
  '본 계약은 주식회사 가나다가 주식회사 라마바에 GPU 서버를 공급하는 것을 목적으로 한다.',
  '제2조 (대금)',
  '계약 금액은 금 34,980,000원으로 한다. 대표 홍길동 <서명>',
  '--- 2쪽 ---',
  '제3조 (기간)',
  '계약 기간은 2026년 11월 1일부터 2027년 10월 31일까지로 한다.',
].join('\n')

/** 칸을 표시 글자로 되돌려 태그를 걷어 낸 글 — 원문과 대조하는 데 쓴다 */
const plain = (html: string) => html.replace(/<\/p><p>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/* ── 조항 나누기 ─────────────────────────────────── */

test('「제N조」 줄마다 조항이 되고, 첫 조항 앞의 전문도 버리지 않는다', () => {
  const c = splitClauses(SOURCE)
  assert.equal(c.length, 4)
  assert.equal(c[0].title, '')
  assert.match(c[0].html, /이하 「갑」/)
  assert.deepEqual(c.slice(1).map((x) => x.title), ['제1조 (목적)', '제2조 (대금)', '제3조 (기간)'])
})

test('쪽 표시 줄은 본문에 안 들어간다', () => {
  assert.ok(!splitClauses(SOURCE).some((c) => /2쪽/.test(c.html)))
})

test('조항 표시가 없으면 한 덩어리로 둔다', () => {
  const c = splitClauses('첫 줄\n둘째 줄\n셋째 줄')
  assert.equal(c.length, 1)
  assert.equal(c[0].html, '<p>첫 줄</p><p>둘째 줄</p><p>셋째 줄</p>')
})

test('원문의 꺾쇠는 태그가 되지 않는다', () => {
  const c = splitClauses(SOURCE)
  assert.ok(c[2].html.includes('&lt;서명&gt;'))
  assert.ok(!c[2].html.includes('<서명>'))
})

/* ── 칸 제안 ─────────────────────────────────── */

const S = (clause: number, text: string, field: string): Suggestion => ({ clause, text, field })

test('★ 원문에 그대로 있는 글자만 칸이 되고, 칸 자리 밖 글자는 원문과 같다', () => {
  const base = splitClauses(SOURCE)
  const out = applySuggestions(base, [
    S(1, '주식회사 가나다', '고객.상호'),
    S(2, '주식회사 가나다', '고객.상호'),
    S(3, '홍길동', '고객.대표자'),
    S(3, '35,000,000원', '고객.상호'),
  ])
  assert.equal(out.applied.length, 3)
  assert.deepEqual(out.rejected.map((r) => r.why), ['not_in_source'])
  assert.ok(out.clauses[0].html.includes('{{고객.상호}}(이하 「갑」)'))
  assert.ok(out.clauses[2].html.includes('대표 {{고객.대표자}} &lt;서명&gt;'))

  // 칸을 원래 글자로 되돌리면 원문 글과 한 글자도 다르지 않다
  const back = out.clauses.map((c, i) => {
    const restored = c.html.split('{{고객.상호}}').join('주식회사 가나다').split('{{고객.대표자}}').join('홍길동')
    assert.equal(restored, base[i].html, `조항 ${i + 1} 의 칸 밖 글자가 바뀌었다`)
    return plain(restored)
  })
  assert.equal(back.join('\n'), plain(base.map((c) => c.html).join('</p><p>')))
  // 조항 제목은 그대로다
  assert.deepEqual(out.clauses.map((c) => c.title), base.map((c) => c.title))
})

test('모르는 칸 이름, 너무 짧은 글자, 없는 조항은 버린다', () => {
  const base = splitClauses(SOURCE)
  const out = applySuggestions(base, [
    S(1, '주식회사 라마바', '거래처'),
    S(1, '을', '고객.상호'),
    S(9, '홍길동', '고객.대표자'),
  ])
  assert.equal(out.applied.length, 0)
  assert.deepEqual(out.rejected.map((r) => r.why).sort(), ['no_clause', 'too_short', 'unknown_field'])
  assert.deepEqual(out.clauses, base)
})

test('긴 글자를 먼저 바꾼다 — 짧은 쪽이 긴 쪽의 일부를 먹지 않는다', () => {
  const base = splitClauses('제1조\n주식회사 가나다와 가나다는 같다')
  const out = applySuggestions(base, [S(1, '가나다', '고객.대표자'), S(1, '주식회사 가나다', '고객.상호')])
  assert.equal(out.clauses[0].html, '<p>{{고객.상호}}와 {{고객.대표자}}는 같다</p>')
})

test('태그와 이미 넣은 칸 안쪽은 바꾸지 않는다', () => {
  assert.equal(replaceInText('<p>amp &amp; amp</p>', 'amp', '{{X}}').html, '<p>{{X}} &amp; {{X}}</p>')
  assert.equal(replaceInText('<p>{{고객.상호}} 고객</p>', '고객', '{{Y}}').html, '<p>{{고객.상호}} {{Y}}</p>')
  assert.equal(replaceInText('<p>a</p>', 'p', '{{Z}}').count, 0)
})

test('restore 는 나중에 넣은 칸부터 되돌린다', () => {
  assert.equal(restore('{{A}} {{B}}', [{ token: '{{A}}', escaped: 'x' }, { token: '{{B}}', escaped: 'y' }]), 'x y')
})

test('AI 응답은 zod 로 검사한다 — 모양이 틀리면 던진다', () => {
  assert.equal(parseSuggestions('앞말 {"suggestions":[{"clause":1,"text":"가","field":"나"}]} 뒷말').suggestions.length, 1)
  assert.throws(() => parseSuggestions('{"suggestions":[{"clause":0,"text":"가","field":"나"}]}'))
  assert.throws(() => parseSuggestions('{"items":[]}'))
  assert.throws(() => parseSuggestions('JSON 이 없다'))
})

/* ── AI 가 실패해도 ─────────────────────────────────── */

const READ = { fileName: '용역계약서_v3.docx', text: SOURCE, truncated: false }

test('★ AI 가 던지면 칸 없이 글만 들인 초안이 나온다', async () => {
  const d = await buildDraft(READ, async () => { throw new Error('network') })
  assert.equal(d.ai.status, 'failed')
  assert.equal(d.ai.status === 'failed' && d.ai.message, CONTRACT_FROM_FILE.aiFailed)
  assert.deepEqual(d.clauses, splitClauses(SOURCE))
  assert.equal(d.applied.length, 0)
  assert.equal(d.name, '용역계약서_v3')
})

test('★ 예산이 막히면 러너가 만든 말을 그대로 전한다', async () => {
  const d = await buildDraft(READ, async () => { throw new CrmError('RATE_LIMITED', '오늘 AI 사용 한도에 닿았습니다.') })
  assert.equal(d.ai.status === 'failed' && d.ai.message, '오늘 AI 사용 한도에 닿았습니다.')
  assert.equal(d.clauses.length, 4)
})

test('AI 가 되면 검사를 지난 칸만 들어간다', async () => {
  const d = await buildDraft(READ, async () => ({ suggestions: [S(3, '홍길동', '고객.대표자')], runId: 'r1' }))
  assert.equal(d.ai.status, 'ok')
  assert.equal(d.applied.length, 1)
  assert.equal(d.runId, 'r1')
})

test('파일 이름에서 템플릿 이름 — 확장자를 떼고, 비면 기본 이름', () => {
  assert.equal(nameFromFile('계약서.pdf'), '계약서')
  assert.equal(nameFromFile('.pdf'), CONTRACT_FROM_FILE.defaultName)
  assert.equal(nameFromFile(`${'가'.repeat(150)}.pdf`).length, 100)
})

/* ── 문과 원본 ─────────────────────────────────── */

test('★ 파일 검사는 견적서 파일과 같은 문(매직바이트, 20MB)을 지난다', () => {
  assert.match(SERVICE, /checkQuoteFile\(input\)/)
  assert.match(ROUTE, /file\.size > MAX_QUOTE_FILE_BYTES/)
})

test('★ 모델 호출은 runAi 를 지난다 — 개인정보 가림, 예산, 원장', () => {
  assert.match(SERVICE, /runAi<SuggestionDoc>\(/)
  assert.ok(!/adapter\.complete\(|chosen\.complete\(/.test(SERVICE), '러너를 건너뛰어 모델을 부른다')
  assert.match(SERVICE, /parse: parseSuggestions/)
})

test('★ 창구는 관리자만, 원본은 비공개 첨부 버킷에', () => {
  assert.match(ROUTE, /withCrmApi\('ADMIN'/)
  assert.match(ROUTE, /storage\.from\(BUCKET\)/)
  assert.match(ROUTE, /target: 'CONTRACT_TEMPLATE'/)
})

test('발행하면 원본 첨부가 버전에 적힌다', () => {
  assert.match(TEMPLATE_SERVICE, /targetType: 'CONTRACT_TEMPLATE', targetId: templateId/)
  assert.match(TEMPLATE_SERVICE, /const src = source \?\? await latestSource\(tx, id\)/)
})

test('★ 원본 형식은 판정한 종류에서 정한다 — 브라우저가 붙인 형식을 안 쓴다', () => {
  assert.equal(sourceMimeOf('text', '계약서.txt'), 'text/plain')
  // html 이 올라와도 그려지는 형식으로 남기지 않는다
  assert.equal(sourceMimeOf('text', '계약서.html'), 'text/plain')
  assert.equal(sourceMimeOf('hwp', '계약서.hwp'), 'application/x-hwp')
  assert.equal(sourceMimeOf('ooxml', '계약서.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(sourceMimeOf('unknown', '계약서.doc'), null)
  assert.match(ROUTE, /attachSource\([^)]*draft\.sourceMime\)/, '올리는 형식이 판정한 종류에서 오지 않는다')
  assert.match(ROUTE, /contentType: mime, upsert: false/)
  assert.ok(!/contentType: file\.type/.test(ROUTE), '버킷에 브라우저 형식(file.type)을 넘긴다')
})

test('★ 버킷이 원본 형식을 받는다 — 마이그가 sourceMimeOf 의 값을 전부 연다', () => {
  const sql = readFileSync(new URL('../../../../../supabase/migrations/309_crm_attachment_contract_template.sql', import.meta.url), 'utf-8')
  const kinds = [['pdf', 'a.pdf'], ['hwp', 'a.hwp'], ['hwpx', 'a.hwpx'], ['rtf', 'a.rtf'], ['text', 'a.txt'],
    ['ooxml', 'a.docx'], ['ooxml', 'a.xlsx'], ['ooxml', 'a.pptx'], ['odf', 'a.odt'], ['odf', 'a.ods'], ['odf', 'a.odp']] as const
  // pdf, docx, xlsx 는 버킷이 처음부터 받던 값이다
  const original = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  for (const [k, f] of kinds) {
    const m = sourceMimeOf(k, f)!
    assert.ok(original.includes(m) || sql.includes(`'${m}'`), `${m} 를 버킷이 안 받는다`)
  }
})

test('형식을 모르면 원본을 안 올리고 그렇다고 말한다 — 실패를 삼키지 않는다', async () => {
  const d = await buildDraft({ fileName: 'a.txt', text: SOURCE, truncated: false, kind: 'text' }, async () => ({ suggestions: [], runId: null }))
  assert.equal(d.sourceMime, 'text/plain')
  assert.match(ROUTE, /if \(!mime\) \{\s*console\.error/)
  assert.match(ROUTE, /if \(error\) \{\s*console\.error/)
})
