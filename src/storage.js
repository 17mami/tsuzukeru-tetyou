import { supabase } from "./supabaseClient";

// A small compatibility layer standing in for the Claude-artifact
// window.storage API, backed by a single Postgres table (kv_store) in
// Supabase. Every key/value pair — personal and shared alike — lives in
// this one public table; "personal" data is simply namespaced by the
// person's chosen name (see sanitizeName in App.jsx) rather than being
// isolated by a login system, since this app has no real authentication.

export const storage = {
  async get(key) {
    const { data, error } = await supabase.from("kv_store").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return data ? { key, value: data.value } : null;
  },

  async set(key, value) {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;
    return { key, value };
  },

  async list(prefix) {
    const { data, error } = await supabase.from("kv_store").select("key").like("key", `${prefix}%`);
    if (error) throw error;
    return { keys: (data || []).map((r) => r.key) };
  },

  async delete(key) {
    const { error } = await supabase.from("kv_store").delete().eq("key", key);
    if (error) throw error;
    return { key, deleted: true };
  },
};
