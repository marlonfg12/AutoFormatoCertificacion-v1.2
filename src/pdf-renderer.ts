import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

/**
 * Convierte documentos PDF adjuntos como evidencia en imágenes PNG (una por página),
 * usando pdf.js (pdfjs-dist) y su canvas nativo para Node (@napi-rs/canvas).
 *
 * Las páginas se renderizan completas, sin recortes. Solo se omiten las páginas
 * totalmente en blanco.
 */

const RENDER_SCALE = 2;      // ~144 DPI: buena legibilidad al insertarse en Word
const MAX_PAGES = 40;        // límite de seguridad por documento

// pdfjs-dist es ESM puro. Este import dinámico evita que TypeScript (module CommonJS)
// lo transforme en require().
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
let pdfjsPromise: Promise<any> | null = null;

function pdfjsRoot(): string {
  try {
    return path.dirname(require.resolve('pdfjs-dist/package.json'));
  } catch {
    return path.resolve(__dirname, '..', 'node_modules', 'pdfjs-dist');
  }
}

function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    const entry = path.join(pdfjsRoot(), 'legacy', 'build', 'pdf.mjs');
    pdfjsPromise = dynamicImport(pathToFileURL(entry).href);
  }
  return pdfjsPromise;
}

export function isPdf(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

/**
 * Renderiza cada página del PDF a PNG y devuelve los buffers en orden.
 */
export async function renderPdfToPngs(pdf: Buffer): Promise<Buffer[]> {
  const pdfjs = await loadPdfjs();
  // pdf.js exige rutas terminadas en "/" (en Node se leen con fs.readFile)
  const root = pdfjsRoot().replace(/\\/g, '/');

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: `${root}/standard_fonts/`,
    cMapUrl: `${root}/cmaps/`,
    cMapPacked: true,
    wasmUrl: `${root}/wasm/`,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  const images: Buffer[] = [];
  try {
    const total = Math.min(doc.numPages, MAX_PAGES);
    if (doc.numPages > MAX_PAGES) {
      console.warn(`  ⚠ El PDF tiene ${doc.numPages} páginas; solo se tomarán las primeras ${MAX_PAGES}.`);
    }

    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const { canvas, context } = doc.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));

      await page.render({ canvasContext: context, canvas, viewport }).promise;

      if (!isBlankPage(context, canvas.width, canvas.height)) {
        images.push(canvas.toBuffer('image/png'));
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return images;
}

/**
 * Renderiza el PDF y guarda cada página como "<nombre>_pagina_<n>.png" en targetDir.
 * Devuelve las rutas generadas en orden de página.
 */
export async function savePdfAsImages(pdf: Buffer, pdfFileName: string, targetDir: string): Promise<string[]> {
  const pages = await renderPdfToPngs(pdf);
  const base = path.basename(pdfFileName).replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_') || 'documento';
  const saved: string[] = [];

  pages.forEach((png, i) => {
    const full = path.join(targetDir, `${base}_pagina_${i + 1}.png`);
    fs.writeFileSync(full, png);
    saved.push(full);
  });

  return saved;
}

/**
 * Detecta páginas completamente en blanco muestreando píxeles.
 */
function isBlankPage(context: any, width: number, height: number): boolean {
  try {
    const data: Uint8ClampedArray = context.getImageData(0, 0, width, height).data;
    const step = 4 * 7; // muestreo cada 7 píxeles
    for (let i = 0; i < data.length; i += step) {
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return false;
    }
    return true;
  } catch {
    return false;
  }
}
