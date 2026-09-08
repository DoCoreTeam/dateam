/**
 * 사업 유형 규칙 가드
 *
 * **왜 이 가드가 있나**: 유형 목록이 코드에서 표로 내려왔다(마이그 242).
 * 표로 내리면 «코드가 막아 주던 것»이 사라진다 — 오타·중복·사라진 값이 그것이다.
 * 여기서 다시 막는다.
 *
 * 마이그레이션 시드와 코드 상수가 어긋나면 새 워크스페이스만 다른 목록을 갖게 되므로
 * 그 일치도 함께 본다(파일을 읽어 대조한다 — 눈으로 맞추는 것은 언젠가 틀린다).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  BUILTIN_BUSINESS_TYPES,
  BUSINESS_TYPE_LABEL_MAX,
  businessTypeLabelOf,
  dealBusinessTypeKey,
  isBuiltinBusinessTypeKey,
  isSameBusinessTypeLabel,
  normalizeBusinessTypeLabel,
  selectableBusinessTypes,
  sortBusinessTypes,
  validateBusinessTypeLabel,
  type BusinessTypeRow,
} from './business-type.ts'

function row(over: Partial<BusinessTypeRow> & { key: string }): BusinessTypeRow {
  return {
    id: over.key, label: over.key, position: 0, isBuiltin: false, isActive: true, ...over,
  }
}

/* ── 이름 규칙 ───────────────────────────────────────── */

test('이름이 비면 저장하지 않는다', () => {
  assert.equal(validateBusinessTypeLabel('', []), 'EMPTY')
  assert.equal(validateBusinessTypeLabel('   ', []), 'EMPTY')
  assert.equal(validateBusinessTypeLabel(null, []), 'EMPTY')
})

test('이름이 상한을 넘으면 저장하지 않는다', () => {
  assert.equal(validateBusinessTypeLabel('가'.repeat(BUSINESS_TYPE_LABEL_MAX), []), null)
  assert.equal(validateBusinessTypeLabel('가'.repeat(BUSINESS_TYPE_LABEL_MAX + 1), []), 'TOO_LONG')
})

test('같은 이름은 공백·대소문자가 달라도 중복이다', () => {
  assert.equal(validateBusinessTypeLabel('유지보수', ['유지보수']), 'DUPLICATE')
  assert.equal(validateBusinessTypeLabel(' 유지  보수 ', ['유지 보수']), 'DUPLICATE')
  assert.equal(validateBusinessTypeLabel('msp', ['MSP']), 'DUPLICATE')
  assert.equal(validateBusinessTypeLabel('유지보수', ['SI']), null)
})

test('연속 공백은 하나로 줄인다 — 「GPU  사업」과 「GPU 사업」이 둘이 되면 안 된다', () => {
  assert.equal(normalizeBusinessTypeLabel('  GPU   사업  '), 'GPU 사업')
  assert.ok(isSameBusinessTypeLabel('GPU  사업', 'gpu 사업'))
})

/* ── 기본 8종 ────────────────────────────────────────── */

test('기본 키만 예전 enum 칼럼에 함께 쓸 수 있다', () => {
  assert.ok(isBuiltinBusinessTypeKey('GPU'))
  assert.ok(isBuiltinBusinessTypeKey('CREDIT'))
  // 사용자가 추가한 유형은 Postgres enum 에 값이 없다 — 넣으면 저장이 통째로 실패한다
  assert.equal(isBuiltinBusinessTypeKey('bt_ws_abc123'), false)
  assert.equal(isBuiltinBusinessTypeKey(null), false)
  assert.equal(isBuiltinBusinessTypeKey(''), false)
})

test('마이그 242 의 시드가 코드의 기본 8종과 같다', () => {
  const sql = readFileSync(
    join(process.cwd(), '..', '..', 'supabase', 'migrations', '242_crm_business_type.sql'),
    'utf8',
  )
  for (const b of BUILTIN_BUSINESS_TYPES) {
    assert.ok(
      sql.includes(`('${b.key}',`),
      `마이그 242 시드에 ${b.key} 가 없다 — 새 워크스페이스만 다른 목록을 갖게 된다`,
    )
    assert.ok(
      sql.includes(`'${b.label}'`),
      `마이그 242 시드의 ${b.key} 이름이 코드(${b.label})와 다르다`,
    )
  }
  assert.equal(BUILTIN_BUSINESS_TYPES.length, 8)
})

/* ── 목록 순서·표시 ──────────────────────────────────── */

test('숨긴 유형은 목록 아래로 내려가되 사라지지 않는다', () => {
  const sorted = sortBusinessTypes([
    row({ key: 'A', label: 'A', position: 0, isActive: false }),
    row({ key: 'B', label: 'B', position: 1 }),
  ])
  assert.deepEqual(sorted.map((r) => r.key), ['B', 'A'])
  assert.equal(sorted.length, 2, '숨겼다고 목록에서 빼면 다시 켤 길이 없어진다')
})

test('딜 폼은 켜진 유형 + 이 딜이 이미 쓰는 유형을 보여 준다', () => {
  const rows = [
    row({ key: 'GPU', label: 'GPU', position: 0 }),
    row({ key: 'OLD', label: '옛 유형', position: 1, isActive: false }),
  ]
  assert.deepEqual(selectableBusinessTypes(rows, null).map((r) => r.key), ['GPU'])
  // 숨긴 뒤 그 딜을 수정할 때 값이 조용히 날아가면 안 된다
  assert.deepEqual(selectableBusinessTypes(rows, 'OLD').map((r) => r.key), ['GPU', 'OLD'])
})

test('모르는 키도 감추지 않는다 — 키라도 보여야 무슨 일이 있었는지 안다', () => {
  const rows = [row({ key: 'GPU', label: 'GPU 사업' })]
  assert.equal(businessTypeLabelOf('GPU', rows), 'GPU 사업')
  assert.equal(businessTypeLabelOf('bt_gone', rows), 'bt_gone')
  assert.equal(businessTypeLabelOf(null, rows), null)
  // 목록을 아직 못 받아 온 순간에도 기본 8종은 이름이 나온다
  assert.equal(businessTypeLabelOf('SOLUTION', []), '솔루션')
})

test('예전 enum 칼럼만 채워진 행도 유형이 보인다', () => {
  assert.equal(dealBusinessTypeKey({ businessTypeKey: 'bt_x', businessType: null }), 'bt_x')
  assert.equal(dealBusinessTypeKey({ businessTypeKey: null, businessType: 'SI' }), 'SI')
  assert.equal(dealBusinessTypeKey({}), null)
  assert.equal(dealBusinessTypeKey(null), null)
})

/* ── 화면이 상수를 다시 들지 않는다 ───────────────────── */

test('딜 화면·거래 조건이 BUSINESS_TYPE_ORDER 를 직접 쓰지 않는다', () => {
  const web = join(process.cwd())
  const files = [
    join(web, 'app', '(crm)', 'crm', 'deals', 'DealFormModal.tsx'),
    join(web, 'app', '(crm)', 'crm', 'deals', 'DealTableView.tsx'),
    join(web, 'app', '(crm)', 'crm', 'deals', '[id]', 'DealDetail.tsx'),
    join(web, 'app', '(crm)', 'crm', 'settings', 'QuoteTermsCard.tsx'),
  ]
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    assert.equal(
      /BUSINESS_TYPE_(ORDER|LABEL)\b(?!_TEXT)/.test(src), false,
      `${f} 가 사업 유형 상수를 직접 쓴다 — 설정에서 바꾼 이름이 이 화면에 안 따라온다`,
    )
  }
})
