# v0.5.0 — 통합 경계 결정서 (재사용 vs 신규)

> 선행: `newplan/content_intelligence_design_v0.4.0_2026-08-11.html`
> 본 문서는 설계서 §12가 요구한 착수 전 필수 산출물 1번(v0.5.0)의 일부다.
> 설계서 §9가 "유효하다"고 전제한 v0.2.0(md)은 저장소에 존재하지 않는다 → 필요한 절을
> `02-ucm-and-connectors.md`에 새로 정의해 흡수한다.

---

## 0. 결정 요약

| 항목 | 결정 | 근거 |
|---|---|---|
| 배치 | newAX 앱(`apps/web`) 안의 **독립 컨텍스트 표면** | 사용자 지시. `/develop`처럼 자체 셸·자체 IA를 갖되 같은 앱·같은 인증 |
| 라우트 | `app/(ci)/ci/*` 신규 route group + 자체 layout | `(member)` 셸(사내 업무 IA)과 물리 분리. 메뉴 혼입 금지 |
| DB | 기존 newAX Supabase 프로젝트, `public` 스키마에 **`ci_` 접두사** | 사용자 지시. 별도 PG 스키마는 PostgREST 노출 설정·`.schema()` 호출 분기 비용이 커서 기각 |
| 인증·계정 | **재사용** (`auth.users`, `public.profiles`) | 지시 |
| AI 키·모델 | **재사용** (`org_content` META + `lib/ai-chat/registry.ts`) | 지시. 키 이중 관리 금지 |
| AI 사용량 로깅 | **재사용** (`ai_token_logs` + `logTokenUsage`) | 기존 SSOT. `AiFeature` 유니온에 `ci-*` 값 추가(타입 전용 변경) |
| CI 전용 설정 | **신규** (`ci_settings` / `ci_setting_audits`) | 지시. 설계서 §10.2 |
| 워크스페이스 | **신규** (`ci_workspaces`) | 사내 조직도(`org_nodes`)는 부서 위계이지 SaaS 테넌트가 아님. 성격 불일치 |
| 디자인 | newAX 토큰 체계 위에 **CI 확장 토큰** | 아래 §3 |

---

## 1. 표면(Surface) 설계

### 1-1. 왜 별도 컨텍스트인가

`(member)` 그룹은 사내 업무 IA(홈·업무·캘린더·조직도)를 강제하는 `MobileShell` NAV를 상속한다.
설계서 §5 IA는 동사형 5그룹(홈·리서치·제작·게시·성과)으로 완전히 다른 축이다.
같은 셸에 얹으면 두 IA가 한 사이드바에서 충돌한다 → **route group 분리**.

```
apps/web/app/
├── (member)/          기존 사내 업무 — 변경 없음
├── admin/             기존 관리자 — 변경 없음
├── (ci)/              ★ 신규
│   ├── layout.tsx     CiShell (자체 5그룹 NAV, StageNav, AssistantPanel)
│   └── ci/
│       ├── page.tsx           H01 홈
│       ├── inbox/             R01 수집함
│       ├── monitoring/        R02 모니터링
│       ├── channels/[id]/     R03 채널 상세
│       ├── trends/            R04 트렌드 (탭 4)
│       ├── pipeline/          P01 파이프라인 보드
│       ├── briefs/[id]/       P02 기획안 편집기
│       ├── edits/[id]/        P03 편집안
│       ├── assets/            P04 자료
│       ├── publish/           B01 게시
│       ├── my-channels/       B02 내 채널
│       ├── performance/       A01 성과 (탭 3)
│       └── settings/          S01 설정
└── api/ci/*           CI 전용 라우트 핸들러
```

### 1-2. 미들웨어

`middleware.ts`는 **변경 없음**. `/ci/*`는 공개 예외 목록에 넣지 않으므로 기존 규칙대로
미인증 → `/login` 리다이렉트된다. `api_user` 역할은 허용 경로 밖이므로 자동 차단된다.

CI 내부 권한(워크스페이스 멤버 여부·역할)은 미들웨어가 아니라 **서버 게이트**에서 판정한다:
`lib/ci/auth/requireCiMember.ts` (페이지), `requireCiMemberApi.ts` (API).
기존 `requireAdmin.ts` 패턴과 동일 구조 — 클라이언트 단독 게이팅 금지.

### 1-3. 진입점

`(member)` 사이드바 하단에 `콘텐츠 인텔리전스` 링크 1개만 추가(신규 창 아님, 같은 세션).
반대로 CI 셸에는 `사내 업무로 돌아가기` 링크 1개. 그 외 상호 참조 금지.

---

## 2. 재사용 경계 (정확히 어디까지)

### 2-1. 그대로 쓰는 것

| 자산 | 위치 | CI에서의 사용 |
|---|---|---|
| Supabase 클라이언트 | `lib/supabase/{client,server}.ts` | 그대로 |
| 인증 세션·프로필 | `auth.users`, `public.profiles` | `ci_workspace_members.user_id` → `profiles.id` FK |
| AI 프로바이더 키/모델 | `org_content` key=`META`, `lib/ai-chat/registry.ts` | 키 조회 SSOT. CI가 별도 키 저장소를 만들지 않는다 |
| AI 토큰 로깅 | `lib/token-logger.ts` | `logTokenUsage({feature:'ci-classify', ...})` |
| 날짜·시간 | `lib/datetime/kst.ts` | **필수 경유**. naive 문자열 저장 금지 |
| HTML→plain | `lib/html-to-plain.ts` | AI 입력 전 변환 |
| 리치텍스트 렌더 | `components/.../RichText` | 대본·캡션 렌더 |
| 마이그레이션 | `scripts/migrate.sh` | `NNN_ci_*.sql` 연번 계승 (현재 183까지 사용) |
| 버전 체계 | 루트 `package.json` | CI 기능도 같은 앱 버전에 포함 |

### 2-2. 새로 만드는 것 (CI 전용)

| 영역 | 이유 |
|---|---|
| 워크스페이스·멤버·역할 4종 | `org_nodes`는 사내 부서 위계. SaaS 테넌트 개념 부재 |
| 설정 저장소 `ci_settings` | 설계서 §10.1 "설정은 DB, 관리는 UI" 3계층 스코프. `org_content`는 단일 KV라 스코프·감사·암호화 없음 |
| 잡 인프라 `ci_jobs`/`ci_job_runs` | 기존 앱에 큐가 없음 (§11.1이 지목한 1차 실패 원인) |
| 정정 로그 `ci_corrections` | 기존 `audit_log` 트리거는 변경 감사용이지 학습 피드백용이 아님 |
| 콘텐츠·채널·지표 전 계열 | 신규 도메인 |

### 2-3. 명시적 비재사용 (혼동 방지)

- `org_content` META에 CI 설정을 넣지 않는다 → `ci_settings`.
- `audit_log`에 CI 설정 변경을 넣지 않는다 → `ci_setting_audits` (설계서 §10.2가 별도 테이블 명시).
- `daily_logs` 계열, `projects` 계열과 어떤 FK도 맺지 않는다.

---

## 3. 디자인 시스템 판정 (설계서 §6 vs newAX CLAUDE.md)

설계서는 **shadcn/ui + Tailwind + Next 15**를 전제한다. 실제 저장소는 **Next 14.2.29 + React 18.3.1**,
shadcn 미설치, `globals.css` `:root` 토큰이 SSOT이며 CLAUDE.md가 자체 공용 컴포넌트
(`NbButton`/`NbCard`/`NbBadge`/`input-field`/`label`) 재사용을 강제한다.

**판정: shadcn 도입 기각. 설계서 §6의 *규칙*을 newAX 토큰 체계로 이식한다.**

- 기각 근거: shadcn 도입은 Radix 의존성 추가 + 두 번째 디자인 체계 상주를 뜻하고,
  이는 CLAUDE.md 재사용·단일구현 정책 정면 위반이다. Next 15 업그레이드는 별개 리스크
  (기존 419개 화면 회귀)이며 이번 범위에 포함할 이유가 없다.
- 이식 대상: §6.1 밀도형 라이트 UI 방향, §6.2 컬러 토큰, §6.3 타이포 스케일,
  §6.4 간격·라운드, §6.6 5상태 규칙 — 전부 **토큰과 공용 컴포넌트로** 구현.

### 3-1. 신규 CI 토큰 (globals.css `:root`에 추가)

기존 토큰과 충돌하지 않는 이름만 추가한다. 기존 토큰 값은 건드리지 않는다.

```css
:root {
  /* CI 차트 팔레트 — 색약 안전 6색 (설계서 6.2) */
  --ci-chart-1:#4F46E5; --ci-chart-2:#0EA5E9; --ci-chart-3:#16A34A;
  --ci-chart-4:#D97706; --ci-chart-5:#DB2777; --ci-chart-6:#64748B;
  /* 지표 숫자 (설계서 6.3) — 기존 --fs-price와 별개 용도 */
  --ci-fs-metric: 24px;
}
.ci-num { font-variant-numeric: tabular-nums; }   /* 숫자 고정폭 강제 */
```

설계서 §6.2의 `bg/surface/border/text/brand/success/warning/danger/info`는
기존 `--surface-bg/--border-color/--text/--brand/--success/--warning/--danger/--info`에
**1:1 대응하므로 신규 토큰을 만들지 않는다**(중복 체계 방지). 값 차이는 CI 셸의
`[data-surface="ci"]` 블록에서 토큰 재정의로 흡수한다.

### 3-2. CI 신규 공용 컴포넌트 (설계서 6.5)

`components/ci/` 아래. 인라인 재구현 금지, 표시 로직은 `lib/ci/format/`에 SSOT.

`ContentCard` · `MetricBadge` · `StatusBadge` · `PipelineBoard` · `StageNav` ·
`DetailSheet` · `EvidenceSheet` · `AssistantPanel` · `LoopMinimap`

`DetailSheet`는 설계서 §5.4가 "전 화면 공용, 중복 구현 금지"로 못박았으므로
**단일 컴포넌트 + 단일 데이터 훅**으로만 존재한다.

### 3-3. 문장형 지표 표기 강제 (설계서 §4.3)

`lib/ci/format/metrics.ts` 단일 모듈이 아래를 전담한다. 화면에서 직접 포맷 금지.

```ts
formatOutlier(index, baselineN)   // → '평소 대비 8.4배' | null (baselineN < 8이면 null)
formatPercentile(p)               // → '같은 주제 상위 3%'
formatLift(lift, evidenceN, chN)  // → '이 공식 적용 시 중앙값 2.1배 (근거 32개, 채널 7곳)'
formatConfidence(c)               // → '근거 충분' | '관찰 중' | '데이터 부족'
formatComparability(cls)          // → '조회수 비교 가능' | '참여로만 비교' | '비교 불가'
formatCompleteness(v)             // → '일부만 수집됨' | null (v >= 0.8이면 null)
```

이력 8개 미만 미표시, 소수 1자리 — **DB가 아니라 이 모듈이 최종 판정**한다.

---

## 4. 남는 위험 (정직하게)

| 위험 | 내용 | 완화 |
|---|---|---|
| 운영 DB 동거 | CI 테이블이 사내 업무와 같은 Postgres에 산다. CI의 잡 폭주가 공용 DB 커넥션을 잠식할 수 있다 | 잡 워커는 별도 커넥션 풀·동시성 상한, `ci_jobs` 인덱스 설계(§01 문서), 부하 계측 필수 |
| 마이그레이션 연번 공유 | CI 마이그레이션이 사내 업무 연번과 섞인다 | `NNN_ci_*.sql` 접두 규칙으로 식별성 확보. 롤백은 CI 테이블만 대상 |
| 암호화 마스터 키 | 설계서 §10.1대로 DB 접속정보와 마스터 키만 env에 남는다 | `CI_SETTINGS_MASTER_KEY` 신규 env 1개. 부재 시 암호화 설정 저장 자체를 거부(무음 평문 저장 금지) |
| 단일 앱 빌드 시간 | 화면 13개 추가로 빌드·번들 증가 | CI 라우트는 route group 분리로 코드 스플릿, 무거운 차트는 `dynamic()` |
| shadcn 미사용 | 설계서 §6.5가 shadcn 기본 컴포넌트를 전제한 부분은 자체 구현 부담 | 버튼·입력·탭·시트·다이얼로그·토스트는 기존 newAX 자산으로 충당 가능. 테이블·드롭다운만 신규 |
