-- Baseline of the PRODUCTION public schema as of 2026-09-14 (structure only, no data).
-- Use to seed a fresh staging project; new changes go in supabase/migrations/.

-- Schema snapshot of public schema, project cwsubqfynnntrzfshldy, generated read-only via information_schema/pg_catalog

-- Extensions
create extension if not exists "pg_stat_statements";
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "supabase_vault";


create table public.agent_settings (
  id uuid not null default gen_random_uuid(),
  team_id uuid,
  agent_enabled boolean default true,
  auto_approve_below numeric default 500,
  escalate_above numeric default 5000,
  require_po_match boolean default false,
  trusted_vendors text[] default '{}'::text[],
  updated_at timestamp with time zone default now(),
  constraint agent_settings_team_id_key UNIQUE (team_id),
  constraint agent_settings_pkey PRIMARY KEY (id)
);
alter table public.agent_settings enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_settings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_settings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_settings to service_role;

create table public.distribution_defaults (
  id uuid not null default gen_random_uuid(),
  team_id uuid not null,
  scope_type text not null,
  scope_value text,
  distribution_combination text not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint distribution_defaults_pkey PRIMARY KEY (id),
  constraint distribution_defaults_scope_type_check CHECK ((scope_type = ANY (ARRAY['supplier_site'::text, 'supplier'::text, 'bu'::text, 'global'::text])))
);
CREATE INDEX idx_dist_defaults_lookup ON public.distribution_defaults USING btree (team_id, scope_type, scope_value) WHERE (active = true);
CREATE UNIQUE INDEX idx_dist_defaults_unique ON public.distribution_defaults USING btree (team_id, scope_type, COALESCE(scope_value, ''::text)) WHERE (active = true);
alter table public.distribution_defaults enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.distribution_defaults to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.distribution_defaults to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.distribution_defaults to service_role;

create table public.email_agent_config (
  id uuid not null default gen_random_uuid(),
  team_id uuid,
  provider text default 'gmail'::text,
  access_token text,
  refresh_token text,
  email text,
  enabled boolean default false,
  last_checked timestamp with time zone,
  updated_at timestamp with time zone default now(),
  constraint email_agent_config_team_id_key UNIQUE (team_id),
  constraint email_agent_config_pkey PRIMARY KEY (id)
);
alter table public.email_agent_config enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.email_agent_config to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.email_agent_config to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.email_agent_config to service_role;

create table public.email_agent_log (
  id uuid not null default gen_random_uuid(),
  team_id uuid,
  gmail_message_id text,
  from_email text,
  subject text,
  filename text,
  invoice_number text,
  vendor_name text,
  amount numeric,
  erp_reference text,
  processed_at timestamp with time zone default now(),
  constraint email_agent_log_pkey PRIMARY KEY (id)
);
alter table public.email_agent_log enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.email_agent_log to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.email_agent_log to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.email_agent_log to service_role;

create table public.erp_connections (
  id uuid not null default gen_random_uuid(),
  team_id uuid not null,
  erp_type text not null,
  base_url text,
  username text,
  password text,
  status text not null default 'disconnected'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  access_token text,
  refresh_token text,
  realm_id text,
  expires_at timestamp with time zone,
  constraint erp_connections_team_id_erp_type_key UNIQUE (team_id, erp_type),
  constraint erp_connections_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_erp_connections_team ON public.erp_connections USING btree (team_id);
alter table public.erp_connections enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_connections to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_connections to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_connections to service_role;

create table public.invoice_audit_log (
  id uuid not null default gen_random_uuid(),
  invoice_id uuid,
  team_id uuid,
  user_id uuid,
  user_email text,
  action text not null,
  detail text,
  actor text,
  created_at timestamp with time zone default now(),
  constraint invoice_audit_log_pkey PRIMARY KEY (id)
);
CREATE INDEX invoice_audit_log_invoice_id_idx ON public.invoice_audit_log USING btree (invoice_id);
CREATE INDEX invoice_audit_log_team_id_idx ON public.invoice_audit_log USING btree (team_id);
alter table public.invoice_audit_log enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoice_audit_log to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoice_audit_log to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoice_audit_log to service_role;

create table public.invoice_comments (
  id uuid not null default gen_random_uuid(),
  invoice_id uuid,
  team_id uuid,
  user_id uuid,
  user_email text,
  comment text not null,
  created_at timestamp with time zone default now(),
  constraint invoice_comments_pkey PRIMARY KEY (id)
);
alter table public.invoice_comments enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoice_comments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoice_comments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoice_comments to service_role;

create table public.invoices (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  invoice_number text,
  vendor_name text,
  invoice_date text,
  due_date text,
  total numeric(12,2) default 0,
  status text default 'pending'::text,
  erp_reference text,
  raw_data jsonb,
  created_at timestamp with time zone default now(),
  team_id uuid,
  po_id uuid,
  match_status text default 'unmatched'::text,
  match_details jsonb,
  approved_by uuid,
  submitted_by uuid,
  agent_decision text,
  agent_reason text,
  agent_rule text,
  currency text default 'USD'::text,
  payment_status text default 'unpaid'::text,
  paid_amount numeric default 0,
  payment_date date,
  payment_method text,
  payment_reference text,
  last_synced_at timestamp without time zone,
  three_way_match_status text,
  three_way_match_reason text,
  three_way_match_receipts text,
  match_type text,
  constraint invoices_pkey PRIMARY KEY (id),
  constraint invoices_match_status_check CHECK ((match_status = ANY (ARRAY['matched'::text, 'partial'::text, 'mismatch'::text, 'unmatched'::text, 'non_po'::text, 'no_po'::text]))),
  constraint invoices_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'pushed'::text, 'paid'::text, 'partially_paid'::text, 'needs_review'::text, 'rejected_duplicate'::text, 'review'::text, 'push_uncertain'::text, 'validation_failed'::text])))
);
alter table public.invoices enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoices to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoices to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoices to service_role;

create table public.notification_log (
  id uuid not null default gen_random_uuid(),
  team_id uuid,
  invoice_id uuid,
  event_type text,
  results jsonb,
  created_at timestamp with time zone default now(),
  constraint notification_log_pkey PRIMARY KEY (id)
);
alter table public.notification_log enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.notification_log to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.notification_log to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.notification_log to service_role;

create table public.notification_settings (
  id uuid not null default gen_random_uuid(),
  team_id uuid,
  enabled boolean default false,
  slack_webhook_url text,
  teams_webhook_url text,
  notify_on_uploaded boolean default true,
  notify_on_processed boolean default true,
  notify_on_matched boolean default true,
  notify_on_flagged boolean default true,
  notify_on_payment boolean default true,
  updated_at timestamp with time zone default now(),
  constraint notification_settings_team_id_key UNIQUE (team_id),
  constraint notification_settings_pkey PRIMARY KEY (id)
);
alter table public.notification_settings enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.notification_settings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.notification_settings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.notification_settings to service_role;

create table public.operations_tasks (
  id uuid not null default gen_random_uuid(),
  team_id uuid,
  user_id uuid not null,
  type text not null,
  status text not null default 'open'::text,
  payload jsonb not null default '{}'::jsonb,
  related_invoice_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint operations_tasks_pkey PRIMARY KEY (id),
  constraint operations_tasks_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'dismissed'::text]))),
  constraint operations_tasks_type_check CHECK ((type = ANY (ARRAY['exception_triage'::text, 'vendor_status'::text, 'po_acknowledgment'::text])))
);
CREATE INDEX operations_tasks_team_id_idx ON public.operations_tasks USING btree (team_id);
CREATE INDEX operations_tasks_user_id_idx ON public.operations_tasks USING btree (user_id);
CREATE INDEX operations_tasks_type_status_idx ON public.operations_tasks USING btree (type, status);
alter table public.operations_tasks enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.operations_tasks to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.operations_tasks to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.operations_tasks to service_role;

create table public.purchase_orders (
  id uuid not null default gen_random_uuid(),
  team_id uuid not null,
  created_by uuid,
  po_number text not null,
  vendor_name text,
  vendor_email text,
  issue_date text,
  expected_delivery text,
  total_amount numeric(12,2) default 0,
  currency text default 'USD'::text,
  status text default 'open'::text,
  line_items jsonb default '[]'::jsonb,
  notes text,
  raw_data jsonb,
  created_at timestamp with time zone default now(),
  constraint purchase_orders_pkey PRIMARY KEY (id),
  constraint purchase_orders_status_check CHECK ((status = ANY (ARRAY['open'::text, 'partially_matched'::text, 'fully_matched'::text, 'closed'::text, 'cancelled'::text])))
);
alter table public.purchase_orders enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.purchase_orders to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.purchase_orders to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.purchase_orders to service_role;

create table public.subscriptions (
  id uuid not null default gen_random_uuid(),
  team_id uuid not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  plan text default 'free'::text,
  status text default 'active'::text,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean default false,
  docs_used_this_period integer default 0,
  trial_end timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint subscriptions_stripe_customer_id_key UNIQUE (stripe_customer_id),
  constraint subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id),
  constraint subscriptions_team_id_key UNIQUE (team_id),
  constraint subscriptions_pkey PRIMARY KEY (id),
  constraint subscriptions_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'trial'::text, 'starter'::text, 'growth'::text, 'enterprise'::text]))),
  constraint subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'past_due'::text, 'canceled'::text, 'incomplete'::text])))
);
alter table public.subscriptions enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.subscriptions to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.subscriptions to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.subscriptions to service_role;

create table public.supplier_notifications (
  id uuid not null default gen_random_uuid(),
  invoice_id uuid,
  team_id uuid,
  supplier_email text,
  issue_type text,
  subject text,
  sent_at timestamp with time zone default now(),
  constraint supplier_notifications_pkey PRIMARY KEY (id)
);
alter table public.supplier_notifications enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.supplier_notifications to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.supplier_notifications to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.supplier_notifications to service_role;

create table public.team_invites (
  id uuid not null default gen_random_uuid(),
  team_id uuid not null,
  email text not null,
  role text default 'member'::text,
  token text not null,
  invited_by uuid,
  expires_at timestamp with time zone default (now() + '7 days'::interval),
  accepted_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  constraint team_invites_token_key UNIQUE (token),
  constraint team_invites_pkey PRIMARY KEY (id)
);
alter table public.team_invites enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.team_invites to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.team_invites to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.team_invites to service_role;

create table public.team_members (
  id uuid not null default gen_random_uuid(),
  team_id uuid not null,
  user_id uuid,
  email text not null,
  role text default 'member'::text,
  status text default 'pending'::text,
  invited_by uuid,
  invited_at timestamp with time zone default now(),
  joined_at timestamp with time zone,
  constraint team_members_team_id_email_key UNIQUE (team_id, email),
  constraint team_members_pkey PRIMARY KEY (id),
  constraint team_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text, 'viewer'::text]))),
  constraint team_members_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text])))
);
alter table public.team_members enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.team_members to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.team_members to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.team_members to service_role;

create table public.teams (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  owner_id uuid not null,
  plan text default 'starter'::text,
  created_at timestamp with time zone default now(),
  constraint teams_slug_key UNIQUE (slug),
  constraint teams_pkey PRIMARY KEY (id)
);
alter table public.teams enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.teams to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.teams to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.teams to service_role;

create table public.usage_events (
  id uuid not null default gen_random_uuid(),
  team_id uuid not null,
  user_id uuid,
  event_type text not null,
  created_at timestamp with time zone default now(),
  constraint usage_events_pkey PRIMARY KEY (id)
);
alter table public.usage_events enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.usage_events to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.usage_events to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.usage_events to service_role;

create table public.user_settings (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  notify_on_approval boolean default true,
  notify_on_rejection boolean default false,
  notify_on_duplicate boolean default true,
  notify_email text default ''::text,
  erp_system text default 'mock'::text,
  company_name text default ''::text,
  default_currency text default 'USD'::text,
  fiscal_year_start text default 'January'::text,
  auto_approve_below numeric default 0,
  require_po_match boolean default true,
  updated_at timestamp with time zone default now(),
  constraint user_settings_user_id_key UNIQUE (user_id),
  constraint user_settings_pkey PRIMARY KEY (id)
);
alter table public.user_settings enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.user_settings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.user_settings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.user_settings to service_role;

create table public.vendor_mappings (
  id uuid not null default gen_random_uuid(),
  team_id uuid,
  invoice_vendor_name text not null,
  oracle_supplier_id text,
  oracle_supplier_name text not null,
  updated_at timestamp with time zone default now(),
  constraint vendor_mappings_team_id_invoice_vendor_name_key UNIQUE (team_id, invoice_vendor_name),
  constraint vendor_mappings_pkey PRIMARY KEY (id)
);
CREATE INDEX vendor_mappings_team_id_idx ON public.vendor_mappings USING btree (team_id);
alter table public.vendor_mappings enable row level security;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_mappings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_mappings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_mappings to service_role;

-- Foreign keys
alter table public.agent_settings add constraint agent_settings_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.distribution_defaults add constraint distribution_defaults_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.email_agent_config add constraint email_agent_config_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.email_agent_log add constraint email_agent_log_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.erp_connections add constraint erp_connections_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.invoice_audit_log add constraint invoice_audit_log_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table public.invoice_comments add constraint invoice_comments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
alter table public.invoices add constraint invoices_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);
alter table public.invoices add constraint invoices_po_id_fkey FOREIGN KEY (po_id) REFERENCES purchase_orders(id);
alter table public.invoices add constraint invoices_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id);
alter table public.invoices add constraint invoices_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.invoices add constraint invoices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.notification_log add constraint notification_log_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
alter table public.notification_settings add constraint notification_settings_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
alter table public.operations_tasks add constraint operations_tasks_related_invoice_id_fkey FOREIGN KEY (related_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
alter table public.operations_tasks add constraint operations_tasks_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.operations_tasks add constraint operations_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.purchase_orders add constraint purchase_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.purchase_orders add constraint purchase_orders_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.subscriptions add constraint subscriptions_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.supplier_notifications add constraint supplier_notifications_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);
alter table public.supplier_notifications add constraint supplier_notifications_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
alter table public.team_invites add constraint team_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);
alter table public.team_invites add constraint team_invites_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.team_members add constraint team_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);
alter table public.team_members add constraint team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.team_members add constraint team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.teams add constraint teams_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.usage_events add constraint usage_events_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table public.usage_events add constraint usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.user_settings add constraint user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Functions
CREATE OR REPLACE FUNCTION public.get_user_team_ids(p_user_id uuid)
 RETURNS TABLE(team_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tm.team_id FROM public.team_members tm
  WHERE tm.user_id = auth.uid()
    AND tm.user_id = p_user_id
    AND tm.status = 'active';
$function$;
CREATE OR REPLACE FUNCTION public.increment(x integer)
 RETURNS integer
 LANGUAGE sql
AS $function$ SELECT x + 1; $function$;

-- Policies
create policy "Team admins can manage agent settings" on public.agent_settings as permissive for all to public
  using ((team_id IN ( SELECT team_members.team_id
   FROM team_members
  WHERE ((team_members.user_id = auth.uid()) AND (team_members.role = 'admin'::text) AND (team_members.status = 'active'::text)))));
create policy "invoice_comments_delete" on public.invoice_comments as permissive for delete to authenticated
  using ((user_id = auth.uid()));
create policy "invoice_comments_insert" on public.invoice_comments as permissive for insert to authenticated
  with check (((user_id = auth.uid()) AND ((team_id IS NULL) OR (team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)))));
create policy "invoice_comments_select" on public.invoice_comments as permissive for select to authenticated
  using ((((team_id IS NULL) AND (user_id = auth.uid())) OR ((team_id IS NOT NULL) AND (team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)))));
create policy "invoice_comments_update" on public.invoice_comments as permissive for update to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy "Admins can delete team invoices" on public.invoices as permissive for delete to public
  using ((team_id IN ( SELECT tm.team_id
   FROM team_members tm
  WHERE ((tm.user_id = auth.uid()) AND (tm.role = 'admin'::text) AND (tm.status = 'active'::text)))));
create policy "Team members can update team invoices" on public.invoices as permissive for update to public
  using ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));
create policy "Team members can view team invoices" on public.invoices as permissive for select to public
  using ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));
create policy "Users can delete own invoices" on public.invoices as permissive for delete to public
  using ((auth.uid() = user_id));
create policy "Users can insert own invoices" on public.invoices as permissive for insert to public
  with check ((auth.uid() = user_id));
create policy "Users can update own invoices" on public.invoices as permissive for update to public
  using ((auth.uid() = user_id));
create policy "Users can view own invoices" on public.invoices as permissive for select to public
  using ((auth.uid() = user_id));
create policy "Team members view notification log" on public.notification_log as permissive for select to public
  using ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));
create policy "Admins manage notification settings" on public.notification_settings as permissive for all to public
  using ((team_id IN ( SELECT tm.team_id
   FROM team_members tm
  WHERE ((tm.user_id = auth.uid()) AND (tm.role = 'admin'::text) AND (tm.status = 'active'::text)))));
create policy "Team members view notification settings" on public.notification_settings as permissive for select to public
  using ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));
create policy "Admins can delete team operations_tasks" on public.operations_tasks as permissive for delete to public
  using ((team_id IN ( SELECT tm.team_id
   FROM team_members tm
  WHERE ((tm.user_id = auth.uid()) AND (tm.role = 'admin'::text) AND (tm.status = 'active'::text)))));
create policy "Team members can update team operations_tasks" on public.operations_tasks as permissive for update to public
  using ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));
create policy "Team members can view team operations_tasks" on public.operations_tasks as permissive for select to public
  using ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));
create policy "Users can delete own operations_tasks" on public.operations_tasks as permissive for delete to public
  using ((auth.uid() = user_id));
create policy "Users can insert own operations_tasks" on public.operations_tasks as permissive for insert to public
  with check ((auth.uid() = user_id));
create policy "Users can update own operations_tasks" on public.operations_tasks as permissive for update to public
  using ((auth.uid() = user_id));
create policy "Users can view own operations_tasks" on public.operations_tasks as permissive for select to public
  using ((auth.uid() = user_id));
create policy "Members and admins can manage POs" on public.purchase_orders as permissive for all to public
  using ((team_id IN ( SELECT team_members.team_id
   FROM team_members
  WHERE ((team_members.user_id = auth.uid()) AND (team_members.role = ANY (ARRAY['admin'::text, 'member'::text])) AND (team_members.status = 'active'::text)))));
create policy "Team members can view POs" on public.purchase_orders as permissive for select to public
  using ((team_id IN ( SELECT team_members.team_id
   FROM team_members
  WHERE ((team_members.user_id = auth.uid()) AND (team_members.status = 'active'::text)))));
create policy "Team members can view subscription" on public.subscriptions as permissive for select to public
  using ((team_id IN ( SELECT team_members.team_id
   FROM team_members
  WHERE ((team_members.user_id = auth.uid()) AND (team_members.status = 'active'::text)))));
create policy "Admins manage supplier notifications" on public.supplier_notifications as permissive for all to public
  using ((team_id IN ( SELECT tm.team_id
   FROM team_members tm
  WHERE ((tm.user_id = auth.uid()) AND (tm.role = 'admin'::text) AND (tm.status = 'active'::text)))));
create policy "Team members view supplier notifications" on public.supplier_notifications as permissive for select to public
  using ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));
create policy "Admins can manage members" on public.team_members as permissive for all to public
  using ((team_id IN ( SELECT tm.team_id
   FROM team_members tm
  WHERE ((tm.user_id = auth.uid()) AND (tm.role = 'admin'::text) AND (tm.status = 'active'::text)))));
create policy "Members can view team roster" on public.team_members as permissive for select to public
  using ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));
create policy "Owner can manage team" on public.teams as permissive for all to public
  using ((owner_id = auth.uid()));
create policy "Team members can view team" on public.teams as permissive for select to public
  using ((id IN ( SELECT team_members.team_id
   FROM team_members
  WHERE ((team_members.user_id = auth.uid()) AND (team_members.status = 'active'::text)))));
create policy "Members can insert usage" on public.usage_events as permissive for insert to public
  with check ((team_id IN ( SELECT team_members.team_id
   FROM team_members
  WHERE ((team_members.user_id = auth.uid()) AND (team_members.status = 'active'::text)))));
create policy "Team members can view usage" on public.usage_events as permissive for select to public
  using ((team_id IN ( SELECT team_members.team_id
   FROM team_members
  WHERE ((team_members.user_id = auth.uid()) AND (team_members.status = 'active'::text)))));
create policy "Users can manage own settings" on public.user_settings as permissive for all to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

-- Triggers

-- Views

-- Storage buckets
