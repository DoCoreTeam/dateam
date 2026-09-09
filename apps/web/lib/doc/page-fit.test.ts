// lib/doc/page-fit.test.ts — 한 장에 맞추는 배율의 가드
//
// **여기 박힌 숫자는 전부 실측이다**(완료 조건 E-6). 크롬에서 같은 내용을 실제로 인쇄해
// 얻은 값을 그대로 단정으로 남긴다. 계산이 화면에서 떠나면 이 가드가 먼저 깨진다.
//
// 실측 방법 — A4 · `@page { margin: 0 }` · 종이 `padding: 15mm 14mm` · 본문 38문단:
//   ① 배율 1.000 → 종이 높이 1268px (한 장을 넘친다)
//   ② 배율 0.881 → 1130px (글자가 작아져 줄바꿈이 바뀌므로 한 번에 안 맞는다)
//   ③ 배율 0.871 → 1119px → **한 장**. PDF 쪽 수 1.
//
// 같은 실험에서 `transform: scale()` 은 배율을 줘도 **2쪽**이었다. 그것이 v0.7.701 까지의
// 방식이고, 이 기능이 한 번도 동작하지 않은 이유다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  A4_PAGE_H_PX, A4_H_MM, A4_W_MM, MIN_FIT, MAX_FIT_PASSES,
  clampFit, fitsOnePage, nextFit, fitPercent, stepFit, pdfPageSize,
} from './page-fit.ts'

test('★ 한 쪽 높이는 A4 전체다 — 여백을 두 번 빼지 않는다', () => {
  // 종이가 자기 여백(15mm×2)을 품고 있고 `@page` 여백은 0 이다.
  // 예전 판은 `297 − 30밀리` 로 잡아 쓸 수 있는 높이를 11퍼센트 적게 봤다.
  assert.ok(Math.abs(A4_PAGE_H_PX - 1122.52) < 0.01, `${A4_PAGE_H_PX}`)
  const 옛값 = ((297 - 30) / 25.4) * 96
  assert.ok(A4_PAGE_H_PX > 옛값 + 100, '여백을 두 번 뺀 값으로 되돌아갔다')
})

test('★ 실측 앵커 — 1268px 에서 0.881, 거기서 다시 0.871 (크롬 실측)', () => {
  const 첫판 = nextFit(1, 1268)
  assert.equal(+첫판.toFixed(3), 0.881)
  const 둘째판 = nextFit(첫판, 1130)
  assert.equal(+둘째판.toFixed(3), 0.871)
})

test('★ 실측 앵커 — 1119px 은 한 장, 1130px 은 아니다', () => {
  assert.equal(fitsOnePage(1119), true)
  assert.equal(fitsOnePage(1130), false)
  // 반올림 한 픽셀에 두 번째 쪽을 만들지 않는다
  assert.equal(fitsOnePage(A4_PAGE_H_PX + 1), true)
  assert.equal(fitsOnePage(A4_PAGE_H_PX + 2), false)
})

test('세 번이면 멈춘다 — 반복이 늘어날 일이 없다', () => {
  let f = 1
  const 높이 = [1268, 1130, 1119]
  let 회차 = 0
  for (; 회차 < MAX_FIT_PASSES; 회차 += 1) {
    const h = 높이[Math.min(회차, 높이.length - 1)]
    if (fitsOnePage(h)) break
    const next = nextFit(f, h)
    if (next >= f) break
    f = next
  }
  assert.equal(회차, 2, '실측에서 3회차에 들어갔다')
  assert.equal(+f.toFixed(3), 0.871)
})

test('★ 하한 밑으로는 안 내려간다 — 그때는 두 장이 맞다', () => {
  // 아주 긴 문서(한 쪽의 세 배)라도 0.85 밑으로 줄이지 않는다
  assert.equal(nextFit(1, A4_PAGE_H_PX * 3), MIN_FIT)
  assert.equal(clampFit(0.1), MIN_FIT)
  assert.equal(clampFit(2), 1)
  assert.equal(clampFit(Number.NaN), 1)
})

test('하한에 닿으면 더 줄이려 해도 제자리다 — 무한 반복을 만들지 않는다', () => {
  const 바닥 = nextFit(MIN_FIT, A4_PAGE_H_PX * 3)
  assert.equal(바닥, MIN_FIT, '하한에서 또 줄면 루프가 끝나지 않는다')
})

test('손으로 조절해도 하한과 1 을 벗어나지 않는다', () => {
  assert.equal(stepFit(1, 1), 1)
  assert.equal(stepFit(0.9, -1), 0.85)
  assert.equal(stepFit(MIN_FIT, -1), MIN_FIT)
  assert.equal(stepFit(0.9, 1), 0.95)
})

test('화면에 보여 줄 배율은 정수 퍼센트다', () => {
  assert.equal(fitPercent(0.871), 87)
  assert.equal(fitPercent(1), 100)
})

test('★ 한 장에 들어가면 A4 로, 넘치면 자르지 않고 내용 길이대로 한 장', () => {
  // 사용자 지적: 「이미지는 (두 장이) 아니잖아? PDF 도 이미지라면 같은 맥락 아닌지」
  const 짧다 = pdfPageSize(250)
  assert.deepEqual(짧다, { widthMm: A4_W_MM, heightMm: A4_H_MM, a4: true })

  const 길다 = pdfPageSize(420)
  assert.equal(길다.a4, false)
  assert.equal(길다.widthMm, A4_W_MM)
  assert.equal(길다.heightMm, 420, '잘라 내면 글자 한가운데가 잘린다')
})

test('A4 를 살짝 넘는 정도(1mm)는 A4 로 본다 — 반올림 때문에 종이가 길어지지 않게', () => {
  assert.equal(pdfPageSize(A4_H_MM + 1).a4, true)
  assert.equal(pdfPageSize(A4_H_MM + 2).a4, false)
})
