'use client'

// app/(ci)/ci/studio/StudioView.tsx — 편집점 스튜디오
//
// 흐름: 영상 고르기 → 분석 → 잘 된 방식과 겹쳐 편집점 → 편집툴로 내보내기
//
// 영상을 **고르는 방법이 세 가지**다. 예전에는 파일 하나뿐이라,
// 정작 제품이 "100MB 넘는 영상은 드라이브에 올리고 링크로 등록하세요"라고 안내해 놓고
// 그렇게 등록한 영상은 여기서 쓸 수 없었다.
//   ① 자료에서 고르기  — 이미 올려 둔 것. 드라이브 원본은 우리 경로로 읽어 화면·소리 전부 분석된다
//   ② 파일 고르기      — 손에 있는 파일. 브라우저 밖으로 나가지 않는다
//   ③ 링크 붙여넣기    — 플랫폼 영상. 원본 픽셀은 못 읽으니 길이·구성만 낸다(그렇다고 말한다)
//
// 어느 경로든 **못 본 축은 못 봤다고 말한다.** 빈 결과를 제안으로 위장하지 않는다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Scissors, Download, Copy, Film, Link2, FolderOpen, Save } from 'lucide-react'
import type { ApiResponse } from '@/lib/ci/contracts'
import {
  toTimecode, toEditSheet, toMarkerCsv,
  type EditPoint, type SuccessEvidence, type VideoSignals,
} from '@/lib/ci/production/edit-points'
import {
  analyzeVideoFile, analyzeVideoUrl, MAX_ANALYZE_SEC, type AnalyzeProgress,
} from '@/lib/ci/production/video-analyze'
import { analyzeScopeLabel, type AnalyzeSource } from '@/lib/ci/production/analyzable'
import type { CiAssetItem } from '@/lib/ci/queries/assets'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { isEnterKey } from '@/lib/ui/ime'

const KIND_LABEL: Record<EditPoint['kind'], string> = {
  hook: '훅', trim: '잘라내기', cut: '컷', emphasis: '강조', length: '길이', structure: '구성',
}
const KIND_CLASS: Record<EditPoint['kind'], string> = {
  hook: 'ci-status-ok', trim: 'ci-status-danger', cut: 'ci-status-info',
  emphasis: 'ci-status-warn', length: 'ci-status-neutral', structure: 'ci-status-info',
}

type Mode = 'asset' | 'file' | 'link'

interface BriefOption { id: string; label: string; version: number }

interface EditPointsResponse {
  points: EditPoint[]
  evidence: SuccessEvidence
  signals?: VideoSignals
  note?: string | null
}

interface Props {
  workspaceId: string
  /** 자료 화면에서 "편집점"을 눌러 왔을 때 — 그 자료를 바로 고른다 */
  initialAssetId?: string | null
}

export default function StudioView({ workspaceId, initialAssetId = null }: Props) {
  const [mode, setMode] = useState<Mode>('asset')
  const [sourceLabel, setSourceLabel] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [signals, setSignals] = useState<VideoSignals | null>(null)
  const [points, setPoints] = useState<EditPoint[] | null>(null)
  const [evidence, setEvidence] = useState<SuccessEvidence | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const [assets, setAssets] = useState<CiAssetItem[] | null>(null)
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')

  const [briefs, setBriefs] = useState<BriefOption[]>([])
  const [briefId, setBriefId] = useState('')
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 파일 경로에서 만든 objectURL. 다음 분석 전에 반드시 해제한다 */
  const objectUrlRef = useRef<string | null>(null)

  // 자료·기획안은 화면을 열 때 한 번만 읽는다. 고르기용이라 최신 한 장이면 충분하다.
  useEffect(() => {
    const headers = { 'X-CI-Workspace': workspaceId }
    fetch('/api/ci/assets', { headers })
      .then((r) => r.json() as Promise<ApiResponse<CiAssetItem[]>>)
      .then((r) => {
        if (r.success) setAssets(r.data)
        else setAssetsError(r.error.message)
      })
      .catch(() => setAssetsError('자료를 불러오지 못했습니다'))

    fetch('/api/ci/briefs', { headers })
      .then((r) => r.json() as Promise<ApiResponse<BriefOption[]>>)
      .then((r) => { if (r.success) setBriefs(r.data) })
      .catch(() => { /* 저장 대상이 없을 뿐이다 — 분석은 막지 않는다 */ })
  }, [workspaceId])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  // 자료 화면에서 넘어온 경우 그 자료로 바로 시작한다. 한 번만.
  const autoPickedRef = useRef(false)
  useEffect(() => {
    if (autoPickedRef.current || !initialAssetId || !assets) return
    autoPickedRef.current = true
    const found = assets.find((a) => a.id === initialAssetId)
    if (found) void onPickAsset(found)
    else setError({ code: 'NOT_FOUND', message: '그 자료를 찾지 못했습니다' })
    // onPickAsset은 상태 setter와 안정 ref만 쓴다 — 의존성에 넣으면 렌더마다 다시 돈다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, initialAssetId])

  function reset(label: string, preview: string | null) {
    setError(null); setPoints(null); setSignals(null); setEvidence(null)
    setNote(null); setSaveNote(null)
    setSourceLabel(label)
    setVideoUrl(preview)
  }

  /** 편집점 계산은 서버가 한다 — 잘 된 콘텐츠의 근거가 서버에 있다. */
  const requestPoints = useCallback(async (body: unknown): Promise<EditPointsResponse | null> => {
    const res = await fetch('/api/ci/production/edit-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<ApiResponse<EditPointsResponse>>)

    if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return null }
    return res.data
  }, [workspaceId])

  async function runWithSignals(analyze: () => Promise<VideoSignals>) {
    // 시작하자마자 진행 표시를 켠다. 첫 진척 보고는 프레임 10개를 훑은 뒤에야 오는데,
    // 그때까지 화면이 조용하면 사용자는 "골랐는데 아무 일도 안 일어난다"고 읽는다.
    setProgress({ phase: 'video', ratio: 0 })
    try {
      const s = await analyze()
      setSignals(s)
      const data = await requestPoints(s)
      if (!data) return
      setPoints(data.points)
      setEvidence(data.evidence)
    } catch (e) {
      setError({
        code: 'INTERNAL',
        message: e instanceof Error ? e.message : '영상을 분석하지 못했습니다',
      })
    } finally {
      setProgress(null)
    }
  }

  /** ② 파일 — 원본은 브라우저 밖으로 나가지 않는다 */
  async function onPickFile(file: File) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const preview = URL.createObjectURL(file)
    objectUrlRef.current = preview
    reset(file.name, preview)
    await runWithSignals(() => analyzeVideoFile(file, setProgress))
  }

  /** ① 자료 — 경로에 따라 읽는 방법이 갈린다 */
  async function onPickAsset(asset: CiAssetItem) {
    const source: AnalyzeSource = asset.analyze
    if (source.mode === 'none') {
      reset(asset.title, null)
      setError({ code: 'VALIDATION_FAILED', message: source.reason })
      return
    }
    if (source.mode === 'meta') {
      reset(asset.title, null)
      await runFromLink(source.url)
      return
    }
    reset(asset.title, source.url)
    await runWithSignals(() => analyzeVideoUrl(source.url, setProgress))
  }

  /** ③ 링크 — 서버가 겉정보를 확보한다(플랫폼 영상은 원본을 못 읽는다) */
  async function runFromLink(url: string) {
    setProgress({ phase: 'video', ratio: 0 })
    try {
      const data = await requestPoints({ linkUrl: url })
      if (!data) return
      setPoints(data.points)
      setEvidence(data.evidence)
      setSignals(data.signals ?? null)
      setNote(data.note ?? null)
    } finally {
      setProgress(null)
    }
  }

  async function onSubmitLink(raw?: string) {
    const url = (raw ?? linkUrl).trim()
    if (!url) return
    reset(url, null)
    await runFromLink(url)
  }

  function seek(sec: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = sec
    void v.play().catch(() => { /* 자동재생 차단은 무시 — 위치만 맞추면 된다 */ })
  }

  async function copySheet() {
    if (!points) return
    await navigator.clipboard.writeText(toEditSheet(points, `편집 지시서 — ${sourceLabel ?? ''}`))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function downloadCsv() {
    if (!points) return
    const blob = new Blob([toMarkerCsv(points)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(sourceLabel ?? 'edit').replace(/\.[^.]+$/, '')}_markers.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * 기획안의 편집안으로 저장한다.
   * 왜 새 테이블을 만들지 않는가: 편집안(ci_edit_plans)이 이미 있고 기획안 화면이 그걸 쓴다.
   * 여기서 따로 저장하면 자동 편집점과 수기 편집안이 서로 모르는 두 계통이 된다.
   */
  async function saveAsPlan() {
    if (!points || !briefId) return
    setSaving(true); setSaveNote(null); setError(null)
    try {
      const res = await fetch('/api/ci/edit-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({
          briefId,
          variantLabel: `편집점 — ${sourceLabel ?? '분석'}`.slice(0, 60),
          timecodes: [...points].sort((a, b) => a.startSec - b.startSec).map((p) => ({
            start: toTimecode(p.startSec),
            end: p.endSec != null ? toTimecode(p.endSec) : undefined,
            note: `${KIND_LABEL[p.kind]} · ${p.action}`.slice(0, 500),
          })),
        }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setSaveNote('기획안의 편집안으로 저장했습니다')
    } finally { setSaving(false) }
  }

  const busy = progress !== null
  const analyzableAssets = (assets ?? []).filter((a) => a.analyze.mode !== 'none')

  return (
    <>
      <section className="ci-asset-intake">
        <SegmentedTabs
          ariaLabel="영상 고르는 방법"
          variant="segment"
          activeId={mode}
          onSelect={(id) => setMode(id as Mode)}
          tabs={[
            { id: 'asset', label: '자료에서 고르기', icon: <FolderOpen size={14} /> },
            { id: 'file', label: '파일 고르기', icon: <Film size={14} /> },
            { id: 'link', label: '링크 붙여넣기', icon: <Link2 size={14} /> },
          ]}
        />

        {mode === 'asset' && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            {assetsError && <ErrorState code="INTERNAL" message={assetsError} helpHref="/ci/assets" helpLabel="자료로 가기" />}

            {!assetsError && analyzableAssets.length === 0 && (
              <EmptyState
                title="분석할 수 있는 영상이 아직 없어요"
                description="자료 화면에서 드라이브 링크를 붙여넣거나 영상을 올리면 여기서 바로 편집점을 낼 수 있습니다."
                action={{ label: '자료로 가기', href: '/ci/assets' }}
              />
            )}

            {!assetsError && analyzableAssets.length > 0 && (
              <>
                <label className="label" htmlFor="s-asset">올려 둔 영상</label>
                <select className="input-field" id="s-asset" disabled={busy} defaultValue=""
                  onChange={(e) => {
                    const found = analyzableAssets.find((a) => a.id === e.target.value)
                    if (found) void onPickAsset(found)
                  }}
                >
                  <option value="" disabled>영상을 고르세요</option>
                  {analyzableAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} · {analyzeScopeLabel(a.analyze)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        {mode === 'file' && (
          <div className="ci-asset-intake-row" style={{ marginTop: 'var(--space-3)' }}>
            <div style={{ flex: 1, minWidth: '260px' }}>
              <label className="label" htmlFor="s-file">편집할 영상 고르기</label>
              <input className="input-field" id="s-file" type="file" accept="video/*" ref={inputRef}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f) }}
                disabled={busy}
              />
            </div>
            <span className="ci-basis">
              <Film size={12} /> 영상은 올리지 않습니다 — 이 브라우저에서 분석하고 결과만 전송합니다
            </span>
          </div>
        )}

        {mode === 'link' && (
          <div className="ci-asset-intake-row" style={{ marginTop: 'var(--space-3)' }}>
            <div style={{ flex: 1, minWidth: '260px' }}>
              <label className="label" htmlFor="s-link">영상 주소</label>
              <input className="input-field" id="s-link" type="url" value={linkUrl}
                placeholder="유튜브 주소 또는 드라이브 파일 주소"
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (isEnterKey(e)) void onSubmitLink((e.target as HTMLInputElement).value) }}
                disabled={busy}
              />
            </div>
            <button type="button" className="btn-primary" disabled={busy || !linkUrl.trim()}
              onClick={() => void onSubmitLink()}>
              <Link2 size={16} /> 분석
            </button>
          </div>
        )}

        {busy && (
          <p className="ci-basis" role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <AXDotLoader />
            {progress?.phase === 'video' ? '화면을 훑는 중' : progress?.phase === 'audio' ? '소리를 살피는 중' : '마무리 중'}
            {' · '}{Math.round((progress?.ratio ?? 0) * 100)}%
          </p>
        )}
      </section>

      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} helpHref="/ci/settings" /></div>}

      {!sourceLabel && !error && (
        <EmptyState
          title="영상을 고르면 편집점을 찍어 드립니다"
          description="잘 된 콘텐츠에서 뽑아낸 방식을 내 영상에 겹쳐, 어디를 자르고 어디서 시작할지 타임코드로 알려드려요. 올려 둔 자료·파일·링크 어느 쪽이든 됩니다."
        />
      )}

      {(videoUrl || signals) && (
        <div className="ci-studio">
          <div className="ci-studio-player">
            {videoUrl && (
              /* eslint-disable-next-line jsx-a11y/media-has-caption */
              <video ref={videoRef} src={videoUrl} controls className="ci-studio-video" />
            )}

            {signals && (
              <dl className="ci-meta-grid" style={{ marginTop: 'var(--space-3)' }}>
                <div className="ci-meta-cell">
                  <dt className="ci-basis">길이</dt>
                  <dd className="ci-metric-big">{toTimecode(signals.durationSec)}</dd>
                </div>
                <div className="ci-meta-cell">
                  <dt className="ci-basis">장면 전환</dt>
                  <dd className="ci-metric-big">
                    {signals.framesSampled > 0 ? `${signals.sceneChanges.length}회` : '미확보'}
                  </dd>
                </div>
                <div className="ci-meta-cell">
                  <dt className="ci-basis">무음 구간</dt>
                  <dd className="ci-metric-big">
                    {signals.audioAnalyzed ? `${signals.silences.length}곳` : '미확보'}
                  </dd>
                </div>
                <div className="ci-meta-cell">
                  <dt className="ci-basis">작성자 구간</dt>
                  <dd className="ci-metric-big">
                    {signals.chapters?.length ? `${signals.chapters.length}개` : '없음'}
                  </dd>
                </div>
              </dl>
            )}

            {/* 못 본 축은 반드시 말한다 — 빈 결과를 "문제 없음"으로 읽히게 두지 않는다 */}
            {signals?.frameSkipReason && (
              <p className="ci-status ci-status-warn" style={{ marginTop: 'var(--space-2)', display: 'inline-flex' }}>
                {signals.frameSkipReason}
              </p>
            )}
            {signals && !signals.audioAnalyzed && (
              <p className="ci-status ci-status-warn" style={{ marginTop: 'var(--space-2)', display: 'inline-flex' }}>
                {signals.audioSkipReason ?? '소리를 분석하지 못했습니다 — 무음·강조 기반 제안은 빠집니다'}
              </p>
            )}
            {note && (
              <p className="ci-basis" style={{ marginTop: 'var(--space-2)' }}>{note}</p>
            )}
            {signals && signals.durationSec > MAX_ANALYZE_SEC && signals.framesSampled > 0 && (
              <p className="ci-basis" style={{ marginTop: 'var(--space-2)' }}>
                앞 {Math.round(MAX_ANALYZE_SEC / 60)}분까지만 훑었습니다
              </p>
            )}
          </div>

          <div className="ci-studio-points">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, margin: 0 }}>편집점</h2>
              {points && <span className="ci-count">{points.length}</span>}
              {points && points.length > 0 && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
                  <button type="button" className="btn-ghost" onClick={copySheet}>
                    <Copy size={14} /> {copied ? '복사됨' : '지시서 복사'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={downloadCsv}>
                    <Download size={14} /> 마커 CSV
                  </button>
                </div>
              )}
            </div>

            {evidence && (
              <p className="ci-basis" style={{ marginBottom: 'var(--space-3)' }}>
                {evidence.sampleSize > 0
                  ? `잘 된 콘텐츠 ${evidence.sampleSize}건을 근거로 판단했습니다${evidence.topHookTypes.length ? ` · 많이 통한 후킹: ${evidence.topHookTypes.join('·')}` : ''}`
                  : '아직 잘 된 콘텐츠를 모으지 못해, 영상에서 관측한 신호만으로 제안합니다'}
              </p>
            )}

            {points && points.length === 0 && (
              <EmptyState
                title="제안할 편집점이 없어요"
                description="이미 군더더기가 없거나, 분석이 신호를 얻지 못한 경우예요. 다른 영상으로 다시 해보세요."
                action={{ label: '다른 영상 고르기', onClick: () => inputRef.current?.click() }}
              />
            )}

            {points && points.length > 0 && (
              <>
                <ul className="ci-studio-list">
                  {[...points].sort((a, b) => a.startSec - b.startSec).map((p, i) => (
                    <li key={`${p.kind}-${p.startSec}-${i}`} className="ci-studio-item">
                      <button type="button" className="ci-studio-time" onClick={() => seek(p.startSec)}
                        title={videoUrl ? '이 지점으로 이동' : '재생할 원본이 없습니다'} disabled={!videoUrl}>
                        {toTimecode(p.startSec)}
                        {p.endSec != null && <> ~ {toTimecode(p.endSec)}</>}
                      </button>
                      <div style={{ minWidth: 0 }}>
                        <div className="ci-card-badges" style={{ marginBottom: 'var(--space-1)' }}>
                          <span className={`ci-status ${KIND_CLASS[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
                        </div>
                        <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{p.action}</p>
                        <p className="ci-basis" style={{ marginTop: '2px' }}>{p.reason}</p>
                      </div>
                      <Scissors size={14} aria-hidden style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                    </li>
                  ))}
                </ul>

                {/* 결과를 남긴다 — 예전에는 새로고침하면 사라졌다 */}
                <div className="ci-asset-intake-row" style={{ marginTop: 'var(--space-4)' }}>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <label className="label" htmlFor="s-brief">기획안에 편집안으로 저장</label>
                    <select className="input-field" id="s-brief" value={briefId}
                      onChange={(e) => setBriefId(e.target.value)} disabled={saving || briefs.length === 0}>
                      <option value="">{briefs.length === 0 ? '저장할 기획안이 없습니다' : '기획안을 고르세요'}</option>
                      {briefs.map((b) => (
                        <option key={b.id} value={b.id}>{b.label} (v{b.version})</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="btn-primary" onClick={() => void saveAsPlan()}
                    disabled={saving || !briefId}>
                    <Save size={16} /> 저장
                  </button>
                </div>
                {saveNote && (
                  <p className="ci-status ci-status-ok" style={{ marginTop: 'var(--space-2)', display: 'inline-flex' }}>
                    {saveNote}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
