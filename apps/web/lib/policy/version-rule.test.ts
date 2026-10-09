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

/* ── 한 판 번호는 한 플랜의 것인가 ──────────────────────────
   플랜 하나가 판 하나를 쓰므로(LOOP.md 부록 「버전 규칙」) 한 번호에 항목 커밋 여럿과
   완료 커밋 하나가 **잇달아** 달린다. 그러니 「두 번 쓰지 마라」가 아니라
   **「떨어진 자리에서 다시 쓰지 마라」**가 규칙이다.

   같은 번호가 이력의 두 자리에 떨어져 나타나면 그것은 **플랜 둘이 한 번호를 나눠 쓴 것**이다.
   그 모양이 2026-09-10 사고였다 — 완료형 커밋 17건이 전부 v0.8.0 이라
   레이더·첨부 전량 읽기·원문 문서 보기·리포트 화면·Groq 모델이 한 건도 발행되지 않았다.
   실패한 것이 아니라 아무 신호도 안 난 것이라 화면에서는 정상과 구분되지 않았다.

   같은 번호가 **잇달아** 있는 것은 멀쩡하다. 발행기가 번호별로 모아 메시지를 다 들고
   묶음 하나를 만든다 (실측 2026-10-09: 커밋 3개 → 묶음 1개, 메시지 3개,
   가드 lib/policy/changelog-grouping.test.ts). */

test('기준선 이후 한 판 번호가 이력의 두 자리에 떨어져 나타나지 않는다', () => {
  const r = releaseVersionsSinceBaseline()
  if ('skipped' in r) { console.log(`[version-rule] 커밋 검사 건너뜀: ${r.skipped}`); return }

  // 잇달아 같은 번호는 한 덩이로 접는다. 접은 뒤에도 두 번 나오면 떨어져 있는 것이다
  const runs = r.versions.filter((v, i) => v !== r.versions[i - 1])
  const split = [...new Set(runs.filter((v, i) => runs.indexOf(v) !== i))]

  assert.deepEqual(
    split, [],
    `한 판 번호가 떨어진 자리에서 다시 쓰였다 (${split.map((v) => `v${v}`).join(', ')}). `
    + '플랜 둘이 한 번호를 나눠 쓰면 뒤의 것이 사용자에게 영원히 안 보인다. '
    + 'LOOP.md 부록 「버전 규칙」 참조',
  )
})

test('가장 최근 판 커밋의 번호가 루트 package.json 에 반영되어 있다', () => {
  const r = releaseVersionsSinceBaseline()
  if ('skipped' in r) { console.log(`[version-rule] 커밋 검사 건너뜀: ${r.skipped}`); return }
  if (r.versions.length === 0) return // 기준선 뒤에 판 커밋이 없으면 볼 것이 없다

  /*
    번호를 썼는데 코드가 그 번호를 안 들고 있으면 발행기가 그 판을 **못 본다**.
    changelog-gen.mjs 는 package.json 버전보다 높은 커밋을 전부 건너뛰기 때문이다.
    그래서 번호를 같이 쓰는 것 자체가 아니라 **번호가 코드에 앉았는지**를 본다.
  */
  assert.equal(
    r.versions[0], rootVersion(),
    `가장 최근 판 커밋은 v${r.versions[0]} 인데 루트 package.json 은 ${rootVersion()} 이다. `
    + '버전 파일이 그 번호를 들고 있어야 발행기가 그 판을 본다 (loop pass 가 첫 항목에서 맞춘다)',
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

/** 「0.11.3」을 견줄 수 있는 수 하나로 — 자리마다 넉넉히 띄워 자릿수가 섞이지 않게 */
function versionKey(major: string, minor: string, patch: string): number {
  return Number(major) * 1_000_000 + Number(minor) * 1_000 + Number(patch)
}

test('돌고 있는 플랜들의 목표 버전이 서로 minor 를 따로 쓰지 않는다', () => {
  const now = rootVersion().match(/^(\d+)\.(\d+)\.(\d+)/)
  assert.ok(now, '루트 package.json 의 버전을 못 읽었다')
  const nowKey = versionKey(now![1], now![2], now![3])

  const plans = readdirSync(join(ROOT, '.loop'))
    .filter((f) => /^PLAN(\..+)?\.md$/.test(f) && f !== 'PLAN.template.md')
  const targets = plans
    .map((f) => ({ f, m: readFileSync(join(ROOT, '.loop', f), 'utf8').match(/^목표 버전:\s*v?(\d+)\.(\d+)\.(\d+)/m) }))
    .filter((x) => x.m)
    .map((x) => ({
      f: x.f,
      minor: `${x.m![1]}.${x.m![2]}`,
      full: `${x.m![1]}.${x.m![2]}.${x.m![3]}`,
      key: versionKey(x.m![1], x.m![2], x.m![3]),
    }))
    /*
      **이미 지나간 목표는 안 센다.** 그 플랜은 버전을 다투고 있지 않다 —
      끝났거나 버려진 것이고, 어느 쪽이든 다음 판이 쓸 번호를 집고 있지 않다.

      안 거르면 **minor 가 오르는 날 모든 새 플랜이 막힌다**: 버전이 0.11 로 넘어가자
      `.loop/` 에 남아 있던 옛 파일 넷(목표 0.10.3 · 0.10.189 · 0.10.399 · 0.10.945)이
      새 플랜의 0.11.x 와 갈려 커밋이 안 됐다(실측 2026-10-09).
      남의 플랜 파일을 지워서 푸는 것은 **그 세션의 재개 근거를 없애는 것**이라 안 한다.
    */
    .filter((t) => t.key > nowKey)

  const minors = new Set(targets.map((t) => t.minor))
  assert.ok(minors.size <= 1,
    `동시에 도는 플랜이 서로 다른 minor 를 잡았다: ${targets.map((t) => `${t.f}=${t.full}`).join(', ')}. 같은 minor 안에서 patch 를 나눠 가질 것`)

  const fulls = targets.map((t) => t.full)
  assert.equal(new Set(fulls).size, fulls.length,
    `두 플랜이 같은 목표 버전을 잡았다: ${targets.map((t) => `${t.f}=${t.full}`).join(', ')}`)
})

/* ── 항목 커밋도 한 판인가 ──────────────────────────────────
   -Ixx 꼬리가 붙은 커밋은 발행기가 건너뛴다. 그 커밋의 일은 사용자에게 영영 안 보인다.
   사용자 지시(2026-09-14): 「세 번째 패치를 올리는 방식으로 하라고, I13 이렇게 하지말고」 */

/** 이 기준선 뒤부터 본다. 그 앞의 -Ixx 커밋들은 이미 지나간 일이라 막지 않는다 */
const ITEM_SUFFIX_BASELINE = '5262630d'

test('기준선 이후 커밋 제목에 -Ixx 꼬리가 없다', () => {
  let log: string
  try {
    log = execFileSync('git', ['log', '--format=%s', `${ITEM_SUFFIX_BASELINE}..HEAD`], {
      cwd: ROOT, encoding: 'utf8',
    })
  } catch {
    return // 기준선이 이 클론에 없으면 검사하지 않는다 (얕은 클론·CI)
  }
  const offenders = log.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^v\d+\.\d+\.\d+-I\w+:/.test(l))
  assert.deepEqual(offenders, [],
    `항목 ID 꼬리가 붙은 커밋이 있다(발행기가 건너뛴다): ${offenders.join(' / ')}. vX.Y.Z: 제목 으로 적고 패치를 올릴 것`)
})

test('loop.mjs 가 항목 커밋에 패치 버전을 붙인다', () => {
  const loop = readFileSync(join(ROOT, 'scripts', 'loop.mjs'), 'utf8')
  assert.match(loop, /nextPatchVersion\(\)/, 'loop.mjs 에 다음 패치 계산이 없다')
  assert.match(loop, /applyVersionFiles\(/, 'loop.mjs 가 버전 파일을 안 올린다')
  assert.ok(!/\$\{p\.header\.target\}-\$\{id\}/.test(loop),
    'loop.mjs 가 아직 목표버전-항목ID 형식으로 커밋 메시지를 만든다')
})

test('LOOP.md 가 한 가지 커밋 형식만 말한다', () => {
  assert.ok(!/vX\.Y\.Z-Ixx/.test(LOOP_MD),
    'LOOP.md 에 vX.Y.Z-Ixx 형식이 남아 있다 — 읽는 세션이 그 형식을 쓴다')
})

/* ── 커밋되기 전에 막히는가 ─────────────────────────────────
   테스트는 커밋이 끝난 뒤에야 돈다. 실측 사고(2026-09-14): 완료 커밋이 낡은 플랜 목표값
   v0.10.2 로 나가 같은 번호가 두 번 생겼고, 되돌리려면 amend 와 태그 삭제가 필요했다.
   그래서 같은 검사를 commit-msg 훅에도 둔다 — 이 단정은 그 훅이 살아 있는지 본다. */

test('커밋 메시지 훅이 있고 버전 검사를 부른다', () => {
  const hook = readFileSync(join(ROOT, '.githooks', 'commit-msg'), 'utf8')
  assert.match(hook, /check-commit-version\.mjs/, 'commit-msg 훅이 버전 검사를 안 부른다')
})

test('버전 검사기가 네 경우를 전부 막는다', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'check-commit-version.mjs'), 'utf8')
  assert.match(src, /항목 ID 꼬리/, '항목 꼬리 검사가 없다')
  assert.match(src, /지나간 번호입니다/, '지나간 번호 되살리기 검사가 없다')
  assert.match(src, /뒤로 가지 않습니다/, '뒤로 가기 검사가 없다')
  /*
    같은 판을 이어 쓸 때 버전 파일이 그 번호를 들고 있는지 보는 자리.
    2026-09-10 사고가 여기였다 — 완료형 커밋 17건이 전부 v0.8.0 인데 package.json 이
    한 번도 안 움직여 그 판들이 **한 건도 발행되지 않았다.** 번호를 같이 쓴 것이 아니라
    그 번호가 코드에 반영되지 않은 것이 범인이었다.
  */
  assert.match(src, /루트 package\.json 은/, '판을 이을 때 버전 파일 일치 검사가 없다')
  assert.match(src, /const latest = recent\[0\]/,
    '연속 판정(바로 앞 판 번호와 비교)이 없다 — 같은 판 이어 쓰기와 지나간 번호 되살리기를 못 가른다')
})

test('loop final 이 낡은 플랜 목표값으로 커밋하지 않는다', () => {
  const loop = readFileSync(join(ROOT, 'scripts', 'loop.mjs'), 'utf8')
  // 완료 버전을 header.target 에서 바로 받으면 그 사이 오른 버전을 못 본다
  assert.ok(!/const target = p\.header\.target;/.test(loop),
    'loop.mjs 의 final 이 플랜 목표값을 그대로 완료 버전으로 쓴다')
  assert.match(loop, /const target = `v\$\{nextPatchVersion\(\)\}`/,
    'loop.mjs 의 final 이 다음 패치를 계산하지 않는다')
})

test('★ 아직 안 지난 목표 둘이 서로 다른 minor 를 잡으면 여전히 떨어진다', () => {
  /*
    「지나간 목표는 안 센다」로 거른 뒤에도 **이 가드가 사는 이유**가 남아 있어야 한다.
    거르기가 너무 넓으면 두 세션이 각자 minor 를 집어가는 그 사고를 다시 못 잡는다.

    실제 파일을 만들지 않고 **같은 판정을 손으로 돌려** 본다 — `.loop/` 에 가짜 플랜을
    떨어뜨리면 다른 세션의 resume 이 그것을 본다(남의 작업에 손대지 않는다).
  */
  const now = versionKey('0', '11', '3')
  const rows = [
    { f: 'A', minor: '0.11', key: versionKey('0', '11', '4') },   // 앞선 목표
    { f: 'B', minor: '0.12', key: versionKey('0', '12', '0') },   // 앞선 목표, 다른 minor
    { f: 'C', minor: '0.10', key: versionKey('0', '10', '3') },   // 지나간 목표 — 안 센다
  ]
  const live = rows.filter((r) => r.key > now)
  assert.equal(live.length, 2, '지나간 목표를 안 걸러 냈다')
  assert.equal(new Set(live.map((r) => r.minor)).size, 2,
    '앞선 목표 둘이 다른 minor 인데 하나로 셌다 — 이러면 세션마다 minor 를 집어가는 것을 못 잡는다')

  // 지나간 것만 남으면 셀 것이 없다(막지 않는다)
  const onlyPast = rows.filter((r) => r.key > versionKey('0', '99', '0'))
  assert.equal(onlyPast.length, 0)
})
