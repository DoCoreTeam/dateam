#!/usr/bin/env node
// 커밋 메시지의 버전을 커밋 **전에** 막는다.
//
// 왜 훅인가: 같은 검사가 apps/web/lib/policy/version-rule.test.ts 에도 있지만 그것은
// 테스트라 커밋이 끝난 뒤에야 돈다. 실측 사고(2026-09-14) — 완료 커밋이 낡은 플랜 목표값
// v0.10.2 로 나가 같은 번호가 두 번 생기고 버전이 뒤로 갔다. 가드는 잡았지만 그건
// 이미 커밋된 뒤였다. 되돌리려면 amend 와 태그 삭제가 필요했다.
//
// 막는 것 셋
//  1) vX.Y.Z-Ixx 꼬리 — 발행기가 건너뛰어 그 커밋의 일이 사용자에게 영영 안 보인다
//  2) **지나간** 번호 되살리기 — 이력에서 떨어진 자리의 번호를 다시 쓰는 것
//  3) 뒤로 가기 — 최근 커밋보다 낮은 번호
//
// 2 는 「같은 번호를 두 번 쓰지 마라」가 아니다. 플랜 하나가 판 하나를 쓰므로(LOOP.md 부록
// 「버전 규칙」) 한 판 번호에 항목 커밋 여럿과 완료 커밋 하나가 **잇달아** 달린다.
// 발행기는 그것을 제대로 다룬다 — 실측 2026-10-09, 같은 판 번호 커밋 3개를 먹여
// 묶음 1개와 메시지 3개가 나왔고 하나도 안 떨어졌다.
// 그러니 막아야 하는 것은 **연속이 끊긴 재사용**이다. 바로 앞 판 커밋과 같은 번호면
// 같은 판을 잇는 것이라 통과시키고, 그 사이에 다른 번호가 끼었으면 지나간 번호를
// 되살리는 것이라 막는다. 2026-09-14 사고가 그 모양이었다 — 항목들이 0.10.3 까지 올려
// 둔 뒤 완료 커밋이 낡은 목표 0.10.2 로 나갔다.
//
// 이어 쓰기에는 조건이 하나 붙는다. **버전 파일이 이미 그 번호를 들고 있어야 한다.**
// 2026-09-10 사고는 완료형 커밋 17건이 전부 v0.8.0 이었는데 package.json 이 한 번도
// 안 움직여, 레이더·첨부 전량 읽기·원문 문서 보기 등이 **한 건도 발행되지 않았다.**
// 번호를 같이 쓴 것이 아니라 그 번호가 코드에 반영되지 않은 것이 범인이었다.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const msgFile = process.argv[2]
if (!msgFile) process.exit(0) // 메시지 파일 없이 불리면 검사할 것이 없다

const subject = readFileSync(msgFile, 'utf8').split('\n')[0].trim()
const versioned = subject.match(/^v(\d+)\.(\d+)\.(\d+)(-\w+)?:/)
if (!versioned) process.exit(0) // 버전 커밋이 아니면 이 훅의 일이 아니다

const fail = (why) => {
  console.error(`\n❌ 커밋 차단 — ${why}`)
  console.error(`   제목: ${subject}`)
  console.error('   버전 규칙은 LOOP.md 부록 「버전 규칙」에 있습니다.\n')
  process.exit(1)
}

if (versioned[4]) {
  fail(`제목에 항목 ID 꼬리(${versioned[4]})가 붙었습니다. vX.Y.Z: 제목 으로 적고 패치를 올리세요`)
}

const version = `${versioned[1]}.${versioned[2]}.${versioned[3]}`
const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d }
  return 0
}

let recent = []
try {
  recent = execFileSync('git', ['log', '--format=%s', '-40'], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.match(/^v(\d+\.\d+\.\d+)[:-]/)?.[1])
    .filter(Boolean)
} catch { process.exit(0) } // 첫 커밋 등 로그가 없으면 비교할 것이 없다

/** 바로 앞 판 커밋의 번호. 이것과 같으면 같은 판을 잇는 것이다 */
const latest = recent[0]

if (version === latest) {
  // 같은 판을 잇는 커밋. 버전 파일이 그 번호를 들고 있는지만 확인한다 —
  // 안 들고 있으면 2026-09-10 처럼 그 판 전체가 조용히 발행되지 않는다.
  let pkgVersion = null
  try {
    pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch { /* 루트 package.json 을 못 읽으면 이 확인은 건너뛴다 */ }

  if (pkgVersion && pkgVersion !== version) {
    fail(
      `v${version} 로 판을 이으려는데 루트 package.json 은 ${pkgVersion} 입니다. `
      + '버전 파일이 그 번호를 들고 있어야 발행기가 그 판을 봅니다 (loop pass 가 첫 항목에서 맞춥니다)',
    )
  }
} else if (recent.includes(version)) {
  fail(
    `v${version} 은 지나간 번호입니다 (지금 판은 v${latest}). 이력에서 떨어진 번호를 되살리면 `
    + '버전이 뒤로 가거나 같은 번호가 두 자리에 생깁니다. 같은 판을 이으려면 바로 앞 판 번호를 쓰세요',
  )
}

const highest = recent.reduce((max, v) => (cmp(v, max) > 0 ? v : max), '0.0.0')
if (cmp(version, highest) < 0) {
  fail(`v${version} 이 최근 커밋 v${highest} 보다 낮습니다. 버전은 뒤로 가지 않습니다`)
}
