import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { UserStoryContext, ScenarioEvidence, DocumentMetadata } from './types';

/**
 * Extractor basado en la API REST oficial de Azure DevOps (Test Plans / Test Results).
 *
 * No usa PAT ni tokens: reutiliza la sesión que el usuario inició manualmente en el
 * navegador persistente (.browser-session). Las peticiones se hacen con las cookies
 * de ese contexto (context.request) y, si no fuera suficiente, con fetch() dentro de
 * la propia página de dev.azure.com.
 *
 * Devuelve exactamente las mismas estructuras que AzureExtractor (UI), por lo que
 * WordEngine no requiere cambios.
 */

interface SuiteUrlInfo {
  baseUrl: string;      // https://dev.azure.com/{org}/{project}  (project codificado)
  projectName: string;  // nombre del proyecto decodificado
  planId: number;
  suiteId: number;
}

interface RawResponse {
  status: number;
  contentType: string;
  body: Buffer;
  continuationToken?: string;
}

interface PointInfo {
  caseId: string;
  title: string;
  outcome: string;
  runId: number;
  resultId: number;
}

interface AttachmentRef {
  id: number;
  fileName: string;
  createdDate?: string;
}

const API_VERSION = '7.1';
const MAX_PARALLEL_DOWNLOADS = 4;
const DOWNLOADABLE_EXT = /\.(png|jpe?g|zip)$/i;

export class AzureApiExtractor {
  private info: SuiteUrlInfo;

  constructor(private page: Page, private suiteUrl: string) {
    this.info = AzureApiExtractor.parseSuiteUrl(suiteUrl);
  }

  /**
   * Obtiene organización/proyecto, planId y suiteId desde la URL de la suite.
   */
  static parseSuiteUrl(raw: string): SuiteUrlInfo {
    const u = new URL(raw);
    const planId = Number(u.searchParams.get('planId'));
    const suiteId = Number(u.searchParams.get('suiteId'));
    if (!planId || !suiteId) {
      throw new Error('La URL no contiene los parámetros planId y suiteId.');
    }

    const segs = u.pathname.split('/').filter(Boolean);
    let baseUrl: string;
    let projectSeg: string;

    if (u.hostname.toLowerCase() === 'dev.azure.com') {
      if (segs.length < 2) throw new Error('No se pudo identificar organización y proyecto en la URL.');
      projectSeg = segs[1];
      baseUrl = `${u.origin}/${segs[0]}/${segs[1]}`;
    } else {
      // Formato antiguo: https://{org}.visualstudio.com/{project}/...
      if (segs.length < 1) throw new Error('No se pudo identificar el proyecto en la URL.');
      projectSeg = segs[0];
      baseUrl = `${u.origin}/${segs[0]}`;
    }

    return { baseUrl, projectName: decodeURIComponent(projectSeg), planId, suiteId };
  }

  /**
   * Navega a la suite y, si es necesario, espera a que el usuario complete el login
   * manual. La sesión queda guardada en .browser-session como hasta ahora.
   */
  async ensureAuthenticated(): Promise<void> {
    console.log(`\x1b[34m[Paso 1]\x1b[0m Validando sesión en Azure DevOps: ${this.suiteUrl}`);
    await this.page.goto(this.suiteUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(2000);

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
      await this.page.waitForTimeout(1500);
    }
  }

  /**
   * Flujo completo: HU + metadata + escenarios con evidencias descargadas.
   */
  async extractAll(tempBaseDir: string): Promise<{ hu: UserStoryContext; metadata: DocumentMetadata }> {
    const { planId, suiteId } = this.info;

    // 1. Plan (sprint) y suite (HU)
    console.log('\x1b[34m[Paso 2]\x1b[0m Consultando Test Plan y Suite por API...');
    const plan = await this.getJson<any>(`testplan/plans/${planId}`).catch(() => null);
    const suite = await this.getJson<any>(`testplan/Plans/${planId}/suites/${suiteId}`);
    const { huId, huName } = await this.resolveUserStory(suite);
    const fullName = `${huId} : ${huName}`;
    console.log(`\x1b[32m[HU Detectada]\x1b[0m \x1b[1m${fullName}\x1b[0m`);

    // 2. Test Points (casos + último resultado)
    console.log('\x1b[34m[Paso 3]\x1b[0m Consultando casos de prueba (Test Points)...');
    const points = await this.getPoints(planId, suiteId);
    console.log(`\x1b[36m[Info]\x1b[0m Casos de prueba encontrados: ${points.length}`);

    // 3. Resultados y evidencias por caso
    const scenarios: ScenarioEvidence[] = [];
    const executionDates: Date[] = [];

    for (const point of points) {
      const scenario: ScenarioEvidence = {
        scenarioId: point.caseId,
        scenarioTitle: point.title || `Caso de prueba ${point.caseId}`,
        outcome: this.mapOutcome(point.outcome, point.runId),
        observations: '',
        evidenceImages: [],
      };

      console.log(`\n\x1b[35m[Escenario #${scenarios.length + 1}]\x1b[0m ID: \x1b[36m${scenario.scenarioId}\x1b[0m | Estado: \x1b[32m${scenario.outcome}\x1b[0m | ${scenario.scenarioTitle.substring(0, 60)}...`);

      if (!point.runId || !point.resultId) {
        console.log('  ℹ Caso Activo (sin ejecución previa registrada).');
        scenario.observations = 'Caso sin ejecución registrada en Azure Test Plans.';
        scenarios.push(scenario);
        continue;
      }

      try {
        const result = await this.getJson<any>(`test/Runs/${point.runId}/results/${point.resultId}`, {
          detailsToInclude: 'Iterations',
        }).catch(() => null);

        if (result?.startedDate) executionDates.push(new Date(result.startedDate));
        if (result?.completedDate) executionDates.push(new Date(result.completedDate));

        const comment = String(result?.comment || result?.errorMessage || '').trim();
        scenario.observations = comment
          || (scenario.outcome === 'Exitosa'
            ? 'Ejecución exitosa validada en Azure Test Plans.'
            : `Estado de ejecución registrado en Azure: ${scenario.outcome}`);

        const scenarioDir = path.join(tempBaseDir, huId, scenario.scenarioId);
        this.resetDir(scenarioDir);

        const attachments = await this.listAttachments(point.runId, point.resultId, result);
        console.log(`  Adjuntos registrados en el resultado: ${attachments.length}`);

        scenario.evidenceImages = await this.downloadAttachments(point.runId, point.resultId, attachments, scenarioDir);
        console.log(`  ✔ ${scenario.evidenceImages.length} capturas reales listas para Word.`);
      } catch (err: any) {
        console.warn(`  ⚠ No se pudieron extraer evidencias para [${scenario.scenarioId}]: ${err.message}`);
        if (!scenario.observations) {
          scenario.observations = `Estado de ejecución registrado en Azure: ${scenario.outcome}`;
        }
      }

      scenarios.push(scenario);
    }

    const passed = scenarios.filter((s) => s.outcome === 'Exitosa').length;

    const hu: UserStoryContext = {
      id: huId,
      name: huName,
      fullName,
      scenarios,
      totalScenarios: scenarios.length,
      passedScenarios: passed,
    };

    const today = new Date().toLocaleDateString('es-CO');
    const validDates = executionDates.filter((d) => !isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
    const sprint = this.extractSprint(plan?.iteration);

    const metadata: DocumentMetadata = {
      projectName: this.info.projectName,
      projectId: this.info.projectName,
      sprint: sprint || 'Sprint Actual',
      requester: 'Líder Técnico QA - Inter Rapidísimo',
      module: 'Portal Clientes - Web',
      testStage: 'QA / Pruebas Funcionales',
      testingArea: 'TECNOLOGÍA / ARQUITECTURA TI',
      startDate: validDates.length ? validDates[0].toLocaleDateString('es-CO') : today,
      endDate: validDates.length ? validDates[validDates.length - 1].toLocaleDateString('es-CO') : today,
      environment: 'QA Staging Inter Rapidísimo',
      testType: 'Funcional / E2E',
      urlOrVersion: this.suiteUrl,
      observations: 'Pruebas ejecutadas y validadas conforme a la definición de terminado.',
    };

    return { hu, metadata };
  }

  // ---------------------------------------------------------------------------
  // HU / Plan
  // ---------------------------------------------------------------------------

  private async resolveUserStory(suite: any): Promise<{ huId: string; huName: string }> {
    const suiteName = String(suite?.name || '').trim();

    // Suite basada en requerimiento: la HU es un work item enlazado
    if (suite?.requirementId) {
      const huId = String(suite.requirementId);
      try {
        const wi = await this.getJson<any>(`wit/workitems/${huId}`, { fields: 'System.Title' });
        const title = String(wi?.fields?.['System.Title'] || '').trim();
        if (title) return { huId, huName: title };
      } catch {}
      const m = suiteName.match(/^\s*\d{5,8}\s*:\s*(.+)$/);
      return { huId, huName: (m ? m[1] : suiteName) || 'Historia de Usuario' };
    }

    // Suite estática con nombre "123456 : Nombre"
    const m = suiteName.match(/(\d{5,8})\s*:\s*(.+)$/);
    if (m) return { huId: m[1], huName: m[2].trim() };

    return { huId: String(this.info.suiteId), huName: suiteName || `Suite ${this.info.suiteId}` };
  }

  private extractSprint(iterationPath?: string): string {
    if (!iterationPath) return '';
    const parts = String(iterationPath).split('\\').filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }

  // ---------------------------------------------------------------------------
  // Test Points
  // ---------------------------------------------------------------------------

  private async getPoints(planId: number, suiteId: number): Promise<PointInfo[]> {
    let raw: PointInfo[];
    try {
      raw = await this.getPointsTestPlanApi(planId, suiteId);
    } catch (err: any) {
      console.warn(`  ⚠ API testplan/TestPoint no disponible (${err.message}). Usando API test/points...`);
      raw = await this.getPointsLegacyApi(planId, suiteId);
    }

    // Un caso puede tener varios points (configuraciones): se conserva uno por caso,
    // priorizando el que tenga ejecución.
    const byCase = new Map<string, PointInfo>();
    for (const p of raw) {
      const prev = byCase.get(p.caseId);
      if (!prev || (!prev.runId && p.runId)) byCase.set(p.caseId, p);
    }
    return Array.from(byCase.values());
  }

  private async getPointsTestPlanApi(planId: number, suiteId: number): Promise<PointInfo[]> {
    const points: PointInfo[] = [];
    let token: string | undefined;

    do {
      const query: Record<string, string> = { includePointDetails: 'true' };
      if (token) query.continuationToken = token;
      const res = await this.getJsonWithToken<any>(`testplan/Plans/${planId}/Suites/${suiteId}/TestPoint`, query);

      for (const p of res.data?.value || []) {
        const r = p.results || {};
        points.push({
          caseId: String(p.testCaseReference?.id ?? ''),
          title: String(p.testCaseReference?.name ?? '').trim(),
          outcome: String(r.outcome ?? 'unspecified'),
          runId: Number(r.lastTestRunId || 0),
          resultId: Number(r.lastResultId || 0),
        });
      }
      token = res.continuationToken;
    } while (token);

    return points.filter((p) => p.caseId);
  }

  private async getPointsLegacyApi(planId: number, suiteId: number): Promise<PointInfo[]> {
    const points: PointInfo[] = [];
    const top = 200;
    let skip = 0;

    while (true) {
      const res = await this.getJson<any>(`test/Plans/${planId}/Suites/${suiteId}/points`, {
        includePointDetails: 'true',
        $top: String(top),
        $skip: String(skip),
      });
      const value: any[] = res?.value || [];
      for (const p of value) {
        points.push({
          caseId: String(p.testCase?.id ?? ''),
          title: String(p.testCase?.name ?? '').trim(),
          outcome: String(p.outcome ?? 'unspecified'),
          runId: Number(p.lastTestRun?.id || 0),
          resultId: Number(p.lastResult?.id || 0),
        });
      }
      if (value.length < top) break;
      skip += top;
    }

    return points.filter((p) => p.caseId);
  }

  private mapOutcome(outcome: string, runId: number): string {
    const o = (outcome || '').toLowerCase();
    if (o === 'passed') return 'Exitosa';
    if (o === 'failed') return 'Fallida';
    if (o === 'blocked') return 'Bloqueada';
    if (o === 'inprogress') return 'En Progreso';
    if (o === 'notapplicable') return 'No Aplica';
    if (o === 'paused') return 'Pausada';
    if (!runId || o === 'unspecified' || o === 'none' || o === '') return 'Activa';
    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Evidencias
  // ---------------------------------------------------------------------------

  /**
   * Une los adjuntos del resultado con los adjuntos registrados por paso / iteración.
   */
  private async listAttachments(runId: number, resultId: number, result: any): Promise<AttachmentRef[]> {
    const map = new Map<number, AttachmentRef>();

    const list = await this.getJson<any>(`test/Runs/${runId}/Results/${resultId}/attachments`).catch(() => null);
    for (const a of list?.value || []) {
      if (a?.id) map.set(Number(a.id), { id: Number(a.id), fileName: String(a.fileName || `adjunto_${a.id}`), createdDate: a.createdDate });
    }

    for (const it of result?.iterationDetails || []) {
      for (const a of it?.attachments || []) {
        const id = Number(a?.id);
        if (id && !map.has(id)) {
          map.set(id, { id, fileName: String(a.name || a.fileName || `adjunto_${id}`) });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const da = a.createdDate ? Date.parse(a.createdDate) : 0;
      const db = b.createdDate ? Date.parse(b.createdDate) : 0;
      return da - db || a.id - b.id;
    });
  }

  private async downloadAttachments(
    runId: number,
    resultId: number,
    attachments: AttachmentRef[],
    targetDir: string
  ): Promise<string[]> {
    const candidates = attachments.filter((a) => DOWNLOADABLE_EXT.test(a.fileName) || !path.extname(a.fileName));
    const savedPerAttachment: string[][] = new Array(candidates.length).fill(null).map(() => []);
    const usedNames = new Set<string>();

    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        const index = cursor++;
        const att = candidates[index];
        try {
          const url = this.buildApiUrl(`test/Runs/${runId}/Results/${resultId}/attachments/${att.id}`);
          const res = await this.rawGet(url, 'application/octet-stream');
          if (res.status >= 400 || res.contentType.includes('text/html')) {
            throw new Error(`HTTP ${res.status}`);
          }
          savedPerAttachment[index] = this.saveAttachment(att, res.body, targetDir, usedNames);
        } catch (e: any) {
          console.warn(`  ⚠ No se pudo descargar el adjunto "${att.fileName}": ${e.message}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_DOWNLOADS, candidates.length) }, () => worker()));

    // Mantener el orden cronológico de los adjuntos
    return savedPerAttachment.flat();
  }

  /**
   * Guarda el binario; si es ZIP extrae las imágenes. Solo conserva PNG/JPEG reales.
   */
  private saveAttachment(att: AttachmentRef, body: Buffer, targetDir: string, usedNames: Set<string>): string[] {
    const saved: string[] = [];

    if (this.isZip(body)) {
      const zip = new AdmZip(body);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const data = entry.getData();
        if (this.isImage(data)) {
          saved.push(this.writeUnique(targetDir, path.basename(entry.entryName), data, usedNames));
        }
      }
      return saved;
    }

    if (this.isImage(body)) {
      saved.push(this.writeUnique(targetDir, att.fileName, body, usedNames));
    }
    return saved;
  }

  private writeUnique(dir: string, fileName: string, data: Buffer, usedNames: Set<string>): string {
    const clean = path.basename(fileName).replace(/[\\/:*?"<>|]/g, '_') || 'evidencia.png';
    const ext = path.extname(clean);
    const stem = clean.substring(0, clean.length - ext.length);
    let candidate = clean;
    let n = 1;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${stem}_${n++}${ext}`;
    }
    usedNames.add(candidate.toLowerCase());
    const full = path.join(dir, candidate);
    fs.writeFileSync(full, data);
    return full;
  }

  private isImage(buf: Buffer): boolean {
    const isPng = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpg = buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
    return isPng || isJpg;
  }

  private isZip(buf: Buffer): boolean {
    return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  }

  private resetDir(dir: string): void {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  // ---------------------------------------------------------------------------
  // HTTP con la sesión del navegador
  // ---------------------------------------------------------------------------

  private buildApiUrl(relPath: string, query: Record<string, string> = {}): string {
    const params = new URLSearchParams({ ...query, 'api-version': API_VERSION });
    return `${this.info.baseUrl}/_apis/${relPath}?${params.toString()}`;
  }

  private async getJson<T>(relPath: string, query: Record<string, string> = {}): Promise<T> {
    return (await this.getJsonWithToken<T>(relPath, query)).data;
  }

  private async getJsonWithToken<T>(
    relPath: string,
    query: Record<string, string> = {}
  ): Promise<{ data: T; continuationToken?: string }> {
    const url = this.buildApiUrl(relPath, query);
    const res = await this.rawGet(url, 'application/json');

    if (res.contentType.includes('text/html') || res.status === 203) {
      throw new Error('La sesión del navegador no es válida para la API (respuesta de login). Inicia sesión nuevamente.');
    }
    if (res.status >= 400) {
      const snippet = res.body.toString('utf8').substring(0, 200);
      throw new Error(`HTTP ${res.status} en ${relPath}: ${snippet}`);
    }
    return { data: JSON.parse(res.body.toString('utf8')) as T, continuationToken: res.continuationToken };
  }

  /**
   * GET autenticado con las cookies del contexto persistente. Si Azure DevOps no
   * acepta la petición fuera de la página, se repite con fetch() dentro de la página.
   */
  private async rawGet(url: string, accept: string): Promise<RawResponse> {
    const headers: Record<string, string> = {
      Accept: accept,
      'X-TFS-FedAuthRedirect': 'Suppress',
      'X-Requested-With': 'XMLHttpRequest',
    };

    try {
      const res = await this.page.context().request.get(url, { headers, failOnStatusCode: false, timeout: 60000 });
      const resHeaders = res.headers();
      const contentType = resHeaders['content-type'] || '';
      const authProblem = [401, 403, 203].includes(res.status()) || contentType.includes('text/html');
      if (!authProblem) {
        return {
          status: res.status(),
          contentType,
          body: await res.body(),
          continuationToken: resHeaders['x-ms-continuationtoken'],
        };
      }
    } catch {
      // Se reintenta dentro de la página
    }

    return this.inPageGet(url, headers);
  }

  private async inPageGet(url: string, headers: Record<string, string>): Promise<RawResponse> {
    const r = await this.page.evaluate(
      async ({ url, headers }) => {
        const resp = await fetch(url, { credentials: 'include', headers });
        const buf = new Uint8Array(await resp.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
        }
        return {
          status: resp.status,
          contentType: resp.headers.get('content-type') || '',
          b64: btoa(bin),
          token: resp.headers.get('x-ms-continuationtoken') || '',
        };
      },
      { url, headers }
    );

    return {
      status: r.status,
      contentType: r.contentType,
      body: Buffer.from(r.b64, 'base64'),
      continuationToken: r.token || undefined,
    };
  }
}

