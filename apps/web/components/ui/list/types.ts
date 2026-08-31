// components/ui/list/types.ts — 목록 컬럼 계약
//
// 컬럼을 **한 벌만** 선언하면 표·카드·컴팩트를 같은 정의로 그린다.
// 지금까지는 표용 <th>/<td>와 카드용 마크업을 따로 적어서, 컬럼을 하나 바꾸면
// 한쪽만 바뀌고 다른 쪽이 남았다.

import type { ReactNode } from 'react'

export interface ColumnDef<T> {
  key: string
  header: string
  /** 표의 칸이자 카드의 한 줄 */
  cell: (row: T) => ReactNode
  /** 카드/모바일에서 제목 줄이 되는 컬럼(한 개만 지정) */
  primary?: boolean
  /** 정렬 가능하면 sort 키(= 서버 정렬 키). true면 key를 그대로 쓴다 */
  sortable?: boolean | string
  align?: 'left' | 'right'
  /** 카드에서는 생략(표에서 이미 충분한 보조 정보) */
  hideOnCard?: boolean
  /** 모바일 카드에서 레이블을 붙이지 않는다 — 썸네일·액션처럼 이름이 필요 없는 칸 */
  noLabel?: boolean
  width?: string
}

export interface ListFilterOption {
  value: string
  label: string
}

export interface ListFilterDef {
  key: string
  label: string
  options: ListFilterOption[]
  /**
   * **「전체」를 붙이지 않는다.**
   *
   * 보통 필터는 「상태 전체」가 뜻이 있다(안 거른 상태). 그런데 **옵션 자체가 전 범위를
   * 덮는** 필터가 있다 — 할 일의 「할 일 / 전부」가 그렇다. 거기에 「범위 전체」를 더하면
   * 같은 뜻이 두 자리에 서고, 사용자는 **둘이 어떻게 다른지**를 고민하게 된다.
   */
  noAll?: boolean
}
