/* Aureon runtime configuration.
   ---------------------------------------------------------------------------
   Database connection used by the website and the 6-hourly keep-alive ping.
   Both values are PUBLIC by design (they ship to every browser). Your data is
   protected by the row-level security policies in the database.
   NEVER put the service_role / secret key in this file. */
window.AUREON_CONFIG = {
  supabaseUrl: 'https://qgfeqtriiawekzhkbrtk.supabase.co',
  supabaseAnonKey: 'sb_publishable_vZa0kdPXXlRQ1pLA2x3mpw_OiXJJo3A',
  bankName: 'Aureon',
  // Contact addresses shown on the website (footer and Help page). Leave a value
  // empty to hide it, e.g. customerCare: 'customercare@yourdomain.com'
  contactEmails: {
    customerCare: '',
    info: '',
    fraud: '',
    complaints: ''
  }
};
