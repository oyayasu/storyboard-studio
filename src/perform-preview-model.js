import { recordingOrder, exportOptions } from "./timeline-export-model.js";
export function previewSegments(project, chapterId = "all") {
  const cards = new Map(project.stories.map((c) => [c.id, c.chapterId])),
    chapters = new Set(
      project.chapters.filter((ch) => !ch.unused).map((ch) => ch.id),
    );
  return recordingOrder(project, exportOptions(project)).flatMap((track) => {
    const valid = (track.cues || [])
      .filter(
        (c) =>
          !c.excluded &&
          Number.isFinite(c.start) &&
          Number.isFinite(c.end) &&
          c.end > c.start &&
          cards.get(c.cardId) === c.chapterId &&
          chapters.has(c.chapterId),
      )
      .sort((a, b) => a.start - b.start);
    if (chapterId === "all")
      return [{ track, start: 0, end: track.source.duration, cues: valid }];
    const cues = valid.filter((c) => c.chapterId === chapterId);
    if (!cues.length) return [];
    const start = cues[0].start,
      last = cues.at(-1),
      following = valid.find(
        (c) => c.start >= last.end && c.chapterId !== chapterId,
      );
    return [
      {
        track,
        start,
        end: Math.min(track.source.duration, following?.start ?? last.end),
        cues,
      },
    ];
  });
}
export function previewCueAt(segment, time) {
  return segment?.cues.find((c) => time + 0.00001 >= c.start && time < c.end - 0.00001) || null;
}

export function chapterFlags(segments,project){
 const out=[];let offset=0;
 for(const s of segments){const seen=new Set();for(const cue of s.cues){if(seen.has(cue.chapterId))continue;seen.add(cue.chapterId);out.push({chapterId:cue.chapterId,title:project.chapters.find(c=>c.id===cue.chapterId)?.name||"Chapter",time:offset+Math.max(0,cue.start-s.start)});}offset+=s.end-s.start;}return out;
}
