'use client'

// 멤버 — 누가 이 CRM 을 쓰나 (dacrm)
//
// **왜 이 화면이 필요했나**: 호스트에 사용자가 32명인데 CRM 멤버는 1명이었다.
// 멤버가 아니면 CRM 자체에 못 들어오는데 **들일 화면이 없었다** —
// 혼자 쓰는 동안엔 안 보이지만, 팀이 쓰기 시작하는 순간 제품이 멈춘다.
//
// **여기서 지키는 것**: 관리자가 0명이 되는 상태를 만들지 않는다.
// 그 상태가 되면 되돌리는 방법은 DB 를 직접 고치는 것뿐이고,
// 그건 사용자가 할 수 있는 일이 아니다. 그래서 서버가 막고, 화면은 이유를 말한다.

import { useCallback, useEffect, useState } from 'react'
import { Users, UserPlus, UserMinus, Pencil } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import { ACTION, progress } from '@/lib/terms'
import NbBadge from '@/components/ui/nb/NbBadge'
import ContactLink from '@/components/ui/ContactLink'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { readApiError, describeFetchFailure } from '@/lib/crm/api/read-error'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { ROLES, ROLE_LABEL, ROLE_HINT } from '@/lib/crm/services/member'
import styles from './members.module.css'

/** 견적서에 찍히는 자기 정보 — 「내 정보」가 아니라 무엇을 고치는지 밝힌다 */
const PROFILE_LABEL = '직위·연락처'
const TITLE_LABEL = '직위'
const PHONE_LABEL = '연락처'
const TITLE_HINT = '견적서 담당자 줄에 이름과 함께 찍힙니다. 예: 팀장'
const PHONE_HINT = '고객이 이 번호로 직접 겁니다. 예: 010-0000-0000'

interface Member {
  id: string; hostUserId: string; displayName: string; email: string
  /** 견적서 담당자 줄에 이름과 함께 찍힌다 */
  title: string | null
  phone: string | null
  role: string; createdAt: string; deletedAt: string | null
}
interface Candidate { id: string; name: string; email: string }

export default function MembersClient({ canEdit, myMemberId }: { canEdit: boolean; myMemberId: string | null }) {
  const [items, setItems] = useState<Member[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [pick, setPick] = useState('')
  const [pickName, setPickName] = useState('')
  const [pickRole, setPickRole] = useState('MEMBER')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/members')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '멤버를 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
      setCandidates(body.candidates ?? [])
    } catch {
      setError('멤버를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 후보는 목록 API 가 통째로 내려준다(검색 파라미터가 없다) — 받아 둔 배열에서 걸러 쓴다.
  const searchCandidates = useCallback(async (q: string): Promise<RecordOption[]> => {
    const needle = q.trim().toLowerCase()
    return candidates
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle))
      .map((c) => ({ id: c.id, name: c.name, hint: c.email }))
  }, [candidates])

  async function call(url: string, init: RequestInit, ok: string, key: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(url, init)
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(body?.error?.message ?? '처리하지 못했습니다.'); return false }
      setNotice(ok)
      await load()
      return true
    } catch {
      setError('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function add() {
    const c = candidates.find((x) => x.id === pick)
    if (!c) { setError('들일 사람을 골라 주세요.'); return }
    const ok = await call('/api/crm/members', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostUserId: c.id, displayName: c.name, email: c.email, role: pickRole }),
    }, `${c.name} 님을 들였어요.`, 'add')
    if (ok) { setPick(''); setPickName('') }
  }

  if (loading && items.length === 0) return <AXDotLoader />
  if (error && items.length === 0) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <>
      <FormErrorBanner message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}

      {canEdit && (
        <div className={`card ${styles.add}`}>
          <div className={styles.addRow}>
            <div className={styles.addField}>
              <label className="label" htmlFor="member-pick">누구를 들일까요</label>
              {/* 후보는 직원 수만큼 자란다 — 드롭다운으로 두면 이름을 눈으로 훑어야 한다 */}
              <RecordPickerField
                id="member-pick"
                noun="사람"
                value={pick}
                valueName={pickName}
                placeholder="고르기"
                onChange={(opt) => { setPick(opt?.id ?? ''); setPickName(opt?.name ?? '') }}
                search={searchCandidates}
              />
            </div>
            <div className={styles.addField}>
              <label className="label" htmlFor="member-role">권한</label>
              <select
                id="member-role" className="input-field" value={pickRole}
                onChange={(e) => setPickRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
            <NbButton onClick={() => void add()} disabled={busy === 'add' || !pick}>
              <UserPlus size={16} /> {busy === 'add' ? '들이는 중…' : '들이기'}
            </NbButton>
          </div>
          <p className={styles.hint}>
            {ROLE_HINT[pickRole as keyof typeof ROLE_HINT]}
            {candidates.length === 0 && ' · 아직 안 들인 사람이 없어요.'}
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="아직 멤버가 없어요"
          description="팀원을 들이면 이 CRM 을 함께 쓸 수 있습니다."
          icon={<Users size={28} />}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((m) => (
            <li key={m.id} className={styles.item}>
              <span className={styles.who}>
                <span className={styles.name}>{m.displayName}</span>
                {m.title && <span className={styles.title}>{m.title}</span>}
                {/* 팀원에게도 같은 방식으로 닿는다 — 화면마다 이메일 그리는 법이 다르면 안 된다(§2-5) */}
                {m.email && <ContactLink kind="email" value={m.email} />}
                {m.phone && <ContactLink kind="phone" value={m.phone} />}
              </span>

              {m.id === myMemberId && <NbBadge status="doing">나</NbBadge>}

              {canEdit ? (
                <select
                  className={`input-field ${styles.role}`}
                  value={m.role}
                  aria-label={`${m.displayName} 권한`}
                  disabled={busy === m.id}
                  onChange={(e) => void call(
                    `/api/crm/members/${m.id}`,
                    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: e.target.value }) },
                    `${m.displayName} 님의 권한을 바꿨어요.`, m.id,
                  )}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              ) : (
                <NbBadge>{ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role}</NbBadge>
              )}

              <time className={styles.at} dateTime={m.createdAt}>
                {formatKstDateTimeShort(m.createdAt)}부터
              </time>

              {/*
                직위·연락처는 **견적서에 찍히는 자기 정보**라 본인도 고칠 수 있다.
                권한 변경만 관리자다 — 둘을 한 게이트로 묶으면 자기 전화번호를 못 고친다.
              */}
              {(canEdit || m.id === myMemberId) && (
                <NbButton variant="ghost" disabled={busy === m.id} onClick={() => setEditing(m)}>
                  <Pencil size={14} /> {PROFILE_LABEL}
                </NbButton>
              )}

              {canEdit && (
                <NbButton
                  variant="ghost"
                  disabled={busy === m.id}
                  onClick={() => void call(
                    `/api/crm/members/${m.id}`, { method: 'DELETE' },
                    `${m.displayName} 님을 내보냈어요. 기록은 그대로 남습니다.`, m.id,
                  )}
                >
                  <UserMinus size={14} /> 내보내기
                </NbButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {!canEdit && (
        <p className={styles.readonly}>
          멤버를 들이거나 권한을 바꾸려면 관리자 권한이 필요합니다.
        </p>
      )}
    {editing && (
        <ProfileModal
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </>
  )
}


/**
 * 직위·연락처 편집.
 *
 * **왜 별도 모달인가**: 목록 행에 입력칸을 두면 행이 두 배로 높아지고,
 * 열 명이면 화면이 입력칸으로 덮인다. 고치는 일은 드물다 — 드문 일은 모달이 맞다.
 */
function ProfileModal({ member, onClose, onSaved }: {
  member: Member
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(member.title ?? '')
  const [phone, setPhone] = useState(member.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), phone: phone.trim() }),
      })
      const body = await res.json()
      if (!res.ok) { setError(readApiError(body, '저장하지 못했습니다.')); return }
      onSaved()
    } catch {
      setError(describeFetchFailure(PROFILE_LABEL))
    } finally {
      setSaving(false)
    }
  }

  return (
    <NbModal
      title={`${member.displayName} · ${PROFILE_LABEL}`}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={saving}>{ACTION.cancel}</NbButton>
          <NbButton onClick={() => void save()} disabled={saving}>
            {saving ? progress(ACTION.save) : ACTION.save}
          </NbButton>
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <div>
          <label className="label" htmlFor="mp-title">{TITLE_LABEL}</label>
          <input
            id="mp-title" className="input-field" value={title}
            onChange={(e) => setTitle(e.target.value)} placeholder="팀장"
          />
          <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{TITLE_HINT}</p>
        </div>
        <div>
          <label className="label" htmlFor="mp-phone">{PHONE_LABEL}</label>
          <input
            id="mp-phone" className="input-field" value={phone} inputMode="tel"
            onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000"
          />
          <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{PHONE_HINT}</p>
        </div>
      </div>
    </NbModal>
  )
}
