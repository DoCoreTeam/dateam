// 커맨드 팔레트 (dacrm FR-10)
//
// **왜 필요한가**: 영업은 하루에 화면을 수십 번 옮겨 다닌다.
// 회사를 보다 딜로, 딜을 보다 미팅으로. 그때마다 사이드바로 손을 옮기고,
// 목록에서 눈으로 찾고, 클릭한다. 한 번에 3초라도 하루 오십 번이면 그게 일이 된다.
//
// **키보드에서 손을 안 떼게 한다.** Cmd+K 로 열고, 치고, 엔터.
//
// **검색을 새로 만들지 않는다.** 이미 CRM 검색이 있다(services/search.ts).
// 팔레트는 그 결과에 **이동·생성 명령을 얹는 얇은 층**이다 —
// 두 벌로 두면 팔레트에서 찾은 것과 검색 화면에서 찾은 것이 달라진다.

export type CommandKind = 'go' | 'create' | 'record'

export interface PaletteCommand {
  id: string
  kind: CommandKind
  label: string
  /** 무엇인지 한 줄 — 같은 이름이 여럿일 때 구분한다 */
  hint?: string | null
  href: string
  /** 검색어 매칭에만 쓰는 별칭. 화면에는 안 보인다 */
  keywords?: string[]
}

export const KIND_LABEL: Record<CommandKind, string> = {
  go: '이동',
  create: '만들기',
  record: '찾은 것',
}

/**
 * 고정 명령 — 화면 이동과 새로 만들기.
 *
 * 사이드바를 그대로 복제하지 않는다. **자주 가는 곳과 자주 만드는 것**만 둔다.
 * 전부 넣으면 목록이 길어져서 결국 눈으로 찾게 되고, 그러면 팔레트를 쓸 이유가 없다.
 */
export const STATIC_COMMANDS: PaletteCommand[] = [
  { id: 'go:inbox', kind: 'go', label: '인박스', href: '/crm/inbox', keywords: ['inbox', '제안', '대기'] },
  { id: 'go:companies', kind: 'go', label: '회사', href: '/crm/companies', keywords: ['company', '거래처', '고객사'] },
  { id: 'go:people', kind: 'go', label: '인물', href: '/crm/people', keywords: ['person', '연락처', '담당자'] },
  { id: 'go:deals', kind: 'go', label: '딜', href: '/crm/deals', keywords: ['deal', '보드', '파이프라인', '영업'] },
  { id: 'go:meetings', kind: 'go', label: '미팅', href: '/crm/meetings', keywords: ['meeting', '회의', '녹음'] },
  { id: 'go:tasks', kind: 'go', label: '할 일', href: '/crm/tasks', keywords: ['task', 'todo', '태스크'] },
  { id: 'go:reports', kind: 'go', label: '리포트', href: '/crm/reports', keywords: ['report', '예상', '매출', '성사율'] },
  { id: 'go:audit', kind: 'go', label: '기록', href: '/crm/audit', keywords: ['audit', '감사', '변경'] },
  { id: 'go:process', kind: 'go', label: '프로세스', href: '/crm/process', keywords: ['process', '단계', '조건'] },
  { id: 'go:members', kind: 'go', label: '멤버', href: '/crm/members', keywords: ['member', '팀원', '권한'] },
  { id: 'go:settings', kind: 'go', label: '설정', href: '/crm/settings', keywords: ['setting', '자동화', '내보내기', '예산'] },

  { id: 'new:company', kind: 'create', label: '회사 만들기', href: '/crm/companies/new', keywords: ['새', 'new', '추가'] },
  { id: 'new:person', kind: 'create', label: '인물 만들기', href: '/crm/people/new', keywords: ['새', 'new', '추가'] },
  { id: 'new:deal', kind: 'create', label: '딜 만들기', href: '/crm/deals/new', keywords: ['새', 'new', '추가'] },
  { id: 'new:meeting', kind: 'create', label: '미팅 기록하기', href: '/crm/meetings/new', keywords: ['새', 'new', '녹음'] },

  // CRM 밖으로 나가는 길 — 사이드바가 통째로 CRM 것이라 여기가 없으면 갇힌 것처럼 느낀다
  { id: 'go:home', kind: 'go', label: '홈으로 나가기', href: '/home', keywords: ['나가기', '호스트', 'exit'] },
  { id: 'go:work', kind: 'go', label: '업무로 나가기', href: '/work', keywords: ['나가기', '호스트', 'exit'] },
]

/**
 * 고정 명령을 검색어로 거른다.
 *
 * **점수를 매기지 않는다.** 항목이 스무 개도 안 되는데 순위를 매기면
 * 같은 걸 쳐도 어제와 오늘 순서가 달라진다 — 그러면 손이 위치를 못 외운다.
 * 대신 **앞에서 맞은 것을 먼저** 둔다(그것만으로 "회"→"회사"가 위로 온다).
 */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands

  const head: PaletteCommand[] = []
  const rest: PaletteCommand[] = []

  for (const c of commands) {
    const label = c.label.toLowerCase()
    if (label.startsWith(q)) { head.push(c); continue }

    const hay = [label, (c.hint ?? '').toLowerCase(), ...(c.keywords ?? []).map((k) => k.toLowerCase())]
    if (hay.some((h) => h.includes(q))) rest.push(c)
  }
  return [...head, ...rest]
}

/** 방향키로 오르내릴 때의 다음 자리 — 끝에서 반대편으로 돌아온다 */
export function moveCursor(current: number, delta: number, total: number): number {
  if (total <= 0) return 0
  return ((current + delta) % total + total) % total
}

/** 검색 결과를 명령으로 — 종류를 밝혀야 "삼성"이 회사인지 딜인지 알 수 있다 */
export function hitToCommand(hit: {
  kind: string; id: string; title: string; sub: string | null; href: string
}): PaletteCommand {
  const KIND_TEXT: Record<string, string> = {
    company: '회사', person: '인물', deal: '딜', meeting: '미팅',
  }
  return {
    id: `hit:${hit.kind}:${hit.id}`,
    kind: 'record',
    label: hit.title,
    hint: [KIND_TEXT[hit.kind] ?? hit.kind, hit.sub].filter(Boolean).join(' · '),
    href: hit.href,
  }
}
