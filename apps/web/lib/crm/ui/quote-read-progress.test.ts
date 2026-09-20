/**
 * 견적 파일 대기 문구 — 45초·120초 분기는 브라우저로 밟기 어려워 여기서 재현한다
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { quoteWaitProgress, quoteWaitLine } from './quote-read-progress.ts'
import { FILL_READ_START, FILL_READ_LONG, FILL_READ_VERY_LONG } from '../../terms/quote.ts'

const reading = (elapsedMs: number, fileName = '견적서.pdf', fileBytes = 2_200_000) =>
  quoteWaitProgress({ phase: 'reading', elapsedMs, fileName, fileBytes })

test('첫 몇 초는 시작했다고만 한다 — 곧바로 상세를 말하면 깜빡임으로 읽힌다', () => {
  const v = reading(500)
  assert.equal(v.message, FILL_READ_START)
  assert.equal(v.elapsedLabel, null, '1초짜리에 초를 세면 그게 더 불안하다')
})

test('★ 무엇을 읽는 중인지 이름과 크기로 말한다 — 「읽는 중…」 한 마디로 3분을 덮지 않는다', () => {
  const v = reading(12_000)
  assert.match(v.message, /견적서\.pdf/)
  assert.match(v.message, /2\.1MB/)
  assert.equal(v.elapsedLabel, '12초')
  assert.equal(quoteWaitLine(v), '견적서.pdf(2.1MB) 을 읽고 있어요 · 12초')
})

test('이름을 모르면 크기를 지어내지 않는다', () => {
  const v = quoteWaitProgress({ phase: 'reading', elapsedMs: 12_000 })
  assert.equal(v.message, '올린 파일을 읽고 있어요')
  assert.ok(!/MB|KB/.test(v.message), '모르는 크기를 말했다')
})

test('작은 파일은 KB 로 — 0.0MB 라고 하면 안 올라간 줄로 읽는다', () => {
  assert.match(reading(5_000, 'a.png', 318_000).message, /311KB/)
})

test('★ 45초를 넘으면 오래 걸리는 중이라고 밝힌다 — 침묵은 고장으로 읽힌다', () => {
  assert.equal(reading(44_000).reassure, null)
  assert.equal(reading(45_000).reassure, FILL_READ_LONG)
  assert.equal(reading(60_000).elapsedLabel, '1분 0초')
})

test('★ 상한(180초)에 가까워지면 곧 끝난다고 말한다', () => {
  assert.equal(reading(120_000).reassure, FILL_READ_VERY_LONG)
  assert.equal(reading(150_000).reassure, FILL_READ_VERY_LONG)
})

test('★ 가져오는 중에는 몇 건 중 몇 번째인지 말한다 — 남은 일이 얼마인지까지 말한다', () => {
  const v = quoteWaitProgress({ phase: 'importing', elapsedMs: 4_000, total: 3, done: 1 })
  assert.equal(v.message, '3건 중 2건째를 만들고 있어요')
  assert.equal(v.elapsedLabel, '4초')
})

test('한 건이면 순서를 말하지 않는다 — 「1건 중 1건째」는 군말이다', () => {
  const v = quoteWaitProgress({ phase: 'importing', elapsedMs: 1_000, total: 1, done: 0 })
  assert.equal(v.message, '견적을 만들고 있어요')
  assert.equal(v.elapsedLabel, null)
})

test('★ 말로 채울 때는 파일이라고 하지 않는다 — 안 한 일을 했다고 말하면 안 된다', () => {
  const v = quoteWaitProgress({ phase: 'speech', elapsedMs: 8_000, saidChars: 218 })
  assert.equal(v.message, '적어 주신 218자를 읽고 있어요')
  assert.ok(!/파일/.test(v.message), '파일을 올린 적이 없는데 파일이라고 말했다')
  assert.equal(v.elapsedLabel, '8초')
})

test('글자 수를 모르면 숫자를 지어내지 않는다', () => {
  assert.equal(
    quoteWaitProgress({ phase: 'speech', elapsedMs: 8_000 }).message,
    '적어 주신 내용을 읽고 있어요')
})

test('★ 시간 문턱과 경과 표기를 새로 정하지 않는다 — 회의노트 모듈에 위임한다', () => {
  const src = readFileSync(new URL('./quote-read-progress.ts', import.meta.url), 'utf8')
  assert.match(src, /from '\.\.\/\.\.\/meeting\/digest-progress\.ts'/,
    '문턱을 여기서 다시 정하면 화면마다 다른 말이 나온다')
  assert.ok(!/45_?000|120_?000/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    '문턱 숫자를 이 파일이 또 적고 있다')
})
