// lib/ui/layout-standard.test.ts — 자리의 축 가드 (정책 §2-3-2)
//
// **왜 이 가드가 생겼나**: 3열의 뜻이 `RecordLayout.tsx` **주석에만** 있어서 화면마다 다르게
// 해석됐다(실측 v0.7.599):
//   · 오른쪽 `related` 칸에 「다음 할 일」(입력 폼)이 얹혀 **행동과 정보가 한 열에 섞였다**
//   · 회사의 인물이 300px 좁은 칸으로 밀려 연락하려면 스크롤해야 했다 —
//     같은 개념이 거래처 상세에서는 **왼쪽 넓은 칸**에 있었다(정반대)
//   · 미팅 상세는 슬롯 뜻을 **정반대로** 채웠다
//   · 담당자 상세는 `max-width: 480px` 로 §2-4(폭 제한 금지)를 **정책이 있는데도** 어기고 있었다
//
// 마지막 항목이 이 가드의 존재 이유다 — **규칙이 있어도 가드가 없으면 안 지켜진다.**

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read, stripComments } from './component-scan.ts'

const ROOTS = ['app', 'components']

/**
 * 아직 레거시 3슬롯을 쓰는 화면 — **늘면 안 된다(ratchet).**
 * 이 화면을 다른 일로 건드릴 때 함께 이관하고 목록에서 지운다(§2-6 (5)과 같은 방식).
 *
 * · DealDetail — 이관 시점에 다른 세션이 수정 중이라 건드리지 않았다(M-1)
 * · MeetingDetail — 슬롯 뜻이 뒤집혀 있어 단순 이관이 아니라 **재배치**가 필요하다
 */
const LEGACY_PENDING = [
  'app/(crm)/crm/deals/[id]/DealDetail.tsx',
  'app/(crm)/crm/meetings/[id]/MeetingDetail.tsx',
]

function scan(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  for (const root of ROOTS) {
    for (const f of walkFiles(root, ['.tsx'])) {
      if (f.endsWith('RecordLayout.tsx')) continue // 부품 자신은 두 슬롯을 다 안다
      out.push({ file: f, src: stripComments(read(f)) })
    }
  }
  return out
}

test('새 화면은 레거시 3슬롯을 쓰지 않는다 — 남은 것은 늘지 않는다', () => {
  const legacy = scan()
    .filter(({ src }) => /\b(fields|related)=\{/.test(src))
    .map(({ file }) => file)
    .sort()
  assert.deepEqual(
    legacy, [...LEGACY_PENDING].sort(),
    `RecordLayout 의 info/actions 를 쓰세요(§2-3-2). 목록이 줄면 LEGACY_PENDING 에서도 지웁니다:\n${legacy.join('\n')}`,
  )
})

test('행동은 정보 열에 들어가지 않는다 (L-1)', () => {
  // 「다음 할 일」은 입력 폼 + 추가 버튼이다 — 읽는 열이 아니라 하는 열에 선다.
  // info 보다 뒤, 즉 actions 슬롯 안에 있어야 한다.
  const bad: string[] = []
  for (const { file, src } of scan()) {
    const layoutAt = src.indexOf('<RecordLayout')
    if (layoutAt === -1 || !/\binfo=\{/.test(src) || !/<TaskPanel/.test(src)) continue
    // **`<RecordLayout` 뒤에서 찾는다.** `PageHeader` 도 `actions={` 를 갖고 있어서,
    // 파일 처음부터 찾으면 그쪽이 잡혀 이 규칙이 **항상 통과**한다(초판이 그랬다 — 일부러 깨서 발견).
    const actionsAt = src.indexOf('actions={', layoutAt)
    const taskAt = src.indexOf('<TaskPanel', layoutAt)
    if (taskAt === -1) continue
    if (actionsAt === -1 || taskAt < actionsAt) bad.push(file)
  }
  assert.deepEqual(bad, [], `TaskPanel 은 actions 슬롯에 두세요(§2-3-2 L-1):\n${bad.join('\n')}`)
})

test('사람은 속성 바로 다음에 온다 (L-3)', () => {
  // 회사 화면에 오는 이유의 대부분은 "누구에게 연락하지?"다.
  // 인물 패널이 딜·미팅보다 뒤로 밀리면 연락하려고 스크롤하게 된다.
  const src = stripComments(read('app/(crm)/crm/companies/[id]/CompanyDetail.tsx'))
  const person = src.indexOf('인물 ${people.length}명')
  const deal = src.indexOf('딜 ${deals.length}건')
  const timeline = src.indexOf('title="타임라인"')
  assert.ok(person > 0 && deal > 0 && timeline > 0, '패널 제목을 찾지 못했습니다 — 가드를 고치세요')
  assert.ok(person < deal, '인물이 딜보다 먼저 와야 합니다 (L-3)')
  assert.ok(deal < timeline, '이력은 관계 뒤에 옵니다 (L-2: 속성 → 관계 → 이력)')
})

test('상세 화면은 폭을 클램프하지 않는다 (§2-4)', () => {
  // 담당자 상세가 max-width 480px 카드였다 — 정책이 있는데도 지켜지지 않던 자리다.
  const bad: string[] = []
  for (const { file, src } of scan()) {
    if (!/\[id\]/.test(file)) continue
    if (/maxWidth:\s*['"`]\d/.test(src)) bad.push(file)
  }
  assert.deepEqual(bad, [], `상세는 전체폭 반응형입니다(§2-4). 폭 제한을 지우세요:\n${bad.join('\n')}`)
})

test('서비스 간판은 SERVICE_LABEL 에서 온다 — 화면이 직접 적지 않는다', () => {
  // 왜: 로고 자리가 네 셸에서 회사 브랜드만 똑같이 띄워, 지금 CRM 인지 콘텐츠 인텔리전스인지
  // 알 수 없었다. 고친 뒤에도 화면이 이름을 직접 적으면 또 갈린다 — `/develop` 이 실제로
  // 「개발자센터」를 하드코딩하고 있었다(§0-2).
  const NAMES = ['영업 CRM', '콘텐츠 인텔리전스', '개발자센터', '업무 워크스페이스']
  const bad: string[] = []
  for (const { file, src } of scan()) {
    if (file.includes('lib/terms/')) continue
    for (const n of NAMES) {
      // 문자열 리터럴로 적은 것만 잡는다(주석은 stripComments 가 이미 걷어냈다).
      // **파일이 아니라 등장 횟수를 센다** — 파일 단위로 세면 이미 위반인 파일에는
      // 몇 개를 더 넣어도 통과한다(design:check 가 v0.7.477 에 같은 이유로 고친 구멍이다).
      const hits = src.match(new RegExp(`['"\`]${n}['"\`]`, 'g'))
      if (hits) for (const _ of hits) bad.push(`${file} — ${n}`)
    }
  }
  /**
   * **ratchet — 늘면 차단, 줄이면 잠근다.**
   *
   * 지금 CRM 화면 대부분이 `eyebrow="영업 CRM"` 을 직접 적고 있다. 한 번에 다 바꾸면
   * 리뷰가 불가능하고 다중 세션과 충돌한다(그 파일 일부는 지금 다른 세션이 쓰고 있다).
   * **그 화면을 다른 일로 건드릴 때 함께 이관**하고 이 숫자를 내린다(§2-6 (5)과 같은 방식).
   */
  const BASELINE = 24
  assert.ok(
    bad.length <= BASELINE,
    `서비스 이름을 직접 적은 화면이 ${bad.length}곳으로 늘었습니다(기준 ${BASELINE}). ` +
    `SERVICE_LABEL 을 import 하세요:\n${bad.join('\n')}`,
  )
  assert.equal(
    bad.length, BASELINE,
    `줄었습니다(${bad.length}). BASELINE 을 ${bad.length} 로 낮춰 되돌아가지 못하게 잠그세요.`,
  )
})

test('셸의 로고 자리는 경로를 스스로 판정하지 않는다', () => {
  // 경로 표는 lib/nav/surface 한 곳뿐이다 — 셸이 또 판정하면 서비스를 하나 더 만들 때 어긋난다
  const src = stripComments(read('components/ui/MobileShell.tsx'))
  assert.ok(/serviceOf\(/.test(src), '로고 자리는 serviceOf(pathname) 로 간판을 정합니다')
  assert.ok(!/startsWith\(['"`]\/crm/.test(src), '셸이 경로를 직접 판정하고 있습니다 — surfaceOf/serviceOf 를 쓰세요')
})
