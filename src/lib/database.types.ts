export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      alert_events: {
        Row: {
          fired_at: string
          graph_id: string
          id: string
          message: string
          node_id: string | null
          payload: Json
          rule_id: string | null
          seen: boolean
        }
        Insert: {
          fired_at?: string
          graph_id: string
          id?: string
          message: string
          node_id?: string | null
          payload?: Json
          rule_id?: string | null
          seen?: boolean
        }
        Update: {
          fired_at?: string
          graph_id?: string
          id?: string
          message?: string
          node_id?: string | null
          payload?: Json
          rule_id?: string | null
          seen?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_graph_id_fkey"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_graph_id_node_id_fkey"
            columns: ["graph_id", "node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
          {
            foreignKeyName: "alert_events_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          active: boolean
          created_at: string
          graph_id: string
          id: string
          kind: string
          node_id: string | null
          threshold: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          graph_id: string
          id?: string
          kind: string
          node_id?: string | null
          threshold?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          graph_id?: string
          id?: string
          kind?: string
          node_id?: string | null
          threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_graph_id_fkey"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_rules_graph_id_node_id_fkey"
            columns: ["graph_id", "node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
        ]
      }
      assets: {
        Row: {
          caption: string | null
          created_at: string
          graph_id: string
          id: string
          kind: string
          node_id: string | null
          storage_path: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          graph_id: string
          id?: string
          kind: string
          node_id?: string | null
          storage_path: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          graph_id?: string
          id?: string
          kind?: string
          node_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_graph_fk"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_node_fk"
            columns: ["graph_id", "node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
        ]
      }
      digest_log: {
        Row: {
          created_at: string
          digest_date: string
          graph_id: string
          html: string | null
          id: string
          resend_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          digest_date: string
          graph_id: string
          html?: string | null
          id?: string
          resend_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          digest_date?: string
          graph_id?: string
          html?: string | null
          id?: string
          resend_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "digest_log_graph_id_fkey"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
        ]
      }
      edges: {
        Row: {
          assertable: boolean | null
          confidence: number
          created_at: string
          dst_id: string
          dst_module: string
          evidence_quote: string | null
          graph_id: string
          id: string
          method: string
          relation_type: string
          source_upload_id: string | null
          src_id: string
          src_module: string
          support_count: number
          type: string
        }
        Insert: {
          assertable?: boolean | null
          confidence?: number
          created_at?: string
          dst_id: string
          dst_module?: string
          evidence_quote?: string | null
          graph_id: string
          id?: string
          method?: string
          relation_type?: string
          source_upload_id?: string | null
          src_id: string
          src_module?: string
          support_count?: number
          type: string
        }
        Update: {
          assertable?: boolean | null
          confidence?: number
          created_at?: string
          dst_id?: string
          dst_module?: string
          evidence_quote?: string | null
          graph_id?: string
          id?: string
          method?: string
          relation_type?: string
          source_upload_id?: string | null
          src_id?: string
          src_module?: string
          support_count?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_dst_fk"
            columns: ["graph_id", "dst_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
          {
            foreignKeyName: "edges_graph_fk"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_source_upload_id_fkey"
            columns: ["source_upload_id"]
            isOneToOne: false
            referencedRelation: "raw_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_src_fk"
            columns: ["graph_id", "src_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
        ]
      }
      graphs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "graphs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_snapshots: {
        Row: {
          as_of: string | null
          captured_at: string
          graph_id: string
          id: string
          metric: string
          node_id: string
          source: string | null
          source_upload_id: string | null
          unit: string | null
          value: number | null
        }
        Insert: {
          as_of?: string | null
          captured_at?: string
          graph_id: string
          id?: string
          metric: string
          node_id: string
          source?: string | null
          source_upload_id?: string | null
          unit?: string | null
          value?: number | null
        }
        Update: {
          as_of?: string | null
          captured_at?: string
          graph_id?: string
          id?: string
          metric?: string
          node_id?: string
          source?: string | null
          source_upload_id?: string | null
          unit?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_snapshots_graph_id_node_id_fkey"
            columns: ["graph_id", "node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
          {
            foreignKeyName: "metric_snapshots_source_upload_id_fkey"
            columns: ["source_upload_id"]
            isOneToOne: false
            referencedRelation: "raw_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      node_merge_candidates: {
        Row: {
          created_at: string
          graph_id: string
          id: string
          left_id: string
          resolved_at: string | null
          right_id: string
          score: number
          status: string
        }
        Insert: {
          created_at?: string
          graph_id: string
          id?: string
          left_id: string
          resolved_at?: string | null
          right_id: string
          score: number
          status?: string
        }
        Update: {
          created_at?: string
          graph_id?: string
          id?: string
          left_id?: string
          resolved_at?: string | null
          right_id?: string
          score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_merge_candidates_graph_fk"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_merge_candidates_left_fk"
            columns: ["graph_id", "left_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
          {
            foreignKeyName: "node_merge_candidates_right_fk"
            columns: ["graph_id", "right_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
        ]
      }
      node_revisions: {
        Row: {
          changed_at: string
          graph_id: string
          id: string
          node_id: string
          prior_data: Json
          prior_status: string | null
          prior_title: string | null
          reason: string
          source_upload_id: string | null
        }
        Insert: {
          changed_at?: string
          graph_id: string
          id?: string
          node_id: string
          prior_data: Json
          prior_status?: string | null
          prior_title?: string | null
          reason: string
          source_upload_id?: string | null
        }
        Update: {
          changed_at?: string
          graph_id?: string
          id?: string
          node_id?: string
          prior_data?: Json
          prior_status?: string | null
          prior_title?: string | null
          reason?: string
          source_upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "node_revisions_graph_id_node_id_fkey"
            columns: ["graph_id", "node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
          {
            foreignKeyName: "node_revisions_source_upload_id_fkey"
            columns: ["source_upload_id"]
            isOneToOne: false
            referencedRelation: "raw_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          contributor: string | null
          created_at: string
          data: Json
          data_as_of: string | null
          embedding: string | null
          graph_id: string
          id: string
          last_judged_at: string | null
          lifecycle: string
          module: string
          search: unknown
          source_upload_id: string | null
          status: string | null
          superseded_by: string | null
          tags: string[]
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          contributor?: string | null
          created_at?: string
          data?: Json
          data_as_of?: string | null
          embedding?: string | null
          graph_id: string
          id: string
          last_judged_at?: string | null
          lifecycle?: string
          module?: string
          search?: unknown
          source_upload_id?: string | null
          status?: string | null
          superseded_by?: string | null
          tags?: string[]
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          contributor?: string | null
          created_at?: string
          data?: Json
          data_as_of?: string | null
          embedding?: string | null
          graph_id?: string
          id?: string
          last_judged_at?: string | null
          lifecycle?: string
          module?: string
          search?: unknown
          source_upload_id?: string | null
          status?: string | null
          superseded_by?: string | null
          tags?: string[]
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nodes_contributor_fkey"
            columns: ["contributor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_graph_fk"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_source_upload_id_fkey"
            columns: ["source_upload_id"]
            isOneToOne: false
            referencedRelation: "raw_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_superseded_by_fk"
            columns: ["graph_id", "superseded_by"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
        ]
      }
      price_snapshots: {
        Row: {
          captured_at: string
          change_pct: number | null
          graph_id: string
          id: string
          market_cap: number | null
          node_id: string
          price: number | null
          ticker: string
        }
        Insert: {
          captured_at?: string
          change_pct?: number | null
          graph_id: string
          id?: string
          market_cap?: number | null
          node_id: string
          price?: number | null
          ticker: string
        }
        Update: {
          captured_at?: string
          change_pct?: number | null
          graph_id?: string
          id?: string
          market_cap?: number | null
          node_id?: string
          price?: number | null
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_snapshots_graph_id_node_id_fkey"
            columns: ["graph_id", "node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          current_graph_id: string | null
          email: string
          id: string
          is_admin: boolean
          name: string | null
          role: string | null
          status: string
        }
        Insert: {
          created_at?: string
          current_graph_id?: string | null
          email: string
          id: string
          is_admin?: boolean
          name?: string | null
          role?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          current_graph_id?: string | null
          email?: string
          id?: string
          is_admin?: boolean
          name?: string | null
          role?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_current_graph_id_fkey"
            columns: ["current_graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_uploads: {
        Row: {
          contributor: string
          created_at: string
          error: string | null
          graph_id: string
          id: string
          kind: string
          processed_at: string | null
          raw_text: string | null
          source_ref: string | null
          status: string
          storage_path: string | null
          usage: Json | null
        }
        Insert: {
          contributor: string
          created_at?: string
          error?: string | null
          graph_id: string
          id?: string
          kind: string
          processed_at?: string | null
          raw_text?: string | null
          source_ref?: string | null
          status?: string
          storage_path?: string | null
          usage?: Json | null
        }
        Update: {
          contributor?: string
          created_at?: string
          error?: string | null
          graph_id?: string
          id?: string
          kind?: string
          processed_at?: string | null
          raw_text?: string | null
          source_ref?: string | null
          status?: string
          storage_path?: string | null
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_uploads_contributor_fkey"
            columns: ["contributor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_uploads_graph_fk"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_jobs: {
        Row: {
          cost_usd: number
          created_at: string
          error: string | null
          graph_id: string
          id: string
          params: Json
          prompt: string
          requester: string
          result_node_id: string | null
          result_summary: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          error?: string | null
          graph_id: string
          id?: string
          params?: Json
          prompt: string
          requester: string
          result_node_id?: string | null
          result_summary?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          error?: string | null
          graph_id?: string
          id?: string
          params?: Json
          prompt?: string
          requester?: string
          result_node_id?: string | null
          result_summary?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_jobs_graph_id_fkey"
            columns: ["graph_id"]
            isOneToOne: false
            referencedRelation: "graphs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_jobs_requester_fkey"
            columns: ["requester"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_entities: {
        Row: {
          candidate_status: string
          created_at: string
          graph_id: string
          kind: string
          last_surfaced_at: string
          node_id: string
          score: number
          source: string
        }
        Insert: {
          candidate_status?: string
          created_at?: string
          graph_id: string
          kind: string
          last_surfaced_at?: string
          node_id: string
          score?: number
          source?: string
        }
        Update: {
          candidate_status?: string
          created_at?: string
          graph_id?: string
          kind?: string
          last_surfaced_at?: string
          node_id?: string
          score?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_entities_graph_id_node_id_fkey"
            columns: ["graph_id", "node_id"]
            isOneToOne: true
            referencedRelation: "nodes"
            referencedColumns: ["graph_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_raw_uploads: {
        Args: { batch?: number }
        Returns: {
          contributor: string
          created_at: string
          error: string | null
          graph_id: string
          id: string
          kind: string
          processed_at: string | null
          raw_text: string | null
          source_ref: string | null
          status: string
          storage_path: string | null
          usage: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "raw_uploads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_research_job: {
        Args: { p_job_id: string }
        Returns: {
          cost_usd: number
          created_at: string
          error: string | null
          graph_id: string
          id: string
          params: Json
          prompt: string
          requester: string
          result_node_id: string | null
          result_summary: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "research_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_active: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      match_nodes: {
        Args: {
          exclude_id?: string
          match_count?: number
          match_threshold?: number
          p_graph_id: string
          p_include_hidden?: boolean
          query_embedding: string
        }
        Returns: {
          id: string
          similarity: number
          title: string
          type: string
        }[]
      }
      merge_nodes: {
        Args: { drop_id: string; keep_id: string; p_graph_id: string }
        Returns: undefined
      }
      prune_snapshots: { Args: { p_graph_id: string }; Returns: undefined }
      upsert_edge: {
        Args: {
          p_confidence: number
          p_dst_id: string
          p_evidence_quote?: string
          p_graph_id: string
          p_method: string
          p_relation_type: string
          p_source_upload_id?: string
          p_src_id: string
          p_type: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

