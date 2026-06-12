// 우하단 빠른 추가(FAB) 액션 SSOT — 하이브리드(맥락 강조 + 멀티 speed-dial).
//   전역 빠른 생성 목록을 한 곳에서 관리. 현재 페이지에 해당하는 액션을 최상단 강조.
//   앞으로 페이지/액션 추가 시 GLOBAL_QUICK_ACTIONS 에만 추가하면 됨.
import type { LucideIcon } from 'lucide-react'
import { FileText, Building2, Contact, Handshake, CalendarPlus, Boxes } from 'lucide-react'

export interface FabAction {
  key: string
  label: string
  href: string
  icon: LucideIcon
  /** 이 액션이 적용되는 페이지 경로 prefix (현재 페이지 매칭·강조용) */
  match: string
}

// 전역 빠른 추가 목록 (B2B 표준 명사 · 통합입력=GPU 가격입력은 별도 상수)
export const GLOBAL_QUICK_ACTIONS: FabAction[] = [
  { key: 'daily', label: '일일 업무', href: '/daily?new=1', icon: FileText, match: '/daily' },
  { key: 'account', label: '거래처', href: '/accounts', icon: Building2, match: '/accounts' },
  { key: 'contact', label: '연락처', href: '/contacts', icon: Contact, match: '/contacts' },
  { key: 'deal', label: '딜', href: '/deals', icon: Handshake, match: '/deals' },
  { key: 'calendar', label: '일정', href: '/calendar', icon: CalendarPlus, match: '/calendar' },
]

// 통합입력(GPU 가격/견적 AI 입력) — 항상 포함. 라벨은 정확히("통합입력"이 GPU 가격임을 명시).
export const INTAKE_ACTION: FabAction = {
  key: 'intake', label: '가격·견적 입력', href: '/intake', icon: Boxes, match: '/intake',
}

/** 현재 경로에 맞춰 정렬된 FAB 액션 목록 — 매칭 액션을 최상단으로(강조). */
export function fabActionsForPath(pathname: string): { actions: FabAction[]; primaryKey: string } {
  const all = [...GLOBAL_QUICK_ACTIONS, INTAKE_ACTION]
  // 현재 페이지와 매칭되는 액션 찾기(가장 긴 prefix 우선)
  const matched = all
    .filter((a) => pathname === a.match || pathname.startsWith(a.match + '/') || pathname.startsWith(a.match + '?'))
    .sort((a, b) => b.match.length - a.match.length)[0]
  if (!matched) return { actions: all, primaryKey: INTAKE_ACTION.key }
  // 매칭 액션을 맨 앞으로
  const rest = all.filter((a) => a.key !== matched.key)
  return { actions: [matched, ...rest], primaryKey: matched.key }
}
