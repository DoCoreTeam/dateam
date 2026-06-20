import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  asRecord,
  strOrNull,
  numConfidence,
  parseJsonSafe,
  mapTasks,
  mapEvents,
  mapHighlights,
  mapAttendees,
  sanitizeSearchQuery,
  toStartAt,
  DATE_RE,
  TIME_RE,
} from './parse-helpers.ts'

// ============================================================
// asRecord
// ============================================================
describe('asRecord', () => {
  test('객체를 그대로 반환한다', () => {
    const obj = { a: 1, b: 'x' }
    assert.deepEqual(asRecord(obj), obj)
  })

  test('null → 빈 객체 반환', () => {
    assert.deepEqual(asRecord(null), {})
  })

  test('string → 빈 객체 반환', () => {
    assert.deepEqual(asRecord('hello'), {})
  })

  test('number → 빈 객체 반환', () => {
    assert.deepEqual(asRecord(42), {})
  })
})

// ============================================================
// strOrNull
// ============================================================
describe('strOrNull', () => {
  test('비어있지 않은 문자열 → trim해서 반환', () => {
    assert.equal(strOrNull('  hello  '), 'hello')
  })

  test('빈 문자열 → null', () => {
    assert.equal(strOrNull(''), null)
  })

  test('공백만 있는 문자열 → null', () => {
    assert.equal(strOrNull('   '), null)
  })

  test('null → null', () => {
    assert.equal(strOrNull(null), null)
  })

  test('number → null (문자열 아님)', () => {
    assert.equal(strOrNull(123), null)
  })

  test('undefined → null', () => {
    assert.equal(strOrNull(undefined), null)
  })
})

// ============================================================
// numConfidence
// ============================================================
describe('numConfidence', () => {
  test('number 그대로 반환', () => {
    assert.equal(numConfidence(0.85), 0.85)
  })

  test('0 반환', () => {
    assert.equal(numConfidence(0), 0)
  })

  test('string → 0 반환 (숫자 아님)', () => {
    assert.equal(numConfidence('0.9'), 0)
  })

  test('null → 0', () => {
    assert.equal(numConfidence(null), 0)
  })

  test('undefined → 0', () => {
    assert.equal(numConfidence(undefined), 0)
  })
})

// ============================================================
// DATE_RE / TIME_RE 정규식
// ============================================================
describe('DATE_RE', () => {
  test('YYYY-MM-DD 형식 통과', () => {
    assert.ok(DATE_RE.test('2026-06-18'))
    assert.ok(DATE_RE.test('2000-01-01'))
  })

  test('잘못된 형식 거부', () => {
    assert.ok(!DATE_RE.test('26-06-18'))
    assert.ok(!DATE_RE.test('2026/06/18'))
    assert.ok(!DATE_RE.test('20260618'))
    assert.ok(!DATE_RE.test(''))
  })
})

describe('TIME_RE', () => {
  test('HH:mm 형식 통과', () => {
    assert.ok(TIME_RE.test('09:00'))
    assert.ok(TIME_RE.test('23:59'))
    assert.ok(TIME_RE.test('00:00'))
  })

  test('잘못된 형식 거부', () => {
    assert.ok(!TIME_RE.test('9:00'))
    assert.ok(!TIME_RE.test('09:0'))
    assert.ok(!TIME_RE.test('09-00'))
    assert.ok(!TIME_RE.test(''))
  })
})

// ============================================================
// parseJsonSafe
// ============================================================
describe('parseJsonSafe', () => {
  test('순수 JSON 문자열 파싱', () => {
    const result = parseJsonSafe('{"a":1}')
    assert.deepEqual(result, { a: 1 })
  })

  test('마크다운 코드펜스(```json) 제거 후 파싱', () => {
    const result = parseJsonSafe('```json\n{"a":1}\n```')
    assert.deepEqual(result, { a: 1 })
  })

  test('마크다운 코드펜스(``` 만) 제거 후 파싱', () => {
    const result = parseJsonSafe('```\n{"a":1}\n```')
    assert.deepEqual(result, { a: 1 })
  })

  test('유효하지 않은 JSON → SyntaxError 던짐', () => {
    assert.throws(() => parseJsonSafe('{invalid}'), SyntaxError)
  })
})

// ============================================================
// mapTasks — 필터 기준: title 있음 + source_quote 있음 + confidence >= 0.7
// ============================================================
describe('mapTasks', () => {
  test('정상 후보 통과', () => {
    const raw = [{ title: '주간보고 작성', confidence: 0.9, source_quote: '주간보고를 작성하기로 했다' }]
    const result = mapTasks(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].title, '주간보고 작성')
    assert.equal(result[0].confidence, 0.9)
    assert.equal(result[0].source_quote, '주간보고를 작성하기로 했다')
  })

  test('confidence < 0.7 제외 (경계값 0.6999)', () => {
    const raw = [{ title: '업무 A', confidence: 0.6999, source_quote: '근거 있음' }]
    assert.equal(mapTasks(raw).length, 0)
  })

  test('confidence 정확히 0.7 → 포함 (경계값)', () => {
    const raw = [{ title: '업무 B', confidence: 0.7, source_quote: '근거 있음' }]
    assert.equal(mapTasks(raw).length, 1)
  })

  test('source_quote null → 제외', () => {
    const raw = [{ title: '업무 C', confidence: 0.95, source_quote: null }]
    assert.equal(mapTasks(raw).length, 0)
  })

  test('source_quote 빈 문자열 → null 처리되어 제외', () => {
    const raw = [{ title: '업무 D', confidence: 0.95, source_quote: '' }]
    assert.equal(mapTasks(raw).length, 0)
  })

  test('title 빈 문자열 → 제외', () => {
    const raw = [{ title: '', confidence: 0.95, source_quote: '근거' }]
    assert.equal(mapTasks(raw).length, 0)
  })

  test('title 앞뒤 공백 trim', () => {
    const raw = [{ title: '  업무 E  ', confidence: 0.9, source_quote: '근거' }]
    assert.equal(mapTasks(raw)[0].title, '업무 E')
  })

  test('non-array → 빈 배열', () => {
    assert.deepEqual(mapTasks(null), [])
    assert.deepEqual(mapTasks(undefined), [])
    assert.deepEqual(mapTasks('string'), [])
  })

  test('복수 후보 중 조건 만족하는 것만 통과', () => {
    const raw = [
      { title: '통과', confidence: 0.8, source_quote: '근거' },
      { title: '탈락1', confidence: 0.5, source_quote: '근거' },
      { title: '탈락2', confidence: 0.9, source_quote: null },
    ]
    const result = mapTasks(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].title, '통과')
  })
})

// ============================================================
// mapEvents — suggested_date/time 형식 검증 추가
// ============================================================
describe('mapEvents', () => {
  test('정상 후보 — 날짜+시각 모두 있음', () => {
    const raw = [
      {
        title: '팀 미팅',
        confidence: 0.85,
        source_quote: '다음 주 화요일 14시에 미팅',
        suggested_date: '2026-06-23',
        suggested_time: '14:00',
      },
    ]
    const result = mapEvents(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].suggested_date, '2026-06-23')
    assert.equal(result[0].suggested_time, '14:00')
  })

  test('날짜 형식 잘못됨(YYYY/MM/DD) → null로 교정', () => {
    const raw = [
      {
        title: '미팅',
        confidence: 0.9,
        source_quote: '근거',
        suggested_date: '2026/06/23',
        suggested_time: '14:00',
      },
    ]
    const result = mapEvents(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].suggested_date, null)
  })

  test('시각 형식 잘못됨(9:00) → null로 교정', () => {
    const raw = [
      {
        title: '미팅',
        confidence: 0.9,
        source_quote: '근거',
        suggested_date: '2026-06-23',
        suggested_time: '9:00',
      },
    ]
    const result = mapEvents(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].suggested_time, null)
  })

  test('confidence < 0.7 → 제외', () => {
    const raw = [
      {
        title: '미팅',
        confidence: 0.69,
        source_quote: '근거',
        suggested_date: '2026-06-23',
        suggested_time: null,
      },
    ]
    assert.equal(mapEvents(raw).length, 0)
  })

  test('suggested_date/time 모두 null인 경우도 통과(날짜 모르는 이벤트)', () => {
    const raw = [
      {
        title: '미팅',
        confidence: 0.8,
        source_quote: '근거',
        suggested_date: null,
        suggested_time: null,
      },
    ]
    const result = mapEvents(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].suggested_date, null)
    assert.equal(result[0].suggested_time, null)
  })
})

// ============================================================
// mapHighlights — mapTasks와 동일 필터 로직
// ============================================================
describe('mapHighlights', () => {
  test('정상 후보 통과', () => {
    const raw = [{ title: '계약 체결', confidence: 0.9, source_quote: '계약이 체결됨' }]
    assert.equal(mapHighlights(raw).length, 1)
  })

  test('confidence 0.7 경계값 — 포함', () => {
    const raw = [{ title: '성과', confidence: 0.7, source_quote: '근거' }]
    assert.equal(mapHighlights(raw).length, 1)
  })

  test('confidence 0.699 경계값 — 제외', () => {
    const raw = [{ title: '성과', confidence: 0.699, source_quote: '근거' }]
    assert.equal(mapHighlights(raw).length, 0)
  })

  test('source_quote 공백만 있음 → null 처리되어 제외', () => {
    const raw = [{ title: '성과', confidence: 0.9, source_quote: '   ' }]
    assert.equal(mapHighlights(raw).length, 0)
  })
})

// ============================================================
// mapAttendees — name 기준, mapTasks와 동일 필터
// ============================================================
describe('mapAttendees', () => {
  test('정상 후보 통과', () => {
    const raw = [{ name: '홍길동', confidence: 0.9, source_quote: '홍길동 과장이 보고' }]
    const result = mapAttendees(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].name, '홍길동')
    assert.equal(result[0].confidence, 0.9)
    assert.equal(result[0].source_quote, '홍길동 과장이 보고')
  })

  test('source_quote null → 제외', () => {
    const raw = [{ name: '김철수', confidence: 0.95, source_quote: null }]
    assert.equal(mapAttendees(raw).length, 0)
  })

  test('confidence < 0.7 → 제외', () => {
    const raw = [{ name: '이영희', confidence: 0.69, source_quote: '근거' }]
    assert.equal(mapAttendees(raw).length, 0)
  })

  test('name 빈 문자열 → 제외', () => {
    const raw = [{ name: '', confidence: 0.9, source_quote: '근거' }]
    assert.equal(mapAttendees(raw).length, 0)
  })

  test('name 앞뒤 공백 trim', () => {
    const raw = [{ name: '  홍길동  ', confidence: 0.9, source_quote: '근거' }]
    assert.equal(mapAttendees(raw)[0].name, '홍길동')
  })

  test('non-array → 빈 배열', () => {
    assert.deepEqual(mapAttendees(null), [])
    assert.deepEqual(mapAttendees(undefined), [])
  })
})

// ============================================================
// sanitizeSearchQuery — % 와 , 를 공백으로 치환
// ============================================================
describe('sanitizeSearchQuery', () => {
  test('일반 쿼리 → 그대로', () => {
    assert.equal(sanitizeSearchQuery('회의'), '회의')
  })

  test('% 치환', () => {
    assert.equal(sanitizeSearchQuery('100%완료'), '100 완료')
  })

  test(', 치환', () => {
    assert.equal(sanitizeSearchQuery('a,b,c'), 'a b c')
  })

  test('% 와 , 혼합 치환', () => {
    assert.equal(sanitizeSearchQuery('a%b,c'), 'a b c')
  })

  test('빈 문자열 → 빈 문자열', () => {
    assert.equal(sanitizeSearchQuery(''), '')
  })

  test('특수문자 없는 한글 쿼리 → 그대로', () => {
    assert.equal(sanitizeSearchQuery('회의 안건 정리'), '회의 안건 정리')
  })
})

// ============================================================
// toStartAt — date+time → ISO 문자열, 날짜 없으면 null
// ============================================================
describe('toStartAt', () => {
  test('날짜+시각 모두 있음 → ISO 문자열', () => {
    assert.equal(toStartAt('2026-06-18', '14:30'), '2026-06-18T14:30:00+09:00')
  })

  test('KST 오프셋 명시 → UTC 환산 정확(14:00 KST = 05:00 UTC)', () => {
    const iso = toStartAt('2026-06-25', '14:00')
    assert.equal(new Date(iso!).toISOString(), '2026-06-25T05:00:00.000Z')
  })

  test('날짜만 있고 시각 없음 → 기본 09:00 사용', () => {
    assert.equal(toStartAt('2026-06-18', null), '2026-06-18T09:00:00+09:00')
  })

  test('날짜만 있고 시각 undefined → 기본 09:00 사용', () => {
    assert.equal(toStartAt('2026-06-18', undefined), '2026-06-18T09:00:00+09:00')
  })

  test('날짜 형식 잘못됨(YYYY/MM/DD) → null', () => {
    assert.equal(toStartAt('2026/06/18', '14:00'), null)
  })

  test('날짜 null → null', () => {
    assert.equal(toStartAt(null, '14:00'), null)
  })

  test('날짜 undefined → null', () => {
    assert.equal(toStartAt(undefined, '14:00'), null)
  })

  test('시각 형식 잘못됨(9:00) → 기본 09:00 폴백', () => {
    assert.equal(toStartAt('2026-06-18', '9:00'), '2026-06-18T09:00:00+09:00')
  })

  test('시각 빈 문자열 → 기본 09:00 폴백', () => {
    assert.equal(toStartAt('2026-06-18', ''), '2026-06-18T09:00:00+09:00')
  })
})
