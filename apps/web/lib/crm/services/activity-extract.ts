/**
 * 활동 노트 → 5축 (AI 가 기록을 읽는다)
 *
 * **왜 필요한가**: 영업이 하루에 가장 많이 남기는 글은 회의록이 아니라 **한 줄 노트**다.
 * "김 팀장이 예산은 3억으로 품의 올렸다고 함. 8월 25일까지 견적 달라고." —
 * 이 문장 안에 금액도, 사람도, 다음 약속도 다 있는데 지금까지는 타임라인에 글자로만 남았다.
 * 그래서 딜 금액은 비어 있고, 할 일은 안 잡히고, 며칠 뒤 "그거 언제까지였지"를 다시 찾아야 했다.
 *
 * **왜 미팅과 같은 엔진인가**: 뽑아야 하는 것이 똑같기 때문이다(누가·무엇·어디까지·걸림돌·다음).
 * 두 벌로 만들면 한쪽만 고치게 되고, 그 차이는 버그가 아니라 **제품의 성격**으로 읽힌다.
 * 그래서 프롬프트·스키마·근거검증·제안매핑을 전부 그대로 쓰고,
 * 다른 것 셋만 갈아 끼운다 — 부르는 말(전사→기록), 근거의 단위(구간→줄), 붙일 자리(미팅→활동).
 *
 * **한 번만 읽는다.** 활동은 고칠 수 없는 기록이라(activity.ts) 다시 읽어도 같은 글이다.
 * 다시 부르면 같은 제안이 인박스에 두 번 쌓이고 돈만 또 든다.
 */

import { getCrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { runAi } from '../ai/runner.ts'
import type { AiAdapter } from '../ai/runner.ts'
import { buildMeetingExtractPrompt, MEETING_EXTRACT_VERSION } from '../ai/prompts/meeting-extract.v1.ts'
import type { Segment } from '../ai/prompts/meeting-extract.v1.ts'
import { parseFiveAxis, dropUngrounded, countAxes } from '../ai/schemas/five-axis.ts'
import type { FiveAxisOutput } from '../ai/schemas/five-axis.ts'
import { fiveAxisToSuggestions } from './five-axis-suggest.ts'
import { loadExtractContext } from './extract-context.ts'
import type { ExtractResult } from './meeting.ts'
import { kstDateKey } from '../../datetime/kst.ts'

/** 이 글자 수 미만이면 AI 를 부르지 않는다 — "전화함" 세 글자에서 뽑을 것은 없다 */
const MIN_CHARS = 15
/** 한 기록이 아무리 길어도 여기서 끊는다 — 붙여넣기 한 방에 비용이 폭발하지 않게 */
const MAX_LINES = 200

/**
 * 노트를 근거 댈 수 있는 조각으로 나눈다.
 *
 * 미팅은 전사 구간에 이미 id 가 있지만 노트에는 없다. 그래서 **줄이 곧 구간**이다.
 * 줄 번호를 id 로 쓰면 사람이 인박스에서 "3번째 줄에서 나왔다"를 되짚을 수 있고,
 * `dropUngrounded` 가 지어낸 근거를 그대로 걸러 낸다 — 이게 환각을 막는 유일한 장치다.
 */
export function noteToSegments(title: string, body: string | null): Segment[] {
  const lines = [title, ...(body ?? '').split('\n')]
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)

  return lines.map((text, i) => ({ id: `L${i + 1}`, speaker: null, text }))
}

export async function extractActivityFiveAxis(
  workspaceId: string,
  actorId: string | null,
  activityId: string,
  adapter: AiAdapter,
): Promise<ExtractResult> {
  const db = getCrmDb(workspaceId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activity = await (db as any).crmActivity.findFirst({
    where: { id: activityId },
    select: {
      id: true, type: true, title: true, body: true, occurredAt: true,
      companyId: true, personId: true, dealId: true,
    },
  })
  if (!activity) throw new CrmError('NOT_FOUND', '기록을 찾을 수 없습니다.')

  const segments = noteToSegments(activity.title, activity.body)
  const chars = segments.reduce((n: number, s: Segment) => n + s.text.length, 0)
  if (chars < MIN_CHARS) {
    throw new CrmError('VALIDATION_FAILED',
      '기록이 너무 짧아 읽어낼 내용이 없어요. 무슨 이야기가 오갔는지 조금 더 적어 주세요.')
  }

  // 같은 기록을 두 번 읽지 않는다 — 활동은 고칠 수 없으므로 다시 읽어도 같은 글이다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const already = await (db as any).crmAiRun.findFirst({
    where: { kind: 'MEETING_EXTRACT', inputRef: { path: ['activityId'], equals: activityId } },
    select: { id: true },
  })
  if (already) {
    throw new CrmError('VALIDATION_FAILED',
      '이 기록은 이미 AI 가 읽었어요. 인박스에서 결과를 확인해 주세요.')
  }

  /**
   * 회사를 인물에서 되찾는다.
   *
   * 인물 상세에서 남긴 노트는 `companyId` 가 비어 있다. 그대로 두면 WHO 축이 통째로 죽어
   * "새로 나온 사람"을 영영 제안하지 못한다 — 정작 그 화면이 사람 이야기를 가장 많이 남기는 곳이다.
   */
  let companyId: string | null = activity.companyId
  if (!companyId && activity.personId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const person = await (db as any).crmPerson.findFirst({
      where: { id: activity.personId }, select: { companyId: true },
    })
    companyId = person?.companyId ?? null
  }

  const ctx = await loadExtractContext(db, companyId, activity.dealId)
  ctx.sourceKind = 'note'
  // 기록을 남긴 날을 알려 준다 — 없으면 "8월 25일까지"를 엉뚱한 연도로 적는다
  ctx.meetingDate = kstDateKey(activity.occurredAt)

  const validIds = new Set(segments.map((s) => s.id))

  const { output, runId } = await runAi<FiveAxisOutput>({
    db, workspaceId,
    // 종류를 새로 만들지 않는다 — enum 을 늘리면 마이그레이션이 필요해진다.
    // 읽는 규칙도 뽑는 것도 미팅과 같으므로, 구분은 inputRef 가 한다.
    kind: 'MEETING_EXTRACT',
    prompt: {
      version: MEETING_EXTRACT_VERSION,
      build: () => buildMeetingExtractPrompt(segments, ctx),
    },
    input: segments.map((s) => s.text).join('\n'),
    inputRef: { activityId, lines: segments.length },
    parse: parseFiveAxis,
    adapter,
    estimateMinorUsd: BigInt(1),
  })

  const before = countAxes(output)
  const grounded = dropUngrounded(output, validIds)
  const after = countAxes(grounded)
  const dropped = Object.keys(before).reduce((n, k) => n + (before[k] - after[k]), 0)

  const suggested = await fiveAxisToSuggestions(workspaceId, actorId, runId, {
    companyId, dealId: activity.dealId,
    anchorType: 'activity', anchorId: activity.id,
  }, grounded)

  return { runId, axes: after, suggested, dropped }
}
