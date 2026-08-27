// lib/ci/ai/discover-server.ts — 대조쌍을 읽고 "왜 이것만 잘됐나"를 쓴다 (서버 전용)
//
// 이 파일이 하는 일은 하나다: **AI에게 보기를 주지 않는다.**
//   옛 patterns.ts 는 규칙 7개를 미리 적어 두고 데이터를 그 7칸에 넣었다.
//   여기서는 떡상 1건과 평범 3건의 실제 내용을 나란히 보여 주고
//   "이 1건만 가진 것"을 자유 문장으로 쓰게 한다. 답의 집합이 열려 있다.
//
// 판정(무엇을 공식으로 올릴지)은 이 파일이 하지 않는다 — analysis/discovery.ts(순수)가 한다.
// 여기는 AI를 부르고 응답을 그 순수 계층이 먹을 수 있는 모양으로 옮기기만 한다.

import { callGeminiJson } from '../../ai/gemini-call.ts'
import { asJsonRecord } from '../../ai/json-recover.ts'
import { getGeminiMeta } from './meta.ts'
import type {
  ContrastSet, RawFinding, FindingCluster, DiscoveryKind,
} from '../analysis/discovery.ts'

const KINDS: readonly DiscoveryKind[] = [
  'hook', 'subject', 'format', 'timing', 'presentation', 'other',
]

/** 한 콘텐츠를 AI가 읽을 수 있게 편다. 없는 값은 "미확인"이라고 밝힌다 — 빈칸은 지어내기를 부른다. */
function describe(c: {
  title: string | null; caption: string | null
  durationSec: number | null; publishedAt: string | null; outlierIndex: number | null
}): string {
  const lines = [
    `제목: ${c.title?.trim() || '(미확인)'}`,
    `설명: ${c.caption?.trim().slice(0, 400) || '(없음)'}`,
    `길이: ${c.durationSec != null ? `${c.durationSec}초` : '(미확인)'}`,
    `게시: ${c.publishedAt?.slice(0, 10) ?? '(미확인)'}`,
  ]
  if (c.outlierIndex != null) lines.push(`평소 대비: ${c.outlierIndex.toFixed(1)}배`)
  return lines.join('\n')
}

/**
 * 1차 프롬프트 — 대조쌍 하나를 읽고 차이를 쓴다.
 *
 * 프롬프트가 지켜야 하는 것 셋:
 *   ① 보기를 주지 않는다 (주면 그 순간 다시 채점기가 된다)
 *   ② 원문에서 확인되는 것만 (모르면 없다고 쓰게 한다)
 *   ③ 이 1건에만 있는 것 (넷 다 가진 특징은 차이가 아니다)
 */
export function buildFindingPrompt(set: ContrastSet): string {
  const peers = set.peers
    .map((p, i) => `[평범 ${i + 1}]\n${describe(p)}`)
    .join('\n\n')

  return [
    '같은 채널의 게시물 4건이다. 하나만 유난히 잘됐고 나머지 셋은 이 채널의 보통 수준이다.',
    '잘된 하나가 **나머지 셋과 다른 점**을 찾아라.',
    '',
    `[잘된 것]\n${describe(set.winner)}`,
    '',
    peers,
    '',
    '규칙:',
    '- 위 정보에서 실제로 확인되는 것만 써라. 확인 안 되면 found:false 로 답하라.',
    '- 넷이 공통으로 가진 특징은 차이가 아니다. 잘된 하나에만 있는 것을 써라.',
    '- 보기에서 고르는 것이 아니다. 무엇이든 네가 본 것을 네 말로 써라.',
    '- statement 는 다른 콘텐츠에도 적용할 수 있는 한 문장으로. ("실패담으로 시작한다")',
    '- observation 은 그렇게 본 근거를 원문에서 인용하거나 짚어라.',
    '- 채널 이름·조회수·운(알고리즘)은 따라 할 수 없으므로 쓰지 마라.',
    '',
    'JSON만 출력:',
    '{"found":true,"statement":"한 문장","observation":"근거","kind":"hook|subject|format|timing|presentation|other"}',
    '찾지 못했으면: {"found":false}',
  ].join('\n')
}

/** 2차 프롬프트 — 같은 뜻의 문장을 묶는다. 한국어 동의 판정은 문자열 정규화로 안 된다. */
export function buildClusterPrompt(statements: readonly { id: number; text: string }[]): string {
  return [
    '아래는 서로 다른 콘텐츠를 분석해 나온 문장들이다. **같은 뜻인 것끼리 묶어라.**',
    '',
    ...statements.map((s) => `${s.id}. ${s.text}`),
    '',
    '규칙:',
    '- 글자가 달라도 뜻이 같으면 한 묶음이다. ("실패담으로 시작한다" = "처음에 망한 얘기를 꺼낸다")',
    '- 뜻이 다르면 억지로 묶지 마라. 혼자인 문장은 혼자 두어라.',
    '- statement 는 그 묶음을 가장 잘 나타내는 한 문장으로 새로 써라.',
    '- 모든 번호가 정확히 한 묶음에 들어가야 한다. 빠뜨리지 마라.',
    '',
    'JSON만 출력:',
    '{"groups":[{"statement":"대표 문장","ids":[1,3,7],"kind":"hook|subject|format|timing|presentation|other"}]}',
  ].join('\n')
}

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
}

/**
 * 대조쌍들을 읽고 반복되는 이유를 뽑는다.
 *
 * 실패해도 던지지 않는다 — 한 건이 깨졌다고 나머지 발견을 버리지 않는다.
 * 다만 **전부 못 불렀으면 blocked 로 말한다.** 0건과 "부를 수 없었다"는 다른 사실이다.
 */
export async function discoverFromContrasts(
  sets: readonly ContrastSet[],
  opts?: { maxSets?: number },
): Promise<DiscoverResult> {
  const empty: DiscoverResult = { findings: [], clusters: [], kinds: {}, blocked: null }
  if (sets.length === 0) return empty

  const meta = await getGeminiMeta()
  if (!meta.geminiApiKey) {
    return { ...empty, blocked: 'AI 키가 설정돼 있지 않습니다. 시스템 설정에서 Gemini 키를 넣어 주세요.' }
  }

  // 배수가 큰 것부터(analysis 계층이 이미 정렬해 준다). 예산이 한정될 때 설명 가치가 큰 것을 먼저 쓴다.
  const targets = sets.slice(0, opts?.maxSets ?? 60)

  const findings: RawFinding[] = []
  let lastError: string | null = null

  for (const set of targets) {
    try {
      const res = await callGeminiJson({
        prompt: buildFindingPrompt(set),
        apiKey: meta.geminiApiKey,
        model: meta.geminiModel,
        temperature: 0,           // 같은 대조에 같은 답이 나와야 근거로 쓸 수 있다
        maxOutputTokens: 400,
        feature: 'ci-discover',
      })
      const v = asJsonRecord(res.value)
      if (v.found !== true) continue

      const statement = typeof v.statement === 'string' ? v.statement.trim() : ''
      if (!statement) continue

      findings.push({
        contentId: set.winner.contentId,
        channelId: set.winner.channelId,
        statement,
        observation: typeof v.observation === 'string' ? v.observation.trim() : '',
      })
    } catch (e) {
      // 개별 실패는 나머지를 멈추지 않는다. 다만 마지막 사유는 들고 있는다.
      lastError = e instanceof Error ? e.message : String(e)
    }
  }

  if (findings.length === 0) {
    return { ...empty, blocked: lastError ? `분석을 시작하지 못했습니다 — ${lastError}` : null }
  }

  // 2차 — 같은 뜻끼리 묶는다
  const numbered = findings.map((f, i) => ({ id: i + 1, text: f.statement }))
  const kinds: Record<string, DiscoveryKind> = {}
  let clusters: FindingCluster[] = []

  try {
    const res = await callGeminiJson({
      prompt: buildClusterPrompt(numbered),
      apiKey: meta.geminiApiKey,
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

  if (clusters.length === 0) {
    clusters = findings.map((f) => ({ statement: f.statement, contentIds: [f.contentId] }))
  }

  return { findings, clusters, kinds, blocked: null }
}
