// lib/ci/ai/assistant-server.ts — 어시스턴트 실행 (서버 전용)
// 어시스턴트는 API를 우회하지 않는다. 같은 조회·쓰기 경로를 그대로 쓴다.

import { createAdminClient } from '@/lib/supabase/server'
import { getCommand, isExecutable, parseIntent, type Intent } from './assistant.ts'
import { listContents } from '../queries/contents.ts'
import { listChannels } from '../queries/channels.ts'
import { listIdeas } from '../queries/ideas.ts'
import { getMarketOverview, getPatterns, getSignals } from '../queries/trends.ts'
import { getMinePerformance } from '../queries/performance.ts'
import { addChannel } from '../queries/channels.ts'
import { parseContentUrl } from '../ucm/url.ts'
import { enqueueJob } from '../jobs/queue.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  lines: AssistantLine[]
  href: string | null
}

function notUnderstood(): AssistantReply {
  return {
    say: '무슨 뜻인지 확실하지 않아 아무것도 실행하지 않았습니다.',
    command: null,
    executed: false,
    suggestion: null,
    lines: [
      { label: '"이번 주 떡상 보여줘"' },
      { label: '"수집함 보여줘"' },
      { label: '링크를 그대로 붙여넣기' },
      { label: '"관심 채널 목록"' },
    ],
    href: null,
  }
}

export async function runAssistant(input: {
  workspaceId: string
  userId: string
  message: string
  route: string
}): Promise<AssistantReply> {
  const intent: Intent | null = parseIntent(input.message)
  if (!intent) return notUnderstood()

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
      const windowDays = Number(intent.args.windowDays ?? 28)
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
