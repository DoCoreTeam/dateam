/**
 * `server-only` 자리 채우개 — **운영 코드가 아니라 스크립트용이다**
 *
 * `lib/trading/**` 의 서버 모듈은 맨 위에 `import 'server-only'` 를 둔다. 그 줄은
 * 서비스롤 키를 다루는 모듈이 클라이언트 번들로 새는 것을 막는 장치이고(보안 S3),
 * Next 가 빌드할 때 해석한다 — 설치된 패키지가 아니다.
 *
 * 그래서 Node 로 같은 모듈을 부르는 스크립트는 그 이름을 못 찾는다.
 * 여기 빈 모듈을 두고 `scripts/tsconfig.json` 이 그 이름을 이리로 돌린다.
 * **운영 번들은 이 파일을 안 지난다** — `scripts/**` 는 tsconfig include 밖이다.
 */
export {}
