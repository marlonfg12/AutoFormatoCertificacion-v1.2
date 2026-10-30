import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import imageSize from 'image-size';
import { UserStoryContext, DocumentMetadata } from './types';

export class WordEngine {
  private static templatePath = path.resolve(process.cwd(), 'Copia de GTE-ASF-R-01 Resultado de Pruebas V7.docx');
  private static maxImageWidthEmu = 5400000;  // ~15 cm
  private static maxImageHeightEmu = 3600000; // ~10 cm

  static async generateDocument(
    hu: UserStoryContext,
    metadata: DocumentMetadata,
    outputDir: string
  ): Promise<string> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeName = `${hu.id}_${hu.name}`.replace(/[\\/:*?"<>|]/g, '_').trim().substring(0, 60);
    const fileName = `GTE-ASF-R-01_Resultado_Pruebas_${safeName}.docx`;
    const outputPath = path.join(outputDir, fileName);

    console.log(`\x1b[34m[Paso 4]\x1b[0m Diligenciando plantilla oficial Word para: \x1b[1m${hu.fullName}\x1b[0m...`);

    if (!fs.existsSync(this.templatePath)) {
      throw new Error(`Plantilla base no encontrada en: ${this.templatePath}`);
    }

    const zip = new AdmZip(this.templatePath);
    const docEntry = zip.getEntry('word/document.xml');
    const relsEntry = zip.getEntry('word/_rels/document.xml.rels');

    if (!docEntry || !relsEntry) {
      throw new Error('La estructura de la plantilla .docx es inválida.');
    }

    let docXml = docEntry.getData().toString('utf8');
    let relsXml = relsEntry.getData().toString('utf8');

    // Asegurar namespaces de DrawingML en <w:document>
    if (!docXml.includes('xmlns:a=')) {
      docXml = docXml.replace(
        '<w:document ',
        '<w:document xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
      );
    }

    // Calcular ID máximo para nuevas relaciones
    let maxRId = 20;
    const rIdMatches = relsXml.match(/Id="rId(\d+)"/g);
    if (rIdMatches) {
      for (const m of rIdMatches) {
        const num = parseInt(m.replace(/\D/g, ''), 10);
        if (num > maxRId) maxRId = num;
      }
    }

    // Construir tablas de escenario
    const scenarioTablesXml: string[] = [];
    let imageCounter = 0;

    for (let s = 0; s < hu.scenarios.length; s++) {
      const scenario = hu.scenarios[s];
      const imageParagraphs: string[] = [];

      for (let i = 0; i < scenario.evidenceImages.length; i++) {
        const imgPath = scenario.evidenceImages[i];
        if (fs.existsSync(imgPath)) {
          imageCounter++;
          maxRId++;
          const relId = `rIdImg${maxRId}`;
          const ext = path.extname(imgPath).replace('.', '') || 'png';
          const zipMediaName = `evidence_${hu.id}_sc${scenario.scenarioId}_${i}.${ext}`;
          const zipMediaPath = `word/media/${zipMediaName}`;

          const imgBuffer = fs.readFileSync(imgPath);
          zip.addFile(zipMediaPath, imgBuffer);

          // Registrar en document.xml.rels
          const relXml = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${zipMediaName}"/>`;
          relsXml = relsXml.replace('</Relationships>', `${relXml}</Relationships>`);

          // Calcular tamaño proporcional
          let emuW = this.maxImageWidthEmu;
          let emuH = 3000000;

          try {
            const dims = imageSize(imgBuffer);
            if (dims.width && dims.height) {
              const naturalW = dims.width * 9525;
              const naturalH = dims.height * 9525;
              const ratio = naturalH / naturalW;

              if (naturalW > this.maxImageWidthEmu) {
                emuW = this.maxImageWidthEmu;
                emuH = Math.round(emuW * ratio);
              } else {
                emuW = naturalW;
                emuH = naturalH;
              }

              if (emuH > this.maxImageHeightEmu) {
                emuH = this.maxImageHeightEmu;
                emuW = Math.round(emuH / ratio);
              }
            }
          } catch {}

          imageParagraphs.push(`
            <w:p>
              <w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="80"/></w:pPr>
              <w:r>
                <w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:sz w:val="18"/></w:rPr>
                <w:t>Evidencia ${i + 1}: ${this.escapeXml(path.basename(imgPath))}</w:t>
              </w:r>
            </w:p>
            <w:p>
              <w:pPr><w:jc w:val="center"/><w:spacing w:after="160"/></w:pPr>
              <w:r>
                <w:drawing>
                  <wp:inline distT="0" distB="0" distL="0" distR="0">
                    <wp:extent cx="${emuW}" cy="${emuH}"/>
                    <wp:effectExtent l="0" t="0" r="0" b="0"/>
                    <wp:docPr id="${1000 + imageCounter}" name="Evidencia ${imageCounter}"/>
                    <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
                    <a:graphic>
                      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                        <pic:pic>
                          <pic:nvPicPr>
                            <pic:cNvPr id="${1000 + imageCounter}" name="Evidencia ${imageCounter}"/>
                            <pic:cNvPicPr/>
                          </pic:nvPicPr>
                          <pic:blipFill>
                            <a:blip r:embed="${relId}"/>
                            <a:stretch><a:fillRect/></a:stretch>
                          </pic:blipFill>
                          <pic:spPr>
                            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${emuW}" cy="${emuH}"/></a:xfrm>
                            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                          </pic:spPr>
                        </pic:pic>
                      </a:graphicData>
                    </a:graphic>
                  </wp:inline>
                </w:drawing>
              </w:r>
            </w:p>
          `);
        }
      }

      if (imageParagraphs.length === 0) {
        imageParagraphs.push(`
          <w:p>
            <w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/></w:pPr>
            <w:r>
              <w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:color w:val="7F7F7F"/><w:i/><w:sz w:val="18"/></w:rPr>
              <w:t>[Sin capturas de pantalla registradas]</w:t>
            </w:r>
          </w:p>
        `);
      }

      scenarioTablesXml.push(this.buildTableXml({
        huFullName: hu.fullName,
        scenarioId: scenario.scenarioId,
        scenarioTitle: scenario.scenarioTitle,
        outcome: scenario.outcome,
        observations: scenario.observations,
        contentXml: imageParagraphs.join(''),
      }));
    }

    // Inyectar datos en Tabla 1
    docXml = this.injectGeneralInfo(docXml, metadata);

    // Reemplazar tablas de escenarios
    docXml = this.replaceTables(docXml, scenarioTablesXml);

    // Actualizar tabla de totales
    docXml = this.updateSummary(docXml, hu);

    zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf8'));
    zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml, 'utf8'));

    // Guardado seguro con fallback si Word está abierto
    let finalPath = outputPath;
    try {
      zip.writeZip(outputPath);
    } catch (err: any) {
      if (err && (err.code === 'EBUSY' || err.message?.includes('busy') || err.message?.includes('locked'))) {
        const timeSuffix = new Date().toISOString().replace(/[:.]/g, '-').substring(11, 19);
        const altFile = `GTE-ASF-R-01_Resultado_Pruebas_${safeName}_${timeSuffix}.docx`;
        finalPath = path.join(outputDir, altFile);
        console.warn(`\x1b[33m[Aviso]\x1b[0m El archivo original está abierto en Word. Guardando como: ${altFile}`);
        zip.writeZip(finalPath);
      } else {
        throw err;
      }
    }

    console.log(`\x1b[32m✔ Documento creado exitosamente en:\x1b[0m ${finalPath}`);
    return finalPath;
  }

  private static injectGeneralInfo(docXml: string, meta: DocumentMetadata): string {
    const today = new Date().toLocaleDateString('es-CO');
    const fields: { [label: string]: string } = {
      'Nombre del Proyecto :': meta.projectName,
      'Identificador del Proyecto :': meta.projectId,
      'Sprint:': meta.sprint,
      'Responsable que solicita (Cargo y Nombre):': meta.requester,
      'Aplicación – Módulo:': meta.module,
      'Etapa de pruebas:': meta.testStage,
      'Área que realiza la prueba :': meta.testingArea,
      'Paginación:': 'Página 1 de 2',
      'Fecha de inicio de las pruebas:': meta.startDate || today,
      'Fecha de finalización de Pruebas:': meta.endDate || today,
      'Ambiente de Pruebas:': meta.environment,
      'Observaciones:': meta.observations,
      'Tipo de prueba:': meta.testType,
      'URL y/o versión:': meta.urlOrVersion,
    };

    let xml = docXml;
    for (const [label, val] of Object.entries(fields)) {
      const idx = xml.indexOf(label);
      if (idx !== -1) {
        const tcEnd = xml.indexOf('</w:tc>', idx);
        if (tcEnd !== -1) {
          const nextTcStart = xml.indexOf('<w:tc', tcEnd);
          const nextTcEnd = xml.indexOf('</w:tc>', nextTcStart);
          if (nextTcStart !== -1 && nextTcEnd !== -1) {
            const original = xml.substring(nextTcStart, nextTcEnd + 7);
            const tcPr = original.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] || '';
            const injected = `
              <w:tc>
                ${tcPr}
                <w:p>
                  <w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:sz w:val="18"/></w:rPr></w:pPr>
                  <w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:sz w:val="18"/></w:rPr><w:t>${this.escapeXml(val)}</w:t></w:r>
                </w:p>
              </w:tc>
            `;
            xml = xml.substring(0, nextTcStart) + injected + xml.substring(nextTcEnd + 7);
          }
        }
      }
    }
    return xml;
  }

  private static buildTableXml(p: {
    huFullName: string;
    scenarioId: string;
    scenarioTitle: string;
    outcome: string;
    observations: string;
    contentXml: string;
  }): string {
    const isPass = p.outcome.toLowerCase().includes('exit') || p.outcome.toLowerCase().includes('pass');
    const color = isPass ? '0070C0' : 'C00000';
    const scenarioDisplay = p.scenarioId
      ? `${p.scenarioId} : ${p.scenarioTitle}`
      : p.scenarioTitle;

    return `
<w:tbl>
  <w:tblPr>
    <w:tblStyle w:val="aa" />
    <w:tblW w:w="9366" w:type="dxa" />
    <w:tblInd w:w="1" w:type="dxa" />
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="000000" />
      <w:left w:val="single" w:sz="4" w:space="0" w:color="000000" />
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000" />
      <w:right w:val="single" w:sz="4" w:space="0" w:color="000000" />
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000" />
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000" />
    </w:tblBorders>
    <w:tblLayout w:type="fixed" />
    <w:tblLook w:val="0400" />
  </w:tblPr>
  <w:tblGrid><w:gridCol w:w="2685" /><w:gridCol w:w="6681" /></w:tblGrid>

  <!-- Fila 1: Encabezados superiores -->
  <w:tr>
    <w:trPr><w:trHeight w:val="305" /></w:trPr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2685" w:type="dxa" /><w:vMerge w:val="restart" /><w:shd w:val="clear" w:color="auto" w:fill="000000" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>CASOS DE PRUEBA</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6681" w:type="dxa" /><w:shd w:val="clear" w:color="auto" w:fill="000000" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>NOMBRE HISTORIA DE USUARIO</w:t></w:r></w:p>
    </w:tc>
  </w:tr>

  <!-- Fila 2: Casos de Prueba (Merged) / Nombre HU (Únicamente el nombre de la HU) -->
  <w:tr>
    <w:trPr><w:trHeight w:val="450" /></w:trPr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2685" w:type="dxa" /><w:vMerge /><w:shd w:val="clear" w:color="auto" w:fill="000000" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p/>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6681" w:type="dxa" /><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:color w:val="181C36"/><w:sz w:val="20"/></w:rPr><w:t>${this.escapeXml(p.huFullName)}</w:t></w:r></w:p>
    </w:tc>
  </w:tr>

  <!-- Fila 3: Nombre Escenario (Inicio merge vertical) / Ejecución HU -->
  <w:tr>
    <w:trPr><w:trHeight w:val="300" /></w:trPr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2685" w:type="dxa" /><w:vMerge w:val="restart" /><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:color w:val="181C36"/><w:sz w:val="18"/></w:rPr><w:t>${this.escapeXml(scenarioDisplay)}</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6681" w:type="dxa" /><w:shd w:val="clear" w:color="auto" w:fill="000000" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Ejecución HU</w:t></w:r></w:p>
    </w:tc>
  </w:tr>

  <!-- Fila 4: Nombre Escenario (Merged) / Evidencias (Capturas) -->
  <w:tr>
    <w:trPr><w:trHeight w:val="1500" /></w:trPr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2685" w:type="dxa" /><w:vMerge /><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p/>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6681" w:type="dxa" /><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF" /></w:tcPr>
      ${p.contentXml}
    </w:tc>
  </w:tr>

  <!-- Fila 5: Resultado de la prueba -->
  <w:tr>
    <w:trPr><w:trHeight w:val="450" /></w:trPr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2685" w:type="dxa" /><w:shd w:val="clear" w:color="auto" w:fill="000000" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:ind w:left="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Resultado de la prueba:</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6681" w:type="dxa" /><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:ind w:left="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:color w:val="${color}"/><w:sz w:val="20"/></w:rPr><w:t>${this.escapeXml(p.outcome)}</w:t></w:r></w:p>
    </w:tc>
  </w:tr>

  <!-- Fila 6: Observaciones -->
  <w:tr>
    <w:trPr><w:trHeight w:val="600" /></w:trPr>
    <w:tc>
      <w:tcPr><w:tcW w:w="2685" w:type="dxa" /><w:shd w:val="clear" w:color="auto" w:fill="000000" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:ind w:left="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Observaciones:</w:t></w:r></w:p>
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="6681" w:type="dxa" /><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2" /><w:vAlign w:val="center" /></w:tcPr>
      <w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:sz w:val="18"/></w:rPr><w:t>${this.escapeXml(p.observations)}</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>
<w:p><w:pPr><w:spacing w:before="180" w:after="180"/></w:pPr></w:p>
    `;
  }

  private static replaceTables(docXml: string, newTables: string[]): string {
    const endTag = '</w:tbl>';
    const tables: { start: number; end: number; content: string }[] = [];
    let pos = 0;

    while (true) {
      const s = docXml.indexOf('<w:tbl', pos);
      if (s === -1) break;
      const e = docXml.indexOf(endTag, s);
      if (e === -1) break;
      tables.push({ start: s, end: e + endTag.length, content: docXml.substring(s, e + endTag.length) });
      pos = e + endTag.length;
    }

    const scenarioIdxs: number[] = [];
    for (let i = 0; i < tables.length; i++) {
      if (tables[i].content.includes('CASOS DE PRUEBA')) {
        scenarioIdxs.push(i);
      }
    }

    if (scenarioIdxs.length === 0) return docXml;

    const first = tables[scenarioIdxs[0]].start;
    const last = tables[scenarioIdxs[scenarioIdxs.length - 1]].end;
    return docXml.substring(0, first) + newTables.join('\n') + docXml.substring(last);
  }

  private static updateSummary(docXml: string, hu: UserStoryContext): string {
    let xml = docXml;
    const apIdx = xml.indexOf('Historia de Usuario Aprobadas');
    if (apIdx !== -1) {
      const tcEnd = xml.indexOf('</w:tc>', apIdx);
      if (tcEnd !== -1) {
        const nextStart = xml.indexOf('<w:tc', tcEnd);
        const nextEnd = xml.indexOf('</w:tc>', nextStart);
        if (nextStart !== -1 && nextEnd !== -1) {
          const text = `• ${hu.fullName} - ${hu.passedScenarios} de ${hu.totalScenarios} escenarios aprobados.`;
          const cell = `
            <w:tc>
              <w:tcPr><w:tcW w:w="9394" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/></w:tcPr>
              <w:p><w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:sz w:val="18"/></w:rPr><w:t>${this.escapeXml(text)}</w:t></w:r></w:p>
            </w:tc>
          `;
          xml = xml.substring(0, nextStart) + cell + xml.substring(nextEnd + 7);
        }
      }
    }

    const totIdx = xml.indexOf('Total');
    if (totIdx !== -1) {
      const pEnd = xml.indexOf('</w:p>', totIdx);
      if (pEnd !== -1) {
        const total = `
          <w:r><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> 1 (Escenarios: ${hu.totalScenarios})</w:t></w:r>
        `;
        xml = xml.substring(0, pEnd) + total + xml.substring(pEnd);
      }
    }

    return xml;
  }

  private static escapeXml(s: string): string {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
}

