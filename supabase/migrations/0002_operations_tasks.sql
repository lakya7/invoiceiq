-- 0002_operations_tasks.sql
-- Backing table for the Operations module (3 on-demand agents:
--   exception_triage | vendor_status | po_acknowledgment).
--
-- RLS mirrors public.invoices 1:1 (live policies dumped via pg_policies on 2026-06-02).
-- invoices convention: every row carries BOTH user_id (NOT NULL) and team_id (nullable);
-- own-row access by user_id, team access by team_id via get_user_team_ids(), admin team-delete.
--
-- NOTE: applied to prod (cwsubqfynnntrzfshldy) on 2026-06-02 via `supabase db query --linked`.
-- This repo file is the source-of-record DDL. It is idempotent so it can be safely re-run.

create table if not exists public.operations_tasks (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid references public.teams(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  type               text not null check (type in ('exception_triage','vendor_status','po_acknowledgment')),
  status             text not null default 'open' check (status in ('open','in_progress','resolved','dismissed')),
  payload            jsonb not null default '{}'::jsonb,
  related_invoice_id uuid references public.invoices(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists operations_tasks_team_id_idx     on public.operations_tasks (team_id);
create index if not exists operations_tasks_user_id_idx     on public.operations_tasks (user_id);
create index if not exists operations_tasks_type_status_idx on public.operations_tasks (type, status);

alter table public.operations_tasks enable row level security;

-- Frontend queries with the user's JWT (role: authenticated); RLS restricts rows.
-- service_role (backend) bypasses RLS and already has full privileges.
grant select, insert, update, delete on public.operations_tasks to authenticated;

-- ── Policies (mirror public.invoices exactly) ───────────────────────────────
drop policy if exists "Users can view own operations_tasks"          on public.operations_tasks;
drop policy if exists "Team members can view team operations_tasks"  on public.operations_tasks;
drop policy if exists "Users can insert own operations_tasks"        on public.operations_tasks;
drop policy if exists "Users can update own operations_tasks"        on public.operations_tasks;
drop policy if exists "Team members can update team operations_tasks" on public.operations_tasks;
drop policy if exists "Users can delete own operations_tasks"        on public.operations_tasks;
drop policy if exists "Admins can delete team operations_tasks"      on public.operations_tasks;

create policy "Users can view own operations_tasks"
  on public.operations_tasks for select
  using (auth.uid() = user_id);

create policy "Team members can view team operations_tasks"
  on public.operations_tasks for select
  using (team_id in (select get_user_team_ids(auth.uid())));

create policy "Users can insert own operations_tasks"
  on public.operations_tasks for insert
  with check (auth.uid() = user_id);

create policy "Users can update own operations_tasks"
  on public.operations_tasks for update
  using (auth.uid() = user_id);

create policy "Team members can update team operations_tasks"
  on public.operations_tasks for update
  using (team_id in (select get_user_team_ids(auth.uid())));

create policy "Users can delete own operations_tasks"
  on public.operations_tasks for delete
  using (auth.uid() = user_id);

create policy "Admins can delete team operations_tasks"
  on public.operations_tasks for delete
  using (team_id in (
    select tm.team_id from team_members tm
    where tm.user_id = auth.uid() and tm.role = 'admin' and tm.status = 'active'
  ));
