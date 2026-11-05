# DocuFusión

Plataforma web gratuita para **unir, separar, ordenar y verificar documentos** directamente en el navegador.
Sin registro, sin publicidad invasiva y **sin subir archivos a ningún servidor**: el hosting solo entrega la aplicación,
y los documentos se procesan en el dispositivo del usuario y desaparecen al cerrar o recargar la página.

## Estado: Fase 1 (PDF) + motor de integridad

| Función | Estado |
| --- | --- |
| Unir PDF | ✅ |
| Mantener separados (con cambios) | ✅ |
| Dividir: por intervalos, cada N páginas, cada página | ✅ |
| Extraer páginas (en un PDF o una por archivo) | ✅ |
| Reordenar archivos y páginas (arrastrar o botones ←/→) | ✅ |
| Eliminar y girar páginas | ✅ |
| Descargar un archivo, varios por separado o un ZIP | ✅ |
| Validación de integridad de PDF, DOCX y XLSX | ✅ |
| Verificación de cada resultado antes de permitir la descarga | ✅ |
| Unir Word / unir Excel | Fase 2 |
| Conversión entre formatos y mezcla PDF + Word + Excel | Fase 3 |

## Document Integrity Engine (`src/integrity/`)

Ningún archivo se procesa sin validar y ningún resultado se ofrece sin verificar.

**Entrada** — capas que se ejecutan en orden y se detienen en cuanto el documento queda bloqueado:

1. **Tamaño**: archivos vacíos y límites (`limits.ts`).
2. **Firma binaria** (`FileSignatureValidator`): magic bytes frente a extensión y MIME. Un `.pdf` que en realidad es
   un DOCX se detecta y se trata según su contenido. Detecta Office cifrado (contenedor OLE con `EncryptionInfo`) y
   formatos antiguos `.doc/.xls`.
3. **PDF** (`PdfIntegrityValidator`): `%%EOF` (truncado), `startxref` y su destino, lectura con pdf.js
   (`stopAtErrors`), interpretación del contenido de cada página, carga con pdf-lib (motor de edición), coherencia entre
   el número de páginas declarado y el real, contraseña de apertura frente a restricciones del propietario,
   JavaScript y adjuntos.
4. **ZIP** (`ZipIntegrityValidator`): lectura propia del directorio central, cabeceras locales, descompresión con
   límite estricto de bytes y **CRC-32 de cada entrada**, rutas peligrosas, entradas cifradas y protección contra
   **ZIP bomb** (tamaño total y tasa de compresión).
5. **OOXML** (`OfficeIntegrityValidator`): `[Content_Types].xml`, relaciones, parte principal, XML bien formado,
   relaciones internas rotas, hojas de Excel, fórmulas, macros, vínculos externos y objetos incrustados.

Estados: `VALID`, `WARNING`, `CORRUPTED`, `PROTECTED`, `UNSUPPORTED`. Un documento solo es `VALID` si **todas** las
comprobaciones aplicables pasan; que una librería consiga abrirlo no basta (p. ej. un PDF con la tabla de referencias
dañada que pdf.js reconstruye queda como `WARNING`, nunca como `VALID`).

**Salida** (`OutputIntegrityValidator`): cada PDF generado se vuelve a abrir con pdf.js y pdf-lib; se comprueba el
número de páginas, que cada página sea interpretable y que **su tamaño y su texto coincidan con la página de origen**;
se calcula su SHA-256. El ZIP se vuelve a leer y se comprueba que contiene exactamente los archivos verificados (CRC y
tamaño). Solo entonces aparece el botón de descarga.

**Seguridad**: pdf.js sin scripts ni XFA; nunca se ejecutan macros; procesamiento pesado en un Web Worker; CSP
estricta en `public/_headers` (`connect-src 'self'`: la página no puede enviar documentos a otros dominios).

## Desarrollo

Requiere Node 22.13 o superior.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

Las pruebas (`tests/`) generan en memoria documentos válidos, truncados, corruptos (CRC alterado, XML roto,
relaciones rotas, árbol de páginas incoherente), protegidos (PDF cifrado RC4 real, Office cifrado), con extensión
incorrecta y ZIP bombs, además de pruebas de las operaciones y de la verificación de salida.

## Publicar gratis en GitHub Pages

El repositorio incluye `.github/workflows/deploy-pages.yml`, que en cada push a `main` ejecuta las pruebas,
compila y publica la web.

1. Crea un repositorio **público** en GitHub (GitHub Pages es gratis en repositorios públicos).
2. Súbelo (cambia `TU_USUARIO` por tu usuario de GitHub):

   ```bash
   git remote add origin https://github.com/TU_USUARIO/docufusion.git
   ```

   ```bash
   git push -u origin main
   ```

3. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Espera a que termine la acción (pestaña **Actions**). La web quedará en
   `https://TU_USUARIO.github.io/docufusion/`.

La ruta base (`/docufusion/`) se toma automáticamente del nombre del repositorio. GitHub Pages no permite
cabeceras propias, así que la política de seguridad (CSP) también se incluye como `<meta>` en el HTML.

## Despliegue gratuito en Cloudflare Pages

Opción A — desde GitHub (recomendado): sube el repositorio y en Cloudflare → Workers & Pages → Create → Pages →
Connect to Git configura:

- Build command: `npm run build`
- Build output directory: `dist`
- Variable de entorno: `NODE_VERSION` = `22`

Opción B — desde tu equipo:

```bash
npm run build
```

```bash
npx wrangler pages deploy dist --project-name docufusion
```

La app quedará en `https://docufusion.pages.dev` (subdominio gratuito). El build ocupa unos 210 archivos, muy por
debajo del límite de 20.000 del plan gratuito.

## Límites por defecto

150 MB por archivo, 400 MB en total, 60 archivos, 3.000 páginas por PDF (las primeras 400 se comprueban en
profundidad; por encima se muestrea y se indica). Se ajustan en `src/integrity/limits.ts`.

## Limitaciones conocidas

- Los PDF con contraseña o restricciones de propietario se marcan como `PROTECTED` y no se editan.
- Los archivos adjuntos incrustados en un PDF no se copian al resultado.
- Word y Excel se validan, pero su combinación y conversión llegan en las fases 2 y 3.
