import type { DealStage } from '@/types/database'

export const ACCOUNT_TYPES = ['민간', '국가기관', '지자체', '공공기관', '교육', '대학', '병원', '파트너'] as const
export const ACCOUNT_SEGMENTS = ['T1', 'T2', '공공', '파트너', '엔터프라이즈', 'SMB', '스타트업'] as const
export const GPU_DEMAND_LEVELS = ['최상', '상', '중', '하'] as const
export const CONTACT_ROLES = ['의사결정자', '실무', '추천자'] as const
export const LEAD_TYPES = ['기업형', '사업형'] as const
export const PRODUCTS = ['gcube임대', '하이퍼큐브', '예약형', '번들'] as const
export const DEAL_NATURES = ['신규', '계속'] as const

export const STAGE_PROBABILITY: Record<DealStage, number> = {
  신규: 5,
  검증: 15,
  컨택: 30,
  PoC: 50,
  제안: 65,
  협상: 80,
  수주: 100,
  실패: 0,
}

export function probabilityForStage(stage: string): number {
  return STAGE_PROBABILITY[stage as DealStage] ?? 0
}

export function normalizeAccountType(value?: string | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (!v) return null
  if (['공공', '공공기관'].includes(v)) return '공공기관'
  if (['국가', '정부', '국가기관'].includes(v)) return '국가기관'
  if (['지자체', '지방자치단체'].includes(v)) return '지자체'
  if (['민간', '최종고객', '기업', '회사'].includes(v)) return '민간'
  if (['교육', '교육기관'].includes(v)) return '교육'
  if (['대학', '대학교'].includes(v)) return '대학'
  if (['병원', '의료기관'].includes(v)) return '병원'
  if (['파트너', '리셀러'].includes(v)) return '파트너'
  return v
}

export function normalizeSegment(value?: string | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (!v) return null
  if (['Enterprise', '엔터프라이즈', 'T1'].includes(v)) return 'T1'
  if (['Mid-Market', '미드마켓', '중견', 'T2'].includes(v)) return 'T2'
  if (['Public', '공공'].includes(v)) return '공공'
  if (['Partner', '파트너'].includes(v)) return '파트너'
  if (['SMB', '스타트업'].includes(v)) return v
  return v
}

export function normalizeGpuDemand(value?: string | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (!v) return null
  if (['Very High', 'High+', '최상'].includes(v)) return '최상'
  if (['High', '높음', '상'].includes(v)) return '상'
  if (['Medium', '중간', '중'].includes(v)) return '중'
  if (['Low', '낮음', '하'].includes(v)) return '하'
  return v
}

export function normalizeLeadType(value?: string | null, fallback?: 'private' | 'public'): string | null {
  if (!value && fallback === 'private') return '기업형'
  if (!value && fallback === 'public') return '사업형'
  if (!value) return null
  const v = value.trim()
  if (!v) return null
  if (['민간', '기업', '기업형', '직접영업', '인바운드', '파트너'].includes(v)) return '기업형'
  if (['공공', '사업', '사업형'].includes(v)) return '사업형'
  return v
}
