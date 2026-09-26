import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBarCsv, parseBarTime, splitCsvLine, mapHeaders, importSummary,
  type CsvParseResult,
} from './csv-core.ts'

const ok = (r: ReturnType<typeof parseBarCsv>): CsvParseResult => {
  assert.ok('bars' in r, `거절됐다: ${'userMessage' in r ? r.userMessage : ''}`)
  return r
}

test('★ 시간대가 없으면 KST 로 못을 박는다 — 서버 시간대로 읽히면 아홉 시간 어긋난다', () => {
  assert.equal(parseBarTime('2026-09-25 09:01')?.toISOString(), '2026-09-25T00:01:00.000Z')
  assert.equal(parseBarTime('2026-09-25T09:01:00')?.toISOString(), '2026-09-25T00:01:00.000Z')
  assert.equal(parseBarTime('202609250901')?.toISOString(), '2026-09-25T00:01:00.000Z')
})

test('시간대가 붙어 있으면 그대로 믿는다', () => {
  assert.equal(parseBarTime('2026-09-25T00:01:00Z')?.toISOString(), '2026-09-25T00:01:00.000Z')
})

test('못 읽는 시각은 null 이다', () => {
  assert.equal(parseBarTime(''), null)
  assert.equal(parseBarTime('어제'), null)
})

test('따옴표 안의 쉼표는 안 쪼갠다', () => {
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ['a', 'b,c', 'd'])
  assert.deepEqual(splitCsvLine('a,"say ""hi""",c'), ['a', 'say "hi"', 'c'])
})

test('★ 머리글 이름이 달라도 뜻으로 맞춘다 — 증권사마다 이름이 다르다', () => {
  assert.ok(mapHeaders(['일시', '시가', '고가', '저가', '종가', '거래량']))
  assert.ok(mapHeaders(['Date', 'Open', 'High', 'Low', 'Close']))
  assert.ok(mapHeaders(['bar_start_at', 'o', 'h', 'l', 'c', 'vol']))
})

test('거래량은 없어도 된다 — 0 인 분도 정상 봉이다', () => {
  const r = ok(parseBarCsv('time,open,high,low,close\n2026-09-25 09:01,400,401,399,400.5'))
  assert.equal(r.bars[0].volume, 0)
})

test('★ 머리글을 못 맞추면 한 줄도 안 읽는다 — 반쯤 읽으면 어느 칸이 시가인지 모른 채 값이 들어간다', () => {
  const r = parseBarCsv('a,b,c\n1,2,3')
  assert.ok(!('bars' in r))
  assert.ok('userMessage' in r && r.userMessage.includes('머리글'))
})

test('★ 오류 메시지에 본문을 안 싣는다 — 머리글 이름만 돌려준다', () => {
  const r = parseBarCsv('a,b,c\n비밀값1,비밀값2,비밀값3')
  assert.ok('userMessage' in r)
  assert.equal(r.userMessage.includes('비밀값'), false, r.userMessage)
})

test('정상 줄을 읽는다', () => {
  const r = ok(parseBarCsv([
    '일시,시가,고가,저가,종가,거래량',
    '2026-09-25 09:01,400.00,401.00,399.50,400.50,"1,234"',
    '2026-09-25 09:02,400.50,400.80,400.10,400.20,900',
  ].join('\n')))
  assert.equal(r.bars.length, 2)
  assert.equal(r.rejected.length, 0)
  assert.equal(r.bars[0].volume, 1234, '쉼표 자리표를 걷어 내야 한다')
  assert.equal(r.mapping.close, '종가')
})

test('★ 고가가 저가보다 낮은 줄은 버린다 — 그 봉의 ATR 은 음수가 되고 손절가가 반대편에 놓인다', () => {
  const r = ok(parseBarCsv([
    'time,open,high,low,close',
    '2026-09-25 09:01,400,399,401,400',
    '2026-09-25 09:02,400,401,399,400',
  ].join('\n')))
  assert.equal(r.bars.length, 1)
  assert.deepEqual(r.rejected, [{ line: 2, reason: 'bad_range' }])
})

test('고가가 종가보다 낮은 줄도 버린다', () => {
  const r = ok(parseBarCsv('time,open,high,low,close\n2026-09-25 09:01,400,400.5,399,402'))
  assert.equal(r.bars.length, 0)
  assert.equal(r.rejected[0].reason, 'bad_range')
})

test('숫자가 아닌 줄과 시각이 깨진 줄을 따로 센다', () => {
  const r = ok(parseBarCsv([
    'time,open,high,low,close',
    '2026-09-25 09:01,없음,401,399,400',
    '어제,400,401,399,400',
    '2026-09-25 09:03,400,401,399,400',
  ].join('\n')))
  assert.equal(r.bars.length, 1)
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['bad_number', 'bad_time'])
})

test('줄이 하나뿐이면 거절한다', () => {
  assert.ok(!('bars' in parseBarCsv('time,open,high,low,close')))
})

test('사람이 읽을 한 줄에 저장 수와 건너뛴 사유가 함께 나온다', () => {
  const r = ok(parseBarCsv([
    'time,open,high,low,close',
    '2026-09-25 09:01,400,401,399,400',
    '어제,400,401,399,400',
  ].join('\n')))
  const line = importSummary(r, 1)
  assert.ok(line.includes('1줄 저장'), line)
  assert.ok(line.includes('시각을 못 읽음 1줄'), line)
})
