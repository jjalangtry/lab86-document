export type Entry = { name: string; path: string; kind: 'folder' | 'note' | 'file'; children?: Entry[] };
export type Note = { path: string; text: string };
export type Theme = 'system' | 'light' | 'dark';
export type Mode = 'live' | 'source' | 'reading';
export type VaultInfo = { vault: { path: string; name: string } | null; recent: string[]; theme: Theme; platform: string };
export type PdfOptions = { pageSize: 'Letter' | 'A4' | 'Legal'; margin: number; landscape: boolean; includeTitle: boolean; font: string; size: number; lineHeight: number; align: 'left' | 'center' | 'right' | 'justify'; indent: boolean; pageNumbers: boolean };

declare global {
  interface Window {
    vault: {
      platform: string;
      info(): Promise<VaultInfo>;
      setTheme(theme: Theme): Promise<void>;
      setChrome(theme: 'light' | 'dark'): Promise<void>;
      chooseVault(create: boolean): Promise<VaultInfo | null>;
      openVault(directory: string): Promise<VaultInfo>;
      forgetVault(directory: string): Promise<VaultInfo>;
      closeVault(): Promise<VaultInfo>;
      tree(): Promise<Entry[]>;
      index(): Promise<Note[]>;
      revealVault(): Promise<void>;
      read(path: string): Promise<string>;
      write(path: string, text: string): Promise<void>;
      createNote(folder: string, name?: string, text?: string): Promise<string>;
      createFolder(folder: string, name?: string): Promise<string>;
      rename(from: string, to: string): Promise<string>;
      trash(path: string): Promise<void>;
      reveal(path: string): Promise<void>;
      importImage(): Promise<string | null>;
      saveAttachment(name: string, data: Uint8Array): Promise<string>;
      exportPdf(title: string, html: string, options: PdfOptions): Promise<{ fileName: string } | null>;
      exportDocx(title: string, text: string, options: PdfOptions, images: Record<string, string>): Promise<{ fileName: string } | null>;
      openExternal(url: string): Promise<void>;
      closeReady(): Promise<void>;
      closeFailed(message: string): Promise<void>;
      onChanged(callback: (paths: string[]) => void): () => void;
      onCommand(callback: (name: string) => void): () => void;
      onClose(callback: () => void): () => void;
    };
  }
}
