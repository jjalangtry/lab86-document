const test = require('node:test');
const assert = require('node:assert/strict');

async function editor(doc, selection) {
  const { EditorState } = await import('@codemirror/state');
  const { keymap } = await import('@codemirror/view');
  const { history } = await import('@codemirror/commands');
  const { tabIndentation } = await import('../src/tab-indentation.ts');
  const target = {
    state: EditorState.create({ doc, selection, extensions: [history(), tabIndentation] }),
    dispatch(transaction) { target.state = transaction.state; },
  };
  const binding = target.state.facet(keymap).flat().find(binding => binding.key === 'Tab');
  assert.ok(binding, 'Tab must have an editor key binding');
  return { target, binding };
}

test('Tab indents a paragraph and Shift+Tab restores it', async () => {
  const { target, binding } = await editor('Paragraph', { anchor: 4 });
  assert.equal(binding.run(target), true);
  assert.equal(target.state.doc.toString(), '\tParagraph');
  assert.equal(target.state.selection.main.anchor, 5);
  assert.equal(binding.shift(target), true);
  assert.equal(target.state.doc.toString(), 'Paragraph');
  assert.equal(target.state.selection.main.anchor, 4);
});

test('Tab and Shift+Tab indent all selected Markdown list items', async () => {
  const text = '- First\n- Second';
  const { target, binding } = await editor(text, { anchor: 0, head: text.length });
  binding.run(target);
  assert.equal(target.state.doc.toString(), '\t- First\n\t- Second');
  binding.shift(target);
  assert.equal(target.state.doc.toString(), text);
});

test('Tab supports blank lines and undo; Shift+Tab handles unindented text', async () => {
  const { undo } = await import('@codemirror/commands');
  const { target, binding } = await editor('', { anchor: 0 });
  binding.run(target);
  assert.equal(target.state.doc.toString(), '\t');
  assert.equal(undo(target), true);
  assert.equal(target.state.doc.toString(), '');
  assert.equal(binding.shift(target), true);
  assert.equal(target.state.doc.toString(), '');
});
