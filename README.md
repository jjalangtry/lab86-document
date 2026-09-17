# Document

Document is a desktop Markdown editor for a folder of notes. It works like Obsidian. A vault is a folder on the computer. Each note is a plain `.md` file in that folder. The app needs no account, server, or network connection.

## Start

Use Node.js 22.12 or later on a desktop computer.

```sh
npm ci
npm start
```

On the first start, make a new vault or open a folder that has Markdown files. The app opens the last vault on the next start.

## Write

- The editor shows a live preview. Markdown marks are hidden on lines that do not have the cursor.
- Type `# ` for a heading, `- ` for a list, `- [ ] ` for a task, `> ` for a quote, and three backticks for a code block.
- Type `[[` to link to a note. The list of notes opens as you type. A link to a note that does not exist makes that note when you click it.
- Type `![[image.png]]` to show an image from the vault. Paste or drop an image to save it in the `attachments` folder.
- Type `#tag` to add a tag. Click a tag to search for it.
- Click the note title to rename the note. Links in other notes update with the new name.
- Notes save as you type. There is no save button.

## Format an essay

- Open **Format** in the right sidebar to set the font, the font size, the line spacing, the alignment, the first-line indent, the paper size, the margins, and page numbers.
- The settings are stored at the top of the note as YAML frontmatter. Other Markdown tools keep them. The live preview shows them as one line. Click that line to open the Format pane.
- Any font installed on the computer works. Select **Other font…** and type its name.
- The formatting toolbar under the note header has bold, italic, underline, strikethrough, highlight, links, lists, quotes, code, alignment, and images. Hide it from the note menu.
- Underline uses `<u>` tags. A centered or right-aligned paragraph uses `<p align="center">` tags. Both are normal Markdown with inline HTML. The live preview hides the tags.
- The PDF export uses the font, size, spacing, alignment, indent, paper, margins, and page numbers of the note.

## Navigate

- The left sidebar shows the files and the search. Right-click a file or folder for more actions.
- The right sidebar shows the outline and the backlinks of the open note.
- The quick switcher opens a note by name. Type a name that does not exist and press Enter to make a note.
- The command palette lists all commands.
- The mode toggle in the note header changes between edit and reading view. Source mode shows all Markdown marks.

## Keyboard controls

| Control | Shortcut |
| --- | --- |
| New note | Ctrl/Cmd+N |
| Quick switcher | Ctrl/Cmd+O |
| Command palette | Ctrl/Cmd+P |
| Search in all notes | Ctrl/Cmd+Shift+F |
| Find in the note | Ctrl/Cmd+F |
| Reading view | Ctrl/Cmd+E |
| Left sidebar | Ctrl/Cmd+Shift+L |
| Right sidebar | Ctrl/Cmd+Shift+R |
| Back / Forward | Ctrl+Alt+Left / Right |
| Bold / Italic / Underline | Ctrl/Cmd+B / I / U |
| Align left / center / right / justify | Ctrl/Cmd+Alt+L / E / R / J |
| Link | Ctrl/Cmd+K |
| Task list | Ctrl/Cmd+L |
| Export to PDF | Ctrl/Cmd+Shift+E |

## Files

The vault is a normal folder. Other programs can read and write the notes. The app shows changes from other programs after a short delay. Deleted files move to the system trash. Folders that start with a dot are hidden.

Saves use a temporary file and an atomic rename. If a save fails, the app shows an error with a retry button. The app saves pending edits before it closes.

## Export

Export a note to PDF from the note menu or the command palette. The export uses the reading view layout. Page size, margin, and orientation are options in the export dialog.

## Build packages

```sh
npm run package:mac       # Apple Silicon ZIP
npm run package:windows   # Windows x64 portable app
npm run package           # Unpacked build for the current platform
```

Builds appear in `release/`. Windows builds have no publisher signature. Mac builds use an ad-hoc signature and are not notarized.

Mac packages use `codesign` on macOS. A cross-platform Mac build requires [rcodesign](https://gregoryszorc.com/docs/apple-codesign/stable/apple_codesign_rcodesign_signing.html). Set `RCODESIGN` to its executable path. The package script requires Python 3.

## Checks

```sh
npm test
npm run test:desktop
```

The unit tests cover the vault file operations and the PDF export. The desktop test uses Xvfb on Linux. It launches Electron with a temporary vault. It checks note creation, live preview, tasks, wikilinks, backlinks, the outline, history, reading view, rename, search, the quick switcher, the command palette, the file watcher, PDF export, and save on close.

## Implementation

Electron provides the window, the file dialogs, the file watcher, and the PDF output. React provides the interface. CodeMirror 6 provides the editor with the Markdown parser from Lezer. The live preview is a CodeMirror view plugin that hides syntax marks with decorations. Marked and DOMPurify render the reading view. Radix primitives provide the menus, tooltips, and dialogs.

The renderer has no Node.js access. The preload exposes specific vault operations. Main-process handlers check the sender and keep all paths inside the vault. Images load through a `vault://` protocol that only serves image files from the vault. The app blocks external network requests and navigation.
