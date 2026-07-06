# newAX

**AX사업본부 통합 업무 플랫폼** — 일일/주간 업무 보고, 부서 업무, 조직·CRM, 그리고 GPU 가격 인텔리전스(콕핏)를 하나로 묶은 사내 웹 애플리케이션.

> 버전: **v0.7.283** · Next.js 14 (App Router) · Supabase · TypeScript
> 개발/운영 규칙 전문은 [`CLAUDE.md`](./CLAUDE.md) 참조 (이 README는 "무엇이 있고 어떤 형태인가"의 개요).

---

## 이 시스템은 무엇인가

사내 구성원이 **매일의 업무 → 주간 보고 → 부서/본부 운영 현황**을 한 흐름으로 기록·집계하고, 영업(연락처·거래처·딜)과 조직도를 관리하며, 별도의 **GPU 클라우드 가격 책정 콕핏**으로 자사/경쟁사 가격을 분석·결정하는 플랫폼입니다. AI(Gemini)가 일일→주간 요약, 회의노트 추출, 명함 OCR, 리드 추출, 가격 자료 흡수를 보조합니다.

---

## 기능 인벤토리 (화면 기준)

라우트는 `apps/web/app` 하위 4개 그룹으로 나뉩니다.

### `(member)` — 로그인 사용자 메인 앱
| 기능 | 라우트 | 설명 |
|------|--------|------|
| 홈 | `/home` | 개인 홈 대시보드 (오늘 할 일·요약) |
| 일일업무 | `/daily` | 원문 즉시 저장 → 백그라운드 AI가 업무 단위로 분해. 인라인 상태 편집 |
| 주간보고 | `/weekly-report` | **작성폼이 메인** — 우측 인테이크 패널에서 일일업무·미처리 메모를 체크해 폼에 반영(마스터 체크박스 전체선택/해제·메모 일괄 확인, 메모는 반영 시 자동 소진), **같은 구분(카테고리)도 여러 행으로 기록**(v0.7.286: seq 도입·무경고 유실버그 해소), 전주 계획→이번주 성과 이월. AI 자동초안(일일+캘린더 분석)은 접힘 보조. 지연추적/증빙 포함. `내 보고`=사용자 원문 그대로 / `조직 현황`=AI 취합(부서 병합) |
| 부서업무 | `/dept-tasks` | 부서 단위 업무 관리(조직 스코프 권한) |
| 프로젝트 현황 | `/work/projects` | 프로젝트 CRUD(검색·정렬·커서) + `[프로젝트\|현황]` 뷰 스위치(v0.7.286: 구 `/work/overview` 병합·고객/딜/프로젝트 축). 각 프로젝트 **저장 이력**(감사로그) 드로어 — 생성/수정/삭제/AI확정의 성공·실패·부분 전부 append-only로 기록, 저장값 스냅샷·실패 원인 표시 |
| 업무 허브 | `/work` | 일일·주간·부서·프로젝트 현황 통합 탭(순서: 일일→주간→부서→프로젝트 현황) |
| 캘린더 | `/calendar` | 일정 관리 (KST 정합성 SSOT 적용) |
| 회의노트 | `/meeting-notes` | 텍스트 회의록 → AI 추출 → daily/calendar 연계 |
| 연락처 | `/contacts` | 인물 연락처 + 명함 OCR(AI) |
| 거래처 | `/accounts` | 고객사·잠재 거래처 관리 |
| 딜 | `/deals` | 영업 파이프라인(stage/value/probability) |
| 리드 인테이크 | `/lead-intake` | 리드 수집·AI 추출·대량 임포트 |
| 조직도 | `/org` | 조직 계층(org_nodes + closure) 시각화 |
| GPU 가격 | `/pricing/gpu` | **가격 콕핏** — 자사 판매가·원가·경쟁사·환율·검토/확정. `?tab=cockpit` |
| GPU 통합입력 | `/intake` | 비정형 가격 자료(xlsx/CSV/이미지) AI 흡수·추출·정규화 |
| KPI | `/kpi` | KPI/OKR 현황 |
| 운영 | `/operations` | 본부 운영 — 진행 프로젝트·본부 현황 |
| 루틴 | `/routine` | 운영 루틴 체크 |
| API 키 | `/api-keys` | 외부 API 프로그램용 개인 키 발급/관리 |

### `admin/*` — 관리자 콘솔
회원·조직도(`members`, `org-chart`, `users`), AI 프롬프트/사용량(`ai-prompts`, `ai-usage`), 콘텐츠(`content`), 일일로그 모니터링(`daily-logs`), 주간보고 취합(`reports`), 데이터 품질(`data-quality`), 파트너 등급(`partner-tiers`), 루틴/KPI/설정 등 16개 영역.

### `api/*` — Route Handlers (백엔드)
`auth`, `daily`, `weekly-report`, `work`, `deals`, `contacts`, `accounts`, `calendar`, `pricing`, `leads`/`lead-intakes`, `reports`, `ai`, `content`, `files`, `onboarding`, `settings`, `user`, `admin`, `projects`, 그리고 외부 공개용 `public/*` 등. (별도 API 서버 없음 — 모두 Next.js Route Handler)

### public — 로그인 불요
`/develop`, `/api-access` (외부 API 프로그램 안내), `(auth)/login`.

---

## 아키텍처 (어떤 형태인가)

- **모노레포**: pnpm workspace. 실제 앱은 `apps/web` 단일 패키지. 루트 스크립트는 `apps/web`로 프록시.
- **프레임워크**: Next.js 14 App Router. 서버 컴포넌트 + Route Handler. **별도 API 서버 없음.**
- **백엔드**: Supabase (Postgres + Auth). 모든 테이블에 **RLS 필수**.
- **인증/권한**: `middleware.ts`가 모든 비정적 요청에서 실행 → 비로그인은 `/login`. 역할 3종(`admin`/`member`/`api_user`)은 `profiles.role`에서 읽음. 서버측 admin 게이팅은 `lib/auth/requireAdmin.ts`(페이지)·`requireAdminApi.ts`(API).
- **AI 통합**: Gemini 기반, `lib/gemini-*.ts`에 격리 (일일→주간 요약, 리드 추출, 명함 OCR, 콘텐츠 편집, 업무 제안, 임베딩, 회의 추출). 토큰 사용량은 `lib/token-logger.ts`로 로깅. (모듈 8개)
- **버전 주입**: `apps/web/next.config.js`가 **루트 `package.json`의 version**을 빌드타임에 `NEXT_PUBLIC_APP_VERSION`으로 주입 → 사이드바 표시. 루트 package.json이 단일 버전 소스.
- **SSOT 원칙**: 도메인 로직은 `lib/`에 단일 구현하고 import (복붙 금지). 최대 도메인은 GPU 가격(`lib/gpu/`, 100+ 파일).
- **날짜·시간**: `lib/datetime/kst.ts` SSOT로 KST↔UTC 처리. DB는 항상 UTC 저장, 표시는 항상 KST 변환.
- **리치텍스트**: 사용자 본문은 plain text 기본. HTML(Tiptap)은 주간보고 한정. AI 입력/타 화면 인용 시 `lib/html-to-plain.ts` 경유, HTML 렌더는 원칙적으로 공용 `RichText` 컴포넌트를 통함.
- **디자인 시스템**: `globals.css :root` 디자인 토큰 SSOT + 공용 컴포넌트(`components/ui/nb/*`). 인라인 하드코딩 금지, 반응형 필수.

### 디렉토리 구조
```
newAX/
├── apps/web/                  # 유일한 워크스페이스 패키지 (Next.js 앱)
│   ├── app/
│   │   ├── (auth)/            # 로그인
│   │   ├── (member)/          # 메인 앱 (위 기능 인벤토리)
│   │   ├── admin/             # 관리자 콘솔
│   │   ├── api/               # Route Handlers (백엔드)
│   │   ├── develop, api-access# 외부 API 프로그램 (public)
│   │   └── globals.css        # 디자인 토큰 SSOT + 유틸 클래스
│   ├── components/            # 공용 UI (ui/nb/*, RichText, MobileShell 등)
│   ├── lib/                   # 도메인 로직 SSOT
│   │   ├── gpu/               # GPU 가격/추출 (dedup·tier·normalize·pricing·콕핏…)
│   │   ├── gemini-*.ts        # AI 통합 (7 모듈)
│   │   ├── weekly-report/     # 주간보고 분류·직렬화·지연추적
│   │   ├── datetime/kst.ts    # KST↔UTC SSOT
│   │   ├── auth/, org/, daily/, meeting/, work/, admin/ …
│   │   └── supabase/          # 클라이언트(client.ts / server.ts)
│   ├── e2e/                   # Playwright E2E
│   └── middleware.ts          # 인증·역할 라우트 보호
├── supabase/migrations/       # 순번 SQL (NNN_name.sql, 현재 140+)
├── scripts/                   # migrate.sh, design 가드, ralph, changelog-gen
├── docs/                      # 작업 기획 문서 (DOC-FIRST)
├── package.json               # 루트 — 단일 버전 소스 + 프록시 스크립트
└── CLAUDE.md                  # 개발/코딩/버전 정책 전문
```

---

## 기술 스택

| 영역 | 사용 |
|------|------|
| 프레임워크 | Next.js 14 (App Router), React 18.3 |
| 언어 | TypeScript |
| 스타일 | Tailwind CSS + globals.css 디자인 토큰(SSOT) |
| 백엔드/DB | Supabase (Postgres + Auth), `@supabase/ssr`, RLS |
| AI | Google Gemini (`lib/gemini-*`), 임베딩 |
| 리치텍스트 | Tiptap (주간보고 한정) |
| 데이터 UI | @tanstack/react-table, recharts, @dnd-kit |
| 폼 | react-hook-form + zod |
| 문서/파싱 | xlsx, mammoth, docx, node-html-parser, sanitize-html |
| 브라우저 자동화 | puppeteer-core + @sparticuz/chromium (가격 파싱 등) |
| 온보딩 | driver.js (스포트라이트 실습형) |

---

## 개발·운영 명령

pnpm 모노레포. 루트 스크립트가 `apps/web`로 프록시됩니다.

```bash
# 개발 / 빌드 (루트에서)
pnpm dev                # next dev :3000
pnpm build              # next build
pnpm start              # next start

# 린트 / 타입체크 (apps/web에서)
cd apps/web && pnpm lint
cd apps/web && pnpm exec tsc --noEmit

# 테스트 — node:test 러너 (jest/vitest 없음, apps/web에서)
cd apps/web && pnpm test          # package.json에 명시된 파일 리스트만 실행
cd apps/web && node --test --experimental-strip-types "lib/gpu/pricing.test.ts"  # 단일 파일
# ⚠️ *.test.ts 새로 추가해도 자동 포함 안 됨 — apps/web/package.json의 test 스크립트 리스트에 직접 추가

# E2E — Playwright (설정: 루트 playwright.config.ts, 테스트: apps/web/e2e)
pnpm exec playwright test

# 디자인 토큰 가드 (커밋/PR 전 필수 — pre-commit + CI가 강제)
pnpm design:check

# DB 마이그레이션 — raw psql, 원자적 추적 (Supabase CLI 아님)
PGPASSWORD='...' ./scripts/migrate.sh <NNN_name.sql>
PGPASSWORD='...' ./scripts/migrate.sh --status
```

---

## 규약 (요약)

- **커밋 메시지**: `v{버전}: {변경 내용} claude` (제목 끝에 소문자 `claude` 필수)
- **버전**: 루트 `package.json`이 단일 소스. 커밋 전 루트 + `apps/web/package.json` + `CLAUDE.md` + `AGENTS.md` 동기화
- **재사용/SSOT**: 같은 로직은 `lib/`에 단일 구현 후 import (복붙 금지)
- **반응형/디자인 토큰 필수**: 가로 스크롤 테이블 금지(`.table-card`), 인라인 하드코딩 금지, `pnpm design:check` 통과 필수
- **RLS 필수**: 모든 테이블
- 상세: [`CLAUDE.md`](./CLAUDE.md)
