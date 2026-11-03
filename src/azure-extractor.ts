import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { UserStoryContext, ScenarioEvidence, DocumentMetadata } from './types';
import { isPdf, savePdfAsImages } from './pdf-renderer';

export class AzureExtractor {
  constructor(private page: Page) {}

  /**
   * Abre directamente la suite de la HU y espera que la tabla de casos esté lista.
   */
  async openUserStorySuite(url: string): Promise<void> {
    console.log(`\x1b[34m[Paso 1]\x1b[0m Navegando a la suite de pruebas: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });

    // Dar tiempo para que se complete cualquier redirección a login si aplica
    await this.page.waitForTimeout(2000);

    // Si detecta inicio de sesión de Microsoft, espera a que el usuario complete el login
    if (
      this.page.url().includes('login.microsoftonline.com') ||
      this.page.url().includes('signin') ||
      this.page.url().includes('oauth')
    ) {
      console.log('\x1b[33m[Autenticación]\x1b[0m Por favor inicia sesión con tu cuenta corporativa en la ventana del navegador...');
      await this.page.waitForURL((u) => u.href.includes('dev.azure.com') && !u.href.includes('signin'), {
        timeout: 180000,
      });
      console.log('\x1b[32m[Autenticación]\x1b[0m Sesión completada con éxito.');
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(2000);
    }

    // Asegurar pestaña Execute
    const executeTab = this.page.getByRole('tab', { name: 'Execute' });
    if (await executeTab.isVisible({ timeout: 10000 }).catch(() => false)) {
      await executeTab.click();
      await this.page.waitForTimeout(1500);
    }

    // Esperar la tabla de Test Points con localizador nativo limpio
    console.log('\x1b[36m[Info]\x1b[0m Esperando carga de la tabla de Test Points...');
    const gridLocator = this.page.locator('[role="grid"], .vss-DetailsList, table').first();
    await gridLocator.waitFor({ state: 'visible', timeout: 35000 });
    await this.page.waitForTimeout(2000);
  }

  /**
   * Extrae la cabecera principal con el ID y Nombre de la HU.
   */
  async extractHeader(): Promise<{ hu: UserStoryContext; metadata: DocumentMetadata }> {
    console.log('\x1b[34m[Paso 2]\x1b[0m Leyendo información de la Historia de Usuario...');

    const currentUrl = this.page.url();
    let projectName = 'Portal Clientes';
    const projectMatch = currentUrl.match(/(?:dev\.azure\.com\/[^/]+\/|visualstudio\.com\/)([^/?#]+)/i);
    if (projectMatch && projectMatch[1]) {
      projectName = decodeURIComponent(projectMatch[1]);
    }

    let headerText = '';
    const headings = this.page.locator('h1, h2, .bolt-header-title, [role="heading"], .title').filter({ hasText: ':' });
    const count = await headings.count();

    for (let i = 0; i < count; i++) {
      const text = (await headings.nth(i).innerText().catch(() => '')).trim();
      if (text.includes(':') && (text.includes('(ID:') || /\d{5,8}\s*:/.test(text))) {
        headerText = text;
        break;
      }
    }

    let huId = '000000';
    let huName = 'Historia de Usuario';

    if (headerText) {
      const match = headerText.match(/(\d{5,8})\s*:\s*([^(\n\r]+?)(?:\s*\(ID:\s*\d+\))?$/);
      if (match) {
        huId = match[1].trim();
        huName = match[2].trim();
      }
    } else {
      const urlSuite = currentUrl.match(/suiteId=(\d+)/i);
      if (urlSuite) {
        huId = urlSuite[1];
        huName = `Suite ${huId}`;
      }
    }

    const fullName = `${huId} : ${huName}`;
    console.log(`\x1b[32m[HU Detectada]\x1b[0m \x1b[1m${fullName}\x1b[0m`);

    const hu: UserStoryContext = {
      id: huId,
      name: huName,
      fullName,
      scenarios: [],
      totalScenarios: 0,
      passedScenarios: 0,
    };

    const metadata: DocumentMetadata = {
      projectName,
      projectId: projectName,
      sprint: 'Sprint Actual',
      requester: 'Líder Técnico QA - Inter Rapidísimo',
      module: 'Portal Clientes - Web',
      testStage: 'QA / Pruebas Funcionales',
      testingArea: 'TECNOLOGÍA / ARQUITECTURA TI',
      startDate: new Date().toLocaleDateString('es-CO'),
      endDate: new Date().toLocaleDateString('es-CO'),
      environment: 'QA Staging Inter Rapidísimo',
      testType: 'Funcional / E2E',
      urlOrVersion: currentUrl,
      observations: 'Pruebas ejecutadas y validadas conforme a la definición de terminado.',
    };

    return { hu, metadata };
  }

  /**
   * Recorre los escenarios, abre el popup de ejecución para cada uno y descarga las capturas masivamente.
   */
  async extractScenariosAndEvidences(huId: string, tempBaseDir: string): Promise<ScenarioEvidence[]> {
    console.log('\x1b[34m[Paso 3]\x1b[0m Identificando filas de casos de prueba en la tabla central...');

    const table = this.page.locator('.vss-DetailsList, [role="grid"], table').filter({ hasText: 'Test Case Id' }).first();
    const rows = await table.locator('[role="row"]').all();

    console.log(`\x1b[36m[Info]\x1b[0m Total de filas encontradas en la tabla: ${rows.length}`);

    const scenarioList: ScenarioEvidence[] = [];
    const seenCaseIds = new Set<string>();

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const text = (await row.innerText().catch(() => '')).trim();

      // Ignorar encabezados
      if (!text || text.includes('Filter') || text.includes('Run for web') || text === 'Title' || text.includes('Test Case Id')) {
        continue;
      }

      // Buscar el ID del caso de prueba
      const idMatches = text.match(/\b(\d{5,8})\b/g);
      if (!idMatches || idMatches.length === 0) continue;
      const caseId = idMatches[idMatches.length - 1];

      if (seenCaseIds.has(caseId)) continue;
      seenCaseIds.add(caseId);

      // Determinar Outcome
      let outcome = 'Exitosa';
      const lower = text.toLowerCase();
      if (lower.includes('not applicable') || lower.includes('no aplica')) {
        outcome = 'No Aplica';
      } else if (lower.includes('failed') || lower.includes('fall')) {
        outcome = 'Fallida';
      } else if (lower.includes('in progress')) {
        outcome = 'En Progreso';
      } else if (lower.includes('active') || lower.includes('activa')) {
        outcome = 'Activa';
      } else if (lower.includes('passed')) {
        outcome = 'Exitosa';
      }

      // Extraer título limpio del escenario (excluyendo tester, configuración QA, etc.)
      let title = '';
      const cells = await row.locator('[role="gridcell"], td').all();
      for (const cell of cells) {
        const cText = (await cell.innerText().catch(() => '')).trim();
        // El título del escenario es el texto descriptivo que no es solo números, outcome ni configuración
        if (cText.length > 8 && !cText.match(/^\d+$/) && !cText.match(/^(Passed|Failed|Active|Blocked|In Progress|QA|Design|Ready)/i)) {
          title = cText;
          break;
        }
      }

      if (!title) {
        title = text
          .replace(/\b\d{5,8}\b/g, '')
          .replace(/\b\d{1,3}\b/g, '')
          .replace(/Passed|Active|Failed|Blocked|In Progress|Design|Ready/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Remover cualquier sufijo de configuración o nombre del tester (ej: "QA Marlon Brandon Florez Giraldo")
      title = title
        .replace(/\s+\b(QA|Staging|Producción|Prod)\b.*$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      const scenario: ScenarioEvidence = {
        scenarioId: caseId,
        scenarioTitle: title || `Caso de prueba ${caseId}`,
        outcome,
        observations: outcome === 'Exitosa'
          ? 'Ejecución exitosa validada en Azure Test Plans.'
          : `Estado de ejecución registrado en Azure: ${outcome}`,
        evidenceImages: [],
      };

      console.log(`\n\x1b[35m[Escenario #${scenarioList.length + 1}]\x1b[0m ID: \x1b[36m${caseId}\x1b[0m | Estado: \x1b[32m${outcome}\x1b[0m | ${title.substring(0, 60)}...`);

      // Si está en estado Activo, no tiene corrida ejecutada
      if (outcome === 'Activa') {
        console.log(`  ℹ Caso Activo (sin ejecución previa registrada).`);
        scenarioList.push(scenario);
        continue;
      }

      // No Aplica no se incluye como tabla en el documento: no se descargan evidencias
      if (outcome === 'No Aplica') {
        console.log(`  ℹ Escenario en estado No Aplica: no se incluirá como tabla en el documento (se lista al final).`);
        scenarioList.push(scenario);
        continue;
      }

      const scenarioDir = path.join(tempBaseDir, huId, caseId);
      if (!fs.existsSync(scenarioDir)) {
        fs.mkdirSync(scenarioDir, { recursive: true });
      }

      let popupPage: Page | null = null;

      try {
        // 1. Doble clic en la fila del Test Point
        await row.scrollIntoViewIfNeeded();
        await row.click();
        await row.dblclick();

        // 2. Esperar el panel lateral 'dialog' (execution history)
        const dialog = this.page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 8000 });
        await this.page.waitForTimeout(600);

        // 3. Localizar la tabla de ejecuciones dentro del diálogo
        console.log('  Accediendo al resultado de la última corrida en el panel lateral...');
        const runsTable = dialog.locator('[role="grid"], table, .vss-DetailsList').first();
        await runsTable.waitFor({ state: 'visible', timeout: 6000 });

        const firstRunRow = runsTable.locator('[role="row"], .grid-row, tr').filter({ hasText: /Passed|Failed/i }).first();
        await firstRunRow.waitFor({ state: 'visible', timeout: 6000 });

        const outcomeCell = firstRunRow.locator('div, span, [role="gridcell"]').filter({ hasText: /^Passed$|^Failed$/i }).first();

        console.log('  Abriendo ventana emergente (popup) del Test Run...');

        try {
          const popupPromise = this.page.waitForEvent('popup', { timeout: 7000 });
          if (await outcomeCell.isVisible({ timeout: 2000 }).catch(() => false)) {
            await outcomeCell.click();
          } else {
            await firstRunRow.click();
          }
          popupPage = await popupPromise;
        } catch {
          console.log('  Intentando apertura con doble clic en la corrida...');
          const popupPromise2 = this.page.waitForEvent('popup', { timeout: 8000 });
          await firstRunRow.dblclick();
          popupPage = await popupPromise2;
        }

        if (!popupPage) {
          throw new Error('No se abrió la ventana emergente de la ejecución.');
        }

        await popupPage.waitForLoadState('domcontentloaded');

        // Extraer ID y título canónico del caso desde la cabecera del popup si está disponible
        try {
          const headingEl = popupPage.locator('h1, h2, .bolt-header-title, [role="heading"]').first();
          if (await headingEl.isVisible({ timeout: 2500 }).catch(() => false)) {
            const headingText = (await headingEl.innerText()).trim();
            const match = headingText.match(/^(\d{5,8})\s+(.*)$/);
            if (match) {
              scenario.scenarioId = match[1];
              scenario.scenarioTitle = match[2];
            }
          }
        } catch {}

        // 4. En el popup, hacer clic en la pestaña 'Attachments'
        console.log('  Accediendo a la pestaña "Attachments"...');
        const attachmentsTab = popupPage.getByRole('tab', { name: /Attachments/i });
        await attachmentsTab.waitFor({ state: 'visible', timeout: 10000 });

        // Verificar si la pestaña indica explícitamente 0 adjuntos
        const tabText = (await attachmentsTab.innerText().catch(() => '')).trim();
        if (tabText.match(/Attachments\s*\(?0\)?$/i)) {
          console.log('  ℹ No hay adjuntos registrados para esta corrida (Attachments: 0).');
          await popupPage.close();
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(500);
          scenarioList.push(scenario);
          continue;
        }

        await attachmentsTab.click();
        await popupPage.waitForTimeout(1500);

        // 5. Descarga de evidencias (masiva o individual de respaldo)
        const downloadedImages = await this.downloadAttachmentsMassively(popupPage, scenarioDir);
        scenario.evidenceImages = downloadedImages;

        console.log(`  ✔ ${downloadedImages.length} evidencias reales obtenidas.`);

        // 6. Cerrar popup
        await popupPage.close();

        // 7. Cerrar diálogo lateral con Escape
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);

      } catch (err: any) {
        console.warn(`  ⚠ No se pudieron extraer evidencias automáticas para [${caseId}]: ${err.message}`);
        try {
          if (popupPage && !popupPage.isClosed()) {
            await popupPage.close();
          }
          await this.page.keyboard.press('Escape');
        } catch {}
      }

      scenarioList.push(scenario);
    }

    return scenarioList;
  }

  /**
   * Descarga masiva seleccionando todos los adjuntos con el checkbox 'Select all'
   * y haciendo clic en el botón oficial 'Download' de Azure DevOps.
   * Cuenta con respaldo individual en caso de fallo en el paquete masivo.
   */
  private async downloadAttachmentsMassively(popupPage: Page, downloadDir: string): Promise<string[]> {
    // 1. Localizar el botón 'Download' de la barra de herramientas de adjuntos
    const downloadBtn = popupPage.locator(
      'button:has-text("Download"), [role="button"]:has-text("Download"), .bolt-button:has-text("Download")'
    ).filter({ hasText: /^Download$/i }).first();

    const isDownloadActive = async (): Promise<boolean> => {
      if (!(await downloadBtn.isVisible({ timeout: 2000 }).catch(() => false))) return false;
      const disabled = await downloadBtn.getAttribute('disabled');
      const ariaDisabled = await downloadBtn.getAttribute('aria-disabled');
      const className = (await downloadBtn.getAttribute('class')) || '';
      return disabled === null && ariaDisabled !== 'true' && !className.includes('disabled');
    };

    // 2. Localizar el control 'Select all' estrictamente en la cabecera (thead o th)
    console.log('  Marcando casilla para seleccionar todos los adjuntos...');
    const headerCheck = popupPage.locator(
      'thead th.bolt-table-cell-select, thead .bolt-table-cell-select, thead th:first-child, .bolt-table-header-cell-select, thead [aria-label*="Select"], [data-automationid="DetailsHeaderPageCheck"]'
    ).first();

    if (await headerCheck.isVisible({ timeout: 4000 }).catch(() => false)) {
      await headerCheck.click();
      await popupPage.waitForTimeout(700);

      // Si no se activó Download, hacer un segundo clic por si estaba en indeterminate [-] o deseleccionó
      if (!(await isDownloadActive())) {
        await headerCheck.click();
        await popupPage.waitForTimeout(700);
      }
    }

    // 3. Si aún no está activo, marcar explícitamente todas las casillas de cada fila
    if (!(await isDownloadActive())) {
      console.log('  Seleccionando casillas fila por fila en la tabla de adjuntos...');
      const rowChecks = popupPage.locator(
        'tbody .bolt-table-cell-select, tbody tr [role="checkbox"], tbody tr [aria-label*="Select row"]'
      );
      const totalChecks = await rowChecks.count();
      for (let i = 0; i < totalChecks; i++) {
        await rowChecks.nth(i).click().catch(() => {});
        await popupPage.waitForTimeout(80);
      }
      await popupPage.waitForTimeout(600);
    }

    // 4. Intentar descarga masiva si el botón quedó activo
    let bulkDownloadSuccess = false;
    if (await isDownloadActive()) {
      console.log('  Presionando botón masivo "Download" de Azure DevOps...');
      try {
        const [download] = await Promise.all([
          popupPage.waitForEvent('download', { timeout: 15000 }),
          downloadBtn.click(),
        ]);

        const suggestedName = download.suggestedFilename() || 'attachments.zip';
        const downloadedPath = path.join(downloadDir, suggestedName);
        await download.saveAs(downloadedPath);
        console.log(`  ✔ Paquete descargado: ${suggestedName}`);

        // Si es un archivo ZIP, descomprimirlo
        if (suggestedName.endsWith('.zip')) {
          try {
            const zip = new AdmZip(downloadedPath);
            zip.extractAllTo(downloadDir, true);
            fs.unlinkSync(downloadedPath); // eliminar el zip contenedor
            bulkDownloadSuccess = true;
          } catch (e: any) {
            console.warn(`  ⚠ Error al descomprimir ${suggestedName}: ${e.message}`);
          }
        } else {
          bulkDownloadSuccess = true;
        }
      } catch (err: any) {
        console.warn(`  ⚠ Falló la descarga masiva (${err.message}). Pasando al método individual de respaldo...`);
      }
    } else {
      console.warn('  ⚠ Botón "Download" masivo no se habilitó. Ejecutando descarga individual...');
    }

    // 5. Si la descarga masiva no fue exitosa o no extrajo archivos, usar respaldo individual
    if (!bulkDownloadSuccess) {
      await this.downloadIndividualAttachments(popupPage, downloadDir);
    }

    // 6. Validar que los archivos en el directorio sean imágenes reales válidas (PNG / JPEG)
    const validImages: string[] = [];
    const files = fs.readdirSync(downloadDir);

    for (const file of files) {
      const fullPath = path.join(downloadDir, file);
      if (fs.statSync(fullPath).isFile()) {
        try {
          const buf = fs.readFileSync(fullPath);
          const isPng = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
          const isJpg = buf.length > 2 && buf[0] === 0xFF && buf[1] === 0xD8;
          if (isPng || isJpg) {
            validImages.push(fullPath);
          } else if (isPdf(buf)) {
            // Evidencias en PDF: convertir cada página en imagen
            console.log(`  Convirtiendo PDF a imágenes: ${file}`);
            try {
              const pages = await savePdfAsImages(buf, file, downloadDir);
              validImages.push(...pages);
            } catch (e: any) {
              console.warn(`  ⚠ No se pudo convertir el PDF "${file}": ${e.message}`);
            }
            fs.unlinkSync(fullPath);
          } else {
            // Eliminar archivos espurios / HTML
            fs.unlinkSync(fullPath);
          }
        } catch {
          // Ignorar
        }
      }
    }

    console.log(`  ✔ ${validImages.length} capturas reales listas para Word.`);
    return validImages;
  }

  /**
   * Respaldo para descargar evidencias una por una o capturarlas de la vista previa de Azure DevOps.
   */
  private async downloadIndividualAttachments(popupPage: Page, downloadDir: string): Promise<string[]> {
    const downloadedImages: string[] = [];
    const itemButtons = popupPage.locator('tbody tr button, tbody tr a, tbody tr [role="button"]')
      .filter({ hasText: /\.(png|jpg|jpeg)/i });

    const count = await itemButtons.count();
    console.log(`  Procesando ${count} adjuntos individuales de respaldo...`);

    for (let i = 0; i < count; i++) {
      try {
        const item = itemButtons.nth(i);
        const nameText = (await item.innerText().catch(() => '')).trim() || `screenshot_${i + 1}.png`;
        const cleanName = path.basename(nameText.split('\n')[0]);
        const destPath = path.join(downloadDir, cleanName);

        // Clic para abrir el panel de vista previa del adjunto
        await item.click();
        await popupPage.waitForTimeout(800);

        // Buscar botón Download dentro del panel de vista previa
        const previewDownloadBtn = popupPage.locator('button:has-text("Download"), [aria-label*="Download"]').last();
        if (await previewDownloadBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          try {
            const [download] = await Promise.all([
              popupPage.waitForEvent('download', { timeout: 8000 }),
              previewDownloadBtn.click(),
            ]);
            await download.saveAs(destPath);
            if (fs.existsSync(destPath)) {
              downloadedImages.push(destPath);
              continue;
            }
          } catch {}
        }

        // Si el botón Download no responde, capturar directamente la imagen renderizada
        const previewImg = popupPage.getByRole('img', { name: /Attachment Preview/i }).first();
        if (await previewImg.isVisible({ timeout: 3000 }).catch(() => false)) {
          const imgBuffer = await previewImg.screenshot();
          fs.writeFileSync(destPath, imgBuffer);
          downloadedImages.push(destPath);
        }
      } catch (e: any) {
        console.warn(`  ⚠ No se pudo obtener adjunto #${i + 1}: ${e.message}`);
      }
    }

    return downloadedImages;
  }
}
