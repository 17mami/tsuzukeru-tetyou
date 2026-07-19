import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Supabaseの接続情報が設定されていません。Vercelの環境変数 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を確認してください。"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
