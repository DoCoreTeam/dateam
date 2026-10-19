'use client'

// 가격 기준의 세 탭 — 제품, 품목, 인건비 등급
//
// 탭은 주소(?tab=)에 남는다. 견적을 쓰다 「품목」 탭으로 바로 가는 링크가 이 값을 쓴다.

import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { PRICEBOOK } from '@/lib/terms'
import PriceProductListView from './PriceProductListView'
import ProductListView from './ProductListView'
import LaborGradeListView from './LaborGradeListView'

export default function PricebookTabs() {
  return (
    <SegmentedTabs
      ariaLabel={PRICEBOOK.title}
      param="tab"
      tabs={[
        { id: 'product', label: PRICEBOOK.tabProduct, content: <PriceProductListView /> },
        { id: 'item', label: PRICEBOOK.tabItem, content: <ProductListView /> },
        { id: 'labor', label: PRICEBOOK.tabLabor, content: <LaborGradeListView /> },
      ]}
    />
  )
}
