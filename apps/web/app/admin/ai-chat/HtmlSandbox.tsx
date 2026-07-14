'use client'

// 세션 3 §2-4 — HTML/SVG artifact 격리 프리뷰.
// 보안 계약(DC-SEC 집중): opaque origin(allow-same-origin 금지) + srcDoc 선두 CSP 주입.
//  - sandbox="allow-scripts"만 부여 → 부모 쿠키/localStorage/DOM 접근 불가, 팝업/탑네비 탈출 불가.
//  - CSP default-src 'none' + connect-src 'none' → 외부 요청(데이터 유출·SSRF성 fetch) 원천 차단.
//  - referrerPolicy="no-referrer" → 레퍼러 누출 차단.
// 다른 props/postMessage 브리지 없음(최소권한).

interface Props {
  html: string
}

// §2-4 정확한 CSP 문자열 (변경 금지 — 보안 계약)
const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">`

export default function HtmlSandbox({ html }: Props) {
  return (
    <iframe
      className="artifact-sandbox"
      title="Artifact 미리보기"
      sandbox="allow-scripts"
      srcDoc={CSP + html}
      referrerPolicy="no-referrer"
    />
  )
}
