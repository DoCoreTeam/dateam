import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorItem } from './context-anchor.ts'

test('정확 일치 → 올바른 start/end/excerpt', () => {
  const source = '앞 문단입니다.\n\n항목 하나: 자세한 내용입니다.\n\n뒤 문단입니다.'
  const itemText = '항목 하나: 자세한 내용입니다.'
  const result = anchorItem(source, itemText)

  assert.ok(result)
  const start = source.indexOf(itemText)
  assert.equal(result?.start, start)
  assert.equal(result?.end, start + itemText.length)
  assert.equal(source.slice(result!.start, result!.end), itemText)
  assert.ok(result?.excerpt.includes(itemText))
})

test('문단 경계(\\n\\n)로 감싸는 구간 확장 확인', () => {
  const source = '첫 번째 문단.\n\n두 번째 문단에는 목표 문장이 있다.\n\n세 번째 문단.'
  const itemText = '목표 문장이 있다.'
  const result = anchorItem(source, itemText)

  assert.ok(result)
  // 감싸는 구간은 두 번째 문단 전체만 포함해야 하고, 첫/세 번째 문단은 포함하지 않는다.
  assert.ok(result?.excerpt.includes('두 번째 문단에는 목표 문장이 있다.'))
  assert.ok(!result?.excerpt.includes('첫 번째 문단.'))
  assert.ok(!result?.excerpt.includes('세 번째 문단.'))
})

test('마크다운 헤딩 경계에서 멈춤 확인', () => {
  const source = [
    '## 섹션 A',
    '섹션 A의 본문 내용이다.',
    '',
    '## 섹션 B',
    '섹션 B에는 목표 문장이 들어있다.',
    '',
    '## 섹션 C',
    '섹션 C의 본문이다.',
  ].join('\n')
  const itemText = '섹션 B에는 목표 문장이 들어있다.'
  const result = anchorItem(source, itemText)

  assert.ok(result)
  assert.ok(result?.excerpt.includes(itemText))
  // 헤딩을 경계로 이전/이후 섹션 본문은 포함되지 않는다.
  assert.ok(!result?.excerpt.includes('섹션 A의 본문 내용이다.'))
  assert.ok(!result?.excerpt.includes('섹션 C의 본문이다.'))
})

test('부분 일치 폴백(항목이 원문과 약간 다름)', () => {
  const source =
    '앞 문단.\n\n이것은 매우 길게 이어지는 원문 문장으로 시작해서 뒤에서 표현이 약간 달라지는 부분이 있는 문단이다.\n\n뒤 문단.'
  const sharedPrefix = '이것은 매우 길게 이어지는 원문 문장으로 시작해서 뒤에서 표현이 약간 달라' // 40자 이상, 원문과 동일
  assert.ok(sharedPrefix.length >= 40)
  // 앞부분(40자 이상)은 원문과 동일하지만 뒤쪽은 다르게(정확일치 실패하도록) 구성.
  const itemText = `${sharedPrefix}지고 [[완전히 다른 뒷부분]]으로 바뀜`
  const result = anchorItem(source, itemText)

  assert.ok(result)
  assert.ok(result!.start >= 0)
  assert.ok(result!.end > result!.start)
  assert.ok(result?.excerpt.includes('이것은 매우 길게 이어지는 원문 문장으로 시작해서'))
})

test('미매치 → null', () => {
  const source = '이 원문에는 해당 항목이 전혀 존재하지 않는다.'
  const itemText = '완전히 다른 이미지 OCR 텍스트입니다 절대 안 나옴'
  const result = anchorItem(source, itemText)

  assert.equal(result, null)
})

test('maxExcerpt 상한 준수', () => {
  const filler = '가나다라마바사아자차카타파하'.repeat(50) // 문단 하나를 아주 길게
  const source = `머리말 문단.\n\n${filler} 목표 문장 ${filler}\n\n꼬리 문단.`
  const itemText = '목표 문장'
  const maxExcerpt = 100
  const result = anchorItem(source, itemText, { maxExcerpt })

  assert.ok(result)
  assert.ok(result!.excerpt.length <= maxExcerpt)
  assert.ok(result?.excerpt.includes(itemText))
})

test('유니코드(한글) 오프셋 정확', () => {
  const source = '한글 문단 시작.\n\n여기 목표: 정확한 오프셋 검증용 한글 문장.\n\n마지막 문단.'
  const itemText = '정확한 오프셋 검증용 한글 문장.'
  const result = anchorItem(source, itemText)

  assert.ok(result)
  assert.equal(source.slice(result!.start, result!.end), itemText)
  // 코드 유닛 기준 offset이 실제 슬라이스와 일치하는지(한글 문자 폭 왜곡 없음) 확인.
  assert.equal(result!.end - result!.start, itemText.length)
})

test('빈 항목 텍스트는 null', () => {
  const source = '아무 내용.'
  const result = anchorItem(source, '')
  assert.equal(result, null)
})

test('빈 원문은 null', () => {
  const result = anchorItem('', '항목')
  assert.equal(result, null)
})
