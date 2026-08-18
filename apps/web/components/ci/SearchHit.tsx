// components/ci/SearchHit.tsx — 검색 결과가 "왜 걸렸는지" 표시 (전 화면 공용)
//
// 왜 부품인가: 수집함·트렌드·성과 어디서 검색하든 같은 말을 해야 한다.
// 화면마다 다르게 그리면 "영상 대사"가 어디선 '대사', 어디선 '자막'이 된다.
//
// 왜 필요한가: 검색은 제목·설명뿐 아니라 **영상에서 읽은 대사·화면 자막**까지 본다.
// 그래서 제목 어디에도 없는 말로 검색해도 결과가 나온다 —
// 이유를 안 보여주면 사용자는 제품이 엉뚱한 걸 찾았다고 읽는다.
// (실측: '우니'로 검색하니 제목에 없는 게시물이 나왔는데 설명문 138번째 글자였다)

import styles from './search-hit.module.css'

interface Props {
  /** 걸린 자리를 사람 말로 — '제목' · '영상 대사' … */
  matchedIn: string | null | undefined
  /** 검색어 주변을 잘라낸 문구 */
  snippet: string | null | undefined
}

export default function SearchHit({ matchedIn, snippet }: Props) {
  if (!matchedIn) return null
  return (
    <span className={styles.hit}>
      <span className={styles.where}>{matchedIn}</span>
      {snippet && <span className={styles.snippet}>{snippet}</span>}
    </span>
  )
}
