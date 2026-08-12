// components/ui/SortIcon.tsx — 정렬 방향 아이콘 SSOT
//
// 왜: 같은 아이콘을 7곳이 각자 만들고 있었다(components 2 + 화면 로컬 5).
//   모양(화살표 vs 꺾쇠)·크기(11·12·13)·비활성 표현(클래스 vs 인라인 opacity)이 전부 갈려서,
//   같은 표인데도 화면마다 정렬 표시가 다르게 보였다.
//   API도 셋(col+sortConfig / field+sort+dir / col+sortKey+sortDir)이라 옮겨 쓸 수도 없었다.
//
// 계약: 지금 정렬 중인지(active)와 방향(dir)만 넘긴다. 키 비교는 호출부가 한다.

import { ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'

export interface SortIconProps {
  /** 이 열이 현재 정렬 기준인가 */
  active: boolean
  dir: 'asc' | 'desc'
  /** 조밀한 표(GPU 가격표 등)는 11로 줄인다 */
  size?: number
}

export default function SortIcon({ active, dir, size = 12 }: SortIconProps) {
  const cls = active ? 'sort-icon sort-icon-active' : 'sort-icon'
  if (!active) return <ChevronsUpDown size={size} className={cls} aria-hidden />
  return dir === 'asc'
    ? <ChevronUp size={size} className={cls} aria-hidden />
    : <ChevronDown size={size} className={cls} aria-hidden />
}
