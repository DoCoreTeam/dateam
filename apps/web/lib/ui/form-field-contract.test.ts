// lib/ui/form-field-contract.test.ts — 폼 입력이 표준 필드로 렌더되는지 지킨다 (§2-1)
//
// 왜: globals.css에는 input/select/textarea 전역 스타일이 **없다.**
//   클래스가 없으면 100% 브라우저 기본으로 렌더돼 통합 디자인에서 이탈한다.
//   design:check도 같은 성격을 보지만 baseline 동결 ratchet이라 **기존 잔여는 통과**시킨다.
//   여기서는 "고쳐 놓은 것이 되돌아가는" 두 형태를 잡는다.
//
// ① className 중복 — 같은 태그에 className을 두 번 쓰면 **뒤엣것만 살아남는다.**
//    앞에 붙인 input-field는 조용히 죽는다. tsc가 잡아주긴 하지만,
//    이 가드는 원인을 이름으로 말해 준다(자동 치환 도구가 만든 사고였다).
// ② 토글류 오염 — checkbox/radio 등 **네이티브 위젯**에 input-field를 붙이면
//    필드 배경·보더·radius·width:100%가 체크 렌더와 싸운다.
//    숨긴 입력(hidden · display:none)도 대상 — 안 보이는 것에 필드 스타일은 무의미하고,
//    "표준을 지켰다"는 착시만 만든다.
//    **보이는 `type="file"`은 제외**한다. 실화면(/ci/assets)에서 확인해 보니
//    바로 위 텍스트 입력과 같은 상자로 렌더돼 오히려 일관적이다 — 그건 정상적인 필드다.
//
// (v0.7.460 실제 사고: 정규식이 `onChange={(e) => …}`의 화살표 `>`를 태그 끝으로
//  오인해 뒤쪽 속성을 못 봤고, 그 결과 중복 8곳·토글 오염 2곳이 한 번에 유입됐다.
//  그래서 이 가드는 정규식이 아니라 component-scan의 findJsxTags를 쓴다.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read, findJsxTags, jsxTagEnd } from './component-scan.ts'

const FIELD_TAGS = ['input', 'select', 'textarea'] as const

/** 네이티브 위젯 — 필드 스타일이 렌더와 싸운다 */
const NATIVE_WIDGET = /type=["'](?:checkbox|radio|range|color)["']/
/** 안 보이는 입력 — 필드 스타일이 무의미하다 */
const INVISIBLE = /type=["']hidden["']|display:\s*['"]none['"]/

function isFieldStyleTarget(attrs: string): boolean {
  return !NATIVE_WIDGET.test(attrs) && !INVISIBLE.test(attrs)
}

function scanFiles(): { file: string; src: string }[] {
  return [...walkFiles('components', ['.tsx']), ...walkFiles('app', ['.tsx'])]
    .map((file) => ({ file, src: read(file) }))
}

test('한 태그에 className을 두 번 쓰지 않는다 (뒤엣것만 살아남아 앞의 클래스가 조용히 죽는다)', () => {
  const offenders: string[] = []
  for (const { file, src } of scanFiles()) {
    for (const tag of findJsxTags(src, FIELD_TAGS)) {
      const count = (tag.attrs.match(/className=/g) || []).length
      if (count > 1) offenders.push(`${file}:${tag.line} <${tag.name}> className ${count}개`)
    }
  }
  assert.deepEqual(offenders, [], `className이 중복이다:\n  ${offenders.join('\n  ')}`)
})

test('네이티브 위젯·숨긴 입력에 input-field를 붙이지 않는다 (보이는 file은 정상 필드)', () => {
  const offenders: string[] = []
  for (const { file, src } of scanFiles()) {
    for (const tag of findJsxTags(src, FIELD_TAGS)) {
      if (isFieldStyleTarget(tag.attrs)) continue
      if (!/input-field/.test(tag.attrs)) continue
      offenders.push(`${file}:${tag.line} <${tag.name}>`)
    }
  }
  assert.deepEqual(offenders, [],
    `필드 스타일이 네이티브 토글 렌더를 덮는다:\n  ${offenders.join('\n  ')}`)
})

// ── 파서 자체 회귀 (이 가드가 기대는 전제) ──────────────────────────────

test('jsxTagEnd: 화살표 함수의 >를 태그 끝으로 오인하지 않는다', () => {
  const src = `<input onChange={(e) => setX(e.target.value)} className="input-field" />`
  const end = jsxTagEnd(src, '<input'.length)
  assert.equal(src.slice(0, end).includes('className="input-field"'), true,
    '화살표 >에서 끊기면 뒤쪽 className을 못 본다 — 사고의 원인이던 바로 그 지점')
})

test('jsxTagEnd: 문자열 안의 >를 태그 끝으로 오인하지 않는다', () => {
  const src = `<input placeholder="a > b" className="input-field" />`
  const end = jsxTagEnd(src, '<input'.length)
  assert.equal(src.slice(0, end).includes('className="input-field"'), true)
})

test('findJsxTags: 여러 줄에 걸친 태그의 속성을 끝까지 읽는다', () => {
  const src = [
    '<select',
    '  value={v}',
    '  onChange={(e) => set(e.target.value)}',
    '  className="input-field"',
    '>',
  ].join('\n')
  const tags = findJsxTags(src, ['select'])
  assert.equal(tags.length, 1)
  assert.equal(/input-field/.test(tags[0].attrs), true)
  assert.equal(tags[0].line, 1)
})
