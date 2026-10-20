# PLAN newAX: 계약서 전화번호 칸과 채울 자리, 파일로 만든 템플릿의 값 빼기
플랜 ID: P0148
플랜 버전: v0.1.2
상태: 진행중
지시: ins_0301
목표 버전: v0.11.38
푸시: 모음
작성: 2026-10-20
시작 커밋: 885f066c

## 목표
- 계약서 템플릿 「칸 넣기」에 전화번호 칸(공급자 고객 담당)이 있고 계약서 고치기에서 값을 넣을 수 있음, 공급자 전화번호는 설정에서 한 번 넣으면 자동으로 채워짐
- 용역 수행범위처럼 계약마다 내용이 다른 자리를 템플릿에서 「사람이 채우는 칸」으로 고를 수 있고, 계약서 고치기에서 여러 줄로 채움
- 채워진 계약서 파일로 템플릿을 만들면 금액 한글 표기, 당사자 상호 대표자 이름, 날인부 날짜가 칸으로 빠지고 날인부는 마지막 조항에서 떨어진 따로 한 덩어리가 됨, 주민등록번호는 템플릿에 남지 않음

## 범위 밖
- 주민등록번호를 계약서 칸으로 저장하는 것 (개인정보보호법상 처리 제한, 생년월일 칸으로 대신함)
- 이미 만든 템플릿 「DA용역프리_계약서_강성규 (1)」 본문을 고쳐 주는 것 (사람이 파일로 다시 만들거나 칸 넣기로 고침)
- 견적서 인쇄에 공급자 전화번호를 찍는 것

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 전부 i18n 키 사용 (lib/terms)
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (공급자 전화번호는 설정 표 quote.supplier.phone)
- 실브라우저에서 칸 넣기 목록에 전화번호와 수행범위가 보이고 계약서 고치기에 입력칸이 있음

## 참조
- LOOP.md 7절 9절
- apps/web/lib/crm/domain/contract-fields.ts 칸 목록 한 벌 원칙

## 항목

### I01 전화번호 칸과 공급자 전화번호 설정
상태: 통과
모드: 경량
범위: apps/web/lib/terms/quote.ts, apps/web/lib/crm/services/setting.ts, apps/web/lib/crm/domain/quote-document.ts, apps/web/lib/crm/services/quote-document.ts, apps/web/lib/terms/contract-doc.ts, apps/web/lib/crm/domain/contract-fields.ts, apps/web/lib/crm/domain/contract-fields.test.ts
감사 기준:
- 보안: 새 설정값은 기존 설정 표와 설정 서비스 검증을 지남, 새 표 칼럼 라우트 없음, 계약서 칸 값은 fillHtml 에서 escape 됨을 시험으로 확인
- contract-fields.test.ts 의 견적 문서 칸 대조 시험이 supplier.phone customer.phone owner.phone 을 계약서 칸으로 셈하고 통과
- autoValuesFrom 이 공급자 고객 담당 전화번호를 채우는 단정 통과
- 설정 정의에 quote.supplier.phone 이 있고 readQuoteSupplier 가 읽음 (설정 배선 가드 통과)
의존: 없음

### I02 사람이 채우는 긴 글 칸 (계약.수행범위)
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/contract-fields.ts, apps/web/lib/terms/contract-doc.ts, apps/web/lib/crm/services/contract.ts, apps/web/app/(crm)/crm/contracts/[id]/ContractEditModal.tsx, apps/web/lib/crm/domain/contract-fields.test.ts
감사 기준:
- 보안: 사람이 넣은 여러 줄 값은 escape 후 문단으로 조립됨을 시험으로 확인 (<script> 가 글로 남음)
- 문단 하나를 차지한 {{계약.수행범위}} 가 줄마다 문단으로, 글 속 칸은 줄바꿈으로 채워지는 단정 통과
- 비어 있으면 (미입력) 이 찍히는 단정 통과
- 계약서 고치기 창은 longtext 칸을 여러 줄 입력칸(textarea)으로 그림 (코드 확인, 실브라우저는 I04)
의존: I01

### I03 파일로 만들기가 당사자 금액 날인부를 칸으로 빼고 날인부를 떼기
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/contract-from-file.ts, apps/web/lib/crm/services/contract-from-file.test.ts, apps/web/lib/crm/ai/prompts/contract-template-from-doc.v1.ts, apps/web/lib/terms/contract-doc.ts, apps/web/app/(crm)/crm/settings/ContractTemplateFromFile.tsx, apps/web/app/api/crm/contract-templates/from-file/route.ts
감사 기준:
- 보안: 원문의 주민등록번호가 템플릿 본문에 한 자리도 남지 않는 단정 통과, 파일과 AI 응답은 기존 검사(형식 판정 zod 원문 대조)를 그대로 지남
- 마지막 조항 뒤 「이상과 같이 ... 서명」 줄부터는 따로 한 덩어리(날인)로 갈리는 단정 통과
- 「금 사백칠십오만원」 같은 한글 금액이 {{견적.합계 한글}} 로 바뀌는 단정 통과 (AI 제안 없이도)
- 우리 회사 설정값(상호 대표자 사업자번호 주소 전화번호)은 AI 없이 글자 사이 띄어쓰기와 (주) 주식회사 변형까지 칸으로 바뀌는 단정 통과
- 남은 전화번호 사업자번호 금액 날짜를 세어 결과 화면에 「남은 값 n곳」으로 알리는 단정 통과, 라우트는 인증 장치를 그대로 부름
의존: I02

### I03a 주민등록번호를 AI 에 보내기 전에 지우기
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/contract-from-file.ts, apps/web/lib/crm/services/contract-from-file.test.ts
감사 기준:
- 보안: AI 가 받는 조항에 주민등록번호 숫자가 없는 단정 통과 (실측 AI 가 앞자리만 짚어 뒷자리가 남던 것)
- 실브라우저 가짜 계약서 올리기에서 초안 본문에 주민등록번호 숫자 0자리, 「생년월일 : {{고객.생년월일}}」
의존: I03

### I04 실브라우저 확인
상태: 대기
모드: 경량
범위: 없음 (확인만, 고칠 것이 나오면 항목 삽입)
감사 기준:
- 보안: 해당 없음 확인, 코드 변경 없음을 git status 로 확인
- 템플릿 편집 칸 넣기 목록에 공급자.전화번호 고객.전화번호 담당.전화번호 고객.생년월일 계약.수행범위가 보임
- 설정 화면에 공급자 대표 전화번호 입력칸이 보임
- 계약서 고치기 창에 수행범위 여러 줄 입력칸과 전화번호 칸이 보임
의존: I03

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-20) 최초 작성 (ins_0301)
- v0.1.1 (2026-10-20) I03 범위에 결과 숫자를 싣는 라우트 추가, 우리 회사 설정값 기준 칸 바꾸기 기준 추가, 실브라우저 확인을 I04 로 분리 (사용자 추가 지적 금액 날인부 회사명) (iv_0285)
- v0.1.2 (2026-10-20) I04 실브라우저에서 AI 가 주민등록번호 앞자리만 생년월일로 짚어 뒷자리가 남는 것을 잡음, 지우기를 AI 앞으로 옮기는 I03a 삽입 (audit:I04)
