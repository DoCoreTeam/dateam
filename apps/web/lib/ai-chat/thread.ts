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
