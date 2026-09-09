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
import { readFileSync } from 'node:fs'
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
