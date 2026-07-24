'use client'

import { AlertTriangle, MessagesSquare, Sparkles } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import type { GroupingOk } from './grouping-actions'
import DocTypeBadge from './DocTypeBadge'
import GroupList from './GroupList'
import DocMetaPanel from './DocMetaPanel'
import UnassignedBadge from './UnassignedBadge'
import RegroupBar from './RegroupBar'

interface Props {
  result: GroupingOk
  regrouping: boolean
  onRegroup: (newCommand: string) => void
  onDeepRun: () => void
  onConverse: () => void
  onStartOver: () => void
}

/** 목록 심층분석 결과 화면 — 그룹 접힘 리스트 + 유실 0 증명 + 재지시 루프(§B, T3.2~T3.5). */
export default function GroupsResultView({
  result,
  regrouping,
  onRegroup,
  onDeepRun,
  onConverse,
  onStartOver,
}: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <DocTypeBadge
          docType={result.docType}
          docTypeLabel={result.docTypeLabel}
          docTypeSource={result.docTypeSource}
        />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {result.groups.length}개 그룹으로 나뉘었습니다
        </span>
        {result.cutFallback && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius)',
              border: 'var(--hairline) solid var(--warning-border)',
              background: 'var(--warning-bg)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--warning)',
            }}
          >
            <AlertTriangle size={14} />
            AI 판정 실패 — 기본 구조로 묶었습니다
          </div>
        )}
      </div>

      <GroupList groups={result.groups} />

      <DocMetaPanel meta={result.meta} />

      <UnassignedBadge unassignedLines={result.unassignedLines} />

      <RegroupBar revision={result.revision} regrouping={regrouping} onRegroup={onRegroup} />

      <div
        className="card"
        style={{
          padding: 'var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
        }}
      >
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {result.groups.length}개 그룹 · 예상 {result.groups.length}회 호출
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <NbButton variant="ghost" onClick={onStartOver}>
            처음부터 다시
          </NbButton>
          <NbButton
            variant="ghost"
            onClick={onDeepRun}
            disabled={regrouping || result.groups.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}
          >
            <Sparkles size={16} />
            일괄 심화
          </NbButton>
          <NbButton
            onClick={onConverse}
            disabled={regrouping || result.groups.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}
          >
            <MessagesSquare size={16} />
            항목별 지시·대화
          </NbButton>
        </div>
      </div>
    </div>
  )
}
