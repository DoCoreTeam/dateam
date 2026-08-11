# v0.5.0 — DB 스키마 명세 (전 테이블)

> 설계서 §12 필수 산출물 1번. 필드·타입·관계·인덱스·상태 enum 전수.
> 배치: 기존 newAX Supabase, `public` 스키마, `ci_` 접두사. 마이그레이션 연번은 184부터.

공통 규약
- PK는 전부 `uuid default gen_random_uuid()`.
- 시각은 전부 `timestamptz`. 저장은 UTC, 표시는 `lib/datetime/kst.ts` 경유(naive 문자열 금지).
- 소프트 삭제가 필요한 테이블만 `deleted_at timestamptz`. 읽기 경로는 반드시 `deleted_at is null` 필터.
- 모든 테넌트 테이블은 `workspace_id uuid not null references ci_workspaces(id) on delete cascade`.
- RLS는 전 테이블 필수. 기본 정책은 §12에 일괄 정의.

---

## 1. ENUM 전수 (17종)

```sql
create type ci_member_role       as enum ('owner','admin','member','viewer');
create type ci_setting_scope     as enum ('system','workspace','user');
create type ci_platform          as enum ('youtube','tiktok','instagram','facebook','x','threads');
create type ci_content_format    as enum ('short','long','image','text','live');
create type ci_channel_ownership as enum ('owned','tracked');
create type ci_ingest_status     as enum ('queued','running','done','partial','failed');
create type ci_content_source    as enum ('inbox','monitoring');
create type ci_review_state      as enum ('none','pending','resolved');
create type ci_comparability     as enum ('A','B','C');
create type ci_confidence        as enum ('high','medium','insufficient');
create type ci_topic_source      as enum ('auto','ai_verified','user');
create type ci_pipeline_stage    as enum ('idea','brief','edit','ready');
create type ci_publish_route     as enum ('manual','api');
create type ci_publish_status    as enum ('draft','scheduled','exported','published','failed');
create type ci_job_stage         as enum ('ingest','normalize','enrich','classify','verify','project');
create type ci_job_status        as enum ('queued','running','succeeded','failed','dead');
create type ci_correction_kind   as enum ('topic','group_unlink','outlier_dismiss','channel_link','field_fix');
```

`ci_ingest_status`는 설계서 §7.2 표기와 1:1 (`QUEUED 수집 중 / DONE 완료 / PARTIAL 일부만 / FAILED 실패`).
`ci_pipeline_stage`는 §7.5 칸반 4열과 1:1이며 드래그 = 이 enum 전이다.

---

## 2. 워크스페이스와 권한

### ci_workspaces
| 필드 | 타입 | 제약 | 비고 |
|---|---|---|---|
| id | uuid | PK | |
| name | text | not null | |
| slug | text | not null, unique | URL 식별자 |
| logo_url | text | | |
| default_locale | text | not null default 'ko' | §10.3 그룹2 |
| default_timezone | text | not null default 'Asia/Seoul' | |
| default_topic_id | uuid | FK ci_topics(id) on delete set null | 콜드 스타트 §8.6 |
| owner_id | uuid | not null FK profiles(id) | 소유권 이양 시 갱신 |
| created_at | timestamptz | not null default now() | |
| deleted_at | timestamptz | | §10.4 유예 삭제 |
| purge_after | timestamptz | | 유예 만료 시각. null이면 즉시 삭제 금지 |

`idx_ci_workspaces_owner (owner_id) where deleted_at is null`

### ci_workspace_members
| 필드 | 타입 | 제약 |
|---|---|---|
| workspace_id | uuid | PK(1/2), FK ci_workspaces cascade |
| user_id | uuid | PK(2/2), FK profiles(id) on delete cascade |
| role | ci_member_role | not null default 'member' |
| invited_by | uuid | FK profiles(id) |
| joined_at | timestamptz | not null default now() |

`idx_ci_members_user (user_id)` — 사용자의 워크스페이스 목록 조회 경로.
불변조건: 워크스페이스당 `role='owner'`는 정확히 1행. 트리거로 강제.

### ci_invitations
| 필드 | 타입 | 제약 |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | not null FK cascade |
| email | citext | not null |
| role | ci_member_role | not null default 'member' |
| token_hash | text | not null, unique | 원문 토큰 저장 금지 |
| expires_at | timestamptz | not null |
| accepted_at | timestamptz | |
| invited_by | uuid | FK profiles(id) |

`unique (workspace_id, email) where accepted_at is null`

---

## 3. 설정 체계 (설계서 §10.2)

### ci_settings
| 필드 | 타입 | 제약 | 비고 |
|---|---|---|---|
| id | uuid | PK | |
| scope | ci_setting_scope | not null | |
| scope_id | uuid | | system이면 null, workspace면 workspace_id, user면 profiles.id |
| key | text | not null | 점 구분. `flag.` 접두는 feature flag |
| value | jsonb | not null | 암호화 시 `{v:1,iv,ct,tag}` 봉투 |
| is_encrypted | boolean | not null default false | |
| version | integer | not null default 1 | 낙관적 잠금 |
| updated_by | uuid | FK profiles(id) | |
| updated_at | timestamptz | not null default now() | |

유니크 (scope_id가 null 가능하므로 표현식 인덱스):
```sql
create unique index uq_ci_settings_key
  on ci_settings (scope, coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid), key);
```
`idx_ci_settings_scope_lookup (scope, scope_id)` — 스코프 단위 룰셋 벌크 로드.

규칙
- 해석 순서 = user → workspace → system → 코드 기본값 (설계서 §10.1). 해석기는
  `lib/ci/settings/resolve.ts` 단일 구현. 매 요청 DB 조회 금지 — 룰셋 캐시 후 로컬 평가.
- 키별 Zod 스키마 레지스트리(`lib/ci/settings/registry.ts`)가 타입·범위를 검증하고
  설정 UI 폼을 자동 생성한다. 신규 설정 추가 시 화면 코드 수정 없음.
- `is_encrypted=true`는 AES-256-GCM. 마스터 키는 env `CI_SETTINGS_MASTER_KEY`.
  키 부재 시 **저장을 거부**한다(평문 폴백 금지).
- 시크릿을 `flag.*` 또는 평문 설정에 넣는 것 금지 — 저장 시 레지스트리가 차단.

### ci_setting_audits
| 필드 | 타입 | 제약 |
|---|---|---|
| id | uuid | PK |
| setting_key | text | not null |
| scope | ci_setting_scope | not null |
| scope_id | uuid | |
| old_value | jsonb | 암호화 항목은 `{"masked":true}` |
| new_value | jsonb | 동일 |
| actor_id | uuid | FK profiles(id) |
| at | timestamptz | not null default now() |

`idx_ci_setting_audits_key_at (setting_key, at desc)` · `idx_ci_setting_audits_scope (scope, scope_id, at desc)`
append-only. UPDATE/DELETE는 RLS로 전면 차단. 트리거로 `ci_settings` 변경 시 자동 기록하며
**never-block**: 감사 기록 실패가 설정 저장을 막지 않는다.

### 설정 키 인벤토리 (설계서 §10.3 → 키 매핑)

| 그룹 | 스코프 | 대표 키 |
|---|---|---|
| 1 내 계정 | user | `account.locale`, `account.timezone`, `notify.channels`(push/email) |
| 2 워크스페이스 일반 | workspace | `ws.name`, `ws.locale`, `ws.timezone`, `ws.default_topic` |
| 4 알림 규칙 | workspace | `alert.outlier.threshold`(기본 3), `alert.outlier.scope`, `alert.brief.send_at`, `alert.quiet_hours` |
| 5 데이터와 수집 | workspace | `ingest.refresh_interval`, `snapshot.preset`(economy/standard/precise), `data.retention_days` |
| 6 주제 관리 | workspace | `topic.autoconfirm_threshold`(기본 0.85) |
| 7 분석 기준 | workspace | `analysis.size_bands`, `analysis.window_days`(기본 28), `analysis.evidence_level` |
| 8 AI | workspace | `ai.response_locale`, `ai.brand_voice`, `ai.automation_level`, `ai.daily_call_limit` |
| 10 게시 기본값 | workspace | `publish.default_channels`, `publish.default_time`, `publish.checklist` |
| 13 운영자 콘솔 | system | `flag.*`, `llm.routing`, `llm.budget_cap`, `connector.health_targets` |

그룹 3(멤버·역할)·9(채널 연결)·11(요금)·12(보안)는 설정 KV가 아니라 전용 테이블로 존재한다
(각각 `ci_workspace_members`, `ci_channel_connections`, `ci_subscriptions`, `ci_setting_audits`).

---

## 4. 주제와 플랫폼

### ci_topics
| 필드 | 타입 | 제약 |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | not null FK cascade |
| name | text | not null |
| slug | text | not null |
| parent_id | uuid | FK ci_topics(id) on delete set null |
| description | text | |
| merged_into_id | uuid | FK ci_topics(id) — 병합 시 이력 보존(§10.3 그룹6) |
| created_at | timestamptz | not null default now() |
| deleted_at | timestamptz | |

`unique (workspace_id, slug) where deleted_at is null`

### ci_topic_rules
`id`, `topic_id` FK cascade, `kind` text check in ('include','exclude'), `pattern` text not null,
`origin` text check in ('user','promoted') — `promoted`는 정정 학습 승격분(§11.4),
`created_by`, `created_at`.
`idx_ci_topic_rules_topic (topic_id)`

### ci_platform_profiles (system 스코프, 워크스페이스 없음)
| 필드 | 타입 | 비고 |
|---|---|---|
| platform | ci_platform | PK |
| display_name | text | |
| metric_definitions | jsonb | 플랫폼별 조회수 정의 차이 원문 |
| comparability_class | ci_comparability | 이 플랫폼 지표의 기본 비교 등급 |
| supports_api_publish | boolean | B01 두 경로 분기 |
| ingest_methods | jsonb | 방법 체인 순서 (§02 문서) |
| regression_urls | text[] | 커넥터 회귀 URL 세트 |
| health | jsonb | 최근 성공률·측정 시각 |
| updated_by | uuid, `updated_at` timestamptz | 운영자 콘솔에서만 편집 |

---

## 5. 채널

### ci_channels
| 필드 | 타입 | 제약 | 비고 |
|---|---|---|---|
| id | uuid | PK | |
| workspace_id | uuid | not null FK cascade | |
| platform | ci_platform | not null | |
| external_id | text | not null | 플랫폼 고유 ID |
| handle | text | | @핸들 |
| display_name | text | not null | |
| profile_url | text | | |
| avatar_url | text | | |
| subscriber_count | bigint | | |
| subscriber_provenance | text | check in ('platform','web_verified','estimated') | §11.3 결손 보강 기록 |
| ownership | ci_channel_ownership | not null default 'tracked' | `owned`=내 채널, `tracked`=관심 채널 |
| is_monitored | boolean | not null default false | 과금 축(§8.4 관심 채널 수)의 계수 대상 |
| monitored_since | timestamptz | | |
| size_band | text | | `analysis.size_bands` 설정으로 산출, 캐시값 |
| last_seen_at | timestamptz | | |
| created_at | timestamptz | not null default now() | |
| deleted_at | timestamptz | | |

`unique (workspace_id, platform, external_id) where deleted_at is null`
`idx_ci_channels_monitored (workspace_id, is_monitored) where deleted_at is null`

### ci_channel_links (플랫폼 간 동일 채널, §11.3)
`id`, `workspace_id`, `channel_a_id`/`channel_b_id` FK cascade, `confidence` numeric(4,3),
`status` text check in ('suggested','confirmed','rejected') default 'suggested',
`evidence` jsonb, `decided_by` uuid, `decided_at`.
`unique (workspace_id, least(channel_a_id,channel_b_id), greatest(channel_a_id,channel_b_id))`
확정은 항상 사용자 — 자동 confirm 금지.

### ci_channel_connections (내 채널 OAuth, §10.3 그룹9)
`id`, `workspace_id`, `channel_id` FK cascade, `platform`,
`access_token_enc` bytea, `refresh_token_enc` bytea, `scopes` text[], `expires_at`,
`status` text check in ('connected','expired','revoked','error'), `last_error` text,
`connected_by` uuid, `connected_at`, `last_refreshed_at`.
`unique (workspace_id, channel_id)`
토큰은 반드시 암호화 컬럼(bytea). 평문 text 컬럼 금지.

---

## 6. 콘텐츠 (UCM 실체)

### ci_contents
| 필드 | 타입 | 제약 | 비고 |
|---|---|---|---|
| id | uuid | PK | |
| workspace_id | uuid | not null FK cascade | |
| platform | ci_platform | not null | |
| external_id | text | not null | |
| canonical_url | text | not null | |
| channel_id | uuid | FK ci_channels on delete set null | |
| format | ci_content_format | not null | |
| title | text | | |
| caption | text | | plain text 저장. HTML 유입 시 `html-to-plain` 경유 |
| published_at | timestamptz | | |
| duration_sec | integer | | |
| language | text | | |
| thumbnail_url | text | | |
| media_fingerprint | text | | 지각 해시. 같은 소재 묶음 1차 판정 |
| topic_id | uuid | FK ci_topics on delete set null | |
| topic_confidence | numeric(4,3) | | 0~1 |
| topic_source | ci_topic_source | not null default 'auto' | |
| ingest_status | ci_ingest_status | not null default 'queued' | |
| completeness | numeric(4,3) | not null default 0 | <0.8이면 화면에 '일부만 수집됨' |
| missing_fields | text[] | not null default '{}' | 탭 시 노출 목록 |
| comparability_class | ci_comparability | | |
| content_group_id | uuid | FK ci_content_groups on delete set null | |
| source | ci_content_source | not null | **통계는 monitoring만** (§7.3) |
| review_state | ci_review_state | not null default 'none' | 검토 큐 |
| is_stat_excluded | boolean | not null default false | 이상치·삭제 의심 제외 |
| deleted_detected_at | timestamptz | | 원본 삭제 감지 |
| provenance | jsonb | not null default '{}' | 수집 방법·시각·검증 상태 |
| first_seen_at | timestamptz | not null default now() | |
| last_refreshed_at | timestamptz | | |
| created_by | uuid | FK profiles(id) | 링크 투입자 |
| deleted_at | timestamptz | | |

인덱스
```sql
create unique index uq_ci_contents_ext
  on ci_contents (workspace_id, platform, external_id) where deleted_at is null;
create index idx_ci_contents_corpus              -- 트렌드/떡상 주 쿼리
  on ci_contents (workspace_id, topic_id, format, published_at desc)
  where source='monitoring' and is_stat_excluded=false and deleted_at is null;
create index idx_ci_contents_review              -- 수집함 검토 탭
  on ci_contents (workspace_id, review_state, first_seen_at desc) where deleted_at is null;
create index idx_ci_contents_status              -- 수집함 상태 탭(실패/일부만)
  on ci_contents (workspace_id, ingest_status, first_seen_at desc) where deleted_at is null;
create index idx_ci_contents_channel (channel_id, published_at desc);
create index idx_ci_contents_fingerprint (workspace_id, media_fingerprint) where media_fingerprint is not null;
```

**불변조건(설계서 §7.3 데이터 규칙):** `source='inbox'` 행은 배수·백분위 통계 집계에서 제외한다.
집계 쿼리는 `lib/ci/corpus.ts`의 `CORPUS_FILTER` 상수를 반드시 경유한다(복붙 금지).

### ci_content_metrics (시계열 스냅샷)
| 필드 | 타입 |
|---|---|
| content_id | uuid PK(1/2) FK cascade |
| captured_at | timestamptz PK(2/2) |
| views / likes / comments / shares / saves | bigint |
| source_method | text — 어떤 수집 방법으로 얻었는지 |
| is_estimated | boolean not null default false |

`idx_ci_metrics_content_time (content_id, captured_at desc)`
append-only. 갱신 금지(같은 시각 재수집은 `on conflict do nothing`).
보존 기간은 `data.retention_days` 설정에 따라 파티션 정리.

### ci_content_derived (계산 캐시)
| 필드 | 타입 | 비고 |
|---|---|---|
| content_id | uuid PK FK cascade | |
| outlier_index | numeric(8,2) | 같은 채널·같은 포맷 최근 20개 중앙값 대비 배수 |
| outlier_baseline_n | integer not null default 0 | **8 미만이면 화면 미표시** |
| topic_percentile | numeric(5,2) | 같은 주제·플랫폼·포맷·기간 창 내 백분위 |
| velocity_per_hour | numeric(12,2) | 조회 속도. 스냅샷 2점 이상일 때만 |
| confidence | ci_confidence not null default 'insufficient' | |
| window_days | integer not null | 산출에 쓴 기간 창(표시 시 병기 필수) |
| sample_json | jsonb | 포함 표본·제외 사유 — EvidenceSheet 원천 |
| computed_at | timestamptz not null default now() | |

`idx_ci_derived_outlier (outlier_index desc) where outlier_baseline_n >= 8`

### ci_content_groups (같은 소재 묶음)
`id`, `workspace_id`, `representative_content_id` FK, `method` text check in ('fingerprint','ai_similarity'),
`confidence` numeric(4,3), `created_at`. 해제는 `ci_corrections`에 기록 후 멤버의 `content_group_id`를 null.

---

## 7. 보드 · 성공 공식 · 이슈

### ci_boards
`id`, `workspace_id` FK cascade, `name` not null, `topic_id` FK set null, `created_by`, `created_at`, `deleted_at`.

### ci_board_items
`id`, `board_id` FK cascade, `item_type` text check in ('content','pattern','signal'), `item_id` uuid not null,
`note` text, `added_by`, `added_at`.
`unique (board_id, item_type, item_id)`
다형 참조라 FK를 걸 수 없다 → 삭제 정합성은 원본 삭제 시 정리 잡이 담당(§11 stage `project`).

### ci_patterns (성공 공식)
`id`, `workspace_id`, `topic_id` FK set null,
`kind` text check in ('title','hook','thumbnail','structure','timing'),
`statement` text not null — 화면에 그대로 노출되는 한 문장,
`lift` numeric(6,2), `evidence_count` integer not null, `channel_count` integer not null,
`confidence` ci_confidence not null, `computed_at`, `is_archived` boolean default false.
**표기 불변조건:** `lift`는 `evidence_count`·`channel_count` 병기 없이 렌더 금지(§4.3).

### ci_pattern_evidence
`pattern_id` PK(1/2) FK cascade, `content_id` PK(2/2) FK cascade, `weight` numeric.

### ci_signals (이슈)
`id`, `workspace_id`, `topic_id` FK set null,
`kind` text check in ('news','search_spike','community'),
`title`, `url`, `source`, `occurred_at`, `score` numeric, `payload` jsonb, `created_at`.
`idx_ci_signals_topic_time (workspace_id, topic_id, occurred_at desc)`

---

## 8. 제작

### ci_ideas
| 필드 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid not null FK cascade | |
| topic_id | uuid FK set null | |
| title | text not null | 가제 |
| note | text | |
| stage | ci_pipeline_stage not null default 'idea' | 칸반 열 |
| assignee_id | uuid FK profiles(id) | 후순위 기능이나 컬럼은 선반영 |
| target_platforms | ci_platform[] not null default '{}' | 카드 플랫폼 아이콘 |
| created_by | uuid | |
| created_at / stage_changed_at | timestamptz | 경과일 표시용 |
| archived_at | timestamptz | |

`idx_ci_ideas_board (workspace_id, stage, stage_changed_at desc) where archived_at is null`

### ci_idea_evidence (빵부스러기, §5.3)
`idea_id` FK cascade, `source_type` text check in ('content','pattern','signal'), `source_id` uuid,
PK(idea_id, source_type, source_id).
카드 배지 `근거: 떡상 3건, 공식 1건`의 원천. 탭하면 원본으로 되돌아간다.

### ci_briefs (기획안)
| 필드 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| workspace_id / idea_id | uuid not null FK cascade | |
| version | integer not null default 1 | 버전 비교 |
| parent_brief_id | uuid FK ci_briefs(id) | 부분 재생성 시 계보 |
| platform | ci_platform | 플랫폼별 변형이면 지정, 공통이면 null |
| title_options | jsonb not null default '[]' | 제목 시안 배열 |
| hook / script / caption | text | plain text |
| thumbnail_specs | jsonb | 썸네일 시안 프롬프트·선택 |
| tags | text[] | |
| status | text check in ('draft','ready') default 'draft' | |
| generated_by | text check in ('ai','user') | |
| created_by / created_at | | |

`unique (idea_id, version, coalesce(platform::text,''))`

### ci_edit_plans (편집안)
`id`, `workspace_id`, `brief_id` FK cascade, `variant_label` text, `timecodes` jsonb not null,
`export_status` text check in ('none','requested','done','failed'), `export_path` text, `created_at`.
한 기획안에 복수 편집안 허용(설계서 §7 P03 "Timecode 복수안").

### ci_assets (자료)
`id`, `workspace_id`, `brief_id` FK set null, `kind` text check in ('source','output'),
`storage_path` text not null, `mime` text, `bytes` bigint, `checksum` text,
`created_by`, `created_at`, `deleted_at`.
Supabase Storage 버킷 `ci-assets`(비공개). 경로만 DB에 저장.

---

## 9. 게시

### ci_publications
| 필드 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid not null FK cascade | |
| brief_id | uuid FK set null | |
| channel_id | uuid FK ci_channels set null | ownership='owned'만 허용(트리거 검증) |
| platform | ci_platform not null | |
| route | ci_publish_route not null | manual=기본, api=선택 |
| status | ci_publish_status not null default 'draft' | |
| scheduled_at / published_at | timestamptz | |
| published_url | text | 수동 경로에서 사용자가 입력 |
| external_content_id | text | |
| tracked_content_id | uuid FK ci_contents set null | **루프를 닫는 연결** |
| checklist | jsonb | 수동 게시 체크리스트 결과 |
| spec_check | jsonb | 규격 검사 결과 |
| error_code / error_message | text | 실패 시 원인 노출(침묵 실패 금지) |
| created_by / created_at / updated_at | | |

`idx_ci_publications_calendar (workspace_id, coalesce(published_at, scheduled_at) desc)`
`idx_ci_publications_ready (workspace_id, status) where status in ('draft','scheduled')`

**소급 추적:** `published_url`만 입력되어도 ingest 잡이 생성되어 `ci_contents`(source='monitoring',
ownership='owned' 채널)로 흡수되고 `tracked_content_id`가 채워진다. 게시 경로와 무관하게 루프가 닫힌다.

---

## 10. 잡 인프라 (설계서 §11.2)

### ci_jobs
| 필드 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK cascade | 시스템 잡은 null 허용 |
| stage | ci_job_stage not null | 6단계 |
| idempotency_key | text not null **unique** | `{stage}:{target_id}:{version}` — 중복 실행 차단 |
| target_type | text not null | 'content','channel','topic',… |
| target_id | uuid | |
| payload | jsonb not null default '{}' | |
| status | ci_job_status not null default 'queued' | |
| attempt | integer not null default 0 | |
| max_attempts | integer not null default 3 | 지수 백오프 3회 |
| next_run_at | timestamptz not null default now() | |
| locked_at / locked_by | timestamptz / text | 워커 임대 |
| error_code / error_message | text | |
| created_at / updated_at | timestamptz | |

```sql
create unique index uq_ci_jobs_idem on ci_jobs (idempotency_key);
create index idx_ci_jobs_claim on ci_jobs (status, next_run_at)
  where status in ('queued','failed');          -- 워커 클레임 경로
create index idx_ci_jobs_dlq on ci_jobs (workspace_id, stage, updated_at desc)
  where status='dead';                          -- 실패 큐 화면
```
클레임은 `for update skip locked`로 단일 쿼리 처리. `status='dead'`가 DLQ이며
설계서 §11.6대로 24시간 내 처리 대상이다.

### ci_job_runs (전 이력)
`id`, `job_id` FK cascade, `attempt` integer, `started_at`, `finished_at`,
`status` ci_job_status, `error_code`, `error_message`, `duration_ms` integer,
`tokens_used` integer, `cost_krw` numeric(12,2).
`idx_ci_job_runs_job (job_id, attempt)` · `idx_ci_job_runs_stats (started_at desc)`
운영자 콘솔의 단계별 성공률·처리 지연·실패 사유 상위 목록이 이 테이블에서 나온다.

### ci_snapshot_schedules
`id`, `workspace_id`, `content_id` FK cascade unique, `next_capture_at` timestamptz not null,
`interval_sec` integer not null, `preset` text check in ('economy','standard','precise'),
`stop_after` timestamptz, `captures_done` integer default 0.
`idx_ci_snapshot_due (next_capture_at) where stop_after is null or stop_after > now()`
나이별 간격 정책(신규는 촘촘, 오래된 것은 성기게)이 `interval_sec`을 갱신한다 — 비용 폭증 방어(§13).

---

## 11. 정정 학습 · 알림 · 과금

### ci_corrections (§11.4)
`id`, `workspace_id`, `kind` ci_correction_kind not null, `target_type` text, `target_id` uuid,
`before_value` jsonb, `after_value` jsonb, `actor_id` uuid, `created_at`,
`promoted_rule_id` uuid FK ci_topic_rules set null.
`idx_ci_corrections_kind (workspace_id, kind, created_at desc)`
동일 정정 반복 시 포함/제외 규칙 승격을 제안하고, 승격되면 `promoted_rule_id`가 채워진다.

### ci_alert_rules (§8.1)
`id`, `workspace_id`, `kind` text check in ('outlier','daily_brief'),
`threshold` numeric default 3, `scope_type` text check in ('all','topic','channel'), `scope_id` uuid,
`delivery` text[] default '{push,email}', `send_at` time, `quiet_hours` jsonb,
`is_enabled` boolean default true.

### ci_notifications
`id`, `workspace_id`, `user_id` FK profiles, `rule_id` FK set null, `content_id` FK set null,
`title`, `body`, `deeplink` text, `sent_at`, `read_at`, `delivery_result` jsonb.
`idx_ci_notifications_user (user_id, sent_at desc)`
`unique (rule_id, content_id, user_id)` — 같은 콘텐츠 중복 알림 차단.

### ci_plans (system)
`id`, `code` text unique, `name`, `limits` jsonb not null, `price_krw` integer, `is_active` boolean.
`limits` 예: `{"tracked_channels":30,"ai_calls_per_day":200,"snapshot_preset":"standard","members":3}`

### ci_subscriptions
`workspace_id` PK FK cascade, `plan_id` FK ci_plans, `status` text check in
('trial','active','past_due','canceled'), `current_period_start/end`, `pg_customer_id`,
`pg_subscription_id`, `canceled_at`.

### ci_usage_counters
`workspace_id` PK(1/3) FK cascade, `metric` text PK(2/3) check in
('tracked_channels','ai_calls','snapshots'), `period_start` date PK(3/3), `value` bigint not null default 0.
증가는 `insert … on conflict do update set value = ci_usage_counters.value + excluded.value` (원자적).
한도 초과 판정은 `ci_plans.limits`와 대조 — **사용자 저장 자체를 막지 않고** 해당 기능만 게이트한다.

---

## 12. RLS 정책 (전 테이블 필수)

기본 헬퍼:
```sql
create or replace function ci_is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ci_workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create or replace function ci_role(ws uuid) returns ci_member_role
language sql stable security definer set search_path = public as $$
  select role from ci_workspace_members
  where workspace_id = ws and user_id = auth.uid();
$$;
```

| 테이블군 | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|
| 테넌트 전 테이블 | `ci_is_member(workspace_id)` | 동일 + `ci_role(...) <> 'viewer'` | `ci_role(...) in ('owner','admin')` |
| `ci_workspaces` | 멤버 | owner/admin | owner만(유예 삭제) |
| `ci_workspace_members` | 멤버 | owner/admin | owner/admin, 단 owner 행 삭제 금지(트리거) |
| `ci_settings` scope=user | `scope_id = auth.uid()` | 동일 | 동일 |
| `ci_settings` scope=workspace | 멤버 | owner/admin | owner/admin |
| `ci_settings` scope=system | 앱 admin(`profiles.role='admin'`) | 동일 | 동일 |
| `ci_setting_audits` | 멤버(해당 스코프) | **service_role만** | **전면 차단** |
| `ci_job_runs`, `ci_jobs` | 멤버(읽기) | **service_role만** | 차단 |
| `ci_plans`, `ci_platform_profiles` | 인증 사용자 전체 | 앱 admin | 앱 admin |

잡 워커는 `service_role`로 동작한다 — RLS 우회가 필요하므로 워커 코드는 `createAdminClient()` 경유이며
**요청 경로(route handler)에서 admin 클라이언트로 콘텐츠를 쓰지 않는다**(권한 우회 방지).

---

## 13. 마이그레이션 분할 (184~190)

| 번호 | 파일 | 내용 |
|---|---|---|
| 184 | `184_ci_enums_and_workspace.sql` | ENUM 17종, `ci_workspaces`, `ci_workspace_members`, `ci_invitations`, 헬퍼 함수, owner 단일성 트리거 |
| 185 | `185_ci_settings.sql` | `ci_settings`, `ci_setting_audits`, 감사 트리거(never-block) |
| 186 | `186_ci_taxonomy_channels.sql` | `ci_topics`, `ci_topic_rules`, `ci_platform_profiles`(+시드 6종), `ci_channels`, `ci_channel_links`, `ci_channel_connections` |
| 187 | `187_ci_contents.sql` | `ci_content_groups`, `ci_contents`, `ci_content_metrics`, `ci_content_derived` |
| 188 | `188_ci_boards_patterns.sql` | `ci_boards`, `ci_board_items`, `ci_patterns`, `ci_pattern_evidence`, `ci_signals` |
| 189 | `189_ci_production_publish.sql` | `ci_ideas`, `ci_idea_evidence`, `ci_briefs`, `ci_edit_plans`, `ci_assets`, `ci_publications` |
| 190 | `190_ci_jobs_ops.sql` | `ci_jobs`, `ci_job_runs`, `ci_snapshot_schedules`, `ci_corrections`, `ci_alert_rules`, `ci_notifications`, `ci_plans`, `ci_subscriptions`, `ci_usage_counters` |

각 파일은 RLS enable + 정책까지 포함해 자기완결로 작성한다.
적용은 `PGPASSWORD='…' ./scripts/migrate.sh 184_ci_enums_and_workspace.sql` 순차.
**기존 테이블은 한 줄도 수정하지 않는다** — CI는 순수 추가분이다.
