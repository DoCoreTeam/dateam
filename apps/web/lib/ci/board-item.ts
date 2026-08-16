// lib/ci/board-item.ts — 보드 항목의 **순수** 타입·라벨
//
// 왜 떼어냈나: `queries/boards.ts`는 `@/lib/supabase/server`를 import하는 **서버 전용**이다.
// 클라이언트 컴포넌트가 거기서 값을 하나라도 가져오면(타입이 아니라 함수·상수),
// 서버 모듈이 통째로 클라이언트 번들에 끌려와 **빌드가 깨진다**
// ("You're importing a component that needs next/headers").
// tsc는 이걸 못 잡는다 — 실제로 화면을 열어야 보인다.
// (같은 함정을 v0.7.492에서도 밟았다: 서버 쿼리 파일의 상수를 화면이 import)

export interface BoardItem {
  id: string
  itemType: string
  itemId: string
  note: string | null
  addedAt: string | null
  /** 원본에서 읽은 표시 이름. 원본이 사라졌으면 null */
  label: string | null
  /** 원본으로 가는 길. 없으면 null */
  href: string | null
}

export interface BoardDetail {
  id: string
  name: string
  items: BoardItem[]
}

const TYPE_LABEL: Record<string, string> = {
  content: '게시물', pattern: '성공 공식', signal: '이슈',
}

export function boardItemTypeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t
}
