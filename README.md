# Nexus

Bot de Discord para gremios de **Albion Online** + sitio web / dashboard.

## Estructura

```
Nexus/
├── bot/     → Discord bot (Discloud: nexus-bot.discloud.app)
└── web/     → Landing + dashboard (Vercel / GitHub)
```

| Parte | Host | Repo path |
|-------|------|-----------|
| Bot + API | [Discloud](https://nexus-bot.discloud.app) | `bot/` |
| Web | Vercel | `web/` |

## Bot (Discloud)

1. Comprime y sube la carpeta `bot/` (con `discloud.config`, sin `node_modules`).
2. Variables en `.env` o panel Discloud: `DISCORD_TOKEN`, `API_ENABLED`, `API_SECRET`, etc.

## Web (Vercel)

1. Edita archivos en `web/`
2. Ejecuta `npm run build` (copia `web/` → `public/`)
3. Commit y push — Vercel sirve la carpeta `public/`

**En Vercel:** Root Directory **vacío** (raíz del repo). Framework: **Other**.

Tras el deploy, en Discloud: `API_CORS=https://tu-dominio.vercel.app`
