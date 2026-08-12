// lib/ui/nav-anchor.ts — "이 앵커 클릭이 실제 라우트 이동인가" 판정 SSOT.
//
// 왜: 화면 전체를 덮는 라우트 전환 로더는 이동이 끝나면 pathname 변화로 꺼진다.
// 그래서 이동이 아닌 클릭에 로더를 켜면 끌 신호가 영영 안 와서 화면이 잠긴다.
// (실제 사고: 회의록 PDF 내보내기가 만드는 `blob:` 다운로드 앵커를 이동으로 오인 —
//  옛 가드가 `href.startsWith('http')`만 봐서 `blob:http://...`를 통과시켰다.
//  앱 전체에 blob 다운로드가 18곳 있어 전부 같은 증상이었다.)
//
// 판정은 화이트리스트로 한다. 내부 경로(`/...`)만 이동이고 나머지는 전부 아니다 —
// blob:·data:·tel:·ftp: 같은 스킴을 블랙리스트로 쫓아다니면 또 빠뜨린다.

export interface NavAnchorClick {
  /** 앵커의 href 원문 (getAttribute 값 — 정규화된 .href 아님) */
  href: string | null
  /** download 속성 보유 여부 — 다운로드는 이동이 아니다 */
  hasDownload: boolean
  /** target 속성 (_blank면 현재 탭은 그대로) */
  target?: string | null
  /** 현재 pathname — 같은 경로면 이동이 없다 */
  pathname: string
  /** 새 탭/새 창으로 열리는 보조 클릭인가 (⌘·Ctrl·Shift·Alt·가운데 버튼) */
  opensElsewhere?: boolean
  /** 이미 다른 핸들러가 막은 클릭인가 */
  defaultPrevented?: boolean
}

/** 이 클릭이 현재 탭의 라우트 이동을 일으키는가. 확실할 때만 true. */
export function isRouteNavigationClick(c: NavAnchorClick): boolean {
  if (c.defaultPrevented) return false
  if (c.opensElsewhere) return false          // 새 탭으로 열리면 이 탭 pathname은 안 바뀐다
  if (c.hasDownload) return false             // 파일 저장 — 이동 아님
  if (c.target === '_blank') return false

  const href = c.href
  if (!href) return false
  if (!href.startsWith('/')) return false     // 내부 경로만 이동(외부·blob·data·tel·mailto 전부 제외)
  if (href.startsWith('//')) return false     // protocol-relative = 외부

  return href.split(/[?#]/)[0] !== c.pathname // 같은 경로면 이동 없음
}
