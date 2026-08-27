import QuoteDocumentView from './QuoteDocumentView'

export const metadata = { title: '견적서 · 영업 CRM' }

export default function CrmQuotePrintPage({ params }: { params: { id: string } }) {
  return <QuoteDocumentView quoteId={params.id} />
}
