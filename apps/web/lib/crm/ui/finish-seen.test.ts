/**
 * 「미팅 끝내기」 결과 상자 닫기와 답한 질문 사라짐 가드.
 *
 *   ① 확인한 잡은 다시 안 뜨고, 새 잡(다시 정리)은 다시 뜬다
 *   ② 화면이 그것을 **실제로 쓴다** — 확인 단추가 기억을 부르고, 칸을 저장하면 질문을 다시 읽는다
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { finishSeenKey, isFinishSeen, markFinishSeen } from './finish-seen.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

function memoryStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('finish-seen', () => {
  it('확인한 잡만 닫히고 새 잡은 다시 보인다', () => {
    const s = memoryStore()
    assert.equal(isFinishSeen('job-a', s), false)
    markFinishSeen('job-a', s)
    assert.equal(isFinishSeen('job-a', s), true)
    assert.equal(isFinishSeen('job-b', s), false)
    assert.equal(finishSeenKey('job-a'), 'crm.meeting.finish.seen.job-a')
  })

  it('잡 id 가 없거나 저장소가 던져도 화면을 안 죽인다', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    assert.equal(isFinishSeen('job-a', broken), false)
    assert.doesNotThrow(() => markFinishSeen('job-a', broken))
    assert.equal(isFinishSeen(null, memoryStore()), false)
    assert.equal(isFinishSeen('job-a', null), false)
  })

  it('미팅 화면이 확인 단추로 기억하고 칸 저장 뒤 질문을 다시 읽는다', () => {
    const src = read('app/(crm)/crm/meetings/[id]/MeetingDetail.tsx')
    assert.match(src, /markFinishSeen\(finishJob\.jobId/)
    assert.match(src, /isFinishSeen\(/)
    assert.match(src, /onSaved=\{\(\) => \{ void load\(\); void loadFinish\(\) \}\}/)
  })
})
