// 회귀 코퍼스 — 실제 실패 fixture(golden-set의 *_FIXTURES)를 결정론 레이어에 통과시켜 회귀 고정.
//  golden-eval.test.ts는 intake-routing→repository→next/cache 결합으로 node:test 미로드(보류) →
//  본 파일은 순수 결정론 모듈(canonical·validate·format)만 import해 항상 실행되는 회귀 가드.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sameModel, coreModelKey } from './canonical-model.ts'
import { validateSupplierItem } from './validate.ts'
import { fmtUSD } from './format-price.ts'
import { MODEL_KEY_FIXTURES, NON_NUMERIC_PRICE_CELLS, USD_FORMAT_FIXTURES } from './golden-set.ts'

test('회귀 코퍼스 — 모델명 trailing 부호/공백이 카탈로그 매칭을 깨지 않음(F1)', () => {
  for (const { raw, sameAs } of MODEL_KEY_FIXTURES) {
    assert.equal(coreModelKey(raw), coreModelKey(sameAs), `${raw} ≠ ${sameAs}`)
    assert.equal(sameModel(raw, sameAs), true, `sameModel(${raw}, ${sameAs})`)
  }
  // 과병합 금지 — 다른 모델은 여전히 분리
  assert.equal(sameModel('H200 141GB.', 'H100 80GB.'), false)
})

test('회귀 코퍼스 — 무가격/문의 셀(X·확인중·Custom)은 가격검증 차단(숫자 아님)', () => {
  for (const cell of NON_NUMERIC_PRICE_CELLS) {
    const r = validateSupplierItem({ extracted: { model_name: 'H100', unit_price_usd: cell } })
    assert.equal(r.ok, false, `'${cell}' 가격은 차단돼야 함`)
  }
  // preserveNoPrice면 무가격을 warn로 보존(RC-C) — 단 모델명은 있어야
  const preserved = validateSupplierItem({ extracted: { model_name: 'H100', unit_price_usd: 'X' } }, { preserveNoPrice: true })
  assert.equal(preserved.ok, true)
})

test('회귀 코퍼스 — USD 무한소수는 ceil 3자리로 표시(USD 사고)', () => {
  for (const { v, expect } of USD_FORMAT_FIXTURES) {
    assert.equal(fmtUSD(v), expect, `fmtUSD(${v})`)
  }
})
