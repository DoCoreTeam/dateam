'use client'

import { ListChecks, FilePlus2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import PageHeader from '@/components/ui/PageHeader'

interface Props {
  /** 그룹·결과 화면에서 "새 분석"으로 즉시 초기화(새 창처럼). 입력 단계에선 undefined(숨김). */
  onNewAnalysis?: () => void
}

/**
 * 목록 심층분석 — 페이지 헤더(§2-3 표준).
 * 예전엔 같은 레이아웃을 여기서 다시 그렸다(뒤로가기·아이콘 슬롯이 공용 부품에 없다는 이유로).
 * 그 두 슬롯을 PageHeader에 넣고, 여기서는 **데이터만 넘긴다**.
 */
export default function AnalyzePageHeader({ onNewAnalysis }: Props = {}) {
  return (
    <PageHeader
      title="목록 심층분석"
      icon={<ListChecks size={22} color="var(--brand)" />}
      back={{ href: '/ai-chat', label: 'AI 채팅으로' }}
      description="문서를 붙여넣거나 파일을 올리고 지시(선택)를 적으면, 문서 구조 그대로 그룹으로 묶어 보여줍니다."
      actions={onNewAnalysis && (
        <NbButton variant="ghost" onClick={onNewAnalysis}>
          <FilePlus2 size={16} />
          새 분석
        </NbButton>
      )}
    />
  )
}
