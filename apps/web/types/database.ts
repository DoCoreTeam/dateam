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
  role: 'admin' | 'member'
  must_change_password: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface WeeklyReport {
  id: string
  user_id: string
  week_start: string
  category: string
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
  created_at: string
  updated_at: string
}

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
        Insert: Omit<DailyLog, 'id' | 'logged_at' | 'created_at' | 'updated_at'>
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
