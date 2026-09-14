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
//  2) 이미 쓴 번호 재사용 — 앞 커밋과 같은 번호면 나중 것이 안 보인다
//  3) 뒤로 가기 — 최근 커밋보다 낮은 번호

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

if (recent.includes(version)) {
  fail(`v${version} 은 이미 쓴 번호입니다. 같은 번호를 두 번 쓰면 나중 커밋이 사용자에게 안 보입니다`)
}

const highest = recent.reduce((max, v) => (cmp(v, max) > 0 ? v : max), '0.0.0')
if (cmp(version, highest) < 0) {
  fail(`v${version} 이 최근 커밋 v${highest} 보다 낮습니다. 버전은 뒤로 가지 않습니다`)
}
