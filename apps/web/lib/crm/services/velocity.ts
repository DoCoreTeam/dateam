// 어디서 막히나 — 단계별 체류 시간 (dacrm 리포트 v2)
//
// **왜 필요한가**: 리포트 v1 은 "지금 얼마가 걸려 있나"에 답한다.
// 영업이 그 다음에 묻는 것은 **"왜 안 넘어가나"** 다.
// 그 답의 재료(`CrmStageHistory.durationSec`)는 딜을 옮길 때마다 이미 쌓이고 있었는데,
// 읽는 코드가 한 줄도 없었다 — 또 "쌓기만 하고 안 보는" 데이터였다.
//
// **여기서 가장 조심하는 것: 표본이 얇을 때 아는 척하지 않는 것.**
// 딜 3건으로 "평균 12일"을 내면 사람은 그걸 사실로 읽고 프로세스를 바꾼다.
// 그래서 임계 미만이면 숫자를 아예 내지 않고 **"아직 모른다"** 고 말한다.
//
// 그리고 평균이 아니라 **중앙값**을 쓴다. 영업 주기는 한쪽으로 길게 늘어져서
// (몇 년 끌던 딜 하나가 섞이면) 평균은 실제 감각과 멀어진다.

/** 이 수 미만이면 숫자를 내지 않는다 — 우연과 경향을 구분할 수 없다 */
export const MIN_SAMPLE = 5

export interface StageDuration {
  stageId: string
  stageName: string
  position: number
  /** 이 단계를 실제로 거쳐 나간 횟수 */
  samples: number
  /** 중앙값(일). 표본이 얇으면 null — 지어내지 않는다 */
  medianDays: number | null
  /** 가장 오래 걸린 것(일). 이상값을 숨기지 않는다 */
  maxDays: number | null
  /** 지금 이 단계에 서 있는 딜 수 */
  standing: number
  /** 표본이 얇아 판단할 수 없음 */
  insufficient: boolean
}

/**
 * 체류 시간 한 조각.
 *
 * `durationSec` 은 딜이 **그 단계를 떠날 때** 기록된다 — 즉 이력 행의
 * `fromStageId` 에 머문 시간이다. 그래서 여기 필드 이름을 `toStageId` 라고 두면
 * 다음 사람이 반드시 반대로 묶는다. 무엇의 시간인지를 이름에 적는다.
 */
export interface HistoryRow {
  /** 이 시간이 누구의 것인가 = 떠난 단계(fromStageId) */
  stageId: string
  durationSec: number | null
}

const SEC_PER_DAY = 86400

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** 하루 미만도 뜻이 있다 — 0.5일을 0일로 접으면 "즉시 넘어감"이 사라진다 */
function toDays(sec: number): number {
  return Math.round((sec / SEC_PER_DAY) * 10) / 10
}

/**
 * 단계별 체류 시간을 낸다.
 *
 * 호출부는 이력의 `fromStageId` 를 `stageId` 로 넘긴다(HistoryRow 주석 참고).
 */
export function buildStageDurations(
  stages: { id: string; name: string; position: number; kind: string }[],
  history: HistoryRow[],
  standingByStage: Map<string, number>,
): StageDuration[] {
  const byStage = new Map<string, number[]>()
  for (const h of history) {
    if (h.durationSec === null || h.durationSec === undefined) continue
    // 음수는 시계가 틀어졌다는 뜻이다 — 0 으로 접지 않고 버린다(거짓 0 을 만들지 않는다)
    if (h.durationSec < 0) continue
    const arr = byStage.get(h.stageId) ?? []
    arr.push(h.durationSec)
    byStage.set(h.stageId, arr)
  }

  return stages
    // 성사·실패는 "머무는 단계"가 아니다 — 체류 시간을 물을 자리가 아니다
    .filter((s) => s.kind === 'OPEN')
    .map((s) => {
      const xs = byStage.get(s.id) ?? []
      const enough = xs.length >= MIN_SAMPLE
      return {
        stageId: s.id,
        stageName: s.name,
        position: s.position,
        samples: xs.length,
        medianDays: enough ? toDays(median(xs)) : null,
        maxDays: enough ? toDays(Math.max(...xs)) : null,
        standing: standingByStage.get(s.id) ?? 0,
        insufficient: !enough,
      }
    })
}

/**
 * 가장 오래 붙잡는 단계.
 *
 * 표본이 충분한 것 중에서만 고른다 — 얇은 표본으로 "여기가 병목"이라고 말하면
 * 사람은 없는 문제를 고치러 간다.
 */
export function bottleneckOf(rows: StageDuration[]): StageDuration | null {
  const usable = rows.filter((r) => !r.insufficient && r.medianDays !== null)
  if (usable.length < 2) return null
  return usable.reduce((a, b) => ((b.medianDays ?? 0) > (a.medianDays ?? 0) ? b : a))
}

/** 화면이 쓸 한 문장 — 판단할 수 없으면 그렇다고 말한다 */
export function velocitySummary(rows: StageDuration[]): string {
  const usable = rows.filter((r) => !r.insufficient)
  if (usable.length === 0) {
    return '아직 판단할 만큼 쌓이지 않았어요. 딜이 단계를 몇 번 더 지나가면 어디서 오래 걸리는지 보여 드릴게요.'
  }
  const worst = bottleneckOf(rows)
  if (!worst) {
    return `${usable.length}개 단계에서 기간이 나왔어요. 비교하려면 단계가 두 곳 이상 쌓여야 합니다.`
  }
  return `"${worst.stageName}"에서 가장 오래 머물러요 — 보통 ${worst.medianDays}일.`
}

/**
 * DB 에서 재료를 모아 체류 시간을 낸다.
 *
 * 이력이 딜에 딸려 있어(워크스페이스 컬럼이 없다) 가드가 경계를 못 건다 —
 * **이 워크스페이스의 딜 id 로 먼저 좁힌 뒤** 이력을 읽는다.
 * 안 그러면 남의 워크스페이스 영업 속도가 섞인다.
 */
export async function buildVelocity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  pipelineId?: string,
): Promise<{ pipelineId: string; pipelineName: string; stages: StageDuration[]; summary: string }[]> {
  const pipelines = await db.crmPipeline.findMany({
    where: pipelineId ? { id: pipelineId } : {},
    select: {
      id: true, name: true,
      stages: { select: { id: true, name: true, position: true, kind: true }, orderBy: { position: 'asc' } },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  }) as { id: string; name: string; stages: { id: string; name: string; position: number; kind: string }[] }[]

  const out: { pipelineId: string; pipelineName: string; stages: StageDuration[]; summary: string }[] = []

  for (const p of pipelines) {
    // 가드가 딜에는 워크스페이스를 걸어 준다 — 여기서 얻은 id 로만 이력을 읽는다
    const deals = await db.crmDeal.findMany({
      where: { pipelineId: p.id }, select: { id: true, stageId: true },
    }) as { id: string; stageId: string }[]

    const standing = new Map<string, number>()
    for (const d of deals) standing.set(d.stageId, (standing.get(d.stageId) ?? 0) + 1)

    const history = deals.length > 0
      ? await db.crmStageHistory.findMany({
        where: { dealId: { in: deals.map((d) => d.id) } },
        select: { fromStageId: true, durationSec: true },
      }) as { fromStageId: string | null; durationSec: number | null }[]
      : []

    const rows = buildStageDurations(
      p.stages,
      // durationSec 은 **떠난 단계**의 시간이다(HistoryRow 주석)
      history
        .filter((h): h is { fromStageId: string; durationSec: number | null } => !!h.fromStageId)
        .map((h) => ({ stageId: h.fromStageId, durationSec: h.durationSec })),
      standing,
    )

    out.push({ pipelineId: p.id, pipelineName: p.name, stages: rows, summary: velocitySummary(rows) })
  }

  return out
}
