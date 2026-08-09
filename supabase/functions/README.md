# Edge Functions

Both run on Supabase and hold their API key as a project secret. Nothing here
ever reaches the browser, and there is no screen in the app that asks for a key.

| Function | Secret it reads | What it does |
|---|---|---|
| `ai` | `ANTHROPIC_API_KEY` | reads clips, scores creators, writes shot instructions |
| `media` | any secret whose name contains `pexels` | placeholder photography and video |

```bash
supabase functions deploy ai
supabase functions deploy media
```

## Why `media` scans for the secret name

The key on the original project was stored as `pexels api key`, with spaces.
An exact-name lookup returned nothing and the failure looked like a broken
integration for two rounds. The function now accepts any variable whose name
mentions pexels, so renaming it in the dashboard cannot silently break the
screens.

## What the model is never asked

Not how many clips a gap needs, not which room, not which branch, not what the
rights say, and not whether a clip may be released. Those are computed or
entered by a person. A model guessing at them would be guessing at the parts
that carry consequences.
