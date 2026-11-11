-- Sohal Gaming Tips — database schema
-- Run once in Supabase Dashboard → SQL Editor (or `supabase db push` if you use migrations).
-- Only the Edge Functions (service role) can read or write these tables.

create extension if not exists pgcrypto;

-- ── tips ────────────────────────────────────────────────────────────────
create table if not exists public.tips (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  name                text not null,
  message             text,
  amount_paise        integer not null check (amount_paise > 0),
  currency            text not null default 'INR',
  razorpay_order_id   text not null unique,
  razorpay_payment_id text unique,
  status              text not null default 'pending'
                        check (status in ('pending', 'paid', 'failed')),
  alert_sent          boolean not null default false,
  paid_at             timestamptz,
  mode                text check (mode in ('test', 'live'))
);

create index if not exists tips_created_at_idx on public.tips (created_at desc);
create index if not exists tips_status_idx     on public.tips (status);

-- RLS on, and deliberately NO policies: anon/authenticated roles get nothing.
alter table public.tips enable row level security;

-- ── rate_limits (create-order: max 5 orders per IP per minute) ─────────
-- Stores a SHA-256 hash of the IP, never the raw IP.
create table if not exists public.rate_limits (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limits_ip_time_idx on public.rate_limits (ip_hash, created_at desc);

alter table public.rate_limits enable row level security;

-- Belt and braces: revoke direct table access from the public API roles.
revoke all on public.tips        from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;
