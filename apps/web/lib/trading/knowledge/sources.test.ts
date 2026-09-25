/**
 * 소스 분석 — **원문을 버리지 않고, 인용 없는 주장은 안 남긴다**
 *
 * 원문에 없는 말이 「이 자료에 따르면」으로 화면에 뜨면 사람은 그것을 자료로 읽는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SOURCE_KINDS, MAX_RAW_LENGTH, contentHash, normalizeSource, validateSource,
  parseAnalysis, keepGroundedFindings, isSourceRejection, buildSourcePrompt,
  type SourceInput,
} from './source-policy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC: SourceInput = { kind: 'text', ref: '내 메모', rawText: '코스피200 선물 만기는 매달 두 번째 목요일이다.' }

test('종류가 DB 제약과 같다', () => {
  assert.deepEqual([...SOURCE_KINDS], ['text', 'url', 'upload'])
  const sql = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '285_trading_knowledge.sql'), 'utf8')
  for (const k of SOURCE_KINDS) assert.ok(sql.includes(`'${k}'`), `DB 제약에 ${k} 가 없다`)
})

test('★ 내용으로 짝을 짓는다 — 주소가 달라도 같은 글은 같은 자료다', () => {
  const a = contentHash('같은  글입니다')
  const b = contentHash('같은 글입니다')
  assert.equal(a, b, '공백 차이로 다른 자료가 됐다 — 같은 문서를 계속 다시 분석한다')
  assert.notEqual(a, contentHash('다른 글입니다'))
  // 줄바꿈 표기 차이도 같은 글이다
  assert.equal(contentHash('a\r\nb'), contentHash('a\nb'))
})

test('★ 해시에 주소를 안 섞는다 — 섞으면 같은 글이 주소마다 다른 자료가 된다', () => {
  const src = readFileSync(join(HERE, 'source-policy.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export function contentHash'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.equal(/ref|url|kind/.test(body), false, '해시가 본문 말고 다른 것을 본다')
})

test('★ 긴 자료는 던지지 않고 자르고 센다', () => {
  const { source, truncated } = normalizeSource({ ...SRC, rawText: 'ㄱ'.repeat(MAX_RAW_LENGTH + 500) })
  assert.equal(source.rawText.length, MAX_RAW_LENGTH)
  assert.equal(truncated, 500, '자른 양을 안 세면 「짧은 자료」와 구별이 안 된다')
  assert.equal(normalizeSource(SRC).truncated, 0)
})

test('빈 자료와 출처 없는 자료는 안 받는다', () => {
  assert.equal(validateSource({ ...SRC, rawText: '   ' })?.reason, 'empty_text')
  assert.equal(validateSource({ ...SRC, ref: '' })?.reason, 'empty_ref')
  assert.equal(validateSource(SRC), null)
})

// ── 인용 (지어내기 막기) ─────────────────────────────────

test('★ 인용 없는 주장은 읽는 자리에서 버린다', () => {
  const v = parseAnalysis({
    summary: '요약',
    findings: [
      { claim: 'A', quote: '근거 문장' },
      { claim: 'B' },
      { claim: '', quote: 'q' },
      { claim: 'C', quote: '  ' },
    ],
  })
  assert.equal(isSourceRejection(v), false)
  assert.deepEqual(!isSourceRejection(v) && v.findings.map((f) => f.claim), ['A'])
})

test('★ 인용이 원문에 정말 있는지 대조하고, 버린 수를 남긴다', () => {
  const analysis = {
    summary: 's',
    findings: [
      { claim: '만기는 두 번째 목요일', quote: '매달 두 번째 목요일이다' },
      { claim: '내일 오른다', quote: '내일 오를 것이다' },
    ],
  }
  const r = keepGroundedFindings(analysis, SRC.rawText)
  assert.equal(r.kept.length, 1)
  assert.equal(r.dropped, 1, '원문에 없는 인용이 통과했다')
  // 공백 차이는 같은 인용으로 본다
  assert.equal(keepGroundedFindings(
    { summary: 's', findings: [{ claim: 'c', quote: '매달  두 번째   목요일이다' }] }, SRC.rawText,
  ).kept.length, 1)
})

test('요약이 비면 분석으로 안 본다', () => {
  assert.ok(isSourceRejection(parseAnalysis({ summary: '  ', findings: [] })))
  assert.ok(isSourceRejection(parseAnalysis(null)))
  assert.ok(isSourceRejection(parseAnalysis('text')))
})

test('프롬프트가 인용을 요구하고 예측을 막는다', () => {
  const p = buildSourcePrompt('출처', '본문')
  assert.ok(p.includes('적혀 있는 것만'))
  assert.ok(p.includes('quote'))
  assert.ok(p.includes('예측하거나 권하지 않는다'))
  assert.ok(p.includes('본문'))
})

// ── 보안 ────────────────────────────────────────────────

test('★ 바깥 주소로 직접 나가지 않는다 (S4 SSRF)', () => {
  const src = readFileSync(join(HERE, 'sources.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.ok(src.includes('safeFetchText('), '안전 fetch 를 안 쓴다')
  assert.equal(/(^|[^a-zA-Z])fetch\s*\(/.test(src.replace(/safeFetchText\s*\(/g, ' ')), false,
    'fetch 를 직접 부른다 — 사람이 준 주소가 사설망을 물린다')
})

test('★ 남의 HTML 을 저장하지 않는다 (S3) — 태그를 벗겨 평문으로 넣는다', () => {
  const src = readFileSync(join(HERE, 'sources.ts'), 'utf8')
  // 파일에 함수가 있는 것과 **그 함수를 지나는 것**은 다르다.
  // 실측: 주소에서 받은 글을 그대로 넣게 바꿨는데 정의가 남아 있어 이 시험이 초록이었다
  const fn = src.slice(src.indexOf('export async function ingestUrl'), src.indexOf('export function stripMarkup'))
  assert.ok(/\bstripMarkup\s*\(/.test(fn), '받은 글을 안 벗기고 그대로 넣는다')
  assert.equal(/rawText:\s*fetched\.text/.test(fn), false, '받은 본문을 그대로 넘긴다')
})

test('★ 태그와 스크립트가 실제로 벗겨진다', async () => {
  const { stripMarkup } = await import('./sources.ts').catch(() => ({ stripMarkup: null }))
  // `sources.ts` 는 server-only 라 여기서 못 부른다. 규칙만 소스로 확인한다
  assert.equal(stripMarkup, null)
  const src = readFileSync(join(HERE, 'sources.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export function stripMarkup'))
  for (const must of ['<script', '<style', '<[^>]+>']) {
    assert.ok(fn.includes(must), `${must} 를 안 벗긴다`)
  }
})

test('★ 분석이 실패해도 원문은 남는다 — 다시 할 수 있어야 한다', () => {
  const src = readFileSync(join(HERE, 'sources.ts'), 'utf8')
  const fn = src.slice(src.indexOf('async function markFailed'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.equal(/delete\(|raw_text/.test(body), false, '실패가 원문을 지우거나 덮는다')
  assert.ok(body.includes("status: 'failed'") && body.includes('reason:'), '실패 사유가 안 남는다')
})

test('★ 넣기와 분석이 따로다 — AI 가 죽어도 자료는 받는다', () => {
  const src = readFileSync(join(HERE, 'sources.ts'), 'utf8')
  const ingest = src.slice(src.indexOf('export async function ingestSource'), src.indexOf('export async function ingestUrl'))
  assert.equal(/callKnowledge\s*\(/.test(ingest), false,
    '넣을 때 AI 를 부른다 — AI 가 죽은 날 자료까지 못 받게 된다')
})
