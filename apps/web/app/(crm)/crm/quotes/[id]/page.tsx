import QuoteDocumentView from './QuoteDocumentView'

export const metadata = { title: '견적서 · 영업 CRM' }

export default async function CrmQuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  return <QuoteDocumentView quoteId={(await params).id} />
}
