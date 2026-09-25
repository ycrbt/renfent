# Renfent Chrome Extension

Esta rama migra Renfent a Chrome Manifest V3 y lo integra directamente en la página de formalización de Renfe.

## Desarrollo

Ejecuta `cd extension && npm install && npm run build`. Después carga la carpeta `extension/dist` como extensión descomprimida en Chrome.

## Migración

- Se inyecta únicamente en `journeyFormalization.do`.
- Añade el calendario multiformalización de Renfent junto al selector nativo.
- Lee el contexto de abono y trayecto del formulario existente.
- Guarda las fechas seleccionadas en `chrome.storage.session`.
- La siguiente capa es adaptar el transporte de `lib/renfe.ts` a la sesión autenticada del navegador y conectar trenes, asientos y confirmación.

No depende de habilitar la multiformalización oculta de Renfe.
