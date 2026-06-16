import { SkelPage, SkelCard } from '@/components/ui/LoadingSkeleton'

export default function Loading() {
  return (
    <SkelPage title="판매가격표" description="GPU 상품 판매가를 조회합니다">
      <SkelCard lines={4} />
      <SkelCard lines={4} />
    </SkelPage>
  )
}
