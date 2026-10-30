import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export class BrowserManager {
  private static context: BrowserContext | null = null;
  private static sessionDir = path.resolve(process.cwd(), '.browser-session');

  static async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }

      console.log(`\x1b[36m[Browser]\x1b[0m Iniciando navegador con sesión persistente en: ${this.sessionDir}`);

      this.context = await chromium.launchPersistentContext(this.sessionDir, {
        headless: false,
        viewport: { width: 1440, height: 900 },
        args: ['--start-maximized'],
        acceptDownloads: true,
      });

      this.context.setDefaultTimeout(35000);
      this.context.setDefaultNavigationTimeout(45000);
    }
    return this.context;
  }

  static async getPage(): Promise<Page> {
    const context = await this.getContext();
    const pages = context.pages();
    return pages.length > 0 ? pages[0] : await context.newPage();
  }

  static async close(): Promise<void> {
    if (this.context) {
      console.log('\x1b[36m[Browser]\x1b[0m Cerrando navegador...');
      await this.context.close();
      this.context = null;
    }
  }
}

