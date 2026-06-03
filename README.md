# Nexus

Sitio web (3 archivos en la raíz):

```
index.html
css/style.css
js/script.js
```

Bot en `bot/` (solo para Discloud).

## Vercel — IMPORTANTE

En **Project Settings → General**:

| Campo | Valor |
|-------|--------|
| Root Directory | **vacío** (borra `web` o `public` si aparece) |
| Output Directory | **vacío** |
| Framework Preset | **Other** |

Luego **Deployments → Redeploy** el último commit.

## Discloud

Sube solo la carpeta `bot/`.
