// 활성 스레드 재구성 SSOT (세션 2) — 서버·클라 공용
// 편집분기: 편집 = 새 user 메시지 + parent_message_id = 편집 대상(활성) 메시지 id.
// created_at asc 정렬 입력을 시간순 리플레이해 "현재 활성 스레드"만 산출한다.
// 설계: session-2-multimodal-completeness.md §5-2 / SSOT 04 §5-2.

export interface ThreadMsg {
  id: string
  parent_message_id: string | null
  created_at: string
  // + role·content 등 호출측 필드는 제네릭 T로 승계
}

// created_at asc 정렬 입력 → 시간순 리플레이:
//  - parent 없는 메시지: 현재 스레드에 append
//  - parent 있는 메시지(편집): parent가 현재 스레드에 있으면 그 위치부터 절단(truncate at parent index) 후 자신 append.
//    parent가 스레드에 없으면(이미 다른 분기로 대체된 꼬리의 편집) 건너뜀.
//
// ⚠️ 입력은 반드시 **전체 메시지 집합(비활성 분기 포함)**이어야 한다. 이 함수는 **멱등(idempotent)이 아니다** —
//    이미 활성 스레드로 축약된 결과를 다시 넣으면, 편집 메시지의 parent(원본)가 이미 절단돼 idx<0 → skip 되어
//    편집 메시지가 사라진다. 서버 getMessages가 이미 활성 스레드를 반환하면 클라는 재적용하지 말고 그대로 렌더한다.
export function buildActiveThread<T extends ThreadMsg>(sorted: T[]): T[] {
  let thread: T[] = []
  for (const m of sorted) {
    if (m.parent_message_id) {
      const idx = thread.findIndex((t) => t.id === m.parent_message_id)
      if (idx < 0) continue
      thread = thread.slice(0, idx)
      thread.push(m)
    } else {
      thread.push(m)
    }
  }
  return thread
}

// ── 편집분기 브랜치 네비게이션 (세션 3 §5-5) — 순수 함수, 단위테스트 대상 ──
// parent_message_id 체인이 "버전 그룹"을 이룬다: 원본(체인 루트) → 편집 → 편집의 편집 …
// 열람·전환만 제공(전송·재생성·편집은 항상 활성 최신 스레드에서만 — 리플레이 SSOT 유지).

/**
 * parent_message_id 체인으로 버전 그룹 구성.
 * 반환: Map<rootId, versionIds[]> — 각 그룹은 created_at asc(입력 순서 보존).
 * 그룹 크기 1(무편집)은 미포함.
 */
export function getBranchGroups(sorted: ThreadMsg[]): Map<string, string[]> {
  const byId = new Map<string, ThreadMsg>()
  for (const m of sorted) byId.set(m.id, m)

  const rootOf = (m: ThreadMsg): string => {
    let cur = m
    // 순환 방어 상한
    for (let guard = 0; guard < sorted.length + 1; guard++) {
      if (!cur.parent_message_id) return cur.id
      const parent = byId.get(cur.parent_message_id)
      if (!parent) return cur.id // parent가 집합 밖 → 자기 자신이 루트(그룹 미형성 → 크기1로 걸러짐)
      cur = parent
    }
    return cur.id
  }

  const groups = new Map<string, string[]>()
  for (const m of sorted) {
    const root = rootOf(m)
    const arr = groups.get(root) ?? []
    arr.push(m.id)
    groups.set(root, arr)
  }

  // 크기 ≥2 그룹만 유지
  for (const [root, versions] of Array.from(groups.entries())) {
    if (versions.length < 2) groups.delete(root)
  }
  return groups
}

/**
 * 그룹별 선택 버전으로 리플레이해 열람용 스레드 구성.
 * - choices 미지정 그룹 = 최신 버전(기본) → buildThreadForChoice(sorted, {}) ≡ buildActiveThread(sorted)
 * - 선택 제외된 버전 진입 시 skip 모드: 그 분기의 꼬리(parent 없는 후속 메시지)도 제외.
 *   선택 버전을 append하는 시점에 해제 → 원본 버전 선택 시 과거 꼬리까지 복원 표시.
 */
export function buildThreadForChoice<T extends ThreadMsg>(
  sorted: T[],
  choices: Record<string, string>,
): T[] {
  const groups = getBranchGroups(sorted)

  // 멤버 id → rootId, 그룹별 선택 버전(기본=최신=그룹 마지막)
  const memberToRoot = new Map<string, string>()
  const chosen = new Map<string, string>()
  for (const [root, versions] of Array.from(groups.entries())) {
    for (const v of versions) memberToRoot.set(v, root)
    const picked =
      choices[root] && versions.includes(choices[root])
        ? choices[root]
        : versions[versions.length - 1]
    chosen.set(root, picked)
  }

  let thread: T[] = []
  let skipping = false

  for (const m of sorted) {
    const root = memberToRoot.get(m.id)
    if (root !== undefined) {
      // 버전 그룹 멤버
      if (m.id === chosen.get(root)) {
        skipping = false
        if (m.parent_message_id) {
          const idx = thread.findIndex((t) => t.id === m.parent_message_id)
          if (idx >= 0) thread = thread.slice(0, idx)
        }
        thread.push(m)
      } else {
        // 선택 제외 버전 → skip 모드 진입, 드롭
        skipping = true
      }
      continue
    }
    // 비-그룹 메시지
    if (skipping) continue // 비활성 분기의 꼬리 제외
    if (m.parent_message_id) {
      const idx = thread.findIndex((t) => t.id === m.parent_message_id)
      if (idx < 0) continue
      thread = thread.slice(0, idx)
      thread.push(m)
    } else {
      thread.push(m)
    }
  }
  return thread
}
