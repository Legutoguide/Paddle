import fs from 'node:fs';
import path from 'node:path';

let logFilePath: string | null = null;

export function initLogger(logDir: string): void {
  fs.mkdirSync(logDir, { recursive: true });
  const filename = `app-${new Date().toISOString().slice(0, 10)}.log`;
  logFilePath = path.join(logDir, filename);
}

function write(level: string, message: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${
    meta !== undefined ? ' ' + safeStringify(meta) : ''
  }\n`;
  // Always echo to console for `npm run dev` visibility.
  // eslint-disable-next-line no-console
  (level === 'ERROR' ? console.error : console.log)(line.trim());
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, line, 'utf-8');
    } catch {
      // Logging must never crash the app.
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => write('INFO', message, meta),
  warn: (message: string, meta?: unknown) => write('WARN', message, meta),
  error: (message: string, meta?: unknown) => write('ERROR', message, meta),
};
