import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Profile } from '@/types/database'

const BUCKET = 'branding'
const MAX_BYTES = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']

export async function POST(req: NextRequest) {
  // 인증 확인
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // admin 권한 확인
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = createAdminClient() as any
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single() as { data: Pick<Profile, 'role'> | null }

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await req.formData()
  const brandName = formData.get('brandName') as string | null
  const logoFile = formData.get('logoFile') as File | null
  const deleteLogo = formData.get('deleteLogo') === 'true'

  // 현재 logo_path 조회 (구 파일 삭제용)
  const { data: currentRows } = await adminClient
    .from('system_settings')
    .select('key, value')
    .in('key', ['logo_path'])
  const currentPath = (currentRows as { key: string; value: string | null }[] | null)
    ?.find((r) => r.key === 'logo_path')?.value ?? null

  let newLogoPath = currentPath

  // 로고 삭제 요청
  if (deleteLogo) {
    if (currentPath) {
      await adminClient.storage.from(BUCKET).remove([currentPath])
    }
    newLogoPath = null
  }

  // 새 로고 업로드
  if (logoFile && !deleteLogo) {
    if (!ALLOWED_TYPES.includes(logoFile.type)) {
      return NextResponse.json({ error: '허용되지 않는 파일 형식입니다 (PNG/JPG/SVG/WebP만 가능)' }, { status: 400 })
    }
    if (logoFile.size > MAX_BYTES) {
      return NextResponse.json({ error: '파일 크기가 2MB를 초과합니다' }, { status: 400 })
    }

    const ext = logoFile.name.split('.').pop() ?? 'png'
    const path = `logo/logo-${Date.now()}.${ext}`
    const buffer = Buffer.from(await logoFile.arrayBuffer())

    // 버킷이 없으면 생성 시도
    const { error: bucketErr } = await adminClient.storage.getBucket(BUCKET)
    if (bucketErr) {
      await adminClient.storage.createBucket(BUCKET, { public: true })
    }

    const { error: uploadErr } = await adminClient.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: logoFile.type, upsert: false })

    if (uploadErr) {
      return NextResponse.json({ error: `업로드 실패: ${uploadErr.message}` }, { status: 500 })
    }

    // 구 파일 삭제
    if (currentPath && currentPath !== path) {
      await adminClient.storage.from(BUCKET).remove([currentPath])
    }

    newLogoPath = path
  }

  // system_settings upsert
  const upsertRows: { key: string; value: string | null; updated_by: string }[] = []

  if (brandName !== null && brandName.trim().length > 0) {
    upsertRows.push({ key: 'brand_name', value: brandName.trim().slice(0, 30), updated_by: user.id })
  }

  if (deleteLogo || logoFile) {
    upsertRows.push({ key: 'logo_path', value: newLogoPath, updated_by: user.id })
  }

  if (upsertRows.length > 0) {
    await adminClient
      .from('system_settings')
      .upsert(upsertRows, { onConflict: 'key' })
  }

  revalidatePath('/', 'layout')

  // 응답용 logoUrl 계산
  let logoUrl: string | null = null
  if (newLogoPath) {
    const { data: urlData } = adminClient.storage.from(BUCKET).getPublicUrl(newLogoPath)
    logoUrl = urlData?.publicUrl ?? null
  }

  return NextResponse.json({ success: true, logoUrl })
}
