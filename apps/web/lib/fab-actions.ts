// 우하단 빠른 추가(FAB) 액션 SSOT — 페이지별 컨텍스트.
//   현재 페이지에 맞는 액션 세트를 반환. 액션 href는 "그 기능 바로 열기"용 URL(탭 전환 + ?create=1로 생성 모달 자동 오픈).
//   페이지/액션 추가 시 이 파일에만 손대면 됨.
import type { LucideIcon } from 'lucide-react'
import { FileText, Building2, Contact, Handshake, CalendarPlus, Boxes, Users, BarChart3 } from 'lucide-react'

export interface FabAction {
  key: string
  label: string
  href: string
  icon: LucideIcon
  /** 이 액션이 적용되는 페이지 경로 prefix (현재 페이지 매칭·강조용) */
  match: string
}

// ── GPU 관리(/pricing/gpu) 전용 컨텍스트 액션 ──
//   클릭 = 해당 탭 전환 + (등록계열은) 생성 모달 자동 오픈(?create=1). GpuPricingClient가 해석.
const GPU_ACTIONS: FabAction[] = [
  { key: 'gpu-intake', label: '가격·견적 입력', href: '/pricing/gpu?tab=intake', icon: Boxes, match: '/pricing/gpu' },
  { key: 'gpu-supplier', label: '공급사 등록', href: '/pricing/gpu?tab=suppliers&create=1', icon: Building2, match: '/pricing/gpu' },
  { key: 'gpu-competitor', label: '경쟁사 등록', href: '/pricing/gpu?tab=competitors&create=1', icon: Users, match: '/pricing/gpu' },
  { key: 'gpu-market', label: '시장가·매핑 등록', href: '/pricing/gpu?tab=market&create=1', icon: BarChart3, match: '/pricing/gpu' },
]

// ── 통합입력(GPU 가격·견적) — 비-GPU 페이지에서도 어디서나 시작 가능 ──
export const INTAKE_ACTION: FabAction = {
  key: 'intake', label: '가격·견적 입력', href: '/pricing/gpu?tab=intake', icon: Boxes, match: '/pricing/gpu',
}

// ── 글로벌 빠른 추가 (기타 페이지) ──
export const GLOBAL_QUICK_ACTIONS: FabAction[] = [
  { key: 'daily', label: '일일 업무', href: '/daily?new=1', icon: FileText, match: '/daily' },
  { key: 'account', label: '거래처', href: '/accounts', icon: Building2, match: '/accounts' },
  { key: 'contact', label: '연락처', href: '/contacts', icon: Contact, match: '/contacts' },
  { key: 'deal', label: '딜', href: '/deals', icon: Handshake, match: '/deals' },
  { key: 'calendar', label: '일정', href: '/calendar', icon: CalendarPlus, match: '/calendar' },
]

/**
 * 현재 경로에 맞는 FAB 액션 목록.
 *  - GPU 관리 페이지: 전용 4액션(통합입력 강조).
 *  - 그 외: 글로벌 빠른추가 + 통합입력, 현재 페이지 매칭 액션을 최상단 강조.
 * (usePathname은 쿼리 제외 경로만 반환 → /pricing/gpu?tab=… 도 '/pricing/gpu')
 */
export function fabActionsForPath(pathname: string, isAdmin = true): { actions: FabAction[]; primaryKey: string } {
  if (pathname === '/pricing/gpu' || pathname.startsWith('/pricing/gpu/')) {
    // 공급사·경쟁사 등록 탭은 admin 전용 → 비관리자에겐 숨김(클릭해도 board로 튕기는 먹통버튼 방지)
    const actions = isAdmin
      ? GPU_ACTIONS
      : GPU_ACTIONS.filter((a) => a.key !== 'gpu-supplier' && a.key !== 'gpu-competitor')
    return { actions, primaryKey: 'gpu-intake' }
  }
  const all = [...GLOBAL_QUICK_ACTIONS, INTAKE_ACTION]
  const matched = all
    .filter((a) => pathname === a.match || pathname.startsWith(a.match + '/'))
    .sort((a, b) => b.match.length - a.match.length)[0]
  if (!matched) return { actions: all, primaryKey: INTAKE_ACTION.key }
  const rest = all.filter((a) => a.key !== matched.key)
  return { actions: [matched, ...rest], primaryKey: matched.key }
}
