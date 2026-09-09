// /rfp/assistant — 자연어 질의

import PageHeader from '@/components/ui/PageHeader'
import { RFP_ASSISTANT, RFP_LIST } from '@/lib/rfp/terms'
import AssistantClient from './AssistantClient'

export const dynamic = 'force-dynamic'

export default function RfpAssistantPage() {
  return (
    <main className="page-inner">
      <PageHeader title={RFP_ASSISTANT.title} back={{ href: '/rfp', label: RFP_LIST.title }} />
      <AssistantClient />
    </main>
  )
}
