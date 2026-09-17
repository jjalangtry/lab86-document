const { test } = require('node:test');
const assert = require('node:assert/strict');

test('template tokens fill with date, time, and title', async () => {
  const { fillTemplate } = await import('../src/settings.ts');
  const now = new Date(2026, 8, 17, 9, 5, 7);
  assert.equal(fillTemplate('# {{title}}\n{{date}} {{time}} {{date:DD.MM.YYYY}} {{time:HH-mm-ss}}', 'Plan', now), '# Plan\n2026-09-17 09:05 17.09.2026 09-05-07');
});

test('canvas files parse and serialize in the JSON Canvas format', async () => {
  const { parseCanvas, serializeCanvas } = await import('../src/canvas.ts');
  const data = parseCanvas('{"nodes":[{"id":"a","type":"text","text":"Hi","x":0,"y":0,"width":200,"height":100},{"id":"b","type":"file","file":"Note.md","x":300,"y":0}],"edges":[{"id":"e","fromNode":"a","toNode":"b"},{"id":"bad","fromNode":"a","toNode":"zzz"}]}');
  assert.equal(data.nodes.length, 2);
  assert.equal(data.nodes[1].width, 250);
  assert.equal(data.edges.length, 1);
  assert.deepEqual(parseCanvas('not json'), { nodes: [], edges: [] });
  assert.ok(serializeCanvas(data).includes('"fromNode": "a"'));
});
