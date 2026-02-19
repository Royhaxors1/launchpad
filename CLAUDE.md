# CLAUDE.md — launchpad

## What This Is

Static landing page project deployed to Vercel.

## Files

- `index.html` — The landing page
- `vercel.json` — Vercel deployment configuration

## Commands

```bash
# Local preview
open index.html

# Deploy (auto-deploys on push via Vercel)
git add . && git commit -m "update" && git push
```

## Notes

- No build step — pure static HTML
- Deployed to Vercel (auto-deploy on push to main)
- No testing framework — visual inspection only
