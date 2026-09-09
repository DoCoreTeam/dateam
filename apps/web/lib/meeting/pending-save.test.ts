/**
 * 미저장 글 밀어넣기 가드.
 *
 * 지키는 것은 셋이다.
 *   ① 「할 게 없었다」와 「실패했다」를 절대 같은 값으로 두지 않는다 —
 *      부르는 쪽이 「옛 글로 정리할 것인가」를 판단할 수 있어야 한다.
 *   ② 저장이 매달려도 끝난다 — 안 그러면 이 모듈이 고치려던 화면이 다시 만들어진다.
 *   ③ **저장이 정리보다 먼저다** — 순서가 뒤집히면 방금 적은 문장이 정리에서 빠진다.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  registerPendingSave, flushPendingSaves, hasPendingSaves, clearPendingSaves,
  FLUSH_TIMEOUT_MS, type FlushOutcome,
} from './pending-save.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

beforeEach(() => clearPendingSaves())

describe('밀어넣기 — 실패를 숨기지 않는다', () => {
  it('등록이 없으면 부를 필요도 없다', async () => {
    assert.equal(hasPendingSaves(), false)
    assert.deepEqual(await flushPendingSaves(), { saved: 0, nothing: 0, failed: 0 })
  })

  it('★ 세 결과를 구분해 센다 — 「보낼 게 없었다」와 「실패했다」는 다른 사실이다', async () => {
    registerPendingSave('a', async () => 'saved')
    registerPendingSave('b', async () => 'nothing')
    registerPendingSave('c', async () => 'failed')
    assert.deepEqual(await flushPendingSaves(), { saved: 1, nothing: 1, failed: 1 })
  })

  it('★ 하나가 실패해도 나머지는 간다 — 한 편집기 때문에 회의 전체를 잃지 않는다', async () => {
    registerPendingSave('ok', async () => 'saved')
    registerPendingSave('boom', async () => { throw new Error('네트워크') })
    assert.deepEqual(await flushPendingSaves(), { saved: 1, nothing: 0, failed: 1 })
  })

  it('동기적으로 던져도 failed 다 — Promise 로 감싸기 전에 터지는 경우', async () => {
    registerPendingSave('sync-throw', (() => { throw new Error('즉시') }) as never)
    assert.deepEqual(await flushPendingSaves(), { saved: 0, nothing: 0, failed: 1 })
  })

  it('★ 시간 제한이 실제로 걸려 있다 — 이 배선이 빠지면 아래 시험이 «실패»가 아니라 «영원히 매달림»이 된다', () => {
    // 정적 확인을 먼저 둔다: 실측으로, 배선을 빼면 실행이 끝나지 않아 무엇이 깨졌는지 읽을 수 없었다
    const mod = read('lib/meeting/pending-save.ts')
    assert.match(mod, /return withTimeout\(started, timeoutMs\)/, '밀어넣기에 시간 제한이 안 걸렸다')
  })

  it('★ 매달리면 끝낸다 — 시간 제한이 없으면 끝내기 전체가 영원히 기다린다(B-4)', async () => {
    registerPendingSave('hang', () => new Promise<FlushOutcome>(() => {}))
    const started = Date.now()
    /*
      시험 자체가 매달리지 않게 잠근다 — 매달리면 이 파일의 남은 시험이 통째로 안 돌고,
      보고서에는 «실패»가 아니라 «아무 말 없음»이 남는다. 그건 가드가 아니다.
    */
    const out = await Promise.race([
      flushPendingSaves(30),
      new Promise<'매달림'>((r) => setTimeout(() => r('매달림'), 3_000)),
    ])
    assert.notEqual(out, '매달림', '시간 제한이 안 걸려 영원히 기다렸다')
    assert.deepEqual(out, { saved: 0, nothing: 0, failed: 1 })
    assert.ok(Date.now() - started < 2_000, '시간 제한이 안 걸렸다')
  })

  it('기본 시간 제한은 디바운스 한 판보다 넉넉하다', () => {
    assert.ok(FLUSH_TIMEOUT_MS >= 5_000, '5초 디바운스를 밀어 넣을 시간이 안 된다')
    assert.ok(FLUSH_TIMEOUT_MS <= 15_000, '너무 길면 끝내기가 그만큼 멈춰 보인다')
  })

  it('★ 등록 해제가 남의 것을 지우지 않는다 — 편집기가 다시 그려질 때 나는 사고다', async () => {
    const off = registerPendingSave('k', async () => 'saved')
    registerPendingSave('k', async () => 'nothing')   // 같은 키로 새 편집기가 등록
    off()                                             // 옛 편집기가 뒤늦게 정리
    assert.equal(hasPendingSaves(), true, '새 편집기의 등록까지 지워졌다')
    assert.deepEqual(await flushPendingSaves(), { saved: 0, nothing: 1, failed: 0 })
  })

  it('같은 키로 다시 등록하면 덮어쓴다 — 사라진 화면의 값을 저장하지 않는다', async () => {
    registerPendingSave('k', async () => 'saved')
    registerPendingSave('k', async () => 'nothing')
    assert.deepEqual(await flushPendingSaves(), { saved: 0, nothing: 1, failed: 0 })
  })
})

describe('배선 — 등록하는 쪽과 부르는 쪽이 모두 있다', () => {
  const editor = read('components/meeting/MeetingMemoEditor.tsx')
  const screen = read('app/(crm)/crm/meetings/[id]/MeetingDetail.tsx')

  it('★ 편집기가 자기를 등록한다 — 등록이 없으면 밀어 넣을 것도 없다', () => {
    assert.match(editor, /registerPendingSave\(/, '편집기가 등록하지 않는다')
    assert.match(editor, /Promise<FlushOutcome>/, '저장 결과를 구분해 돌려주지 않는다')
  })

  it('고칠 수 없는 사람은 등록하지 않는다 — 저장할 권한이 없으니 밀어 넣을 것도 없다', () => {
    assert.match(editor, /if \(!canEdit\) return\s*\n\s*return registerPendingSave/,
      '읽기 전용 화면까지 등록한다')
  })

  it('★ 끝내기가 저장을 **정리보다 먼저** 부른다 — 순서가 이 기능의 전부다', () => {
    const flushAt = screen.indexOf('flushPendingSaves(')
    const finishAt = screen.indexOf('/finish`, { method:')
    assert.ok(flushAt > 0, '끝내기가 미저장 글을 밀어 넣지 않는다')
    assert.ok(finishAt > 0, '끝내기 요청을 못 찾았다 — 가드가 헛돈다')
    assert.ok(flushAt < finishAt,
      '정리를 먼저 시작한다 — 방금 적은 문장이 빠진 글을 읽게 된다')
  })

  it('★ 저장 실패를 조용히 넘기지 않는다 — 사용자는 빠졌다는 사실을 알 방법이 없다', () => {
    assert.match(screen, /flushed\.failed > 0/, '실패 개수를 보지 않는다')
  })

  it('★ 판정은 컴포넌트 밖이다 — 저장 대기·시간 초과는 실브라우저에서 재현하기 어렵다(E-6)', () => {
    const mod = read('lib/meeting/pending-save.ts')
    assert.doesNotMatch(mod, /from 'react'/, '순수 모듈이 리액트를 끌어왔다')
  })
})
