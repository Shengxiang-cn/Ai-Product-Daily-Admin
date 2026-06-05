-- Allows the private Signal control backend to read analytics events.
-- Run this in the Supabase SQL editor for project khtxrbmynurrwvfwgbqj.

alter table if exists public.analytics_events enable row level security;

grant select on public.analytics_events to authenticated;

drop policy if exists analytics_events_select_site_admins on public.analytics_events;

create policy analytics_events_select_site_admins
on public.analytics_events
for select
to authenticated
using (
  exists (
    select 1
    from public.site_admins admin_user
    where admin_user.user_id = auth.uid()
  )
);
