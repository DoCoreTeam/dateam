'use client'

// 근거 링크 — 누르면 원문 뷰어가 그 블록으로 간다.
//
// 근거를 눌렀는데 아무 데도 안 가면 사용자는 그 값을 못 믿게 된다.
// 그래서 **블록 ID 가 없으면 링크를 만들지 않는다** — 죽은 링크를 두는 것보다 낫다.

import { FileText } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { RFP_REPORT } from '@/lib/rfp/terms'
import type { Evidence } from '@/lib/rfp/report/schema'

export interface RfpEvidenceLinkProps {
  evidence: Evidence
  onOpen?: (blockId: string) => void
}

export default function RfpEvidenceLink({ evidence, onOpen }: RfpEvidenceLinkProps) {
  if (!evidence.blockId) return null

  const quote = evidence.quote.length > 80 ? `${evidence.quote.slice(0, 80)}…` : evidence.quote

  return (
    <NbButton variant="ghost" title={RFP_REPORT.openSource} onClick={() => onOpen?.(evidence.blockId)}>
      <FileText size={12} />
      <span>{quote}</span>
      {evidence.pageNo !== null && <span>{evidence.pageNo}</span>}
    </NbButton>
  )
}
