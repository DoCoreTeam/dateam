// lib/ci/assets/drive-link.ts — 구글드라이브 주소에서 파일 ID 뽑기 (SSOT)
//
// 왜 이 파일이 필요한가:
// 자료 업로드는 100MB에서 막히고, 그 오류 문구가 스스로 이렇게 안내한다 —
// "더 큰 영상은 드라이브에 직접 올린 뒤 링크로 등록해 주세요".
// 그런데 그렇게 등록하면 주소만 남고 **파일 ID가 저장되지 않아**,
// 이미 있는 스트리밍 경로(/api/ci/assets/[id]/file)를 탈 수 없었다.
// 즉 제품이 시킨 대로 했을 때 편집점 분석이 불가능해지는 상태였다.
//
// 파일 ID 하나만 저장하면 그 사슬이 이어진다. 원본은 여전히 드라이브에 있고
// 우리는 주소와 ID만 갖는다 — "원본을 우리 서버에 쌓지 않는다"는 원칙 그대로다.

/** 드라이브 파일 ID 문자 집합. 길이는 시대별로 달라서 하한만 둔다. */
const FILE_ID = /^[A-Za-z0-9_-]{12,}$/

/** 파일이 아닌 것들 — 폴더·검색 결과에는 내려받을 원본이 없다. */
const NON_FILE_SEGMENTS = new Set(['folders', 'drive', 'search', 'my-drive'])

function isDriveHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return h === 'drive.google.com'
    || h === 'docs.google.com'
    || h === 'drive.usercontent.google.com'
}

/**
 * 드라이브 주소에서 파일 ID를 뽑는다. 드라이브가 아니거나 파일이 아니면 null.
 *
 * 받는 형태:
 *   /file/d/{id}/view · /document/d/{id}/edit · /presentation/d/{id}
 *   ?id={id}  (open·uc·download)
 */
export function parseDriveFileId(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (!isDriveHost(u.hostname)) return null

  const seg = u.pathname.split('/').filter(Boolean)

  // /{종류}/d/{id}/... — file, document, spreadsheets, presentation 모두 같은 모양이다
  const dIndex = seg.indexOf('d')
  if (dIndex >= 0 && seg[dIndex + 1]) {
    const id = seg[dIndex + 1]
    if (FILE_ID.test(id)) return id
  }

  // 폴더·드라이브 루트는 파일이 아니다
  if (seg.some((s) => NON_FILE_SEGMENTS.has(s)) && dIndex < 0) return null

  const byQuery = u.searchParams.get('id')
  if (byQuery && FILE_ID.test(byQuery)) return byQuery

  return null
}

/** 드라이브 주소인가 — 파일 ID를 못 뽑아도 출처 표기에는 쓴다. */
export function isDriveUrl(raw: string): boolean {
  try {
    return isDriveHost(new URL(raw.trim()).hostname)
  } catch {
    return false
  }
}
