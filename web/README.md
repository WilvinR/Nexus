# Nexus Web

Landing y dashboard (Vercel). El bot vive en `../bot/` (Discloud).

## Deploy en Vercel

1. Conecta el repo [WilvinR/Nexus](https://github.com/WilvinR/Nexus.git)
2. **Root Directory:** `web`
3. Framework: **Other** (sitio estático)
4. Deploy

## Configuración

Edita `js/config.js` si cambia la URL del bot:

```js
window.NEXUS_API = 'https://nexus-bot.discloud.app';
```

En Discloud, añade la URL de Vercel a CORS del bot:

```
API_CORS=https://tu-proyecto.vercel.app
```

(Múltiples orígenes separados por coma.)
