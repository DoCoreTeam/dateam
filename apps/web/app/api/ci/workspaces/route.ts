import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { listCiWorkspaces, CI_WORKSPACE_COOKIE } from '@/lib/ci/workspace'

/* eslint-disable @typescript-eslint/no-explicit-any */

const CreateBody = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().min(1).max(60).optional(),
  defaultTopicName: z.string().trim().min(1).max(40).optional(),
})

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '')
  return (base || 'ws') + '-' + Math.random().toString(36).slice(2, 7)
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fail('UNAUTHORIZED', '인증이 필요합니다')

    return ok(await listCiWorkspaces(user.id))
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return fail('UNAUTHORIZED', '인증이 필요합니다')

    const parsed = CreateBody.safeParse(await req.json())
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)
    }
    const { name, defaultTopicName } = parsed.data
    const slug = parsed.data.slug ?? slugify(name)

    const adminClient = createAdminClient() as any

    const { data: ws, error: wsErr } = await adminClient
      .from('ci_workspaces')
      .insert({ name, slug, owner_id: user.id })
      .select('id, name, slug')
      .single()

    if (wsErr || !ws) return fail('CONFLICT', '같은 이름의 워크스페이스가 이미 있습니다')

    // 생성자를 owner로. 실패하면 워크스페이스만 남아 아무도 못 들어가므로 되돌린다.
    const { error: memberErr } = await adminClient
      .from('ci_workspace_members')
      .insert({ workspace_id: ws.id, user_id: user.id, role: 'owner' })

    if (memberErr) {
      await adminClient.from('ci_workspaces').delete().eq('id', ws.id)
      return fail('INTERNAL', '워크스페이스를 만들지 못했습니다')
    }

    // 콜드 스타트: 주제를 받았으면 함께 만든다
    if (defaultTopicName) {
      const { data: topic } = await adminClient.from('ci_topics').insert({
        workspace_id: ws.id,
        name: defaultTopicName,
        slug: defaultTopicName.toLowerCase().replace(/\s+/g, '-'),
      }).select('id').single()
      if (topic?.id) {
        await adminClient.from('ci_workspaces')
          .update({ default_topic_id: topic.id }).eq('id', ws.id)
      }
    }

    // 무료 플랜 구독을 붙인다 — 요금 설정을 건드리지 않아도 동작해야 한다
    const { data: freePlan } = await adminClient
      .from('ci_plans').select('id').eq('code', 'free').maybeSingle()
    if (freePlan?.id) {
      await adminClient.from('ci_subscriptions')
        .insert({ workspace_id: ws.id, plan_id: freePlan.id, status: 'trial' })
    }

    const res = NextResponse.json({ success: true, data: { ...ws, role: 'owner' } })
    res.cookies.set(CI_WORKSPACE_COOKIE, ws.id, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
    })
    return res
  } catch (e) {
    return failUnexpected(e)
  }
}
