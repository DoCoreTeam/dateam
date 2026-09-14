# 3단계 실측, AI 결과를 그리는 부품이 지금 어떤 모양인가

잰 날 2026-09-14
기준 커밋 d367fd27

## 0 한 줄

AI 결과를 그리는 화면이 스물여덟인데 그중 공용 부품은 **0개**다

## 1 자작 부품 스물여덟

`confidence` 를 그리는 tsx 를 전수로 골랐다

| 서비스 | 개수 | 파일 |
|---|---|---|
| GPU 가격 | 9 | HistoryTab, IntakeGateSummary, MarketTab, PriceTableTab, QuoteRegisterPreview, QuoteRegisterTab, ReviewTab, SpecsTab, SuppliersTab |
| 영업 CRM | 3 | SuggestionCard, MeetingDetail, DuplicatesCard |
| 콘텐츠 인텔리전스 | 4 | PerformanceView, TrendsView, DetailSheet, StatusBadge |
| RFP | 3 | ReportClient, CrossVerifyDialog, ReportCard |
| 업무 | 3 | AutolinkSection, daily/page, DeptTaskSuggestPanel |
| 관리자 | 3 | AiPromptsClient, DataQualityDashboard, RemedyPanel |
| 그 밖 | 3 | ExtractConfirmModal, AutoDraftPanel, CatalogUploadSection |

`components/ui` 안에서 `confidence` 나 `evidence` 를 그리는 부품은 0개다
즉 스물여덟이 전부 자기 서비스 안에서 각자 그린다

## 2 부품 여덟이 무엇을 대신하나

| 부품 | 지금 이 일을 하는 자작 | 왜 공용이어야 하나 |
|---|---|---|
| AI 값 | 스물여덟 전부 | 확신을 어떤 화면은 퍼센트로, 어떤 화면은 배지로 그린다 |
| 근거보기 | ReportCard, DetailSheet, ReviewTab | 근거가 있는데 안 그리는 화면이 있다 |
| 후보목록 | ExtractConfirmModal, SuggestionCard, DeptTaskSuggestPanel | 검수 없이 확정되는 길이 화면마다 다르다 |
| 제안대조 | DuplicatesCard, CrossVerifyDialog | 지금 값과 제안 값을 나란히 못 보는 화면이 있다 |
| 생성고지 | ReportCard 뿐 | 나머지는 AI 가 만든 것인지 화면에서 알 수 없다 |
| 고친흔적 | 없음 | 사람이 고친 자국이 화면에 안 남는다 |
| 물어보기 | CrossVerifyDialog, RemedyPanel | 다시 물어보는 자리가 두 화면에만 있다 |
| 진행상태 | AutoDraftPanel, ReviewTab | 흘려보내는 중간값을 그리는 모양이 둘 다 다르다 |

## 3 값의 종류가 부품을 정하는 선례

`components/ui/DateField.tsx` 와 `MoneyField.tsx` 가 그 방식으로 서 있다
날짜 칸은 열여덟 화면이 쓰고 금액 칸은 두 화면이 쓴다
차이는 가드다, 날짜 칸에는 검사 가드가 붙어 있고 금액 칸에는 없다

부품과 가드는 같은 작업이지 두 작업이 아니다

## 4 부딪히는 제약 하나

`node --test --experimental-strip-types` 는 **tsx 를 아예 못 읽는다**
확장자 자체를 모른다고 한다 (`ERR_UNKNOWN_FILE_EXTENSION`, 실측 2026-09-14)

DateField 가 이미 이 벽에 부딪혀 범위 로직을 `lib/ui/date-range.ts` 로 빼 두었고
그 파일 주석에 이유가 적혀 있다

그래서 부품 패키지는 두 겹으로 만든다

- `*.ts` 무엇을 언제 보일지 정하는 규칙, 시험이 직접 읽는다
- `*.tsx` 그 결정을 그리기만 한다, 얇게 둔다

규칙이 tsx 안에 있으면 시험이 못 보고, 못 보는 규칙은 지켜지지 않는다

## 5 이번 단계가 하는 것

- 부품 여덟을 패키지에 둔다, 한글 0건이고 라벨은 쓰는 쪽이 준다
- 능력마다 무엇을 함께 보여야 하는지를 가드로 강제한다
- 부품 하나를 실제 화면에 붙여 동작을 확인한다

## 6 이번 단계가 안 하는 것

- 자작 스물여덟을 실제로 이관하는 일 (9단계)
- 카탈로그 신설
