alter table line_notification_settings add column if not exists liff_id text;

alter table ai_stock_in_settings add column if not exists provider text not null default 'openai'
  check (provider in ('openai', 'anthropic'));
alter table ai_stock_in_settings add column if not exists model text not null default 'gpt-4o-mini';
alter table ai_stock_in_settings add column if not exists image_detail text not null default 'low'
  check (image_detail in ('low', 'auto', 'high'));
alter table ai_stock_in_settings add column if not exists max_tokens integer not null default 1500
  check (max_tokens between 100 and 8000);

create table if not exists line_bindings (
  id bigint generated always as identity primary key,
  profile_id uuid not null unique references profiles(id) on delete cascade,
  line_user_id text not null unique check (line_user_id like 'U%'),
  line_display_name text,
  notify_enabled boolean not null default true,
  bound_at timestamptz not null default now()
);

create table if not exists line_bind_codes (
  code text primary key check (code ~ '^[0-9]{6}$'),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ix_line_bind_codes_expires_at on line_bind_codes(expires_at);
alter table line_bindings enable row level security;
alter table line_bind_codes enable row level security;

drop policy if exists "line_bindings_admin_select" on line_bindings;
create policy "line_bindings_admin_select" on line_bindings for select to authenticated using (is_admin());
drop policy if exists "line_bind_codes_own_select" on line_bind_codes;
create policy "line_bind_codes_own_select" on line_bind_codes for select to authenticated using (profile_id = auth.uid() or is_admin());
