// scripts/session.mjs 스모크 가드 — **실제로 실행해 본다**
//
// **왜 이 파일이 생겼나**: 세션 CLI 의 오류는 `node --check` 로 안 잡힌다.
// 문법은 멀쩡하고 **그 줄이 실행될 때만** 터지는 것들이다.
//
// 실측 사고(2026-08-17, v0.7.558): 주소 겹침 경고를 붙이면서 루프 변수를 `s` 대신 `t` 로 썼다.
// `broadcast` 는 **버스 기록을 마친 뒤** 주소 목록을 찍다 `ReferenceError` 로 죽었다.
// 그래서 호출한 세션은 **성공을 실패로 읽고 같은 지시를 두 번 올렸고**, 재시도 과정에서
// `test` 라는 쓰레기 항목까지 버스에 남았다. 나는 출력을 `head -3` 으로 잘라 보고
// 성공 줄만 확인한 뒤 넘어갔다 — **끝까지 안 본 것이 원인이다.**
//
// 정적 검사로는 이 부류를 못 막는다. 그러니 **명령을 진짜 돌린다.**
// 진짜 보드(.sessions)를 더럽히지 않도록 SESSION_DIR 로 임시 디렉터리에 붙인다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `.pathname` 을 쓰면 안 된다 — 이 저장소 경로에 한글이 있어 퍼센트 인코딩된 문자열이 나오고
 * `Cannot find module '/Users/.../AX%E1%84%89...'` 로 죽는다. (가드를 처음 돌리다 잡았다)
 */
const CLI = fileURLToPath(new URL('../../../../scripts/session.mjs', import.meta.url))

/** 임시 보드에서 명령 하나를 돌린다. 죽으면 stderr 를 그대로 실패 메시지에 싣는다 */
function run(dir: string, args: string[]): string {
  try {
    return execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, SESSION_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    assert.fail(`session.mjs ${args.join(' ')} 가 죽었습니다\n${err.stderr || err.message}\n${err.stdout ?? ''}`)
  }
}

function withBoard(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'session-cli-'))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('★ 주요 명령이 실제로 실행된다 — 문법 검사로는 안 잡히는 부류다', () => {
  withBoard((dir) => {
    run(dir, ['board'])                                    // 빈 보드
    run(dir, ['claim', 'alpha', '--files', 'a.ts', '--what', '테스트'])
    run(dir, ['claim', 'beta', '--files', 'b.ts', '--what', '테스트'])
    run(dir, ['progress', 'alpha', '--node', '1단계'])
    run(dir, ['finding', 'alpha', '--scope', 'outside', '--what', '뭔가 봤다'])
    run(dir, ['board'])                                    // 세션이 있는 보드
    run(dir, ['inbox', 'alpha'])
  })
})

test('★ broadcast 가 기록만 하고 죽지 않는다 — 그게 지시를 두 번 올리게 만든 자리다', () => {
  withBoard((dir) => {
    run(dir, ['claim', 'alpha', '--files', 'a.ts', '--what', 'x'])
    run(dir, ['claim', 'beta', '--files', 'b.ts', '--what', 'y'])
    // 받는 세션이 2개 이상일 때만 주소 목록 경로를 탄다 — 사고가 난 조건이 정확히 이것이다
    const out = run(dir, ['broadcast', 'alpha', '--what', '규칙 하나', '--why', '이유', '--files', 'a.ts'])
    assert.match(out, /전파 #1/, '전파 번호를 안 찍는다')

    // 기록이 실제로 남았나 — 출력만 보고 넘어가면 "찍었는데 안 남는" 반대 사고를 놓친다
    const bus = readFileSync(join(dir, '_bus.jsonl'), 'utf8').trim().split('\n')
    assert.equal(bus.length, 1, `버스에 1건이어야 하는데 ${bus.length}건이다`)
    assert.equal(JSON.parse(bus[0]).from, 'alpha')

    run(dir, ['inbox', 'beta'])
    run(dir, ['ack', 'beta', '--note', '반영함'])
  })
})

test('★ 조회는 남의 주소를 빼앗지 않는다 — inbox 한 번에 이름이 넘어갔다', () => {
  withBoard((dir) => {
    run(dir, ['claim', 'alpha', '--files', 'a.ts', '--what', 'x'])
    const before = JSON.parse(readFileSync(join(dir, 'alpha.json'), 'utf8'))
    // 같은 창(같은 pid)이라 주소는 그대로여야 하고, 무엇보다 죽지 않아야 한다
    run(dir, ['inbox', 'alpha'])
    const after = JSON.parse(readFileSync(join(dir, 'alpha.json'), 'utf8'))
    assert.equal(after.peer?.pid ?? null, before.peer?.pid ?? null, 'inbox 가 주소를 바꿨다')
  })
})

test('release 가 세션을 끝낸다 — 종료 경로도 실행해 본다', () => {
  withBoard((dir) => {
    run(dir, ['claim', 'alpha', '--files', 'a.ts', '--what', 'x'])
    run(dir, ['release', 'alpha'])
    const out = run(dir, ['board'])
    assert.doesNotMatch(out, /^🥇?alpha\s+▓/m, 'release 했는데 활성으로 남아 있다')
  })
})

test('SESSION_DIR 을 안 주면 진짜 보드를 쓴다 — 테스트용 구멍이 기본값을 바꾸면 안 된다', () => {
  const src = readFileSync(CLI, 'utf8')
  assert.match(src, /process\.env\.SESSION_DIR \|\| join\(ROOT, '\.sessions'\)/,
    '기본 경로가 .sessions 가 아니다')
})
