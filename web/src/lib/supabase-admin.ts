import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY. Uses the service role key, which bypasses RLS entirely.
// Never import this from a "use client" component or anything that could end
// up in the browser bundle — only from API routes (app/api/**/route.ts).
// Lazily constructed (not a module-level singleton) so a missing env var
// only breaks the one request that needs it, not every route on cold start.
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}
