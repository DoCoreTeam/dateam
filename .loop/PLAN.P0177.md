# PLAN newAX: GPU 새 화면에서 판매가를 보고 견적을 넣는다
플랜 ID: P0177
플랜 버전: v0.1.2
상태: 진행중
지시: ins_0448
목표 버전: v0.11.102
푸시: 모음
작성: 2026-11-03
시작 커밋: 5926e240

## 목표
- /pricing/gpu 한 장에서 모델마다 판매가(gcube 사이트 금액), 적정판매가(최저 원가 + 마진), 차이, 목표 판매가 반영 여부를 본다
- 같은 화면의 입력 창에서 정해진 칸으로 견적과 시세를 여러 줄 넣고, 관리자가 저장하면 바로 표에 반영된다
- gcube 사이트 금액은 상품 번호(ser)로 가져오고, 우리 모델과의 연결은 사람이 한 번 확인한다

## 범위 밖
- 매일 자동 수집, AI 칸 채우기, 경쟁사 자동 수집 (2단계 자동화)
- 원본 첨부 파일 올리기 (출처 칸에 주소와 메모로 받는다, 첨부는 2단계)
- 이전 화면(/pricing/gpu/manage) 수정, 백업으로 그대로 둔다
- 이미 쌓인 시세의 단위 없는 240건 보정 (화면에 「단위 모름」으로 이미 갈라 보인다)

## 완료 정의
- pnpm typecheck, pnpm lint, pnpm test, pnpm build 통과
- 새 창구 셋이 CLI 명령을 갖고 docs/cli/02-기능대응표.md 와 openapi.json 에 실린다
- 실브라우저(ego-browser)로 가져오기, 연결, 입력 저장, 표 반영을 관리자와 일반 회원 두 계정으로 확인
- 새 화면 말은 lib/gpu/terms.ts 와 board-copy.ts 를 지난다

## 참조
- 기획 보고 https://claude.ai/artifact/1tAop7jjHxvuhAmPwiGiqf
- 결정: 판매가 = gcube 최대 금액(price + usagePrice), 관리자 저장 = 바로 확정, 일반 회원 저장 = 확정 대기, gcube 연결 = ser 기준 사람 확인
- 계산 SSOT apps/web/lib/gpu/board.ts, 데이터 apps/web/lib/gpu/board-data.ts
- 확정 SSOT apps/web/lib/gpu/confirm-review-item.ts, 시세 저장 apps/web/lib/gpu/competitor-import.ts

## 항목

### I01 gcube 를 원가에서 빼고 용어를 세운다
상태: 통과
모드: 경량
범위: apps/web/lib/gpu/board.ts, apps/web/lib/gpu/board.test.ts, apps/web/lib/gpu/terms.ts, apps/web/lib/gpu/board-copy.ts, apps/web/app/(member)/pricing/gpu/board/ (판매가 칸이 적정판매가와 목표 판매가로 갈라져 화면 셋이 따라옴)
감사 기준:
- board.test.ts: 공급사 gcube 의 cost 견적이 offers 에 안 들어간다 (실측 4건, A100 1장 23,940 이 8장 값이던 것)
- board.test.ts: KRW hour 시세 10,500 이 10,500 그대로 나온다 (이중 환산 없음)
- board.test.ts: 적정판매가는 목표 판매가가 있어도 최저 원가 × (1 + 마진), 목표 판매가는 따로 선다
- GPU_TERMS 에 판매가(gcube), 적정판매가, 목표 판매가, 차이, 반영 이 있고 board-copy 가 그 말을 쓴다, 「전략가」 는 화면 문구에서 사라진다
- 보안: 새 데이터 없음, 새 창구 없음, 밖에서 온 값 없음 (계산과 문구만)
의존: 없음

### I02 gcube 상품 표와 사이트 읽기
상태: 통과
모드: 중량
범위: supabase/migrations/324_gcube_listings.sql (신규), apps/web/lib/gpu/gcube-site.ts (신규), apps/web/lib/gpu/gcube-site.test.ts (신규), apps/web/lib/gpu/__fixtures__/gcube-gpuprices-2026-11-03.json (신규), apps/web/package.json
감사 기준:
- 마이그레이션: gcube_listings(ser 유일, gpu_name, product_code, gpu_count, vram_gb, cpu, memory_gb, base_krw, usage_krw, max_krw, product_id, suggested_product_id, fetched_at, price_changed_at), product_id 부분 유일 인덱스
- 보안: 같은 마이그레이션에서 RLS 켬, 읽기 authenticated, 쓰기 정책 없음(서비스롤 경로만), rls-baseline.test.ts 통과
- gcube-site.test.ts: 저장한 실페이지(scratchpad gcube.html 발췌 픽스처)에서 156건, ser 유일, max = price + usagePrice
- 보안: 숫자 아닌 값, 음수, 1억 초과, 원화 아님, 장수 밖 줄은 버린다 (시험 단정), 받기(safe-fetch)는 I03 창구에서
의존: I01

### I03 가져오기와 연결 창구 (웹과 CLI)
상태: 대기
모드: 중량
범위: apps/web/lib/actions/defs/gpu.ts, apps/web/app/api/pricing/gpu/gcube/ (신규), apps/web/lib/gpu/gcube-link.ts (신규), apps/web/lib/gpu/gcube-link.test.ts (신규), apps/web/lib/actions/generated/
감사 기준:
- POST /api/pricing/gpu/gcube/fetch (gpu.gcube.fetch): 관리자만, 156건 upsert, 바뀐 금액만 price_changed_at 갱신, 연결 제안(모델 정규화 + 장수 + 장당 메모리 일치가 하나일 때만) 채움
- GET /api/pricing/gpu/gcube (gpu.gcube.list), PATCH /api/pricing/gpu/gcube/link (gpu.gcube.link): 연결과 해제, 같은 상품 두 번 연결은 409
- 보안: 사이트는 safe-fetch 로 받는다(SSRF), 비로그인 401, 일반 회원 fetch·link 403 (api-auth-surface.test.ts 통과), 서비스롤 쓰기 위에 requireAdminApi
- pnpm gen 류 생성기로 openapi.json 과 CLI 표가 갱신되고 parity.test.ts 통과
의존: I02

### I04 표에 판매가, 적정판매가, 차이, 반영을 싣는다
상태: 대기
모드: 경량
범위: apps/web/lib/gpu/board.ts, apps/web/lib/gpu/board-data.ts, apps/web/lib/gpu/board.test.ts, apps/web/app/(member)/pricing/gpu/board/ 
감사 기준:
- board.test.ts: 판매가 = 연결된 gcube max_krw 를 장수로 나눈 1장 값, 적정판매가 = 최저 원가 × (1 + 마진), 차이 = 판매가 - 적정판매가
- board.test.ts: 목표 판매가가 gcube 판매가와 같으면 반영, 다르면 미반영, 목표가 없으면 표시 없음
- 화면 열: 모델 | 판매가 | 적정판매가 | 차이 | 원가 1위… | 최근 | 전체 N곳, 연결 안 된 줄은 「gcube 미연결」
- 보안: 새 창구 없음, 읽기는 기존 사용자 클라이언트(RLS) 그대로
의존: I03

### I05 gcube 연결 창
상태: 대기
모드: 경량
범위: apps/web/app/(member)/pricing/gpu/board/GcubeLinkPanel.tsx (신규), apps/web/app/(member)/pricing/gpu/board/GpuBoardClient.tsx, apps/web/app/(member)/pricing/gpu/board/board.module.css, apps/web/lib/gpu/board-copy.ts
감사 기준:
- 관리자에게 「gcube 판매가 가져오기」 단추와 「연결」 창, 제안 줄은 「제안대로 연결」 한 번으로, 그 밖은 모델 고르기로 연결
- 일반 회원은 단추가 안 보이고, 창구도 403 (단추 숨김이 권한 검증을 대신하지 않음)
- 가져오기 중 진행 문구, 실패는 실패로 말함 (빈 목록으로 위장 안 함)
- 보안: 새 창구 없음 (I03 창구 사용)
의존: I04

### I06 정해진 칸 입력 창구 (웹과 CLI)
상태: 대기
모드: 중량
범위: apps/web/lib/gpu/entry.ts (신규), apps/web/lib/gpu/entry.test.ts (신규), apps/web/app/api/pricing/gpu/entries/ (신규), apps/web/lib/actions/defs/gpu.ts, apps/web/lib/actions/generated/
감사 기준:
- entry.test.ts: 칸 검증(종류, 공급사, 모델, 장수 1~64, 금액 > 0, 통화 KRW USD JPY, 기준 1장 또는 구성 전체, 기간 시간 월 분, 약정 목록, 받은 날), 틀린 줄은 줄 번호와 칸 이름으로 돌려줌
- entry.test.ts: 엑셀에서 붙인 탭 구분 글을 칸으로 나눈다 (머리줄 있음 없음 둘 다)
- POST /api/pricing/gpu/entries (gpu.entry.create): 견적은 review_items 를 만들고 관리자면 confirmReviewItem(productId 지정)으로 바로 확정, 일반 회원은 확정 대기로 남김, 시세는 saveCompetitorPrices
- 보안: 비로그인 401, 한 번에 200줄 상한, 서버에서 다시 검증, 공급사 새 이름은 관리자만 만든다
의존: I01

### I07 입력 창 화면
상태: 대기
모드: 경량
범위: apps/web/app/(member)/pricing/gpu/board/EntryDialog.tsx (신규), apps/web/app/(member)/pricing/gpu/board/GpuBoardClient.tsx, apps/web/app/(member)/pricing/gpu/board/board.module.css, apps/web/lib/gpu/board-copy.ts
감사 기준:
- 「견적 넣기」 단추 하나로 창이 열리고, 줄마다 정해진 칸, 줄 더하기, 엑셀 붙여넣기, 틀린 칸 표시
- 저장 뒤 표가 다시 읽혀 그 모델 줄 원가에 바로 보임 (관리자), 일반 회원은 「확정 대기 n건」
- 브라우저 기본 대화상자 없음 (native-dialog.test.ts), 화면 문구 가드 product-copy.test.ts 통과
- 보안: 새 창구 없음 (I06 창구 사용)
의존: I06

### I08 문서, 업데이트 내역, 실브라우저
상태: 대기
모드: 경량
범위: docs/cli/02-기능대응표.md, apps/web/lib/changelog/entries.ts
감사 기준:
- 대응표에 gpu gcube list, gpu gcube fetch, gpu gcube link, gpu entry create 줄
- entries.ts 맨 위 v0.11.102 블록
- F-10: ego-browser 로 관리자 가져오기, 연결, 입력 저장, 표 반영 확인, 일반 회원(f10-nocrm) 단추 없음과 403 확인, 시험 데이터는 id 로 되돌림
- 보안: 해당 없음 (문서와 확인)
의존: I05, I07

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-11-03) 최초 작성 (ins_0448)
- v0.1.0 (2026-11-04) 기획 승인 뒤 범위를 판매가와 정해진 칸 입력으로 다시 씀 (ins_0456)
- v0.1.1 (2026-11-04) I01 범위에 board 화면 셋 추가, 판매가 칸을 적정판매가와 목표 판매가로 가르면 화면이 따라와야 함 (audit:I01)
- v0.1.2 (2026-11-04) I02 픽스처 범위 추가, safe-fetch 기준을 받는 자리인 I03 으로 옮김 (audit:I02)
