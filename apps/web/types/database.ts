// GPU Pricing types
export interface GpuSupplier {
  id: string
  name: string
  location: string | null
  contact: string | null
  color: string | null
  created_at: string
}

export interface GpuProduct {
  id: string
  model_name: string
  memory: string
  tier: 1 | 2 | 3
  pricing_mode: 'quote' | 'direct'
  created_at: string
}

export interface SupplyQuote {
  id: string
  product_id: string | null
  supplier_id: string | null
  unit_price_usd: number
  original_currency: string | null
  original_price: number | null
  original_unit: string | null
  term: string | null
  min_qty: string | null
  valid_until: string | null
  source_format: string | null
  evidence_drive_file_id: string | null
  evidence_hash: string | null
  ai_confidence: number | null
  status: string
  received_at: string | null
  registered_by: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  created_at: string
}

export interface DirectPrice {
  id: string
  product_id: string | null
  sell_price_krw: number
  note: string | null
  set_by: string | null
  set_at: string
  is_current: boolean
}

export interface FxRate {
  rate_date: string
  usd_krw: number
  source: string
  fetched_at: string
}

export interface PricingSettings {
  id: number
  margin_pct: number
  updated_by: string | null
  updated_at: string
}

export interface GpuAuditLog {
  id: string
  ts: string
  actor: string | null
  action_type: string | null
  product_id: string | null
  detail: Record<string, unknown> | null
  evidence_ref: string | null
}

export interface VLowestQuote {
  product_id: string | null
  quote_id: string | null
  supplier_id: string | null
  unit_price_usd: number | null
  valid_until: string | null
}

export interface OAuthToken {
  id: string
  provider: string
  access_token: string
  refresh_token: string
  token_expiry: string
  account_email: string
  updated_at: string
}

export interface OAuthTokenInsert {
  provider: string
  access_token: string
  refresh_token: string
  token_expiry: string
  account_email: string
  updated_at?: string
}

export interface Profile {
  id: string
  name: string
  rank: string | null
  position: string | null
  role: 'admin' | 'member'
  must_change_password: boolean
  /** 개인 선택 디자인 테마 id. NULL = 전역 디폴트 추종. 값 검증은 isThemeId(앱 계층). */
  theme_preference: string | null
  /** 온보딩 완료 시각. NULL = 미완료(자동시작 대상). 마이그레이션 113(BE). */
  onboarding_completed_at: string | null
  /** 마지막 도달 온보딩 스텝 key(재개용). 마이그레이션 113(BE). */
  onboarding_step: string | null
  /** 온보딩 스킵 시각. 완료와 구분. 마이그레이션 113(BE). */
  onboarding_skipped_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface WeeklyReport {
  id: string
  user_id: string
  week_start: string
  category: string
  seq: number
  performance: string
  plan: string
  issues: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface KpiEntry {
  id: string
  user_id: string
  metric_name: string
  value: number
  unit: string
  period_start: string
  period_end: string
  kpi_template_label: string | null
  created_at: string
  updated_at: string
}

export interface RoutineCheck {
  id: string
  user_id: string
  routine_name: string
  check_date: string
  week_start: string
  is_completed: boolean
  created_at: string
  updated_at: string
}

export interface Account {
  id: string
  user_id: string
  name: string
  industry: string | null
  segment: 'T1' | 'T2' | '공공' | '파트너' | '엔터프라이즈' | 'SMB' | '스타트업' | null
  size: string | null
  region: string | null
  website: string | null
  phone: string | null
  address: string | null
  description: string | null
  fit_score: number | null
  fit_reason: string | null
  tags: string[]
  source: string | null
  account_type: string | null
  gpu_demand_intensity: string | null
  registration_number: string | null
  owner_user_id: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  account_id: string | null
  user_id: string
  name: string
  title: string | null
  department: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  linkedin: string | null
  notes: string | null
  business_card_drive_id: string | null
  role: string | null
  created_at: string
  updated_at: string
}

export type DealStage = '신규' | '검증' | '컨택' | 'PoC' | '제안' | '협상' | '수주' | '실패'

export interface Deal {
  id: string
  account_id: string | null
  contact_id: string | null
  user_id: string
  title: string
  stage: DealStage
  value: number | null
  probability: number
  close_date: string | null
  description: string | null
  next_action: string | null
  next_action_date: string | null
  tags: string[]
  lead_type: string | null
  product: string | null
  fit_score: number | null
  hw_included: boolean
  is_new_deal: boolean
  expected_date: string | null
  funding_source: string | null
  procurement_status: string | null
  source: string | null
  created_at: string
  updated_at: string
}

export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'ai'

export interface DealActivity {
  id: string
  deal_id: string
  user_id: string
  type: ActivityType
  content: string
  ai_parsed: boolean
  ai_extracted: boolean
  extracted_todos: Json
  extracted_events: Json
  suggested_stage: string | null
  created_at: string
}

export type LeadSource = 'prompt' | 'business_card' | 'file' | 'manual' | 'xlsx_bulk' | 'card_scan' | 'voice'
export type LeadStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'crm_registered'

export interface LeadIntake {
  id: string
  user_id: string
  source: LeadSource
  raw_input: string | null
  file_url: string | null
  status: LeadStatus
  parsed_data: Json | null
  linked_account_id: string | null
  linked_contact_id: string | null
  linked_deal_id: string | null
  fit_score: number | null
  duplicate_of: string | null
  supplement_questions: Json
  duplicate_flags: Json
  original_file_name: string | null
  converted_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type DailyLogEntryType = 'done' | 'doing' | 'planned' | 'blocker' | 'note'

export type DailyLogPriority = 'urgent' | 'high' | 'normal' | 'low'

export type DailyLogTargetDateSetBy = 'ai' | 'user'
export type DailyLogSourceType = 'manual' | 'ai_split' | 'ai_derived' | 'thread_derived'
export type DailyLogRelationType = 'derived_from' | 'blocks' | 'related' | 'mentioned'
export type TagType = 'ai' | 'user'

export interface DailyLog {
  id: string
  user_id: string
  log_date: string
  logged_at: string
  content: string
  entry_type: DailyLogEntryType
  is_resolved: boolean
  priority: DailyLogPriority
  scheduled_at: string | null
  ai_processed: boolean
  ai_confidence: number | null
  original_input: string | null
  linked_account_id: string | null
  linked_contact_id: string | null
  // 관계 시스템 필드 (022 migration)
  target_date: string | null
  target_date_set_by: DailyLogTargetDateSetBy | null
  origin_group_id: string | null
  parent_log_id: string | null
  source_type: DailyLogSourceType | null
  // AI 파생 관계 설명 (023 migration)
  flow_reason: string | null
  // 메모 발견·처리 시스템 (042 migration) — entry_type='note'만 사용
  memo_status: MemoStatus | null
  memo_reviewed_at: string | null
  // 부서 업무 관리 (075 migration) — task_kind='dept_task'만 사용
  task_kind: DailyLogTaskKind
  assignee_user_id: string | null
  department_id: string | null
  progress: number
  checklist: DeptTaskChecklistItem[]
  // 일일→부서 승격 참조 (104 migration) — dept_task 행이 원본 personal 일일 id를 가리킴
  promoted_from_log_id: string | null
  // 회의노트 파생 업무 역참조 (117 migration) — 회의에서 생성된 일일업무가 원본 회의노트 id를 가리킴
  meeting_note_id: string | null
  // 소프트삭제(146 migration) — null이면 활성 행. 삭제는 UPDATE로만(하드삭제 금지, 복구 전제).
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type DailyLogTaskKind = 'personal' | 'dept_task'

export interface DeptTaskChecklistItem {
  label: string
  done: boolean
}

export type MemoStatus = 'new' | 'reviewed' | 'actioned'

export interface DailyLogOriginGroup {
  id: string
  user_id: string
  original_input: string
  created_at: string
}

export interface DailyLogRelation {
  id: string
  from_log_id: string
  to_log_id: string
  relation_type: DailyLogRelationType
  created_by: 'ai' | 'user'
  created_at: string
}

export interface DailyLogThread {
  id: string
  log_id: string
  author_type: 'user' | 'ai'
  content: string
  ai_analysis: Record<string, unknown> | null
  ai_actions_taken: Record<string, unknown> | null
  prompt_key: string | null
  prompt_version: string | null
  // 부서 업무 댓글 (075 migration)
  author_user_id: string | null
  parent_thread_id: string | null
  created_at: string
}

export interface DailyLogTag {
  id: string
  log_id: string
  tag_name: string
  tag_type: TagType
  created_at: string
}

export interface AiPrompt {
  id: string
  prompt_key: string
  version: string
  model_hint: string
  content: string
  output_schema: Record<string, unknown> | null
  active: boolean
  created_at: string
}

export type AiFeature =
  | 'weekly-report-refine'
  | 'report-preview-merge'
  | 'report-export'
  | 'lead-parse'
  | 'account-fit-score'
  | 'deal-activity-parse'
  | 'content-ai-edit'
  | 'daily-ai-save'
  | 'gpu-quote-extract'
  | 'gpu-quote-reanalyze'
  | 'gpu-spec-generate'
  | 'gpu-db-chat'
  | 'gpu-company-enrich'
  | 'memo-embedding'
  | 'memo-cluster-label'
  | 'dept-task-suggest'
  | 'project-suggest'
  | 'meeting_summarize'
  | 'meeting_extract'

export interface AiTokenLog {
  id: string
  created_at: string
  user_id: string | null
  feature: AiFeature
  model: string
  prompt_tokens: number
  output_tokens: number
  total_tokens: number
  success: boolean
  error_message: string | null
}

export interface OrgContent {
  key: string
  value: Json
  created_at: string
  updated_at: string
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>
        Relationships: []
      }
      weekly_reports: {
        Row: WeeklyReport
        Insert: Omit<WeeklyReport, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<WeeklyReport, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'weekly_reports_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      kpi_entries: {
        Row: KpiEntry
        Insert: Omit<KpiEntry, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<KpiEntry, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'kpi_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      routine_checks: {
        Row: RoutineCheck
        Insert: Omit<RoutineCheck, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<RoutineCheck, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'routine_checks_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      daily_logs: {
        Row: DailyLog
        Insert: Omit<DailyLog, 'id' | 'logged_at' | 'created_at' | 'updated_at' | 'deleted_at'>
        Update: Partial<Omit<DailyLog, 'id' | 'user_id' | 'log_date' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'daily_logs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      ai_token_logs: {
        Row: AiTokenLog
        Insert: Omit<AiTokenLog, 'id' | 'created_at'>
        Update: Partial<Omit<AiTokenLog, 'id' | 'created_at'>>
        Relationships: [
          {
            foreignKeyName: 'ai_token_logs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      oauth_tokens: {
        Row: OAuthToken
        Insert: OAuthTokenInsert
        Update: Partial<OAuthTokenInsert>
        Relationships: []
      }
      suppliers: {
        Row: { [K in keyof GpuSupplier]: GpuSupplier[K] }
        Insert: { [K in keyof Omit<GpuSupplier, 'id' | 'created_at'>]: Omit<GpuSupplier, 'id' | 'created_at'>[K] }
        Update: { [K in keyof Partial<Omit<GpuSupplier, 'id' | 'created_at'>>]: Partial<Omit<GpuSupplier, 'id' | 'created_at'>>[K] }
        Relationships: []
      }
      gpu_products: {
        Row: { [K in keyof GpuProduct]: GpuProduct[K] }
        Insert: { [K in keyof Omit<GpuProduct, 'id' | 'created_at'>]: Omit<GpuProduct, 'id' | 'created_at'>[K] }
        Update: { [K in keyof Partial<Omit<GpuProduct, 'id' | 'created_at'>>]: Partial<Omit<GpuProduct, 'id' | 'created_at'>>[K] }
        Relationships: []
      }
      supply_quotes: {
        Row: { [K in keyof SupplyQuote]: SupplyQuote[K] }
        Insert: { [K in keyof Omit<SupplyQuote, 'id' | 'created_at'>]: Omit<SupplyQuote, 'id' | 'created_at'>[K] }
        Update: { [K in keyof Partial<Omit<SupplyQuote, 'id' | 'created_at'>>]: Partial<Omit<SupplyQuote, 'id' | 'created_at'>>[K] }
        Relationships: []
      }
      direct_prices: {
        Row: { [K in keyof DirectPrice]: DirectPrice[K] }
        Insert: { [K in keyof Omit<DirectPrice, 'id' | 'set_at'>]: Omit<DirectPrice, 'id' | 'set_at'>[K] }
        Update: { [K in keyof Partial<Omit<DirectPrice, 'id' | 'set_at'>>]: Partial<Omit<DirectPrice, 'id' | 'set_at'>>[K] }
        Relationships: []
      }
      fx_rates: {
        Row: { [K in keyof FxRate]: FxRate[K] }
        Insert: { [K in keyof Omit<FxRate, 'fetched_at'>]: Omit<FxRate, 'fetched_at'>[K] }
        Update: { [K in keyof Partial<Omit<FxRate, 'fetched_at'>>]: Partial<Omit<FxRate, 'fetched_at'>>[K] }
        Relationships: []
      }
      pricing_settings: {
        Row: { [K in keyof PricingSettings]: PricingSettings[K] }
        Insert: { [K in keyof Partial<PricingSettings>]: Partial<PricingSettings>[K] }
        Update: { [K in keyof Partial<PricingSettings>]: Partial<PricingSettings>[K] }
        Relationships: []
      }
      gpu_audit_logs: {
        Row: { [K in keyof GpuAuditLog]: GpuAuditLog[K] }
        Insert: { [K in keyof Omit<GpuAuditLog, 'id' | 'ts'>]: Omit<GpuAuditLog, 'id' | 'ts'>[K] }
        Update: { [K in keyof Partial<Omit<GpuAuditLog, 'id' | 'ts'>>]: Partial<Omit<GpuAuditLog, 'id' | 'ts'>>[K] }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
