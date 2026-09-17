import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';

export const tabIndentation = [
  indentUnit.of('\t'),
  EditorState.tabSize.of(4),
  keymap.of([indentWithTab]),
];
