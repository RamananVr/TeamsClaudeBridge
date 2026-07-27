# Teams App Icons

Before you can package and sideload this Teams app, you must supply two icon files
in this `teams-app/` directory. They are referenced by `manifest.json` and are
**required** by Teams — the upload will fail without them.

## Required files

| File          | Size (px) | Format                                  | Notes |
|---------------|-----------|-----------------------------------------|-------|
| `color.png`   | 192 x 192 | PNG, full color, can have a background  | Shown in the Teams app catalog and store listings. |
| `outline.png` | 32 x 32   | PNG, **transparent** background, single flat color (white/transparent) | Shown in the Teams left rail. Must be transparent with a monochrome glyph. |

## Why they are not in the repo

Valid PNG binaries cannot be authored as text, so they are intentionally left out.
Create or drop in your own icons before zipping the app.

## Packaging

Once both PNGs are present and `{{MICROSOFT_APP_ID}}` in `manifest.json` has been
replaced with your real Azure Bot App ID, zip the three files at the root of the
archive (no enclosing folder):

```
manifest.json
color.png
outline.png
```

Then sideload the resulting `.zip` into Teams (Apps -> Manage your apps ->
Upload an app). See the repository `README.md` for full setup steps.
