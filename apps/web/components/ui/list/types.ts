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
}
