// 목록 심층분석 v2 — 세션 확장필드(phase/control/synth_status/synth_text/coverage/command) 조회.
// session-actions.ts의 getAnalysisSession()은 §G(v1) 계약이라 세션 자체는
// {id, sourceText, lens, sourceKind}까지만 반환하고 항목(idx/text/status/resultText)만 내려준다.
// v2 확장 컬럼(161_ai_analysis_v2.sql)까지 노출하도록 그 파일을 고치는 대신 —
// 같은 테이블이 이미 157_ai_analysis_sessions.sql에서 RLS(admin+owner, to authenticated)로
// 보호돼 있으므로, 여기서는 브라우저 Supabase 클라이언트(SSOT: lib/supabase/client.ts)로
// 같은 세션 행을 owner 범위 내에서 읽기만 한다(재사용 정책 — import·호출만, 신규 파일 추가).
'use client'

import { createClient } from '@/lib/supabase/client'
import type { AnalysisSessionControl, AnalysisSynthStatus } from './session-actions'

export interface SessionCoverage {
  total: number
  covered: number[]
  missing: number[]
  appended: number[]
}

export interface SessionExtras {
  phase: string
  control: AnalysisSessionControl
  synthStatus: AnalysisSynthStatus
  synthText: string | null
  coverage: SessionCoverage | null
  command: string
}

interface ExtrasRow {
  phase: string | null
  control: AnalysisSessionControl | null
  synth_status: AnalysisSynthStatus | null
  synth_text: string | null
  coverage: SessionCoverage | null
  command: string | null
}

/** 생성된 Database 타입에 v2 확장 컬럼이 아직 없어(157 최초 스키마 기준) 조회 1회만 any 캐스팅. */
export async function getSessionExtras(sessionId: string): Promise<SessionExtras | null> {
  const supabase = createClient()
  const { data, error } = await (
    supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => { single: () => Promise<{ data: ExtrasRow | null; error: unknown }> }
        }
      }
    }
  )
    .from('ai_analysis_sessions')
    .select('phase, control, synth_status, synth_text, coverage, command')
    .eq('id', sessionId)
    .single()

  if (error || !data) return null
  return {
    phase: data.phase ?? 'idle',
    control: data.control ?? 'running',
    synthStatus: data.synth_status ?? 'pending',
    synthText: data.synth_text ?? null,
    coverage: data.coverage ?? null,
    command: data.command ?? '',
  }
}
