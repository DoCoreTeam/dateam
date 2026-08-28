/**
 * 문서 내보내기 표준 — 화면을 그대로 인쇄하지 않는다
 *
 * **왜 가드가 필요한가**: 견적서를 인쇄했더니 사이드바·상단 바(회의 모드·알림·검색·전체 메뉴)와
 * 회색 앱 배경이 고객에게 가는 PDF 에 그대로 찍혔다(사용자 지적 2026-08-28).
 * 인쇄 CSS 를 고치는 방식은 앱에 요소가 하나 늘 때마다 다시 깨진다 —
 * 그래서 **문서는 `DocSurface` 안에서만 인쇄·내보내기**한다는 규칙을 세웠고,
 * 규칙은 잠그지 않으면 다음 문서(계약서·거래명세서)에서 그대로 반복된다.
 *
 * 사용자 지시 원문: 「별도의 미리보기를 만들고 거기서 엑셀, PDF, 이미지 내려 받도록 하고 우리 정책이다」
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// URL.pathname 은 한글 경로를 퍼센트 인코딩한다 — 그러면 훑을 파일이 0개가 되어
// 가드가 아무것도 안 보고 통과한다(money-ssot 가드에서 실제로 겪었다)
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const SURFACE = 'components/ui/doc/DocSurface.tsx'

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(join(ROOT, dir)) } catch { return out }
  for (const e of entries) {
    const rel = `${dir}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (/\.tsx$/.test(e) && !/\.test\.tsx$/.test(e)) out.push(rel)
  }
  return out
}

const FILES = [...walk('app'), ...walk('components')]

test('가드가 실제로 파일을 훑는다 — 0개를 훑고 통과하면 가드가 아니다', () => {
  assert.ok(FILES.length > 100, `훑은 파일 ${FILES.length}개 — 경로가 틀렸다`)
})

test('★ window.print() 는 DocSurface 안에서만 부른다 — 화면을 그대로 인쇄하지 않는다', () => {
  const offenders: string[] = []
  for (const f of FILES) {
    const src = readFileSync(join(ROOT, f), 'utf8')
    if (!/window\.print\(\)/.test(src)) continue
    // 같은 파일이 DocSurface 를 쓰고 있으면 그 안에서 부르는 것이다
    if (src.includes('DocSurface')) continue
    offenders.push(f)
  }
  assert.deepEqual(offenders, [],
    `화면을 그대로 인쇄하고 있다. DocSurface 미리보기 안에서 내보낼 것:\n  ${offenders.join('\n  ')}`)
})

test('★ 문서 표면은 «보일 것만 남기는» 인쇄 규칙과 짝이다', () => {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
  assert.ok(css.includes('body.doc-printing > *:not(.doc-overlay)'),
    '오버레이 밖을 숨기는 규칙이 없다 — 앱 화면이 종이에 찍힌다')
  assert.ok(/@page\s*\{[^}]*margin:\s*0/.test(css),
    '@page 여백이 0 이 아니다 — 종이 안쪽 여백과 이중이 되어 인쇄 폭이 화면과 달라진다')
})

test('★ DocSurface 는 body 로 포털한다 — 셸 안에 있으면 인쇄에서 함께 사라진다', () => {
  const src = readFileSync(join(ROOT, SURFACE), 'utf8')
  assert.ok(src.includes('createPortal'), '포털을 안 쓴다')
  assert.ok(src.includes('document.body'), 'body 가 아닌 곳으로 포털한다')
  assert.ok(src.includes('doc-printing'), '인쇄 표시를 body 에 안 붙인다')
  assert.ok(src.includes('doc-overlay'), '인쇄 규칙이 찾는 표시가 없다')
})
