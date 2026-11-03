import fs from 'fs';
import path from 'path';

/**
 * Carga variables de entorno desde el archivo .env en la raíz del proyecto
 * sin necesidad de dependencias externas.
 */
export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

/**
 * Determina el directorio base de almacenamiento.
 * Si OUTPUT_PATH está configurado en .env (ej: Google Drive), intenta usarlo.
 * Si no está configurado o no está accesible, recurre a ./output.
 */
export function resolveBaseOutputDir(): string {
  loadEnv();
  const configured = (process.env.OUTPUT_PATH || '').trim();

  if (configured) {
    try {
      if (!fs.existsSync(configured)) {
        fs.mkdirSync(configured, { recursive: true });
      }
      return path.resolve(configured);
    } catch (err: any) {
      console.warn(`\x1b[33m[Aviso Storage]\x1b[0m No se pudo acceder a la ruta configurada en .env (${configured}): ${err.message}`);
      console.warn('\x1b[33m[Aviso Storage]\x1b[0m Se utilizará la carpeta local ./output como respaldo.');
    }
  }

  const fallback = path.resolve(process.cwd(), 'output');
  if (!fs.existsSync(fallback)) {
    fs.mkdirSync(fallback, { recursive: true });
  }
  return fallback;
}

/**
 * Normaliza un texto para comparaciones flexibles (minúsculas, sin tildes ni símbolos).
 */
function normalizeForMatch(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resuelve la subcarpeta de la Historia de Usuario:
 * 1. Escanea las carpetas existentes en baseDir.
 * 2. Si ya existe una carpeta para esta HU (por ID o por nombre), la reutiliza.
 * 3. Si no existe, crea una nueva carpeta con el nombre de la HU y devuelve la ruta.
 */
export function resolveHuFolder(baseDir: string, huId: string, huName: string): string {
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const cleanHuId = (huId || '').trim();
  const cleanHuName = (huName || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();

  const normId = cleanHuId && cleanHuId !== '000000' ? normalizeForMatch(cleanHuId) : '';
  const normName = normalizeForMatch(cleanHuName);

  // 1. Buscar si ya existe una carpeta para la HU
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const folderName = entry.name;
        const normFolder = normalizeForMatch(folderName);

        // Coincidencia por ID (ej: "406158 - ...", "HU 406158", "406158_...")
        if (normId && normFolder.includes(normId)) {
          console.log(`\x1b[36m[Carpeta HU]\x1b[0m Reutilizando carpeta existente: \x1b[1m${folderName}\x1b[0m`);
          return path.join(baseDir, folderName);
        }

        // Coincidencia por nombre (ej: "Estabilizacion 7")
        if (normName && normName.length > 5 && normFolder.includes(normName)) {
          console.log(`\x1b[36m[Carpeta HU]\x1b[0m Reutilizando carpeta existente: \x1b[1m${folderName}\x1b[0m`);
          return path.join(baseDir, folderName);
        }
      }
    }
  } catch (err: any) {
    console.warn(`\x1b[33m[Aviso Storage]\x1b[0m Error al explorar carpetas en ${baseDir}: ${err.message}`);
  }

  // 2. Si no existe, crear la carpeta de la HU
  let folderDisplayName = '';
  if (cleanHuId && cleanHuId !== '000000') {
    if (cleanHuName && !cleanHuName.toLowerCase().startsWith(cleanHuId.toLowerCase())) {
      folderDisplayName = `${cleanHuId} - ${cleanHuName}`;
    } else {
      folderDisplayName = cleanHuName || cleanHuId;
    }
  } else {
    folderDisplayName = cleanHuName || 'Historia de Usuario';
  }

  // Limitar longitud para evitar problemas de rutas largas en Windows
  folderDisplayName = folderDisplayName.substring(0, 80).trim();

  const huFolderPath = path.join(baseDir, folderDisplayName);
  if (!fs.existsSync(huFolderPath)) {
    fs.mkdirSync(huFolderPath, { recursive: true });
    console.log(`\x1b[32m[Carpeta HU]\x1b[0m Carpeta creada para la HU: \x1b[1m${folderDisplayName}\x1b[0m`);
  } else {
    console.log(`\x1b[36m[Carpeta HU]\x1b[0m Carpeta existente seleccionada: \x1b[1m${folderDisplayName}\x1b[0m`);
  }

  return huFolderPath;
}

