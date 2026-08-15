// lib/ui/css-defined.test.ts — "클래스는 썼는데 CSS가 없다"를 잡는다
//
// 왜: v0.7.448에서 목록 표준 부품을 만들면서 globals.css에 규칙을 붙이는 명령이
//   앞선 실패로 끊겨 실행되지 않았다. 클래스명만 있고 규칙이 없는 상태였는데
//   tsc·단위테스트·design:check가 **전부 초록**이었다(정적 검사는 CSS 존재를 안 본다).
//   실브라우저를 열고 나서야 도구줄이 세로로 무너진 걸 발견했다.
//
// 이 가드는 공용 부품이 쓰는 시스템 클래스가 globals.css에 실제로 정의돼 있는지 본다.
// 도메인 클래스(gpu-*, ci-* 등)는 대상이 아니다 — 시스템이 책임지는 접두어만 본다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read } from './component-scan.ts'

/**
 * globals.css가 정의를 책임지는 접두어.
 * 도메인 접두어(ci-·gpu-·work-…)도 넣는다 — 클래스 이름을 바꿀 때 쓰는 쪽이 남으면
 * 화면이 스타일 없이 렌더된다. v0.7.445에 실제로 그랬다(ci-stage-* → seg-tab-stage-*로
 * 바꾸면서 CI 5화면의 탭이 글자만 붙어 나왔고, 어떤 검사도 잡지 못했다).
 */
const SYSTEM_PREFIXES = [
  'list-', 'seg-', 'empty-state', 'error-state', 'sort-icon',
  'app-dock', 'shell-', 'skel',
  'ci-', 'gpu-', 'work-', 'daily-', 'cockpit-', 'weekly-',
  // v0.7.456 추가 — `nb-danger`가 **정의 없이** 쓰이고 있었다. NbButton variant="danger"가
  // `btn-primary nb-danger`를 붙이는데 규칙이 없어, 앱 전체의 삭제 버튼이 일반 버튼과
  // 똑같은 파란색으로 렌더됐다. 되돌릴 수 없는 동작이 안전한 동작과 구분되지 않았다.
  'nb-', 'inline-error', 'slide-panel',
]

/**
 * 이미 규칙 없이 쓰이던 클래스(GPU 화면) — **늘리지 말 것.**
 * 지금 화면에서 스타일이 빠진 채 렌더되고 있다는 뜻이다.
 *
 * v0.7.469에서 비웠다. 다섯 중 넷(gpu-unified-cur·gpu-admin-tab·gpu-gate-cell-spec·
 * gpu-input)은 **쓰는 곳이 이미 없었다** — 예외만 남아 썩고 있었다.
 * 남은 gpu-group-header는 규칙이 없어 아무 일도 안 하면서 "내가 꾸민다"고 말만 하고 있었고
 * (실제 모양은 같은 태그의 인라인 style이 만든다), 세 곳에서 지웠다.
 */
const PENDING = new Set<string>([])

/** 유틸/외부 규약 — globals.css가 아닌 곳에서 오거나 상태 표시용 */
const IGNORE = new Set(['is-active', 'is-clickable', 'sr-only'])

function usedClasses(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const file of [...walkFiles('components', ['.tsx']), ...walkFiles('app', ['.tsx'])]) {
    const src = read(file)
    // className="a b" / className={`a ${x} b`} 양쪽에서 리터럴 토큰만 걷는다.
    // **className 밖의 클래스 문자열도 본다** — `nb-danger`는 컴포넌트 안의
    // `VARIANT_CLASS = { danger: 'btn-primary nb-danger' }` 상수에 있어서
    // className만 훑던 옛 가드가 통째로 놓쳤다(v0.7.456 실브라우저에서 발견).
    // 따옴표 리터럴은 **토큰 2개 이상**(= 클래스 목록)일 때만 본다.
    // 단일 토큰은 라우트('weekly-report')·이벤트키('daily-saved')와 구분이 안 돼 오탐이 난다.
    const re = /className=(?:"([^"]*)"|\{`([^`]*)`\})|'([a-z][\w-]*(?: [a-z][\w-]*)+)'/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      // 보간(${…})이 붙은 토큰은 조각이라 클래스명이 아니다 — 표식을 남겨 걸러낸다
      const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '\u0000')
      for (const token of raw.split(/\s+/)) {
        if (!token || token.includes('\u0000') || IGNORE.has(token)) continue
        if (!SYSTEM_PREFIXES.some((p) => token.startsWith(p))) continue
        used.set(token, [...(used.get(token) ?? []), file])
      }
    }
  }
  return used
}

test('화면·부품이 쓰는 클래스는 globals.css에 정의돼 있다', () => {
  const css = read('app/globals.css')
  const missing: string[] = []
  for (const [token, files] of usedClasses()) {
    // `.token`이 선택자로 등장하는지 — 뒤에 오는 문자가 클래스명 문자가 아니어야 한다
    if (new RegExp(`\\.${token.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css)) continue
    if (PENDING.has(token)) continue
    missing.push(`${token} → ${files.join(' | ')}`)
  }
  assert.deepEqual(missing, [],
    `클래스를 쓰는데 CSS 규칙이 없다(화면에서 스타일 없이 렌더된다):\n  ${missing.join('\n  ')}`)
})

test('PENDING 항목은 실제로 아직 정의가 없어야 한다 (죽은 예외 방지)', () => {
  const css = read('app/globals.css')
  const stale = [...PENDING].filter((t) => new RegExp(`\\.${t.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css))
  assert.deepEqual(stale, [], `정의가 생긴 클래스가 예외 목록에 남아 있다. 지울 것: ${stale.join(', ')}`)
})
