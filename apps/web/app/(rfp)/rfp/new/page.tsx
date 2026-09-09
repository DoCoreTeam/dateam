// /rfp/new — 공고 올리기
//
// 등급을 고르기 전에는 제출이 막힌다(UploadPanel). 기본값을 주면 NDA 가 공개로 들어온다.

import PageHeader from '@/components/ui/PageHeader'
import { RFP_INTAKE } from '@/lib/rfp/terms'
import NewCaseClient from './NewCaseClient'

export const dynamic = 'force-dynamic'

export default function RfpNewPage() {
  return (
    <main className="page-inner">
      <PageHeader title={RFP_INTAKE.title} description={RFP_INTAKE.subtitle} />
      <NewCaseClient />
    </main>
  )
}
