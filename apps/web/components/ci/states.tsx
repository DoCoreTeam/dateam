// components/ci/states.tsx — CI 고유 상태 1개만 남는다
//
// 예전엔 여기에 EmptyState·ErrorState·CardSkeleton·RowSkeleton이 함께 있었다.
// 그런데 이것들은 CI 전용이 아니라 **모든 화면이 필요로 하는 상태**였고,
// 그 결과 `components/ui/`에 같은 이름의 두 번째 구현이 생겼다(v0.7.443 실측: EmptyState 2벌).
// 공용 3종은 `components/ui/{EmptyState,ErrorState,LoadingSkeleton}`으로 올렸다.
//
// InsufficientData만 남긴다 — "데이터가 없다"가 아니라 "모집단이 얇아 계산을 못 한다"는
// CI 특유의 판정이라서, 빈 상태와 섞으면 사용자가 원인을 오해한다.

import Link from 'next/link'
import EmptyState from '@/components/ui/EmptyState'

/** 모집단이 얇아 통계를 낼 수 없을 때. 빈 상태와 구분한다 — 데이터는 있으나 부족한 것이다. */
export function InsufficientData({
  what, action,
}: { what: string; action?: { label: string; href: string } }) {
  return (
    <EmptyState
      title={`아직 ${what}를 계산할 만큼 데이터가 모이지 않았습니다`}
      description="비교 대상이 충분해지면 자동으로 표시됩니다. 그럴듯한 숫자를 지어내지 않습니다."
      secondary={action && <Link href={action.href} className="btn-primary">{action.label}</Link>}
    />
  )
}
