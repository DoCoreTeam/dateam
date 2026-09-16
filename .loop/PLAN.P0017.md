# PLAN newAX: 공고 링크만 붙여넣어도 케이스가 된다

플랜 ID: P0017
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0013
목표 버전: v0.10.85
작성: 2026-09-16
시작 커밋: 6549dbae

## 목표
- 공고 올리기 화면에서 개별 공고 링크를 붙여넣으면 첨부를 시스템이 받아 와 케이스가 된다
- 붙여넣은 뒤 무엇을 찾았는지(사업명, 첨부 몇 건) 분석 시작 전에 보인다
- 못 찾으면 왜 못 찾았는지와 그 공고를 직접 열 주소를 준다, 빈 리포트를 만들지 않는다

## 범위 밖
- 레이더(자동 훑기) 규칙과 사이트 등록은 손대지 않음
- 로그인이 필요한 공고 사이트의 인증 통과는 하지 않음
- 나라장터 연동 키 발급과 설정 화면은 이미 있는 것을 씀

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 lib/rfp/terms.ts 상수 사용, 화면에 한글 직접 금지
- 설정값 추가 없음 (나라장터 키는 기존 org_content META 재사용)
- 링크 한 줄로 케이스가 만들어지고 첨부가 붙는다

## 참조
- apps/web/app/api/rfp/sources/[id]/adopt/route.ts (공고를 케이스로 만드는 기존 경로)
- apps/web/lib/rfp/radar/attachments-from-page.ts, detail-url.ts, site-collect.ts (쪽에서 첨부 찾기)
- apps/web/lib/rfp/g2b/client.ts, attachments.ts (나라장터 공고번호 조회와 첨부 칸)
- apps/web/lib/rfp/terms.ts RFP_INTAKE (noticeNoLabel 등 이미 있으나 쓰는 곳 0)

## 항목

### I01 링크를 읽는 규칙
상태: 통과
모드: 경량
범위:
- apps/web/lib/rfp/intake/notice-url.ts (신규)
- apps/web/lib/rfp/intake/notice-url.test.ts (신규)
- apps/web/package.json (test 스크립트 등재)
감사 기준:
- pnpm --filter web test 에서 notice-url 테스트가 실제로 돌고 통과 (등재 전후 총 테스트 수 증가 확인)
- 나라장터 주소의 bidno/bidNtceNo/bidPbancNo 와 차수(bidseq/bidNtceOrd)를 뽑는다, frame 주소 안에 중첩된 것도 뽑는다
- http/https 가 아니거나 localhost 사설 주소면 거절 사유를 값으로 돌려준다
- 쪽 HTML 에서 제목을 뽑는다 (og:title > title > h1 순, 사이트 이름 꼬리 제거)
의존: 없음

### I02 링크 미리보기 창구
상태: 통과
모드: 경량
범위:
- apps/web/app/api/rfp/intake/notice-url/route.ts (신규)
- apps/web/lib/rfp/terms.ts
감사 기준:
- POST /api/rfp/intake/notice-url 은 DB 에 아무것도 쓰지 않는다 (insert/update 문자열 0건)
- 일반 게시판 주소를 주면 제목과 첨부 이름 목록을 돌려준다
- 나라장터 주소면 공고번호를 뽑아 열린 API 로 조회하고 첨부 칸을 돌려준다, 키가 없으면 no_service_key 와 안내를 돌려준다
- 미인증 호출은 401
의존: I01

### I03 소스에서 케이스 만드는 길을 한 벌로
상태: 대기
모드: 경량
범위:
- apps/web/lib/rfp/intake/adopt-source.ts (신규)
- apps/web/lib/rfp/intake/adopt-source.test.ts (신규)
- apps/web/app/api/rfp/sources/[id]/adopt/route.ts
- apps/web/app/api/rfp/cases/from-url/route.ts (신규)
- apps/web/package.json (test 스크립트 등재)
감사 기준:
- adopt 라우트가 새 공용 함수를 부른다, 첨부 내려받기와 케이스 생성 코드가 두 벌로 남지 않는다 (downloadAttachment 호출 지점 1곳)
- POST /api/rfp/cases/from-url 은 docClass 가 없으면 400
- 같은 주소를 두 번 보내면 케이스를 두 개 만들지 않는다 (reused 로 돌려줌)
- 첨부를 한 건도 못 받으면 분석을 걸지 않고 사유와 공고 주소를 돌려준다
- pnpm --filter web test 에서 adopt-source 테스트 통과
의존: I01, I02

### I04 공고 올리기 화면에 링크 칸
상태: 대기
모드: 경량
범위:
- apps/web/components/rfp/UploadPanel.tsx
- apps/web/lib/rfp/terms.ts
- apps/web/app/(rfp)/rfp.module.css
감사 기준:
- 화면에 공고 링크 칸과 가져오기 단추가 있고, 가져오면 사업명과 첨부 건수가 보인다
- 링크만 넣고도 분석 시작이 눌린다 (파일 0건 + 링크 1건이면 제출 가능)
- 첨부를 못 찾으면 사유와 공고 열기 단추가 보이고 분석은 안 걸린다
- 한글 문자열을 컴포넌트에 직접 쓰지 않는다 (terms 경유)
의존: I03

### I05 가드와 종합
상태: 대기
모드: 경량
범위:
- apps/web/lib/rfp/rfp-guard.test.ts
- apps/web/lib/ui/test-registry.test.ts (확인만)
감사 기준:
- 새 창구 두 개가 등재 가드에 잡힌다 (경로가 실제로 존재)
- pnpm typecheck, pnpm test, pnpm build 전부 통과
- git diff 에 키/토큰 없음
의존: I04

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-16) 최초 작성 (ins_0013)
