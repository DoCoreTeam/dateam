// lib/ci/ai/discover-server.ts — 대조쌍을 읽고 "왜 이것만 잘됐나"를 쓴다 (서버 전용)
//
// 이 파일이 하는 일은 하나다: **AI에게 보기를 주지 않는다.**
//   옛 patterns.ts 는 규칙 7개를 미리 적어 두고 데이터를 그 7칸에 넣었다.
//   여기서는 떡상 1건과 평범 3건의 실제 내용을 나란히 보여 주고
//   "이 1건만 가진 것"을 자유 문장으로 쓰게 한다. 답의 집합이 열려 있다.
//
// 판정(무엇을 공식으로 올릴지)은 이 파일이 하지 않는다 — analysis/discovery.ts(순수)가 한다.
// 여기는 AI를 부르고 응답을 그 순수 계층이 먹을 수 있는 모양으로 옮기기만 한다.

import { callGeminiJson, GeminiCallError } from '../../ai/gemini-call.ts'
import {
  contrastKey, splitByKnown, DISCOVERY_PROMPT_VERSION, type StoredAnswer,
} from '../analysis/contrast-key.ts'
import { loadAnswers, saveAnswer } from './discovery-answers.ts'
import { asJsonRecord } from '../../ai/json-recover.ts'
import { getGeminiMeta } from './meta.ts'
import { CAPTION_CHARS, buildFindingPrompt, buildClusterPrompt } from './discover-prompt.ts'
// 부르는 쪽이 지금처럼 이 파일에서 가져가게 둔다 — 옮긴 것이 호출부를 건드리지 않게
export { CAPTION_CHARS, buildFindingPrompt, buildClusterPrompt }
import {
  MIN_CALL_INTERVAL_MS, FREE_TIER_DAILY_LIMIT, clusterByOverlap, mergeClusters,
  type ContrastSet, type RawFinding, type FindingCluster, type DiscoveryKind,
} from '../analysis/discovery.ts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const KINDS: readonly DiscoveryKind[] = [
  'hook', 'subject', 'format', 'timing', 'presentation', 'other',
]


function toKind(v: unknown): DiscoveryKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v)
    ? (v as DiscoveryKind)
    : 'other'
}

export interface DiscoverResult {
  findings: RawFinding[]
  clusters: FindingCluster[]
  kinds: Record<string, DiscoveryKind>
  /** AI를 못 부른 이유. 있으면 호출부가 사용자에게 그대로 알린다 — 조용히 0건으로 두지 않는다. */
  blocked: string | null
  /** 실제로 벤더에 물은 묶음 수. 화면이 「AI 몇 회를 씁니다」라고 말할 근거 */
  asked: number
  /** 저장된 답으로 해결한 묶음 수 */
  cached: number
  /**
   * 새로 물을 것이 하나도 없었다.
   *
   * 이때는 **저장된 발견을 건드리지 않는다.** 아무것도 안 바뀌었는데 보관 처리하고
   * 다시 넣으면, 묶기가 실행마다 달라지는 탓에 화면의 발견이 이유 없이 뒤바뀐다.
   */
  unchanged: boolean
}

/**
 * 대조쌍들을 읽고 반복되는 이유를 뽑는다.
 *
 * 실패해도 던지지 않는다 — 한 건이 깨졌다고 나머지 발견을 버리지 않는다.
 * 다만 **전부 못 불렀으면 blocked 로 말한다.** 0건과 "부를 수 없었다"는 다른 사실이다.
 */
export async function discoverFromContrasts(
  sets: readonly ContrastSet[],
  opts: { maxSets: number; workspaceId: string },
): Promise<DiscoverResult> {
  const empty: DiscoverResult = {
    findings: [], clusters: [], kinds: {}, blocked: null,
    asked: 0, cached: 0, unchanged: true,
  }
  if (sets.length === 0) return empty

  const meta = await getGeminiMeta()
  if (!meta.geminiApiKey) {
    return { ...empty, blocked: 'AI 키가 설정돼 있지 않습니다. 시스템 설정에서 Gemini 키를 넣어 주세요.' }
  }

  // 배수가 큰 것부터(analysis 계층이 이미 정렬해 준다). 예산이 한정될 때 설명 가치가 큰 것을 먼저 쓴다.
  const targets = sets.slice(0, opts.maxSets)

  /*
    **이미 물어본 것은 다시 묻지 않는다.**

    대조쌍의 입력(제목·설명·길이·게시일)은 수집이 끝나면 변하지 않고 호출은 temperature 0 이다.
    같은 묶음에는 같은 답이 온다. 그런데 답을 두는 자리가 없어서 매번 처음부터 다시 물었다.

    실측 2026-09-20: 서로 다른 질문이 최대 624개인데 사흘 동안 49,064번 물었다(78.6배).
    그중 46,212번이 한도로 실패했고, 그동안 같은 키를 쓰는 회의노트와 CRM 이 함께 죽었다.
  */
  const known = await loadAnswers(
    opts.workspaceId,
    targets.map((t) => contrastKey(t)),
  )
  const { cached, fresh } = splitByKnown(targets, known)

  const findings: RawFinding[] = []
  const kindsFromStore: Record<string, DiscoveryKind> = {}
  let lastError: string | null = null

  // 저장된 답부터 담는다. found:false 도 답이라 그냥 건너뛴다 — 다시 묻지 않기 위해 적어 둔 것이다
  for (const { set, answer } of cached) {
    if (!answer.found || !answer.statement) continue
    findings.push({
      contentId: set.winner.contentId,
      channelId: set.winner.channelId,
      statement: answer.statement,
      observation: answer.observation,
    })
    kindsFromStore[answer.statement] = toKind(answer.kind)
  }

  /*
    새로 물을 것이 하나도 없으면 **여기서 끝낸다.**

    묶기 호출(AI 1회)도 아끼지만, 더 중요한 것은 저장된 발견을 안 건드리는 것이다.
    묶기는 실행마다 결과가 달라지므로, 아무것도 안 바뀐 날에 다시 돌리면 화면의 발견이
    이유 없이 뒤바뀐다. 「안 바뀌었다」는 사실을 그대로 올려 호출부가 쓰기를 건너뛰게 한다.
  */
  if (fresh.length === 0) {
    return {
      findings, clusters: [], kinds: kindsFromStore, blocked: null,
      asked: 0, cached: cached.length, unchanged: true,
    }
  }

  let asked = 0
  let lastCallAt = 0

  for (const { set, key } of fresh) {
    // 분당 한도를 넘기지 않게 간격을 맞춘다. 몰아치면 429가 나고,
    // 429는 재시도까지 부르므로 **빨리 가려다 아예 못 가게 된다**(실측).
    const wait = lastCallAt === 0 ? 0 : MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt)
    if (wait > 0) await sleep(wait)
    lastCallAt = Date.now()

    try {
      const res = await callGeminiJson({
        prompt: buildFindingPrompt(set),
        apiKey: meta.geminiApiKey,
        fallbackApiKey: meta.fallbackApiKey,
        model: meta.geminiModel,
        temperature: 0,           // 같은 대조에 같은 답이 나와야 근거로 쓸 수 있다
        /*
          상한을 400 으로 박아 두고 있었는데 그 값에서 잘려 JSON 파싱이 실패한 적이 있다
          (잘리면 statement 가 중간에서 끊기고, 끊긴 답은 근거로 못 쓴다).
          이제 능력이 상한을 정한다 — suggest 는 1,024 이고, 후보를 내는 일이므로
          하루 한도가 가장 큰 모델부터 간다.
        */
        capability: 'suggest',
        feature: 'ci-discover',
      })
      asked += 1
      const v = asJsonRecord(res.value)
      const statement = v.found === true && typeof v.statement === 'string'
        ? v.statement.trim() : ''
      const answer: StoredAnswer = {
        found: Boolean(statement),
        statement,
        observation: typeof v.observation === 'string' ? v.observation.trim() : '',
        kind: typeof v.kind === 'string' ? v.kind : 'other',
      }

      /*
        **못 찾았다는 답도 적는다.**

        「이 묶음에는 차이가 없다」를 확인하는 데도 호출 한 번이 들었다. 안 적으면
        못 찾은 묶음만 영원히 다시 묻게 되고, 그것이 가장 흔한 경우다.
        기다리지 않으면 다음 건이 먼저 돌아 저장 순서가 엉키므로 여기서 기다린다 —
        어차피 아래에서 간격만큼 쉰다.
      */
      await saveAnswer({
        workspaceId: opts.workspaceId,
        contrastKey: key,
        promptVersion: DISCOVERY_PROMPT_VERSION,
        winnerContentId: set.winner.contentId,
        answer,
        modelName: res.model,
      })

      if (!answer.found) continue

      findings.push({
        contentId: set.winner.contentId,
        channelId: set.winner.channelId,
        statement: answer.statement,
        observation: answer.observation,
      })
    } catch (e) {
      // 개별 실패는 나머지를 멈추지 않는다. 다만 마지막 사유는 들고 있는다.
      lastError = e instanceof Error ? e.message : String(e)

      /*
        단, **한도는 다르다.** 한도에 걸리면 다음 건도 100% 같은 이유로 실패한다.
        계속 두드리면 남은 하루치를 재시도로 태우고, 사용자는 몇 분을 더 기다린 뒤
        같은 답을 받는다. 실측: 한도 상태에서 123회를 두드려 성공 0회였다.

        판정은 **오류의 이유 값**으로 한다. 예전에는 메시지 글자를 정규식으로 뒤졌는데,
        호출기가 「AI 연결 실패 · 서버 응답 없음」이라는 한도와 무관한 문장을 올리면
        그 정규식이 안 걸려 멈춤 장치가 한 번도 작동하지 않았다
        (실측 2026-09-20: 그 문장으로 올라온 한도 실패가 23,096건).
        글자는 사람 읽으라고 있는 것이지 코드가 판단하라고 있는 것이 아니다.
      */
      const quota = e instanceof GeminiCallError
        && (e.reason === 'quota' || e.reason === 'auth')
      if (quota) {
        lastError = `AI 호출 한도를 다 썼습니다(무료 티어는 모델당 하루 ${FREE_TIER_DAILY_LIMIT}회). `
          + '유료 키로 바꾸거나 한도가 초기화된 뒤 다시 시도해 주세요.'
        break
      }
    }
  }

  if (findings.length === 0) {
    return {
      ...empty,
      blocked: lastError ? `분석을 시작하지 못했습니다 — ${lastError}` : null,
      asked, cached: cached.length, unchanged: asked === 0,
    }
  }

  // 2차 — 같은 뜻끼리 묶는다 (여기도 같은 한도를 쓴다)
  {
    const wait = MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt)
    if (wait > 0) await sleep(wait)
  }
  const numbered = findings.map((f, i) => ({ id: i + 1, text: f.statement }))
  const kinds: Record<string, DiscoveryKind> = {}
  let clusters: FindingCluster[] = []

  try {
    const res = await callGeminiJson({
      prompt: buildClusterPrompt(numbered),
      apiKey: meta.geminiApiKey,
      fallbackApiKey: meta.fallbackApiKey,
      model: meta.geminiModel,
      temperature: 0,
      maxOutputTokens: 2000,
      feature: 'ci-discover-cluster',
    })
    const v = asJsonRecord(res.value)
    const groups = Array.isArray(v.groups) ? v.groups : []

    for (const g of groups) {
      const row = asJsonRecord(g)
      const statement = typeof row.statement === 'string' ? row.statement.trim() : ''
      if (!statement) continue
      const ids = Array.isArray(row.ids) ? row.ids : []
      const contentIds = ids
        .map((n) => (typeof n === 'number' ? findings[n - 1]?.contentId : undefined))
        .filter((v2): v2 is string => Boolean(v2))
      if (contentIds.length === 0) continue

      clusters.push({ statement, contentIds })
      kinds[statement] = toKind(row.kind)
    }
  } catch {
    // 묶기가 실패하면 묶지 않은 채로 간다 — 각 문장이 자기 묶음이 된다.
    // 그러면 채널 수 조건에 대부분 걸려 승격되지 않는다. 즉 **틀린 것을 올리는 대신 덜 올린다.**
    clusters = []
  }

  // AI가 묶었더라도 한 번 더 합친다 — AI 묶기는 실행마다 결과가 달라진다(실측).
  // 파이프라인이 그날 AI 기분에 좌우되면 안 된다.
  if (clusters.length > 0) clusters = mergeClusters(clusters)

  if (clusters.length === 0) {
    // AI 묶기가 실패했다. 문장 하나씩 홀로 두면 채널이 1곳이라 **전부 탈락**한다 —
    // 그건 발견을 만들어 놓고 버리는 것이다. 글자 겹침으로라도 묶는다.
    // 승격 문턱(채널 3곳)은 그대로라 거칠게 묶여도 아무거나 올라가지 않는다.
    clusters = clusterByOverlap(findings)
  }

  return {
    findings, clusters,
    // 저장에서 온 갈래와 이번에 물어 온 갈래를 합친다. 같은 문장이면 이번 것이 이긴다
    kinds: { ...kindsFromStore, ...kinds },
    blocked: null,
    asked, cached: cached.length, unchanged: false,
  }
}
