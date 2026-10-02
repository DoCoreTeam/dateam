/**
 * 제품 화면 문구 가드 — 개발 지시와 구현 보고가 화면에 안 남게 (정책 U-1 · U-2 · U-3)
 *
 * ## 왜 이 가드가 있나
 *
 * 사용자가 개발 과정에서 한 말이 **그대로 화면에 붙는 일**이 되풀이됐다.
 * 「모든 기능을 한눈에 보여줘」는 **배치를 고치라는 요구**인데 화면에 「한눈에」라는
 * 설명이 붙었다. 요구는 기능으로 갚는 것이지 문구로 갚는 것이 아니다.
 *
 * 이 결함은 타입 검사도 lint 도 시험도 못 잡는다. 문법이 맞고 화면도 잘 그려지기
 * 때문이다. 틀린 것은 **무엇을 말하고 있는가** 하나뿐이라, 세는 자리가 없으면
 * 다음 사람이 똑같이 적는다 — §0-2 용어집이 이미 겪은 일이다.
 *
 * ## 두 가지 잠금을 쓴다
 *
 * - **개발 보고 문구는 0 에서 잠근다.** 실측 1건뿐이고(I03 에서 고친다) 이 말들은
 *   어떤 화면에도 있을 이유가 없다. 예외 목록으로 시작하지 않는다.
 * - **홍보 수식어와 모호한 단추명은 ratchet.** 지금 수에서 잠그고 줄면 자동으로
 *   내려간다. 즉시 차단으로 걸면 `pnpm test` 가 통째로 빨개져 아무 일도 못 한다
 *   (glossary 가드와 같은 방식).
 *
 * ## 스캔 밖에 두는 것과 그 사유
 *
 * - `lib/changelog/entries.ts` — **이미 사용자에게 나간 발표 기록**이다. 지난 판의
 *   문구를 고치는 것은 제품을 고치는 것이 아니라 기록을 고치는 것이다. 새로 쓰는
 *   블록은 정책을 따르면 된다.
 * - `lib/terms/` 와 이 가드 자신 — 금지할 말을 **정의하는** 자리라 대상이 아니다.
 * - 주석 — 규칙을 설명한 주석이 위반으로 잡히면 아무도 규칙을 안 적는다
 *   (CSP 가드가 지시문을 주석에만 두고도 통과한 전례가 있어, 반대로 **주석은 빼고**
 *   사용자에게 보이는 글만 센다).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walkFiles, read, stripComments } from './component-scan.ts'

const WEB = join(import.meta.dirname, '..', '..')
const BASELINE = join(WEB, 'scripts/.product-copy-baseline.json')

/**
 * 화면이 그리는 자리.
 *
 * **`lib` 를 통째로 본다.** 사용자에게 보이는 글이 `app` 안에만 있지 않다 —
 * 사이드바 이름은 `lib/nav`, 트레이딩 라벨은 `lib/trading`, 창구가 돌려주는 오류 문장은
 * `lib/crm/services` 에 있다. 실측(v0.10.816) 한글 문자열이 `lib` 아래 열여섯 디렉터리에
 * 흩어져 있고, 목록을 손으로 들면 **빠진 곳이 영원히 안 보인다**(가드가 `lib/trading` 을
 * 안 봐서 「이 화면에서는…」 한 줄을 처음에 놓쳤다).
 */
const ROOTS = ['app', 'components', 'lib'] as const

/** 스캔 밖 — 사유는 파일 머리 주석에 있다 */
const SKIP = [/lib\/changelog\//, /lib\/terms\//, /product-copy\.test\.ts$/]

/**
 * 사람에게 보이는 글만 뽑는다 — JSX 텍스트 노드와 문자열 리터럴.
 * 변수명·타입명·속성 키에 들어간 말은 대상이 아니다.
 */
function userFacingText(src: string): string[] {
  const s = stripComments(src)
  const out: string[] = []
  for (const m of s.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)) out.push(m[1].trim())
  for (const m of s.matchAll(/(['"`])((?:[^'"`\\]|\\.)*[가-힣](?:[^'"`\\]|\\.)*)\1/g)) out.push(m[2])
  return out.filter(Boolean)
}

function scan(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const root of ROOTS) {
    const dir = join(WEB, root)
    if (!existsSync(dir)) continue
    for (const f of walkFiles(dir)) {
      const rel = relative(WEB, f)
      if (/\.test\.tsx?$/.test(rel) || SKIP.some((re) => re.test(rel))) continue
      for (const text of userFacingText(read(f))) out.push({ file: rel, text })
    }
  }
  return out
}

/**
 * 개발 보고 문구 — **0 에서 잠근다.**
 *
 * 「이 화면에서는」이 왜 금지인가: 사용자는 자기가 어느 화면에 있는지 안다.
 * 그 말로 시작하는 문장은 거의 언제나 **구현 사정을 설명하는 말**이다.
 */
const DEV_REPORT: readonly [RegExp, string][] = [
  [/요청하신/, '사용자가 한 말을 화면이 되읊는다'],
  [/구현했습니다|구현하였|개선했습니다|개선하였|추가했습니다/, '구현 보고는 화면이 아니라 업데이트 내역에 적는다'],
  [/본 시스템은|본 서비스는/, '제품이 자기를 소개하지 않는다'],
  [/사용자 편의를 위해|편의를 위하여/, '왜 만들었는지는 사용자가 묻지 않는다'],
  [/이 화면에서는/, '구현 사정을 설명하는 말로 거의 언제나 이어진다'],
]

test('★ 개발 지시와 구현 보고가 화면에 없다 (U-1) — 0 에서 잠근다', () => {
  const bad = scan()
    .flatMap(({ file, text }) =>
      DEV_REPORT.filter(([re]) => re.test(text)).map(([, why]) => `${file} :: ${text.slice(0, 70)}  (${why})`))
  assert.deepEqual(bad, [], `화면이 개발 보고를 말한다:\n  ${bad.join('\n  ')}`)
})

/**
 * 홍보 수식어 — ratchet.
 *
 * 「한눈에」가 왜 수식어인가: 그 말은 **무엇이 보이는지를 말하지 않는다.**
 * 「일정과 업무를 한눈에 봅니다」에서 사용자가 얻는 정보는 「일정과 업무」뿐이고
 * 「한눈에」는 만든 사람의 바람이다.
 */
const PROMO = /간편하게|스마트하게|강력한|혁신적인|완벽한|한눈에|원활한|최적의|손쉽게|쉽고 빠르게/

/** 결과가 안 보이는 단추명 — 통째로 같을 때만 센다(「시작하기 전에」 같은 문장은 아니다) */
const VAGUE_LABEL = /^(시작하기|진행하기|관리|더보기|바로가기)$/

interface Counts { promo: number; vague: number }

function loadBaseline(): Counts {
  if (!existsSync(BASELINE)) return { promo: Infinity, vague: Infinity }
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as Counts
}

/**
 * 훑기가 멀쩡했는지. **이 문턱이 baseline 자동 하향을 지킨다.**
 *
 * 자동 하향은 되돌아가지 못하게 하는 장치이면서 동시에 **위험한 쓰기**다 —
 * 훑기가 헛돌아 0 을 보면 그 0 이 저장되고, 그 다음부터는 멀쩡한 코드가 전부 새 위반이 된다.
 * 실제로 glossary 가드가 그렇게 **baseline 을 통째로 비운 적이 있다**(2026-08-31,
 * 경로가 cwd 를 타서 아무 파일도 못 찾았다). 이 저장소는 작업 트리를 여러 세션이
 * 공유하므로, 옆 세션이 파일을 고치는 도중에 돌아도 같은 일이 난다.
 *
 * 그래서 **세다가 수상하면 안 적는다.** 읽기만 하고 판정은 그대로 한다.
 */
const SANE_MIN_TEXTS = 2000

/** 줄면 내려 적는다 — 되돌아가지 못하게. 단 훑기가 멀쩡할 때만 적는다 */
function ratchet(key: keyof Counts, now: number, hits: string[], scanned: number): void {
  const base = loadBaseline()
  assert.ok(
    now <= base[key],
    `${key} 위반이 ${base[key]}건에서 ${now}건으로 늘었다 (정책 U-2·U-3):\n  ${hits.slice(0, 12).join('\n  ')}`,
  )
  const sane = scanned >= SANE_MIN_TEXTS
  if (now < base[key] && Number.isFinite(base[key]) && sane) {
    writeFileSync(BASELINE, JSON.stringify({ ...base, [key]: now }, null, 2) + '\n')
  }
}

test('★ 홍보 수식어가 지금보다 늘지 않는다 (U-2)', () => {
  const all = scan()
  const hits = all.filter(({ text }) => PROMO.test(text)).map(({ file, text }) => `${file} :: ${text.slice(0, 70)}`)
  ratchet('promo', hits.length, hits, all.length)
})

test('★ 결과가 안 보이는 단추명이 지금보다 늘지 않는다 (U-3)', () => {
  const all = scan()
  const hits = all.filter(({ text }) => VAGUE_LABEL.test(text.trim())).map(({ file, text }) => `${file} :: ${text.trim()}`)
  ratchet('vague', hits.length, hits, all.length)
})

test('★ 스캔이 실제로 화면을 보고 있다 — 0건이 「깨끗하다」가 아니라 「안 돌았다」일 수 있다', () => {
  const all = scan()
  assert.ok(
    all.length >= SANE_MIN_TEXTS,
    `사용자 노출 글을 ${all.length}건만 찾았다 — 훑는 규칙이 헛돌고 있다 (자동 하향도 이 문턱으로 막힌다)`,
  )
  assert.ok(
    all.some((h) => h.file.startsWith('app/')),
    'app/ 에서 한 건도 못 찾았다 — 경로가 틀렸다',
  )
})
