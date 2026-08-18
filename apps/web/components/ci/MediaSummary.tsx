'use client'

// components/ci/MediaSummary.tsx — "영상 안에 무엇이 있었나" 표시 (전 화면 공용)
//
// CreativeSummary("무엇이 통했나")와 나란히 서는 부품이다. 둘의 차이는 **출처**다.
//   CreativeSummary  썸네일 한 장과 제목에서 본 것
//   MediaSummary     영상을 통째로 읽어서 본 것 — 대사·화면 자막·구간 전개·연출
//
// 숏폼에서는 플랫폼이 설명을 주지 않아(실측 423건 중 227건) 이쪽이 사실상 유일한 본문이다.

import type { CiMediaInfo } from '@/lib/ci/contracts'
import EmptyState from '@/components/ui/EmptyState'
import styles from './media-summary.module.css'

interface Props {
  media: CiMediaInfo | null | undefined
  variant?: 'compact' | 'full'
}

/** 영상을 통째로 본 것과 커버만 본 것은 신뢰도가 다르다 — 배지 색으로 구분한다. */
function accessTone(access: CiMediaInfo['access']): string {
  return access === 'remote_video' ? 'ci-status-success' : 'ci-status-neutral'
}

export default function MediaSummary({ media, variant = 'full' }: Props) {
  if (!media) return null

  if (variant === 'compact') {
    const line = media.topicGuess ?? media.hookMessage ?? media.transcript
    if (!line) return null
    return (
      <p className="ci-creative-thumbtext" title={line}>
        영상 “{line.slice(0, 60)}”
      </p>
    )
  }

  // 읽기는 했는데 아무것도 못 건졌을 때. 빈 카드를 그리면 고장으로 읽힌다.
  const empty =
    !media.transcript && media.onScreenText.length === 0 && media.beats.length === 0 &&
    !media.topicGuess && !media.whyItWorks && !media.productionText && !media.setting

  return (
    <section className={styles.stack}>
      <div className={styles.head}>
        <h4 className="ci-creative-head">영상 안에 무엇이 있었나</h4>
        <span className={`ci-status ${accessTone(media.access)}`}>{media.accessLabel}</span>
      </div>

      {empty ? (
        <EmptyState
          title={media.note ?? '영상에서 읽어낸 것이 없습니다'}
          description={media.access === 'none'
            // 못 읽은 것이 아니라 안 읽기로 한 것. 기다리면 된다고 오해하지 않게 분명히 말한다.
            ? '이 게시물은 영상 읽기 대상이 아닙니다.'
            : '비공개이거나 삭제된 영상일 수 있습니다.'}
        />
      ) : (
        <>
          {media.replicableFormula && (
            <p className={styles.formula}>따라 만든다면 — {media.replicableFormula}</p>
          )}

          <dl className="ci-creative-grid">
            {media.topicGuess && (
              <div className="ci-creative-row">
                <dt className="ci-basis">영상이 말하는 주제</dt>
                <dd>
                  <span className="ci-status ci-status-info">{media.topicGuess}</span>
                  {media.topicEvidence && (
                    <p className="ci-basis" style={{ marginTop: 'var(--space-1)' }}>
                      근거 — {media.topicEvidence}
                    </p>
                  )}
                </dd>
              </div>
            )}
            {media.hookMessage && (
              <div className="ci-creative-row">
                <dt className="ci-basis">첫 3초</dt>
                <dd>
                  <span className="ci-creative-quote">“{media.hookMessage}”</span>
                  {media.hookDevice && (
                    <span className="ci-status ci-status-neutral" style={{ marginLeft: 'var(--space-2)' }}>
                      {media.hookDevice}
                    </span>
                  )}
                </dd>
              </div>
            )}
            {media.setting && (
              <div className="ci-creative-row">
                <dt className="ci-basis">장소·상황</dt>
                <dd>{media.setting}</dd>
              </div>
            )}
            {media.productionText && (
              <div className="ci-creative-row">
                <dt className="ci-basis">연출</dt>
                <dd>{media.productionText}</dd>
              </div>
            )}
            {media.ending && (
              <div className="ci-creative-row">
                <dt className="ci-basis">엔딩</dt>
                <dd>{media.ending}</dd>
              </div>
            )}
            {media.whyItWorks && (
              <div className="ci-creative-row">
                <dt className="ci-basis">통한 이유</dt>
                <dd>{media.whyItWorks}</dd>
              </div>
            )}
          </dl>

          {media.beats.length > 0 && (
            <div className={styles.section}>
              <h4 className="ci-creative-head">구간별 전개</h4>
              <ol className={styles.beats}>
                {media.beats.map((b, i) => (
                  <li key={`${b.t}-${i}`} className={styles.beat}>
                    <span className={styles.beatTime}>{b.t}초</span>
                    <span className={styles.beatWhat}>{b.what}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {media.onScreenText.length > 0 && (
            <div className={styles.section}>
              <h4 className="ci-creative-head">화면 자막 {media.onScreenText.length}줄</h4>
              <ol className={styles.captions}>
                {media.onScreenText.map((t, i) => (
                  <li key={`${i}-${t}`} className={styles.caption}>
                    <span className={styles.captionIndex}>{i + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {media.transcript && (
            <div className={styles.section}>
              <h4 className="ci-creative-head">대사</h4>
              <p className={styles.transcript}>{media.transcript}</p>
            </div>
          )}
        </>
      )}

      <p className="ci-basis">
        {media.note ? `${media.note} · ` : ''}
        {media.analyzedAtText ?? ''}
      </p>
    </section>
  )
}
