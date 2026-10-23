## 필수 규칙: 모든 기능은 CLI 로도 된다 (예외 없음)
- teamda 의 모든 기능은 웹과 똑같이 `teamda` CLI 에서도 되어야 한다. 지금 있는 기능도, 앞으로 만드는 기능도 전부다
- 기능을 추가·변경할 때는 공통 기능 정의(입출력 스키마·범위·처리 함수)에만 만든다. 웹 전용 처리 함수, 정의를 거치지 않는 라우트·서버 액션은 만들지 않는다
- 같은 PR 에 ① 정의 ② 생성된 openapi.json·CLI ③ docs/cli/02-기능대응표.md 갱신 ④ 웹=CLI 시험을 넣는다
- CLI 명령이 없는 기능 PR 은 CI(`cli-parity`) 에서 실패하고 병합할 수 없다. 이 검사를 끄거나 건너뛰거나 예외 목록에 넣지 않는다
- 웹에만 둘 수 있는 것은 로그인·비밀번호·2단계 인증 화면뿐이다. 그 밖의 예외는 저장소 주인(김도현 상무)의 서면 승인과 대응표의 사유가 있어야 한다

# 기여 안내

- 작업 규정 전체는 LOOP.md, 중량 규정은 .claude/heavy/CEO.md
- 기능 정의는 apps/web/lib/actions/defs/, 생성은 node --experimental-strip-types scripts/cli/gen.mjs, 검사는 node --experimental-strip-types scripts/cli-parity-check.mjs
- CLI 는 packages/teamda-cli, 시험은 그 폴더에서 bun test
