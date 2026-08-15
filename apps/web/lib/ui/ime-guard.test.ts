// 정적 가드 — Enter를 행동으로 바꾸는 입력은 반드시 lib/ui/ime.ts(SSOT)를 거친다.
//
// 왜: 한글 조합 확정 Enter가 그대로 "추가/제출"로 흘러가면 마지막 글자가 한 번 더 들어간다.
// (회의노트 태그 "숙명여대" → `#숙명여대` + `#대`) 화면마다 isComposing을 따로 적는 방식은
// 실측으로 21곳 중 1곳만 처리돼 있었다 — 그래서 코드로 막는다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isEnterKey, isImeComposing } from './ime.ts'

const ROOTS = ['app', 'components']

// 예외 없음. v0.7.469에서 마지막 하나(components/ci/AssistantPanel.tsx)를 이관하며 비웠다 —
// "다른 세션이 리팩터 중"이라 미뤄 뒀는데, 정작 그 화면이 이 가드가 만들어진 바로 그 버그를
// 그대로 갖고 있었다(조합 중 Enter → 마지막 글자 중복 입력).
const PENDING: string[] = []

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** 이 줄의 Enter 처리가 허용되는가. */
function isAllowed(line: string): boolean {
  if (line.includes('isEnterKey') || line.includes('isComposing')) return true // SSOT 경유
  if (line.includes("=== ' '")) return true                                    // role=button 활성화(Enter/Space)
  if (line.includes('metaKey') || line.includes('ctrlKey')) return true        // 조합키 — IME가 가로채지 않음
  return false
}

test('가드: Enter를 행동으로 바꾸는 입력은 lib/ui/ime SSOT를 거친다', () => {
  const violations: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = file.replace(/\\/g, '/')
      if (PENDING.includes(rel)) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/\.key === 'Enter'/.test(line)) return
        if (isAllowed(line)) return
        violations.push(`${rel}:${i + 1}`)
      })
    }
  }
  assert.deepEqual(
    violations,
    [],
    `맨손 Enter 처리 — isEnterKey(e)로 바꿔라(한글 조합 확정 Enter가 중복 입력된다):\n${violations.join('\n')}`,
  )
})

test('가드: PENDING 항목은 실제로 아직 위반 상태여야 한다 (죽은 예외 방지)', () => {
  for (const rel of PENDING) {
    const src = readFileSync(rel, 'utf8')
    const stillBad = src.split('\n').some((l) => /\.key === 'Enter'/.test(l) && !isAllowed(l))
    assert.ok(stillBad, `${rel}는 이미 고쳐졌다 — PENDING에서 지워라`)
  }
})

test('isImeComposing: nativeEvent.isComposing과 keyCode 229를 모두 잡는다', () => {
  assert.equal(isImeComposing({ nativeEvent: { isComposing: true } }), true)
  assert.equal(isImeComposing({ keyCode: 229 }), true) // isComposing 미지원 브라우저 폴백
  assert.equal(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 13 }), false)
  assert.equal(isImeComposing({}), false)
})

test('isEnterKey: 조합 중 Enter는 false — 이게 태그 중복 입력을 막는 지점', () => {
  assert.equal(isEnterKey({ key: 'Enter', nativeEvent: { isComposing: false } }), true)
  assert.equal(isEnterKey({ key: 'Enter', nativeEvent: { isComposing: true } }), false)
  assert.equal(isEnterKey({ key: 'Enter', keyCode: 229 }), false)
  assert.equal(isEnterKey({ key: 'a', nativeEvent: { isComposing: false } }), false)
})
