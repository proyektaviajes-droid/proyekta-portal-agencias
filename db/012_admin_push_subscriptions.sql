create table if not exists admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_push_subscriptions_admin_user_idx
  on admin_push_subscriptions(admin_user_id);

alter table admin_push_subscriptions enable row level security;
revoke all on table admin_push_subscriptions from anon, authenticated;
grant all on table admin_push_subscriptions to service_role;
