/**
 * 지난 회의를 훑어 「아직 안 이어진 사람」을 모은다 (SSOT)
 *
 * **왜 이 파일이 생겼나**: 1단계(적을 때 잇기)는 **앞으로 적을 것**만 구한다.
 * 이미 지나간 회의에 적힌 이름들은 그대로 글자로 남는다 —
 * 실측(2026-09-05) 회의 18건에 외부인 이름 14개, 그중 9명이 CRM 에 아예 없었다.
 *
 * 그래서 한 번 훑어 **후보 목록**을 만든다. 자동으로 담지 않는다 —
 * 이 저장소가 정한 AI 결과 UX 그대로다(§5-3 추출/제안형: 후보를 보여 주고 사람이 고른다).
 * 동명이인과 이름 아닌 것이 섞여 있어서 자동 반영은 그 자체가 사고다.
 *
 * 판정은 `attendee-link.ts` 가 한다. 여기서는 **모으고 세는 일만** 한다 —
 * 판정 규칙이 두 곳에 생기면 화면과 훑기가 다른 답을 낸다.
 */

import { parseAttendee, type ParsedAttendee } from './attendee-parse.ts'
import { linkAttendee, type LinkDecision, type PersonCandidate, type CompanyCandidate } from '../crm/link/attendee-link.ts'
import { nameKey } from '../crm/link/name-match.ts'
import { SERVICE_LABEL } from '../terms/index.ts'

export interface SweepNote {
  id: string
  title: string
  meetingAt: string | null
  /** 참석자 원문 */
  attendees: string[]
  /** 이미 이어 둔 인물 — 다시 후보로 올리지 않는다 */
  linkedPersonIds: string[]
  /** 조직원 이름 — 외부인만 후보로 본다 */
  memberNames: string[]
}

export interface SweepRow {
  /** 같은 사람이 여러 회의에 나오면 한 줄로 모은다 */
  key: string
  raw: string
  parsed: ParsedAttendee
  decision: LinkDecision
  /** 이 이름이 나온 회의들 — 사람이 판단할 근거다 */
  notes: { id: string; title: string; meetingAt: string | null }[]
}

export type SweepTier = 'link' | 'review' | 'drop'

export interface SweepResult {
  /** 이어도 되는 것 */
  link: SweepRow[]
  /** 여쭐 것 */
  review: SweepRow[]
  /** 걸러낼 것 */
  drop: SweepRow[]
  /** 훑은 회의 수 */
  noteCount: number
}

/**
 * 후보를 모은다.
 *
 * 같은 이름이 여러 회의에 나오면 **한 줄로 묶는다** — 「컬쳐랜드 김시홍팀장」이
 * 회의 세 곳에 있으면 세 번 물을 이유가 없다. 대신 어느 회의였는지는 전부 남긴다.
 */
export function sweepAttendees(
  notes: SweepNote[],
  candidates: { people: PersonCandidate[]; companies: CompanyCandidate[] },
): SweepResult {
  const byKey = new Map<string, SweepRow>()
  const peopleById = new Map(candidates.people.map((p) => [p.id, p]))

  for (const note of notes) {
    const members = new Set(note.memberNames)
    /**
     * 이 회의에서 **이미 이어 둔 사람들의 이름**.
     *
     * 인물 id 로만 비교하면 새로 만들어서 이은 사람을 놓친다 — 방금 만든 인물은
     * 다음 판정에서 「소속이 다르다」로 갈려 personId 가 안 잡히기 때문이다.
     * 그러면 이은 다음에도 목록에 남아 「했는데 왜 또 나오지」가 된다(실측 2026-09-05).
     * 우리가 실제로 한 일은 「그 회의의 그 이름을 처리했다」이므로 이름으로 판정한다.
     */
    const linkedNames = new Set(
      note.linkedPersonIds
        .map((id) => nameKey(peopleById.get(id)?.name ?? ''))
        .filter(Boolean),
    )

    for (const raw of note.attendees) {
      const trimmed = raw.trim()
      if (!trimmed) continue
      // 조직원은 이미 다른 길(attendee_user_ids)로 이어져 있다
      if (members.has(trimmed)) continue

      const parsed = parseAttendee(trimmed)
      const key = trimmed

      // 이 회의에서 그 이름을 이미 이었으면 이 회의는 근거에서도 뺀다 —
      // 먼저 걸러야 다른 회의 때문에 만들어진 줄에 이 회의가 딸려 붙지 않는다
      if (parsed.name && linkedNames.has(nameKey(parsed.name))) continue

      const existing = byKey.get(key)
      if (existing) {
        existing.notes.push({ id: note.id, title: note.title, meetingAt: note.meetingAt })
        continue
      }

      const decision = linkAttendee(parsed, candidates)
      /**
       * 이미 그 인물로 이어 둔 회의의 이름은 다시 묻지 않는다.
       * 안 그러면 이은 다음에도 목록에 계속 남아 「했는데 왜 또 나오지」가 된다.
       */
      if (decision.personId && note.linkedPersonIds.includes(decision.personId)) continue

      byKey.set(key, {
        key, raw: trimmed, parsed, decision,
        notes: [{ id: note.id, title: note.title, meetingAt: note.meetingAt }],
      })
    }
  }

  const rows = Array.from(byKey.values())
  return {
    link: rows.filter((r) => r.decision.tier === 'link'),
    review: rows.filter((r) => r.decision.tier === 'review'),
    drop: rows.filter((r) => r.decision.tier === 'drop'),
    noteCount: notes.length,
  }
}

/**
 * 반영할 것을 고르면 무엇을 해야 하는지.
 *
 * 두 가지뿐이다 — **있는 인물에 잇기**와 **새 인물 만들고 잇기**.
 * 화면이 이 구분을 하지 않게 여기서 정한다.
 */
export interface ApplyPlan {
  /** 이미 있는 인물 */
  linkExisting: { key: string; personId: string; noteIds: string[] }[]
  /** 새로 만들 인물 */
  createAndLink: {
    key: string
    name: string
    title: string | null
    companyId: string | null
    noteIds: string[]
  }[]
}

export function planApply(rows: SweepRow[], chosenKeys: string[]): ApplyPlan {
  const chosen = new Set(chosenKeys)
  const plan: ApplyPlan = { linkExisting: [], createAndLink: [] }

  for (const r of rows) {
    if (!chosen.has(r.key)) continue
    // 걸러낼 것은 골라도 담지 않는다 — 인원수 표기나 우리 조직이 CRM 에 들어가면 안 된다
    if (r.decision.tier === 'drop') continue

    const noteIds = r.notes.map((n) => n.id)
    if (r.decision.personId) {
      plan.linkExisting.push({ key: r.key, personId: r.decision.personId, noteIds })
    } else {
      plan.createAndLink.push({
        key: r.key,
        name: r.parsed.name,
        title: r.parsed.title,
        companyId: r.decision.companyId,
        noteIds,
      })
    }
  }
  return plan
}

/**
 * 세 층의 이름과 안내 (SSOT)
 *
 * 화면에 한글 문자열을 직접 적지 않는다(§0-2). 층을 나눠 보여 주는 이유가
 * 「전부 어렵다」로 읽히지 않게 하는 것이므로, **왜 이 층인지**를 함께 말한다.
 */
export const SWEEP_TIER_LABEL: Record<SweepTier, { title: string; desc: string }> = {
  link: {
    title: '이어도 되는 것',
    desc: `이름과 소속이 ${SERVICE_LABEL.crm} 과 맞아떨어져요. 그대로 이으면 됩니다.`,
  },
  review: {
    title: '확인이 필요한 것',
    desc: '같은 이름이 여럿이거나 소속이 달라요. 맞는 것만 골라 주세요.',
  },
  drop: {
    title: '사람이 아닌 것',
    desc: '인원수 표기이거나 우리 조직이에요. 담지 않습니다.',
  },
}

/** 층 순서 — 판단할 게 없는 것부터 보여 준다 */
export const SWEEP_TIER_ORDER: SweepTier[] = ['link', 'review', 'drop']

/**
 * 이미 이어 둔 사람 — **보여 준다.** 그래야 풀 수 있다.
 *
 * **왜 이게 필요한가**: 이은 사람은 후보 목록에서 사라진다(다시 안 묻는다). 그건 맞다.
 * 그런데 그러면 **잘못 이은 것을 이 화면에서 풀 길이 없다** — 회의노트를 하나씩 열어
 * 편집 모드로 들어가야 한다. 만들기(C)·잇기(U)만 있고 **지우기(D)가 없는 상태**다.
 * (사용자 지적 2026-09-08: 「지우고 싶은게 있으면 지울 수도 있어야 하니 CRUD 지켜」)
 *
 * **CRM 에서 못 찾은 id 도 숨기지 않는다.** `attendee_person_ids` 는 FK 가 없는 참조라
 * 인물을 지워도 id 는 그대로 남는다. 읽는 자리가 조용히 걸러 버리면 그 고아는
 * **영원히 아무 화면에도 안 나온다** — 치울 수 있으려면 먼저 보여야 한다(R-5 와 같은 이유).
 */
export interface LinkedRow {
  personId: string
  /** CRM 에서 찾은 이름 — 못 찾으면 null */
  name: string | null
  companyName: string | null
  title: string | null
  /** CRM 에서 못 찾았다 — 지워졌거나 고아 id 다 */
  missing: boolean
  /** 이 사람이 이어져 있는 회의들 — 풀면 무엇이 달라지는지의 근거다 */
  notes: { id: string; title: string; meetingAt: string | null }[]
}

/**
 * 이어 둔 인물을 회의 건너 한 줄로 모은다.
 *
 * 정렬은 **고아 먼저, 그 다음 이름순**이다 — 치워야 할 것이 위로 온다.
 * 순서를 고정해야 화면이 열 때마다 줄이 뒤바뀌지 않는다.
 */
export function collectLinked(notes: SweepNote[], people: PersonCandidate[]): LinkedRow[] {
  const byId = new Map(people.map((p) => [p.id, p]))
  const rows = new Map<string, LinkedRow>()

  for (const note of notes) {
    for (const personId of note.linkedPersonIds) {
      if (!personId) continue
      const found = byId.get(personId)
      const row = rows.get(personId) ?? {
        personId,
        name: found?.name ?? null,
        companyName: found?.companyName ?? null,
        title: found?.title ?? null,
        missing: !found,
        notes: [],
      }
      // 같은 배열에 같은 id 가 겹쳐 있어도 회의는 한 번만 센다
      if (!row.notes.some((n) => n.id === note.id)) {
        row.notes.push({ id: note.id, title: note.title, meetingAt: note.meetingAt })
      }
      rows.set(personId, row)
    }
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? -1 : 1
    return (a.name ?? '').localeCompare(b.name ?? '', 'ko')
  })
}

/** 이어 둔 사람 층의 이름과 안내 (SSOT · §0-2) */
export const LINKED_SECTION_LABEL = {
  title: '이미 이은 사람',
  desc: '잘못 이었으면 연결을 해제하세요. 인물은 남고 이 회의와의 연결만 끊깁니다.',
  /** CRM 에서 사라진 인물 — 「없다」가 아니라 「못 찾았다」로 말한다 */
  missing: 'CRM 에서 찾을 수 없는 인물',
  missingHint: '인물이 삭제됐거나 연결이 어긋났어요. 해제하면 이 이름은 다시 후보로 올라옵니다.',
} as const
