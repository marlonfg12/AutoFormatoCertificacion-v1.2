# 📘 Guía de Inicio Rápido: Azure DevOps Test Reporter

Esta guía describe paso a paso cómo poner en marcha el proyecto desde cero en cualquier equipo o entorno, cómo configurar tu propia plantilla Word y cómo sincronizar los resultados en una carpeta compartida de **Google Drive**, **OneDrive** o tu disco local.

---

## 📑 Tabla de Contenidos
1. [Requisitos Previos](#1-requisitos-previos)
2. [Instalación y Configuración](#2-instalación-y-configuración)
3. [Configuración de tu Plantilla Word](#3-configuración-de-tu-plantilla-word)
4. [Configuración de Variables de Entorno (.env)](#4-configuración-de-variables-de-entorno-env)
5. [Cómo Obtener la URL de Azure DevOps](#5-cómo-obtener-la-url-de-azure-devops)
6. [Primera Ejecución e Inicio de Sesión (SSO)](#6-primera-ejecución-e-inicio-de-sesión-sso)
7. [Modos de Ejecución](#7-modos-de-ejecución)
8. [Estructura y Organización de Resultados](#8-estructura-y-organización-de-resultados)
9. [Solución de Problemas Comunes](#9-solución-de-problemas-comunes)

---

## 1. Requisitos Previos

Antes de comenzar, asegúrate de tener instalado en tu sistema operativo:

* **Node.js** v18.0.0 o superior ([Descargar Node.js](https://nodejs.org/)).
* **Git** ([Descargar Git](https://git-scm.com/)).
* Acceso a tu organización de **Azure DevOps** con permisos de lectura en **Test Plans** y **Work Items**.

Para verificar que Node.js y npm están correctamente instalados, abre tu terminal y ejecuta:
```bash
node -v
npm -v
```

---

## 2. Instalación y Configuración

1. **Clona el repositorio** en tu equipo local:
   ```bash
   git clone https://github.com/tu-usuario/azure-devops-test-reporter.git
   cd azure-devops-test-reporter
   ```

2. **Instala las dependencias del proyecto:**
   ```bash
   npm install
   ```

3. **Crea tu archivo de configuración `.env`:**
   Copia el archivo de ejemplo:
   ```bash
   cp .env.example .env
   ```

---

## 3. Configuración de tu Plantilla Word

Para mantener el proyecto libre de documentos confidenciales de cualquier empresa, **no se incluye ninguna plantilla predeterminada**. Debes suministrar tu propio formato institucional.

### ¿Dónde colocar la plantilla?
Coloca tu archivo `.docx` en la raíz del proyecto con el siguiente nombre estándar:
```text
plantilla_resultado_pruebas.docx
```

*(Opcional: Si tu plantilla tiene otro nombre o se encuentra en otra ubicación, puedes especificar la ruta exacta en tu archivo `.env` mediante la variable `TEMPLATE_PATH`):*
```env
TEMPLATE_PATH="C:\MisFormatos\Formato_Certificacion_QA.docx"
```

### ¿Qué estructura espera el motor de Word?
El generador utiliza reemplazo nativo de OpenXML y búsqueda de etiquetas clave en la primera tabla de encabezado:
* **Tabla 1 (Encabezado General):** El motor busca celdas con etiquetas como:
  * `Nombre del Proyecto :`
  * `Identificador del Proyecto :`
  * `Sprint:`
  * `Responsable que solicita (Cargo y Nombre):`
  * `Aplicación – Módulo:`
  * `Etapa de pruebas:`
  * `Área que realiza la prueba :`
  * `Fecha de inicio de las pruebas:`
  * `Fecha de finalización de Pruebas:`
  * `Ambiente de Pruebas:`
  * `Tipo de prueba:`
  * `Observaciones:`
* **Tablas de Escenarios:** El motor localiza la sección de escenarios con la etiqueta `CASOS DE PRUEBA`, clona la estructura por cada caso ejecutado e inyecta las capturas de evidencia en la celda `Ejecución HU`.
* **Resumen Final:** Al final del documento, actualiza el cuadro de `Historia de Usuario Aprobadas` con los totales y la lista de casos en estado *No Aplica*.

---

## 4. Configuración de Variables de Entorno (.env)

Abre el archivo `.env` creado en el paso 2 y personalízalo según tu entorno de trabajo:

```env
# -------------------------------------------------------------
# RUTA DE SALIDA (Local o Nube)
# -------------------------------------------------------------
# Si usas Google Drive Desktop o OneDrive, puedes apuntar a tu carpeta sincronizada:
OUTPUT_PATH="G:\Mi unidad\Informes_QA"

# Si prefieres guardar en tu disco local, puedes usar una ruta relativa o absoluta:
# OUTPUT_PATH="./output"

# -------------------------------------------------------------
# PREFIJO DEL ARCHIVO
# -------------------------------------------------------------
REPORT_PREFIX="Informe_Certificacion_QA"

# -------------------------------------------------------------
# METADATOS PERSONALIZABLES PARA EL INFORME WORD
# -------------------------------------------------------------
QA_REQUESTER="Líder Técnico de QA"
QA_MODULE="Portal Web"
QA_TESTING_AREA="TECNOLOGÍA / ASEGURAMIENTO DE CALIDAD"
QA_ENVIRONMENT="QA Staging"
QA_TEST_STAGE="QA / Pruebas Funcionales"
QA_TEST_TYPE="Funcional / E2E"
DEFAULT_SPRINT="Sprint Actual"
QA_PROJECT_NAME="Proyecto Principal"
```

---

## 5. Cómo Obtener la URL de Azure DevOps

Para que el extractor identifique con exactitud la Historia de Usuario y sus casos de prueba, ingresa a Azure DevOps y sigue estos pasos:

1. Ve a **Test Plans** ➔ Selecciona tu **Test Plan**.
2. En el panel izquierdo de suites, selecciona la suite de la **Historia de Usuario**.
3. En la parte superior, haz clic en la pestaña **Execute** (donde se ven los Test Points).
4. Copia la URL completa de tu navegador.

Debe tener una estructura similar a:
```text
https://dev.azure.com/{organizacion}/{proyecto}/_testPlans/execute?planId=123456&suiteId=789012
```

---

## 6. Primera Ejecución e Inicio de Sesión (SSO)

1. **Ejecuta el programa:**
   ```bash
   npm start
   ```
2. **Ingresa la URL** cuando la consola te lo solicite:
   ```text
   URL de la HU > https://dev.azure.com/mi-org/MiProyecto/_testPlans/execute?planId=123456&suiteId=789012
   ```
3. **Inicio de sesión interactivo:**
   * En la primera ejecución se abrirá una ventana de Chromium.
   * Si tu organización utiliza inicio de sesión de Microsoft Entra ID (Office 365 / SSO / MFA), completa tu usuario, contraseña y validación en 2 pasos en la ventana.
   * Una vez completado, el navegador guardará las cookies de sesión en el directorio local `.browser-session`.
   * **¡Listo!** En las siguientes ejecuciones la sesión se mantendrá guardada y no tendrás que volver a iniciar sesión.

---

## 7. Modos de Ejecución

### Modo Predeterminado (API REST 7.1)
Por defecto, la herramienta utiliza la API REST oficial de Azure DevOps utilizando las cookies de tu navegador:
```bash
npm start "https://dev.azure.com/mi-org/MiProyecto/_testPlans/execute?planId=123456&suiteId=789012"
```
* **Ventajas:** Es ultra rápido (segundos), descarga adjuntos en paralelo y no depende de selectores HTML.

### Modo Respaldo por Interfaz (Playwright UI)
Si por políticas de firewall o red institucional la API REST directa no está disponible, puedes forzar la navegación automatizada:
```bash
npm start -- "https://dev.azure.com/mi-org/MiProyecto/_testPlans/execute?planId=123456&suiteId=789012" --ui
```
* **Comportamiento:** Playwright abrirá la suite, navegará por los casos, abrirá los popups de ejecución y descargará los adjuntos desde la interfaz.

---

## 8. Estructura y Organización de Resultados

El sistema organiza los informes de forma inteligente en el directorio base configurado en `OUTPUT_PATH`:

```text
C:\ReportesQA\ (o tu carpeta compartida de Google Drive / OneDrive)
├── 10101 - Autenticacion de Usuarios\
│   └── Resultado_Pruebas_10101_Autenticacion_de_Usuarios.docx
├── 10102 - Carrito de Compras\
│   └── Resultado_Pruebas_10102_Carrito_de_Compras.docx
└── Suite Regresion Sprint 1\
    └── Resultado_Pruebas_10103_Suite_Regresion_Sprint_1.docx
```

* **Detección inteligente:** Si ya existe una carpeta con el ID de la HU o con su nombre (por ejemplo `Suite Regresion Sprint 1`), el sistema la reutiliza automáticamente para no duplicar directorios.
* **Creación automática:** Si no existe carpeta previa, crea una nueva carpeta con el formato `{HU_ID} - {NOMBRE_HU}`.

---

## 9. Solución de Problemas Comunes

### 1. `Error: Plantilla base no encontrada`
* **Causa:** No se ha colocado el archivo `.docx` en la raíz del proyecto.
* **Solución:** Coloca tu archivo Word como `plantilla_resultado_pruebas.docx` en la raíz o define la ruta en `.env` mediante `TEMPLATE_PATH`.

### 2. `EBUSY: resource locked or busy`
* **Causa:** Tienes el archivo Word generado previamente abierto en Microsoft Word mientras ejecutas una nueva extracción.
* **Solución:** La herramienta tiene un sistema de guardado alternativo con sufijo de hora, pero se recomienda cerrar el documento en Word antes de volver a ejecutar.

### 3. La unidad de Google Drive no aparece (`Path not found`)
* **Causa:** La aplicación Google Drive Desktop no está iniciada o la letra de unidad asignada cambió.
* **Solución:** La herramienta detecta esto automáticamente y guarda en `./output` local como respaldo. Abre Google Drive Desktop para restaurar la sincronización en la nube.

### 4. Sesión expirada de Azure DevOps
* **Causa:** Las credenciales de Microsoft expiraron por políticas de seguridad de la organización.
* **Solución:** Elimina la carpeta `.browser-session` en la raíz del proyecto y vuelve a ejecutar `npm start` para iniciar sesión nuevamente en el navegador.

