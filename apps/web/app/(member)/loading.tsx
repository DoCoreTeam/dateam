import { SkelPage, SkelList } from '@/components/ui/LoadingSkeleton'

// 업무 화면 공통 전환 골격
//
// 왜 그룹 레벨인가: loading.tsx가 화면별로 11개만 있어 나머지 70개 화면은 전환 중
// **아무 반응이 없었다**. 이 레이아웃 아래 화면은 서버가 끝날 때까지 이전 화면이
// 그대로 멈춰 있어, 실측(약 1초)보다 훨씬 느리게 느껴졌다(v0.7.458 실측).
// 화면별 loading.tsx가 있으면 그쪽이 이긴다 — 이건 바닥값이다.

export default function Loading() {
  return (
    <SkelPage>
      <SkelList rows={6} />
    </SkelPage>
  )
}
