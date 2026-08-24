'use client'

// 미팅 캡처 — 모달 없는 한 화면 (통합 기획 §6)
//
// **저장 버튼이 없다.** 내용을 넣기 시작하는 순간이 저장이다.
//
// 왜 이렇게 바꿨나: 예전엔 목록에서 모달을 열어 제목·시각을 적고 저장하면
// 모달이 닫히고 **목록으로 돌아갔다.** 방금 만든 미팅을 눈으로 찾아 다시 클릭해야
// 비로소 내용을 넣을 수 있었다. 모달은 재사용하려고 만든 것인데 호출처가 한 곳뿐이었고,
// 저장 후 받은 새 미팅 id 를 **버리고 있었다**(실측 v0.7.573 조사).
//
// 미팅은 회사·인물·딜과 다르다. 그 셋은 만드는 순간 목적이 달성되는 레코드라 모달이 맞다.
// 미팅은 만든 직후가 껍데기다 — 진짜 목적인 내용이 모달 밖에 있다.
// 이 저장소의 캡처 흐름(QuickCreateBar · lead-intake · GPU 통합입력)은 전부 한 화면이다.

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mic, ClipboardPaste, NotebookPen, PenLine, ChevronDown, ChevronUp } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import NbModal from '@/components/ui/nb/NbModal'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import DateField from '@/components/ui/DateField'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'
import { useRecordingSession, useBusyWithOther } from '@/lib/meeting/recording-context'
import { kstTodayKey, formatKstDateTimeShort } from '@/lib/datetime/kst'
import styles from './capture.module.css'

interface PickableNote {
  id: string
  title: string | null
  meetingAt: string | null
  published: boolean
}

/** 제목을 안 적어도 시작할 수 있어야 한다 — 급할 때 제목부터 요구하면 사람은 딴 데 적는다 */
function fallbackTitle(dateKey: string): string {
  const [, m, d] = dateKey.split('-')
  return `${Number(m)}/${Number(d)} 미팅`
}

export default function MeetingCapture() {
  const router = useRouter()
  const params = useSearchParams()

  // 딜·회사 상세에서 넘어오면 그 건이 물려 온다.
  // 예전엔 '미팅 기록하기'가 목록으로만 보내서 보던 딜을 처음부터 다시 골라야 했다.
  const fixedDealId = params.get('dealId') ?? ''
  const fixedCompanyId = params.get('companyId') ?? ''

  const [title, setTitle] = useState('')
  const [date, setDate] = useState(kstTodayKey())
  const [time, setTime] = useState('14:00')
  const [companyId, setCompanyId] = useState(fixedCompanyId)
  const [companyName, setCompanyName] = useState('')
  const [dealId, setDealId] = useState(fixedDealId)
  const [dealName, setDealName] = useState('')
  const [location, setLocation] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(true)

  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [pickingNote, setPickingNote] = useState(false)
  const [notes, setNotes] = useState<PickableNote[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 녹음은 셸이 들고 있다 — 이 화면은 켜기만 하고, 주소가 바뀌어도 계속 돈다
  const rec = useRecordingSession()
  const recordingOther = useBusyWithOther('')

  /**
   * 미팅을 만든다 — **누른 그 순간이 저장이다.**
   * 미리 만들지 않는 이유: 들어왔다 나간 사람마다 빈 미팅이 쌓인다.
   * 회의노트도 함께 생긴다(D5) — 원본이 없는 미팅을 만들지 않기 위해서다.
   */
  const createMeeting = useCallback(async (): Promise<{ id: string; noteId: string } | null> => {
    const res = await fetch('/api/crm/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim() || fallbackTitle(date),
        // KST 벽시계를 그대로 보낸다 — 서버가 +09:00 앵커로 저장한다(datetime SSOT)
        startedAt: `${date}T${time}:00+09:00`,
        companyId: companyId || null,
        dealId: dealId || null,
        location: location.trim() || null,
        withNote: true,
      }),
    })
    const body = await res.json()
    if (!res.ok) { setError(body?.error?.message ?? '미팅을 만들지 못했습니다.'); return null }
    // `withNote:true` 라 회의노트도 함께 생긴다(D5) — 붙여넣기·작성은 그 원본으로 간다
    return { id: body.id as string, noteId: body.noteId as string }
  }, [title, date, time, companyId, dealId, location])

  /**
   * 녹음 — **여기서 바로 켠다.**
   *
   * 예전에는 미팅만 만들고 `?record=1` 을 붙여 상세로 보냈는데, 그 쿼리를 읽는 코드가
   * **어디에도 없었다**(v0.7.588 실측). 미팅은 생기고 화면은 넘어가는데 녹음은 시작되지 않았다.
   * 지금은 레코더가 셸에 있어(`RecordingProvider`) 주소가 바뀌어도 안 끊긴다 —
   * 그래서 **켜고 나서** 옮긴다.
   */
  async function startRecording() {
    setBusy('record')
    setError(null)
    try {
      const created = await createMeeting()
      if (!created) return
      await rec.start({
        noteId: created.noteId,
        title: title.trim() || fallbackTitle(date),
        href: `/crm/meetings/${created.id}`,
      })
      router.replace(`/crm/meetings/${created.id}`)
    } catch {
      setError('미팅을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * 직접 쓰기 — 진입 넷째.
   *
   * 사용자 지시(2026-08-24): *"회의노트가져오기도 좋은데 회의노트를 쓸 수도 있어야 할 것 같고"*.
   * 예전엔 녹음·붙여넣기·가져오기 셋뿐이라, 손으로 쓰려면 다른 셸의 회의노트로 나가야 했다.
   */
  async function startWriting() {
    setBusy('write')
    setError(null)
    try {
      const created = await createMeeting()
      if (!created) return
      router.replace(`/crm/meetings/${created.id}?wb=memo`)
    } catch {
      setError('미팅을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  async function savePasted() {
    if (!text.trim()) { setError('회의 내용을 붙여넣어 주세요.'); return }
    setBusy('paste')
    setError(null)
    try {
      const created = await createMeeting()
      if (!created) return
      /**
       * **원본에 먼저 넣는다.**
       * 예전엔 CRM 전사 API 로만 보내서, 함께 만들어진 회의노트가 **영원히 빈 껍데기**로 남았다
       * (v0.7.588 실측 F-5). "원본은 회의노트 하나"라는 원칙이 이 경로에서만 깨져 있었다.
       * 이제 노트가 원본을 갖고, CRM 은 그것을 다시 가져와 스냅샷으로 받는다.
       */
      const res = await fetch(`/api/meeting-notes/${created.noteId}/transcript`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json()
      if (!res.ok) {
        // 미팅은 이미 만들어졌다. 버리지 말고 데려가서 거기서 다시 넣게 한다 —
        // 여기서 멈추면 사용자가 붙여넣은 글이 통째로 사라진다.
        setError(`${body?.error ?? '회의 내용을 넣지 못했습니다.'} 미팅은 만들어졌어요.`)
        router.replace(`/crm/meetings/${created.id}`)
        return
      }
      // 스냅샷 따라잡기 — 실패해도 원본은 이미 남았으므로 화면을 막지 않는다
      await fetch(`/api/crm/meetings/${created.id}/resync`, { method: 'POST' }).catch(() => {})
      router.replace(`/crm/meetings/${created.id}`)
    } catch {
      setError('회의 내용을 넣지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  const loadNotes = useCallback(async () => {
    setNotes(null)
    try {
      const res = await fetch('/api/crm/meetings/notes?limit=20')
      const body = await res.json()
      setNotes(res.ok ? (body.items ?? []) : [])
    } catch {
      setNotes([])
    }
  }, [])

  useEffect(() => { if (pickingNote) void loadNotes() }, [pickingNote, loadNotes])

  async function publishNote(noteId: string) {
    setBusy('note')
    setError(null)
    try {
      const res = await fetch('/api/crm/meetings/from-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, companyId: companyId || null, dealId: dealId || null }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '회의노트를 가져오지 못했습니다.'); return }
      setPickingNote(false)
      // 이미 올라간 노트를 골랐으면 그 미팅으로 데려간다(발행이 멱등이라 그렇게 된다)
      router.replace(`/crm/meetings/${body.meetingId}`)
    } catch {
      setError('회의노트를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

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

  const working = busy !== null

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="미팅 기록"
        icon={<Mic size={20} />}
        description="녹음하거나 회의 내용을 넣으면 그 순간 저장됩니다. 따로 저장 버튼을 누르지 않아도 돼요."
        back={{ href: '/crm/meetings', label: '미팅' }}
      />

      <FormErrorBanner message={error} />

      <section className="card" style={{ padding: 'var(--space-5)' }}>
        <div className={styles.detailsHead}>
          <h2 className="tape-title" style={{ margin: 0 }}>이 미팅은</h2>
          <NbButton variant="ghost" onClick={() => setDetailsOpen((v) => !v)}>
            {detailsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {detailsOpen ? '접기' : '펴기'}
          </NbButton>
        </div>

        {detailsOpen && (
          <div className={styles.details}>
            <div>
              <label className="label" htmlFor="cap-title">무슨 미팅이었나요</label>
              <input
                id="cap-title" className="input-field" value={title} autoFocus
                placeholder={`비워 두면 "${fallbackTitle(date)}"`}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className={styles.pair}>
              <div>
                <label className="label" htmlFor="cap-date">날짜</label>
                <DateField id="cap-date" value={date} onValueChange={setDate} />
              </div>
              <div>
                <label className="label" htmlFor="cap-time">시각</label>
                <input id="cap-time" className="input-field" type="time" value={time}
                  onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>

            <div className={styles.pair}>
              <div>
                <label className="label" htmlFor="cap-company">회사</label>
                <RecordPickerField
                  id="cap-company" noun="회사" value={companyId} valueName={companyName}
                  placeholder="(아직 없음)"
                  onChange={(opt) => { setCompanyId(opt?.id ?? ''); setCompanyName(opt?.name ?? '') }}
                  search={searchCompanies}
                />
              </div>
              <div>
                <label className="label" htmlFor="cap-deal">딜</label>
                <RecordPickerField
                  id="cap-deal" noun="딜" value={dealId} valueName={dealName}
                  placeholder="(아직 없음)"
                  onChange={(opt) => { setDealId(opt?.id ?? ''); setDealName(opt?.name ?? '') }}
                  search={searchDeals}
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="cap-place">장소</label>
              <input id="cap-place" className="input-field" value={location}
                placeholder="예: 고객사 회의실 / 화상"
                onChange={(e) => setLocation(e.target.value)} />
            </div>
          </div>
        )}
      </section>

      <section className="card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
        <h2 className="tape-title" style={{ margin: '0 0 var(--space-4)' }}>회의 내용</h2>

        {!pasting ? (
          <div className={styles.entries}>
            <button
              type="button"
              className={styles.primaryEntry}
              onClick={() => void startRecording()}
              disabled={working || Boolean(recordingOther)}
            >
              <Mic size={22} aria-hidden />
              <span>{busy === 'record' ? '미팅을 만드는 중…' : '녹음 시작'}</span>
            </button>

            <div className={styles.otherEntries}>
              <NbButton variant="ghost" onClick={() => void startWriting()} disabled={working}>
                <PenLine size={16} /> {busy === 'write' ? '만드는 중…' : '직접 쓰기'}
              </NbButton>
              <NbButton variant="ghost" onClick={() => setPasting(true)} disabled={working}>
                <ClipboardPaste size={16} /> 회의 내용 붙여넣기
              </NbButton>
              <NbButton variant="ghost" onClick={() => setPickingNote(true)} disabled={working}>
                <NotebookPen size={16} /> 회의노트에서 가져오기
              </NbButton>
            </div>

            <p className={styles.hint}>
              {recordingOther
                ? `다른 회의("${recordingOther.title}")를 녹음하는 중이라 여기서는 시작할 수 없어요.`
                : '녹음은 10분마다 자동으로 저장돼요. 다른 화면으로 옮겨도 계속됩니다.'}
            </p>
          </div>
        ) : (
          <>
            <p className={styles.hint}>
              <code>이름: 말</code> 형태면 누가 한 말인지 알아봅니다.
            </p>
            <textarea
              className="input-field"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'김대표: 예산은 3억으로 품의 올렸습니다.\n윤수석: 보안 검토가 남아서 다음 달은 어려울 것 같아요.'}
              aria-label="회의 내용"
            />
            <div className={styles.pasteActions}>
              <NbButton variant="ghost" onClick={() => { setPasting(false); setError(null) }} disabled={working}>
                뒤로
              </NbButton>
              <NbButton onClick={() => void savePasted()} disabled={working}>
                {busy === 'paste' ? '넣는 중…' : '넣기'}
              </NbButton>
            </div>
          </>
        )}
      </section>

      {pickingNote && (
        <NbModal title="회의노트에서 가져오기" onClose={() => setPickingNote(false)}>
          <p className={styles.hint} style={{ marginTop: 0 }}>
            내가 쓴 회의노트를 영업 CRM에 올립니다. 회의 내용과 요약이 함께 넘어와요.
          </p>
          {notes === null ? (
            <AXDotLoader />
          ) : notes.length === 0 ? (
            <EmptyState
              title="가져올 회의노트가 없어요"
              description="회의노트에 먼저 기록하면 여기서 고를 수 있습니다."
              icon={<NotebookPen size={28} />}
            />
          ) : (
            <ul className={styles.noteList}>
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={styles.noteItem}
                    onClick={() => void publishNote(n.id)}
                    disabled={working}
                  >
                    <span className={styles.noteTitle}>{n.title || '(제목 없음)'}</span>
                    <span className={styles.noteMeta}>
                      {n.meetingAt ? formatKstDateTimeShort(n.meetingAt) : '일시 미지정'}
                    </span>
                    {/* 이미 올린 것을 숨기지 않는다 — 숨기면 "분명 있었는데"가 된다 */}
                    {n.published && <NbBadge status="done">올라감</NbBadge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </NbModal>
      )}
    </>
  )
}
