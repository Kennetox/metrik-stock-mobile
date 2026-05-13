# Metrik Stock Mobile - Guía de Release y Despliegue

Esta guía documenta el proceso oficial para publicar una nueva versión de **Metrik Stock Mobile**.

## Objetivo

Publicar una actualización de la app Android en GitHub Releases para que el enlace de descargas de Metrik (frontend) apunte automáticamente al último release.

## Repositorios involucrados

- Mobile app: `Kennetox/metrik-stock-mobile`
- Backend API: `Kennetox/metrik-backend` (si el cambio móvil depende de backend)
- Frontend descargas: `kensar_frontend` (normalmente **sin cambios** si ya usa latest release)

## Flujo de publicación (resumen)

1. Confirmar y validar cambios de código.
2. Actualizar versión en mobile (`versionName/versionCode`).
3. Commit y push a `main`.
4. Crear y pushear tag `vX.Y.Z`.
5. Esperar workflow de GitHub Actions que compila y adjunta `MetrikStockMobile.apk` al release.
6. Si hubo cambios de backend, hacer push y desplegar backend.
7. Verificación final en dispositivo.

## Prerrequisitos

- Permisos de push en ambos repos.
- GitHub secrets configurados en mobile para firmado Android:
  - `METRIK_UPLOAD_KEYSTORE_BASE64`
  - `METRIK_UPLOAD_STORE_PASSWORD`
  - `METRIK_UPLOAD_KEY_ALIAS`
  - `METRIK_UPLOAD_KEY_PASSWORD`
- `gh` CLI instalado (opcional, recomendado para monitoreo).

## Paso a paso detallado

### 1) Validar cambios antes de release

En `kensar_mobile`:

```bash
cd /Users/kennethjaramillo/Projects/kensar_mobile
npx tsc --noEmit --pretty false
git status --short
```

Si hubo cambios de backend, validar también:

```bash
python3 -m py_compile /Users/kennethjaramillo/Projects/kensar_backend/routers/receiving.py /Users/kennethjaramillo/Projects/kensar_backend/crud.py
```

### 2) Bump de versión (obligatorio)

Actualizar de forma consistente:

- `android/app/build.gradle`
  - `versionCode`: incrementar +1
  - `versionName`: nuevo `X.Y.Z`
- `package.json`
  - `version`: nuevo `X.Y.Z`
- `ios/kensar_mobile.xcodeproj/project.pbxproj`
  - `MARKETING_VERSION`: nuevo `X.Y.Z`
  - `CURRENT_PROJECT_VERSION`: incrementar +1

Ejemplo de release real:

- `versionName`: `1.0.15`
- `versionCode`: `16`

### 3) Commit y push de mobile

```bash
git add src android ios package.json
git commit -m "fix(recount): exact barcode resolution for scans and bump app version to 1.0.15"
git push origin main
```

### 4) Crear tag de release

```bash
git tag -a v1.0.15 -m "Release v1.0.15"
git push origin v1.0.15
```

## Qué dispara el build automáticamente

El workflow `.github/workflows/release-android.yml` se ejecuta cuando se hace push de tags `v*`.

Ese workflow:

1. Instala dependencias.
2. Compila APK firmado (`assembleRelease` con keystore/secrets).
3. Renombra asset a `MetrikStockMobile.apk`.
4. Lo adjunta al release del tag en GitHub.

## Monitoreo del release

Con `gh`:

```bash
gh run list -R Kennetox/metrik-stock-mobile --limit 5
gh run view <RUN_ID> -R Kennetox/metrik-stock-mobile
```

URL típica:

- `https://github.com/Kennetox/metrik-stock-mobile/actions`

## Paso backend (cuando aplique)

Si el fix incluye backend:

1. Commit de archivos necesarios (evitar `__pycache__`, `.env`, uploads, etc.).
2. Push a `main` en `metrik-backend`.
3. Ejecutar despliegue según plataforma de backend.

Ejemplo:

```bash
cd /Users/kennethjaramillo/Projects/kensar_backend
git add crud.py routers/receiving.py
git commit -m "fix(receiving): prioritize exact barcode matching for scan resolution"
git push origin main
```

## Verificación final (checklist)

1. En GitHub Releases existe `vX.Y.Z` con asset `MetrikStockMobile.apk`.
2. El release aparece como `Latest`.
3. El enlace de descargas de Metrik (frontend) descarga esa APK nueva sin cambios manuales.
4. En dispositivo Android, la app instalada muestra la nueva versión.
5. Smoke test funcional mínimo del fix (ej: escaneo en recuento).

## Troubleshooting rápido

- Build en Actions falla en firmado:
  - revisar secrets de keystore.
- Tag subido pero sin APK en release:
  - revisar workflow run y step `Attach APK to GitHub Release`.
- Frontend descarga versión vieja:
  - confirmar que el enlace usa latest release y que el nuevo release quedó como `Latest`.
- Cambios backend no reflejados:
  - validar que backend fue desplegado después del push.

