/**
 * 브라우저 기본 대화상자 가드 — `alert`·`confirm`·`prompt` 를 화면에서 걷어낸다 (정책 U-7)
 *
 * ## 왜 이 가드가 있나
 *
 * 이 저장소는 **대체 부품을 이미 만들어 두고 멈춰 있었다.**
 * `components/ui/useAskDialog.tsx` 는 머리 주석에 「화면 10곳이 `window.prompt`·
 * `window.confirm`·`window.alert` 을 쓰고 있었다」고 적고 태어났는데,
 * 실측(v0.10.818) 결과 **아직 80곳 / 35파일**이 그대로였다. 옮긴 것은 10곳뿐이다.
 *
 * 규칙을 글로만 두면 지켜지지 않는다 — 용어집(§0-2)이 겪은 일과 같고,
 * 버전 규칙이 열일곱 판 동안 안 지켜진 것과 같다. 그래서 **센다.**
 *
 * ## 왜 브라우저 기본 대화상자를 쓰면 안 되나
 *
 * ① 우리 디자인 밖이라 테마·글꼴·단추 배치가 제품과 따로 논다
 * ② **페이지의 다른 동작을 통째로 막는다** — 자동화와 다른 탭까지 멈춘다
 * ③ 「정말 진행하시겠습니까?」밖에 못 담는다. 대상과 영향을 보일 자리가 없다(U-7)
 * ④ `alert(data?.error)` 처럼 **서버 오류 원문을 그대로 띄우기 쉽다** — 내부 구조가
 *    화면에 샌다(7절 S3)
 *
 * ## 잠금 방식
 *
 * `prompt` 는 지금 0 건이라 **0 에서 잠근다.** `alert`·`confirm` 은 80 건이라
 * 즉시 차단하면 아무 일도 못 하므로 **ratchet** 으로 걸고, 옮기는 항목마다 내려간다.
 * 마지막 항목에서 0 이 되면 0 에서 잠긴다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walkFiles, read, stripComments } from './component-scan.ts'

const WEB = join(import.meta.dirname, '..', '..')
const BASELINE = join(WEB, 'scripts/.product-copy-baseline.json')

/** 화면이 그리는 자리만 본다 — 서버 코드에는 이 함수들이 애초에 없다 */
const ROOTS = ['app', 'components'] as const

/** 이 가드 자신과 대체 부품은 대상이 아니다 — 금지할 것을 **정의하고 대신하는** 자리다 */
const SKIP = [/native-dialog\.test\.ts$/, /useAskDialog\.tsx$/]

/**
 * `alert(` 을 센다.
 *
 * **앞 글자를 본다.** `.alert(` 은 우리 객체의 메서드일 수 있고(`toast.alert(...)`),
 * `confirmDelete(` 는 우리 함수다. 그래서 식별자 문자나 점이 앞에 붙은 것은 세지 않는다.
 * `window.alert(` 은 센다 — 같은 브라우저 대화상자다.
 */
function countCalls(src: string, name: string): number {
  const body = stripComments(src)
  const re = new RegExp(String.raw`(?:^|[^.\w$])(?:window\s*\.\s*)?${name}\s*\(`, 'g')
  return [...body.matchAll(re)].length
}

interface Hit { file: string; kind: string; n: number }

function scan(): Hit[] {
  const out: Hit[] = []
  for (const root of ROOTS) {
    const dir = join(WEB, root)
    if (!existsSync(dir)) continue
    for (const f of walkFiles(dir)) {
      const rel = relative(WEB, f)
      if (/\.test\.tsx?$/.test(rel) || SKIP.some((re) => re.test(rel))) continue
      const src = read(f)
      for (const kind of ['alert', 'confirm', 'prompt']) {
        const n = countCalls(src, kind)
        if (n > 0) out.push({ file: rel, kind, n })
      }
    }
  }
  return out
}

const total = (hits: Hit[], kinds: readonly string[]): number =>
  hits.filter((h) => kinds.includes(h.kind)).reduce((s, h) => s + h.n, 0)

interface Counts { nativeDialog?: number }

function loadBaseline(): Counts {
  if (!existsSync(BASELINE)) return {}
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as Counts
}

test('★ 브라우저 기본 대화상자가 지금보다 늘지 않는다 (U-7)', () => {
  const hits = scan()
  const now = total(hits, ['alert', 'confirm'])
  const base = loadBaseline()
  const limit = base.nativeDialog ?? Infinity

  const worst = hits
    .filter((h) => h.kind !== 'prompt')
    .sort((a, b) => b.n - a.n)
    .slice(0, 12)
    .map((h) => `${h.file} — ${h.kind} ${h.n}건`)

  assert.ok(
    now <= limit,
    `브라우저 기본 대화상자가 ${limit}건에서 ${now}건으로 늘었다.\n` +
      `  대신 쓸 것: components/ui/useAskDialog (묻기·알리기) · ConfirmDeleteDialog (되돌릴 수 없는 삭제)\n  ` +
      worst.join('\n  '),
  )

  // 훑기가 헛돌면 0 이 저장되어 그 뒤로 멀쩡한 코드가 전부 새 위반이 된다
  // (glossary 가드가 2026-08-31 에 baseline 을 통째로 비운 결함)
  const sane = hits.length > 0 || now === 0
  if (now < limit && Number.isFinite(limit) && sane) {
    writeFileSync(BASELINE, JSON.stringify({ ...base, nativeDialog: now }, null, 2) + '\n')
  }
})

test('★ window.prompt 는 0 에서 잠근다 — 한 칸 묻기는 ask.text 가 한다', () => {
  const hits = scan().filter((h) => h.kind === 'prompt')
  assert.deepEqual(
    hits.map((h) => `${h.file} — ${h.n}건`),
    [],
    'window.prompt 를 쓴다 — 대신 useAskDialog 의 ask.text 를 쓴다',
  )
})

test('★ 대체 부품이 실재하고 실제로 쓰이고 있다 — 가리킬 곳이 없으면 규칙이 헛말이다', () => {
  for (const p of ['components/ui/useAskDialog.tsx', 'components/ui/ConfirmDeleteDialog.tsx']) {
    assert.ok(existsSync(join(WEB, p)), `U-7 이 없는 파일을 가리킨다: ${p}`)
  }
  const users = ROOTS.flatMap((r) => walkFiles(join(WEB, r)))
    .filter((f) => !/\.test\.tsx?$/.test(f) && /useAskDialog\(\)/.test(read(f)))
  assert.ok(users.length >= 5, `대체 부품을 쓰는 화면이 ${users.length}곳뿐이다 — 이관이 멈췄다`)
})

test('★ 세는 규칙이 우리 함수를 오탐하지 않는다', () => {
  // 우리 것은 안 센다
  assert.equal(countCalls("toast.alert('x')", 'alert'), 0, '메서드 호출을 셌다')
  assert.equal(countCalls("confirmDelete('x')", 'confirm'), 0, 'confirmDelete 를 셌다')
  assert.equal(countCalls('await ask.confirm({})', 'confirm'), 0, 'ask.confirm 을 셌다')
  // 브라우저 것은 센다
  assert.equal(countCalls("alert('x')", 'alert'), 1, '맨몸 alert 를 놓쳤다')
  assert.equal(countCalls("window.alert('x')", 'alert'), 1, 'window.alert 를 놓쳤다')
  assert.equal(countCalls("if (!confirm('x')) return", 'confirm'), 1, '맨몸 confirm 을 놓쳤다')
  // 주석 속 예시는 안 센다
  assert.equal(countCalls("// alert('x') 처럼 쓰지 말 것", 'alert'), 0, '주석을 셌다')
})
