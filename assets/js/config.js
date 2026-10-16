/* Aureon runtime configuration.
   ---------------------------------------------------------------------------
   Supabase Dashboard → Project Settings → API (or "Connect"):
     • supabaseUrl      = "Project URL"           e.g. https://abcdefghijkl.supabase.co
     • supabaseAnonKey  = the "anon" / "publishable" key
   Both values are PUBLIC by design (they ship to every browser). Your data is
   protected by the Row Level Security policies in supabase/schema.sql.
   NEVER put the service_role / secret key in this file. */
window.AUREON_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  bankName: 'Aureon'
};
