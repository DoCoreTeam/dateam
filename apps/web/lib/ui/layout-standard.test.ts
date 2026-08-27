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
  // v0.7.618: 전체 메뉴(QuickNav)가 라벨을 `navLabel()`(lib/nav/menu SSOT)에서 가져오도록
  // 바꾸면서 3곳이 줄었다(24 → 21). 되돌아가지 못하게 잠근다.
  const BASELINE = 21
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

/* ─── 가로 줄 표준 (ControlRow) ─────────────────────────────────────────────
   사용자 지적 2026-08-27: 「옆에 탭이든 버튼이든 있으면 세로 정렬을 중앙으로 해야
   밸런스가 맞지 ... 지금 우리 디자인시스템에 이 문제가 있는거 같아 다 확인해」

   실측 /develop 「코드 언어」 — 라벨만 탭보다 아래로 내려앉아 있었다. 원인은
   `align-items` 가 아니라 **여백의 소유자**였다: `.seg-tabs` 가 자기 안에
   margin-bottom 을 들고 있어서 가운데 정렬이 마진 박스를 기준으로 맞췄다.
   같은 형태가 6곳에 있었다. 규칙을 문서로 두면 또 빠뜨리므로 **부품과 가드로** 잠근다. */

/** 바깥 아래 여백을 들고 있어 한 줄에 세울 수 없는 공용 클래스 */
function marginOwningClasses(css: string): string[] {
  const out: string[] = []
  // `.name { … margin-bottom: … }` 형태의 최상위 규칙만 본다
  for (const m of css.matchAll(/(^|\n)((?:\.[a-z][a-z0-9-]*,?\s*)+)\{([^}]*)\}/g)) {
    if (!/margin-bottom:\s*var\(--space/.test(m[3])) continue
    for (const sel of m[2].split(',')) {
      const name = sel.trim().replace(/^\./, '')
      if (/^(seg-tabs|work-subtabs-row|work-tabbar-wrap)/.test(name)) out.push(name)
    }
  }
  return [...new Set(out)]
}

test('★ 한 줄에 세우는 부품은 자기 바깥 여백을 내려놓는다 — 안 그러면 옆 글자만 아래로 내려앉는다', () => {
  const css = read('app/globals.css')
  const row = css.match(/\.control-row > \*,([\s\S]*?)\{\s*margin-bottom:\s*0;?\s*\}/)
  assert.ok(row, '.control-row 의 여백 되돌리기 규칙이 없다 — 부품 여백이 그대로 정렬을 깬다')

  const missing = marginOwningClasses(css).filter((c) => !row![1].includes(`.${c}`))
  assert.deepEqual(missing, [],
    '이 클래스가 자기 margin-bottom 을 들고 있는데 .control-row 안에서 0 으로 되돌리지 않는다.\n' +
    'globals.css 의 「가로 줄 표준」 선택자 목록에 추가할 것:\n  ' + missing.join('\n  '))
})

test('★ 탭을 인라인 flex 줄에 직접 세우지 않는다 — ControlRow 를 쓴다', () => {
  const bad: string[] = []
  for (const { file: f, src } of scan()) {
    if (!src.includes('<SegmentedTabs')) continue
    const lines = src.split('\n')
    lines.forEach((ln, i) => {
      if (!ln.includes('<SegmentedTabs')) return
      const ctx = lines.slice(Math.max(0, i - 12), i).join('\n')
      if (/display:\s*'flex'/.test(ctx) && !ctx.includes('<ControlRow')) bad.push(`${f}:${i + 1}`)
    })
  }
  assert.deepEqual(bad, [],
    '탭 옆에 라벨·버튼을 세울 때는 components/ui/ControlRow 를 쓴다.\n' +
    '인라인 flex 로 만들면 부품이 든 바깥 여백 때문에 세로 가운데가 어긋난다:\n  ' + bad.join('\n  '))
})
