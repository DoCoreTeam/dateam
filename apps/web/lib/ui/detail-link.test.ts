/**
 * 눌리게 생긴 것은 무언가를 한다 (정책 F-4 · U-5)
 *
 * ## 왜 이 가드가 있나
 *
 * F-4 는 두 방향을 막는다 — **볼 수 있어야 하는 것이 글자로만 남는 것**과
 * **상세가 없는 값을 억지로 누르게 만드는 것**. 뒤쪽은 기계가 셀 수 있다:
 * 손가락 모양(`cursor: pointer`)이나 `role="button"` 을 달아 놓고 손잡이가 없으면
 * 사용자는 눌러 보고 아무 일이 없는 것을 **고장으로 읽는다.**
 *
 * 앞쪽(링크가 빠진 자리)은 기계가 못 센다 — 「이 값에 상세가 있어야 하나」는 업무 판단이고,
 * 없는 링크를 전부 만들라고 강요하면 F-4 가 금지한 「상세 없는 값까지 누르게 만들기」가 된다.
 * 그래서 **새로 생기는 거짓 단추만** 좁게 막고, 빠진 링크는 사람이 화면을 볼 때 센다
 * (조사 결과는 `docs/policy/feature-coverage.md`).
 *
 * ## 세는 규칙에서 고친 것
 *
 * 처음에 26곳이 잡혔는데 **전부 오탐**이었다 — `<summary>`·`<label>`·`<select>` 는
 * 브라우저가 이미 동작을 주므로 `cursor: pointer` 를 줘도 장식이 아니고,
 * `<DateField>` 는 `onValueChange` 라는 제 이름의 콜백을 받는다.
 * 그래서 ①제 손으로 눌리는 태그는 건너뛰고 ②손잡이를 `on[A-Z]*` 전부로 넓혔다.
 * 지금은 0 곳이라 **0 에서 잠근다.**
 *
 * 가드는 만든 뒤 일부러 거짓 단추를 심어 1곳으로 잡히는 것을 확인했다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, relative } from 'node:path'
import { walkFiles, read, stripComments } from './component-scan.ts'

const WEB = join(import.meta.dirname, '..', '..')
const ROOTS = ['app', 'components'] as const

/** 브라우저가 이미 동작을 주는 태그 — 손잡이를 안 적어도 눌린다 */
const NATIVE = new Set(['summary', 'details', 'label', 'select', 'option', 'input', 'textarea', 'a', 'button', 'form'])

/** 여는 태그 한 덩어리를 뽑는다 — 중괄호 균형을 세어 `style={{…}}` 안의 `>` 에 안 속는다 */
function openTags(src: string): { name: string; attrs: string }[] {
  const out: { name: string; attrs: string }[] = []
  for (const m of src.matchAll(/<([A-Za-z][A-Za-z0-9.]*)\s/g)) {
    let i = (m.index ?? 0) + m[0].length
    let depth = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
      i++
    }
    out.push({ name: m[1], attrs: src.slice(m.index ?? 0, i + 1) })
  }
  return out
}

function fakeButtons(): string[] {
  const out: string[] = []
  for (const root of ROOTS) {
    for (const f of walkFiles(join(WEB, root), ['.tsx'])) {
      const rel = relative(WEB, f)
      if (/\.test\.tsx$/.test(rel)) continue
      for (const t of openTags(stripComments(read(f)))) {
        if (NATIVE.has(t.name)) continue
        const looksClickable = /cursor:\s*['"]?pointer/.test(t.attrs) || /role=["']button["']/.test(t.attrs)
        if (!looksClickable) continue
        const hasHandler = /\bon[A-Z]\w*\s*=/.test(t.attrs) || /href=/.test(t.attrs) || /type=["']submit/.test(t.attrs)
        if (!hasHandler) out.push(`${rel}  <${t.name}>  ${t.attrs.replace(/\s+/g, ' ').slice(0, 90)}`)
      }
    }
  }
  return out
}

test('★ 손가락 모양을 달았으면 누를 때 무언가 한다 (F-4) — 0 에서 잠근다', () => {
  const bad = fakeButtons()
  assert.deepEqual(
    bad, [],
    '눌리게 생겼는데 손잡이가 없다 — 사용자는 눌러 보고 아무 일이 없는 것을 고장으로 읽는다.\n' +
      '  상세가 없는 값이면 손가락 모양을 떼고, 갈 곳이 있으면 href 나 onClick 을 붙인다:\n  ' +
      bad.join('\n  '),
  )
})

test('★ 세는 규칙이 헛돌지 않는다 — 0 곳이 「깨끗하다」가 아니라 「안 봤다」일 수 있다', () => {
  let tags = 0
  let pointers = 0
  for (const root of ROOTS) {
    for (const f of walkFiles(join(WEB, root), ['.tsx'])) {
      if (/\.test\.tsx$/.test(f)) continue
      const src = stripComments(read(f))
      const ts = openTags(src)
      tags += ts.length
      pointers += ts.filter((t) => /cursor:\s*['"]?pointer/.test(t.attrs)).length
    }
  }
  assert.ok(tags > 10000, `여는 태그를 ${tags}개만 찾았다 — 훑는 규칙이 헛돌고 있다`)
  assert.ok(pointers > 20, `손가락 모양을 ${pointers}곳만 찾았다 — 찾는 규칙이 헛돌고 있다`)
})
