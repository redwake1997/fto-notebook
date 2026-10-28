// FTO Notebook: text checks. Runs entirely on the device, no AI.
//   cleanup(text)        tidy spacing, capitalization, doubled words, end punctuation
//   expand(text)         spell out common shorthand (pt -> patient) for narratives
//   findFlags(text)      list possibly subjective words and phrases
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FTOText = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

// ---------- subjective-language flags ----------
// Each group: a short reason and the words or phrases it covers.
// Word matching is case-insensitive and whole-word. Add or remove terms here.
const FLAG_GROUPS = [
  {
    id: 'feelings',
    reason: 'Guesses what the Orientee felt or thought.',
    terms: ['seemed', 'seems', 'appeared', 'appears', 'nervous', 'anxious', 'scared', 'confused', 'overwhelmed',
      'flustered', 'frustrated', 'annoyed', 'upset', 'uncomfortable', 'unsure', "didn't care", 'did not care',
      'careless', 'unmotivated', 'uninterested', 'bored', 'was lost', 'looked lost', 'seemed lost'],
  },
  {
    id: 'judgment',
    reason: 'A judgment rather than an observation.',
    terms: ['good', 'great', 'excellent', 'amazing', 'awesome', 'perfect', 'solid', 'terrible', 'horrible', 'awful',
      'bad', 'poor', 'sloppy', 'weak', 'rough', 'a mess', 'nailed it', 'killed it', 'embarrassing'],
  },
  {
    id: 'label',
    reason: 'A personality label.',
    terms: ['lazy', 'attitude', 'attitude problem', 'arrogant', 'cocky', 'rude', 'disrespectful', 'shy', 'timid',
      'a natural', 'natural leader', 'natural at', 'personality'],
  },
  {
    id: 'firstperson',
    reason: 'States an opinion rather than what happened.',
    terms: ['I feel', 'I felt', 'I think', 'I thought', 'I believe', 'in my opinion', "I'm concerned", 'I am concerned',
      'I was impressed', 'I liked', "I didn't like", 'I did not like'],
  },
  {
    id: 'absolute',
    reason: 'An absolute or generalization. Describe the specific instance.',
    terms: ['always', 'never', 'every time', 'constantly', 'all the time', 'completely', 'totally'],
  },
  {
    id: 'vague',
    reason: 'Vague wording. Say exactly what happened.',
    terms: ['kind of', 'kinda', 'sort of', 'sorta', 'a bit', 'somewhat', 'basically', 'stuff', 'things'],
  },
  {
    id: 'slang',
    reason: 'Slang or unprofessional wording.',
    terms: ['dude', 'kid', 'lol', 'freaked out', 'zoned out', 'spaced out', 'clueless', 'dumb', 'stupid', 'crazy',
      'insane', 'idiot', 'fuck', 'fucking', 'fucked', 'shit', 'shitty', 'bullshit', 'damn', 'bitch', 'crap', 'asshole', 'pissed'],
  },
];
// "pretty good", "pretty bad": flagged only when "pretty" is used as a softener before a word.
const PRETTY = /\bpretty\s+(good|bad|well|poor|rough|solid|weak|great|decent|slow|fast|nervous|confused|okay|ok)\b/gi;
const SUGGESTION = 'Describe what you saw or heard instead.';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = FLAG_GROUPS.flatMap(g => g.terms.map(t => ({
  term: t,
  group: g.id,
  reason: g.reason,
  re: new RegExp(`(^|[^A-Za-z0-9'])(${esc(t).replace(/'/g, "['’]")})(?![A-Za-z0-9])`, 'gi'),
})));

// Returns [{ term, found, index, reason }] sorted by position, one entry per match.
// `ignore` = list of terms the FTO dismissed for this text.
function findFlags(text, ignore = []) {
  const s = String(text || '');
  const skip = new Set(ignore.map(t => t.toLowerCase()));
  const hits = [];
  for (const c of COMPILED) {
    if (skip.has(c.term.toLowerCase())) continue;
    c.re.lastIndex = 0;
    let m;
    while ((m = c.re.exec(s))) {
      hits.push({ term: c.term, found: m[2], index: m.index + m[1].length, reason: c.reason });
    }
  }
  PRETTY.lastIndex = 0;
  let m;
  while ((m = PRETTY.exec(s))) {
    if (!skip.has('pretty')) hits.push({ term: 'pretty', found: m[0], index: m.index, reason: 'Vague wording. Say exactly what happened.' });
  }
  // Drop matches inside a longer match (e.g. "attitude" inside "attitude problem").
  hits.sort((a, b) => a.index - b.index || b.found.length - a.found.length);
  const out = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.index < last.index + last.found.length) continue;
    out.push(h);
  }
  return out;
}

// Flags in free text, ignoring any words that are part of quoted guide objectives
// (the guide's own wording, e.g. "disrespectful", is never flagged).
function findFlagsExcluding(text, protectedPhrases = [], ignore = []) {
  let masked = String(text || '');
  for (const p of protectedPhrases) {
    if (!p) continue;
    let i = masked.indexOf(p);
    while (i >= 0) {
      masked = masked.slice(0, i) + ' '.repeat(p.length) + masked.slice(i + p.length);
      i = masked.indexOf(p, i + p.length);
    }
  }
  return findFlags(masked, ignore);
}

// ---------- abbreviation expansion (narratives only) ----------
const ABBREVIATIONS = [
  ['pts', 'patients'], ['pt', 'patient'], ['w/o', 'without'], ['w/', 'with'], ['b/c', 'because'], ['bc', 'because'],
  ['approx', 'approximately'], ['hx', 'history'], ['tx', 'treatment'], ['sx', 'symptoms'], ['c/o', 'complains of'],
  ['abd', 'abdominal'], ['neg', 'negative'], ['pos', 'positive'], ['eval', 'evaluation'], ['temp', 'temperature'],
  ['info', 'information'],
];
// Kept exactly as typed (standard terms that read fine in a narrative).
const KEEP = ['BP', 'HR', 'RR', 'SpO2', 'BGL', 'GCS', 'ALS', 'BLS', 'EKG', 'ECG', 'PPE', 'SMR', 'MVC', 'CHF', 'COPD',
  'ePCR', 'ED', 'ER', 'AMA', 'CPR', 'AED', 'NRB', 'NC', 'BVM', 'OPA', 'NPA', 'IV', 'IM', 'ASA', 'NTG', 'LOC', 'PERRL', 'JVD'];

function matchCase(found, repl) {
  return found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase()
    ? repl[0].toUpperCase() + repl.slice(1)
    : repl;
}

function expand(text) {
  let s = String(text || '');
  s = s.replace(/\b(was|is|were|are)\s+c\/o\b/gi, (all, v) => `${v} complaining of`);
  for (const [abbr, full] of ABBREVIATIONS) {
    const pat = esc(abbr);
    const tail = /[A-Za-z0-9]$/.test(abbr) ? '(?![A-Za-z0-9/])' : '';
    const re = new RegExp(`(^|[^A-Za-z0-9/])(${pat})${tail}`, 'gi');
    s = s.replace(re, (all, pre, found, offset, str) => {
      // All-caps short codes are left alone (e.g. "PT", "BC").
      if (found.length <= 3 && found === found.toUpperCase() && /[A-Z]/.test(found) && !found.includes('/')) return all;
      // "w/partner" -> "with partner"
      const next = str[offset + all.length] || '';
      const space = abbr.endsWith('/') && /[A-Za-z0-9]/.test(next) ? ' ' : '';
      return pre + matchCase(found, full) + space;
    });
  }
  // Only after a number: "5 min" -> "5 minutes", "2 hrs" -> "2 hours". "HR 110" stays.
  s = s.replace(/(^|[^\d.])(\d+)\s*(mins?|minutes?)\b/gi, (all, pre, d) => `${pre}${d} ${d === '1' ? 'minute' : 'minutes'}`);
  s = s.replace(/(^|[^\d.])(\d+)\s*(hrs?)\b/g, (all, pre, d) => `${pre}${d} ${d === '1' ? 'hour' : 'hours'}`);
  // Shortness of breath, so it can't be misread.
  s = s.replace(/(^|[^A-Za-z])(SOB|sob)(?![A-Za-z])/g, (all, pre) => pre + 'shortness of breath');
  return s;
}

// ---------- cleanup ----------
function cleanup(text) {
  let s = String(text || '').replace(/\r/g, '');
  s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  if (!s) return '';
  // Doubled words: "the the" -> "the"
  s = s.replace(/\b(the|a|an|to|and|of|in|on|at|is|was|with|for)\s+\1\b/gi, '$1');
  // Space after punctuation when followed by a letter (keeps 1,200 and 2.5 intact).
  // ("BP.then" -> "BP. then", but "e.g." stays: a single letter before the period is an abbreviation.)
  s = s.replace(/([,;:])(?=[A-Za-z])/g, '$1 ').replace(/([A-Za-z0-9]{2,}[.!?])(?=[A-Za-z])/g, '$1 ');
  // No space before punctuation.
  s = s.replace(/\s+([,.;:!?])/g, '$1');
  // Standalone lowercase "i" -> "I"
  s = s.replace(/(^|[^A-Za-z'.])i(?=[^A-Za-z.]|\.(?![A-Za-z])|$)/g, '$1I');
  // Capitalize the first letter of each sentence and line.
  s = s.replace(/(^|[.!?]\s+|\n)([a-z])/g, (all, pre, ch) => pre + ch.toUpperCase());
  // Role names are always written the same way.
  s = s.replace(/\borientees\b/gi, 'Orientees').replace(/\borientee\b/gi, 'Orientee').replace(/\bftos\b/gi, 'FTOs').replace(/\bfto\b/gi, 'FTO');
  // End with punctuation.
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

// What goes into a narrative from one of the FTO's notes.
function forNarrative(text) {
  return cleanup(expand(text));
}

return { findFlags, findFlagsExcluding, expand, cleanup, forNarrative, FLAG_GROUPS, ABBREVIATIONS, KEEP, SUGGESTION };
});
