# Aureon — digital banking platform

A fast, modern banking web app: marketing site, customer banking app and an admin console in one
static site, backed by a free Supabase database. No build step — it runs on GitHub Pages as-is.

> Aureon is a demonstration platform. It is not a licensed bank and does not hold real deposits.

---

## What's inside

| Page | What it does |
|---|---|
| `index.html` | Landing page with live exchange rates, fees, currency converter and loan calculator |
| `signup.html` · `login.html` | Account opening (2 steps) and sign-in via Supabase Auth |
| `forgot-password.html` · `reset-password.html` | Email password reset |
| `app.html` | Customer banking app |
| `admin.html` | Admin / super admin console |

**Customers can:** hold up to 6 accounts in USD, EUR, GBP, CAD, NGN · send money to any Aureon account
(name lookup, instant) · move money between their own accounts with live FX · send to other banks
(reviewed) · pay bills · create, freeze, limit and cancel virtual cards · save toward goals · apply for and
repay loans · see insights (cash flow, spending by category, top payees) · search/filter/export activity,
print receipts and statements · verify identity (KYC) · chat with support · get real-time notifications ·
set a 4-digit transaction PIN · light/dark mode · hide balances.

**Admins can:** see bank-wide KPIs · search customers · **fund / debit accounts** · **flag an account with a
reason** (the customer sees that reason in a pop-up whenever they try to send, pay or withdraw) and unflag
it · freeze/close profiles and accounts · approve / decline pending transfers · reverse completed ones ·
approve loans and identity checks · reply to support tickets · pre-open accounts for people who haven't
signed up yet · change fees, limits, interest and exchange rates · pay monthly savings interest ·
message customers · read the audit log.

**Super admins** can additionally **add transactions with a chosen date, edit transaction details, and
delete transactions**, and promote/demote admins. Every ledger change moves the balance and recalculates
running balances, so a customer's balance always equals their transaction history. Everything is
recorded in the audit log.

Super admins are set in `supabase/schema.sql` (bottom of the file). Already configured:

- `amos@gmail.com`
- `ekwuemevictor39@gmail.com`

Sign up on the website with either email and you get super admin automatically.

---

## Setup (about 10 minutes)

### 1. Create the Supabase project
1. Go to <https://supabase.com/dashboard> → **New project** (the free plan is fine).
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**.
   It is safe to run again later — it never deletes data.

### 2. Configure authentication
In **Authentication → URL Configuration**:
- **Site URL:** your live site, e.g. `https://victorezekiel905-wq.github.io/Aureon/`
- **Redirect URLs:** add `https://victorezekiel905-wq.github.io/Aureon/**`

In **Authentication → Sign In / Providers → Email**, keep **Confirm email** switched **ON**.
This matters: it stops anyone else from registering the super admin emails before you do.

> The free plan's built-in mailer only sends a few emails per hour. For real use, add your own SMTP
> server under **Authentication → Emails → SMTP settings**.

### 3. Connect the website
Open [`assets/js/config.js`](assets/js/config.js) and paste your values from
**Project Settings → API** (or the **Connect** button):

```js
supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
supabaseAnonKey: 'sb_publishable_...'   // the anon / publishable key — never the service_role key
```

Both values are public by design; the database is protected by Row Level Security.

### 4. Publish on GitHub Pages
Repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
Your site appears at `https://victorezekiel905-wq.github.io/Aureon/` within a minute or two.

### 5. Become super admin
Sign up on the live site with `ekwuemevictor39@gmail.com` (or `amos@gmail.com`), confirm the email,
sign in — you land in the admin console. Use **My banking** in the top bar to see your own customer view.

---

## Keeping the free database awake (every 6 hours)

Free Supabase projects pause after a period of inactivity. Two things are included:

**GitHub Actions (automatic).** [`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) runs
[`scripts/keep-alive.mjs`](scripts/keep-alive.mjs) every 6 hours. The script calls the database's
`ping()` function, which writes a heartbeat row (real database activity), then reads a table.

- It uses the URL and key from `assets/js/config.js` automatically. Optionally add repository secrets
  `SUPABASE_URL` and `SUPABASE_ANON_KEY` (**Settings → Secrets and variables → Actions**) to override them.
- Run it once by hand to check: **Actions → Keep Supabase awake → Run workflow**. A green tick means the
  database answered. If it ever fails, GitHub emails you.
- GitHub turns off schedules in repositories with no commits for 60 days; the workflow pushes a tiny
  timestamp commit after 45 quiet days so that never happens.

**Run it yourself (optional).** On any computer or server with Node 18+:

```bash
node scripts/keep-alive.mjs          # ping once
node scripts/keep-alive.mjs --loop   # stay running and ping every 6 hours
```

---

## How money is protected

- **Supabase Auth** handles passwords (they are never stored by Aureon).
- **Row Level Security** on every table: customers can only read their own rows; admins can read all.
- **Balances can't be edited from the browser.** All money movement happens in database functions that
  lock the rows involved, check ownership, balance, account status and daily limits, and write both
  sides of the ledger in one transaction.
- **Transaction PIN** stored as a bcrypt hash in a private schema the API cannot reach; 5 wrong attempts
  lock it for 15 minutes.
- **Large transfers** (default ≥ 10,000 USD) and all transfers to other banks are held for admin review.
- **Duplicate-click protection** on every payment (idempotency keys).
- Admin and super admin permissions are enforced inside the database, not just hidden in the UI.

## Project structure

```
Public website (generated, see below):
  index.html · personal.html · business.html · cards.html · savings-loans.html
  rates.html · security.html · about.html · help.html
App pages:
  login.html · signup.html · forgot-password.html · reset-password.html · app.html · admin.html · 404.html

src/pages/     source of each public website page (body only)
src/partials/  head.html · header.html (navigation) · footer.html, shared by every public page
assets/css/    alpha.css + pages.css (public website) · base.css (design system) · site.css (auth pages) · app.css (app + admin)
assets/js/     site.js (public website) · config.js · core.js (client, helpers, modals, PIN pad) · icons.js · charts.js
               auth.js · app.js (customer app) · admin.js (admin console)
assets/img/    logo, favicon · photos/ (3D renders of the Aureon banking hall and Aureon Tower)
supabase/      schema.sql: the whole database (tables, security policies, functions, super admins)
scripts/       build-pages.mjs · keep-alive.mjs
.github/       workflows/keep-alive.yml
```

### Editing the public website

The nine public pages share one navigation bar and footer. Edit the page body in
`src/pages/<page>.html` (or the shared parts in `src/partials/`), then rebuild:

```
node scripts/build-pages.mjs
```

This rewrites the matching `.html` files in the repository root. Do not edit those
generated files directly; your changes would be overwritten on the next build.

## Changing things

- **Fees, limits, interest, exchange rates:** admin console → *Rates & settings* (no code needed).
- **More super admins:** add emails to the `admin_allowlist` insert at the bottom of `schema.sql` and run
  just that statement in the SQL editor.
- **Brand colours / fonts:** CSS variables at the top of `assets/css/base.css`.

## What changed from the previous Alpha sites

The two old sites (`Alphafrontend` and `alpha`) were merged and rebuilt as Aureon. Problems fixed:

- Passwords were stored in plain text in a table anyone with the public key could read — now Supabase Auth.
- The admin email and password were hard-coded in the browser JavaScript — now a database role.
- Balances were calculated and written by the browser, so any user could change their own balance —
  now only locked server-side functions move money.
- Users and transactions were mixed in one table with JSON hidden in the `password` column — now a
  proper schema with constraints.
- The login query was open to filter injection, and the old Supabase project no longer exists.
- Photos and branding belonged to a real bank (Alpha Bank) — replaced with Aureon's own design.
