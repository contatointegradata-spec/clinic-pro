# Reels ClinIQ Pro

Vídeos 9:16 (1080×1920, 30 fps, H.264) e capas para o Instagram, feitos com o design system da ClinIQ Pro.

- `cliniq-reel-*.mp4`: os vídeos.
- `capas/`: uma capa JPG por vídeo. O conteúdo principal fica no recorte 4:5 central, que aparece na grade do perfil.
- `src/`: as animações em HTML e o script que gera os arquivos.

## Como gerar de novo

Requer Node, Playwright (Chromium) e ffmpeg. Na pasta `src/`:

```bash
node render.js v1.html ../cliniq-reel-1-agendou-as-22h.mp4
```

```bash
node render.js covers.html capa 30 1,2,3
```

O segundo comando grava `capa-1.png`, `capa-2.png` e `capa-3.png`. Os ícones em `icons.js` vêm do pacote `lucide-static@0.460.0`.
