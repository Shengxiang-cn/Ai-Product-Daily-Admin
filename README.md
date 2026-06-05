# Ai Product Daily Admin

Signal control backend for AI Product Daily.

This repository is intentionally separated from the public content site. The
published site contains only the admin interface, and access is controlled by
the Supabase auth session plus the `site_admins` allowlist.

## Workspaces

The admin page has two internal workspaces behind the same login:

- `内容编辑`: the existing visual editor for main site copy, links, and images.
- `运营观察`: the private analytics dashboard for Signal events, with dashboard,
  signal-card, and raw-event modes.

Both workspaces use the same Supabase session and `site_admins` allowlist. The
analytics dashboard reads `analytics_events`; the public Signal site does not
link to this admin view.

If `运营观察` shows a permission error after login, run
`supabase-analytics-access.sql` in the Supabase SQL editor. It grants
authenticated reads on `analytics_events` only to users in `site_admins`.

## Local Preview

```bash
cd docs
python3 -m http.server 8018
```

Then open `http://127.0.0.1:8018`.
