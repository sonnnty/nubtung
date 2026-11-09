import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** Runs `pdftotext -layout` on a (password-protected) KBank statement PDF and returns its text */
export function extractStatementText(pdfBuffer: Buffer, password?: string): string {
  const tempDir = path.join(process.cwd(), 'data', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `stm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.pdf`);
  fs.writeFileSync(tempFilePath, pdfBuffer);

  try {
    const args = ['-layout', ...(password ? ['-upw', password] : []), tempFilePath, '-'];
    return execFileSync('pdftotext', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}
