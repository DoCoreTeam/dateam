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

import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, ClipboardPaste, FileSpreadsheet, Image as ImageIcon, PenLine, RotateCcw, X } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { ACTION, ENTITY, progress } from '@/lib/terms'
import { eulReul, eunNeun } from '@/lib/ui/josa'
import { CARD_MAX_COUNT, CARD_MIME_OK } from '@/lib/crm/services/card-read'
import styles from './intake-modal.module.css'

/**
 * 「회사 «(주)가비아» · 인물 «Tony 박현덕»」 처럼 **종류와 이름으로** 말한다.
 *
 * 종류 이름은 용어집에서 가져온다(§0-2) — 화면이 「담당자」·「거래처」로 부르기 시작하면
 * 같은 것을 화면마다 다르게 부르게 된다.
 */
function describe(rows: readonly TouchedRecord[]): string {
  return rows.map((r) => `${ENTITY[r.type].label} 「${r.name}」`).join(' · ')
}

/**
 * 마지막 이름에 맞춰 조사를 고른다.
 *
 * **화면이 「은(는)」을 손으로 적지 않는다**(§0-2). 이름은 사용자 데이터라
 * 받침이 매번 다르고, 하드코딩하면 「(주)가비아은」처럼 틀린 말이 나온다 —
 * 실제로 이 화면이 「삼성SDS은」이라고 말했다.
 * 조사가 붙는 기준은 **줄의 마지막 낱말**이므로 닫는 낫표를 떼고 판정한다.
 */
function withTail(text: string, josa: (w: string) => string): string {
  const last = text.replace(/」$/, '').split('「').pop() ?? text
  return `${text}${josa(last)}`
}

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

/** 서버가 돌려주는 «만들었거나 이어 붙은» 레코드 하나 */
interface TouchedRecord {
  type: 'company' | 'person' | 'deal'
  id: string
  name: string
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
  /**
   * 지금 무엇을 하고 있는지 — «하고 있다/아니다»로만 두면 화면이 거짓말을 한다.
   * 이미지를 읽는 중인데 버튼이 「등록 중…」이라고 말했다(사용자 지적).
   */
  const [step, setStep] = useState<{ what: 'reading' | 'saving'; at: number; of: number } | null>(null)
  const busy = step !== null

  /** 명함에서 읽은 글자 — 사람이 확인하고 고칠 수 있다 */
  const [cards, setCards] = useState<CardItem[]>([])
  const [failed, setFailed] = useState<{ fileName: string; reason: string }[]>([])
  const [paste, setPaste] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  /**
   * 등록 결과 — **개수가 아니라 «무엇을»** 담는다.
   *
   * 처음엔 `{created: number}` 만 담아 「2건을 등록했어요」라고 말했는데,
   * 같은 자리의 숫자가 상황마다 다른 뜻이었다 — 회사가 이미 있으면 1건(인물만),
   * 없으면 2건(회사+인물)이라 **읽는 사람은 2가 무엇인지 알 수 없었다**
   * (사용자 지적: 「이거 한건 서명 붙여 넣은건데 2건을 등록했다는데 이게 무슨말인지?」
   *  「회사와 인물을 등록했나 이렇게 친절하게 나와야지」).
   *
   * `linked` 를 따로 담는 이유도 같다. 이미 있는 회사에 이어 붙은 것은 **등록이 아니다** —
   * 그걸 안 보여 주면 사용자는 중복이 생겼는지 확인하러 목록을 뒤져야 한다.
   */
  const [dragging, setDragging] = useState(false)
  /** 서명에 곁들여 온 이미지 — 등록할 때 글자로 바꾼다 */
  const [images, setImages] = useState<{ url: string; file: File | null }[]>([])
  const [done, setDone] = useState<{
    created: TouchedRecord[]
    linked: TouchedRecord[]
    skipped: number
  } | null>(null)

  /** 명함 읽기 — 레코드는 아직 안 만든다. 글자를 보여 주고 사람이 확인한 뒤에 만든다 */
  /**
   * 이미지 여러 장을 글자로 바꾼다 — 명함 탭과 서명 탭이 **같은 길**을 쓴다.
   * 실패한 장은 `failed` 로 돌아오므로 나머지를 잃지 않는다.
   */
  const imagesToText = useCallback(async (files: readonly File[]): Promise<CardItem[]> => {
    const form = new FormData()
    for (const f of files.slice(0, CARD_MAX_COUNT)) form.append('files', f)
    const res = await fetch('/api/crm/cards/read', { method: 'POST', body: form })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? '이미지를 읽지 못했습니다.')
    setFailed(body.failed ?? [])
    return (body.items ?? []) as CardItem[]
  }, [])

  /**
   * **서명에 섞여 온 이미지를 «담아 둔다».** 읽는 것은 「등록」을 누를 때다.
   *
   * 처음엔 붙여넣는 즉시 읽었는데, 그게 두 가지를 망가뜨렸다.
   *   ① 글자만 복사해도 클립보드에 이미지가 함께 실려 오는 일이 흔하다
   *      → 사용자는 글자만 넣었는데 화면이 20초 넘게 「등록 중…」에 멈춰 있었다.
   *   ② 붙여넣기는 «입력»이지 «실행»이 아니다. 실행은 버튼이 한다.
   * (사용자 지적: 「일단 내용 붙여넣고 등록 눌렀을때 동작해야 하는거야
   *  내용만 컨트롤 브이로 넣었는데 이러면 어떻게해」)
   *
   * 글자 붙여넣기는 막지 않는다(preventDefault 없음) — 이미지는 곁들여 온 것이다.
   */
  const onPasteSignature = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData
    if (!cd) return

    // ① 캡처·파일 — 클립보드에 이미지 «파일»이 실려 오는 경우
    const files = Array.from(cd.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null)

    /*
      ② 메일 서명 — **이쪽이 실제로 더 흔하다.**
      Gmail·Outlook 에서 서명을 긁어 복사하면 클립보드에 들어오는 것은
      `text/html` 과 `text/plain` 둘뿐이고 **이미지 파일 항목은 없다**.
      로고는 HTML 안의 `<img src="https://…">` 로만 존재한다.
      그래서 ① 만 보던 동안 사용자 화면에는 아무 이미지도 안 나왔다
      (사용자 지적: 「이미지가 안나와」).
    */
    const html = cd.getData('text/html')
    const remote: { url: string }[] = []
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      for (const img of Array.from(doc.querySelectorAll('img'))) {
        const src = img.getAttribute('src') ?? ''
        // cid: 는 메일 클라이언트 안에서만 뜻이 있다 — 웹에서는 가져올 방법이 없다
        if (!/^(https?:|data:image\/)/i.test(src)) continue
        remote.push({ url: src })
      }
    }

    if (files.length === 0 && remote.length === 0) return
    setImages((prev) => [
      ...prev,
      ...files.map((f) => ({ url: URL.createObjectURL(f), file: f as File | null })),
      ...remote.map((r) => ({ url: r.url, file: null })),
    ].slice(0, CARD_MAX_COUNT))
  }, [])

  /**
   * 미리보기 주소를 **읽을 수 있는 파일**로 바꾼다.
   *
   * 서명 안의 로고는 남의 서버에 있다. 브라우저가 가져올 수 있으면 가져오고,
   * 막히면(CORS) **그 한 장만 건너뛴다** — 나머지 글자는 그대로 등록된다.
   * 서버로 대신 가져오게 하지 않는 이유: 사용자가 붙여넣은 임의의 주소를 서버가
   * 요청하면 사내망을 향한 요청이 되어(SSRF) 위험하다.
   */
  const toFile = useCallback(async (im: { url: string; file: File | null }): Promise<File | null> => {
    if (im.file) return im.file
    try {
      const res = await fetch(im.url, { mode: 'cors' })
      if (!res.ok) return null
      const blob = await res.blob()
      if (!blob.type.startsWith('image/')) return null
      return new File([blob], 'signature-image', { type: blob.type })
    } catch {
      return null
    }
  }, [])

  const readCards = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return
    setStep({ what: 'reading', at: 0, of: files.length })
    setError(null)
    setFailed([])
    try {
      const items = await imagesToText(files)
      setCards((prev) => [...prev, ...items])
    } catch (err) {
      setError(err instanceof Error ? err.message : '명함을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setStep(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [imagesToText])

  /**
   * 등록 — 명함이든 붙여넣기든 **같은 경로**로 간다.
   * 명함 여러 장은 한 장씩 보낸다: 한 번에 보내면 모델이 사람을 섞는다.
   */
  const register = useCallback(async () => {
    setError(null)
    let body = paste.trim()

    // ① 곁들여 온 이미지를 **여기서** 글자로 바꾼다 — 붙여넣는 순간이 아니라 누른 순간이다
    if (mode === 'paste' && images.length > 0) {
      setStep({ what: 'reading', at: 0, of: images.length })
      try {
        const files = (await Promise.all(images.map(toFile))).filter((f): f is File => f !== null)
        const unreachable = images.length - files.length
        if (files.length > 0) {
          const items = await imagesToText(files)
          const extra = items.map((i) => i.text.trim()).filter(Boolean).join('\n')
          if (extra) body = body ? `${body}\n${extra}` : extra
        }
        // 못 가져온 이미지는 **말한다**. 조용히 빠지면 왜 회사명이 없는지 알 수 없다
        if (unreachable > 0) {
          setFailed((prev) => [...prev, {
            fileName: `이미지 ${unreachable}장`,
            reason: '보낸 사람 서버에서 가져올 수 없어 건너뛰었어요. 캡처해서 붙여넣으면 읽을 수 있어요.',
          }])
        }
      } catch (err) {
        setStep(null)
        setError(err instanceof Error ? err.message : '이미지를 읽지 못했습니다.')
        return
      }
    }

    const texts = mode === 'card' ? cards.map((c) => c.text) : [body]
    const usable = texts.filter(Boolean)
    if (usable.length === 0) {
      setStep(null)
      setError(mode === 'card' ? '읽은 명함이 없어요.' : '붙여넣을 내용을 입력해 주세요.')
      return
    }

    const created: TouchedRecord[] = []
    const linked: TouchedRecord[] = []
    let skipped = 0
    try {
      for (let i = 0; i < usable.length; i += 1) {
        // 몇 번째를 하고 있는지 보여 준다 — 열 장이면 «멈춘 것»과 구분이 안 된다
        setStep({ what: 'saving', at: i + 1, of: usable.length })
        const res = await fetch('/api/crm/quick-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: usable[i], createDeal: false }),
        })
        const json = await res.json()
        // **한 건이 실패해도 나머지를 계속한다** — 명함 열 장 중 하나 때문에 전부 잃지 않는다
        if (!res.ok) { skipped += 1; continue }
        created.push(...((json.created ?? []) as TouchedRecord[]))
        linked.push(...((json.linked ?? []) as TouchedRecord[]))
      }
      setDone({ created, linked, skipped })
      onDone()
    } catch {
      setError('등록하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setStep(null)
    }
  }, [cards, images, imagesToText, mode, onDone, paste, toFile])

  /**
   * **캡처한 이미지를 그대로 받는다.**
   *
   * 명함은 파일로만 오지 않는다 — 화면 캡처(⌘⇧4)·메신저에서 복사한 이미지가 더 흔한데
   * 그것들은 «파일 고르기»로는 넣을 수 없다. 저장했다가 다시 고르는 일을 시키게 된다
   * (사용자 지적: 「캡처나 클립보드에 있는것도 붙여 넣을 수 있어야지」).
   *
   * 문서 전체에 거는 이유: 붙여넣기는 «어디를 눌러 두었나»와 무관하게 손이 먼저 간다.
   * 다만 **명함 탭일 때만** 받는다 — 서명 탭에서 글자를 붙여넣는 것과 부딪히면 안 된다.
   */
  useEffect(() => {
    if (mode !== 'card') return
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const files = items
        .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null)
      if (files.length === 0) return
      e.preventDefault()
      void readCards(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [mode, readCards])

  /** 파일을 끌어다 놓는 것도 같은 길로 보낸다 */
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length > 0) void readCards(files)
  }, [readCards])

  /** 다음 것을 받을 수 있게 비운다 — 무엇을 등록했는지는 지운다(끝난 말이다) */
  const reset = useCallback(() => {
    setDone(null)
    setError(null)
    setCards([])
    setFailed([])
    setPaste('')
    setImages((prev) => { prev.forEach((im) => { if (im.file) URL.revokeObjectURL(im.url) }); return [] })
  }, [])

  return (
    <NbModal
      title={`${noun} 등록`}
      onClose={onClose}
      /*
        **탭을 바꿔도 크기가 그대로다.**
        직접 입력은 짧고 명함은 길어 내용에 맞추면 모달이 위아래로 출렁이고,
        방금 누른 탭이 다른 자리로 옮겨 간다(사용자 지적).

        **높이는 «가장 긴 탭»에 맞춘 실측값이다.** 처음엔 72vh(=653px)를 줬는데
        가장 긴 탭이 449px 이라 200px 이 빈 채로 남았다
        (사용자 지적: 「제일 내용이 많은걸 기준으로 해도 여백이 너무 과해」).
        명함을 여러 장 넣으면 이보다 길어지므로 그때는 본문만 스크롤된다.
      */
      fixedHeight="min(460px, 80vh)"
      maxWidth={640}
      footer={
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>
            {done ? ACTION.close : ACTION.cancel}
          </NbButton>
          {/*
            **끝났으면 다음 장을 받을 준비를 해 준다.**
            명함은 한 장으로 끝나지 않는데 붙여넣은 글자가 그대로 남아 있으면
            사용자가 직접 지워야 다음 것을 넣을 수 있었다
            (사용자 지적: 「등록 완료 되면 초기화 버튼이 있으면 계속 이어서 할 수 있겠네」).
          */}
          {done && mode !== 'excel' && mode !== 'form' && (
            <NbButton onClick={reset} disabled={busy}>
              <RotateCcw size={14} /> 이어서 등록
            </NbButton>
          )}
          {mode !== 'excel' && mode !== 'form' && !done && (
            <NbButton onClick={() => void register()} disabled={busy}>
              {step?.what === 'reading' ? progress('읽는') : step ? progress('등록') : '등록'}
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

        {failed.length > 0 && (
          <p className={styles.failed}>
            {failed.map((f) => `${f.fileName}: ${f.reason}`).join(' · ')}
          </p>
        )}

        {/*
          **오래 걸리면 무엇을 하는 중인지 말한다.** 「등록 중…」 하나로 뭉쳐 두면
          이미지를 읽는 20초 동안 사용자는 멈춘 줄 안다(사용자 지적).
        */}
        {step && (
          <p className={styles.step} role="status">
            <AXDotLoader />
            {step.what === 'reading'
              ? `이미지에서 글자를 읽고 있어요 (${step.of}장) — 20초쯤 걸립니다`
              : `등록하고 있어요 (${step.at}/${step.of})`}
          </p>
        )}

        {done && (
          <div className={styles.done}>
            {done.created.length > 0 && (
              <p>{withTail(describe(done.created), eulReul)} 새로 등록했어요.</p>
            )}
            {done.linked.length > 0 && (
              <p className={styles.doneSub}>
                {withTail(describe(done.linked), eunNeun)} 이미 있어서 이어 붙였어요.
              </p>
            )}
            {done.created.length === 0 && done.linked.length === 0 && (
              <p>등록할 내용을 찾지 못했어요. 회사 이름이나 이메일이 들어가 있는지 확인해 주세요.</p>
            )}
            {done.skipped > 0 && (
              <p className={styles.doneSub}>{done.skipped}건은 읽지 못해 건너뛰었습니다.</p>
            )}
          </div>
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
            {/* 세 가지 길이 한 자리에 있다 — 붙여넣기 · 끌어다 놓기 · 골라서 올리기 */}
            <div
              className={`${styles.dropzone} ${dragging ? styles.dropzoneOver : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <ImageIcon size={20} className={styles.dropIcon} aria-hidden />
              <p className={styles.dropText}>
                캡처한 이미지를 <kbd className={styles.kbd}>⌘V</kbd> 로 붙여넣거나, 파일을 끌어다 놓으세요.
              </p>
              <NbButton variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> {busy ? progress('읽는') : '명함 사진 고르기'}
              </NbButton>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={CARD_MIME_OK.join(',')}
                className={`input-field ${styles.hiddenFile}`}
                onChange={(e) => { const f = e.target.files; if (f?.length) void readCards(Array.from(f)) }}
              />
            </div>

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
              로고·직인 이미지가 함께 붙으면 <b>등록할 때</b> 그 안의 글자까지 읽습니다.
              여러 사람이면 나눠서 넣어 주세요.
            </p>
            <textarea
              className="input-field"
              rows={8}
              value={paste}
              onPaste={onPasteSignature}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'예)\n㈜데이터얼라이언스\n김도현 본부장\nmichaelkim@data-alliance.com / 02-1234-5678'}
              autoFocus
            />
            {/*
              **이미지는 이미지로 보여 준다.** 서명을 붙여넣으면 글자 자리에는
              「이미지」라는 낱말만 남아서, 무엇이 함께 왔는지 알 수 없었다
              (사용자 지적: 「이미지 넣을때 이미지로 보여야 하는데 이미지 이 글자로 나오니 이상하네」).
              읽고 버리는 것이라 어디에도 저장하지 않는다.
            */}
            {images.length > 0 && (
              <div className={styles.thumbs}>
                {images.map((im, i) => (
                  <div className={styles.thumb} key={im.url}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt={`붙여넣은 이미지 ${i + 1}`} />
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`붙여넣은 이미지 ${i + 1} 빼기`}
                      onClick={() => setImages((prev) => {
                        if (prev[i].file) URL.revokeObjectURL(prev[i].url)
                        return prev.filter((_, j) => j !== i)
                      })}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <p className={styles.thumbNote}>
                  등록할 때 이 이미지 속 글자도 함께 읽습니다. 저장되지는 않아요.
                </p>
              </div>
            )}
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
