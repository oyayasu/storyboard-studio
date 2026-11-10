// Smoke tests for Storyboard Studio v0.4.0 state, no npm dependencies.
import assert from 'node:assert/strict';
const data = new Map();
globalThis.localStorage = {
  getItem: key => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
};
globalThis.document = { dispatchEvent() {} };

const state = await import('../src/state.js');
const { store, newProject, gridPreset, defaultGridByRatio, KEY } = state;
assert.equal(KEY, 'storyboardStudio.next.v03.state');
assert.equal(store.state.projects.length, 0);
assert.equal(defaultGridByRatio()['16:9'].cols, 3);
assert.deepEqual(gridPreset(store.state.settings,'9:16'), { cols: 4, rows: 3 });

store.change('Create test project', s => {
  s.projects.push(newProject('Smoke Test', '16:9'));
});
assert.equal(store.state.projects.length, 1);
assert.equal(store.state.projects[0].name, 'Smoke Test');
assert.equal(store.state.projects[0].viewPrefs.gridCols, 3);
assert.equal(JSON.parse(data.get(KEY)).projects.length, 1);

store.change('Set custom grid', s => {
  s.settings.gridByRatio['9:16'] = { cols: 5, rows: 6 };
});
const future = newProject('New portrait project', '9:16');
assert.deepEqual([future.viewPrefs.gridCols, future.viewPrefs.gridRows], [5, 6]);
assert.deepEqual(gridPreset(store.state.settings, '16:9'), {cols: 3, rows: 4});
store.undoNow();
assert.deepEqual(gridPreset(store.state.settings, '9:16'), {cols: 4, rows: 3});
store.redoNow();
assert.deepEqual(gridPreset(store.state.settings, '9:16'), {cols: 5, rows: 6});
assert.equal(store.state.projects[0].viewPrefs.gridCols, 3, 'existing project settings preserved');
console.log('PASS: project creation, autosave, undo/redo, future grid presets and unchanged stored identity.');
