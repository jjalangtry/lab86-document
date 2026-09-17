import './tldraw-offline';
import { useEffect, useRef } from 'react';
import { Tldraw, getSnapshot, loadSnapshot, type Editor, type TLEditorSnapshot } from 'tldraw';
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite';
import 'tldraw/tldraw.css';

// Assets ship with the app. The renderer has no network access. Vite resolves the asset
// paths to absolute app:// URLs, so the identity formatter keeps them as they are. The default
// formatter only recognizes http and data URLs and would prefix everything else with a slash.
const assetUrls = getAssetUrlsByImport(url => url);

type Props = { snapshot: TLEditorSnapshot | null; onChange: (snapshot: TLEditorSnapshot) => void; theme: 'light' | 'dark' };

// A tldraw drawing surface. Changes are reported after a short pause.
export function TldrawBoard({ snapshot, onChange, theme }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onChange); latest.current = onChange;
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => { editorRef.current?.user.updateUserPreferences({ colorScheme: theme }); }, [theme]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <div className="tldraw-board" data-testid="tldraw-board">
    <Tldraw assetUrls={assetUrls} onMount={editor => {
      editorRef.current = editor;
      editor.user.updateUserPreferences({ colorScheme: theme });
      if (snapshot) { try { loadSnapshot(editor.store, snapshot); } catch (error) { void window.vault.log('warn', `tldraw snapshot rejected: ${error instanceof Error ? error.message : String(error)}`); } }
      const stop = editor.store.listen(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; latest.current(getSnapshot(editor.store)); }, 600);
      }, { scope: 'document', source: 'user' });
      return () => { stop(); editorRef.current = null; };
    }} />
  </div>;
}
export default TldrawBoard;
