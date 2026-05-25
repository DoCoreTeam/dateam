import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildDocx } from '@/lib/docx-builder'
import { Packer } from 'docx'
import { z } from 'zod'

const rowSchema = z.object({
  userName: z.string().max(200).optional().default(''),
  orgName: z.string().max(200),
  category: z.string().max(100),
  performance: z.string().max(20000),
  plan: z.string().max(20000),
  issues: z.string().max(20000),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
const bodySchema = z.object({ rows: z.array(rowSchema).min(1).max(500) })

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single() as unknown as { data: { role: string } | null }

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'rows가 비어있거나 올바르지 않습니다' }, { status: 400 })
    }
    const { rows } = parsed.data

    const { doc, filename } = buildDocx(rows)
    const buffer = await Packer.toBuffer(doc)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '서버 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
