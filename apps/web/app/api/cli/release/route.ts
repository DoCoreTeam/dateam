// GET /api/cli/release — 지금 내려줄 teamda 판과 운영체제별 받기 주소
//
// 개발자센터 CLI 절의 받기 단추와 teamda release 가 같은 이 창구를 부른다 (meta.cli.release.get)
// 받기 주소는 그때그때 600초짜리 서명 주소로 만든다, 공개 주소를 두면 한 번 새면 영원히 열려 있다
//
// 보안 (LOOP.md 7절)
//   사람 확인이 먼저다, getUser 가 없으면 401 이고 서비스롤은 그 뒤에만 쓴다
//   버킷은 비공개이고 정책이 없어 서버만 읽는다 (마이그레이션 319)
//   latest.json 은 바깥 값으로 본다, parseManifest 가 v버전/파일이름 꼴만 통과시킨다
import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { MANIFEST_PATH, RELEASE_BUCKET, SIGNED_URL_TTL_SECONDS, parseManifest } from '@/lib/cli-release/manifest'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = (createAdminClient() as any).storage.from(RELEASE_BUCKET)

  const listed = await storage.list('', { search: MANIFEST_PATH, limit: 10 })
  if (listed.error) {
    console.error('[api/cli/release] list', listed.error)
    return NextResponse.json({ error: '판 목록을 읽지 못했습니다' }, { status: 500 })
  }
  const hasManifest = (listed.data ?? []).some((o: { name?: string }) => o.name === MANIFEST_PATH)
  if (!hasManifest) return NextResponse.json({ release: null })

  const downloaded = await storage.download(MANIFEST_PATH)
  if (downloaded.error || !downloaded.data) {
    console.error('[api/cli/release] download', downloaded.error)
    return NextResponse.json({ error: '판 목록을 읽지 못했습니다' }, { status: 500 })
  }

  let raw: unknown
  try {
    raw = JSON.parse(await downloaded.data.text())
  } catch {
    raw = null
  }
  const parsed = parseManifest(raw)
  if (!parsed.ok) {
    console.error('[api/cli/release] manifest', parsed.reason)
    return NextResponse.json({ error: '판 목록 형식이 맞지 않습니다' }, { status: 500 })
  }

  const { manifest } = parsed
  const signed = await storage.createSignedUrls(manifest.files.map((f) => f.path), SIGNED_URL_TTL_SECONDS)
  if (signed.error || !Array.isArray(signed.data)) {
    console.error('[api/cli/release] sign', signed.error)
    return NextResponse.json({ error: '받기 주소를 만들지 못했습니다' }, { status: 500 })
  }
  const urlOf = new Map<string, string>()
  for (const s of signed.data as Array<{ path: string | null; signedUrl: string | null; error: string | null }>) {
    if (s.path && s.signedUrl && !s.error) urlOf.set(s.path, s.signedUrl)
  }
  const files = manifest.files.map((f) => ({
    target: f.target, fileName: f.fileName, size: f.size, sha256: f.sha256, url: urlOf.get(f.path) ?? null,
  }))
  if (files.some((f) => f.url === null)) {
    console.error('[api/cli/release] sign missing', files.filter((f) => !f.url).map((f) => f.fileName))
    return NextResponse.json({ error: '받기 주소를 만들지 못했습니다' }, { status: 500 })
  }

  return NextResponse.json({
    release: {
      version: manifest.version,
      publishedAt: manifest.publishedAt,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      files,
    },
  })
}
