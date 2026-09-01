'use client'

/**
 * "이 미팅은" — 제목·시각·회사·딜·장소를 **이 자리에서 고친다.**
 *
 * **왜 생겼나**: 사용자 지시(2026-08-24) —
 * *"미팅기록 누르면 직접작성 누르면 화면이 또 다르고 왜 화면을 여러번 전환하게 하는거야?
 *   단일 화면에서 다 움직이게 해야지 미팅 갔는데 화면이 이리저리 전환 되면 안되는거야"*
 *
 * 예전엔 이 값들을 `/crm/meetings/new` 가 **미리 물었다.** 회의가 이미 시작된 상황에서
 * 제목부터 요구하면 사람은 딴 데 적는다. 그래서 안 묻고 시작하고, 여기서 채운다.
 * 상세는 읽기 전용이었기 때문에 그 화면을 없애려면 이 자리가 먼저 있어야 했다.
 *
 * **저장은 카드 단위다**(§2-5(4)) — 바꾼 게 있을 때만 저장 줄이 뜬다.
 * 자동 저장으로 하지 않는 이유: 회사·딜은 잘못 고르면 남의 딜에 회의가 붙는다.
 */

import { useCallback, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import DateField from '@/components/ui/DateField'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'
import { RecordPanel } from '@/components/ui/crm/RecordLayout'
import { kstParts } from '@/lib/datetime/kst'
import { adoptUntouched, sameSnapshot } from '@/lib/forms/resync'
import styles from './meeting-facts.module.css'

export interface MeetingFactsValue {
  title: string
  startedAt: string
  location: string | null
  companyId: string | null
  companyName: string | null
  dealId: string | null
  dealName: string | null
}

interface Props {
  meetingId: string
  value: MeetingFactsValue
  /**
   * 제목을 고칠 수 있나. **기본은 고칠 수 있다**(하위호환).
   *
   * 왜 제목만 따로 판정하나: 여기서 제목을 고치면 **원본 회의노트 제목도 함께 바뀐다**
   * (제목은 한 벌이다 — `syncNoteTitle`). 회의노트는 개인 소유라 남의 것을 고치게 두면
   * 팀원이 남의 개인 기록을 바꾸는 일이 된다. 못 하는 일은 **누르기 전에** 안 보여야 한다.
   */
  canEditTitle?: boolean
  /** 저장이 끝나면 상세가 스스로 다시 읽는다 — 화면이 서버와 갈리지 않게 */
  onSaved: () => void
}

/** UTC ISO → KST 벽시계 두 조각. 폼은 사람이 보는 시각으로 다룬다(datetime SSOT) */
function toWall(iso: string): { date: string; time: string } {
  const p = kstParts(iso)
  if (!p) return { date: '', time: '' }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

/**
 * 폼이 다루는 칸만 뽑아 문자열로 편다 — 재동기화 판정의 입력(`lib/forms/resync`).
 *
 * 이름(`companyName`)은 넣지 않는다. 사용자가 고르는 것은 **id** 이고 이름은 그 결과라,
 * 이름까지 비교하면 서버가 같은 회사를 다른 표기로 돌려줄 때 «바뀌었다»로 오판한다.
 */
function snapshotOf(v: MeetingFactsValue): Record<string, string> {
  const w = toWall(v.startedAt)
  return {
    title: v.title,
    date: w.date,
    time: w.time,
    location: v.location ?? '',
    companyId: v.companyId ?? '',
    dealId: v.dealId ?? '',
  }
}

export default function MeetingFacts({ meetingId, value, canEditTitle = true, onSaved }: Props) {
  const wall = toWall(value.startedAt)

  const [title, setTitle] = useState(value.title)
  const [date, setDate] = useState(wall.date)
  const [time, setTime] = useState(wall.time)
  const [location, setLocation] = useState(value.location ?? '')
  const [companyId, setCompanyId] = useState(value.companyId ?? '')
  const [companyName, setCompanyName] = useState(value.companyName ?? '')
  const [dealId, setDealId] = useState(value.dealId ?? '')
  const [dealName, setDealName] = useState(value.dealName ?? '')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 서버 값이 **밖에서** 바뀌었을 때 따라잡는다 — 「원본에 맞추기」로 제목이 바뀌거나
  // 「미팅 끝내기」 뒤 상세가 다시 읽었을 때. 안 하면 옛 값이 남아, 사용자가 「저장」을 누르는 순간
  // **방금 맞춘 제목이 되돌아간다.** 통째로 덮지 않는 이유는 `lib/forms/resync` 주석에 있다.
  const incoming = snapshotOf(value)
  const [base, setBase] = useState(incoming)
  if (!sameSnapshot(base, incoming)) {
    const merged = adoptUntouched(base, incoming, { title, date, time, location, companyId, dealId })
    setBase(incoming)
    setTitle(merged.title)
    setDate(merged.date)
    setTime(merged.time)
    setLocation(merged.location)
    // 이름은 id 를 실제로 바꿀 때만 함께 간다 — 안 그러면 고르던 이름이 지워진다
    if (merged.companyId !== companyId) {
      setCompanyId(merged.companyId)
      setCompanyName(value.companyName ?? '')
    }
    if (merged.dealId !== dealId) {
      setDealId(merged.dealId)
      setDealName(value.dealName ?? '')
    }
  }

  const dirty =
    title !== value.title ||
    date !== wall.date ||
    time !== wall.time ||
    location !== (value.location ?? '') ||
    companyId !== (value.companyId ?? '') ||
    dealId !== (value.dealId ?? '')

  const searchCompanies = useCallback(async (q: string, signal: AbortSignal): Promise<RecordOption[]> => {
    const res = await fetch(`/api/crm/companies?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '회사를 불러오지 못했습니다.')
    return (body.items ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
  }, [])

  const searchDeals = useCallback(async (q: string, signal: AbortSignal): Promise<RecordOption[]> => {
    const res = await fetch(`/api/crm/deals?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '딜을 불러오지 못했습니다.')
    return (body.items ?? []).map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))
  }, [])

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/crm/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || value.title,
          // KST 벽시계를 +09:00 앵커로 보낸다 — naive 문자열이면 9시간 어긋난다(datetime SSOT)
          ...(date && time ? { startedAt: `${date}T${time}:00+09:00` } : {}),
          location: location.trim() || null,
          companyId: companyId || null,
          dealId: dealId || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSaveError(body?.error?.message ?? '저장하지 못했습니다.')
        return
      }
      onSaved()
    } catch {
      setSaveError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <RecordPanel title="이 미팅은">
      <div className={styles.fields}>
        <div>
          <label className="label" htmlFor="mf-title">무슨 미팅이었나요</label>
          <input
            id="mf-title" className="input-field" value={title}
            readOnly={!canEditTitle}
            aria-describedby={canEditTitle ? undefined : 'mf-title-why'}
            onChange={(e) => setTitle(e.target.value)}
          />
          {/* 왜 못 고치는지 밝힌다 — 이유 없이 잠긴 칸은 고장으로 읽힌다 */}
          {!canEditTitle && (
            <p id="mf-title-why" className={styles.hint}>
              제목은 원본 회의노트를 만든 사람만 고칠 수 있어요.
            </p>
          )}
        </div>

        <div className={styles.pair}>
          <div>
            <label className="label" htmlFor="mf-date">날짜</label>
            <DateField id="mf-date" value={date} onValueChange={setDate} />
          </div>
          <div>
            <label className="label" htmlFor="mf-time">시각</label>
            <input
              id="mf-time" className="input-field" type="time" value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="mf-company">회사</label>
          <RecordPickerField
            id="mf-company" noun="회사" value={companyId} valueName={companyName}
            placeholder="(아직 없음)"
            onChange={(opt) => { setCompanyId(opt?.id ?? ''); setCompanyName(opt?.name ?? '') }}
            search={searchCompanies}
          />
        </div>

        <div>
          <label className="label" htmlFor="mf-deal">딜</label>
          <RecordPickerField
            id="mf-deal" noun="딜" value={dealId} valueName={dealName}
            placeholder="(아직 없음)"
            onChange={(opt) => { setDealId(opt?.id ?? ''); setDealName(opt?.name ?? '') }}
            search={searchDeals}
          />
        </div>

        <div>
          <label className="label" htmlFor="mf-place">장소</label>
          <input
            id="mf-place" className="input-field" value={location}
            placeholder="예: 고객사 회의실 / 화상"
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        {/* 실패를 조용히 삼키지 않는다 — 저장한 줄 알았는데 안 된 것이 가장 나쁘다 */}
        {saveError && <p className={styles.error} role="alert">{saveError}</p>}

        {/* 바꾼 게 있을 때만 뜬다 — 늘 떠 있으면 누를 이유가 없는 버튼이 된다 */}
        {dirty && (
          <div className={styles.actions}>
            <NbButton onClick={() => void save()} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </NbButton>
          </div>
        )}
      </div>
    </RecordPanel>
  )
}
