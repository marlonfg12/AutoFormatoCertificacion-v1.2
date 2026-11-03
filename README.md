# 🚀 Azure DevOps Test Reporter

> Herramienta automatizada de alto rendimiento para extraer casos de prueba, resultados y evidencias desde **Azure DevOps (Test Plans)** y compilar informes oficiales de certificación de pruebas en formato **Microsoft Word (.docx)**.

[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-1.49-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Azure DevOps](https://img.shields.io/badge/Azure_DevOps-REST_API_7.1-0078D7?logo=azure-devops&logoColor=white)](https://learn.microsoft.com/rest/api/azure/devops/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 📋 Características Principales

* ⚡ **Extracción Híbrida Inteligente:**
  * **Modo API REST 7.1 (Principal):** Extracción directa y descarga paralela de evidencias en segundos sin interactuar con la interfaz gráfica.
  * **Modo Playwright (Respaldo Automático):** Emulación de navegación para entornos donde las políticas de red bloquean APIs directas.
* 🔐 **Autenticación SSO sin Secretos:** Reutiliza la sesión corporativa del navegador (`.browser-session`) sin almacenar tokens PAT ni contraseñas.
* 🖼️ **Motor Adaptativo de Evidencias:**
  * **Capturas de pantalla (PNG / JPEG):** Ajuste proporcional automático al ancho útil de la celda de la tabla sin recortes ni deformaciones.
  * **Documentos PDF:** Conversión automática página por página a imágenes de alta definición con escala adaptativa de altura.
  * **Paquetes ZIP:** Descompresión recursiva en memoria para extraer capturas o PDFs contenidos.
* 📊 **Manejo de Estados y Alertas:**
  * Escenarios **Aprobados** y **Fallidos** documentados con sus capturas.
  * Alerta visual en consola al finalizar con los IDs de casos con fallo.
  * Escenarios en **No Aplica** consolidados automáticamente en el cuadro resumen final.
* ☁️ **Organización Inteligente en la Nube:**
  * Compatible con carpetas compartidas de **Google Drive**, OneDrive o red local.
  * Detección y reutilización automática de carpetas existentes por Historia de Usuario (o creación automática si no existen).

---

## 🚀 Inicio Rápido

### 1. Clonar el repositorio e instalar dependencias
```bash
git clone https://github.com/tu-usuario/azure-devops-test-reporter.git
cd azure-devops-test-reporter
npm install
```

### 2. Configurar variables de entorno
Copia la plantilla de configuración:
```bash
cp .env.example .env
```
Edita `.env` para personalizar la ruta de salida (ej: tu carpeta sincronizada de Google Drive) y los metadatos de tu equipo:
```env
OUTPUT_PATH="G:\Mi unidad\Informes_QA"
REPORT_PREFIX="Informe_Certificacion"
QA_REQUESTER="Líder Técnico de QA"
```

### 3. Configurar tu Plantilla Word
Coloca tu archivo de formato institucional `.docx` en la raíz del proyecto con el nombre:
```text
plantilla_resultado_pruebas.docx
```
*(O define la ruta personalizada en `.env` mediante `TEMPLATE_PATH="/ruta/a/tu/plantilla.docx"`).*

---

## 💻 Uso

Ejecuta el proyecto con la URL de la suite en la vista **Execute** de Azure Test Plans:

```bash
npm start "https://dev.azure.com/{organizacion}/{proyecto}/_testPlans/execute?planId=12345&suiteId=67890"
```

O simplemente ejecuta `npm start` y el asistente CLI te solicitará la URL por consola:
```bash
npm start
```

### Forzar Modo Interfaz (Playwright)
Si necesitas forzar la navegación visual en lugar de la API:
```bash
npm start -- "<URL_DE_LA_SUITE>" --ui
```

---

## 📂 Estructura del Proyecto

```text
├── src/
│   ├── azure-api-extractor.ts   # Conexión REST API v7.1 con sesión de navegador
│   ├── azure-extractor.ts       # Extractor de respaldo por interfaz Playwright
│   ├── browser.ts               # Contexto persistente de navegador (.browser-session)
│   ├── pdf-renderer.ts          # Renderizador de PDF a PNG (pdfjs-dist + Canvas)
│   ├── storage.ts               # Gestor de carpetas por HU y soporte de Google Drive
│   ├── word-engine.ts           # Inyector OpenXML con DrawingML
│   ├── types.ts                 # Interfaces y tipos de TypeScript
│   └── index.ts                 # Orquestador y punto de entrada CLI
├── .env.example                 # Plantilla de configuración de entorno
├── GUIA_INICIO_RAPIDO.md        # Manual detallado de configuración paso a paso
├── ARCHITECTURE.md              # Documentación técnica de arquitectura
└── package.json                 # Dependencias y scripts del proyecto
```

---

## 📖 Documentación Adicional

* 📘 [Guía de Inicio Rápido desde Cero](GUIA_INICIO_RAPIDO.md)
* 📐 [Documentación de Arquitectura y Flujos](ARCHITECTURE.md)

---

## 📄 Licencia

Distribuido bajo la Licencia **MIT**. Consulta el archivo `LICENSE` para más información.
