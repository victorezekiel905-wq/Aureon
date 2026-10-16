-- =============================================================================
--  AUREON · Supabase database schema
-- -----------------------------------------------------------------------------
--  How to install
--    1. Supabase Dashboard → SQL Editor → New query
--    2. Paste this whole file and press "Run".
--    3. Scroll to the very bottom ("ADMIN SETUP") and make yourself an admin.
--
--  The script is idempotent: you can run it again after an update and it will
--  only add or replace what changed. It never drops your data.
--
--  Security model
--    • Every person signs in with Supabase Auth (passwords are never stored by
--      Aureon itself).
--    • Row Level Security is ON for every table: customers only ever see their
--      own rows; admins see everything.
--    • Balances can NOT be written from the browser. All money movement runs in
--      the SECURITY DEFINER functions below, inside one database transaction,
--      with row locks, balance checks, daily limits and a hashed 4-digit PIN.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;          -- not exposed through the API
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
--  1. Reference tables
-- -----------------------------------------------------------------------------

create table if not exists public.settings (
  id                 smallint primary key default 1 check (id = 1),
  bank_name          text          not null default 'Aureon',
  base_currency      text          not null default 'USD',
  internal_fee_pct   numeric(7,5)  not null default 0      check (internal_fee_pct between 0 and 0.1),
  external_fee_pct   numeric(7,5)  not null default 0.005  check (external_fee_pct between 0 and 0.1),
  external_fee_min   numeric(18,2) not null default 1      check (external_fee_min >= 0),
  review_threshold   numeric(18,2) not null default 10000  check (review_threshold > 0),
  daily_limit        numeric(18,2) not null default 50000  check (daily_limit > 0),
  loan_apr           numeric(7,5)  not null default 0.12   check (loan_apr between 0 and 1),
  savings_apr        numeric(7,5)  not null default 0.04   check (savings_apr between 0 and 1),
  max_loan           numeric(18,2) not null default 50000  check (max_loan > 0),
  welcome_bonus      numeric(18,2) not null default 0      check (welcome_bonus >= 0),
  support_email      text          not null default '',
  updated_at         timestamptz   not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.fx_rates (
  currency   text primary key check (currency ~ '^[A-Z]{3}$'),
  name       text          not null,
  symbol     text          not null,
  per_usd    numeric(18,6) not null check (per_usd > 0),   -- units of this currency for 1 USD
  updated_at timestamptz   not null default now()
);
insert into public.fx_rates (currency, name, symbol, per_usd) values
  ('USD', 'US Dollar',       '$',  1),
  ('EUR', 'Euro',            '€',  0.92),
  ('GBP', 'British Pound',   '£',  0.79),
  ('CAD', 'Canadian Dollar', 'C$', 1.37),
  ('NGN', 'Nigerian Naira',  '₦',  1550)
on conflict (currency) do nothing;

create table if not exists public.admin_allowlist (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
--  2. Customer tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text        not null,
  full_name           text        not null default '' check (char_length(full_name) <= 120),
  phone               text        check (char_length(phone) <= 40),
  address             text        check (char_length(address) <= 200),
  city                text        check (char_length(city) <= 80),
  country             text        check (char_length(country) <= 80),
  date_of_birth       date,
  avatar_url          text        check (char_length(avatar_url) <= 300000),
  role                text        not null default 'customer' check (role in ('customer','admin','super_admin')),
  status              text        not null default 'active'   check (status in ('active','restricted','frozen','closed')),
  status_reason       text,
  kyc_status          text        not null default 'unverified' check (kyc_status in ('unverified','pending','verified','rejected')),
  kyc_document_type   text,
  kyc_document_number text,
  kyc_note            text,
  preferences         jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));
-- (upgrade path for databases created before the super_admin role existed)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer','admin','super_admin'));

-- Transaction PINs live in a private schema so no API role can ever read them.
create table if not exists private.pins (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  pin_hash        text        not null,
  failed_attempts int         not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

create table if not exists public.accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid          not null references public.profiles(id) on delete cascade,
  account_number text          not null unique,
  type           text          not null default 'checking' check (type in ('checking','savings','business')),
  nickname       text          check (char_length(nickname) <= 40),
  currency       text          not null default 'USD' references public.fx_rates(currency),
  balance        numeric(18,2) not null default 0 check (balance >= 0),
  status         text          not null default 'active' check (status in ('active','frozen','closed')),
  is_primary     boolean       not null default false,
  created_at     timestamptz   not null default now()
);
create index if not exists accounts_user_idx on public.accounts (user_id);

create table if not exists public.transactions (
  id                   uuid primary key default gen_random_uuid(),
  reference            text          not null,
  group_id             uuid          not null default gen_random_uuid(),
  account_id           uuid          not null references public.accounts(id) on delete cascade,
  user_id              uuid          not null references public.profiles(id) on delete cascade,
  direction            text          not null check (direction in ('credit','debit')),
  kind                 text          not null check (kind in ('transfer','external','deposit','withdrawal','bill','card','loan','savings','interest','adjustment','reversal','fee')),
  category             text          not null default 'other',
  amount               numeric(18,2) not null check (amount > 0),
  fee                  numeric(18,2) not null default 0 check (fee >= 0),
  currency             text          not null,
  balance_after        numeric(18,2),
  status               text          not null default 'completed' check (status in ('completed','pending','declined','reversed','failed')),
  description          text          not null default '',
  counterparty_name    text,
  counterparty_account text,
  counterparty_bank    text,
  note                 text,
  admin_note           text,
  metadata             jsonb         not null default '{}'::jsonb,
  idempotency_key      text,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now()
);
create index if not exists transactions_account_idx on public.transactions (account_id, created_at desc);
create index if not exists transactions_user_idx    on public.transactions (user_id, created_at desc);
create index if not exists transactions_group_idx   on public.transactions (group_id);
create index if not exists transactions_pending_idx on public.transactions (created_at desc) where status = 'pending';
create unique index if not exists transactions_idem_idx on public.transactions (user_id, idempotency_key) where idempotency_key is not null;

create table if not exists public.beneficiaries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references public.profiles(id) on delete cascade,
  name           text        not null check (char_length(name) between 1 and 120),
  account_number text        not null check (char_length(account_number) between 4 and 40),
  bank_name      text        not null default 'Aureon' check (char_length(bank_name) <= 80),
  swift_code     text        check (char_length(swift_code) <= 15),
  is_internal    boolean     not null default true,
  nickname       text        check (char_length(nickname) <= 40),
  created_at     timestamptz not null default now(),
  unique (user_id, account_number)
);

create table if not exists public.cards (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid          not null references public.profiles(id) on delete cascade,
  account_id     uuid          not null references public.accounts(id) on delete cascade,
  label          text          not null default 'Virtual card' check (char_length(label) <= 40),
  network        text          not null default 'visa' check (network in ('visa','mastercard')),
  card_number    text          not null,
  last4          text          not null,
  exp_month      int           not null check (exp_month between 1 and 12),
  exp_year       int           not null,
  cvv            text          not null,
  status         text          not null default 'active' check (status in ('active','frozen','cancelled')),
  spend_limit    numeric(18,2) check (spend_limit is null or spend_limit > 0),
  online_payments boolean      not null default true,
  contactless    boolean       not null default true,
  color          text          not null default 'midnight' check (color in ('midnight','gold','aurora','graphite')),
  created_at     timestamptz   not null default now()
);
create index if not exists cards_user_idx on public.cards (user_id);

create table if not exists public.savings_goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid          not null references public.profiles(id) on delete cascade,
  name          text          not null check (char_length(name) between 1 and 60),
  icon          text          not null default 'target',
  currency      text          not null references public.fx_rates(currency),
  target_amount numeric(18,2) not null check (target_amount > 0),
  saved_amount  numeric(18,2) not null default 0 check (saved_amount >= 0),
  target_date   date,
  status        text          not null default 'active' check (status in ('active','completed','closed')),
  created_at    timestamptz   not null default now()
);
create index if not exists goals_user_idx on public.savings_goals (user_id);

create table if not exists public.loans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid          not null references public.profiles(id) on delete cascade,
  account_id      uuid          not null references public.accounts(id) on delete cascade,
  amount          numeric(18,2) not null check (amount > 0),
  currency        text          not null,
  term_months     int           not null check (term_months between 3 and 60),
  apr             numeric(7,5)  not null,
  purpose         text          not null default '' check (char_length(purpose) <= 280),
  monthly_payment numeric(18,2) not null,
  total_repayable numeric(18,2) not null,
  outstanding     numeric(18,2) not null default 0 check (outstanding >= 0),
  status          text          not null default 'pending' check (status in ('pending','active','rejected','repaid')),
  admin_note      text,
  decided_at      timestamptz,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);
create index if not exists loans_user_idx on public.loans (user_id);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  title      text        not null,
  body       text        not null default '',
  kind       text        not null default 'info' check (kind in ('info','success','warning','danger')),
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  subject    text        not null check (char_length(subject) between 3 and 120),
  category   text        not null default 'general',
  status     text        not null default 'open' check (status in ('open','answered','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_user_idx on public.support_tickets (user_id, updated_at desc);

create table if not exists public.ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid        not null references public.support_tickets(id) on delete cascade,
  author_id  uuid        references public.profiles(id) on delete set null,
  is_staff   boolean     not null default false,
  body       text        not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

create table if not exists public.account_invites (
  id              uuid primary key default gen_random_uuid(),
  email           text          not null,
  full_name       text          not null default '',
  phone           text,
  currency        text          not null default 'USD' references public.fx_rates(currency),
  account_type    text          not null default 'checking' check (account_type in ('checking','savings','business')),
  opening_balance numeric(18,2) not null default 0 check (opening_balance >= 0),
  account_number  text          not null unique,
  claimed_by      uuid          references public.profiles(id) on delete set null,
  claimed_at      timestamptz,
  created_by      uuid          references public.profiles(id) on delete set null,
  created_at      timestamptz   not null default now()
);
create index if not exists invites_email_idx on public.account_invites (lower(email));

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid        references public.profiles(id) on delete set null,
  action      text        not null,
  target_type text,
  target_id   text,
  details     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_log (created_at desc);

create table if not exists public.heartbeat (
  id         smallint primary key default 1 check (id = 1),
  last_ping  timestamptz,
  ping_count bigint not null default 0,
  source     text
);

-- -----------------------------------------------------------------------------
--  3. Helper functions
-- -----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin'));
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin');
$$;

create or replace function public.fmt_money(p numeric, p_cur text)
returns text language sql immutable as $$
  select p_cur || ' ' || to_char(coalesce(p, 0), 'FM999,999,999,990.00');
$$;

create or replace function public.fx_convert(p_amount numeric, p_from text, p_to text)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare r_from numeric; r_to numeric;
begin
  if p_amount is null or p_from is null then return null; end if;   -- e.g. empty LEFT JOIN rows
  if p_from = p_to then return round(coalesce(p_amount, 0), 2); end if;
  select per_usd into r_from from public.fx_rates where currency = p_from;
  select per_usd into r_to   from public.fx_rates where currency = p_to;
  if r_from is null or r_to is null then
    raise exception 'Unsupported currency %/%', p_from, p_to;
  end if;
  return round(coalesce(p_amount, 0) / r_from * r_to, 2);
end $$;

create or replace function public.gen_account_number()
returns text language plpgsql volatile set search_path = public as $$
declare v text;
begin
  loop
    v := '7' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
    exit when not exists (select 1 from public.accounts where account_number = v)
          and not exists (select 1 from public.account_invites where account_number = v);
  end loop;
  return v;
end $$;

create or replace function public.gen_reference(p_prefix text default 'AUR')
returns text language sql volatile as $$
  select p_prefix || to_char(now(), 'YYMMDD') || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
$$;

create or replace function public.notify_user(p_user uuid, p_title text, p_body text, p_kind text default 'info', p_link text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, kind, link)
  values (p_user, p_title, coalesce(p_body, ''), coalesce(p_kind, 'info'), p_link);
$$;

create or replace function public.log_audit(p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.current_profile()
returns public.profiles language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'Profile not found.'; end if;
  if p.status in ('frozen', 'closed') then
    raise exception 'Your profile is %. %', p.status, coalesce(p.status_reason, 'Please contact support.');
  end if;
  return p;
end $$;

create or replace function public.assert_can_send(p public.profiles)
returns void language plpgsql as $$
begin
  if p.status = 'restricted' then
    raise exception 'Outgoing payments are restricted on your profile. %', coalesce(p.status_reason, 'Please contact support.');
  end if;
  if p.status <> 'active' then
    raise exception 'Your profile is %.', p.status;
  end if;
end $$;

create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required.' using errcode = '42501'; end if;
end $$;

create or replace function public.require_super_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Super admin access required.' using errcode = '42501'; end if;
end $$;

-- Rewrites balance_after on every row of an account in date order (used after a
-- super admin back-dates, edits or deletes a ledger entry).
create or replace function public.recompute_running_balances(p_account uuid)
returns void language sql security definer set search_path = public as $$
  with applied as (
    select id,
           (direction = 'debit' or status in ('completed', 'reversed')) as counts,
           sum(case when direction = 'credit' and status in ('completed', 'reversed') then amount
                    when direction = 'debit' then -(amount + fee) else 0 end)
             over (order by created_at, id rows between unbounded preceding and current row) as running
      from public.transactions where account_id = p_account
  )
  update public.transactions t
     set balance_after = case when a.counts then a.running else null end
    from applied a
   where t.id = a.id;
$$;

-- Returns NULL when the PIN is correct, otherwise a message. Wrong attempts are
-- counted (5 strikes → 15-minute lock). It RETURNS instead of RAISING so that
-- the attempt counter is committed.
create or replace function public.check_pin(p_user uuid, p_pin text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare r private.pins;
begin
  select * into r from private.pins where user_id = p_user for update;
  if not found then return 'PIN_NOT_SET'; end if;
  if r.locked_until is not null and r.locked_until > now() then
    return 'Your PIN is locked after too many attempts. Try again in '
           || greatest(1, ceil(extract(epoch from (r.locked_until - now())) / 60))::int || ' minute(s).';
  end if;
  if p_pin is null or p_pin !~ '^\d{4}$' or r.pin_hash <> extensions.crypt(p_pin, r.pin_hash) then
    update private.pins
       set failed_attempts = case when r.failed_attempts + 1 >= 5 then 0 else r.failed_attempts + 1 end,
           locked_until    = case when r.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end,
           updated_at      = now()
     where user_id = p_user;
    if r.failed_attempts + 1 >= 5 then
      return 'Too many incorrect attempts. Your PIN is locked for 15 minutes.';
    end if;
    return 'Incorrect PIN. ' || (4 - r.failed_attempts) || ' attempt(s) left.';
  end if;
  update private.pins set failed_attempts = 0, locked_until = null where user_id = p_user;
  return null;
end $$;

create or replace function public.pin_error(p_msg text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', p_msg,
                            'code', case when p_msg = 'PIN_NOT_SET' then 'PIN_NOT_SET' else 'PIN_INVALID' end);
$$;

-- Total of today's outgoing payments in base currency.
create or replace function public.spent_today(p_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(public.fx_convert(amount + fee, currency, (select base_currency from public.settings where id = 1))), 0)
    from public.transactions
   where user_id = p_user and direction = 'debit'
     and kind in ('transfer', 'external', 'bill')
     and status in ('completed', 'pending')
     and created_at >= date_trunc('day', now())
     and coalesce((metadata->>'own_transfer')::boolean, false) = false;
$$;

-- -----------------------------------------------------------------------------
--  4. Triggers
-- -----------------------------------------------------------------------------

create or replace function public.profiles_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.full_name  := trim(new.full_name);
  if old.kyc_status = 'verified'
     and new.full_name is distinct from old.full_name
     and not public.is_admin()
     and coalesce(current_setting('aureon.trusted', true), '') <> 'on' then
    raise exception 'Your legal name has been verified. Contact support to change it.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();

-- New sign-up → profile + first account (or claim an account an admin pre-opened).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name     text  := left(coalesce(nullif(trim(v_meta->>'full_name'), ''), split_part(new.email, '@', 1)), 120);
  v_currency text  := upper(coalesce(nullif(v_meta->>'currency', ''), 'USD'));
  v_role     text  := 'customer';
  v_bonus    numeric;
  inv        public.account_invites;
  acc        public.accounts;
  s          public.settings;
begin
  if not exists (select 1 from public.fx_rates where currency = v_currency) then v_currency := 'USD'; end if;
  if exists (select 1 from public.admin_allowlist where lower(email) = lower(new.email)) then v_role := 'super_admin'; end if;

  insert into public.profiles (id, email, full_name, phone, country, role)
  values (new.id, coalesce(new.email, ''), v_name,
          left(nullif(trim(v_meta->>'phone'), ''), 40),
          left(nullif(trim(v_meta->>'country'), ''), 80), v_role)
  on conflict (id) do nothing;

  select * into inv from public.account_invites
   where lower(email) = lower(new.email) and claimed_by is null
   order by created_at limit 1 for update;

  if found then
    update public.profiles
       set full_name = coalesce(nullif(inv.full_name, ''), full_name),
           phone     = coalesce(phone, inv.phone)
     where id = new.id;
    insert into public.accounts (user_id, account_number, type, currency, balance, is_primary)
    values (new.id, inv.account_number, inv.account_type, inv.currency, inv.opening_balance, true)
    returning * into acc;
    if inv.opening_balance > 0 then
      insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                       balance_after, description, counterparty_name, counterparty_bank)
      values (public.gen_reference('DEP'), acc.id, new.id, 'credit', 'deposit', 'income', inv.opening_balance,
              acc.currency, acc.balance, 'Opening balance', 'Aureon', 'Aureon');
    end if;
    update public.account_invites set claimed_by = new.id, claimed_at = now() where id = inv.id;
  else
    insert into public.accounts (user_id, account_number, type, currency, is_primary)
    values (new.id, public.gen_account_number(), 'checking', v_currency, true)
    returning * into acc;

    select * into s from public.settings where id = 1;
    if s.welcome_bonus > 0 then
      v_bonus := public.fx_convert(s.welcome_bonus, s.base_currency, acc.currency);
      update public.accounts set balance = balance + v_bonus where id = acc.id returning * into acc;
      insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                       balance_after, description, counterparty_name, counterparty_bank)
      values (public.gen_reference('BON'), acc.id, new.id, 'credit', 'deposit', 'income', v_bonus,
              acc.currency, acc.balance, 'Welcome bonus', 'Aureon', 'Aureon');
    end if;
  end if;

  perform public.notify_user(new.id, 'Welcome to Aureon',
    'Your account ' || acc.account_number || ' is ready. Create your 4-digit transaction PIN in Security to start sending money.',
    'success', '#/security');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- -----------------------------------------------------------------------------
--  5. Customer functions (called from the app with supabase.rpc)
-- -----------------------------------------------------------------------------

create or replace function public.has_pin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from private.pins where user_id = auth.uid());
$$;

create or replace function public.set_transaction_pin(p_new text, p_current text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare me public.profiles := public.current_profile(); v_err text;
begin
  if p_new is null or p_new !~ '^\d{4}$' then raise exception 'Your PIN must be exactly 4 digits.'; end if;
  if p_new in ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876') then
    raise exception 'That PIN is too easy to guess. Choose another one.';
  end if;
  if exists (select 1 from private.pins where user_id = me.id) then
    v_err := public.check_pin(me.id, p_current);
    if v_err is not null then return public.pin_error(v_err); end if;
  end if;
  insert into private.pins (user_id, pin_hash) values (me.id, extensions.crypt(p_new, extensions.gen_salt('bf', 8)))
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();
  perform public.notify_user(me.id, 'Transaction PIN updated', 'Your 4-digit transaction PIN was set. If this was not you, contact support immediately.', 'info', '#/security');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.lookup_account(p_account_number text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.accounts; p public.profiles;
begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;
  select * into a from public.accounts where account_number = trim(p_account_number) and status <> 'closed';
  if not found then return jsonb_build_object('found', false); end if;
  select * into p from public.profiles where id = a.user_id;
  return jsonb_build_object('found', true, 'name', p.full_name, 'currency', a.currency,
                            'type', a.type, 'own', a.user_id = auth.uid(), 'bank', 'Aureon');
end $$;

create or replace function public.transfer_funds(
  p_from_account      uuid,
  p_to_account_number text,
  p_amount            numeric,
  p_note              text    default null,
  p_pin               text    default null,
  p_save_beneficiary  boolean default false,
  p_idempotency_key   text    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me       public.profiles := public.current_profile();
  s        public.settings;
  src      public.accounts;
  dst      public.accounts;
  dst_user public.profiles;
  v_dst_id uuid;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_fee    numeric := 0;
  v_credit numeric;
  v_status text;
  v_own    boolean;
  v_err    text;
  v_group  uuid := gen_random_uuid();
  v_ref    text := public.gen_reference('TRF');
  v_note   text := left(nullif(trim(p_note), ''), 140);
  v_dup    public.transactions;
begin
  if p_idempotency_key is not null then
    select * into v_dup from public.transactions where user_id = me.id and idempotency_key = p_idempotency_key limit 1;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'reference', v_dup.reference,
                                'status', v_dup.status, 'group_id', v_dup.group_id);
    end if;
  end if;
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if v_amount > 10000000 then raise exception 'That amount is above the per-transfer maximum.'; end if;

  select * into s from public.settings where id = 1;
  select id into v_dst_id from public.accounts where account_number = trim(p_to_account_number);
  if v_dst_id is null then raise exception 'We could not find that Aureon account number.'; end if;

  -- Lock both accounts in a fixed order so concurrent transfers cannot deadlock.
  perform 1 from public.accounts where id in (p_from_account, v_dst_id) order by id for update;
  select * into src from public.accounts where id = p_from_account;
  select * into dst from public.accounts where id = v_dst_id;

  if src.id is null or src.user_id <> me.id then raise exception 'Choose one of your own accounts to send from.'; end if;
  if src.id = dst.id then raise exception 'You cannot send money to the same account.'; end if;
  if src.status <> 'active' then raise exception 'This account is % and cannot send money.', src.status; end if;
  if dst.status <> 'active' then raise exception 'The recipient account cannot receive funds right now.'; end if;

  v_own := dst.user_id = me.id;
  if not v_own then
    perform public.assert_can_send(me);
    v_err := public.check_pin(me.id, p_pin);
    if v_err is not null then return public.pin_error(v_err); end if;
    v_fee := round(v_amount * s.internal_fee_pct, 2);
    if public.spent_today(me.id) + public.fx_convert(v_amount + v_fee, src.currency, s.base_currency) > s.daily_limit then
      raise exception 'This transfer would exceed your daily limit of %.', public.fmt_money(s.daily_limit, s.base_currency);
    end if;
  end if;

  if src.balance < v_amount + v_fee then
    raise exception 'Insufficient funds. Your available balance is %.', public.fmt_money(src.balance, src.currency);
  end if;

  v_credit := public.fx_convert(v_amount, src.currency, dst.currency);
  v_status := case when not v_own and public.fx_convert(v_amount, src.currency, s.base_currency) >= s.review_threshold
                   then 'pending' else 'completed' end;
  select * into dst_user from public.profiles where id = dst.user_id;

  update public.accounts set balance = balance - v_amount - v_fee where id = src.id returning * into src;
  insert into public.transactions (reference, group_id, account_id, user_id, direction, kind, category, amount, fee,
      currency, balance_after, status, description, counterparty_name, counterparty_account, counterparty_bank,
      note, metadata, idempotency_key)
  values (v_ref, v_group, src.id, me.id, 'debit', 'transfer', case when v_own then 'savings' else 'transfer' end,
      v_amount, v_fee, src.currency, src.balance, v_status,
      case when v_own then 'Transfer to ' || coalesce(dst.nickname, initcap(dst.type)) || ' ••' || right(dst.account_number, 4)
           else 'Transfer to ' || dst_user.full_name end,
      dst_user.full_name, dst.account_number, 'Aureon', v_note,
      jsonb_build_object('own_transfer', v_own, 'credit_amount', v_credit, 'credit_currency', dst.currency),
      p_idempotency_key);

  if v_status = 'completed' then
    update public.accounts set balance = balance + v_credit where id = dst.id returning * into dst;
  end if;
  insert into public.transactions (reference, group_id, account_id, user_id, direction, kind, category, amount,
      currency, balance_after, status, description, counterparty_name, counterparty_account, counterparty_bank,
      note, metadata)
  values (v_ref, v_group, dst.id, dst.user_id, 'credit', 'transfer', case when v_own then 'savings' else 'income' end,
      v_credit, dst.currency, case when v_status = 'completed' then dst.balance end, v_status,
      case when v_own then 'Transfer from ' || coalesce(src.nickname, initcap(src.type)) || ' ••' || right(src.account_number, 4)
           else 'Transfer from ' || me.full_name end,
      me.full_name, src.account_number, 'Aureon', v_note,
      jsonb_build_object('own_transfer', v_own, 'debit_amount', v_amount, 'debit_currency', src.currency));

  if not v_own then
    if v_status = 'completed' then
      perform public.notify_user(dst.user_id, 'Money received',
        me.full_name || ' sent you ' || public.fmt_money(v_credit, dst.currency) || '.', 'success', '#/transactions');
      perform public.notify_user(me.id, 'Transfer sent',
        public.fmt_money(v_amount, src.currency) || ' to ' || dst_user.full_name || ' · Ref ' || v_ref, 'success', '#/transactions');
    else
      perform public.notify_user(me.id, 'Transfer under review',
        'Your transfer of ' || public.fmt_money(v_amount, src.currency) || ' to ' || dst_user.full_name
        || ' is being reviewed by our security team. Funds are held until it is approved.', 'warning', '#/transactions');
    end if;
    if p_save_beneficiary then
      insert into public.beneficiaries (user_id, name, account_number, bank_name, is_internal)
      values (me.id, dst_user.full_name, dst.account_number, 'Aureon', true)
      on conflict (user_id, account_number) do nothing;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'reference', v_ref, 'group_id', v_group, 'status', v_status,
    'amount', v_amount, 'fee', v_fee, 'currency', src.currency, 'credit_amount', v_credit,
    'credit_currency', dst.currency, 'recipient', dst_user.full_name, 'recipient_account', dst.account_number,
    'balance_after', src.balance, 'created_at', now());
end $$;

create or replace function public.external_transfer(
  p_from_account     uuid,
  p_bank_name        text,
  p_account_number   text,
  p_account_name     text,
  p_amount           numeric,
  p_note             text    default null,
  p_pin              text    default null,
  p_swift            text    default null,
  p_save_beneficiary boolean default false,
  p_idempotency_key  text    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me       public.profiles := public.current_profile();
  s        public.settings;
  src      public.accounts;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_fee    numeric;
  v_err    text;
  v_group  uuid := gen_random_uuid();
  v_ref    text := public.gen_reference('EXT');
  v_dup    public.transactions;
begin
  perform public.assert_can_send(me);
  if p_idempotency_key is not null then
    select * into v_dup from public.transactions where user_id = me.id and idempotency_key = p_idempotency_key limit 1;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'reference', v_dup.reference, 'status', v_dup.status, 'group_id', v_dup.group_id);
    end if;
  end if;
  if coalesce(trim(p_bank_name), '') = '' or coalesce(trim(p_account_name), '') = '' then
    raise exception 'Enter the recipient bank and account name.';
  end if;
  if coalesce(trim(p_account_number), '') !~ '^[A-Za-z0-9 -]{6,34}$' then
    raise exception 'Enter a valid account number or IBAN (6–34 letters or digits).';
  end if;
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;

  select * into s from public.settings where id = 1;
  select * into src from public.accounts where id = p_from_account for update;
  if not found or src.user_id <> me.id then raise exception 'Choose one of your own accounts to send from.'; end if;
  if src.status <> 'active' then raise exception 'This account is % and cannot send money.', src.status; end if;

  v_err := public.check_pin(me.id, p_pin);
  if v_err is not null then return public.pin_error(v_err); end if;

  v_fee := greatest(public.fx_convert(s.external_fee_min, s.base_currency, src.currency), round(v_amount * s.external_fee_pct, 2));
  if public.spent_today(me.id) + public.fx_convert(v_amount + v_fee, src.currency, s.base_currency) > s.daily_limit then
    raise exception 'This transfer would exceed your daily limit of %.', public.fmt_money(s.daily_limit, s.base_currency);
  end if;
  if src.balance < v_amount + v_fee then
    raise exception 'Insufficient funds. You need % including the % fee.',
      public.fmt_money(v_amount + v_fee, src.currency), public.fmt_money(v_fee, src.currency);
  end if;

  update public.accounts set balance = balance - v_amount - v_fee where id = src.id returning * into src;
  insert into public.transactions (reference, group_id, account_id, user_id, direction, kind, category, amount, fee,
      currency, balance_after, status, description, counterparty_name, counterparty_account, counterparty_bank,
      note, metadata, idempotency_key)
  values (v_ref, v_group, src.id, me.id, 'debit', 'external', 'transfer', v_amount, v_fee, src.currency, src.balance,
      'pending', 'Transfer to ' || left(trim(p_account_name), 120), left(trim(p_account_name), 120),
      upper(left(trim(p_account_number), 34)), left(trim(p_bank_name), 80), left(nullif(trim(p_note), ''), 140),
      jsonb_build_object('swift', upper(nullif(trim(p_swift), ''))), p_idempotency_key);

  if p_save_beneficiary then
    insert into public.beneficiaries (user_id, name, account_number, bank_name, swift_code, is_internal)
    values (me.id, left(trim(p_account_name), 120), upper(left(trim(p_account_number), 34)), left(trim(p_bank_name), 80),
            upper(left(nullif(trim(p_swift), ''), 15)), false)
    on conflict (user_id, account_number) do nothing;
  end if;

  perform public.notify_user(me.id, 'External transfer submitted',
    public.fmt_money(v_amount, src.currency) || ' to ' || trim(p_account_name) || ' at ' || trim(p_bank_name)
    || ' is being processed. Ref ' || v_ref, 'info', '#/transactions');

  return jsonb_build_object('ok', true, 'reference', v_ref, 'group_id', v_group, 'status', 'pending',
    'amount', v_amount, 'fee', v_fee, 'currency', src.currency, 'recipient', trim(p_account_name),
    'recipient_account', upper(trim(p_account_number)), 'bank', trim(p_bank_name), 'balance_after', src.balance,
    'created_at', now());
end $$;

create or replace function public.pay_bill(
  p_from_account  uuid,
  p_biller        text,
  p_customer_ref  text,
  p_amount        numeric,
  p_pin           text default null,
  p_category      text default 'bills',
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me       public.profiles := public.current_profile();
  s        public.settings;
  src      public.accounts;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_err    text;
  v_ref    text := public.gen_reference('BIL');
  v_dup    public.transactions;
begin
  perform public.assert_can_send(me);
  if p_idempotency_key is not null then
    select * into v_dup from public.transactions where user_id = me.id and idempotency_key = p_idempotency_key limit 1;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'reference', v_dup.reference, 'status', v_dup.status); end if;
  end if;
  if coalesce(trim(p_biller), '') = '' then raise exception 'Choose a biller.'; end if;
  if coalesce(trim(p_customer_ref), '') = '' then raise exception 'Enter your customer or meter number.'; end if;
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;

  select * into s from public.settings where id = 1;
  select * into src from public.accounts where id = p_from_account for update;
  if not found or src.user_id <> me.id then raise exception 'Choose one of your own accounts to pay from.'; end if;
  if src.status <> 'active' then raise exception 'This account is % and cannot make payments.', src.status; end if;

  v_err := public.check_pin(me.id, p_pin);
  if v_err is not null then return public.pin_error(v_err); end if;

  if public.spent_today(me.id) + public.fx_convert(v_amount, src.currency, s.base_currency) > s.daily_limit then
    raise exception 'This payment would exceed your daily limit of %.', public.fmt_money(s.daily_limit, s.base_currency);
  end if;
  if src.balance < v_amount then
    raise exception 'Insufficient funds. Your available balance is %.', public.fmt_money(src.balance, src.currency);
  end if;

  update public.accounts set balance = balance - v_amount where id = src.id returning * into src;
  insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
      balance_after, status, description, counterparty_name, counterparty_account, idempotency_key)
  values (v_ref, src.id, me.id, 'debit', 'bill',
      case when p_category in ('bills','entertainment','transport','health','shopping','food') then p_category else 'bills' end,
      v_amount, src.currency, src.balance, 'completed', left(trim(p_biller), 80) || ' payment',
      left(trim(p_biller), 80), left(trim(p_customer_ref), 40), p_idempotency_key);

  perform public.notify_user(me.id, 'Bill paid',
    public.fmt_money(v_amount, src.currency) || ' paid to ' || trim(p_biller) || '. Ref ' || v_ref, 'success', '#/transactions');
  return jsonb_build_object('ok', true, 'reference', v_ref, 'status', 'completed', 'amount', v_amount,
    'currency', src.currency, 'recipient', trim(p_biller), 'balance_after', src.balance, 'created_at', now());
end $$;

create or replace function public.open_account(p_type text, p_currency text, p_nickname text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.current_profile(); acc public.accounts;
begin
  if p_type not in ('checking', 'savings', 'business') then raise exception 'Choose a valid account type.'; end if;
  if not exists (select 1 from public.fx_rates where currency = upper(p_currency)) then raise exception 'That currency is not supported.'; end if;
  if (select count(*) from public.accounts where user_id = me.id and status <> 'closed') >= 6 then
    raise exception 'You can hold up to 6 accounts.';
  end if;
  insert into public.accounts (user_id, account_number, type, currency, nickname, is_primary)
  values (me.id, public.gen_account_number(), p_type, upper(p_currency), left(nullif(trim(p_nickname), ''), 40),
          not exists (select 1 from public.accounts where user_id = me.id and is_primary and status <> 'closed'))
  returning * into acc;
  perform public.notify_user(me.id, 'New account opened',
    initcap(acc.type) || ' account ' || acc.account_number || ' (' || acc.currency || ') is ready to use.', 'success', '#/accounts');
  return jsonb_build_object('ok', true, 'id', acc.id, 'account_number', acc.account_number);
end $$;

create or replace function public.update_account(p_account uuid, p_nickname text default null, p_make_primary boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.current_profile();
begin
  if not exists (select 1 from public.accounts where id = p_account and user_id = me.id and status <> 'closed') then
    raise exception 'Account not found.';
  end if;
  update public.accounts set nickname = left(nullif(trim(p_nickname), ''), 40) where id = p_account;
  if p_make_primary then
    update public.accounts set is_primary = (id = p_account) where user_id = me.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.close_account(p_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.current_profile(); a public.accounts;
begin
  select * into a from public.accounts where id = p_account and user_id = me.id for update;
  if not found or a.status = 'closed' then raise exception 'Account not found.'; end if;
  if a.is_primary then raise exception 'Make another account primary before closing this one.'; end if;
  if a.balance > 0 then raise exception 'Move the remaining % out of this account before closing it.', public.fmt_money(a.balance, a.currency); end if;
  if exists (select 1 from public.loans where account_id = a.id and status in ('pending', 'active')) then
    raise exception 'This account is linked to an open loan.';
  end if;
  update public.accounts set status = 'closed' where id = a.id;
  update public.cards set status = 'cancelled' where account_id = a.id;
  return jsonb_build_object('ok', true);
end $$;

-- Cards ----------------------------------------------------------------------

create or replace function public.create_card(p_account uuid, p_label text default null, p_color text default 'midnight', p_network text default 'visa')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me  public.profiles := public.current_profile();
  a   public.accounts;
  v   text;
  d   int;
  sm  int;
  c   public.cards;
begin
  select * into a from public.accounts where id = p_account and user_id = me.id and status = 'active';
  if not found then raise exception 'Choose an active account for this card.'; end if;
  if (select count(*) from public.cards where user_id = me.id and status <> 'cancelled') >= 5 then
    raise exception 'You can hold up to 5 active cards.';
  end if;
  -- 15 random digits on a network prefix, then the Luhn check digit.
  v := case when p_network = 'mastercard' then '5' else '4' end || lpad((floor(random() * 1e14))::bigint::text, 14, '0');
  sm := 0;
  for i in 1..15 loop
    d := substr(v, 16 - i, 1)::int;
    if i % 2 = 1 then d := d * 2; if d > 9 then d := d - 9; end if; end if;
    sm := sm + d;
  end loop;
  v := v || ((10 - sm % 10) % 10)::text;

  insert into public.cards (user_id, account_id, label, network, card_number, last4, exp_month, exp_year, cvv, color)
  values (me.id, a.id, coalesce(left(nullif(trim(p_label), ''), 40), 'Virtual card'),
          case when p_network = 'mastercard' then 'mastercard' else 'visa' end,
          v, right(v, 4), extract(month from now())::int, extract(year from now())::int + 4,
          lpad((floor(random() * 1000))::int::text, 3, '0'),
          case when p_color in ('midnight','gold','aurora','graphite') then p_color else 'midnight' end)
  returning * into c;
  perform public.notify_user(me.id, 'Virtual card created', c.label || ' ending ' || c.last4 || ' is ready to use.', 'success', '#/cards');
  return jsonb_build_object('ok', true, 'id', c.id);
end $$;

create or replace function public.update_card(
  p_card uuid, p_status text default null, p_spend_limit numeric default null, p_clear_limit boolean default false,
  p_online boolean default null, p_contactless boolean default null, p_label text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.current_profile(); c public.cards;
begin
  select * into c from public.cards where id = p_card and user_id = me.id for update;
  if not found then raise exception 'Card not found.'; end if;
  if c.status = 'cancelled' then raise exception 'This card has been cancelled.'; end if;
  if p_status is not null and p_status not in ('active', 'frozen', 'cancelled') then raise exception 'Invalid card status.'; end if;
  if p_spend_limit is not null and p_spend_limit <= 0 then raise exception 'Spending limit must be greater than zero.'; end if;
  update public.cards set
    status          = coalesce(p_status, status),
    spend_limit     = case when p_clear_limit then null else coalesce(round(p_spend_limit, 2), spend_limit) end,
    online_payments = coalesce(p_online, online_payments),
    contactless     = coalesce(p_contactless, contactless),
    label           = coalesce(left(nullif(trim(p_label), ''), 40), label)
  where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

-- Savings goals ---------------------------------------------------------------

create or replace function public.create_goal(p_name text, p_currency text, p_target numeric, p_target_date date default null, p_icon text default 'target')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.current_profile(); g public.savings_goals;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Give your goal a name.'; end if;
  if coalesce(p_target, 0) <= 0 then raise exception 'Set a target amount greater than zero.'; end if;
  if not exists (select 1 from public.fx_rates where currency = upper(p_currency)) then raise exception 'That currency is not supported.'; end if;
  if p_target_date is not null and p_target_date < current_date then raise exception 'The target date must be in the future.'; end if;
  if (select count(*) from public.savings_goals where user_id = me.id and status <> 'closed') >= 12 then
    raise exception 'You can have up to 12 goals.';
  end if;
  insert into public.savings_goals (user_id, name, currency, target_amount, target_date, icon)
  values (me.id, left(trim(p_name), 60), upper(p_currency), round(p_target, 2), p_target_date, left(coalesce(p_icon, 'target'), 20))
  returning * into g;
  return jsonb_build_object('ok', true, 'id', g.id);
end $$;

create or replace function public.move_goal_funds(p_goal uuid, p_account uuid, p_amount numeric, p_direction text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me  public.profiles := public.current_profile();
  g   public.savings_goals;
  a   public.accounts;
  v_amount numeric := round(coalesce(p_amount, 0), 2);   -- in ACCOUNT currency when depositing, GOAL currency when withdrawing
  v_goal_amt numeric;
  v_acc_amt  numeric;
begin
  if p_direction not in ('in', 'out') then raise exception 'Invalid direction.'; end if;
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  select * into g from public.savings_goals where id = p_goal and user_id = me.id for update;
  if not found or g.status = 'closed' then raise exception 'Goal not found.'; end if;
  select * into a from public.accounts where id = p_account and user_id = me.id for update;
  if not found or a.status <> 'active' then raise exception 'Choose an active account.'; end if;

  if p_direction = 'in' then
    if a.balance < v_amount then raise exception 'Insufficient funds. Your available balance is %.', public.fmt_money(a.balance, a.currency); end if;
    v_acc_amt  := v_amount;
    v_goal_amt := public.fx_convert(v_amount, a.currency, g.currency);
    update public.accounts set balance = balance - v_acc_amt where id = a.id returning * into a;
    update public.savings_goals set saved_amount = saved_amount + v_goal_amt,
           status = case when saved_amount + v_goal_amt >= target_amount then 'completed' else 'active' end
     where id = g.id returning * into g;
    insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency, balance_after, description, counterparty_name)
    values (public.gen_reference('SAV'), a.id, me.id, 'debit', 'savings', 'savings', v_acc_amt, a.currency, a.balance, 'Saved to ' || g.name, g.name);
    if g.status = 'completed' then
      perform public.notify_user(me.id, 'Goal reached', 'You reached your "' || g.name || '" goal. Well done!', 'success', '#/savings');
    end if;
  else
    if g.saved_amount < v_amount then raise exception 'This goal only holds %.', public.fmt_money(g.saved_amount, g.currency); end if;
    v_goal_amt := v_amount;
    v_acc_amt  := public.fx_convert(v_amount, g.currency, a.currency);
    update public.savings_goals set saved_amount = saved_amount - v_goal_amt,
           status = case when saved_amount - v_goal_amt >= target_amount then 'completed' else 'active' end
     where id = g.id returning * into g;
    update public.accounts set balance = balance + v_acc_amt where id = a.id returning * into a;
    insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency, balance_after, description, counterparty_name)
    values (public.gen_reference('SAV'), a.id, me.id, 'credit', 'savings', 'savings', v_acc_amt, a.currency, a.balance, 'Withdrawn from ' || g.name, g.name);
  end if;
  return jsonb_build_object('ok', true, 'saved_amount', g.saved_amount, 'status', g.status);
end $$;

create or replace function public.close_goal(p_goal uuid, p_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.current_profile(); g public.savings_goals;
begin
  select * into g from public.savings_goals where id = p_goal and user_id = me.id;
  if not found or g.status = 'closed' then raise exception 'Goal not found.'; end if;
  if g.saved_amount > 0 then
    perform public.move_goal_funds(p_goal, p_account, g.saved_amount, 'out');
  end if;
  update public.savings_goals set status = 'closed' where id = p_goal;
  return jsonb_build_object('ok', true);
end $$;

-- Loans -----------------------------------------------------------------------

create or replace function public.loan_quote(p_amount numeric, p_term int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.settings; r numeric; pmt numeric;
begin
  select * into s from public.settings where id = 1;
  r := s.loan_apr / 12;
  if r = 0 then pmt := p_amount / p_term;
  else pmt := p_amount * r / (1 - power(1 + r, -p_term)); end if;
  return jsonb_build_object('apr', s.loan_apr, 'monthly_payment', round(pmt, 2), 'total_repayable', round(pmt * p_term, 2));
end $$;

create or replace function public.apply_loan(p_account uuid, p_amount numeric, p_term int, p_purpose text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public.current_profile();
  s  public.settings;
  a  public.accounts;
  q  jsonb;
  l  public.loans;
begin
  perform public.assert_can_send(me);
  select * into s from public.settings where id = 1;
  select * into a from public.accounts where id = p_account and user_id = me.id and status = 'active';
  if not found then raise exception 'Choose an active account to receive the loan.'; end if;
  if coalesce(p_term, 0) not between 3 and 60 then raise exception 'Choose a term between 3 and 60 months.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter a loan amount greater than zero.'; end if;
  if public.fx_convert(p_amount, a.currency, s.base_currency) > s.max_loan then
    raise exception 'The maximum loan is %.', public.fmt_money(s.max_loan, s.base_currency);
  end if;
  if exists (select 1 from public.loans where user_id = me.id and status in ('pending', 'active')) then
    raise exception 'You already have a loan that is pending or active.';
  end if;
  q := public.loan_quote(round(p_amount, 2), p_term);
  insert into public.loans (user_id, account_id, amount, currency, term_months, apr, purpose, monthly_payment, total_repayable)
  values (me.id, a.id, round(p_amount, 2), a.currency, p_term, s.loan_apr, left(coalesce(trim(p_purpose), ''), 280),
          (q->>'monthly_payment')::numeric, (q->>'total_repayable')::numeric)
  returning * into l;
  perform public.notify_user(me.id, 'Loan application received',
    'We are reviewing your request for ' || public.fmt_money(l.amount, l.currency) || '.', 'info', '#/loans');
  return jsonb_build_object('ok', true, 'id', l.id);
end $$;

create or replace function public.repay_loan(p_loan uuid, p_account uuid, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := public.current_profile();
  l  public.loans;
  a  public.accounts;
  v_loan_amt numeric;
  v_acc_amt  numeric;
begin
  select * into l from public.loans where id = p_loan and user_id = me.id for update;
  if not found or l.status <> 'active' then raise exception 'There is no active loan to repay.'; end if;
  select * into a from public.accounts where id = p_account and user_id = me.id for update;
  if not found or a.status <> 'active' then raise exception 'Choose an active account.'; end if;
  v_loan_amt := least(round(coalesce(p_amount, 0), 2), l.outstanding);   -- p_amount is in LOAN currency
  if v_loan_amt <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  v_acc_amt := public.fx_convert(v_loan_amt, l.currency, a.currency);
  if a.balance < v_acc_amt then raise exception 'Insufficient funds. Your available balance is %.', public.fmt_money(a.balance, a.currency); end if;

  update public.accounts set balance = balance - v_acc_amt where id = a.id returning * into a;
  update public.loans set outstanding = outstanding - v_loan_amt,
         status = case when outstanding - v_loan_amt <= 0 then 'repaid' else 'active' end, updated_at = now()
   where id = l.id returning * into l;
  insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency, balance_after, description, counterparty_name)
  values (public.gen_reference('LNR'), a.id, me.id, 'debit', 'loan', 'loan', v_acc_amt, a.currency, a.balance, 'Loan repayment', 'Aureon Loans');
  if l.status = 'repaid' then
    perform public.notify_user(me.id, 'Loan fully repaid', 'Congratulations — your loan is fully repaid.', 'success', '#/loans');
  end if;
  return jsonb_build_object('ok', true, 'outstanding', l.outstanding, 'status', l.status);
end $$;

-- KYC, notifications, support -------------------------------------------------

create or replace function public.submit_kyc(
  p_full_name text, p_date_of_birth date, p_address text, p_city text, p_country text,
  p_document_type text, p_document_number text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles := public.current_profile();
begin
  if me.kyc_status in ('pending', 'verified') then raise exception 'Your verification is already %.', me.kyc_status; end if;
  if coalesce(trim(p_full_name), '') = '' or p_date_of_birth is null or coalesce(trim(p_address), '') = ''
     or coalesce(trim(p_country), '') = '' or coalesce(trim(p_document_number), '') = '' then
    raise exception 'Please complete every field.';
  end if;
  if p_date_of_birth > current_date - interval '18 years' then raise exception 'You must be at least 18 years old.'; end if;
  if p_document_type not in ('passport', 'national_id', 'drivers_license') then raise exception 'Choose a valid document type.'; end if;
  perform set_config('aureon.trusted', 'on', true);
  update public.profiles set
    full_name = left(trim(p_full_name), 120), date_of_birth = p_date_of_birth, address = left(trim(p_address), 200),
    city = left(trim(p_city), 80), country = left(trim(p_country), 80), kyc_document_type = p_document_type,
    kyc_document_number = left(upper(trim(p_document_number)), 40), kyc_status = 'pending', kyc_note = null
  where id = me.id;
  perform set_config('aureon.trusted', 'off', true);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = public as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

create or replace function public.create_ticket(p_subject text, p_body text, p_category text default 'general')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles; t public.support_tickets;
begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;
  select * into me from public.profiles where id = auth.uid();   -- frozen customers can still contact support
  if char_length(coalesce(trim(p_subject), '')) < 3 then raise exception 'Add a short subject.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Describe how we can help.'; end if;
  insert into public.support_tickets (user_id, subject, category)
  values (me.id, left(trim(p_subject), 120), left(coalesce(p_category, 'general'), 30)) returning * into t;
  insert into public.ticket_messages (ticket_id, author_id, is_staff, body) values (t.id, me.id, false, left(trim(p_body), 4000));
  return jsonb_build_object('ok', true, 'id', t.id);
end $$;

create or replace function public.post_ticket_message(p_ticket uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; v_staff boolean := public.is_admin();
begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found or (t.user_id <> auth.uid() and not v_staff) then raise exception 'Ticket not found.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message first.'; end if;
  insert into public.ticket_messages (ticket_id, author_id, is_staff, body) values (t.id, auth.uid(), v_staff, left(trim(p_body), 4000));
  update public.support_tickets set status = case when v_staff then 'answered' else 'open' end, updated_at = now() where id = t.id;
  if v_staff then
    perform public.notify_user(t.user_id, 'Support replied', 'New reply on "' || t.subject || '".', 'info', '#/support');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.set_ticket_status(p_ticket uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket;
  if not found or (t.user_id <> auth.uid() and not public.is_admin()) then raise exception 'Ticket not found.'; end if;
  if p_status not in ('open', 'closed') then raise exception 'Invalid status.'; end if;
  update public.support_tickets set status = p_status, updated_at = now() where id = p_ticket;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
--  6. Admin functions
-- -----------------------------------------------------------------------------

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.settings; v jsonb;
begin
  perform public.require_admin();
  select * into s from public.settings where id = 1;
  select jsonb_build_object(
    'base_currency',        s.base_currency,
    'customers',            (select count(*) from public.profiles where role = 'customer'),
    'new_customers_30d',    (select count(*) from public.profiles where role = 'customer' and created_at > now() - interval '30 days'),
    'accounts',             (select count(*) from public.accounts where status <> 'closed'),
    'deposits',             (select coalesce(sum(public.fx_convert(balance, currency, s.base_currency)), 0) from public.accounts where status <> 'closed'),
    'loan_book',            (select coalesce(sum(public.fx_convert(outstanding, currency, s.base_currency)), 0) from public.loans where status = 'active'),
    'pending_transactions', (select count(*) from public.transactions where status = 'pending' and direction = 'debit'),
    'pending_kyc',          (select count(*) from public.profiles where kyc_status = 'pending'),
    'pending_loans',        (select count(*) from public.loans where status = 'pending'),
    'open_tickets',         (select count(*) from public.support_tickets where status = 'open'),
    'restricted_users',     (select count(*) from public.profiles where status in ('restricted', 'frozen')),
    'txn_24h',              (select count(*) from public.transactions where direction = 'debit' and created_at > now() - interval '24 hours'),
    'volume_30d',           (select coalesce(sum(public.fx_convert(amount, currency, s.base_currency)), 0) from public.transactions
                              where direction = 'debit' and status in ('completed', 'pending') and kind in ('transfer','external','bill')
                                and created_at > now() - interval '30 days'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'volume', d.volume, 'count', d.cnt) order by d.day), '[]'::jsonb)
                from (select g::date as day,
                             coalesce(sum(public.fx_convert(t.amount, t.currency, s.base_currency)), 0) as volume,
                             count(t.id) as cnt
                        from generate_series(current_date - 13, current_date, interval '1 day') g
                        left join public.transactions t
                          on t.created_at >= g and t.created_at < g + interval '1 day'
                         and t.direction = 'debit' and t.status in ('completed', 'pending')
                         and t.kind in ('transfer','external','bill')
                       group by g) d),
    'by_currency', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'total', total, 'accounts', n) order by total desc), '[]'::jsonb)
                      from (select currency, sum(balance) as total, count(*) as n from public.accounts where status <> 'closed' group by currency) c)
  ) into v;
  return v;
end $$;

create or replace function public.admin_adjust_balance(p_account uuid, p_direction text, p_amount numeric, p_description text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.accounts; v_amount numeric := round(coalesce(p_amount, 0), 2); v_ref text;
begin
  perform public.require_admin();
  if p_direction not in ('credit', 'debit') then raise exception 'Choose credit or debit.'; end if;
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  select * into a from public.accounts where id = p_account for update;
  if not found then raise exception 'Account not found.'; end if;
  if p_direction = 'debit' and a.balance < v_amount then
    raise exception 'The account only holds %.', public.fmt_money(a.balance, a.currency);
  end if;
  v_ref := public.gen_reference(case when p_direction = 'credit' then 'DEP' else 'WDL' end);
  update public.accounts set balance = balance + case when p_direction = 'credit' then v_amount else -v_amount end
   where id = a.id returning * into a;
  insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                   balance_after, description, counterparty_name, counterparty_bank, admin_note)
  values (v_ref, a.id, a.user_id, p_direction, case when p_direction = 'credit' then 'deposit' else 'withdrawal' end,
          case when p_direction = 'credit' then 'income' else 'other' end, v_amount, a.currency, a.balance,
          coalesce(left(nullif(trim(p_description), ''), 140), case when p_direction = 'credit' then 'Deposit' else 'Withdrawal' end),
          'Aureon', 'Aureon', left(nullif(trim(p_note), ''), 280));
  perform public.notify_user(a.user_id,
    case when p_direction = 'credit' then 'Account credited' else 'Account debited' end,
    public.fmt_money(v_amount, a.currency) || ' ' || case when p_direction = 'credit' then 'was added to' else 'was taken from' end
    || ' account ••' || right(a.account_number, 4) || '.', case when p_direction = 'credit' then 'success' else 'warning' end, '#/transactions');
  perform public.log_audit('balance.' || p_direction, 'account', a.id::text,
    jsonb_build_object('amount', v_amount, 'currency', a.currency, 'reference', v_ref, 'note', p_note));
  return jsonb_build_object('ok', true, 'balance', a.balance, 'reference', v_ref);
end $$;

-- approve / decline a PENDING transfer, or reverse a COMPLETED one.
create or replace function public.admin_review_transaction(p_group uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d   public.transactions;
  c   public.transactions;
  src public.accounts;
  dst public.accounts;
  v_note text := left(nullif(trim(p_note), ''), 280);
  v_total numeric;
begin
  perform public.require_admin();
  if p_action not in ('approve', 'decline', 'reverse') then raise exception 'Unknown action.'; end if;
  select * into d from public.transactions
   where group_id = p_group and direction = 'debit' and kind in ('transfer', 'external', 'bill') for update;
  if not found then raise exception 'Transaction not found or it cannot be reviewed.'; end if;
  select * into c from public.transactions where group_id = p_group and direction = 'credit' and kind = d.kind for update;
  perform 1 from public.accounts where id in (d.account_id, c.account_id) order by id for update;
  v_total := d.amount + d.fee;

  if p_action = 'approve' then
    if d.status <> 'pending' then raise exception 'Only pending transactions can be approved.'; end if;
    update public.transactions set status = 'completed', admin_note = v_note, updated_at = now() where id = d.id;
    if c.id is not null then
      update public.accounts set balance = balance + c.amount where id = c.account_id returning * into dst;
      update public.transactions set status = 'completed', balance_after = dst.balance, updated_at = now() where id = c.id;
      perform public.notify_user(c.user_id, 'Money received',
        c.counterparty_name || ' sent you ' || public.fmt_money(c.amount, c.currency) || '.', 'success', '#/transactions');
    end if;
    perform public.notify_user(d.user_id, 'Transfer approved',
      public.fmt_money(d.amount, d.currency) || ' to ' || d.counterparty_name || ' has been completed.', 'success', '#/transactions');

  elsif p_action = 'decline' then
    if d.status <> 'pending' then raise exception 'Only pending transactions can be declined.'; end if;
    update public.transactions set status = 'declined', admin_note = v_note, updated_at = now() where group_id = p_group;
    update public.accounts set balance = balance + v_total where id = d.account_id returning * into src;
    insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                     balance_after, description, counterparty_name, metadata)
    values (d.reference, src.id, d.user_id, 'credit', 'reversal', 'transfer', v_total, d.currency, src.balance,
            'Refund · ' || d.description, d.counterparty_name, jsonb_build_object('reverses', p_group));
    perform public.notify_user(d.user_id, 'Transfer declined',
      public.fmt_money(d.amount, d.currency) || ' to ' || d.counterparty_name || ' was declined and refunded.'
      || coalesce(' Reason: ' || v_note, ''), 'danger', '#/transactions');

  else
    if d.status <> 'completed' then raise exception 'Only completed transactions can be reversed.'; end if;
    if c.id is not null then
      select * into dst from public.accounts where id = c.account_id;
      if dst.balance < c.amount then
        raise exception 'The recipient only holds % — not enough to reverse this transfer.', public.fmt_money(dst.balance, dst.currency);
      end if;
    end if;
    update public.transactions set status = 'reversed', admin_note = v_note, updated_at = now() where group_id = p_group;
    if c.id is not null then
      update public.accounts set balance = balance - c.amount where id = dst.id returning * into dst;
      insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                       balance_after, description, counterparty_name, metadata)
      values (d.reference, dst.id, dst.user_id, 'debit', 'reversal', 'transfer', c.amount, dst.currency, dst.balance,
              'Reversal · ' || c.description, c.counterparty_name, jsonb_build_object('reverses', p_group));
      perform public.notify_user(dst.user_id, 'Transfer reversed',
        public.fmt_money(c.amount, c.currency) || ' from ' || c.counterparty_name || ' was reversed.', 'warning', '#/transactions');
    end if;
    update public.accounts set balance = balance + v_total where id = d.account_id returning * into src;
    insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                     balance_after, description, counterparty_name, metadata)
    values (d.reference, src.id, d.user_id, 'credit', 'reversal', 'transfer', v_total, d.currency, src.balance,
            'Reversal · ' || d.description, d.counterparty_name, jsonb_build_object('reverses', p_group));
    perform public.notify_user(d.user_id, 'Transfer reversed',
      public.fmt_money(v_total, d.currency) || ' was returned to your account.' || coalesce(' Note: ' || v_note, ''), 'info', '#/transactions');
  end if;

  perform public.log_audit('transaction.' || p_action, 'transaction', p_group::text,
    jsonb_build_object('reference', d.reference, 'amount', d.amount, 'currency', d.currency, 'note', v_note));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_status not in ('active', 'restricted', 'frozen', 'closed') then raise exception 'Invalid status.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own status.'; end if;
  if p_status <> 'active' and coalesce(trim(p_reason), '') = '' then raise exception 'Give the customer a reason.'; end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'super_admin') then
    raise exception 'A super admin cannot be flagged or frozen.';
  end if;
  update public.profiles set status = p_status,
         status_reason = case when p_status = 'active' then null else left(trim(p_reason), 280) end
   where id = p_user;
  if not found then raise exception 'Customer not found.'; end if;
  perform public.notify_user(p_user,
    case p_status when 'active' then 'Your profile is active' when 'restricted' then 'Outgoing payments restricted'
                  when 'frozen' then 'Your profile is frozen' else 'Your profile is closed' end,
    coalesce(nullif(trim(p_reason), ''), 'All services are available again.'),
    case when p_status = 'active' then 'success' else 'danger' end, null);
  perform public.log_audit('user.status', 'profile', p_user::text, jsonb_build_object('status', p_status, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_user_role(p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_super_admin();
  if p_role not in ('customer', 'admin') then raise exception 'Invalid role.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role.'; end if;
  update public.profiles set role = p_role where id = p_user and role <> 'super_admin';
  if not found then raise exception 'Customer not found, or they are a super admin.'; end if;
  perform public.log_audit('user.role', 'profile', p_user::text, jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_account_status(p_account uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.accounts;
begin
  perform public.require_admin();
  if p_status not in ('active', 'frozen') then raise exception 'Invalid status.'; end if;
  update public.accounts set status = p_status where id = p_account and status <> 'closed' returning * into a;
  if not found then raise exception 'Account not found.'; end if;
  perform public.notify_user(a.user_id, 'Account ' || case when p_status = 'frozen' then 'frozen' else 'unfrozen' end,
    'Account ••' || right(a.account_number, 4) || ' is now ' || p_status || '.', case when p_status = 'frozen' then 'warning' else 'success' end, '#/accounts');
  perform public.log_audit('account.status', 'account', a.id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_decide_kyc(p_user uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  update public.profiles set kyc_status = case when p_approve then 'verified' else 'rejected' end,
         kyc_note = left(nullif(trim(p_note), ''), 280)
   where id = p_user and kyc_status = 'pending';
  if not found then raise exception 'No pending verification for this customer.'; end if;
  perform public.notify_user(p_user,
    case when p_approve then 'Identity verified' else 'Verification unsuccessful' end,
    case when p_approve then 'Your identity is verified. Thank you!'
         else 'We could not verify your identity.' || coalesce(' ' || nullif(trim(p_note), ''), '') || ' You can submit again.' end,
    case when p_approve then 'success' else 'warning' end, '#/profile');
  perform public.log_audit('kyc.' || case when p_approve then 'approve' else 'reject' end, 'profile', p_user::text, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_decide_loan(p_loan uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.loans; a public.accounts;
begin
  perform public.require_admin();
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status <> 'pending' then raise exception 'This loan is not pending.'; end if;
  if p_approve then
    select * into a from public.accounts where id = l.account_id for update;
    if a.status <> 'active' then raise exception 'The destination account is not active.'; end if;
    update public.accounts set balance = balance + l.amount where id = a.id returning * into a;
    insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                     balance_after, description, counterparty_name)
    values (public.gen_reference('LON'), a.id, l.user_id, 'credit', 'loan', 'loan', l.amount, l.currency, a.balance,
            'Loan disbursement', 'Aureon Loans');
    update public.loans set status = 'active', outstanding = total_repayable, admin_note = left(nullif(trim(p_note), ''), 280),
           decided_at = now(), updated_at = now() where id = l.id;
    perform public.notify_user(l.user_id, 'Loan approved',
      public.fmt_money(l.amount, l.currency) || ' has been paid into your account.', 'success', '#/loans');
  else
    update public.loans set status = 'rejected', admin_note = left(nullif(trim(p_note), ''), 280),
           decided_at = now(), updated_at = now() where id = l.id;
    perform public.notify_user(l.user_id, 'Loan not approved',
      'Your loan application was not approved.' || coalesce(' ' || nullif(trim(p_note), ''), ''), 'warning', '#/loans');
  end if;
  perform public.log_audit('loan.' || case when p_approve then 'approve' else 'reject' end, 'loan', l.id::text,
    jsonb_build_object('amount', l.amount, 'currency', l.currency, 'note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- Pre-open an account for someone. If they already have a profile the account is
-- added straight away; otherwise it is linked when they sign up with that email.
create or replace function public.admin_create_invite(
  p_email text, p_full_name text, p_currency text default 'USD', p_account_type text default 'checking',
  p_opening_balance numeric default 0, p_phone text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles; a public.accounts; v_num text; v_bal numeric := round(coalesce(p_opening_balance, 0), 2);
begin
  perform public.require_admin();
  if coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.'; end if;
  if not exists (select 1 from public.fx_rates where currency = upper(p_currency)) then raise exception 'That currency is not supported.'; end if;
  if p_account_type not in ('checking', 'savings', 'business') then raise exception 'Choose a valid account type.'; end if;
  if v_bal < 0 then raise exception 'Opening balance cannot be negative.'; end if;
  v_num := public.gen_account_number();

  select * into p from public.profiles where lower(email) = lower(trim(p_email));
  if found then
    insert into public.accounts (user_id, account_number, type, currency, balance, is_primary)
    values (p.id, v_num, p_account_type, upper(p_currency), v_bal,
            not exists (select 1 from public.accounts where user_id = p.id and is_primary and status <> 'closed'))
    returning * into a;
    if v_bal > 0 then
      insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                       balance_after, description, counterparty_name, counterparty_bank)
      values (public.gen_reference('DEP'), a.id, p.id, 'credit', 'deposit', 'income', v_bal, a.currency, a.balance,
              'Opening balance', 'Aureon', 'Aureon');
    end if;
    perform public.notify_user(p.id, 'New account opened', initcap(a.type) || ' account ' || a.account_number || ' was opened for you.', 'success', '#/accounts');
    perform public.log_audit('account.open', 'account', a.id::text, jsonb_build_object('email', p.email, 'opening_balance', v_bal));
    return jsonb_build_object('ok', true, 'linked', true, 'account_number', v_num);
  end if;

  insert into public.account_invites (email, full_name, phone, currency, account_type, opening_balance, account_number, created_by)
  values (lower(trim(p_email)), left(coalesce(trim(p_full_name), ''), 120), left(nullif(trim(p_phone), ''), 40),
          upper(p_currency), p_account_type, v_bal, v_num, auth.uid());
  perform public.log_audit('invite.create', 'invite', v_num, jsonb_build_object('email', p_email, 'opening_balance', v_bal));
  return jsonb_build_object('ok', true, 'linked', false, 'account_number', v_num);
end $$;

create or replace function public.admin_delete_invite(p_invite uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.account_invites where id = p_invite and claimed_by is null;
  if not found then raise exception 'Invite not found or already claimed.'; end if;
  perform public.log_audit('invite.delete', 'invite', p_invite::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_pin(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from private.pins where user_id = p_user;
  perform public.notify_user(p_user, 'Transaction PIN reset', 'Our team reset your PIN. Create a new one in Security before your next payment.', 'warning', '#/security');
  perform public.log_audit('user.pin_reset', 'profile', p_user::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_update_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  update public.settings set
    bank_name        = coalesce(nullif(trim(p->>'bank_name'), ''), bank_name),
    internal_fee_pct = coalesce((p->>'internal_fee_pct')::numeric, internal_fee_pct),
    external_fee_pct = coalesce((p->>'external_fee_pct')::numeric, external_fee_pct),
    external_fee_min = coalesce((p->>'external_fee_min')::numeric, external_fee_min),
    review_threshold = coalesce((p->>'review_threshold')::numeric, review_threshold),
    daily_limit      = coalesce((p->>'daily_limit')::numeric, daily_limit),
    loan_apr         = coalesce((p->>'loan_apr')::numeric, loan_apr),
    savings_apr      = coalesce((p->>'savings_apr')::numeric, savings_apr),
    max_loan         = coalesce((p->>'max_loan')::numeric, max_loan),
    welcome_bonus    = coalesce((p->>'welcome_bonus')::numeric, welcome_bonus),
    support_email    = coalesce(p->>'support_email', support_email),
    updated_at       = now()
  where id = 1;
  perform public.log_audit('settings.update', 'settings', '1', p);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_fx_rate(p_currency text, p_per_usd numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if upper(p_currency) = 'USD' then raise exception 'USD is the reference currency and is always 1.'; end if;
  if coalesce(p_per_usd, 0) <= 0 then raise exception 'Rate must be greater than zero.'; end if;
  update public.fx_rates set per_usd = p_per_usd, updated_at = now() where currency = upper(p_currency);
  if not found then raise exception 'Currency not found.'; end if;
  perform public.log_audit('fx.update', 'fx_rate', upper(p_currency), jsonb_build_object('per_usd', p_per_usd));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_broadcast(p_title text, p_body text, p_kind text default 'info', p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_admin();
  if coalesce(trim(p_title), '') = '' then raise exception 'Add a title.'; end if;
  insert into public.notifications (user_id, title, body, kind)
  select id, left(trim(p_title), 120), left(coalesce(trim(p_body), ''), 1000),
         case when p_kind in ('info','success','warning','danger') then p_kind else 'info' end
    from public.profiles where (p_user is null and role = 'customer') or id = p_user;
  get diagnostics n = row_count;
  perform public.log_audit('notify.broadcast', 'profile', coalesce(p_user::text, 'all'), jsonb_build_object('title', p_title, 'recipients', n));
  return jsonb_build_object('ok', true, 'recipients', n);
end $$;

-- Pays one month of interest (settings.savings_apr / 12) into every active savings account.
create or replace function public.admin_apply_interest()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.settings; a record; v numeric; n int := 0; v_bal numeric;
begin
  perform public.require_admin();
  select * into s from public.settings where id = 1;
  for a in select * from public.accounts where type = 'savings' and status = 'active' and balance > 0 for update loop
    v := round(a.balance * s.savings_apr / 12, 2);
    if v > 0 then
      update public.accounts set balance = balance + v where id = a.id returning balance into v_bal;
      insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                       balance_after, description, counterparty_name)
      values (public.gen_reference('INT'), a.id, a.user_id, 'credit', 'interest', 'income', v, a.currency, v_bal,
              'Monthly interest', 'Aureon');
      n := n + 1;
    end if;
  end loop;
  perform public.log_audit('interest.apply', 'accounts', null, jsonb_build_object('accounts', n, 'apr', s.savings_apr));
  return jsonb_build_object('ok', true, 'accounts', n);
end $$;

-- Super admin ledger tools ------------------------------------------------------
-- Every entry still moves the balance, so the balance and the history always agree.

create or replace function public.admin_post_transaction(
  p_account      uuid,
  p_direction    text,
  p_amount       numeric,
  p_description  text,
  p_date         timestamptz default null,
  p_counterparty text default null,
  p_category     text default null,
  p_note         text default null,
  p_notify       boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a        public.accounts;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_date   timestamptz := coalesce(p_date, now());
  v_ref    text;
  v_id     uuid;
  v_cat    text;
begin
  perform public.require_super_admin();
  if p_direction not in ('credit', 'debit') then raise exception 'Choose credit or debit.'; end if;
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Add a description.'; end if;
  if v_date > now() + interval '5 minutes' then raise exception 'The date cannot be in the future.'; end if;
  v_cat := case when p_category in ('income','transfer','bills','shopping','food','transport','entertainment','health','savings','loan','fees','other')
                then p_category when p_direction = 'credit' then 'income' else 'other' end;

  select * into a from public.accounts where id = p_account for update;
  if not found then raise exception 'Account not found.'; end if;
  if p_direction = 'debit' and a.balance < v_amount then
    raise exception 'The account only holds %.', public.fmt_money(a.balance, a.currency);
  end if;

  v_ref := public.gen_reference(case when p_direction = 'credit' then 'DEP' else 'WDL' end);
  update public.accounts set balance = balance + case when p_direction = 'credit' then v_amount else -v_amount end
   where id = a.id returning * into a;
  insert into public.transactions (reference, account_id, user_id, direction, kind, category, amount, currency,
                                   balance_after, description, counterparty_name, admin_note, metadata, created_at, updated_at)
  values (v_ref, a.id, a.user_id, p_direction, case when p_direction = 'credit' then 'deposit' else 'withdrawal' end,
          v_cat, v_amount, a.currency, a.balance, left(trim(p_description), 140),
          coalesce(left(nullif(trim(p_counterparty), ''), 120), 'Aureon'), left(nullif(trim(p_note), ''), 280),
          jsonb_build_object('posted_by_admin', true), v_date, now())
  returning id into v_id;
  perform public.recompute_running_balances(a.id);

  if p_notify then
    perform public.notify_user(a.user_id,
      case when p_direction = 'credit' then 'Account credited' else 'Account debited' end,
      public.fmt_money(v_amount, a.currency) || ' · ' || trim(p_description), case when p_direction = 'credit' then 'success' else 'warning' end, '#/transactions');
  end if;
  perform public.log_audit('ledger.post', 'transaction', v_id::text,
    jsonb_build_object('account', a.account_number, 'direction', p_direction, 'amount', v_amount, 'currency', a.currency, 'date', v_date, 'description', p_description));
  return jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref, 'balance', a.balance);
end $$;

create or replace function public.admin_update_transaction(
  p_id           uuid,
  p_description  text default null,
  p_date         timestamptz default null,
  p_counterparty text default null,
  p_category     text default null,
  p_note         text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.transactions;
begin
  perform public.require_super_admin();
  select * into t from public.transactions where id = p_id for update;
  if not found then raise exception 'Transaction not found.'; end if;
  if p_date is not null and p_date > now() + interval '5 minutes' then raise exception 'The date cannot be in the future.'; end if;
  update public.transactions set
    description       = coalesce(left(nullif(trim(p_description), ''), 140), description),
    created_at        = coalesce(p_date, created_at),
    counterparty_name = coalesce(left(nullif(trim(p_counterparty), ''), 120), counterparty_name),
    category          = case when p_category in ('income','transfer','bills','shopping','food','transport','entertainment','health','savings','loan','fees','other') then p_category else category end,
    admin_note        = coalesce(left(nullif(trim(p_note), ''), 280), admin_note),
    updated_at        = now()
  where id = t.id;
  if p_date is not null then perform public.recompute_running_balances(t.account_id); end if;
  perform public.log_audit('ledger.edit', 'transaction', t.id::text,
    jsonb_build_object('reference', t.reference, 'old_date', t.created_at, 'new_date', p_date, 'old_description', t.description, 'new_description', p_description));
  return jsonb_build_object('ok', true);
end $$;

-- Removes one ledger row AND undoes its effect on the balance.
create or replace function public.admin_delete_transaction(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.transactions; a public.accounts; v_delta numeric := 0;
begin
  perform public.require_super_admin();
  select * into t from public.transactions where id = p_id for update;
  if not found then raise exception 'Transaction not found.'; end if;
  if t.status = 'pending' then raise exception 'Approve or decline pending transactions instead of deleting them.'; end if;
  select * into a from public.accounts where id = t.account_id for update;

  if t.direction = 'debit' then v_delta := t.amount + t.fee;
  elsif t.status in ('completed', 'reversed') then v_delta := -t.amount;
  end if;
  if a.balance + v_delta < 0 then
    raise exception 'Deleting this credit would make the balance negative (it holds %).', public.fmt_money(a.balance, a.currency);
  end if;

  update public.accounts set balance = balance + v_delta where id = a.id returning * into a;
  delete from public.transactions where id = t.id;
  perform public.recompute_running_balances(a.id);
  perform public.log_audit('ledger.delete', 'transaction', t.id::text, to_jsonb(t));
  return jsonb_build_object('ok', true, 'balance', a.balance);
end $$;

-- -----------------------------------------------------------------------------
--  7. Keep-alive (called every 6 hours by scripts/keep-alive.mjs)
-- -----------------------------------------------------------------------------

create or replace function public.ping(p_source text default 'keep-alive')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.heartbeat;
begin
  insert into public.heartbeat (id, last_ping, ping_count, source)
  values (1, now(), 1, left(coalesce(p_source, 'keep-alive'), 64))
  on conflict (id) do update
    set last_ping = now(), ping_count = public.heartbeat.ping_count + 1, source = excluded.source
  returning * into r;
  return jsonb_build_object('ok', true, 'last_ping', r.last_ping, 'ping_count', r.ping_count);
end $$;

-- -----------------------------------------------------------------------------
--  8. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.settings         enable row level security;
alter table public.fx_rates         enable row level security;
alter table public.admin_allowlist  enable row level security;
alter table public.profiles         enable row level security;
alter table public.accounts         enable row level security;
alter table public.transactions     enable row level security;
alter table public.beneficiaries    enable row level security;
alter table public.cards            enable row level security;
alter table public.savings_goals    enable row level security;
alter table public.loans            enable row level security;
alter table public.notifications    enable row level security;
alter table public.support_tickets  enable row level security;
alter table public.ticket_messages  enable row level security;
alter table public.account_invites  enable row level security;
alter table public.audit_log        enable row level security;
alter table public.heartbeat        enable row level security;

-- public reference data
drop policy if exists "settings readable" on public.settings;
create policy "settings readable" on public.settings for select to anon, authenticated using (true);
drop policy if exists "fx readable" on public.fx_rates;
create policy "fx readable" on public.fx_rates for select to anon, authenticated using (true);

drop policy if exists "allowlist admin" on public.admin_allowlist;
create policy "allowlist admin" on public.admin_allowlist for select to authenticated using (public.is_admin());

-- profiles
drop policy if exists "profiles self or admin" on public.profiles;
create policy "profiles self or admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- owner-or-admin read-only tables (all writes happen in the functions above)
drop policy if exists "accounts owner or admin" on public.accounts;
create policy "accounts owner or admin" on public.accounts for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "transactions owner or admin" on public.transactions;
create policy "transactions owner or admin" on public.transactions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "cards owner or admin" on public.cards;
create policy "cards owner or admin" on public.cards for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "goals owner or admin" on public.savings_goals;
create policy "goals owner or admin" on public.savings_goals for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "loans owner or admin" on public.loans;
create policy "loans owner or admin" on public.loans for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "tickets owner or admin" on public.support_tickets;
create policy "tickets owner or admin" on public.support_tickets for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "ticket messages owner or admin" on public.ticket_messages;
create policy "ticket messages owner or admin" on public.ticket_messages for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id and (t.user_id = (select auth.uid()) or public.is_admin())));
drop policy if exists "invites admin" on public.account_invites;
create policy "invites admin" on public.account_invites for select to authenticated using (public.is_admin());
drop policy if exists "audit admin" on public.audit_log;
create policy "audit admin" on public.audit_log for select to authenticated using (public.is_admin());

-- beneficiaries: customers manage their own address book
drop policy if exists "beneficiaries owner select" on public.beneficiaries;
create policy "beneficiaries owner select" on public.beneficiaries for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "beneficiaries owner insert" on public.beneficiaries;
create policy "beneficiaries owner insert" on public.beneficiaries for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "beneficiaries owner update" on public.beneficiaries;
create policy "beneficiaries owner update" on public.beneficiaries for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "beneficiaries owner delete" on public.beneficiaries;
create policy "beneficiaries owner delete" on public.beneficiaries for delete to authenticated using (user_id = (select auth.uid()));

-- notifications: read, mark read, delete own
drop policy if exists "notifications owner select" on public.notifications;
create policy "notifications owner select" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notifications owner update" on public.notifications;
create policy "notifications owner update" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "notifications owner delete" on public.notifications;
create policy "notifications owner delete" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
--  9. Privileges
-- -----------------------------------------------------------------------------

-- Tables: read through RLS; only a few columns are directly writable.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke select on all tables in schema public from anon;
grant select on public.settings, public.fx_rates to anon;
grant update (full_name, phone, address, city, country, date_of_birth, avatar_url, preferences) on public.profiles to authenticated;
grant insert, update, delete on public.beneficiaries to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
revoke select on public.heartbeat from authenticated;

-- Functions: signed-in users may call the public API; internal helpers stay private.
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public.check_pin(uuid, text)                       from authenticated;
revoke execute on function public.notify_user(uuid, text, text, text, text)   from authenticated;
revoke execute on function public.log_audit(text, text, text, jsonb)          from authenticated;
revoke execute on function public.gen_account_number()                        from authenticated;
revoke execute on function public.spent_today(uuid)                           from authenticated;
revoke execute on function public.recompute_running_balances(uuid)            from authenticated;
revoke execute on function public.handle_new_user()                           from authenticated;
revoke execute on function public.handle_user_email_change()                  from authenticated;
revoke execute on function public.profiles_before_update()                    from authenticated;
grant  execute on function public.ping(text)                                  to anon, authenticated;
grant  execute on function public.fx_convert(numeric, text, text)             to anon;

-- -----------------------------------------------------------------------------
--  10. Realtime (live balance + notification updates in the app)
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['notifications', 'transactions', 'accounts'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already published
      when undefined_object then null;   -- realtime publication not present
    end;
  end loop;
end $$;

-- =============================================================================
--  SUPER ADMINS
-- -----------------------------------------------------------------------------
--  Anyone who signs up with one of these emails becomes a SUPER ADMIN
--  automatically (fund customers, flag/unflag, add/edit/delete ledger entries,
--  promote admins). Existing profiles with these emails are promoted right away.
--  Add more lines to grant more super admins.
--
--  ⚠ Keep "Confirm email" switched ON in Supabase → Authentication → Sign In /
--    Providers → Email, so nobody else can register these addresses first.
-- =============================================================================
insert into public.admin_allowlist (email) values
  ('amos@gmail.com'),
  ('ekwuemevictor39@gmail.com')
on conflict (email) do nothing;

update public.profiles set role = 'super_admin'
 where lower(email) in (select lower(email) from public.admin_allowlist) and role <> 'super_admin';
