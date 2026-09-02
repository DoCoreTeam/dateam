// lib/ci/ai/assistant-server.ts — 어시스턴트 실행 (서버 전용)
// 어시스턴트는 API를 우회하지 않는다. 같은 조회·쓰기 경로를 그대로 쓴다.

import { createAdminClient } from '@/lib/supabase/server'
import { getCommand, isExecutable, parseIntent, type Intent } from './assistant.ts'
import { listContents } from '../queries/contents.ts'
import { listChannels } from '../queries/channels.ts'
import { listIdeas } from '../queries/ideas.ts'
import { getMarketOverview, getPatterns, getSignals } from '../queries/trends.ts'
import { getMinePerformance } from '../queries/performance.ts'
import { normalizeWindowDays } from '../window.ts'
import { addChannel } from '../queries/channels.ts'
import { parseContentUrl } from '../ucm/url.ts'
import { enqueueJob } from '../jobs/queue.ts'
import { buildIntentPrompt, parseIntentResponse } from './intent-llm.ts'
import { callGemini } from './gemini.ts'
import { getGeminiMeta } from './meta.ts'
import { recordSystemEventAsync } from '@/lib/system-log/record'
import { formatKstAgo, formatKstDateTimeShort } from '@/lib/datetime/kst'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 사람이 채팅창 앞에서 기다릴 수 있는 한계.
 *
 * 왜 60초가 아닌가(실측 2026-08-31): 같은 프롬프트를 5번 불렀더니
 * 2초·7.5초·7.5초·39.9초, 그리고 한 번은 **60초를 채우고 죽었다**.
 * 60초를 기다린 끝에 실패를 보는 것은 실패보다 나쁘다 —
 * 20초에서 끊고 "AI가 늦어 규칙으로만 답했다"고 말하는 편이 낫다.
 */
const INTENT_TIMEOUT_MS = 20_000

/** LLM 해석이 왜 실패했는지. 화면이 다른 말을 하기 위한 값이다. */
type LlmFailure = 'no_key' | 'timeout' | 'provider_error' | null

/**
 * 규칙이 놓친 문장을 LLM에게 물어 커맨드로 옮긴다.
 *
 * 못 알아들으면 커맨드는 null이다 — 키가 없든, 응답이 깨졌든, 카탈로그 밖 이름이든.
 * **엉뚱한 커맨드를 실행하는 것은 사고**이므로 그 판단은 그대로 둔다.
 *
 * 달라진 것은 **왜 실패했는지를 함께 돌려준다**는 점이다.
 * 예전에는 전부 null이라, 20초를 기다린 시간 초과와 "무슨 말인지 모르겠다"가
 * 화면에서 같은 문장으로 나왔다. 사용자는 자기 문장이 이상한 줄 알고 다시 고쳐 썼다.
 *
 * temperature 0: 같은 질문에 같은 답이 나와야 사용자가 학습할 수 있다.
 */
async function resolveIntentWithLlm(
  message: string,
): Promise<{ intent: Intent | null; failure: LlmFailure }> {
  if (!message.trim()) return { intent: null, failure: null }
  try {
    const { geminiApiKey, geminiModel } = await getGeminiMeta()
    if (!geminiApiKey) return { intent: null, failure: 'no_key' }

    const r = await callGemini({
      apiKey: geminiApiKey,
      model: geminiModel,
      prompt: buildIntentPrompt(message),
      temperature: 0,
      // 목록에서 하나 고르는 일이다 — 오래 생각해서 얻는 것이 없다(실측 7.5초 → 4.7초)
      thinkingLevel: 'low',
      timeoutMs: INTENT_TIMEOUT_MS,
    })
    if (!r.ok) {
      const failure: LlmFailure = r.error.includes('시간 안에') ? 'timeout' : 'provider_error'
      await recordSystemEventAsync({
        source: 'host_ai',
        feature: 'ci.assistant',
        error: r.error,
        blocksUser: true,
        hint: geminiModel,
      })
      return { intent: null, failure }
    }
    return { intent: parseIntentResponse(r.text), failure: null }
  } catch (e) {
    await recordSystemEventAsync({
      source: 'host_ai', feature: 'ci.assistant', error: e, blocksUser: true,
    })
    return { intent: null, failure: 'provider_error' }
  }
}

/**
 * 사람이 부른 이름과 등록된 채널 이름을 맞춰 본다.
 *
 * 정확히 같기를 요구하면 아무것도 안 걸린다 — 사람은 「추성훈」이라 부르고
 * 채널 이름은 「추성훈 CHOO」처럼 붙어 있다. 그래서 **양쪽 포함**으로 본다.
 * 공백·대소문자는 무시한다(표기 흔들림은 같은 채널이다).
 */
function matchesChannelName(displayName: string, handle: string | null, query: string): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, '')
  const q = norm(query)
  if (!q) return false
  const name = norm(displayName)
  const h = handle ? norm(handle) : ''
  return name.includes(q) || q.includes(name) || (h !== '' && (h.includes(q) || q.includes(h)))
}

/** 한 번에 훑는 채널 수. 여러 채널이 걸려도 답이 화면을 넘지 않게. */
const LATEST_CHANNEL_MAX = 3
/** 채널당 보여줄 최근 게시물 수. */
const LATEST_ITEM_MAX = 3

export interface AssistantLine {
  label: string
  detail?: string
  href?: string
}

export interface AssistantReply {
  say: string
  command: string | null
  executed: boolean
  /** guarded라 실행하지 않고 제안만 한 경우 */
  suggestion: string | null
  /**
   * 왜 못 했는지. null 이면 정상(실행했거나 안전하게 제안만 했다).
   *
   * 왜 필요한가: 예전에는 시간 초과·키 없음·못 알아들음이 화면에서 전부
   * 같은 문장으로 나왔다. 사용자는 자기 문장을 고쳐 쓰지만 원인은 거기 없었다.
   */
  failure?: 'not_understood' | 'ai_timeout' | 'ai_unavailable' | null
  lines: AssistantLine[]
  href: string | null
}

/** 예시는 한 곳에서만 적는다 — 화면과 서버가 다른 예시를 말하면 사용자가 학습을 못 한다. */
const EXAMPLE_LINES: AssistantLine[] = [
  { label: '"이번 주 떡상 보여줘"' },
  { label: '"수집함 보여줘"' },
  { label: '"추성훈 채널 새 거 올라왔어?"' },
  { label: '링크를 그대로 붙여넣기' },
]

/**
 * 실행하지 못했을 때의 답. **사유마다 다른 말을 한다.**
 *
 * 같은 문장으로 뭉개면 사용자는 언제나 자기 문장을 의심한다.
 * 실제로는 AI가 늦었거나(20초 초과) 키가 없었을 수도 있고, 그건 사용자가 고칠 일이 아니다.
 */
function notUnderstood(failure: LlmFailure = null): AssistantReply {
  if (failure === 'timeout') {
    return {
      say: 'AI가 시간 안에 답하지 않아 규칙으로만 해석했습니다.',
      command: null, executed: false, suggestion: null, failure: 'ai_timeout',
      lines: [
        { label: '아래처럼 물으면 AI 없이 바로 답합니다' },
        ...EXAMPLE_LINES,
      ],
      href: null,
    }
  }
  if (failure === 'no_key' || failure === 'provider_error') {
    return {
      say: failure === 'no_key'
        ? 'AI 키가 등록돼 있지 않아 규칙으로만 해석했습니다.'
        : 'AI를 부르지 못해 규칙으로만 해석했습니다.',
      command: null, executed: false, suggestion: null, failure: 'ai_unavailable',
      lines: [
        { label: '아래처럼 물으면 AI 없이 바로 답합니다' },
        ...EXAMPLE_LINES,
      ],
      href: null,
    }
  }
  return {
    say: '무슨 뜻인지 확실하지 않아 아무것도 실행하지 않았습니다.',
    command: null,
    executed: false,
    suggestion: null,
    failure: 'not_understood',
    lines: EXAMPLE_LINES,
    href: null,
  }
}

export async function runAssistant(input: {
  workspaceId: string
  userId: string
  message: string
  route: string
}): Promise<AssistantReply> {
  // 규칙이 먼저다 — 흔한 말은 LLM 없이 즉시, 공짜로, 같은 답이 나온다.
  // 규칙이 놓쳤을 때만 LLM에 물어본다. 예전에는 여기서 바로 포기해서
  // 목록에 없는 표현이면 뭘 물어도 "모르겠다"였다.
  let intent: Intent | null = parseIntent(input.message)
  let llmFailure: LlmFailure = null
  if (!intent) {
    const resolved = await resolveIntentWithLlm(input.message)
    intent = resolved.intent
    llmFailure = resolved.failure
  }
  if (!intent) return notUnderstood(llmFailure)

  const spec = getCommand(intent.command)
  if (!spec) return notUnderstood()

  // guarded·차단 커맨드는 실행하지 않는다. 어디서 직접 하면 되는지만 알려준다.
  if (!isExecutable(intent.command)) {
    return {
      say: intent.say,
      command: intent.command,
      executed: false,
      suggestion: `${spec.description} — 되돌리기 어려운 작업이라 화면에서 직접 확인하고 실행해 주세요.`,
      lines: [],
      href: intent.command === 'brief.generate' ? '/ci/pipeline'
        : intent.command === 'setting.set' ? '/ci/settings'
        : intent.command === 'publish.now' ? '/ci/publish' : null,
    }
  }

  const ws = input.workspaceId

  switch (intent.command) {
    case 'trends.outliers': {
      const windowDays = normalizeWindowDays(intent.args.windowDays)
      const r = await listContents({ workspaceId: ws, corpusOnly: true, sort: 'outlier', windowDays, limit: 8 })
      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null,
        href: `/ci/trends?tab=outliers&windowDays=${windowDays}`,
        lines: r.items.length === 0
          ? [{ label: '조건에 맞는 콘텐츠가 아직 없습니다' }]
          : r.items.map((c) => ({
              label: c.title ?? '제목 없음',
              detail: c.outlierText ?? '비교 이력이 부족해 배수를 내지 않았습니다',
            })),
      }
    }
    case 'trends.market': {
      const m = await getMarketOverview(ws)
      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null,
        href: '/ci/trends?tab=market',
        lines: m.population === 0
          ? [{ label: '아직 모인 시장 데이터가 없습니다' }]
          : [
              { label: m.basisText },
              ...m.byPlatform.slice(0, 5).map((s) => ({
                label: s.label, detail: `${s.count}건 (${s.share}%) ${s.medianOutlierText ?? ''}`.trim(),
              })),
            ],
      }
    }
    case 'trends.patterns': {
      const rows = await getPatterns(ws)
      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null,
        href: '/ci/trends?tab=patterns',
        lines: rows.length === 0
          ? [{ label: '승격 기준을 넘은 공식이 아직 없습니다', detail: '근거 20개·채널 5곳이 필요합니다' }]
          : rows.slice(0, 8).map((p) => ({ label: p.statement, detail: p.liftText ?? undefined })),
      }
    }
    case 'trends.signals': {
      const rows = await getSignals(ws)
      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null,
        href: '/ci/trends?tab=signals',
        lines: rows.length === 0
          ? [{ label: '등록된 이슈가 없습니다' }]
          : rows.slice(0, 8).map((s) => ({ label: s.title, detail: s.occurredAtText ?? undefined })),
      }
    }
    case 'inbox.list':
    case 'inbox.review': {
      const tab = intent.command === 'inbox.review' ? 'review' : 'all'
      const r = await listContents({ workspaceId: ws, tab, corpusOnly: false, sort: 'recent', limit: 8 })
      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null,
        href: tab === 'review' ? '/ci/inbox?tab=review' : '/ci/inbox',
        lines: r.items.length === 0
          ? [{ label: tab === 'review' ? '검토할 항목이 없습니다' : '수집함이 비어 있습니다' }]
          : r.items.map((c) => ({ label: c.title ?? c.canonicalUrl, detail: c.topic?.name ?? '미분류' })),
      }
    }
    case 'channels.list': {
      const rows = await listChannels(ws, 'tracked')
      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null,
        href: '/ci/monitoring',
        lines: rows.length === 0
          ? [{ label: '등록한 관심 채널이 없습니다' }]
          : rows.map((c) => ({ label: c.displayName, detail: c.isMonitored ? '지켜보는 중' : '중지' })),
      }
    }
    case 'channels.latest': {
      const query = String(intent.args.query ?? '').trim()
      const rows = await listChannels(ws)
      // 이름을 말했으면 그 채널만. 안 말했으면 지켜보는 채널을 최근 순으로 훑는다.
      const picked = query
        ? rows.filter((c) => matchesChannelName(c.displayName, c.handle, query))
        : rows.filter((c) => c.isMonitored)

      if (picked.length === 0) {
        return {
          say: query
            ? `관심 채널에서 "${query}"을(를) 찾지 못했습니다`
            : '지켜보는 관심 채널이 없습니다',
          command: intent.command, executed: false, suggestion: null, failure: null,
          href: '/ci/monitoring',
          lines: rows.length === 0
            ? [{ label: '등록한 관심 채널이 없습니다', detail: '모니터링 화면에서 채널 주소를 넣으면 등록됩니다' }]
            : rows.slice(0, 8).map((c) => ({ label: c.displayName, detail: '등록된 관심 채널' })),
        }
      }

      const targets = picked.slice(0, LATEST_CHANNEL_MAX)
      const adminClient = createAdminClient() as any
      // 「마지막으로 언제 훑었나」를 함께 말한다 — 이게 없으면 "새 게시물 0건"이
      //  «정말 안 올라왔다»인지 «우리가 아직 안 봤다»인지 구분되지 않는다.
      const { data: sweepRows } = await adminClient
        .from('ci_channels')
        .select('id, last_sweep_at')
        .in('id', targets.map((c) => c.id))
      const sweepAt = new Map<string, string | null>(
        ((sweepRows ?? []) as { id: string; last_sweep_at: string | null }[])
          .map((r) => [r.id, r.last_sweep_at]),
      )

      const lines: AssistantLine[] = []
      for (const ch of targets) {
        const r = await listContents({
          workspaceId: ws,
          channelId: ch.id,
          corpusOnly: false,
          sort: 'recent',
          limit: LATEST_ITEM_MAX,
        })
        const swept = sweepAt.get(ch.id) ?? null
        lines.push({
          label: ch.displayName,
          detail: swept
            ? `마지막 수집 ${formatKstDateTimeShort(swept)} (${formatKstAgo(swept)}) · 모인 게시물 ${r.total}건`
            : `아직 수집 전 · 모인 게시물 ${r.total}건`,
        })
        if (r.items.length === 0) {
          lines.push({ label: '— 이 채널에서 아직 모인 게시물이 없습니다' })
          continue
        }
        for (const c of r.items) {
          lines.push({
            label: `— ${c.title ?? c.canonicalUrl}`,
            detail: c.publishedAtText ?? '게시일을 확보하지 못했습니다',
          })
        }
      }

      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null, failure: null,
        href: '/ci/monitoring',
        lines,
      }
    }
    case 'pipeline.list': {
      const rows = await listIdeas(ws)
      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null,
        href: '/ci/pipeline',
        lines: rows.length === 0
          ? [{ label: '제작 중인 아이디어가 없습니다' }]
          : rows.map((i) => ({ label: i.title, detail: `${i.stage} · ${i.daysInStage}일째` })),
      }
    }
    case 'performance.mine': {
      const perf = await getMinePerformance(ws)
      return {
        say: intent.say, command: intent.command, executed: true, suggestion: null,
        href: '/ci/performance',
        lines: perf.rows.length === 0
          ? [{ label: '추적 중인 내 게시물이 없습니다', detail: '게시 화면에서 주소를 입력하면 시작됩니다' }]
          : [
              { label: `게시 ${perf.summary.published}건`, detail: perf.basisText },
              ...perf.rows.slice(0, 6).map((r) => ({
                label: r.title ?? '제목 없음',
                detail: r.outlierText ?? '비교 이력 부족',
              })),
            ],
      }
    }
    case 'ingest.add': {
      const urls = String(intent.args.urls ?? '').split(/\s+/).filter(Boolean)
      const adminClient = createAdminClient() as any
      const accepted: string[] = []
      const rejected: string[] = []

      for (const raw of urls) {
        const link = parseContentUrl(raw)
        if (!link) { rejected.push(raw); continue }
        const { data: existing } = await adminClient.from('ci_contents').select('id')
          .eq('workspace_id', ws).eq('platform', link.platform)
          .eq('external_id', link.externalId).is('deleted_at', null).maybeSingle()

        let id = existing?.id ?? null
        if (!id) {
          const { data: created } = await adminClient.from('ci_contents').insert({
            workspace_id: ws, platform: link.platform, external_id: link.externalId,
            canonical_url: link.canonicalUrl, format: link.formatHint ?? 'long',
            source: 'inbox', ingest_status: 'queued', created_by: input.userId,
          }).select('id').single()
          id = created?.id ?? null
        }
        if (id) {
          await enqueueJob({
            workspaceId: ws, stage: 'ingest', targetType: 'content',
            targetId: id, version: Date.now(),
          })
          accepted.push(raw)
        } else rejected.push(raw)
      }

      return {
        say: `${accepted.length}건 수집을 시작했습니다`,
        command: intent.command, executed: true, suggestion: null, href: '/ci/inbox',
        lines: [
          ...accepted.map((u) => ({ label: '수집 시작', detail: u })),
          ...rejected.map((u) => ({ label: '지원하지 않는 주소', detail: u })),
        ],
      }
    }
    case 'channel.track': {
      const r = await addChannel({
        workspaceId: ws, urlOrHandle: String(intent.args.input ?? ''), monitor: true,
      })
      if (!r.ok) {
        return {
          say: r.message, command: intent.command, executed: false,
          suggestion: null, lines: [], href: '/ci/monitoring',
        }
      }
      return {
        say: `${r.item.displayName}을(를) 관심 채널로 등록했습니다`,
        command: intent.command, executed: true, suggestion: null, href: '/ci/monitoring',
        lines: [{ label: r.item.displayName, detail: r.created ? '새로 등록' : '이미 있어 모니터링만 켰습니다' }],
      }
    }
    case 'idea.create': {
      const title = String(intent.args.title ?? '').trim()
      if (!title) return notUnderstood()
      const adminClient = createAdminClient() as any
      const { data } = await adminClient.from('ci_ideas').insert({
        workspace_id: ws, title, stage: 'idea', created_by: input.userId,
      }).select('id').single()
      return {
        say: `"${title}" 아이디어를 만들었습니다`,
        command: intent.command, executed: Boolean(data), suggestion: null,
        href: '/ci/pipeline', lines: [],
      }
    }
    default:
      return notUnderstood()
  }
}
