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
  scrubResidue, type Suggestion, type KnownSupplier,
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

test('★ 한 줄 조항은 「제N조 (제목)」만 제목이 되고 나머지 문장은 본문이 된다', () => {
  // 실측 2026-10-19: 한 줄이 통째로 제목이 되어 본문이 비었고, AI로 고치기가 늘 「본문에 그 글이 없다」로 거절됐다
  const c = splitClauses('제1조 (목적) 갑과 을은 GPU 서버 임대에 합의한다.\n제2조 (대금 지급) 을은 15일 안에 지급한다.')
  assert.deepEqual(c.map((x) => x.title), ['제1조 (목적)', '제2조 (대금 지급)'])
  assert.deepEqual(c.map((x) => x.html), ['<p>갑과 을은 GPU 서버 임대에 합의한다.</p>', '<p>을은 15일 안에 지급한다.</p>'])
})

test('괄호 제목이 없으면 문장으로 끝날 때만 본문으로 내린다 — 「제3조 기간」 같은 제목은 그대로', () => {
  const c = splitClauses('제3조 기간\n계약 기간은 1년이다.\n제4조 해지는 30일 전에 알린다.')
  assert.deepEqual(c.map((x) => x.title), ['제3조 기간', '제4조'])
  assert.equal(c[0].html, '<p>계약 기간은 1년이다.</p>')
  assert.equal(c[1].html, '<p>해지는 30일 전에 알린다.</p>')
})

test('제목은 원문 글자 그대로다 — 띄어쓰기를 고치지 않는다', () => {
  assert.equal(splitClauses('제6조(통지) 통지는 서면으로 한다.')[0].title, '제6조(통지)')
})

test('제목 줄 뒤에 본문 줄이 이어지면 둘 다 본문에 남는다', () => {
  const c = splitClauses('제5조 (비밀) 서로의 비밀을 지킨다.\n위반하면 손해를 배상한다.')
  assert.equal(c[0].title, '제5조 (비밀)')
  assert.equal(c[0].html, '<p>서로의 비밀을 지킨다.</p><p>위반하면 손해를 배상한다.</p>')
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

/* ── 채워진 계약서에서 남의 값 빼기 (P0148 I03) ─────── */

// 2026-10-21 실측 화면과 같은 모양 — 이름 번호는 지어낸 것이다. PDF 처럼 글자 사이가 벌어져 온다
const FILLED = [
  '용역 계약서',
  '에이엑스(주)(이하 甲)와 김철수(이하 乙)는 다음과 같이 용역 계약을 체결한다.',
  '제6조 [보수]',
  '① 乙의 보수는 금 사백칠십오만원(4,750,000원) 으로 한다.',
  '제17조 [준거법 및 관할]',
  '이 계약은 대한민국 민법을 그 준거법으로 한다.',
  '계약 당 사 자 들 은 이상과 같 이 계약을 체결하고 이를 증 명하기 위하여 계약서 2부를 작성하여 각각 서명 또는',
  '기명 날 인한 후 각 1부 씩 보관한다.',
  '2026년 1월 2일',
  '甲 에이엑스(주) 대표이사 홍 길 동 (서명 또는 인)',
  '乙 김 철 수 (서명 또는 인)',
  '(주 민 등록번호 : 800101 – 1234567 )',
  '연락처 010-1234-5678',
].join('\n')

const KNOWN: KnownSupplier = { name: '주식회사 에이엑스', ceo: '홍길동', bizNo: '123-45-67890', address: '', phone: '' }

test('★ 날인부는 마지막 조항에서 떨어져 따로 한 덩어리가 된다', () => {
  const c = splitClauses(FILLED)
  const last = c[c.length - 1]
  const law = c[c.length - 2]
  assert.equal(law.title, '제17조 [준거법 및 관할]')
  assert.equal(plain(law.html), '이 계약은 대한민국 민법을 그 준거법으로 한다.')
  assert.equal(last.title, '')
  assert.match(plain(last.html), /^계약 당 사 자 들 은 이상과 같 이/)
  assert.match(plain(last.html), /乙 김 철 수/)
})

test('본문 중간의 「기명날인」 은 끊지 않는다 — 마지막 조항만 본다', () => {
  const c = splitClauses('제1조 (통지)\n통지는 서면에 기명날인하여 한다.\n제2조 (기간)\n1년으로 한다.')
  assert.equal(c.length, 2)
  assert.match(plain(c[0].html), /기명날인/)
})

test('★ 주민등록번호는 한 자리도 남지 않고 생년월일 칸이 된다 — AI 가 실패해도', async () => {
  const d = await buildDraft({ fileName: 'x.pdf', text: FILLED, truncated: false }, async () => { throw new Error('down') }, KNOWN)
  const all = d.clauses.map((c) => plain(c.html)).join('\n')
  assert.doesNotMatch(all, /1234567|800101/)
  assert.doesNotMatch(all, /주 *민 *등 *록/)
  assert.match(all, /생년월일 : \{\{고객\.생년월일\}\}/)
  assert.equal(d.scrubbed, 1)
})

test('★ 우리 회사 상호 대표자는 AI 없이 칸이 된다 — (주) 변형과 글자 사이 띄어쓰기까지', () => {
  const r = scrubResidue(splitClauses(FILLED), KNOWN)
  const all = r.clauses.map((c) => plain(c.html)).join('\n')
  assert.doesNotMatch(all, /에이엑스|홍 *길 *동/)
  assert.match(all, /甲 \{\{공급자\.상호\}\} 대표이사 \{\{공급자\.대표자\}\} \(서명 또는 인\)/)
  assert.match(all, /^\{\{공급자\.상호\}\}\(이하 甲\)/m)
})

test('★ 한글 금액이 하나뿐이면 합계 한글 칸이 된다', () => {
  const r = scrubResidue(splitClauses(FILLED), null)
  const pay = r.clauses.find((c) => c.title.startsWith('제6조'))!
  assert.equal(plain(pay.html), '① 乙의 보수는 {{견적.합계 한글}}(4,750,000원) 으로 한다.')
})

test('한글 금액이 둘 이상이면 어느 것이 합계인지 몰라 바꾸지 않고 남은 값으로 센다', () => {
  const r = scrubResidue(splitClauses('제1조\n계약금 금 일백만원\n잔금 금 이백만원'), null)
  assert.match(plain(r.clauses[0].html), /금 일백만원/)
  assert.equal(r.leftover.filter((l) => l.kind === 'money').length, 2)
})

test('★ 칸이 못 된 번호 금액 날짜는 남은 값으로 센다', () => {
  const r = scrubResidue(splitClauses(FILLED), KNOWN)
  const texts = r.leftover.map((l) => `${l.kind}:${l.text}`)
  assert.ok(texts.includes('phone:010-1234-5678'), texts.join(' | '))
  assert.ok(texts.includes('money:4,750,000원'), texts.join(' | '))
  assert.ok(texts.includes('date:2026년 1월 2일'), texts.join(' | '))
  // 칸으로 바꾼 값은 다시 세지 않는다
  assert.ok(!texts.some((t) => t.includes('사백칠십오만')))
})

test('AI 가 칸으로 바꾼 값은 남은 값에서 빠진다', async () => {
  const sign = splitClauses(FILLED).length
  const d = await buildDraft({ fileName: 'x.pdf', text: FILLED, truncated: false }, async () => ({
    suggestions: [S(sign, '2026년 1월 2일', '계약.계약일'), S(2, '4,750,000원', '견적.합계')], runId: 'r',
  }), KNOWN)
  assert.ok(!d.leftover.some((l) => l.kind === 'date' || l.kind === 'money'), JSON.stringify(d.leftover))
})

test('★ 창구는 남은 값과 지운 수를 화면에 싣는다 — 수가 없으면 사람이 다시 훑어야 한다', () => {
  assert.match(ROUTE, /scrubbed: draft\.scrubbed/)
  assert.match(ROUTE, /leftoverCount: draft\.leftover\.length/)
  assert.match(ROUTE, /withCrmApi\('ADMIN'/)
  assert.match(SERVICE, /const known = await readQuoteSupplier\(db\)/)
})
