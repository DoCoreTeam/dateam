import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateWeeklyFromDailyTasks, type DailyTaskInput } from '@/lib/gemini-daily-to-weekly'

function loadStyleGuide(): string {
  try {
    const filePath = join(process.cwd(), 'docs', 'weekly-report-ai-style.md')
    return readFileSync(filePath, 'utf-8')
  } catch {
    return '일일업무를 구분별로 묶어 성과/계획/이슈 형식의 주간보고로 변환하라.'
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { tasks?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })
  }

  if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
    return NextResponse.json({ error: '선택된 업무가 없습니다' }, { status: 400 })
  }

  const tasks: DailyTaskInput[] = (body.tasks as unknown[]).map((t) => {
    const item = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>
    return {
      content: typeof item.content === 'string' ? item.content : '',
      entry_type: typeof item.entry_type === 'string' ? item.entry_type : 'done',
      log_date: typeof item.log_date === 'string' ? item.log_date : '',
      is_resolved: typeof item.is_resolved === 'boolean' ? item.is_resolved : false,
      priority: typeof item.priority === 'string' ? item.priority : 'normal',
    }
  }).filter((t) => t.content.trim() !== '')

  if (tasks.length === 0) {
    return NextResponse.json({ error: '유효한 업무 내용이 없습니다' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaRow } = await (createAdminClient() as any)
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()

  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) {
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다 (관리자에게 문의)' }, { status: 500 })
  }

  const styleGuide = loadStyleGuide()

  try {
    const rows = await generateWeeklyFromDailyTasks(tasks, styleGuide, apiKey, model, user.id)
    return NextResponse.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI 생성 중 오류가 발생했습니다'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
