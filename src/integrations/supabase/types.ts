export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_decisions: {
        Row: {
          created_at: string | null
          decided_by: string
          decision: string
          dispute_id: string
          id: string
          release_amount: number | null
        }
        Insert: {
          created_at?: string | null
          decided_by: string
          decision: string
          dispute_id: string
          id?: string
          release_amount?: number | null
        }
        Update: {
          created_at?: string | null
          decided_by?: string
          decision?: string
          dispute_id?: string
          id?: string
          release_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_decisions_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          auto_execute_at: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          initiated_by: string
          proposed_action: string
          proposed_amount: number | null
          reason: string
          receipt_id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          auto_execute_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          initiated_by: string
          proposed_action: string
          proposed_amount?: number | null
          reason: string
          receipt_id: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          auto_execute_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          initiated_by?: string
          proposed_action?: string
          proposed_amount?: number | null
          reason?: string
          receipt_id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence: {
        Row: {
          created_at: string | null
          dispute_id: string
          file_path: string
          id: string
          type: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string | null
          dispute_id: string
          file_path: string
          id?: string
          type?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string | null
          dispute_id?: string
          file_path?: string
          id?: string
          type?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          created_at: string | null
          display_name: string | null
          email: string | null
          fingerprint_enabled: boolean | null
          id: string
          updated_at: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          fingerprint_enabled?: boolean | null
          id: string
          updated_at?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          fingerprint_enabled?: boolean | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      receipts: {
        Row: {
          amount: number
          amount_paid: number | null
          created_at: string | null
          created_by: string
          decision_auto_execute_at: string | null
          description: string
          escrow_code: string | null
          id: string
          paid_at: string | null
          payscrow_fee: number | null
          payscrow_transaction_number: string | null
          payscrow_transaction_ref: string | null
          receiver_decision: string | null
          receiver_decision_reason: string | null
          receiver_email: string
          receiver_id: string | null
          sender_decision: string | null
          sender_decision_amount: number | null
          sender_decision_reason: string | null
          sender_id: string
          status: string
          surer_fee: number | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          amount_paid?: number | null
          created_at?: string | null
          created_by: string
          decision_auto_execute_at?: string | null
          description: string
          escrow_code?: string | null
          id?: string
          paid_at?: string | null
          payscrow_fee?: number | null
          payscrow_transaction_number?: string | null
          payscrow_transaction_ref?: string | null
          receiver_decision?: string | null
          receiver_decision_reason?: string | null
          receiver_email: string
          receiver_id?: string | null
          sender_decision?: string | null
          sender_decision_amount?: number | null
          sender_decision_reason?: string | null
          sender_id: string
          status?: string
          surer_fee?: number | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          amount_paid?: number | null
          created_at?: string | null
          created_by?: string
          decision_auto_execute_at?: string | null
          description?: string
          escrow_code?: string | null
          id?: string
          paid_at?: string | null
          payscrow_fee?: number | null
          payscrow_transaction_number?: string | null
          payscrow_transaction_ref?: string | null
          receiver_decision?: string | null
          receiver_decision_reason?: string | null
          receiver_email?: string
          receiver_id?: string | null
          sender_decision?: string | null
          sender_decision_amount?: number | null
          sender_decision_reason?: string | null
          sender_id?: string
          status?: string
          surer_fee?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          account_name: string
          account_number: string
          amount: number
          bank_name: string
          created_at: string | null
          id: string
          receipt_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          account_name: string
          account_number: string
          amount: number
          bank_name: string
          created_at?: string | null
          id?: string
          receipt_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          account_name?: string
          account_number?: string
          amount?: number
          bank_name?: string
          created_at?: string | null
          id?: string
          receipt_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
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
