'use client'

// 인물 상세 (dacrm T1-02, 구현명세 §6.2)
//
// 회사·딜 상세와 같은 3열 골격이다. 세 화면의 뼈대가 같아야 사용자가 매번 다시 찾지 않는다.
// 우측 연결 패널은 이 사람이 속한 회사와 그 회사의 딜을 보여 준다 —
// 인물 자체에는 딜이 직접 붙지 않으므로, 이어지는 길을 회사를 거쳐 보여 준다.

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import NbButton from '@/components/ui/nb/NbButton'
import ContactLink from '@/components/ui/ContactLink'
import RecordLayout, { RecordPanel, RecordField, RecordFieldList } from '@/components/ui/crm/RecordLayout'
import { useVerified } from '@/lib/crm/use-verified'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import Timeline from '@/components/ui/crm/Timeline'
import RelatedList from '@/components/ui/crm/RelatedList'
import TaskPanel from '@/components/ui/crm/TaskPanel'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import PersonFormModal from '../PersonFormModal'
import DeleteRecordModal from '../../DeleteRecordModal'

interface Person {
  id: string
  name: string
  companyId: string | null
  email: string | null
  phone: string | null
  title: string | null
  lifecycleStage: string
  version: number
  updatedAt: string
}

interface CompanyRow { id: string; name: string; domain: string | null }
interface DealRow { id: string; name: string }

const STAGE_LABEL: Record<string, string> = {
  LEAD: '리드',
  MQL: '마케팅 검증',
  SQL: '영업 검증',
  CUSTOMER: '고객',
  CHURNED: '이탈',
}

export default function PersonDetail({ personId }: { personId: string }) {
  const [person, setPerson] = useState<Person | null>(null)
  /**
   * 필드 확정 — "이 값은 내가 확인했다"(절대규칙 2).
   * 잠근 칸은 AI 가 못 바꾼다. 이 스위치가 없어서 그 약속이 실행되지 않고 있었다.
   */
  const verify = useVerified('person', personId)
  const [company, setCompany] = useState<CompanyRow | null>(null)
  const [deals, setDeals] = useState<DealRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [timelineKey, setTimelineKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/people/${personId}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '인물을 불러오지 못했습니다.'); return }
      setPerson(body)

      // 회사가 없는 인물도 있다 — 그때는 연결 패널이 그 사실을 말한다
      if (body.companyId) {
        const [cRes, dRes] = await Promise.all([
          fetch(`/api/crm/companies/${body.companyId}`),
          fetch(`/api/crm/deals?companyId=${body.companyId}&limit=20`),
        ])
        if (cRes.ok) setCompany(await cRes.json())
        if (dRes.ok) setDeals((await dRes.json())?.items ?? [])
      } else {
        setCompany(null)
        setDeals([])
      }
    } catch {
      setError('인물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [personId])

  useEffect(() => { void load() }, [load])

  if (loading && !person) return <AXDotLoader />
  if (error || !person) {
    return (
      <>
        <PageHeader eyebrow="영업 CRM" title="인물" back={{ href: '/crm/people', label: '인물 목록' }} />
        <ErrorState message={error ?? '인물을 찾을 수 없습니다.'} onRetry={() => void load()} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title={person.name}
        back={{ href: '/crm/people', label: '인물 목록' }}
        description={[person.title, company?.name].filter(Boolean).join(' · ') || undefined}
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
              <RecordField label="직함" field="title"
                verified={verify.verified.includes('title')}
                onToggleVerified={verify.toggle}>{person.title}</RecordField>
              <RecordField label="이메일" field="email"
                verified={verify.verified.includes('email')}
                onToggleVerified={verify.toggle}>
                {/* 예전엔 여기 mailto 앵커가 있었지만 클래스가 없어 평문으로 보였다 — 누를 수 있는 줄 아무도 몰랐다 */}
                <ContactLink kind="email" value={person.email} icon={false} />
              </RecordField>
              <RecordField label="전화" field="phone"
                verified={verify.verified.includes('phone')}
                onToggleVerified={verify.toggle}>
                <ContactLink kind="phone" value={person.phone} icon={false} />
              </RecordField>
              <RecordField label="단계">
                {STAGE_LABEL[person.lifecycleStage] ?? person.lifecycleStage}
              </RecordField>
              <RecordField label="최근 변경">{formatKstDateTimeShort(person.updatedAt)}</RecordField>
            </RecordFieldList>
          </RecordPanel>

          <RecordPanel title="소속">
              {/* 회사 상세의 인물 목록과 같은 부품이다 — 같은 성격의 자리는 같은 모양이어야 한다(§2-5) */}
              <RelatedList
                loading={loading}
                items={company ? [{
                  id: company.id,
                  href: `/crm/companies/${company.id}`,
                  title: company.name,
                  contacts: { domain: company.domain },
                }] : []}
                empty={{
                  title: '소속 회사가 없어요',
                  description: '수정에서 회사를 지정하면 딜과 이어집니다.',
                  action: { label: '수정', onClick: () => setEditing(true) },
                }}
              />
          </RecordPanel>

          <RecordPanel title={`회사의 딜 ${deals.length}건`}>
              <RelatedList
                loading={loading}
                items={deals.map((d) => ({ id: d.id, href: `/crm/deals/${d.id}`, title: d.name }))}
                empty={{ title: '진행 중인 딜이 없어요', description: '딜 화면에서 영업 건을 만드세요.' }}
              />
          </RecordPanel>

          <RecordPanel title="타임라인">
            <Timeline key={timelineKey} scope={{ personId }} />
          </RecordPanel>
          </>
        }
        actions={
          <RecordPanel title="다음 할 일">
            <TaskPanel scope={{ personId }} onChanged={() => setTimelineKey((k) => k + 1)} />
          </RecordPanel>
        }
      />

      {editing && (
        <PersonFormModal
          // 이름까지 넘겨야 고르기 칸이 "무엇이 골라져 있는지"를 보여 준다 — id만으론 못 그린다
          initial={{ ...person, companyName: company?.name ?? null }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load() }}
        />
      )}

      {deleting && (
        <DeleteRecordModal
          entity="인물"
          name={person.name}
          endpoint={`/api/crm/people/${person.id}`}
          redirectTo="/crm/people"
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  )
}
