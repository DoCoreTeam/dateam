# PLAN newAX: 한 줄로 합쳐져 온 규격을 연한 줄로 갈라 보인다
플랜 ID: P0044
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0060
목표 버전: v0.10.342
작성: 2026-09-21
시작 커밋: 1e8babdb

## 목표
- 견적서 품목의 사양이 한 문단으로 쭉 이어지지 않고 사양 하나마다 한 줄로 갈려 보임
- 줄과 줄 사이를 연한 가로선으로 갈라 어디서 끊기는지 눈으로 바로 읽힘
- 견적 편집기에 적은 줄 구분이 그대로 견적서에 나오고, 자동 줄바꿈은 줄로 세지 않음

## 범위 밖
- AI 추출 단계의 줄 경계 복원 (v0.10.336 에서 이미 함, 원문이 없는 옛 견적은 못 고침)
- 저장 칸 구조 변경 (descriptionMd 한 칸 유지)
- 견적 외 다른 문서의 사양 표시

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 용어집(@/lib/terms) 경유
- 실측 견적 DA-2026-0921-05 의 1번 품목이 화면에서 여러 줄로 갈려 보임

## 참조
- LOOP.md 부록 버전 규칙
- lib/crm/domain/quote-spec.ts (규격·구성 가르기 SSOT)
- lib/crm/domain/quote-components.ts (원문 대조 복원, 지어내지 않는다 원칙)

## 항목

### I01 한 덩어리로 온 규격을 원문 표식으로 가른다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/quote-spec.ts, apps/web/lib/crm/domain/quote-spec.test.ts (신규)
감사 기준:
- pnpm test quote-spec 통과
- 실측 문자열(DA-2026-0921-05 1번 품목)을 넣으면 components 가 10줄 이상으로 갈림
- 표식이 없는 문자열은 한 줄 그대로, 즉 components 0개 (지어내지 않음)
- 모델명 안 하이픈(R283-Z96-AAJ1)에서 갈리지 않음
의존: 없음

### I02 갈린 줄을 연한 가로선으로 구분해 그린다
상태: 통과
모드: 경량
범위: apps/web/app/(crm)/crm/quotes/[id]/quote-document.module.css, apps/web/components/ui/crm/quote-panel.module.css
감사 기준:
- 구성 목록의 항목 사이에 연한 가로선이 그려짐 (border-top, var(--border-light) 이하 농도)
- 첫 항목 위에는 선이 없음 (규격과 붙는 자리는 이미 왼쪽 세로선이 가름)
- 인쇄 축약 설정(data-print=collapse)이 그대로 동작
의존: I01

### I03 편집기가 갈린 줄 수를 실제로 세어 보인다
상태: 통과
모드: 경량
범위: apps/web/components/ui/crm/QuoteEditorModal.tsx
감사 기준:
- 개행 없이 표식만 있는 글을 붙여 넣어도 안내 숫자가 갈린 줄 수를 말함
- pnpm tsc --noEmit 통과
의존: I01

### I04 종합 감사와 판 올리기
상태: 통과
모드: 경량
범위: 루트 package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md, apps/web/lib/changelog/entries.ts
감사 기준:
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 버전 여섯 파일이 같은 값
의존: I01, I02, I03

## 종합 감사
- pnpm tsc --noEmit: 오류 0
- pnpm test: 6546/6546 통과, 실패 0 (새 가드 quote-spec 9단정 + 갱신된 표면 가드 3단정 포함)
- NEXT_DIST_DIR=.next-p0044 npx next build: exit 0, Compiled successfully in 42s, 정적 페이지 293/293
- pnpm lint (QuoteEditorModal): ESLint 경고·오류 0
- 완료 정의 대조
  - 사양이 한 문단으로 안 이어짐: 실측 DA-2026-0921-05 1번 품목이 규격 1줄 + 구성 13줄로 갈림
  - 연한 가로선: 브라우저 computed style 실측 — 규격 아래 1px rgb(232,229,218), 줄 사이 1px 같은 색, 첫 줄 위 0px
  - 용어집 경유: 새 문구 lineSpecSplitAction 을 QUOTE 안에 둠, glossary/terms 가드 통과
- 전체 diff 검토: git diff 7c48dcb0^..HEAD --stat 로 11파일 264+/41-, 범위 밖 변경 없음
  (apps/web/tsconfig.json 은 이전 세션의 미커밋 변경이라 손대지 않고 커밋에서 뺐음)
- 비밀 검색: 추가된 줄에 키·토큰·비밀번호 0건
- 가드를 일부러 깨뜨려 확인: 줄 선을 지운 판과 단추가 글을 안 바꾸는 판에서 각각 해당 가드가 실패함
- 보안 재측정 (7절 「기계가 세는 것」): 이번 판은 마이그레이션·라우트·서버 코드를 건드리지 않았고
  변경 범위가 도메인 순함수 1개, 화면 부품 1개, CSS 2개, 문서·버전 파일이라 다섯 줄의 대상이 없음.
  DB 상태를 바꾸지 않았으므로 앞 판의 측정값이 그대로 유효함 (해당 없음, 근거: 위 diff --stat)
- 남은 것: 저장값에서 표식이 지워진 채 합쳐져 온 견적(실측 DA-2026-0921-04)은 서버가 가를 근거가
  없어 부분까지만 갈린다. 원본은 그림으로만 남아 원문 줄 대조가 불가능하다. 길은 둘 —
  원본 파일을 다시 읽히면 원문 줄 대조(v0.10.337)가 걸리고, 아니면 편집기에서 사람이 나눈다

## 변경 이력
- v0.1.0 (2026-09-21) 최초 작성 (ins_0060)
