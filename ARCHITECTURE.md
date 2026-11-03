# Arquitectura del Sistema: Azure DevOps Test Reporter

Este documento describe la arquitectura técnica, los componentes clave y el flujo de datos del **Azure DevOps Test Reporter**, una solución híbrida de alto rendimiento diseñada para extraer resultados de pruebas, evidencias y adjuntos de **Azure Test Plans** y compilar informes oficiales en formato **Microsoft Word (.docx)**.

---

## 1. Principios de Diseño

1. **Estrategia de Extracción Híbrida (API-First con Fallback UI):**
   * **Modo Primario (REST API 7.1):** Realiza llamadas HTTP concurrentes utilizando las cookies de la sesión del navegador para consultar suites, puntos de prueba y descargar adjuntos en paralelo sin interacción con la interfaz visual.
   * **Modo Respaldo (Playwright UI):** Si la API no está disponible o las políticas de red bloquean las solicitudes REST, el sistema activa automáticamente la navegación emulada mediante Playwright para interactuar con la interfaz de Azure DevOps.
2. **Autenticación sin Secretos (Persistencia de Sesión SSO):**
   * El sistema no almacena tokens personales (PAT), contraseñas ni secretos en código o archivos de configuración.
   * Utiliza un contexto de navegador persistente (`.browser-session`) mediante `launchPersistentContext()`. El usuario inicia sesión una única vez vía Microsoft Entra ID / MFA y la sesión se reutiliza transparentemente.
3. **Procesamiento de Evidencias Multiformato:**
   * **Imágenes (PNG / JPEG):** Redimensionadas de forma reactiva al ancho útil exacto de la celda de la tabla (`evidenceCellWidthDxa`) preservando su relación de aspecto original (sin recortes ni distorsión).
   * **Documentos PDF:** Convertidos en memoria a imágenes PNG de alta resolución (~144 DPI) página por página mediante `pdfjs-dist` y renderizado en Canvas nativo (`@napi-rs/canvas`).
   * **Contenedores ZIP:** Descomprimidos recursivamente en memoria para extraer capturas o PDFs internos.
4. **Manipulación OpenXML a Nivel de Byte:**
   * Utiliza `adm-zip` para descomprimir la plantilla `.docx`, inyectar relaciones en `word/_rels/document.xml.rels`, agregar los binarios a `word/media/` y reescribir los nodos de DrawingML en `word/document.xml`.

---

## 2. Diagrama de Arquitectura del Sistema

```mermaid
flowchart TD
    User([Usuario / QA Engineer]) -->|URL de Suite| CLI[CLI Runner: index.ts]
    
    subgraph Config [Capa de Configuración]
        Env[.env / storage.ts]
        BrowserMgr[BrowserManager: .browser-session]
    end
    
    CLI --> Config
    BrowserMgr -->|Sesión Autenticada| EngineSelector{¿Modo API habilitado?}
    
    subgraph Extraccion [Motor de Extracción]
        APIClient[AzureApiExtractor: REST API 7.1]
        UIFallback[AzureExtractor: Playwright UI]
        PDFProc[PDF Renderer: pdfjs-dist + Canvas]
    end
    
    EngineSelector -->|Por defecto| APIClient
    EngineSelector -->|Fallback o flag --ui| UIFallback
    APIClient -.->|En caso de error| UIFallback
    
    APIClient -->|Descarga Adjuntos PDF/IMG| PDFProc
    UIFallback -->|Descarga Adjuntos PDF/IMG| PDFProc
    
    subgraph Generacion [Motor de Generación y Almacenamiento]
        WordEng[WordEngine: OpenXML & DrawingML]
        StorageMgr[StorageManager: Detección Carpetas HU]
    end
    
    PDFProc -->|Imágenes Optimizadas| WordEng
    APIClient -->|Contexto HU + Metadata| WordEng
    UIFallback -->|Contexto HU + Metadata| WordEng
    
    WordEng --> StorageMgr
    StorageMgr -->|Guarda .docx en Carpeta HU| Output[Google Drive / Salida Local]
```

---

## 3. Diagrama de Secuencia: Flujo de Extracción y Generación

```mermaid
sequenceDiagram
    autonumber
    actor Usuario
    participant CLI as CLI (index.ts)
    participant Browser as BrowserManager (.browser-session)
    participant API as AzureApiExtractor (REST 7.1)
    participant PDF as PDFRenderer (pdfjs-dist)
    participant Word as WordEngine (OpenXML)
    participant Storage as Storage (storage.ts)

    Usuario->>CLI: Ejecuta con URL de la Suite
    CLI->>Browser: Obtiene contexto autenticado (SSO)
    CLI->>API: Inicia extracción (planId, suiteId)
    
    API->>API: GET /testplan/plans/{id} & /suites/{id}
    API->>API: GET /TestPoint?includePointDetails=true
    
    loop Por cada Test Point
        alt Tiene ejecución (lastTestRunId)
            API->>API: GET /test/Runs/{runId}/results/{resultId}/attachments
            API->>API: Descarga binarios en paralelo (max 4)
            opt Es documento PDF
                API->>PDF: renderPdfToPngs(buffer)
                PDF-->>API: Páginas convertidas en PNG
            end
        end
    end
    
    API-->>CLI: Contexto HU (Escenarios + Evidencias)
    CLI->>Storage: resolveHuFolder(baseDir, huId, huName)
    Storage-->>CLI: Ruta de la carpeta (reutilizada o nueva)
    CLI->>Word: generateDocument(hu, metadata, huFolder)
    Word->>Word: Inyecta tablas OpenXML + DrawingML
    Word-->>Usuario: Documento final generado exitosamente
```

---

## 4. Estructura Modular del Proyecto

```text
src/
├── browser.ts              # Inicialización de Playwright con perfil persistente (.browser-session)
├── azure-api-extractor.ts  # Extractor principal vía Azure DevOps REST API v7.1
├── azure-extractor.ts      # Extractor de respaldo por emulación de interfaz (Playwright)
├── pdf-renderer.ts         # Motor de renderizado de PDFs a PNG (pdfjs-dist + canvas)
├── word-engine.ts          # Generador OpenXML Word con DrawingML y cálculo EMU
├── storage.ts              # Gestión de carpetas por HU y soporte de Google Drive / .env
├── types.ts                # Contratos e interfaces de TypeScript
└── index.ts                # Punto de entrada y orquestador CLI
```

---

## 5. Endpoints Utilizados de Azure DevOps (API v7.1)

| Recurso | Método / Endpoint | Propósito |
| :--- | :--- | :--- |
| **Test Plan** | `GET /testplan/plans/{planId}` | Obtiene metadatos del plan, iteración/sprint y fechas. |
| **Suite** | `GET /testplan/Plans/{planId}/suites/{suiteId}` | Obtiene nombre de la suite y relación con el Work Item (HU). |
| **Work Item** | `GET /wit/workitems/{id}?fields=System.Title` | Resuelve el título y descripción canónica de la HU. |
| **Test Points** | `GET /testplan/Plans/{planId}/Suites/{suiteId}/TestPoint?includePointDetails=true` | Lista casos de prueba con último resultado (`lastTestRunId`, `lastResultId`). |
| **Test Result** | `GET /test/Runs/{runId}/results/{resultId}?detailsToInclude=Iterations` | Lee estado, tiempos, errores, comentarios y adjuntos por paso. |
| **Attachments** | `GET /test/Runs/{runId}/Results/{resultId}/attachments` | Lista los archivos adjuntos de la corrida de pruebas. |
| **Download** | `GET /test/Runs/{runId}/Results/{resultId}/attachments/{id}` | Descarga el archivo binario (`application/octet-stream`). |
