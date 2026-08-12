'use client'

// app/(ci)/ci/studio/StudioView.tsx — 편집점 스튜디오
//
// 흐름: 영상 고르기 → (브라우저에서) 분석 → 잘 된 방식과 겹쳐 편집점 → 편집툴로 내보내기
// 영상 파일은 **업로드하지 않는다.** 분석은 이 브라우저에서 끝나고 서버로는 숫자만 간다.

import { useRef, useState } from 'react'
import { Scissors, Download, Copy, Film } from 'lucide-react'
import type { ApiResponse } from '@/lib/ci/contracts'
import {
  toTimecode, toEditSheet, toMarkerCsv,
  type EditPoint, type SuccessEvidence, type VideoSignals,
} from '@/lib/ci/production/edit-points'
import { analyzeVideoFile, MAX_ANALYZE_SEC, type AnalyzeProgress } from '@/lib/ci/production/video-analyze'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'

const KIND_LABEL: Record<EditPoint['kind'], string> = {
  hook: '훅', trim: '잘라내기', cut: '컷', emphasis: '강조', length: '길이',
}
const KIND_CLASS: Record<EditPoint['kind'], string> = {
  hook: 'ci-status-ok', trim: 'ci-status-danger', cut: 'ci-status-info',
  emphasis: 'ci-status-warn', length: 'ci-status-neutral',
}

export default function StudioView({ workspaceId }: { workspaceId: string }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [signals, setSignals] = useState<VideoSignals | null>(null)
  const [points, setPoints] = useState<EditPoint[] | null>(null)
  const [evidence, setEvidence] = useState<SuccessEvidence | null>(null)
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onPick(file: File) {
    setError(null); setPoints(null); setSignals(null); setEvidence(null)
    setFileName(file.name)
    setVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })

    try {
      const s = await analyzeVideoFile(file, setProgress)
      setSignals(s)

      const res = await fetch('/api/ci/production/edit-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify(s),
      }).then((r) => r.json() as Promise<ApiResponse<{ points: EditPoint[]; evidence: SuccessEvidence }>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setPoints(res.data.points)
      setEvidence(res.data.evidence)
    } catch (e) {
      setError({
        code: 'INTERNAL',
        message: e instanceof Error ? e.message : '영상을 분석하지 못했습니다',
      })
    } finally {
      setProgress(null)
    }
  }

  function seek(sec: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = sec
    void v.play().catch(() => { /* 자동재생 차단은 무시 — 위치만 맞추면 된다 */ })
  }

  async function copySheet() {
    if (!points) return
    await navigator.clipboard.writeText(toEditSheet(points, `편집 지시서 — ${fileName ?? ''}`))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function downloadCsv() {
    if (!points) return
    const blob = new Blob([toMarkerCsv(points)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(fileName ?? 'edit').replace(/\.[^.]+$/, '')}_markers.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const busy = progress !== null

  return (
    <>
      <section className="ci-asset-intake">
        <div className="ci-asset-intake-row">
          <div style={{ flex: 1, minWidth: '260px' }}>
            <label className="label" htmlFor="s-file">편집할 영상 고르기</label>
            <input className="input-field" id="s-file" type="file" accept="video/*" ref={inputRef}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f) }}
              disabled={busy}
            />
          </div>
          <span className="ci-basis">
            <Film size={12} /> 영상은 올리지 않습니다 — 이 브라우저에서 분석하고 결과만 전송합니다
          </span>
        </div>

        {busy && (
          <p className="ci-basis" role="status">
            {progress?.phase === 'video' ? '화면을 훑는 중' : progress?.phase === 'audio' ? '소리를 살피는 중' : '마무리 중'}
            {' · '}{Math.round((progress?.ratio ?? 0) * 100)}%
          </p>
        )}
      </section>

      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} helpHref="/ci/settings" /></div>}

      {!fileName && !error && (
        <EmptyState
          title="영상을 고르면 편집점을 찍어 드립니다"
          description="잘 된 콘텐츠에서 뽑아낸 방식을 내 영상에 겹쳐, 어디를 자르고 어디서 시작할지 타임코드로 알려드려요. 분석은 이 브라우저에서만 이뤄집니다."
        />
      )}

      {videoUrl && (
        <div className="ci-studio">
          <div className="ci-studio-player">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} src={videoUrl} controls className="ci-studio-video" />

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
                  <dt className="ci-basis">강조 지점</dt>
                  <dd className="ci-metric-big">
                    {signals.audioAnalyzed ? `${signals.loudPeaks.length}곳` : '미확보'}
                  </dd>
                </div>
              </dl>
            )}

            {signals && !signals.audioAnalyzed && (
              <p className="ci-status ci-status-warn" style={{ marginTop: 'var(--space-2)', display: 'inline-flex' }}>
                소리를 분석하지 못했습니다 — 무음·강조 기반 제안은 빠집니다
              </p>
            )}
            {signals && signals.durationSec > MAX_ANALYZE_SEC && (
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
              <p className="empty-state-desc">
                제안할 편집점을 찾지 못했습니다. 이미 군더더기가 없거나, 분석이 신호를 얻지 못한 경우입니다.
              </p>
            )}

            {points && points.length > 0 && (
              <ul className="ci-studio-list">
                {[...points].sort((a, b) => a.startSec - b.startSec).map((p, i) => (
                  <li key={`${p.kind}-${p.startSec}-${i}`} className="ci-studio-item">
                    <button type="button" className="ci-studio-time" onClick={() => seek(p.startSec)}
                      title="이 지점으로 이동">
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
            )}
          </div>
        </div>
      )}
    </>
  )
}
