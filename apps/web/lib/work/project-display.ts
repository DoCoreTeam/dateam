// 프로젝트 표시 SSOT — 기간 라벨/예산 포맷/상태 뱃지 메타를 단일 정의(목록·카드·폼 공용, 복붙 금지).
// 상태색은 토큰 변수명을 반환해 [data-theme] 전환에 자동 대응(하드코딩 금지, 디자인 §1/§3).

import { PROJECT_STATUS, type ProjectStatus } from './project-fields'

export interface ProjectMeta {
  year?: number | null
  quarter?: number | null
  half?: string | null
  month?: number | null
  start_date?: string | null
  end_date?: string | null
  budget?: number | null
  currency?: string | null
  status?: string | null
}

// 상태 뱃지 메타 — color/bg/border 모두 토큰 변수명(SSOT). status-colors.ts와 동형 구조.
export interface StatusBadge {
  label: string
  color: string
  bg: string
  border: string
}

export const PROJECT_STATUS_BADGE: Record<ProjectStatus, StatusBadge> = {
  active: { label: '진행중', color: 'var(--info)', bg: 'var(--info-bg)', border: 'var(--info-border)' },
  planning: { label: '기획', color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
  done: { label: '완료', color: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
  hold: { label: '보류', color: 'var(--text-muted)', bg: 'var(--surface-bg)', border: 'var(--border-color)' },
}

export const PROJECT_STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> =
  PROJECT_STATUS.map((s) => ({ value: s, label: PROJECT_STATUS_BADGE[s].label }))

export const CURRENCY_OPTIONS = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'] as const

export function statusBadge(status?: string | null): StatusBadge {
  if (status && (PROJECT_STATUS as readonly string[]).includes(status)) {
    return PROJECT_STATUS_BADGE[status as ProjectStatus]
  }
  return PROJECT_STATUS_BADGE.active
}

// 기간 라벨 — 우선순위: 시작~종료일 > 연도+분기 > 연도+반기 > 연도+월 > 연도. 없으면 null.
export function periodLabel(m: ProjectMeta): string | null {
  if (m.start_date && m.end_date) return `${m.start_date} ~ ${m.end_date}`
  if (m.start_date) return `${m.start_date} ~`
  if (m.end_date) return `~ ${m.end_date}`
  if (m.year == null) return null
  if (m.quarter != null) return `${m.year} ${m.quarter}분기`
  if (m.half) return `${m.year} ${m.half === 'H1' ? '상반기' : '하반기'}`
  if (m.month != null) return `${m.year}.${String(m.month).padStart(2, '0')}`
  return `${m.year}`
}

const CURRENCY_SYMBOL: Record<string, string> = { KRW: '₩', USD: '$', EUR: '€', JPY: '¥', CNY: '¥' }

// 예산 라벨 — 통화 기호 + 천단위 콤마. 값 없으면 null.
export function budgetLabel(budget?: number | null, currency?: string | null): string | null {
  if (budget == null || !Number.isFinite(budget)) return null
  const cur = currency && CURRENCY_SYMBOL[currency] ? currency : 'KRW'
  const sym = CURRENCY_SYMBOL[cur] ?? ''
  return `${sym}${budget.toLocaleString('en-US')}`
}

// 멤버 아바타 이니셜(이름 첫 글자). 빈 이름이면 '?'.
export function initial(name?: string | null): string {
  const t = (name ?? '').trim()
  return t ? t[0] : '?'
}
