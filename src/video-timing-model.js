import {sameRecording} from "./recording-identity.js";
import {
  textPieces,
  isSpokenPiece,
  chapterPauses,
  pauseAssignments,
} from "./highlighter-model.js";
// Timing handoff. Script offsets and card/word IDs survive visible renumbering.
const uid = () =>
  `timing-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
export const ensureTiming = (p) =>
  (p.videoTiming ||= { version: 1, tracks: [] });
const norm = (s) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
function tokens(text) {
  if (globalThis.Intl?.Segmenter)
    return [
      ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
    ]
      .filter((x) => x.isWordLike)
      .map((x) => ({
        text: x.segment,
        from: x.index,
        to: x.index + x.segment.length,
        key: norm(x.segment),
      }));
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map(
    (x) => ({
      text: x[0],
      from: x.index,
      to: x.index + x[0].length,
      key: norm(x[0]),
    }),
  );
}
export function parseTiming(input, filename = "Timing JSON") {
  let r;
  try {
    r = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw Error("This is not a readable JSON file.");
  }
  if (
    !["whisperdesk-timing-v1", "subtitler-timing-v1"].includes(r?.format) ||
    r.schemaVersion !== 1 ||
    r.timeUnit !== "seconds"
  )
    throw Error(
      "Choose a Timing JSON exported by Subtitler. SRT does not contain original word timings.",
    );
  const duration = r.source?.duration;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
    throw Error("The recording duration must be between 0 and 24 hours.");
  if (
    !Array.isArray(r.words) ||
    r.words.length > 20000 ||
    (!r.words.length && !r.pauses?.length)
  )
    throw Error(
      "Choose a recording with 1–20,000 timed words; split longer recordings by chapter.",
    );
  const ids = new Set();
  let previous = -1;
  const words = r.words.map((w) => {
    if (
      !w ||
      typeof w.id !== "string" ||
      !w.id ||
      ids.has(w.id) ||
      typeof w.text !== "string" ||
      !w.text.trim() ||
      w.text.length > 1000 ||
      !Number.isFinite(w.start) ||
      !Number.isFinite(w.end) ||
      w.start < 0 ||
      w.start > duration ||
      w.end < w.start ||
      w.end > duration + 0.05 ||
      w.start < previous
    )
      throw Error(
        "The timing file contains invalid, duplicate, or out-of-order words. Export it again from Subtitler.",
      );
    ids.add(w.id);
    previous = w.start;
    return {
      id: w.id,
      text: w.text,
      gap: typeof w.gap === "string" ? w.gap.slice(0, 20) : " ",
      start: w.start,
      end: Math.min(duration, w.end),
      timing: [
        "whisper",
        "estimated",
        "manual",
        "aligned",
        "whisperx",
      ].includes(w.timing)
        ? w.timing
        : "estimated",
    };
  });
  const pauses = (Array.isArray(r.pauses) ? r.pauses : [])
    .filter(
      (p) =>
        p &&
        Number.isFinite(p.start) &&
        Number.isFinite(p.end) &&
        p.start >= 0 &&
        p.end > p.start &&
        p.end <= duration,
    )
    .map((p) => ({
      id: String(p.id || ""),
      markerId: p.markerId ? String(p.markerId) : null,
      chapterId: p.chapterId ? String(p.chapterId) : null,
      label: String(p.label || "Silence"),
      start: p.start,
      end: p.end,
    }));
  return {
    pauses,
    studioProjectId: r.studioProjectId || r.scriptProjectId || null,
    exportedAt: typeof r.exportedAt==="string"?r.exportedAt:null,
    chapterIds: Array.isArray(r.chapterIds) ? r.chapterIds : null,
    filename: String(filename).slice(0, 250),
    projectId: String(r.projectId || ""),
    source: {
      name: String(r.source.name || "Recording").slice(0, 250),
      duration,
      size: Number.isFinite(r.source.size) ? r.source.size : null,
      modified: r.source.modified || null,
      path: typeof r.source.path === "string" ? r.source.path : null,
      relativePath:
        typeof r.source.relativePath === "string"
          ? r.source.relativePath
          : null,
      fingerprint: r.source.fingerprint || null,
      channels: r.source.channels || null,
      sampleRate: r.source.sampleRate || null,
    },
    language: String(r.language || ""),
    words,
  };
}
export function scriptTokens(project, chapterIds) {
  const wanted = new Set(chapterIds),
    all = [];
  for (const ch of project.chapters || []) {
    if (!wanted.has(ch.id) || ch.unused) continue;
    const h = ch.highlighter;
    if (!h?.text) continue;
    const silent = textPieces(project, ch).filter(
      (piece) => !piece.pause?.manual && !isSpokenPiece(project, piece),
    );
    for (const t of tokens(h.text))
      if (!silent.some((r) => t.from < r.to && r.from < t.to))
        all.push({ ...t, chapterId: ch.id });
  }
  if (all.length > 20000)
    throw Error(
      "Match shorter recordings chapter by chapter (up to 20,000 spoken words per import).",
    );
  return all;
}
export function timingSignature(project, chapterIds) {
  const ids = new Set(chapterIds),
    assigned = new Set(
      (project.chapters || [])
        .filter((c) => ids.has(c.id))
        .flatMap((c) =>
          (c.highlighter?.assignments || []).map((a) => a.cardId),
        ),
    ),
    value = JSON.stringify({
      chapters: (project.chapters || [])
        .filter((c) => ids.has(c.id))
        .map((c) => [
          c.id,
          !!c.unused,
          c.highlighter?.text,
          c.highlighter?.marks
            ?.filter(
              (m) =>
                !project.highlighter?.categories?.find(
                  (c) => c.id === m.categoryId,
                )?.spoken,
            )
            .map((m) => [m.from, m.to]),
          chapterPauses(c.highlighter || {}).map((p) => [
            p.id,
            p.offset,
            p.from,
            p.to,
            p.cardId,
          ]),
          c.highlighter?.assignments?.map((a) => [
            a.id,
            a.from,
            a.to,
            a.cardId,
          ]),
        ]),
      cards: (project.stories || [])
        .filter((c) => assigned.has(c.id))
        .map((c) => [c.id, c.chapterId])
        .sort(),
    });
  let a = 2166136261;
  for (let i = 0; i < value.length; i++)
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
  return (a >>> 0).toString(16);
}
// Sparse LCS: monotonic exact-word alignment with insertion/deletion support.
// Bound pair count before allocating; repetitive recordings should be imported by chapter.
export function alignWords(script, spoken) {
  const positions = new Map();
  spoken.forEach((w, i) => {
    if (!positions.has(w.key)) positions.set(w.key, []);
    positions.get(w.key).push(i);
  });
  let count = 0;
  for (const s of script) count += (positions.get(s.key) || []).length;
  if (count > 1500000)
    throw Error(
      "This text is too long or repetitive for one match. Import a chapter-sized recording instead.",
    );
  const tails = [],
    nodes = [],
    links = [];
  for (let i = 0; i < script.length; i++) {
    const hits = positions.get(script[i].key) || [];
    for (let k = hits.length - 1; k >= 0; k--) {
      const j = hits[k];
      let low = 0,
        high = tails.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (tails[mid] < j) low = mid + 1;
        else high = mid;
      }
      if (tails[low] === j) continue;
      links.push({ i, j, prev: low ? nodes[low - 1] : -1 });
      tails[low] = j;
      nodes[low] = links.length - 1;
    }
  }
  const map = new Map();
  let index = nodes[tails.length - 1];
  while (index !== undefined && index >= 0) {
    const n = links[index];
    map.set(n.i, n.j);
    index = n.prev;
  }
  return map;
}
export function buildTiming(project, parsed, chapterIds) {
  const chapters = (project.chapters || []).filter(
    (c) => chapterIds.includes(c.id) && !c.unused,
  );
  if (!chapters.length)
    throw Error("Choose an active chapter with script text.");
  const script = scriptTokens(project, chapterIds);
  if (
    !script.length &&
    !chapters.some((ch) => pauseAssignments(project, ch).length)
  )
    throw Error("There is no Spoken text or assigned pause in this selection.");
  const spoken = parsed.words.flatMap((w, index) =>
      tokens(w.text).map((t) => ({ ...t, wordIndex: index })),
    ),
    mapping = alignWords(script, spoken),
    cards = new Map((project.stories || []).map((c) => [c.id, c])),
    cues = [];
  for (const ch of chapters)
    for (const a of [...(ch.highlighter?.assignments || [])].sort(
      (a, b) => a.from - b.from,
    )) {
      if (cards.get(a.cardId)?.chapterId !== ch.id) continue;
      const indices = script
          .map((s, i) =>
            s.chapterId === ch.id && s.from < a.to && s.to > a.from ? i : -1,
          )
          .filter((i) => i >= 0),
        hits = indices.filter((i) => mapping.has(i)),
        wordIndices = [
          ...new Set(hits.map((i) => spoken[mapping.get(i)].wordIndex)),
        ],
        matched = wordIndices.map((i) => parsed.words[i]);
      const issues = [];
      if (indices.length && !matched.length) issues.push("No matching words");
      else if (hits.length < indices.length)
        issues.push(
          `${indices.length - hits.length} script word(s) not matched`,
        );
      if (matched.some((w) => w.timing === "estimated" || w.end === w.start))
        issues.push("Estimated word timing");
      if (hits.length) {
        const first = mapping.get(hits[0]),
          last = mapping.get(hits[hits.length - 1]);
        if (last - first + 1 > hits.length)
          issues.push("Extra spoken words in this passage");
      }
      // Repeated wording is reviewable, even when monotonic context selects one occurrence.
      const keys = indices.map((i) => script[i].key);
      let occurrences = 0;
      if (keys.length)
        for (let i = 0; i <= spoken.length - keys.length; i++) {
          if (
            keys.every((k, j) => spoken[i + j].key === k) &&
            ++occurrences > 1
          )
            break;
        }
      if (occurrences > 1)
        issues.push("Repeated wording; check the occurrence");
      const pause = indices.length
        ? null
        : pauseAssignments(project, ch).find((p) => p.id === a.id)?.pause;
      const start = matched.length ? matched[0].start : null,
        matchedEnd = matched.length
          ? Math.max(...matched.map((w) => w.end))
          : null;
      cues.push({
        id: uid(),
        assignmentId: a.id,
        chapterId: ch.id,
        cardId: a.cardId,
        from: a.from,
        to: a.to,
        scriptText: ch.highlighter.text.slice(a.from, a.to),
        spokenText: indices.map((i) => script[i].text).join(" "),
        matchedText: matched.map((w) => w.text).join(" "),
        wordIds: matched.map((w) => w.id),
        coverage: indices.length ? hits.length / indices.length : 0,
        start,
        end: matchedEnd,
        matchedStart: start,
        matchedEnd,
        issues,
        reviewed: false,
        manual: false,
        pauseMarker: pause || null,
        excluded: !indices.length && !pause,
      });
    }
  // Manual zero-width pause cards are separate from text-range assignments.
  for (const ch of chapters)
    for (const a of pauseAssignments(project, ch).filter(
      (a) => a.pause.manual,
    )) {
      if (cards.get(a.cardId)?.chapterId !== ch.id) continue;
      cues.push({
        id: uid(),
        assignmentId: a.id,
        chapterId: ch.id,
        cardId: a.cardId,
        from: a.from,
        to: a.to,
        scriptText: "[" + a.pause.label + "]",
        spokenText: "",
        matchedText: "",
        wordIds: [],
        coverage: 1,
        start: null,
        end: null,
        matchedStart: null,
        matchedEnd: null,
        issues: [],
        reviewed: false,
        manual: false,
        excluded: false,
        pauseMarker: a.pause,
      });
    }
  const chOrder = new Map(chapters.map((c, i) => [c.id, i]));
  cues.sort(
    (a, b) =>
      chOrder.get(a.chapterId) - chOrder.get(b.chapterId) || a.from - b.from,
  );
  for (const c of cues.filter((c) => c.pauseMarker)) {
    const p = c.pauseMarker,
      before = script
        .map((s, i) => ({ s, i }))
        .filter(
          (x) =>
            x.s.chapterId === c.chapterId &&
            x.s.to <= p.from &&
            mapping.has(x.i),
        )
        .at(-1),
      after = script
        .map((s, i) => ({ s, i }))
        .find(
          (x) =>
            x.s.chapterId === c.chapterId &&
            x.s.from >= p.to &&
            mapping.has(x.i),
        );
    const left = before
        ? parsed.words[spoken[mapping.get(before.i)].wordIndex].end
        : 0,
      right = after
        ? parsed.words[spoken[mapping.get(after.i)].wordIndex].start
        : parsed.source.duration;
    const exact = (parsed.pauses || []).find(
      (g) =>
        g.markerId === p.id && (!g.chapterId || g.chapterId === c.chapterId),
    );
    const candidate =
      exact ||
      (parsed.pauses || [])
        .filter((g) => g.start >= left - 0.1 && g.end <= right + 0.1)
        .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (candidate || right > left + 0.02) {
      c.start = candidate?.start ?? left;
      c.end = candidate?.end ?? right;
      c.matchedStart = c.start;
      c.matchedEnd = c.end;
      c.kind = "pause";
      c.matchedText = "[" + p.label + "]";
      if (!candidate)
        c.issues.push("Pause estimated between surrounding words");
    } else c.issues.push("No recorded pause found at this marker");
  }
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start === null || c.excluded || c.kind === "pause") continue;
    const next = cues.slice(i + 1).find((x) => x.start !== null && !x.excluded);
    c.end = next ? next.start : parsed.source.duration;
    if (c.end <= c.start) {
      c.end = null;
      c.issues.push("Two cues start at the same word; set timing manually");
    }
  }
  const assigned = new Set(cues.flatMap((c) => c.wordIds));
  return {
    id: uid(),
    filename: parsed.filename,
    exportedAt: parsed.exportedAt || parsed.importedAt || new Date().toISOString(),
    projectId: parsed.projectId,
    source: parsed.source,
    language: parsed.language,
    words: parsed.words,
    pauses: parsed.pauses || [],
    studioProjectId: parsed.studioProjectId || null,
    chapterIds: chapters.map((c) => c.id),
    signature: timingSignature(
      project,
      chapters.map((c) => c.id),
    ),
    importedAt: new Date().toISOString(),
    cues,
    matchedWords: mapping.size,
    scriptWordCount: script.length,
    unassignedSpokenWords: parsed.words.filter((w) => !assigned.has(w.id))
      .length,
    audioAssetId: null,
    audioPath: parsed.source.path || null,
  };
}
export const timingStale = (project, track) =>
  track.signature !== timingSignature(project, track.chapterIds);
export function attachTiming(project, track, replace = false) {
  const data = ensureTiming(project),
    overlap = data.tracks.filter((t) =>
      t.chapterIds.some((id) => track.chapterIds.includes(id)),
    );
  if (overlap.length && !replace)
    throw Error(
      "These chapters already have timing. Review the replacement before continuing.",
    );
  data.tracks = data.tracks.filter((t) => !overlap.includes(t));
  data.tracks.push(track);
  return track;
}
export function saveCueTiming(track, id, start, end) {
  const cue = track.cues.find((c) => c.id === id);
  if (!cue) throw Error("Choose a cue first.");
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > track.source.duration
  )
    throw Error(
      `Use a start before the end, between 0 and ${track.source.duration.toFixed(3)} seconds.`,
    );
  const i = track.cues.indexOf(cue),
    prev = track.cues
      .slice(0, i)
      .reverse()
      .find((c) => !c.excluded && c.start !== null && c.end !== null),
    next = track.cues
      .slice(i + 1)
      .find((c) => !c.excluded && c.start !== null && c.end !== null);
  if (
    (prev && start < prev.end - 0.0001) ||
    (next && end > next.start + 0.0001)
  )
    throw Error(
      "This overlaps another cue. Shorten that cue first, or skip it.",
    );
  cue.start = start;
  cue.end = end;
  cue.manual = true;
  cue.reviewed = false;
}
export function reviewCue(project, track, id) {
  if (timingStale(project, track))
    throw Error(
      "The script links changed. Match again before reviewing timings.",
    );
  const c = track.cues.find((c) => c.id === id);
  if (!c || c.excluded || c.start === null || c.end === null)
    throw Error("Set a usable time range first.");
  c.reviewed = true;
}
export function cueStatus(project, track, cue) {
  return timingStale(project, track)
    ? "Script changed"
    : cue.excluded
      ? "Skipped"
      : cue.start === null || cue.end === null
        ? "Needs timing"
        : cue.reviewed
          ? "Reviewed"
          : cue.manual
            ? "Manual · review"
            : cue.issues.length
              ? "Check match"
              : "Suggested";
}
// A display number is never an identity. Keep edits only for the same source and unchanged passage.
export function rebuildTiming(
  project,
  old,
  parsed = old,
  chapterIds = old.chapterIds,
) {
  const built = buildTiming(project, parsed, chapterIds);
  built.id = old.id;
  built.audioAssetId = old.audioAssetId;
  built.audioPath = parsed.source?.path || old.audioPath || null;
  const sameAudio =
    sameRecording(old,parsed) || (!old.source.path&&!parsed.source.path&&!old.source.fingerprint&&!parsed.source.fingerprint&&old.source.name===parsed.source.name&&Math.abs(old.source.duration-parsed.source.duration)<0.001);
  if (sameAudio)
    for (const c of built.cues) {
      const prev = old.cues.find(
        (x) =>
          x.assignmentId === c.assignmentId &&
          x.cardId === c.cardId &&
          x.chapterId === c.chapterId &&
          x.from === c.from &&
          x.to === c.to &&
          x.spokenText === c.spokenText,
      );
      if (!prev) continue;
      c.id = prev.id;
      if (prev.manual) {
        Object.assign(c, {
          start: prev.start,
          end: prev.end,
          manual: true,
          reviewed: prev.reviewed,
          excluded: prev.excluded,
        });
      }
    }
  return built;
}
