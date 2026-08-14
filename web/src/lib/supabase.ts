import { createClient } from "@supabase/supabase-js";

// Single shared client — there's no auth/session in this app (single user, no
// login), so one anon-key client works identically on the server (SSR fetch in
// page.tsx) and in the browser (realtime subscription + mutations).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
