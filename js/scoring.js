// FTO Notebook: scoring rules. Pure and deterministic, no AI.
// The evaluation guide is NOT part of this app; it's loaded from the FTO's own file at runtime.
//
// Per call, per category:
//   - Start at 4 (meets standard).
//   - Any 1-level objective: minus 1 per DISTINCT 1-level objective, lowest 1.
//     No upward credit on that call (a 7 assumes everything at 4 plus more).
//   - Otherwise: plus 1 per DISTINCT 7-level objective, highest 7.
//   - 4-level objectives never offset 1-level ones. Unobserved objectives are neutral.
// For the day, per category:
//   - Day score = LOWEST call score. Repeats across calls don't stack.
//   - Nothing recorded in a category = "Not Observed".
//   - Notes under "General" (not during a call) count as their own call.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FTOScoring = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const NOT_OBSERVED = 'Not Observed';

// Checks a guide file before it's saved on the device. Returns a list of problems (empty = OK).
function validateGuide(g) {
  const p = [];
  if (!g || typeof g !== 'object') return ['The file is not a guide file.'];
  if (g.format !== 'fto-notebook-guide') p.push('This is not an FTO Notebook guide file.');
  if (!Array.isArray(g.categories) || !g.categories.length) p.push('The guide has no categories.');
  const seen = new Set();
  for (const c of g.categories || []) {
    if (!Number.isInteger(c.id) || !c.name || !Array.isArray(c.objectives)) { p.push(`Category ${c.id || '?'} is incomplete.`); continue; }
    for (const o of c.objectives) {
      if (!o.id || ![1, 4, 7].includes(o.level) || !o.text) p.push(`An objective in category ${c.id} is incomplete.`);
      if (seen.has(o.id)) p.push(`Objective ${o.id} appears twice.`);
      seen.add(o.id);
    }
  }
  return p;
}

function createScorer(guide) {
  const MIN = (guide.scale && guide.scale.min) || 1;
  const MEETS = (guide.scale && guide.scale.meets) || 4;
  const MAX = (guide.scale && guide.scale.max) || 7;

  const index = new Map();
  for (const cat of guide.categories) {
    for (const o of cat.objectives) index.set(o.id, { ...o, categoryId: cat.id });
  }
  const category = id => guide.categories.find(c => c.id === Number(id));
  const getObjective = id => index.get(id) || null;

  // Score one call in one category from the objective IDs recorded on it.
  function scoreCall(objectiveIds) {
    const unique = [...new Set(objectiveIds)].map(getObjective).filter(Boolean);
    const ones = unique.filter(o => o.level === 1).map(o => o.id);
    const fours = unique.filter(o => o.level === 4).map(o => o.id);
    const sevens = unique.filter(o => o.level === 7).map(o => o.id);
    const score = ones.length ? Math.max(MIN, MEETS - ones.length) : Math.min(MAX, MEETS + sevens.length);
    return { score, ones, fours, sevens };
  }

  // notes: [{ id, callId, text, objectiveIds: [], observedCategories: [] }]
  // overrides: { [categoryId]: number | "Not Observed" }  (the FTO's own score wins)
  function scoreShift(notes, overrides = {}) {
    const byCat = new Map();
    const touch = (catId, callId, noteId) => {
      if (!byCat.has(catId)) byCat.set(catId, new Map());
      const calls = byCat.get(catId);
      if (!calls.has(callId)) calls.set(callId, { ids: new Set(), noteIds: new Set() });
      const c = calls.get(callId);
      c.noteIds.add(noteId);
      return c;
    };
    for (const n of notes) {
      const callId = n.callId == null ? 'general' : String(n.callId);
      for (const oid of n.objectiveIds || []) {
        const o = getObjective(oid);
        if (o) touch(o.categoryId, callId, n.id).ids.add(oid);
      }
      for (const cid of n.observedCategories || []) {
        if (category(cid)) touch(Number(cid), callId, n.id);
      }
    }

    return guide.categories.map(cat => {
      const calls = byCat.get(cat.id);
      let computed = NOT_OBSERVED;
      let callScores = [];
      let settingCalls = [];
      if (calls && calls.size) {
        callScores = [...calls.entries()].map(([callId, c]) => ({ callId, noteIds: [...c.noteIds], ...scoreCall([...c.ids]) }));
        computed = Math.min(...callScores.map(c => c.score));
        settingCalls = callScores.filter(c => c.score === computed).map(c => c.callId);
      }
      const overridden = Object.prototype.hasOwnProperty.call(overrides, cat.id);
      const score = overridden ? overrides[cat.id] : computed;
      return {
        categoryId: cat.id,
        name: cat.name,
        label: cat.label || `${cat.id}) ${cat.name}`,
        section: cat.section || '',
        score,
        computedScore: computed,
        overridden,
        settingCalls,
        callScores,
        narrativeRequired: typeof score === 'number' && score < MEETS,
        narrativeDefaultOn: typeof score === 'number' && score !== MEETS,
      };
    });
  }

  return { guide, MEETS, NOT_OBSERVED, category, getObjective, scoreCall, scoreShift };
}

return { createScorer, validateGuide, NOT_OBSERVED };
});
