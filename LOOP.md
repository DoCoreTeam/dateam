# LOOP.md v0.1.0 경량 자율개발 루프 프로토콜

이 파일은 매 세션 로드되는 유일한 작업 규정
프로젝트 고유 관례는 하단 부록에만 추가하고 본문은 손대지 않음
중량 규정(기존 CEO 체계)은 .claude/heavy/CEO.md 에 두고 모드가 중량인 항목에서만 읽음

## 0 상태와 도구

- 유일한 재개 근거: .loop/PLAN.md, 컨텍스트가 초기화되어도 이 파일만으로 다음 항목부터 이어감
- 기록 CLI: node scripts/loop.mjs (아래에서 loop 로 표기), 지시 개입 구현 기록은 .loop/loop.db 에 저장
- 훅이 자동 기록하는 것: 사용자 프롬프트(지시 또는 개입), 파일 편집, 세션 시작, 컨텍스트 압축
- 에이전트가 직접 기록하는 것: loop plan new, plan check, plan confirm, plan revise, start, pass, fail, hold, final
- 세션 시작 직후와 컨텍스트 정리 직후 첫 행동: loop resume 출력 확인 (훅이 자동 출력, 보이지 않으면 직접 실행)

## 1 루프 1 계획 우선 실행

새 지시를 받으면 코드에 손대기 전에 아래 순서로 진행

1 loop resume 으로 활성 플랜 유무 확인, 활성 플랜이 있으면 새 지시는 개입으로 취급하고 2절 개입 처리 적용
2 loop plan new --title "제목" --instruction ins_xxxx --target vX.Y.Z 실행 (ins 번호는 훅 출력에 있음, 목표 버전 셈법은 부록 「버전 규칙」 한 곳에만 있음, 여기서 따로 정하지 않음)
3 .loop/PLAN.md 의 목표, 범위 밖, 완료 정의, 참조, 항목을 작성
4 loop plan check 가 통과할 때까지 수정
5 plan_confirm 설정이 true 이면 플랜 요약(항목 수, 목표 버전, 범위 밖)을 사용자에게 보이고 응답을 기다린 뒤 확인을 받고 loop plan confirm
6 plan_confirm 설정이 false 이면 즉시 loop plan confirm

항목 작성 규칙

- 한 항목은 한 번의 자가감사로 판정 가능한 단위 (변경 파일 5개 이내, 감사 기준 1개 이상 4개 이하 권장)
- 범위: 변경할 파일 또는 디렉터리 나열, 신규 파일은 "신규" 표기
- 감사 기준: 실행 가능한 명령과 기대 결과 또는 관측 가능한 조건만 기재, "잘 동작함" 같은 추상 표현 금지
- 의존: 선행 항목 ID, 없으면 "없음"
- 모드: 경량이 기본, 결제 인증 권한 데이터 삭제 외부 API 비밀 취급 항목은 중량
- 보안: 범위가 7절 「닿는 자리」에 걸리면 감사 기준에 보안 줄을 최소 하나 넣음, loop plan check 가 없으면 통과시키지 않음
- 순서: 스키마, 서버, 화면, 다국어, 문서 순이 기본이고 의존 관계가 순서를 결정
- 삽입 항목 ID 는 앞 항목 번호에 소문자를 붙임 (I03 뒤 삽입은 I03a), 기존 번호 재부여 금지
- 항목 삭제는 상태를 취소 (사유) 로 바꾸고 줄은 남김

## 2 루프 2 항목 구현과 자가감사

항목마다 아래를 반복하고 통과 전에는 다음 항목에 손대지 않음

1 loop start Ixx 실행, 출력된 항목 블록의 범위와 감사 기준을 작업 기준으로 삼음, 중량 모드면 heavy_doc 를 먼저 읽음
2 범위 안에서 구현
3 자가감사 7항 실행, a 를 먼저 함
  a 보안: 7절 세 질문에 답하고 해당하는 줄을 실제로 확인, 해당 없으면 「해당 없음」을 근거와 함께 기록
  b 범위 일치: git status 의 변경 파일이 항목 범위와 일치, 범위 밖 변경은 되돌리거나 사유를 요약에 기록
  c 정적 검사: cmd_typecheck 통과, lint 설정이 있으면 cmd_lint 통과
  d 항목 감사 기준: 기준 줄마다 실제 실행 또는 확인, 근거를 한 줄씩 확보
  e 비밀과 설정: diff 에 키 토큰 비밀번호 없음, 새 설정값은 env 추가 대신 DB 저장과 UI 관리 (기존 env 키 재사용은 허용)
  f 다국어: 신규 사용자 노출 문자열은 전부 i18n 키, 기본 언어와 영어 메시지 파일 동시 갱신
  g 부작용: 다른 항목의 통과 조건을 깨뜨리지 않음, 관련 테스트 재실행
4 판정
  - 전부 충족: loop pass Ixx --summary "어떻게 구현했는지" --notes "감사 근거 요약", 커밋은 CLI 가 다음 패치 버전으로 자동 생성 (vX.Y.Z: 제목)
  - 항목 안에서 고칠 수 있는 미충족: loop fail Ixx --reason "사유" 기록, 수정 후 loop start Ixx 로 재착수하고 3으로
  - 플랜 자체를 바꿔야 하는 미충족: 5로
5 플랜 갱신 (루프의 본체)
  트리거
  - 선행 작업 누락 발견: 현재 항목 앞에 항목 삽입
  - 후속 작업 발견: 뒤에 항목 추가
  - 항목이 한 번에 감사 불가능할 만큼 큼: 둘 이상으로 분할
  - 감사 기준이 틀렸거나 부족: 기준 수정
  - 사용자 개입으로 범위 변경: 항목 추가 수정 취소
  - 외부 요인으로 진행 불가: loop hold Ixx --reason "사유"
  절차: PLAN.md 항목 수정, loop plan revise --level patch|minor --note "무엇을 왜" --ref audit:Ixx 또는 --ref iv_xxxx, 갱신된 플랜 기준으로 2절 계속
  버전 규칙: 항목 추가 수정 분할은 patch, 사용자 개입으로 목표나 범위가 바뀌면 minor
6 한계값 (loop config 로 조정)
  - max_audit_retries (기본 3): 같은 항목 시도 초과 시 loop hold 후 사용자에게 판단 요청
  - max_plan_revisions_per_item (기본 3): 같은 항목 기인 플랜 갱신 초과 시 사용자에게 판단 요청

개입 처리

- 사용자 프롬프트는 훅이 iv_xxxx 로 기록, 에이전트는 그 개입이 플랜을 바꾸는지 판단
- 바꾸면 5절 절차로 반영 (--ref iv_xxxx)
- 바꾸지 않으면 답변 후 계속, 항목 통과 시 CLI 가 자동으로 흡수 처리
- 현재 플랜과 무관한 새 기능 요청이면 현재 플랜 완료 후 새 플랜으로 분리할 것을 제안
- "멈춰" "중단" 계열이면 즉시 loop hold 또는 loop plan abort 후 이유 기록

## 3 컨텍스트 정리와 재개

- 정리 시점 두 가지: 도구의 자동 압축 (시점은 도구가 판단), 사용자의 수동 /clear
- 자동 압축 시점을 예측하지 않음, 대신 항목 통과마다 PLAN.md 가 최신이 되므로 언제 정리되어도 손실 없음
- loop pass 출력에 체크포인트와 /clear 권장이 나오면 사용자에게 그대로 전달 (checkpoint_every 개 통과마다 표시)
- 정리 후 재개 절차
  1 loop resume 출력 확인 (SessionStart 훅이 자동 출력)
  2 상태가 진행중인 항목이 있으면 구현 상태가 불명이므로 loop start Ixx --force 후 2절 3의 자가감사부터 다시 수행
  3 없으면 첫 대기 항목부터 2절
  4 플랜 파일과 DB 기록이 다르면 플랜 파일 우선
- 재개 시 이전 대화 내용을 추정하지 않음, 필요한 사실은 PLAN.md, git log, loop history 에서만 취함

## 4 종합 자가감사

전 항목 통과 후

1 cmd_typecheck, cmd_lint, cmd_test, cmd_build 전체 실행
2 완료 정의 각 줄 확인
3 전체 diff 검토: git diff <시작 커밋>..HEAD --stat (시작 커밋은 PLAN.md 헤더), 범위 밖 변경 없음, 비밀 없음, 하드코딩 문자열 없음
3a 보안 재측정: 7절 「기계가 세는 것」 다섯 줄을 실제로 실행하고 결과를 기록, 하나라도 0 이 아니면 pass 하지 않음
4 항목 대 결과 대조: 각 항목 범위의 파일이 실제로 존재하거나 변경됨
5 결과를 PLAN.md 종합 감사 절에 기록 (실행 명령과 결과, 발견 사항)
6 loop final --result pass --summary "요약", CLI 가 완료 커밋 태그 보관을 처리
7 미충족 발견 시 loop final --result fail --summary "사유" 기록 후 보완 항목을 plan revise 로 추가하고 2절로

## 5 중량 모드

- 모드가 중량인 항목은 start 시 heavy_doc (기본 .claude/heavy/CEO.md) 를 읽고 그 규정을 해당 항목에만 적용
- 중량 규정 적용 결과도 pass --notes 에 기록
- 경량 항목에서는 heavy_doc 를 읽지 않음

## 6 산출물과 문체

- 커밋 메시지: 항목 커밋과 완료 커밋 모두 vX.Y.Z: 제목 한 가지 형식 (CLI 자동), 항목 ID 는 메시지에 넣지 않음
- 문서 산출물: 개조식, 마침표 없는 종결, 가운뎃점 미사용, 이모지 미사용, 전각 대시 미사용, 버전 표기 v0.0.0
- 설정값은 env 추가 대신 DB 저장과 UI 관리

## 7 보안 기준

보안은 마지막에 보는 것이 아니라 착수할 때 보는 것
2026-09-20 실측: 표 여덟 개가 잠금 없이 열려 있었고 익명 키로 읽기 쓰기 지우기가 다 됐음
그중 다섯은 백업 사본이고, 사본을 뜨면 원본의 잠금이 안 따라옴
만든 사람이 규칙을 어긴 것이 아니라 그 자리에서 물어 주는 장치가 없었음
그래서 아래를 문서가 아니라 CLI 와 가드가 물음

### 세 질문

착수할 때 이 셋에 답함, 하나라도 예면 해당 줄이 감사 기준이 됨

1 새 데이터를 저장하나 (표 칼럼 버킷 파일)
2 새 창구를 여나 (라우트 서버 액션 공개 링크)
3 밖에서 온 값을 다루나 (사용자 입력 업로드 외부 API 응답)

### 닿는 자리

범위에 아래가 들어가면 loop plan check 가 보안 기준을 요구함, 없으면 플랜이 통과하지 않음

| 자리 | 물을 것 |
|---|---|
| supabase/migrations/ | RLS 를 같은 판에서 켰나, 사본도 켰나 |
| app/api/ | 누가 부를 수 있나, 서비스롤을 쓰면 그 위에 사람 확인이 있나 |
| middleware.ts | 어떤 경로가 게이트를 지나가게 되나 |
| lib/supabase/ | 서비스롤 키가 클라이언트로 샐 수 있나 |
| lib/auth/ lib/security/ | 권한 판정이 바뀌나 |
| next.config.js | 응답 헤더나 번들 경계가 바뀌나 |
| 저장소 업로드 첨부 | 올라온 파일을 누가 읽을 수 있나 |

### 규칙 여섯

S1 표를 만들면 같은 마이그레이션에서 RLS 를 켬
   사본(CREATE TABLE AS)은 원본 잠금을 안 물려받으므로 특히 켬
   정책 대상에 TO public 을 쓰지 않음, authenticated 이거나 실제 조건을 씀
   가드 apps/web/lib/policy/rls-baseline.test.ts

S2 라우트는 인증 장치를 부름
   정말 열어야 하면 api-auth-surface.test.ts 의 목록에 이유와 함께 적음
   서비스롤(createAdminClient)은 RLS 를 통째로 지나감, 쓰면 그 위에 반드시 사람 확인이 있어야 함
   로그인 없이 쓰기가 되는 창구는 속도 제한을 붙임 (lib/public-rate-limit)
   가드 apps/web/lib/policy/api-auth-surface.test.ts

S3 값이 새지 않게 함
   비밀은 코드에 안 적음, 새 설정은 env 추가 대신 DB 저장과 UI 관리
   있는지 없는지를 대답으로 알려 주지 않음 (이메일 열거), 새 신청이든 이미 있는 것이든 같은 대답
   오류 메시지에 내부 구조를 싣지 않음
   서비스롤 키를 다루는 모듈은 맨 위에 import 'server-only'

S4 남이 심은 것을 실행하지 않음
   사용자 HTML 은 sanitize 를 거치거나 escape 후에 조립함
   바깥 주소로 가는 요청은 lib/security/safe-fetch 를 씀 (SSRF)
   질의는 매개변수로 넘김, 문자열로 이어 붙이지 않음

S5 응답 헤더를 지움
   HSTS CSP frame-ancestors object-src base-uri form-action 은 한 벌
   가드 apps/web/lib/policy/security-headers.test.ts

S6 안 깨 본 가드는 가드가 아님
   보안 가드를 추가하면 일부러 깨뜨려 실패를 확인하고, 확인한 사실을 pass --notes 에 적음

### 기계가 세는 것

종합 감사에서 아래 다섯을 실제로 실행하고 결과를 PLAN.md 에 적음
전부 0 이어야 통과, 하나라도 0 이 아니면 그 자리에서 멈춤

1 RLS 꺼진 public 표
2 anon 이 INSERT UPDATE DELETE TRUNCATE 권한을 가진 표
3 TO public 에 USING (true) 인 읽기 또는 전체 정책
4 search_path 가 안 박힌 SECURITY DEFINER 함수
5 anon 이 읽을 수 있는 SECURITY DEFINER 뷰

세는 명령은 docs/policy/security.md 에 있음

### 발견했는데 지금 못 고치는 것

되돌릴 수 없는 데이터 변경만 사용자에게 묻고, 나머지는 고침
묻는 경우에도 무엇을 어떻게 되돌리는지 함께 적음
「나중에」로 미룬 보안 항목은 PLAN.md 에 보류로 남기고 사유를 적음, 조용히 넘어가지 않음

## 부록 프로젝트 관례

### 버전 규칙

화면에 뜨는 버전과 업데이트 내역은 루트 package.json 버전이 오를 때만 움직임
apps/web/next.config.js 가 그 값을 NEXT_PUBLIC_APP_VERSION 으로 넘기고
apps/web/scripts/changelog-gen.mjs 가 그 값보다 낮은 커밋을 전부 건너뜀

이 규칙은 새로 만든 것이 아니고 .claude/heavy/CEO.md 와 AGENTS.md 와 GEMINI.md 의
버전 업데이트 체크리스트를 loop 어법으로 옮긴 것임
LOOP.md 만 읽는 세션이 그 체크리스트를 볼 길이 없어 열일곱 커밋 동안 안 지켜졌음

다음 버전 셈법

- 커밋 전에 git log --oneline -5 로 최근 커밋의 버전을 먼저 봄
- 다음 버전은 package.json 버전과 최근 커밋 버전 중 큰 쪽에 patch 1 을 더한 값
- git log 를 안 보고 package.json 만 보고 정하지 않음, 그것이 버전 충돌의 원인
- patch 는 0 부터 999 까지, 넘으면 minor 를 1 올리고 patch 는 0
- **minor 는 patch 가 999 를 넘을 때만 오름**, 기능을 더했다고 올리지 않음
  「큰 일이니 minor」는 없음, 크기를 번호로 말하지 않고 업데이트 내역 글로 말함
- 이 규칙은 이 부록 한 곳에만 있음, 본문이나 다른 문서에 버전 셈법을 또 적지 않음

올릴 파일 여섯, 순서대로

1. 루트 package.json (단일 소스, apps/web/next.config.js 가 여기서 읽어 화면에 넣음)
2. apps/web/package.json
3. .claude/heavy/CEO.md 의 버전 줄
4. AGENTS.md 의 버전 줄
5. GEMINI.md 의 버전 줄
6. apps/web/lib/changelog/entries.ts (사용자 체감 변경이 있으면 맨 위에 이번 버전 블록)

앞 다섯은 apps/web/lib/policy/policy-sync.test.ts 가 이미 봄
여섯째와 버전 재사용은 apps/web/lib/policy/version-rule.test.ts 가 봄

loop 에서의 적용

- **항목 커밋도 한 판이다.** vX.Y.Z 형식으로 적고 패치를 1 올리며 버전 파일 다섯을 함께 올림
  -Ixx 꼬리를 붙이면 발행기가 그 커밋을 건너뛰어 사용자에게 영영 안 보인다 (사용자 지시 2026-09-14)
- 완료 커밋도 같은 형식이고, 사용자 체감 변경이 있으면 entries.ts 에 그 버전 블록을 씀
- 플랜 밖 단독 커밋도 같다, 앞 버전을 그대로 복사하면 그 커밋은 사용자에게 영원히 안 보임
- 동시에 도는 플랜은 목표 버전을 겹치지 않게 잡되 **patch 를 하나씩 나눠 가짐** (예: 셋이 동시면 0.10.1, 0.10.2, 0.10.3)
  세션마다 minor 를 통째로 집어가지 않음, 그것이 0.7.716 이 사흘 만에 0.10.0 이 된 원인임
  나눠 가진 뒤에는 플랜 파일 헤더의 목표 버전이 그 세션의 몫이고 남이 그 번호를 쓰지 않음
- 버전은 뒤로 가지 않음, 목표 버전이 현재보다 낮으면 package.json 을 고치지 않음
- 완료 커밋 버전도 플랜을 세울 때 잡은 목표값이 아니라 **그때 다시 계산한 다음 패치**임
  그 사이 항목 커밋들이 버전을 올려 두었을 수 있고, 목표값을 그대로 쓰면 같은 번호가 두 번 생긴다
- 이 셋은 commit-msg 훅(.githooks/commit-msg)이 커밋 전에 막음, 테스트는 커밋 뒤에야 돌기 때문
  훅을 쓰려면 git config core.hooksPath .githooks (클론마다 한 번)
- 예외 하나, 지난 판의 밀린 발행을 되살리는 항목은 플랜 도중이라도 여섯 파일을 올림, 이번 플랜의 일이 아니라 이미 나간 것을 사용자에게 보이게 하는 일이므로 항목에 그 사유를 적음

### 그 밖

- 패키지 매니저 pnpm, 테스트는 apps/web/package.json 의 test 스크립트 한 줄에 등재해야 실제로 돎
- 옆 플랜 파일을 쓸 때는 LOOP_PLAN_FILE 로 지정 (예: LOOP_PLAN_FILE=PLAN.P0003.md node scripts/loop.mjs resume)
