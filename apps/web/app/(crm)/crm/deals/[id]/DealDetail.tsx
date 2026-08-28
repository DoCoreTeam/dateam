'use client'

// 딜 상세 (dacrm T1-03, 구현명세 §6.2)
//
// 3열 표준을 그대로 쓴다 — 회사·인물 상세와 골격이 같아야 사용자가 매번 다시 찾지 않는다.
// 중앙은 **단계 이동 이력 + 활동 타임라인**이다. 이력은 딜에만 있는 사실(경로)이고,
// 타임라인은 세 상세가 공유하는 사실(무슨 일이 있었나)이라 둘 다 필요하다.

import { useCallback, useEffect, useState } from 'react'
import Sensitive from '@/components/crm/Sensitive'
import Link from 'next/link'
import { Pencil, Trash2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { backTarget, linkWithBack } from '@/lib/crm/nav/back-link'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import RecordLayout, { RecordPanel, RecordField, RecordFieldList } from '@/components/ui/crm/RecordLayout'
import MeetingPanel from '@/components/ui/crm/MeetingPanel'
import Timeline from '@/components/ui/crm/Timeline'
import TaskPanel from '@/components/ui/crm/TaskPanel'
import QuotePanel from '@/components/ui/crm/QuotePanel'
import DealContacts from './DealContacts'
import CostPanel from '@/components/ui/crm/CostPanel'
import { COST } from '@/lib/terms/cost'
import LedgerPanel from './LedgerPanel'
import type { StatusKey } from '@/lib/tokens/status-colors'
import { formatKstDateTimeShort, kstDateKey } from '@/lib/datetime/kst'
import {
  BUSINESS_TYPE_LABEL, BUSINESS_TYPE_LABEL_TEXT, TERM_TYPE_LABEL, TERM_TYPE_LABEL_TEXT,
  type BusinessTypeKey, type TermTypeKey,

  EXPECTED_CLOSE_LABEL, END_DATE_UNKNOWN_LABEL,
} from '@/lib/terms'
import type { BoardPipeline } from '../DealBoard'
import DealFormModal from '../DealFormModal'
import DeleteRecordModal from '../../DeleteRecordModal'

interface Deal {
  id: string
  name: string
  companyId: string
  pipelineId: string
  stageId: string
  status: string
  amountMinor: string | null
  businessType?: string | null
  termType?: string | null
  startDate?: string | null
  endDate?: string | null
  currency: string | null
  expectedCloseDate: string | null
  endDateUnknown?: boolean
  wonAt: string | null
  lostReason: string | null
  version: number
  updatedAt: string
}

interface HistoryRow {
  id: string
  fromStageId: string | null
  toStageId: string | null
  movedAt: string
  durationSec: number | null
}

interface CompanyRow { id: string; name: string; domain: string | null }

const STATUS_META: Record<string, { label: string; status: StatusKey }> = {
  OPEN: { label: '진행 중', status: 'doing' },
  WON: { label: '수주', status: 'done' },
  LOST: { label: '실주', status: 'blocker' },
}

/** 체류 시간은 사람이 읽는 단위로 — 190초를 그대로 보여 주면 아무도 안 읽는다 */
function formatDuration(sec: number | null): string {
  if (sec === null) return '첫 진입'
  if (sec < 60) return `${sec}초 머무름`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 머무름`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 머무름`
  return `${Math.floor(hour / 24)}일 머무름`
}

/** 기간 표기 — 장기면 실제 기간까지 함께 보여 준다 */
function termText(d: {
  termType?: string | null; startDate?: string | null; endDate?: string | null; endDateUnknown?: boolean
}): string {
  const label = TERM_TYPE_LABEL[d.termType as TermTypeKey] ?? d.termType ?? ''
  if (!d.startDate) return label
  // 「정할 수 없다」와 「아직 안 적었다」는 다르게 보여야 한다 —
  // 크레딧 사업에 빈 칸을 두면 덜 채운 것처럼 읽힌다
  if (d.endDateUnknown) return `${label} · ${kstDateKey(d.startDate)} ~ ${END_DATE_UNKNOWN_LABEL}`
  if (!d.endDate) return label
  return `${label} · ${kstDateKey(d.startDate)} ~ ${kstDateKey(d.endDate)}`
}

export default function DealDetail({ dealId }: { dealId: string }) {
  /*
    돌아갈 곳은 **주소가 정한다**. 고정으로 적으면 딜에서 회사로 들어온 사람이
    뒤로 갔을 때 목록으로 튕긴다(사용자 지적). `returnTo` 가 있으면 그리로 간다.
  */
  const backParams = useSearchParams()
  const back = backTarget(backParams, { href: '/crm/deals', label: '딜 목록' })
  const [deal, setDeal] = useState<Deal | null>(null)
  const [pipelines, setPipelines] = useState<BoardPipeline[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [company, setCompany] = useState<CompanyRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [timelineKey, setTimelineKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dRes, pRes, hRes] = await Promise.all([
        fetch(`/api/crm/deals/${dealId}`),
        fetch('/api/crm/pipelines'),
        fetch(`/api/crm/deals/${dealId}/history`),
      ])
      const dBody = await dRes.json()
      if (!dRes.ok) {
        // 404 는 "없다"가 아니라 "당신에게는 없다"이기도 하다(DI-01) — 서버 문장을 그대로 쓴다
        setError(dBody?.error?.message ?? '딜을 불러오지 못했습니다.')
        return
      }
      setDeal(dBody)
      setPipelines((await pRes.json())?.items ?? [])
      setHistory((await hRes.json())?.items ?? [])

      // 회사 카드는 실패해도 본문을 막지 않는다 — 딜 자체는 이미 보여 줄 수 있다.
      // 참석자는 DealContacts 가 스스로 불러온다(이 딜의 사람들은 회사 인물과 다르다).
      const cRes = await fetch(`/api/crm/companies/${dBody.companyId}`)
      if (cRes.ok) setCompany(await cRes.json())
    } catch {
      setError('딜을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [dealId])

  // 여기서 다른 상세로 나갈 때 실어 보낼 «돌아올 곳»
  const here = { path: `/crm/deals/${dealId}`, label: deal?.name ?? '딜' }

  useEffect(() => { void load() }, [load])

  if (loading && !deal) return <AXDotLoader />
  if (error || !deal) {
    return (
      <>
        <PageHeader eyebrow="영업 CRM" title="딜" back={back} />
        <ErrorState message={error ?? '딜을 찾을 수 없습니다.'} onRetry={() => void load()} />
      </>
    )
  }

  const stageName = new Map<string, string>()
  for (const p of pipelines) for (const s of p.stages) stageName.set(s.id, s.name)
  const pipelineName = pipelines.find((p) => p.id === deal.pipelineId)?.name ?? null
  const meta = STATUS_META[deal.status] ?? { label: deal.status, status: 'note' as StatusKey }

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title={deal.name}
        back={back}
        description={`${pipelineName ?? '파이프라인'} · ${stageName.get(deal.stageId) ?? '단계 미상'}`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <NbButton variant="ghost" onClick={() => setEditing(true)}><Pencil size={16} /> 수정</NbButton>
            <NbButton variant="ghost" onClick={() => setDeleting(true)}><Trash2 size={16} /> 삭제</NbButton>
          </div>
        }
      />

      <RecordLayout
        info={
          <>
            <RecordPanel title="속성">
              <RecordFieldList>
                <RecordField label="상태"><NbBadge status={meta.status}>{meta.label}</NbBadge></RecordField>
                <RecordField label="회사">
                  {company
                    // 여기서 나갔다는 것을 실어 준다 — 회사 화면의 「뒤로」가 이 딜로 돌아온다
                    ? <Link href={linkWithBack(`/crm/companies/${company.id}`, here)}>{company.name}</Link>
                    : null}
                </RecordField>
                <RecordField label="파이프라인">{pipelineName}</RecordField>
                <RecordField label="현재 단계">{stageName.get(deal.stageId) ?? null}</RecordField>
                {/*
                  「금액」은 여기서 말하지 않는다 — 바로 아래 장부가 수주 매출·현물 제외로
                  더 정확히 답한다. 두 곳에서 말하면 언젠가 서로를 반박한다
                  (실브라우저: 속성 「금액 —」과 장부 「20억」이 같은 화면에 떴다).
                */}
                <RecordField label={BUSINESS_TYPE_LABEL_TEXT}>
                  {deal.businessType ? BUSINESS_TYPE_LABEL[deal.businessType as BusinessTypeKey] ?? deal.businessType : null}
                </RecordField>
                <RecordField label={TERM_TYPE_LABEL_TEXT}>
                  {deal.termType ? termText(deal) : null}
                </RecordField>
                {/* 마감일·성사일은 **날짜**다 — 시각을 붙이면 "9시까지"로 읽힌다(실브라우저에서 잡음) */}
                <RecordField label={EXPECTED_CLOSE_LABEL}>
                  {deal.expectedCloseDate ? kstDateKey(deal.expectedCloseDate) : null}
                </RecordField>
                {deal.status === 'WON' && (
                  <RecordField label="성사일">
                    {deal.wonAt ? kstDateKey(deal.wonAt) : null}
                  </RecordField>
                )}
                {deal.status === 'LOST' && (
                  <RecordField label="실주 사유">{deal.lostReason}</RecordField>
                )}
                <RecordField label="최근 변경">{formatKstDateTimeShort(deal.updatedAt)}</RecordField>
              </RecordFieldList>
            </RecordPanel>

            {/*
              매출 인식 장부 — 「금액」 한 칸이 답하지 못하던 것들.
              수주 매출·현물 제외·부가세·재원이 여기 모인다.
              기본은 숫자 둘만 보이고 나머지는 접혀 있다(사용자 지시).
            */}
            <RecordPanel title="매출 인식 장부">
              <LedgerPanel dealId={dealId} />
            </RecordPanel>

            {/*
              원가·마진 — **장부 바로 다음**이다.
              「얼마에 팔았나」 옆에 「얼마가 들었나」가 있어야 «남는 장사인가»를 한 자리에서 본다.
              권한이 없으면 이 패널은 **아예 안 그려진다**(CostPanel 이 403 에 null 을 준다) —
              「볼 수 없습니다」를 띄우면 원가가 있다는 사실 자체가 샌다.
            */}
            <RecordPanel title={COST.section}>
              <CostPanel dealId={dealId} currency={deal.currency ?? 'KRW'} onChanged={() => setTimelineKey((k) => k + 1)} />
            </RecordPanel>

            {/*
              이 딜의 사람들 — 회사 인물 전체가 아니다.
              예전엔 회사의 인물을 전부 뿌려서 "누구를 설득해야 하나"에 답을 못 했다.
            */}
            <RecordPanel title="이 딜의 사람들">
              <DealContacts dealId={dealId} companyId={deal?.companyId ?? null} />
            </RecordPanel>

            {/*
              견적 — 딜 금액이 어디서 나왔는지에 대한 답.
              수락된 견적의 총액은 딜 금액으로 옮겨지므로, 바뀌면 상세를 다시 읽는다.
            */}
            <RecordPanel title="견적">
              <QuotePanel
                dealId={dealId}
                dealName={deal.name}
                dealCurrency={deal.currency}
                onChanged={() => { setTimelineKey((k) => k + 1); void load() }}
              />
            </RecordPanel>

            {/* 딜을 여는 사람이 가장 자주 하는 질문 — "지난번에 뭐라고 했지?" */}
            <RecordPanel title="이 딜의 미팅">
              <MeetingPanel scope={{ dealId }} />
            </RecordPanel>

            <RecordPanel title="단계 이동 이력">
            {history.length === 0 ? (
              <EmptyState
                title="이동 기록이 아직 없어요"
                description="보드에서 단계를 옮기면 여기에 경로가 쌓입니다."
              />
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
                {history.map((h) => (
                  <li key={h.id} style={{
                    display: 'grid', gap: 2, paddingLeft: 'var(--space-3)',
                    borderLeft: 'var(--border-w-2) solid var(--border-light)',
                  }}>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontWeight: 600 }}>
                      {h.fromStageId
                        ? `${stageName.get(h.fromStageId) ?? '이전 단계'} → ${stageName.get(h.toStageId ?? '') ?? '다음 단계'}`
                        : `${stageName.get(h.toStageId ?? '') ?? '첫 단계'}에서 시작`}
                    </div>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                      {formatKstDateTimeShort(h.movedAt)} · {formatDuration(h.durationSec)}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            </RecordPanel>

            <RecordPanel title="타임라인">
              <Timeline key={timelineKey} scope={{ dealId }} />
            </RecordPanel>
          </>
        }
        actions={
          <RecordPanel title="다음 할 일">
            <TaskPanel scope={{ dealId }} onChanged={() => setTimelineKey((k) => k + 1)} />
          </RecordPanel>
        }
      />

      {editing && (
        <DealFormModal
          pipelines={pipelines}
          initial={{
            id: deal.id, name: deal.name, companyId: deal.companyId,
            // 이름까지 넘겨야 고르기 칸이 "무엇이 골라져 있는지"를 보여 준다 — id만으론 못 그린다
            companyName: company?.name,
            pipelineId: deal.pipelineId, stageId: deal.stageId,
            amountMinor: deal.amountMinor, currency: deal.currency,
            expectedCloseDate: deal.expectedCloseDate?.slice(0, 10) ?? '',
            endDateUnknown: deal.endDateUnknown ?? false,
            businessType: deal.businessType ?? '',
            termType: deal.termType ?? '',
            startDate: deal.startDate?.slice(0, 10) ?? '',
            endDate: deal.endDate?.slice(0, 10) ?? '',
            version: deal.version,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load() }}
        />
      )}

      {deleting && (
        <DeleteRecordModal
          entity="딜"
          name={deal.name}
          endpoint={`/api/crm/deals/${deal.id}`}
          redirectTo="/crm/deals"
          // 딜을 지우면 그 경로도 함께 사라진다 — 무엇이 없어지는지 먼저 말한다
          impact={{ removed: history.length > 0 ? [`단계 이동 이력 ${history.length}건`] : [], kept: ['회사와 인물은 그대로 남습니다'] }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  )
}
