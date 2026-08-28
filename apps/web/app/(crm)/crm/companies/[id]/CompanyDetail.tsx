'use client'

// 회사 상세 (dacrm T1-02, 구현명세 §6.2)
//
// 딜 상세와 **같은 3열 골격**이다. 좌=이 회사가 무엇인가, 중=무슨 일이 있었나, 우=무엇과 이어져 있나.
// 중앙 타임라인과 우측 할 일은 공용 부품이다 — 세 상세 화면이 같은 것을 쓴다(§2-5).
//
// 삭제는 두 갈래다(사용자 결정): 휴지통(되돌릴 수 있음)과 완전 삭제(되돌릴 수 없음).
// 두 결과가 다르므로 확인 문구도 다르다 — describeDelete 가 그 문장의 SSOT 다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { backTarget, linkWithBack } from '@/lib/crm/nav/back-link'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import NbButton from '@/components/ui/nb/NbButton'
import RecordLayout, { RecordPanel, RecordField, RecordFieldList } from '@/components/ui/crm/RecordLayout'
import MeetingPanel from '@/components/ui/crm/MeetingPanel'
import RelatedList from '@/components/ui/crm/RelatedList'
import ContactLink from '@/components/ui/ContactLink'
import { useVerified } from '@/lib/crm/use-verified'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import Timeline from '@/components/ui/crm/Timeline'
import TaskPanel from '@/components/ui/crm/TaskPanel'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import CompanyFormModal from '../CompanyFormModal'
import PersonFormModal from '../../people/PersonFormModal'
import DealFormModal from '../../deals/DealFormModal'
import type { BoardPipeline } from '../../deals/DealBoard'
import { ENTITY, createLabel, emptyTitle } from '@/lib/terms'
import DeleteRecordModal from '../../DeleteRecordModal'

interface Company {
  id: string
  name: string
  domain: string | null
  industry: string | null
  region: string | null
  employeeRange: string | null
  descriptionMd: string | null
  version: number
  updatedAt: string
}

// 연락처까지 받는다 — 예전엔 email 을 받아 놓고 화면에서 버려, 회사에서 담당자에게 연락할 길이 없었다
interface PersonRow { id: string; name: string; title: string | null; email: string | null; phone: string | null }
interface DealRow { id: string; name: string; status: string }

export default function CompanyDetail({ companyId }: { companyId: string }) {
  /*
    돌아갈 곳은 **주소가 정한다**. 고정으로 적으면 딜에서 회사로 들어온 사람이
    뒤로 갔을 때 목록으로 튕긴다(사용자 지적). `returnTo` 가 있으면 그리로 간다.
  */
  const backParams = useSearchParams()
  const back = backTarget(backParams, { href: '/crm/companies', label: '회사 목록' })
  const [company, setCompany] = useState<Company | null>(null)
  /**
   * 필드 확정 — "이 값은 내가 확인했다"(절대규칙 2).
   * 잠근 칸은 AI 가 못 바꾼다. 이 스위치가 없어서 그 약속이 실행되지 않고 있었다.
   */
  const verify = useVerified('company', companyId)
  const [people, setPeople] = useState<PersonRow[]>([])
  const [deals, setDeals] = useState<DealRow[]>([])
  /*
    이 화면에서 만드는 것들. 저장하면 목록을 다시 읽는다 —
    만들었는데 화면이 그대로면 사용자는 저장이 안 된 줄 안다.
  */
  const [addingPerson, setAddingPerson] = useState(false)
  const [addingDeal, setAddingDeal] = useState(false)

  /*
    딜 폼은 파이프라인 목록이 있어야 뜬다. **누를 때** 불러온다 —
    화면을 열 때마다 부르면 딜을 안 만드는 사람에게도 요청이 하나 더 나간다.
  */
  const openDealForm = useCallback(async () => {
    setAddingDeal(true)
    if (pipelinesRef.current.length > 0) return
    try {
      const res = await fetch('/api/crm/pipelines')
      if (!res.ok) return
      const body = await res.json()
      pipelinesRef.current = body.items ?? []
      setPipelines(body.items ?? [])
    } catch {
      // 못 불러오면 폼이 안 뜬다 — 목록 화면에서 만들 수 있으므로 막다른 길은 아니다
    }
  }, [])
  // 딜 폼은 파이프라인 목록이 있어야 뜬다. 딜을 만들 때만 불러온다 — 이 화면의 첫 그리기를 늦추지 않게
  const [pipelines, setPipelines] = useState<BoardPipeline[]>([])
  // 두 번 부르지 않기 위한 표시 — state 는 콜백이 만들어진 시점 값이라 못 쓴다
  const pipelinesRef = useRef<BoardPipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 태스크를 완료하면 활동이 하나 생긴다 — 타임라인이 그걸 바로 보여줘야 한다
  const [timelineKey, setTimelineKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '회사를 불러오지 못했습니다.'); return }
      setCompany(body)

      const [pRes, dRes] = await Promise.all([
        fetch(`/api/crm/people?companyId=${companyId}&limit=50`),
        fetch(`/api/crm/deals?companyId=${companyId}&limit=50`),
      ])
      if (pRes.ok) setPeople((await pRes.json())?.items ?? [])
      if (dRes.ok) setDeals((await dRes.json())?.items ?? [])
    } catch {
      setError('회사를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // 여기서 다른 상세로 나갈 때 실어 보낼 «돌아올 곳»
  const here = { path: `/crm/companies/${companyId}`, label: company?.name ?? '회사' }

  useEffect(() => { void load() }, [load])

  if (loading && !company) return <AXDotLoader />
  if (error || !company) {
    return (
      <>
        <PageHeader eyebrow="영업 CRM" title="회사" back={back} />
        <ErrorState message={error ?? '회사를 찾을 수 없습니다.'} onRetry={() => void load()} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title={company.name}
        back={back}
        description={company.domain ?? undefined}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <NbButton variant="ghost" onClick={() => setEditing(true)}><Pencil size={16} /> 수정</NbButton>
            <NbButton variant="ghost" onClick={() => setDeleting(true)}><Trash2 size={16} /> 삭제</NbButton>
          </div>
        }
      />

      {verify.error && <FormErrorBanner message={verify.error} />}

      {/* 왼쪽=읽는 것(속성→관계→이력) · 오른쪽=하는 것 — 정책 §2-3-2 */}
      <RecordLayout
        info={
          <>
          <RecordPanel title="속성">
            <RecordFieldList>
              <RecordField label="도메인" field="domain"
                verified={verify.verified.includes('domain')}
                onToggleVerified={verify.toggle}>
                <ContactLink kind="domain" value={company.domain} icon={false} />
              </RecordField>
              <RecordField label="산업" field="industry"
                verified={verify.verified.includes('industry')}
                onToggleVerified={verify.toggle}>{company.industry}</RecordField>
              <RecordField label="지역" field="region"
                verified={verify.verified.includes('region')}
                onToggleVerified={verify.toggle}>{company.region}</RecordField>
              <RecordField label="규모" field="employeeRange"
                verified={verify.verified.includes('employeeRange')}
                onToggleVerified={verify.toggle}>{company.employeeRange ? `${company.employeeRange}명` : null}</RecordField>
              <RecordField label="최근 변경">{formatKstDateTimeShort(company.updatedAt)}</RecordField>
            </RecordFieldList>
          </RecordPanel>

          {/* L-3 — 회사 화면에 오는 이유의 대부분은 "누구에게 연락하지?"다. 속성 바로 다음에 둔다 */}
          {/*
            **여기서 바로 만든다.**
            예전엔 「인물 화면에서 이 회사로 담당자를 등록하세요」라고 **안내만** 했다.
            그런데 딜 상세의 「회사에 담당자 추가」가 이 화면으로 보내므로, 사용자는
            도착해서 다시 인물 화면을 찾아가야 했다 — **가라는 곳에 할 수 있는 것이 없었다**
            (사용자 지적: 「릴레이션 상태로 시스템이 되어 있으면 CRUD 쪽도 릴레이션을 충분히
            고려해야지 … 회사에 담당자 추가 누르면 바로 추가 되는 프로세스가 아니라
            회사 상세로 들어감 이것도 큰문제」).
          */}
          <RecordPanel
            title={`인물 ${people.length}명`}
            action={
              <NbButton variant="ghost" onClick={() => setAddingPerson(true)}>
                <Plus size={14} /> {createLabel(ENTITY.person.label)}
              </NbButton>
            }
          >
              <RelatedList
                loading={loading}
                items={people.map((p) => ({
                  id: p.id,
                  // 여기서 나갔다는 것을 실어 준다 — 그래야 그 화면의 「뒤로」가 이 회사로 돌아온다
                  href: linkWithBack(`/crm/people/${p.id}`, here),
                  title: p.name,
                  meta: p.title,
                  // 회사 화면에서 그 회사 사람에게 바로 연락한다 — 인물 상세로 한 번 더 들어가지 않는다
                  contacts: { email: p.email, phone: p.phone },
                }))}
                empty={{
                  title: emptyTitle('person'),
                  description: '이 회사에서 연락할 사람을 여기서 바로 등록할 수 있어요.',
                  action: { label: createLabel(ENTITY.person.label), onClick: () => setAddingPerson(true) },
                }}
              />
          </RecordPanel>

          <RecordPanel
            title={`딜 ${deals.length}건`}
            action={
              <NbButton variant="ghost" onClick={() => void openDealForm()}>
                <Plus size={14} /> {createLabel(ENTITY.deal.label)}
              </NbButton>
            }
          >
              <RelatedList
                loading={loading}
                items={deals.map((d) => ({ id: d.id, href: linkWithBack(`/crm/deals/${d.id}`, here), title: d.name, meta: d.status }))}
                empty={{
                  title: emptyTitle('deal'),
                  description: '이 회사의 영업 건을 여기서 바로 만들 수 있어요.',
                  action: { label: createLabel(ENTITY.deal.label), onClick: () => void openDealForm() },
                }}
              />
          </RecordPanel>

          {/* 이 회사와 무슨 이야기가 오갔나 — 딜별로 흩어져 있으면 못 본다 */}
          <RecordPanel title="이 회사의 미팅">
            <MeetingPanel scope={{ companyId }} />
          </RecordPanel>

          <RecordPanel title="타임라인">
            <Timeline key={timelineKey} scope={{ companyId }} />
          </RecordPanel>
          </>
        }
        actions={
          <RecordPanel title="다음 할 일">
            <TaskPanel scope={{ companyId }} onChanged={() => setTimelineKey((k) => k + 1)} />
          </RecordPanel>
        }
      />

      {editing && (
        <CompanyFormModal
          initial={{ ...company }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load() }}
        />
      )}

      {/*
        인물 — 회사가 **고정**된다. 회사 상세에서 만드는데 회사를 다시 고르라고 하면
        그건 인물 화면과 같은 것이고, 여기서 만드는 뜻이 없다(PersonFormModal 의 fixedCompanyId).
      */}
      {addingPerson && (
        <PersonFormModal
          fixedCompanyId={companyId}
          onClose={() => setAddingPerson(false)}
          onSaved={() => { setAddingPerson(false); void load() }}
        />
      )}

      {/* 딜 — 회사를 미리 채워 둔다. 이 회사 화면에서 시작했으니 다시 고를 이유가 없다 */}
      {addingDeal && pipelines.length > 0 && (
        <DealFormModal
          pipelines={pipelines}
          initial={{ companyId, companyName: company.name }}
          onClose={() => setAddingDeal(false)}
          onSaved={() => { setAddingDeal(false); void load() }}
        />
      )}

      {deleting && (
        <DeleteRecordModal
          entity="회사"
          name={company.name}
          endpoint={`/api/crm/companies/${company.id}`}
          redirectTo="/crm/companies"
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  )
}
