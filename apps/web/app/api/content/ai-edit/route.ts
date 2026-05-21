import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { aiEditContentSection, type ColumnSchema } from '@/lib/gemini-content-edit'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = createAdminClient() as any
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다' }, { status: 403 })
  }

  let body: {
    sectionName?: string
    columns?: ColumnSchema[]
    currentData?: unknown[]
    prompt?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const { sectionName, columns, currentData, prompt } = body
  if (!sectionName || !Array.isArray(columns) || !Array.isArray(currentData) || !prompt?.trim()) {
    return NextResponse.json({ error: '필수 파라미터가 누락되었습니다' }, { status: 400 })
  }

  const { data: metaRow } = await adminClient
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()

  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI 키가 설정되지 않았습니다 (API 설정에서 Gemini 키를 등록하세요)' },
      { status: 500 }
    )
  }

  try {
    const result = await aiEditContentSection(
      sectionName,
      columns,
      currentData as Record<string, unknown>[],
      prompt,
      apiKey,
      model
    )
    return NextResponse.json({ data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI 편집 중 오류가 발생했습니다'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
