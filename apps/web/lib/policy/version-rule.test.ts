// lib/policy/version-rule.test.ts — 버전이 안 올라 업데이트 내역이 조용히 멎는 것을 차단
//
// 왜: 화면의 버전과 「새로운 소식」 배지는 **루트 package.json 이 오를 때만** 움직인다.
//   apps/web/next.config.js:2 가 그 값을 읽어 NEXT_PUBLIC_APP_VERSION 으로 넣고,
//   apps/web/scripts/changelog-gen.mjs 는 그 값보다 낮은 커밋을 전부 건너뛴다.
//
//   실측 2026-09-10: loop-kit 이 들어온 뒤 완료형 커밋 17건이 전부 `v0.8.0:` 이었다.
//   버전 하나를 17번 복사한 것이라 package.json 은 한 번도 안 움직였고,
//   레이더·첨부 전량 읽기·원문 문서 보기·리포트 화면·Groq 모델이 **한 건도 발행되지 않았다.**
//   실패한 것이 아니라 **아무 신호도 안 난 것**이라 화면에서는 정상과 구분되지 않았다.
//
// policy-sync.test.ts 와 겹치지 않는다. 그쪽은 정책 3파일과 package.json 둘의 일치를 본다.
//   여기는 그 다음, 즉 **entries.ts 와의 관계**와 **버전 재사용**을 본다.
//
// 검사 5개:
//   1) entries.ts 맨 위 버전이 루트 package.json 보다 높지 않다 (발행이 코드를 앞설 수는 없다)
//   2) entries.ts 버전 목록에 중복이 없다
//   3) entries.ts 버전 목록이 내림차순이다 (맨 위가 최신이라는 전제가 코드 곳곳에 있다)
//   4) 기준선 이후 완료형 커밋에서 같은 버전이 두 번 나오지 않는다
//   5) 기준선 이후 완료형 커밋의 버전이 루트 package.json 을 앞서지 않는다
//
// 4·5 는 git 이 기준선에 닿을 때만 돈다. 못 닿으면 **이유를 찍고** 건너뛴다 — 조용히 통과하지 않는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

/** apps/web/lib/policy → 저장소 루트. cwd 에 의존하지 않게 파일 위치에서 거슬러 올라간다 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

/**
 * 규칙이 시작되는 자리.
 *
 * 이 커밋이 버전을 17번 재사용한 마지막 커밋이다. 그 앞은 이미 지나간 일이라 막지 않고,
 * 그 뒤부터 본다. 「기존 위반은 기준선을 두고 늘면 막는다」 는 이 저장소의 방식이다.
 */
const BASELINE = '591754ab'

/** `vX.Y.Z: 제목` — 플랜 완료나 단독 커밋. `vX.Y.Z-Ixx:` 항목 커밋은 발행 대상이 아니라 제외된다 */
const RELEASE_SUBJECT = /^v(\d+\.\d+\.\d+):\s/

function rootVersion(): string {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
}

/** entries.ts 에 적힌 버전을 파일에 적힌 순서대로 */
function changelogVersions(): string[] {
  const src = readFileSync(join(ROOT, 'apps/web/lib/changelog/entries.ts'), 'utf8')
  return [...src.matchAll(/^\s*version:\s*'([\d.]+)'/gm)].map((m) => m[1])
}

/** 양수면 a 가 높다 */
function cmp(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d }
  return 0
}

/**
 * 기준선 이후 완료형 커밋의 버전들. git 이 못 닿으면 null.
 *
 * CI 는 얕은 복제라 기준선 커밋이 없을 수 있다. 그때 예외를 삼키고 빈 배열을 주면
 * **검사가 늘 통과하는 가드**가 된다. 그래서 «못 봤다» 와 «봤는데 없다» 를 구분한다.
 */
function releaseVersionsSinceBaseline(): { versions: string[] } | { skipped: string } {
  const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    git(['rev-parse', '--is-inside-work-tree'])
  } catch {
    return { skipped: 'git 저장소가 아님' }
  }
  try {
    git(['cat-file', '-e', `${BASELINE}^{commit}`])
  } catch {
    return { skipped: `기준선 ${BASELINE} 에 못 닿음 (얕은 복제로 보임), 워크플로 체크아웃에 fetch-depth 0 필요` }
  }
  const out = git(['log', '--format=%s', `${BASELINE}..HEAD`])
  const versions: string[] = []
  for (const line of out.split('\n')) {
    const m = line.match(RELEASE_SUBJECT)
    if (m) versions.push(m[1])
  }
  return { versions }
}

test('entries.ts 맨 위 버전이 루트 package.json 을 앞서지 않는다', () => {
  const list = changelogVersions()
  assert.ok(list.length > 0, 'entries.ts 에서 버전을 하나도 못 읽었다')
  assert.ok(
    cmp(list[0], rootVersion()) <= 0,
    `발행이 코드를 앞섰다: entries.ts 맨 위 ${list[0]} > package.json ${rootVersion()}`,
  )
})

test('entries.ts 에 같은 버전이 두 번 있지 않다', () => {
  const list = changelogVersions()
  const dup = list.filter((v, i) => list.indexOf(v) !== i)
  assert.deepEqual([...new Set(dup)], [], `entries.ts 에 중복 버전: ${[...new Set(dup)].join(', ')}`)
})

test('entries.ts 는 최신이 맨 위인 내림차순이다', () => {
  const list = changelogVersions()
  const wrong = list.map((v, i) => (i > 0 && cmp(list[i - 1], v) < 0 ? `${list[i - 1]} 다음에 ${v}` : null)).filter(Boolean)
  assert.deepEqual(wrong, [], `entries.ts 순서가 어긋남: ${wrong.join(', ')}`)
})

test('기준선 이후 완료형 커밋이 같은 버전을 두 번 쓰지 않는다', () => {
  const r = releaseVersionsSinceBaseline()
  if ('skipped' in r) { console.log(`[version-rule] 커밋 검사 건너뜀: ${r.skipped}`); return }
  const seen = new Map<string, number>()
  for (const v of r.versions) seen.set(v, (seen.get(v) || 0) + 1)
  const reused = [...seen.entries()].filter(([, n]) => n > 1).map(([v, n]) => `v${v} ${n}회`)
  assert.deepEqual(
    reused, [],
    `버전을 재사용한 커밋이 있다 (${reused.join(', ')}). 앞 버전을 복사하면 그 커밋은 사용자에게 영원히 안 보인다. LOOP.md 부록 버전 규칙 참조`,
  )
})

test('기준선 이후 완료형 커밋의 버전이 루트 package.json 을 앞서지 않는다', () => {
  const r = releaseVersionsSinceBaseline()
  if ('skipped' in r) { console.log(`[version-rule] 커밋 검사 건너뜀: ${r.skipped}`); return }
  const root = rootVersion()
  const ahead = r.versions.filter((v) => cmp(v, root) > 0)
  assert.deepEqual(
    [...new Set(ahead)], [],
    `커밋 메시지는 올랐는데 package.json 이 안 올랐다: ${[...new Set(ahead)].join(', ')} > ${root}`,
  )
})

/* ── 셈법이 한 곳에만 있는가 ────────────────────────────────
   실측 사고: LOOP.md 본문 §1-2 는 「기능 추가는 minor」라 적고 부록은 「patch 1 을 더한 값」이라
   적어, 같은 파일이 반대되는 답 둘을 갖고 있었다. 플랜을 세우는 세션은 본문을 먼저 읽으므로
   셋이 전부 minor 를 집어갔고 0.7.716 이 사흘 만에 0.10.0 이 됐다. */

const LOOP_MD = readFileSync(join(ROOT, 'LOOP.md'), 'utf8')
const APPENDIX_AT = LOOP_MD.indexOf('### 버전 규칙')
const LOOP_BODY = LOOP_MD.slice(0, APPENDIX_AT === -1 ? undefined : APPENDIX_AT)

test('LOOP.md 본문이 버전 셈법을 따로 적지 않는다', () => {
  assert.ok(APPENDIX_AT > 0, 'LOOP.md 에 부록 「버전 규칙」 절이 없다')
  // 본문에 minor/patch 로 다음 버전을 정하는 문장이 있으면 부록과 갈린다
  const offenders = LOOP_BODY.split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /목표 버전/.test(line) && /(minor|patch)/.test(line))
  assert.deepEqual(offenders.map((o) => o.no), [],
    `본문이 목표 버전 셈법을 또 적는다(부록과 갈린다): ${offenders.map((o) => `${o.no}행 ${o.line.trim()}`).join(' / ')}`)
})

test('부록이 minor 를 올리는 조건을 patch 넘침 하나로만 말한다', () => {
  const appendix = LOOP_MD.slice(APPENDIX_AT)
  assert.match(appendix, /minor 는 patch 가 999 를 넘을 때만 오름/,
    '부록에 「minor 는 patch 넘침에만 오른다」가 없다 — 이 문장이 빠지면 다음 플랜이 또 minor 를 집어간다')
})

test('동시 플랜은 minor 가 아니라 patch 를 나눠 가진다', () => {
  const appendix = LOOP_MD.slice(APPENDIX_AT)
  assert.match(appendix, /patch 를 하나씩 나눠 가짐/,
    '동시 플랜 규칙이 patch 분배로 적혀 있지 않다 — 세션마다 minor 를 통째로 집어가던 원인')
})

test('돌고 있는 플랜들의 목표 버전이 서로 minor 를 따로 쓰지 않는다', () => {
  const plans = readdirSync(join(ROOT, '.loop'))
    .filter((f) => /^PLAN(\..+)?\.md$/.test(f) && f !== 'PLAN.template.md')
  const targets = plans
    .map((f) => ({ f, m: readFileSync(join(ROOT, '.loop', f), 'utf8').match(/^목표 버전:\s*v?(\d+)\.(\d+)\.(\d+)/m) }))
    .filter((x) => x.m)
    .map((x) => ({ f: x.f, minor: `${x.m![1]}.${x.m![2]}`, full: `${x.m![1]}.${x.m![2]}.${x.m![3]}` }))

  const minors = new Set(targets.map((t) => t.minor))
  assert.ok(minors.size <= 1,
    `동시에 도는 플랜이 서로 다른 minor 를 잡았다: ${targets.map((t) => `${t.f}=${t.full}`).join(', ')}. 같은 minor 안에서 patch 를 나눠 가질 것`)

  const fulls = targets.map((t) => t.full)
  assert.equal(new Set(fulls).size, fulls.length,
    `두 플랜이 같은 목표 버전을 잡았다: ${targets.map((t) => `${t.f}=${t.full}`).join(', ')}`)
})
