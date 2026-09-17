// App settings. They apply to every vault and live in localStorage.
export type Settings = {
  readableWidth: boolean;
  textSize: number;
  spellcheck: boolean;
  newNoteLocation: 'root' | 'current';
  dailyFolder: string;
  templatesFolder: string;
  attachmentsFolder: string;
  showLineNumbers: boolean;
};
export const DEFAULT_SETTINGS: Settings = { readableWidth: true, textSize: 16, spellcheck: true, newNoteLocation: 'root', dailyFolder: 'Daily', templatesFolder: 'Templates', attachmentsFolder: 'attachments', showLineNumbers: false };
const KEY = 'document.settings';
const FOLDER = /^[^\\:*?"<>|#^[\]]{0,120}$/;

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>;
    const folder = (value: unknown, fallback: string) => typeof value === 'string' && FOLDER.test(value) ? value.replace(/^\/+|\/+$/g, '') : fallback;
    return {
      readableWidth: saved.readableWidth ?? DEFAULT_SETTINGS.readableWidth,
      textSize: [14, 15, 16, 17, 18, 20].includes(Number(saved.textSize)) ? Number(saved.textSize) : DEFAULT_SETTINGS.textSize,
      spellcheck: saved.spellcheck ?? DEFAULT_SETTINGS.spellcheck,
      newNoteLocation: saved.newNoteLocation === 'current' ? 'current' : 'root',
      dailyFolder: folder(saved.dailyFolder, DEFAULT_SETTINGS.dailyFolder),
      templatesFolder: folder(saved.templatesFolder, DEFAULT_SETTINGS.templatesFolder),
      attachmentsFolder: folder(saved.attachmentsFolder, DEFAULT_SETTINGS.attachmentsFolder) || DEFAULT_SETTINGS.attachmentsFolder,
      showLineNumbers: saved.showLineNumbers ?? DEFAULT_SETTINGS.showLineNumbers,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings: Settings) { localStorage.setItem(KEY, JSON.stringify(settings)); }

// Fills template tokens: {{date}}, {{time}}, {{title}}, and {{date:YYYY-MM-DD HH:mm}}.
export function fillTemplate(text: string, title: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const format = (pattern: string) => pattern
    .replace(/YYYY/g, String(now.getFullYear())).replace(/MM/g, pad(now.getMonth() + 1)).replace(/DD/g, pad(now.getDate()))
    .replace(/HH/g, pad(now.getHours())).replace(/mm/g, pad(now.getMinutes())).replace(/ss/g, pad(now.getSeconds()));
  return text
    .replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_m, pattern: string) => format(pattern))
    .replace(/\{\{\s*time\s*:\s*([^}]+?)\s*\}\}/g, (_m, pattern: string) => format(pattern))
    .replace(/\{\{\s*date\s*\}\}/g, format('YYYY-MM-DD'))
    .replace(/\{\{\s*time\s*\}\}/g, format('HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/g, title);
}
