/**
 * 「미팅 끝내기」 진행 표시 가드.
 *
 * 지키는 것은 둘이다.
 *   ① 단계마다 다른 말을 한다 — 「정리하는 중…」 하나로 세 단계를 덮으면
 *      저장에서 막힌 것과 AI 가 읽는 중인 것이 같은 말이 된다.
 *   ② 화면이 그 말을 **실제로 쓴다** — 만들어 놓고 안 부르면 없는 기능이다.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  finishProgress, finishButtonLabel, finishProgressLine, FINISH_PHASE_ORDER,
} from './finish-progress.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('끝내기 진행 문구 — 단계를 덮지 않는다', () => {
  it('★ 앞 두 단계는 시간을 세지 않는다 — 1~2초짜리에 초를 세면 그게 더 불안하다', () => {
    for (const phase of ['saving', 'stopping'] as const) {
      const v = finishProgress({ phase, elapsedMs: 999_999, memoChars: 100, segmentCount: 3 })
      assert.equal(v.elapsedLabel, null, `${phase} 는 시간을 세지 않는다`)
      assert.equal(v.reassure, null)
      assert.ok(v.message.length > 0)
    }
  })

  it('★ 세 단계가 서로 다른 말을 한다 — 같으면 어디서 멈췄는지 알 수 없다', () => {
    const said = FINISH_PHASE_ORDER.map((phase) =>
      finishProgress({ phase, elapsedMs: 0, memoChars: 0, segmentCount: 0 }).message)
    assert.equal(new Set(said).size, said.length, `단계 문구가 겹친다: ${said.join(' / ')}`)
  })

  it('★ working 은 회의노트 문구를 그대로 쓴다 — 두 벌이면 같은 일에 다른 말이 나온다', () => {
    const v = finishProgress({ phase: 'working', elapsedMs: 30_000, memoChars: 750, segmentCount: 0 })
    assert.match(v.message, /메모 750자/)
    assert.equal(v.elapsedLabel, '30초')
  })

  it('오래 걸리면 오래 걸린다고 밝힌다 — 침묵은 고장으로 읽힌다', () => {
    const v = finishProgress({ phase: 'working', elapsedMs: 130_000, memoChars: 0, segmentCount: 12 })
    assert.ok(v.reassure && v.reassure.length > 0)
  })

  it('버튼 라벨 — 도는 중에는 단계를, 멈춰 있을 때는 다음 행동을 말한다', () => {
    assert.equal(finishButtonLabel('saving', false), '저장하는 중…')
    assert.equal(finishButtonLabel('stopping', false), '녹음 멈추는 중…')
    assert.equal(finishButtonLabel('working', false), '정리하는 중…')
    assert.equal(finishButtonLabel(null, false), '미팅 끝내기')
    assert.equal(finishButtonLabel(null, true), '다시 정리하기')
  })

  it('진행 줄에 「· null」 같은 것이 나가지 않는다', () => {
    const line = finishProgressLine(
      finishProgress({ phase: 'saving', elapsedMs: 0, memoChars: 0, segmentCount: 0 }))
    assert.doesNotMatch(line, /null|undefined|·\s*$/)
  })

  it('진행 표기는 용어집 규칙을 따른다 — 공백 + 말줄임표', () => {
    for (const phase of FINISH_PHASE_ORDER) {
      assert.match(finishButtonLabel(phase, false), /\s중…$/)
    }
  })
})

describe('배선 — 화면이 실제로 이 문구를 쓴다', () => {
  const screen = read('app/(crm)/crm/meetings/[id]/MeetingDetail.tsx')

  it('★ 버튼 라벨을 화면이 직접 짓지 않는다 — 하드코딩 재유입 차단', () => {
    assert.match(screen, /finishButtonLabel\(/, '버튼이 SSOT 라벨을 안 쓴다')
    assert.doesNotMatch(screen, /\?\s*'정리하는 중…'/,
      '옛 삼항 하드코딩이 되살아났다 — 이게 「멈춘 것처럼 보이는」 원인이었다')
  })

  it('★ 진행 줄을 실제로 그린다 — 계산만 하고 안 그리면 화면은 그대로다', () => {
    assert.match(screen, /finishProgress\(\{/, '진행 계산을 안 부른다')
    assert.match(screen, /finishProgressLine\(/, '진행 문구를 화면에 안 쓴다')
    assert.match(screen, /aria-live="polite"/, '진행 줄이 화면 낭독기에 안 읽힌다')
  })

  it('★ 판정은 컴포넌트 밖이다 — useEffect 안의 식은 실브라우저 말고 검증 수단이 없다(E-6)', () => {
    // 주석에는 그 말이 나온다(왜 순수 모듈인지 설명한다) — **코드**만 본다
    const mod = read('lib/crm/ui/finish-progress.ts')
    assert.doesNotMatch(mod, /from 'react'/, '순수 모듈이 리액트를 끌어왔다')
    assert.doesNotMatch(mod, /^\s*(const|let)\s+\[[^\]]+\]\s*=\s*useState/m, '순수 모듈에 상태가 들어왔다')
  })
})

describe('끝남 배지 — 작성 중과 끝낸 것을 눈으로 가른다', () => {
  const screen = read('app/(crm)/crm/meetings/[id]/MeetingDetail.tsx')

  it('★ 상세가 끝남 배지를 그린다 — 이게 없어서 두 상태가 똑같아 보였다', () => {
    assert.match(screen, /meetingFinishView\(/, '끝남 판정을 안 부른다')
    assert.match(screen, /titleAfter=/, '배지가 제목 옆에 안 선다')
  })

  it('배지 색을 화면이 정하지 않는다 — StatusKey 가 정한다(§0-2 규칙 4)', () => {
    const mod = read('lib/crm/ui/meeting-status.ts')
    assert.match(mod, /status: 'done'/, '끝남이 StatusKey 에 매핑되지 않았다')
  })
})
