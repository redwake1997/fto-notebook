// FTO Notebook: narrative drafting. Template-based, no AI.
// Three kinds of text go into a narrative:
//   1. Fixed sentence frames (written and proofread once, below)
//   2. Guide objectives, word for word (objective by design)
//   3. The FTO's notes, cleaned up and with shorthand spelled out (textcheck.js)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./textcheck.js'));
  else root.FTONarrative = factory(root.FTOText);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (T) {
'use strict';

function createNarrator(scorer) {
  const { getObjective, category, NOT_OBSERVED, MEETS } = scorer;

  const callLabel = id => (id === 'general' ? 'observations outside of calls' : `call ${id}`);
  const callTitle = id => (id === 'general' ? 'General' : `Call ${id}`);

  function listLabels(ids) {
    const labels = ids.map(callLabel);
    if (labels.length <= 1) return labels.join('');
    return labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1];
  }

  // "Uses proper body mechanics; communicates clearly with partner(s)"
  function joinObjectives(ids) {
    const texts = [...new Set(ids)].map(id => getObjective(id)).filter(Boolean).map(o => o.text);
    return texts.map((t, i) => (i > 0 && /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t)).join('; ');
  }

  function noteTexts(result, notes, callIds) {
    const want = new Set(callIds);
    const ids = new Set(result.callScores.filter(c => want.has(c.callId)).flatMap(c => c.noteIds));
    return notes.filter(n => ids.has(n.id) && (n.text || '').trim()).map(n => T.forNarrative(n.text));
  }

  function draftNarrative(result, notes) {
    const score = result.score;
    if (score === NOT_OBSERVED || typeof score !== 'number' || !result.callScores.length) return '';

    const parts = [];
    const setting = result.callScores.filter(c => result.settingCalls.includes(c.callId));
    const others = result.callScores.filter(c => !result.settingCalls.includes(c.callId));
    const allCalls = result.callScores.map(c => c.callId);
    const notesLine = ids => {
      const t = noteTexts(result, notes, ids);
      if (t.length) parts.push(`FTO notes: ${t.join(' ')}`);
    };

    if (score < MEETS && setting.some(c => c.ones.length)) {
      parts.push(`Score of ${score} reflects ${listLabels(result.settingCalls)}.`);
      for (const c of setting) {
        if (!c.ones.length) continue;
        const lead = setting.length > 1
          ? (c.callId === 'general' ? 'Outside of calls, below standard' : `On call ${c.callId}, below standard`)
          : 'Below standard';
        parts.push(`${lead}: ${joinObjectives(c.ones)}.`);
        notesLine([c.callId]);
      }
      if (others.length) {
        const good = joinObjectives(others.flatMap(c => [...c.fours, ...c.sevens]));
        const n = others.length;
        const where = others.some(c => c.callId === 'general')
          ? 'Elsewhere in this category'
          : `On the remaining ${n} ${n === 1 ? 'call' : 'calls'} in this category`;
        parts.push(`${where}, the Orientee met standard${good ? `: ${good}.` : '.'}`);
        const t = noteTexts(result, notes, others.map(c => c.callId));
        if (t.length) parts.push(`Examples: ${t.join(' ')}`);
      }
    } else if (score > MEETS && result.callScores.some(c => c.sevens.length)) {
      const exceeds = joinObjectives(result.callScores.flatMap(c => c.sevens));
      parts.push(`Score of ${score}. The Orientee exceeded standard in this category: ${exceeds}.`);
      notesLine(allCalls);
    } else if (score === MEETS) {
      const meets = joinObjectives(result.callScores.flatMap(c => c.fours));
      parts.push(`The Orientee met standard${meets ? `: ${meets}.` : '.'}`);
      notesLine(allCalls);
    } else {
      // The FTO set the score by hand; there are no recorded objectives to cite for it.
      parts.push(`Score of ${score}.`);
      notesLine(allCalls);
    }
    return parts.join('\n\n');
  }

  // Training Provided: every note marked "Something I taught".
  function draftTraining(notes) {
    return notes.filter(n => n.teaching && (n.text || '').trim()).map(n => `- ${T.forNarrative(n.text)}`).join('\n');
  }

  // Fingerprint of what a draft was built from, so the app can warn
  // "notes or score changed since you edited this" without overwriting the FTO's text.
  function draftBasis(result, notes) {
    const ids = new Set(result.callScores.flatMap(c => c.noteIds));
    const used = notes.filter(n => ids.has(n.id)).map(n => [n.id, n.text, (n.objectiveIds || []).join(','), (n.observedCategories || []).join(',')]);
    return JSON.stringify([result.score, used]);
  }

  // Subjective-language flags in a narrative, never counting the guide's own wording.
  function narrativeFlags(text, categoryId) {
    const cat = category(categoryId);
    const guideTexts = cat ? cat.objectives.flatMap(o => [o.text, o.text[0].toLowerCase() + o.text.slice(1)]) : [];
    return T.findFlagsExcluding(text, guideTexts);
  }

  return { draftNarrative, draftTraining, draftBasis, narrativeFlags, callLabel, callTitle };
}

return { createNarrator };
});
