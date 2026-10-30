import readline from 'readline';
import path from 'path';
import { BrowserManager } from './browser';
import { AzureExtractor } from './azure-extractor';
import { AzureApiExtractor } from './azure-api-extractor';
import { WordEngine } from './word-engine';
import { UserStoryContext, DocumentMetadata } from './types';

function promptUser(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(query, (ans) => { rl.close(); res(ans.trim()); }));
}

async function main() {
  console.log('\n\x1b[35m==============================================================\x1b[0m');
  console.log('\x1b[1m\x1b[35m  AUTOMATIZADOR DE FORMATO GTE-ASF-R-01 (INTER RAPIDÍSIMO)   \x1b[0m');
  console.log('\x1b[35m==============================================================\x1b[0m\n');

  // 1. Obtener la URL de la HU
  // Modo de extracción: API (por defecto) o UI (--ui fuerza el flujo anterior con Playwright)
  const forceUi = process.argv.includes('--ui');
  let huUrl = process.argv.slice(2).find((a) => a.startsWith('http')) || '';
  if (!huUrl) {
    console.log('\x1b[33mPor favor ingresa la URL de la suite de la HU (Execute):\x1b[0m');
    console.log('\x1b[90m(Ejemplo: https://dev.azure.com/interrapidisimo/PL%20-%20Portal%20Clientes/_testPlans/execute?planId=420777&suiteId=428930)\x1b[0m\n');
    huUrl = await promptUser('URL de la HU > ');
  }

  if (!huUrl || !huUrl.startsWith('http')) {
    console.error('\x1b[31m[Error] URL inválida. Debe comenzar con http:// o https://\x1b[0m');
    process.exit(1);
  }

  const tempDir = path.resolve(process.cwd(), '.temp');
  const outputDir = path.resolve(process.cwd(), 'output');
  const startTime = Date.now();

  try {
    const page = await BrowserManager.getPage();
    let hu: UserStoryContext | undefined;
    let metadata: DocumentMetadata | undefined;

    // 2-4. Extracción por API REST reutilizando la sesión manual del navegador
    if (!forceUi) {
      try {
        console.log('\x1b[36m[Modo]\x1b[0m Extracción por API REST de Azure DevOps (sesión del navegador).');
        const apiExtractor = new AzureApiExtractor(page, huUrl);
        await apiExtractor.ensureAuthenticated();
        ({ hu, metadata } = await apiExtractor.extractAll(tempDir));
      } catch (apiErr: any) {
        console.warn(`\x1b[33m[Aviso]\x1b[0m Falló la extracción por API (${apiErr.message}). Se usará la navegación por interfaz.`);
        hu = undefined;
        metadata = undefined;
      }
    }

    // Respaldo: flujo anterior por interfaz (Playwright)
    if (!hu || !metadata) {
      console.log('\x1b[36m[Modo]\x1b[0m Extracción por interfaz web (Playwright).');
      const extractor = new AzureExtractor(page);

      // 2. Abrir la suite
      await extractor.openUserStorySuite(huUrl);

      // 3. Extraer cabecera y HU
      ({ hu, metadata } = await extractor.extractHeader());

      // 4. Extraer los escenarios y evidencias mediante el popup
      const scenarios = await extractor.extractScenariosAndEvidences(hu.id, tempDir);
      hu.scenarios = scenarios;
      hu.totalScenarios = scenarios.length;
      hu.passedScenarios = scenarios.filter((s) => s.outcome.toLowerCase().includes('exit') || s.outcome.toLowerCase().includes('pass')).length;
    }

    // 5. Generar informe Word institucional
    const docPath = await WordEngine.generateDocument(hu, metadata, outputDir);

    // 6. Cerrar navegador
    await BrowserManager.close();

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log('\n\x1b[32m==============================================================\x1b[0m');
    console.log(`\x1b[1m\x1b[32m  PROCESO COMPLETADO EXITOSAMENTE EN ${duration} SEGUNDOS\x1b[0m`);
    console.log('\x1b[32m==============================================================\x1b[0m');
    console.log(`\n📄 Archivo generado: \x1b[1m\x1b[36m${docPath}\x1b[0m`);
    console.log(`📊 Escenarios: ${hu.totalScenarios} | Aprobados: ${hu.passedScenarios}\n`);

  } catch (error: any) {
    console.error('\x1b[31m\n[Error Inesperado]\x1b[0m', error.message || error);
    await BrowserManager.close();
    process.exit(1);
  }
}

main();

