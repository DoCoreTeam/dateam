'use client'

// 회사 상세 (dacrm T1-02, 구현명세 §6.2)
//
// 딜 상세와 **같은 3열 골격**이다. 좌=이 회사가 무엇인가, 중=무슨 일이 있었나, 우=무엇과 이어져 있나.
// 중앙 타임라인과 우측 할 일은 공용 부품이다 — 세 상세 화면이 같은 것을 쓴다(§2-5).
//
// 삭제는 두 갈래다(사용자 결정): 휴지통(되돌릴 수 있음)과 완전 삭제(되돌릴 수 없음).
// 두 결과가 다르므로 확인 문구도 다르다 — describeDelete 가 그 문장의 SSOT 다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Pencil, Trash2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import NbButton from '@/components/ui/nb/NbButton'
import RecordLayout, { RecordPanel, RecordField, RecordFieldList } from '@/components/ui/crm/RecordLayout'
import MeetingPanel from '@/components/ui/crm/MeetingPanel'
import { useVerified } from '@/lib/crm/use-verified'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import Timeline from '@/components/ui/crm/Timeline'
import TaskPanel from '@/components/ui/crm/TaskPanel'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import CompanyFormModal from '../CompanyFormModal'
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

interface PersonRow { id: string; name: string; title: string | null; email: string | null }
interface DealRow { id: string; name: string; status: string }

export default function CompanyDetail({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<Company | null>(null)
  /**
   * 필드 확정 — "이 값은 내가 확인했다"(절대규칙 2).
   * 잠근 칸은 AI 가 못 바꾼다. 이 스위치가 없어서 그 약속이 실행되지 않고 있었다.
   */
  const verify = useVerified('company', companyId)
  const [people, setPeople] = useState<PersonRow[]>([])
  const [deals, setDeals] = useState<DealRow[]>([])
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

  useEffect(() => { void load() }, [load])

  if (loading && !company) return <AXDotLoader />
  if (error || !company) {
    return (
      <>
        <PageHeader eyebrow="영업 CRM" title="회사" back={{ href: '/crm/companies', label: '회사 목록' }} />
        <ErrorState message={error ?? '회사를 찾을 수 없습니다.'} onRetry={() => void load()} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title={company.name}
        back={{ href: '/crm/companies', label: '회사 목록' }}
        description={company.domain ?? undefined}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <NbButton variant="ghost" onClick={() => setEditing(true)}><Pencil size={16} /> 수정</NbButton>
            <NbButton variant="ghost" onClick={() => setDeleting(true)}><Trash2 size={16} /> 삭제</NbButton>
          </div>
        }
      />

      {verify.error && <FormErrorBanner message={verify.error} />}

      <RecordLayout
        fields={
          <RecordPanel title="속성">
            <RecordFieldList>
              <RecordField label="도메인" field="domain"
                verified={verify.verified.includes('domain')}
                onToggleVerified={verify.toggle}>{company.domain}</RecordField>
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
        }
        timeline={
          <RecordPanel title="타임라인">
            <Timeline key={timelineKey} scope={{ companyId }} />
          </RecordPanel>
        }
        related={
          <>
            <RecordPanel title="다음 할 일">
              <TaskPanel scope={{ companyId }} onChanged={() => setTimelineKey((k) => k + 1)} />
            </RecordPanel>

            <RecordPanel title={`인물 ${people.length}명`}>
              {people.length === 0 ? (
                <EmptyState title="담당자가 없어요" description="인물 화면에서 이 회사로 담당자를 등록하세요." />
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
                  {people.map((p) => (
                    <li key={p.id} style={{ fontSize: 'var(--fs-sm)' }}>
                      <Link href={`/crm/people/${p.id}`}>{p.name}</Link>
                      {p.title && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-2xs)' }}> · {p.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </RecordPanel>

            <RecordPanel title={`딜 ${deals.length}건`}>
              {deals.length === 0 ? (
                <EmptyState title="진행 중인 딜이 없어요" description="딜 화면에서 이 회사의 영업 건을 만드세요." />
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
                  {deals.map((d) => (
                    <li key={d.id} style={{ fontSize: 'var(--fs-sm)' }}>
                      <Link href={`/crm/deals/${d.id}`}>{d.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </RecordPanel>

            {/* 이 회사와 무슨 이야기가 오갔나 — 딜별로 흩어져 있으면 못 본다 */}
            <RecordPanel title="이 회사의 미팅">
              <MeetingPanel scope={{ companyId }} />
            </RecordPanel>
          </>
        }
      />

      {editing && (
        <CompanyFormModal
          initial={{ ...company }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load() }}
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
