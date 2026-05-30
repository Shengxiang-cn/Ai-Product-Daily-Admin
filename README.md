# Ai Product Daily Admin

Signal control backend for AI Product Daily.

This repository is intentionally separated from the public content site. The
published site contains only the admin interface, and access is controlled by
the Supabase auth session plus the `site_admins` allowlist.

## Local Preview

```bash
cd docs
python3 -m http.server 8018
```

Then open `http://127.0.0.1:8018`.
