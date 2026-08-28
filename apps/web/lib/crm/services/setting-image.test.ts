// 견적서 이미지 검증 — 여기 통과한 값은 **엑셀과 인쇄본에 그대로 박힌다**
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertImage, IMAGE_MAX_BYTES } from './setting.ts'

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('PNG·JPG 는 통과한다', () => {
  assert.doesNotThrow(() => assertImage(PNG_1x1, 'k'))
  assert.doesNotThrow(() => assertImage('data:image/jpeg;base64,/9j/4AAQSkZJRg==', 'k'))
})

test('SVG 는 막고 **왜 막는지** 말한다 — 스크립트가 함께 실린다', () => {
  assert.throws(
    () => assertImage('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==', 'k'),
    /SVG 는 넣을 수 없어요.*스크립트/s,
  )
})

test('형식이 아예 아니면 SVG 얘기를 하지 않는다 — 안 넣은 것을 탓하지 않는다', () => {
  for (const bad of ['https://example.com/logo.png', '', 'logo.png', 'data:text/plain;base64,QQ==']) {
    assert.throws(() => assertImage(bad, 'k'), (e: Error) => {
      assert.match(e.message, /PNG 또는 JPG 파일을 골라 주세요/)
      assert.ok(!e.message.includes('SVG'), `«${bad}» 인데 SVG 를 탓한다`)
      return true
    })
  }
})

test('상한을 넘으면 **지금 몇 KB 인지** 말한다 — 얼마나 줄일지 알아야 한다', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(Math.ceil(IMAGE_MAX_BYTES * 4 / 3) + 4000)
  assert.throws(() => assertImage(big, 'k'), /이미지가 너무 큽니다 — \d+KB.*512KB 이하/)
})

test('상한 언저리는 통과한다 — 경계에서 못 넣는 일이 없게', () => {
  // 정확히 상한에 맞춘 base64(패딩 없음)
  const b64 = 'A'.repeat(Math.floor(IMAGE_MAX_BYTES * 4 / 3 / 4) * 4)
  assert.doesNotThrow(() => assertImage('data:image/png;base64,' + b64, 'k'))
})

test('base64 가 아닌 글자가 섞이면 막는다', () => {
  assert.throws(() => assertImage('data:image/png;base64,아니오', 'k'))
})
