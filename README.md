# Automatización de Diligenciamiento de Formato de Pruebas (GTE-ASF-R-01) desde Azure Test Plans

## 1. Visión General del Proyecto
Este proyecto automatiza la generación y diligenciamiento de los informes oficiales de resultados de pruebas (**GTE-ASF-R-01 Resultado de Pruebas V7**) de Inter Rapidísimo S.A. a partir de las suites de prueba de cada Historia de Usuario en **Azure DevOps (Test Plans)**.

---

## 2. Flujo de Navegación Validado por Playwright

El flujo de interacción exacto con Azure DevOps opera así:

1. **Apertura de la Suite:**
   * El usuario ingresa la URL directa de la suite de la HU en la vista **Execute** (ejemplo: `https://dev.azure.com/interrapidisimo/PL%20-%20Portal%20Clientes/_testPlans/execute?planId=420777&suiteId=428930`).
   * Se inicia el navegador con sesión persistente (`.browser-session`).
2. **Lectura de la HU y Casos:**
   * Se extrae el nombre e ID de la HU desde la cabecera.
   * Se listan todos los Casos de Prueba (Test Points) de la tabla central.
3. **Apertura del Test Run (Ventana Popup):**
   * Para cada caso, se realiza doble clic sobre la fila.
   * Se abre el panel lateral `dialog` (`execution history`).
   * Se hace clic en el estado o corrida (`Passed` / `Failed`).
   * **Azure DevOps abre la ejecución en una ventana emergente (popup / nueva pestaña).**
4. **Extracción de Evidencias en la Pestaña `Attachments`:**
   * En la ventana emergente de la corrida, se hace clic en la pestaña **`Attachments`**.
   * Se descargan directamente todas las capturas de pantalla registradas (`Screenshot_....png`).
   * Se cierra la ventana emergente de la corrida.
   * Se cierra el diálogo lateral con `Escape` y se pasa al siguiente caso.
5. **Diligenciamiento del Informe Word:**
   * Se clonan dinámicamente las tablas institucionales por cada escenario.
   * Se insertan las capturas redimensionadas en el recuadro `Ejecución HU`.
   * Se calculan los totales y se exporta el informe oficial en `./output/`.

---

## 3. Instrucciones de Uso

Para ejecutar el flujo automatizado:

```bash
npm start
```
O pasando la URL como argumento:
```bash
npm start "https://dev.azure.com/interrapidisimo/PL%20-%20Portal%20Clientes/_testPlans/execute?planId=420777&suiteId=428930"
```

### Modos de extracción

* **API REST (por defecto):** el inicio de sesión sigue siendo manual y se guarda en `.browser-session`. Con esa misma sesión se consultan las APIs oficiales de Azure DevOps (`testplan` / `test`) para obtener la HU, los casos, el último resultado y **descargar los adjuntos (evidencias)** directamente, sin clics en la interfaz. Implementado en `src/azure-api-extractor.ts`.
* **Interfaz web (respaldo):** si la API falla, se ejecuta automáticamente el flujo anterior con Playwright (`src/azure-extractor.ts`). Para forzarlo:
```bash
npm start -- "<URL de la suite>" --ui
```
