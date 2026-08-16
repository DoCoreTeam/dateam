import { z } from 'zod'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { getSuccessEvidence } from '@/lib/ci/queries/success-evidence'
import { buildEditPoints, type VideoSignals } from '@/lib/ci/production/edit-points'
import { parseChapters } from '@/lib/ci/production/chapters'
import { parseContentUrl } from '@/lib/ci/ucm/url'
import { fetchWatchMetrics } from '@/lib/ci/connectors/youtube-page'
import { checkUrlIsPublic } from '@/lib/ci/net/ssrf'

/**
 * 브라우저가 뽑은 신호 + 우리가 모은 근거 → 편집점.
 *
 * 영상 자체는 받지 않는다. 숫자만 온다 — 원본은 사용자 기기를 벗어나지 않는다.
 *
 * 입력은 두 갈래다.
 *  ① 신호(signals): 브라우저가 원본을 직접 읽을 수 있을 때. 화면·소리 전부 나온다.
 *  ② 링크(linkUrl): 플랫폼 영상이라 원본을 못 읽을 때. 서버가 **겉정보만** 확보해
 *     길이·구성(작성자가 찍은 챕터) 기준으로 할 수 있는 만큼만 낸다.
 *     없는 신호를 지어내지 않으므로 ②의 결과는 ①보다 적다 — 그게 정직한 상태다.
 */
const SignalsBody = z.object({
  durationSec: z.number().positive().max(24 * 3600),
  framesSampled: z.number().int().nonnegative().default(0),
  audioAnalyzed: z.boolean().default(false),
  sceneChanges: z.array(z.object({
    atSec: z.number().nonnegative(), score: z.number(),
  })).max(2000).default([]),
  silences: z.array(z.object({
    startSec: z.number().nonnegative(), endSec: z.number().nonnegative(),
  })).max(2000).default([]),
  loudPeaks: z.array(z.object({
    atSec: z.number().nonnegative(), level: z.number(),
  })).max(2000).default([]),
})

const LinkBody = z.object({
  linkUrl: z.string().trim().min(1).max(2000),
})

/** 플랫폼 링크에서 확보할 수 있는 만큼의 신호. 못 얻은 축은 **비운다.** */
async function signalsFromLink(url: string): Promise<
  { ok: true; signals: VideoSignals; note: string | null } | { ok: false; message: string }
> {
  const verdict = await checkUrlIsPublic(url)
  if (!verdict.ok) return { ok: false, message: verdict.reason ?? '주소를 열 수 없습니다' }

  const parsed = parseContentUrl(url)
  if (parsed?.platform !== 'youtube' || !parsed.externalId) {
    return {
      ok: false,
      message: '지금은 유튜브 링크만 겉정보로 분석할 수 있습니다. 원본 파일이나 드라이브 링크를 쓰면 화면·소리까지 분석됩니다',
    }
  }

  const metrics = await fetchWatchMetrics(parsed.externalId)
  if (!metrics || !metrics.durationSec) {
    return { ok: false, message: '영상 정보를 읽지 못했습니다. 잠시 후 다시 시도해 주세요' }
  }

  const chapters = parseChapters(metrics.description)
  return {
    ok: true,
    signals: {
      durationSec: metrics.durationSec,
      // 원본을 못 읽었으므로 관측 신호는 전부 비어 있다. 0이 아니라 "못 봤다"는 뜻이다.
      sceneChanges: [], silences: [], loudPeaks: [],
      framesSampled: 0,
      audioAnalyzed: false,
      audioSkipReason: '플랫폼 영상은 원본 소리를 읽을 수 없습니다',
      frameSkipReason: '플랫폼 영상은 원본 화면을 읽을 수 없습니다',
      chapters,
    },
    note: chapters.length > 0
      ? `설명문에서 구간 ${chapters.length}개를 읽었습니다`
      : '설명문에 구간 표시가 없어 길이만으로 판단했습니다',
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const raw = await req.json()

    // 링크 경로 — 서버가 겉정보를 확보한다
    const asLink = LinkBody.safeParse(raw)
    if (asLink.success) {
      const built = await signalsFromLink(asLink.data.linkUrl)
      if (!built.ok) return fail('VALIDATION_FAILED', built.message)
      const evidence = await getSuccessEvidence(session.workspaceId)
      return ok({
        points: buildEditPoints(built.signals, evidence),
        evidence,
        signals: built.signals,
        note: built.note,
      })
    }

    const parsed = SignalsBody.safeParse(raw)
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', '분석 신호를 확인해 주세요', parsed.error.issues)
    }

    const evidence = await getSuccessEvidence(session.workspaceId)
    const points = buildEditPoints(parsed.data, evidence)

    return ok({ points, evidence })
  } catch (e) {
    return failUnexpected(e)
  }
}
