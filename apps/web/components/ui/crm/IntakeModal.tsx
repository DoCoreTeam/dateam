'use client'

// 한 번에 등록 — 명함 · 서명 붙여넣기 · 엑셀
//
// **왜 한 자리에 모으나**: 셋 다 «회사와 사람을 만든다»는 같은 일이다.
// 입구가 흩어져 있으면(붙여넣기는 딜 화면, 엑셀은 설정) 사용자는 매번 어디로 가야 하는지
// 기억해야 하고, 명함은 아예 넣을 곳이 없었다
// (사용자 지시: 「명함 이미지를 넣는게 있으면 한번에 다 등록 시킬 수 있는거자나?
//  … 이미지는 n장도 넣을 수 있고 엑셀로 밀어 넣을 수도 있고 … 메일 하단 서명을 복붙해서」).
//
// **셋이 같은 길로 합류한다.** 명함은 이미지를 글자로 바꿔 붙여넣기 칸에 넣고,
// 그 다음은 붙여넣기와 완전히 같다 — 중복 판정·빈 칸 묻기가 한 벌이다.

import { useCallback, useRef, useState } from 'react'
import { Upload, ClipboardPaste, FileSpreadsheet, PenLine, X } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, ENTITY, progress } from '@/lib/terms'
import { CARD_MAX_COUNT, CARD_MIME_OK } from '@/lib/crm/services/card-read'
import styles from './intake-modal.module.css'

/**
 * 등록하는 네 가지 방법.
 *
 * **버튼을 넷으로 나누지 않는다.** 도구 줄이 버튼밭이 되면 «회사를 넣으려면 어디를 누르지»가
 * 오히려 어려워진다. 하나를 누르고 방법을 고르는 것이 손이 덜 간다
 * (사용자 지시: 「회사 추가 버튼을 등록 버튼으로 하고 누르면 메뉴로 … 최적의 상태로 해줘」).
 * `form` 이 첫 자리인 이유: 한 곳을 손으로 넣는 것이 가장 흔하다.
 */
type Mode = 'form' | 'card' | 'paste' | 'excel'

interface CardItem {
  fileName: string
  text: string
}

interface Props {
  /**
   * 어느 화면에서 열렸나.
   *
   * **명함·서명·엑셀은 회사와 사람을 함께 만든다** — 어느 쪽에서 열든 하는 일이 같다.
   * 달라지는 것은 ① 제목 ② 「직접 입력」이 어느 폼을 여는가 ③ 안내 문구뿐이다
   * (사용자 지적: 「회사 인물에 둘다 해당되는 기능들이니깐 양쪽에서 다 쓸수 있는 레이아웃이어야겠지?」).
   */
  surface: 'company' | 'person'
  onClose: () => void
  /** 등록이 끝나면 목록을 다시 읽는다 */
  onDone: () => void
  /** 「직접 입력」을 골랐을 때 — 그 화면의 폼을 연다(이 모달이 폼을 다시 만들지 않는다) */
  onManual: () => void
}

export default function IntakeModal({ surface, onClose, onDone, onManual }: Props) {
  const noun = surface === 'person' ? ENTITY.person.label : ENTITY.company.label
  const [mode, setMode] = useState<Mode>('form')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** 명함에서 읽은 글자 — 사람이 확인하고 고칠 수 있다 */
  const [cards, setCards] = useState<CardItem[]>([])
  const [failed, setFailed] = useState<{ fileName: string; reason: string }[]>([])
  const [paste, setPaste] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null)

  /** 명함 읽기 — 레코드는 아직 안 만든다. 글자를 보여 주고 사람이 확인한 뒤에 만든다 */
  const readCards = useCallback(async (files: FileList) => {
    setBusy(true)
    setError(null)
    setFailed([])
    try {
      const form = new FormData()
      for (const f of Array.from(files).slice(0, CARD_MAX_COUNT)) form.append('files', f)
      const res = await fetch('/api/crm/cards/read', { method: 'POST', body: form })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '명함을 읽지 못했습니다.'); return }
      setCards((prev) => [...prev, ...(body.items ?? [])])
      setFailed(body.failed ?? [])
    } catch {
      setError('명함을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [])

  /**
   * 등록 — 명함이든 붙여넣기든 **같은 경로**로 간다.
   * 명함 여러 장은 한 장씩 보낸다: 한 번에 보내면 모델이 사람을 섞는다.
   */
  const register = useCallback(async () => {
    const texts = mode === 'card' ? cards.map((c) => c.text) : [paste.trim()]
    const usable = texts.filter(Boolean)
    if (usable.length === 0) {
      setError(mode === 'card' ? '읽은 명함이 없어요.' : '붙여넣을 내용을 입력해 주세요.')
      return
    }

    setBusy(true)
    setError(null)
    let created = 0
    let skipped = 0
    try {
      for (const text of usable) {
        const res = await fetch('/api/crm/quick-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, createDeal: false }),
        })
        const body = await res.json()
        // **한 건이 실패해도 나머지를 계속한다** — 명함 열 장 중 하나 때문에 전부 잃지 않는다
        if (!res.ok) { skipped += 1; continue }
        created += (body.created?.length ?? 0)
      }
      setDone({ created, skipped })
      onDone()
    } catch {
      setError('등록하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }, [cards, mode, onDone, paste])

  return (
    <NbModal
      title={`${noun} 등록`}
      onClose={onClose}
      footer={
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>
            {done ? '닫기' : ACTION.cancel}
          </NbButton>
          {mode !== 'excel' && mode !== 'form' && !done && (
            <NbButton onClick={() => void register()} disabled={busy}>
              {busy ? progress('등록') : '등록'}
            </NbButton>
          )}
        </div>
      }
    >
      <div className={styles.wrap}>
        <SegmentedTabs
          tabs={[
            { id: 'form', label: '직접 입력', icon: <PenLine size={14} /> },
            { id: 'card', label: '명함 사진', icon: <Upload size={14} /> },
            { id: 'paste', label: '서명 붙여넣기', icon: <ClipboardPaste size={14} /> },
            { id: 'excel', label: '엑셀·CSV', icon: <FileSpreadsheet size={14} /> },
          ]}
          ariaLabel="등록 방법"
          activeId={mode}
          onSelect={(id) => { setMode(id as Mode); setError(null); setDone(null) }}
        />

        <FormErrorBanner message={error} />

        {done && (
          <p className={styles.done}>
            {done.created}건을 등록했어요.
            {done.skipped > 0 && ` ${done.skipped}건은 읽지 못해 건너뛰었습니다.`}
          </p>
        )}

        {mode === 'form' && (
          <div className={styles.pane}>
            <p className={styles.hint}>
              {noun} 하나를 손으로 넣습니다. 이름만 있어도 되고, 나머지는 나중에 채울 수 있어요.
            </p>
            {/* 폼은 이미 있다 — 이 모달이 다시 만들지 않는다(재사용·단일구현) */}
            <NbButton onClick={onManual}>
              <PenLine size={14} /> {noun} 정보 입력하기
            </NbButton>
          </div>
        )}

        {mode === 'card' && (
          <div className={styles.pane}>
            <p className={styles.hint}>
              명함 사진을 올리면 글자를 읽어 회사와 사람을 함께 만듭니다.
              한 번에 {CARD_MAX_COUNT}장까지 올릴 수 있어요.
              읽은 글자는 등록 전에 고칠 수 있습니다.
            </p>
            <div className={styles.tools}>
              <NbButton variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> {busy ? progress('읽는 중') : '명함 사진 고르기'}
              </NbButton>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={CARD_MIME_OK.join(',')}
                className={`input-field ${styles.hiddenFile}`}
                onChange={(e) => { const f = e.target.files; if (f?.length) void readCards(f) }}
              />
            </div>

            {failed.length > 0 && (
              <p className={styles.failed}>
                {failed.map((f) => `${f.fileName}: ${f.reason}`).join(' · ')}
              </p>
            )}

            {cards.length > 0 && (
              <ul className={styles.cardList}>
                {cards.map((c, i) => (
                  <li key={`${c.fileName}-${i}`} className={styles.cardItem}>
                    <div className={styles.cardHead}>
                      <span className={styles.cardName}>{c.fileName}</span>
                      <button
                        type="button" className={styles.remove}
                        onClick={() => setCards((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`${c.fileName} 빼기`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {/* 읽은 글자를 **고칠 수 있게** 둔다 — 흐린 사진은 사람이 손보는 게 빠르다 */}
                    <textarea
                      className="input-field"
                      rows={4}
                      value={c.text}
                      onChange={(e) => setCards((prev) => prev.map((x, j) => (
                        j === i ? { ...x, text: e.target.value } : x
                      )))}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === 'paste' && (
          <div className={styles.pane}>
            <p className={styles.hint}>
              메일 하단 서명이나 명함 글자를 그대로 붙여넣으세요.
              회사와 사람을 만들어 드립니다. 여러 사람이면 나눠서 넣어 주세요.
            </p>
            <textarea
              className="input-field"
              rows={8}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'예)\n㈜데이터얼라이언스\n김도현 본부장\nmichaelkim@data-alliance.com / 02-1234-5678'}
              autoFocus
            />
          </div>
        )}

        {mode === 'excel' && (
          <div className={styles.pane}>
            <p className={styles.hint}>
              회사·인물 목록을 CSV 로 한 번에 올립니다.
              무엇이 만들어지고 무엇이 이미 있는지 미리 보고 나서 반영해요.
            </p>
            {/*
              엑셀 가져오기는 설정 화면의 부품이 이미 한다 — 여기서 다시 만들지 않는다.
              그 화면으로 보내는 것이 «같은 처리를 두 벌로 만들지 않는다»는 규칙에 맞다.
            */}
            <NbButton href="/crm/settings#import">
              <FileSpreadsheet size={14} /> 가져오기 화면 열기
            </NbButton>
          </div>
        )}
      </div>
    </NbModal>
  )
}
