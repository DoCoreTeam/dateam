// 뱃지·알림 숫자가 **실시간으로** 줄어드는지 — 배선을 못 박는다.
//
// 실측 2026-08-31: 같은 사실을 세 곳이 따로 세는데 서로를 몰랐다.
//   ① 사이드바 「오늘 N」 — (crm)/layout.tsx 가 서버에서 센다(클라 이동으로 안 다시 그려진다)
//   ② 알림 벨 숫자      — AttentionBell 이 **열 때만** 다시 셌다
//   ③ 오늘 화면 목록    — TodayClient 가 자기 것만 다시 셌다
// 그래서 할 일을 끝내도 ③만 줄고 ①②는 그대로였다.
// (사용자 지적: "다 정리하고도 한참 뒤에 사라지던데? 알림도 다시 알림아이콘을 눌러야 사라지고?")

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

const SIGNAL = read('lib/crm/ui/attention-signal.ts')
const SYNC = read('components/crm/AttentionSync.tsx')
const LAYOUT = read('app/(crm)/layout.tsx')
const BELL = read('components/crm/AttentionBell.tsx')

/**
 * 개수를 바꾸는 화면과 **그 안의 경로 수**.
 *
 * 파일에 한 번이라도 있으면 통과시키면 안 된다 — 한 화면 안에 바꾸는 길이 여럿이라
 * (완료·삭제·생성) 하나만 빠져도 그 길로 처리했을 때만 숫자가 안 준다.
 * 그건 「가끔 되고 가끔 안 되는」 상태라 사용자가 가장 못 믿는 종류다.
 * 실제로 첫 판 가드가 개수를 안 세서, 3곳 중 1곳을 지워도 통과했다.
 */
const MUTATORS: [file: string, paths: number][] = [
  ['app/(crm)/crm/today/TodayClient.tsx', 1],      // 제안 → 할 일
  ['app/(crm)/crm/tasks/TasksClient.tsx', 3],      // 완료·삭제·생성
  ['app/(crm)/crm/inbox/SuggestionCard.tsx', 1],   // 반영·보류(한 경로)
  ['components/ui/crm/TaskPanel.tsx', 2],          // 추가·상태변경
]

test('★ 신호는 한 곳에서만 정의된다 — 두 벌이면 한쪽만 듣는다', () => {
  assert.match(SIGNAL, /export const ATTENTION_CHANGED/, '이름표가 없다')
  assert.match(SIGNAL, /export function emitAttentionChanged/, '보내는 쪽이 없다')
  assert.match(SIGNAL, /export function useAttentionChanged/, '듣는 쪽이 없다')
})

test('★ 서버가 센 사이드바 배지도 다시 세어진다 — 레이아웃은 스스로 안 갱신된다', () => {
  assert.match(LAYOUT, /<AttentionSync \/>/, '레이아웃에 동기화가 안 꽂혀 있다 — 배지가 영영 안 준다')
  assert.match(SYNC, /router\.refresh\(\)/, 'router.refresh() 없이는 서버 레이아웃이 안 다시 온다')
  assert.match(SYNC, /useAttentionChanged/, '신호를 듣지 않는다')
})

test('★ 알림 벨은 열지 않아도 줄어든다 — 눌러야 사라지던 자리다', () => {
  assert.match(BELL, /useAttentionChanged\(/, '벨이 신호를 듣지 않는다 — 다시 눌러야 사라진다')
})

test('★ 개수를 바꾸는 화면은 전부 신호를 보낸다 — 하나라도 빠지면 그 경로만 옛 숫자가 남는다', () => {
  const bad: string[] = []
  for (const [file, paths] of MUTATORS) {
    const n = (read(file).match(/emitAttentionChanged\(\)/g) ?? []).length
    if (n < paths) bad.push(`${file} — ${n}곳만 알린다(바꾸는 길은 ${paths}곳)`)
  }
  assert.deepEqual(
    bad, [],
    '개수를 바꾸고도 알리지 않는 길이 있습니다:\n' + bad.map((f) => `  ${f}`).join('\n') +
    '\n  → 서버 응답을 받은 **뒤에** emitAttentionChanged() 를 부르세요(먼저 부르면 옛 값을 다시 셉니다).',
  )
})

test('연달아 처리해도 서버를 몰아치지 않는다 — 목록에서 여러 건을 연속으로 끝낸다', () => {
  assert.match(SYNC, /COALESCE_MS/, '신호를 모으지 않으면 처리한 건수만큼 서버를 부른다')
  assert.match(SYNC, /clearTimeout/, '앞의 예약을 안 지우면 모으는 뜻이 없다')
})

test('타이머를 정리한다 — 화면을 떠난 뒤 새로고침이 돌면 안 된다', () => {
  assert.match(SYNC, /useEffect\(\(\) => \(\) => \{[\s\S]*clearTimeout/, '언마운트 정리가 없다')
})

test('서버에서도 터지지 않는다 — 이 신호는 브라우저에만 있다', () => {
  assert.match(SIGNAL, /typeof window === 'undefined'/, 'SSR 에서 window 를 만지면 렌더가 죽는다')
})
