import {modificationRoot} from './card-labels.js';
import {
  ensureProject,
  ensureChapter,
  setChapterText,
  clearChapterText,
  colorRange,
  insertLinkedCard,
  assignRange,
  removeAssignmentRange,
  splitAssignment,
  splitPoint,
  cardPassages,
  textPieces,
  trimRange,
  cardScriptRuns,
  nextExistingCard,
  advanceExistingCard,
  rewindFreedAssignments,
  highlightInk,
  isSpokenPiece,
  chapterPauses,
  reverseExpansionOrigin,
  wordSegments,
} from "./highlighter-model.js";
import { canImportDocx } from "./script-import-model.js";
import { exportAnnotatedDocx } from "./script-docx.js";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function styledText(text, mark, categories) {
  const c = categories.find((c) => c.id === mark?.categoryId);
  let out = esc(text);
  if (c?.style.includes("italic")) out = "<em>" + out + "</em>";
  if (c?.style.includes("bold")) out = "<strong>" + out + "</strong>";
  return out;
}
export function categoryStyle(mark, categories) {
  const c = categories.find((c) => c.id === mark?.categoryId);
  if (!c) return "";
  return `background-color:${c.color};color:${highlightInk(c.color)};${c.style.includes("italic") ? "font-style:italic!important;" : ""}${c.style.includes("bold") ? "font-weight:700!important;" : ""}`;
}
export function runsMarkup(project, runs) {
  return runs
    .map((r) => {
      const c = project.highlighter.categories.find(
        (c) => c.id === r.mark?.categoryId,
      );
      let text = esc(r.text);
      if (c?.style.includes("italic")) text = "<em>" + text + "</em>";
      if (c?.style.includes("bold")) text = "<strong>" + text + "</strong>";
      return `<span style="${categoryStyle(r.mark, project.highlighter.categories)}">${text}</span>`;
    })
    .join("");
}
export function createHighlighter(host) {
  const ui = {
    caret: 0,
    mode: "cards",
    category: "action",
    tool: "select",
    splitKind: "modify",
    focusedLink: null,
    intake: false,
    draft: "",
    managing: false,
    palette: false,
    help: false,
    categoryDraft: null,
    scroll: new Map(),
  };
  const project = () => host.project(),
    chapter = () => host.chapter();
  const config = () => ensureProject(project());
  const data = () => ensureChapter(chapter(), config().categories);
  const view = () => project().viewPrefs.hlView || "all";
  const assignmentMode = () => project().viewPrefs.hlAssignMode || "existing";
  let unmount = () => {};
  function commit(label, fn) {
    try {
      host.commit(label, () => {
        fn();
        project().modifiedAt = new Date().toISOString();
      });
    } catch (error) {
      host.notify(error.message);
      host.render();
    }
  }
  function documentMarkup(){
    const categories=config().categories,lines=[[]];let lastLink=null;
    for(const piece of textPieces(project(),chapter())){
      if(view()==="spoken"&&!piece.pause&&!isSpokenPiece(project(),piece))continue;
      if(piece.pause?.manual){lines.at(-1).push(`<span class="hl-pause-wrap"><button data-hl-pause="${esc(piece.pause.id)}">[${esc(piece.pause.label)}]</button></span>`);continue;}
      let used=0;const chunks=piece.text.split("\n");
      for(const [index,text] of chunks.entries()){
        if(index)lines.push([]);
        const from=piece.from+used,to=from+text.length,a=piece.assignment,first=a&&lastLink!==a.id;
        if(text){
          const badge=first?`<button type="button" class="hl-number" data-hl-badge="${esc(a.id)}" aria-label="Select card ${esc(host.number(a.cardId))}">${esc(host.number(a.cardId))}</button>`:"";
          lines.at(-1).push(`<span class="hl-piece ${a?'hl-assigned':''} ${a?.id===ui.focusedLink?'hl-focused':''}" ${a?`data-hl-link="${esc(a.id)}"`:''}>${badge}<span class="hl-run" data-hl-offset="${from}" data-hl-end="${to}" style="${piece.pause?'background:#d8e3f6;color:#294c75;font-style:italic;':categoryStyle(piece.mark,categories)}">${styledText(text,piece.mark,categories)}</span></span>`);
          lastLink=a?.id||null;
        }
        used+=text.length+(index<chunks.length-1?1:0);
        if(!text)lines.at(-1).push(`<span class="hl-empty-offset" data-hl-offset="${from}" data-hl-end="${to}"></span>`);
      }
    }
    return lines.map(xs=>`<div class="hl-line ${xs.every(x=>x.startsWith('<span class="hl-empty-offset"'))?'hl-blank-line':''}">${xs.join('')||'<br>'}</div>`).join('');
  }
  function managerMarkup() {
    const categories = ui.categoryDraft || config().categories;
    return `<section class="hl-category-manager"><div class="hl-section-title"><strong>Categories</strong><button type="button" data-hl-action="cancel-categories">Cancel</button></div><div class="hl-category-list">${categories.map((c) => `<div class="hl-category-row" data-hl-category-row="${esc(c.id)}"><input type="color" value="${c.color}" aria-label="${esc(c.name)} color" data-hl-field="color"><input value="${esc(c.name)}" maxlength="80" aria-label="Category name" data-hl-field="name"><div class="hl-category-styles"><label><input type="checkbox" data-hl-field="bold" ${c.style.includes("bold") ? "checked" : ""}>Bold</label><label><input type="checkbox" data-hl-field="italic" ${c.style.includes("italic") ? "checked" : ""}>Italic</label><label><input type="checkbox" data-hl-field="spoken" ${c.spoken ? "checked" : ""}>Spoken</label></div><button type="button" class="hl-category-delete" data-hl-delete-category="${esc(c.id)}" title="Delete ${esc(c.name)} category" aria-label="Delete ${esc(c.name)} category">×</button></div>`).join("")}</div><p class="hl-category-help">Deleting a category clears its highlights when saved. Undo restores them.</p><div class="hl-toolbar"><button type="button" data-hl-action="add-category">＋ Category</button><button type="button" class="hl-primary" data-hl-action="save-categories">Save categories</button></div></section>`;
  }
  function html({ expanded = false } = {}) {
    const p = project(),
      ch = chapter();
    if (!p || !ch)
      return '<div class="hl-panel-empty">Add a chapter to start highlighting.</div>';
    const h = data(),
      categories = config().categories;
    if (!categories.some((c) => c.id === ui.category))
      ui.category = categories[0]?.id || null;
    const next = nextExistingCard(p, ch),
      hasText = p.chapters.some((c) => !!c.highlighter?.text?.trim());
    const importButton = `<div class="hl-import-center"><button type="button" data-hl-action="import-docx" ${canImportDocx(p) ? "" : "disabled"} title="${canImportDocx(p) ? "Create or fill chapters from Heading 1/2 in a DOCX" : "Delete script text from every chapter and subchapter to enable DOCX import"}">Import DOCX</button><input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-hl-docx-file hidden></div>`;
    return `<section class="hl-panel ${ui.intake ? "hl-intaking" : ""} ${expanded ? "hl-expanded" : ""}" data-hl-root data-hl-chapter="${esc(ch.id)}">
      <div class="hl-mode" role="group" aria-label="Highlighter mode">${[
        ["read", "Read"],
        ["categories", "Categories"],
        ["cards", "Storyboard"],
      ]
        .map(
          ([mode, name]) =>
            `<button type="button" data-hl-mode="${mode}" aria-pressed="${ui.mode === mode}">${name}</button>`,
        )
        .join("")}</div>
      ${ui.mode === "categories" ? `<div class="hl-toolbar"><button type="button" class="hl-palette-toggle" data-hl-action="palette" aria-pressed="${ui.palette}" title="Choose a category"><span class="hl-color-swatch" style="background:${categories.find((c) => c.id === ui.category)?.color || "#ddd"}"></span>Palette</button><span class="hl-active-category">${esc(categories.find((c) => c.id === ui.category)?.name || "Add a category")}</span><button type="button" data-hl-action="categories" aria-pressed="${ui.managing}">Manage</button></div>${ui.palette ? `<div class="hl-palette" role="group" aria-label="Highlight palette">${categories.map((c) => `<button type="button" data-hl-color="${esc(c.id)}" aria-pressed="${ui.category === c.id}"><span style="background:${c.color}"></span>${esc(c.name)}</button>`).join("")}</div>` : ""}` : ui.mode === "cards" ? `<div class="hl-toolbar">${ui.tool !== "scissors" ? `<select data-hl-change="assignment-mode" aria-label="Storyboard assignment mode"><option value="new" ${assignmentMode() === "new" ? "selected" : ""}>Create blank cards</option><option value="existing" ${assignmentMode() === "existing" ? "selected" : ""}>Go to next when released</option></select>` : ""}<button type="button" class="hl-scissors-button" data-hl-action="scissors" aria-label="Scissors" aria-pressed="${ui.tool === "scissors"}" title="Click inside an assigned passage to split it into two cards">✂</button>${ui.tool === "scissors" ? `<select data-hl-change="split-kind" aria-label="Scissors creates"><option value="modify" ${ui.splitKind !== "blank" ? "selected" : ""}>Create slight modify card</option><option value="blank" ${ui.splitKind === "blank" ? "selected" : ""}>Create blank cards</option></select>` : ""}</div>${assignmentMode() === "existing" ? `<div class="hl-next-card" role="status">${next ? "Next: Card " + esc(host.number(next.id)) : "No more existing cards"}<small>Click a storyboard card to start from it.</small></div>` : ""}` : ""}
      ${ui.managing ? managerMarkup() : ""}
      ${h.text === null ? `<div class="hl-empty"><strong>This chapter is empty</strong><p>Add its text when you are ready. Other chapters keep their own progress.</p>${canImportDocx(p) ? importButton : ""}<button type="button" class="hl-primary" data-hl-action="paste">Paste chapter text</button><button type="button" data-hl-action="text-file">Import .txt</button><input type="file" accept=".txt,text/plain" data-hl-text-file hidden></div>` : `<div class="hl-scroll" data-hl-scroll><article class="hl-document ${ui.tool === "scissors" ? "hl-scissors" : ""} ${host.preferences().hlNumberPosition === "below" ? "hl-numbers-below" : ""}" data-hl-document contenteditable="false" tabindex="0" aria-label="Read-only chapter text" style="font-size:${host.preferences().hlFontSize || 16}px;--hl-blank-gap:${host.preferences().hlBlankSpacing ?? 0.5}">${documentMarkup()}</article></div>`}
      ${ui.intake ? `<div class="hl-intake"><label>Paste the body of this chapter<textarea data-hl-draft rows="8" placeholder="Paste chapter text here…">${esc(ui.draft)}</textarea></label><p>Accepting this text makes it read-only. Delete text lets you replace a chapter later.</p><div class="hl-toolbar"><button type="button" data-hl-action="cancel-paste">Cancel</button><button type="button" class="hl-primary" data-hl-action="accept-text">Use this text</button></div></div>` : ""}
      ${ui.help ? `<div class="hl-help" role="region" aria-label="Highlighter help"><strong>How Highlighter works</strong><p><b>Storyboard:</b> Forward selection assigns. Reverse selection from the chapter’s final word always unassigns. Elsewhere, reverse selection unassigns; start in the following card and include one complete word before crossing back to expand that card instead. Create blank cards adds a new card for each selection. Go to next when released uses existing cards in chapter order. Start inside a linked passage to expand that card’s text without advancing. It takes the selected text from other cards without deleting drawings.</p><p><b>Categories:</b> choose a palette color, then select forward to highlight or backward to clear that category. Enable Spoken in a category to include its highlighted words. Pause markers are handled separately from spoken words.</p><p><b>✂:</b> click inside linked text to split it into two cards. Text stays read-only. Use ⌘/Ctrl+Z to undo, or N/M if enabled in Shortcuts.</p></div>` : ""}
      <div class="hl-footer"><div class="hl-view-buttons" role="group" aria-label="Text view">${[
        ["spoken", "Spoken text"],
        ["all", "All text"],
      ]
        .map(
          ([key, label]) =>
            `<button type="button" data-hl-view="${key}" aria-pressed="${view() === key}">${label}</button>`,
        )
        .join(
          "",
        )}</div><button type="button" class="hl-info" data-hl-action="help" aria-label="Highlighter help" aria-expanded="${ui.help}">i</button></div>
      ${expanded ? `${h.text !== null && canImportDocx(p) ? importButton : ""}${hasText ? `<div class="hl-file-actions"><button type="button" data-hl-action="export" title="Export chapters with category highlights">Export DOCX</button><button type="button" class="hl-delete-text" data-hl-action="delete-text" ${h.text === null ? "disabled" : ""}>Delete text</button></div>` : ""}` : ""}
    </section>`;
  }
  function captureDraft(root) {
    if (ui.intake)
      ui.draft = root.querySelector("[data-hl-draft]")?.value ?? ui.draft;
    if (ui.managing && ui.categoryDraft)
      for (const row of root.querySelectorAll("[data-hl-category-row]")) {
        const c = ui.categoryDraft.find(
          (x) => x.id === row.dataset.hlCategoryRow,
        );
        if (!c) continue;
        for (const input of row.querySelectorAll("[data-hl-field]"))
          if (!["bold", "italic", "spoken"].includes(input.dataset.hlField))
            c[input.dataset.hlField] = input.value;
        const bold = row.querySelector("[data-hl-field=bold]").checked,
          italic = row.querySelector("[data-hl-field=italic]").checked;
        c.spoken = row.querySelector("[data-hl-field=spoken]").checked;
        c.style = bold
          ? italic
            ? "bold-italic"
            : "bold"
          : italic
            ? "italic"
            : "normal";
      }
  }
  function pointOffset(doc, node, offset) {
    if (!node || !doc.contains(node)) return null;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const run = el.closest?.("[data-hl-offset]");
    if (run && doc.contains(run)) {
      const r = document.createRange();
      r.selectNodeContents(run);
      r.setEnd(node, offset);
      return Number(run.dataset.hlOffset) + r.toString().length;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node.childNodes[offset];
      const next =
        child?.nodeType === Node.ELEMENT_NODE
          ? child.matches("[data-hl-offset]")
            ? child
            : child.querySelector("[data-hl-offset]")
          : null;
      if (next) return Number(next.dataset.hlOffset);
      const previous = node.childNodes[Math.max(0, offset - 1)];
      const runs =
        previous?.nodeType === Node.ELEMENT_NODE
          ? previous.matches("[data-hl-offset]")
            ? [previous]
            : previous.querySelectorAll("[data-hl-offset]")
          : [];
      if (runs.length) return Number(runs[runs.length - 1].dataset.hlEnd);
    }
    return null;
  }
  function selectionRange(doc) {
    const s = window.getSelection();
    if (!s || s.isCollapsed) return null;
    const anchor = pointOffset(doc, s.anchorNode, s.anchorOffset),
      head = pointOffset(doc, s.focusNode, s.focusOffset);
    if (anchor === null || head === null || anchor === head) return null;
    return {
      ...trimRange(data().text, Math.min(anchor, head), Math.max(anchor, head)),
      anchor,
      reverse: head < anchor,
    };
  }
  function caretOffset(doc, event) {
    if (document.caretPositionFromPoint) {
      const c = document.caretPositionFromPoint(event.clientX, event.clientY);
      return c ? pointOffset(doc, c.offsetNode, c.offset) : null;
    }
    const r = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    return r ? pointOffset(doc, r.startContainer, r.startOffset) : null;
  }
  async function handleSelection(doc, event, cutOffset = null) {
    if (event.target.closest?.("[data-hl-pause],[data-hl-pause-card]")) return;
    ui.caret = caretOffset(doc, event) ?? ui.caret;
    if (event.target.closest?.("[data-hl-badge]") || ui.mode === "read") return;
    if (ui.mode === "cards" && ui.tool === "scissors") {
      const offset = cutOffset ?? caretOffset(doc, event);
      if (offset === null) return;
      const a = data().assignments.find(
        (x) => offset > x.from && offset < x.to,
      );
      if (!a)
        return host.notify("Click between words inside an assigned passage.");
      const source = project().stories.find((c) => c.id === a.cardId);
      if (!source)
        return host.notify(
          "Move the linked card back to this chapter before splitting it.",
        );

      const pid = project().id,
        chapterId = chapter().id,
        signature = JSON.stringify(a);
      const prepared =
        ui.splitKind === "blank" ? null : await host.prepareModify(source);
      if (
        project()?.id !== pid ||
        chapter()?.id !== chapterId ||
        !data().assignments.some((x) => JSON.stringify(x) === signature)
      )
        return;
      commit("Split storyboard passage", () => {
        const b = splitAssignment(
          project(),
          chapter(),
          a.id,
          offset,
          prepared
            ? (chapterId) => ({
                ...host.createCard(chapterId, prepared.assetId),
                modifiedOf: modificationRoot(project(),source).id,modifiedBaseId:modificationRoot(project(),source).id,modifiedBaseNumber:source.modifiedBaseNumber,modifiedBaseGlobalNumber:source.modifiedBaseGlobalNumber,
                modifiedSourceNumber: host.number(source.id),
              })
            : host.createCard,
        );
        ui.focusedLink = b.id;
        host.selectCard(b.cardId);
      });
      return;
    }
    ui.caret = caretOffset(doc, event) ?? ui.caret;
    let range;
    try {
      range = selectionRange(doc);
    } catch {
      return;
    }
    if (!range) return;
    const lastVisibleWordFrom=view()==="spoken"?textPieces(project(),chapter()).filter(r=>!r.pause&&isSpokenPiece(project(),r)).flatMap(r=>wordSegments(r.text).map(w=>r.from+w.from)).at(-1):null;
    const reverseOrigin=range.reverse?reverseExpansionOrigin(chapter(),range.anchor,Math.min(range.from,range.to),lastVisibleWordFrom):null;
    // Filtering changes visibility, never the offsets of hidden annotations.
    const visible =
      view() === "spoken"
        ? textPieces(project(), chapter())
            .filter(
              (r) =>
                !r.pause?.manual &&
                (r.pause || isSpokenPiece(project(), r)) &&
                r.to > range.from &&
                r.from < range.to,
            )
            .map((r) => ({
              from: Math.max(range.from, r.from),
              to: Math.min(range.to, r.to),
            }))
        : [range];
    if (ui.mode === "categories")
      commit(
        range.reverse ? "Remove category highlight" : "Highlight category",
        () => {
          for (const r of visible)
            if (data().text.slice(r.from, r.to).trim())
              colorRange(
                project(),
                chapter(),
                r.from,
                r.to,
                ui.category,
                range.reverse,
              );
        },
      );
    else if (range.reverse && !reverseOrigin)
      commit("Remove storyboard assignment", () => {
        for (const r of visible)
          if (data().text.slice(r.from, r.to).trim())
            removeAssignmentRange(chapter(), r.from, r.to);
        ui.focusedLink = null;
      });
    else
      commit("Assign storyboard passage", () => {
        const beforeAssignments=structuredClone(data().assignments);
        const origin = reverseOrigin || data().assignments.find(
          (a) => range.anchor >= a.from && range.anchor < a.to,
        );
        const next =
          assignmentMode() === "existing"
            ? nextExistingCard(project(), chapter())
            : null;
        if (!origin && assignmentMode() === "existing" && !next)
          throw Error(
            "No more existing cards. Click a storyboard card to start from it, or choose Create blank cards.",
          );
        let a = origin,
          cardId = origin?.cardId || next?.id || null;
        for (const r of visible) {
          if (!data().text.slice(r.from, r.to).trim()) continue;
          a = cardId
            ? assignRange(chapter(), r.from, r.to, cardId, origin?.id)
            : insertLinkedCard(
                project(),
                chapter(),
                r.from,
                r.to,
                host.createCard,
              );
          cardId = a.cardId;
        }
        if (a) {
          if (!origin && assignmentMode() === "existing")
            advanceExistingCard(project(), chapter(), a.cardId);
          ui.focusedLink = a.id;
          host.selectCard(a.cardId);
        }
        if(assignmentMode()==="existing")rewindFreedAssignments(chapter(),beforeAssignments);
      });
    window.getSelection()?.removeAllRanges();
  }
  async function act(action, root) {
    captureDraft(root);

    if (action === "import-docx") {
      if (canImportDocx(project()))
        root.querySelector("[data-hl-docx-file]")?.click();
      return;
    }

    if (action === "paste") {
      ui.intake = true;
      ui.draft = "";
      host.render();
      document.querySelector("[data-hl-draft]")?.focus();
      return;
    }
    if (action === "cancel-paste") {
      ui.intake = false;
      ui.draft = "";
      host.render();
      return;
    }
    if (action === "text-file") {
      root.querySelector("[data-hl-text-file]")?.click();
      return;
    }
    if (action === "accept-text") {
      if (!ui.draft.trim())
        return host.notify("Paste some chapter text first.");
      commit("Import read-only chapter text", () => {
        setChapterText(chapter(), ui.draft);
        ui.intake = false;
        ui.draft = "";
      });
      return;
    }
    if (action === "delete-text") {
      host.confirmDelete(() =>
        commit("Delete chapter text", () => {
          clearChapterText(chapter());
          ui.focusedLink = null;
          ui.intake = false;
        }),
      );
      return;
    }
    if (action === "export") {
      host.chooseExport(async (view) => {
        try {
          if (await exportAnnotatedDocx(project(), host.chapterLabel, view))
            host.notify("DOCX export complete");
        } catch (e) {
          host.notify(e.message);
        }
      });
      return;
    }
    if (action === "scissors") {
      ui.mode = "cards";
      ui.tool = ui.tool === "scissors" ? "select" : "scissors";
      host.render();
      return;
    }
    if (action === "palette") {
      ui.palette = !ui.palette;
      host.render();
      return;
    }
    if (action === "help") {
      ui.help = !ui.help;
      host.render();
      return;
    }
    if (action === "categories") {
      ui.managing = !ui.managing;
      ui.categoryDraft = ui.managing
        ? structuredClone(config().categories)
        : null;
      host.render();
      return;
    }
    if (action === "cancel-categories") {
      ui.managing = false;
      ui.categoryDraft = null;
      host.render();
      return;
    }
    if (action === "add-category") {
      ui.categoryDraft.push({
        id: "category-" + crypto.randomUUID(),
        name: "New category",
        color: "#e4eabf",
        style: "normal",
      });
      host.render();
      return;
    }
    if (action === "save-categories") {
      if (ui.categoryDraft.some((c) => !c.name.trim()))
        return host.notify("Give every category a name.");
      const categories = structuredClone(ui.categoryDraft).map((c) => ({
        ...c,
        name: c.name.trim(),
      }));
      commit("Edit highlight categories", () => {
        project().highlighter.categories = categories;
        ensureProject(project());
        ui.managing = false;
        ui.categoryDraft = null;
      });
    }
  }
  function mount() {
    unmount();
    const cleanups = [];
    for (const root of document.querySelectorAll("[data-hl-root]")) {
      const scroll = root.querySelector("[data-hl-scroll]"),
        key = host.project().id + ":" + root.dataset.hlChapter;
      if (scroll) {
        scroll.scrollTop = ui.scroll.get(key) || 0;
        scroll.addEventListener(
          "scroll",
          () => ui.scroll.set(key, scroll.scrollTop),
          { passive: true },
        );
      }
      root.addEventListener('contextmenu',e=>{const piece=e.target.closest('[data-hl-link]');const a=chapter().highlighter.assignments.find(a=>a.id===piece?.dataset.hlLink);if(a){e.preventDefault();host.assignedContext?.(e,a.cardId);}});
      for (const type of [
        "pointerdown",
        "click",
        "dblclick",
        "contextmenu",
        "input",
        "change",
      ])
        root.addEventListener(type, (e) => e.stopPropagation());

      root.addEventListener("click", (e) => {
        const marker = e.target.closest("[data-hl-pause],[data-hl-pause-card]");
        if (!marker) return;
        e.preventDefault();
        const pause = data().pauses?.find(
          (p) =>
            p.id === (marker.dataset.hlPause || marker.dataset.hlPauseCard),
        );
        if (!pause) return;
        if (ui.mode !== "cards" || pause.cardId) {
          if (pause.cardId) host.selectCard(pause.cardId);
          return;
        }
        commit("Assign pause to card", () => {
          const c =
            assignmentMode() === "existing"
              ? nextExistingCard(project(), chapter())
              : host.createCard(chapter().id);
          if (!c) throw Error("No more existing cards.");
          if (assignmentMode() !== "existing") {
            const next = data().assignments.find((a) => a.from >= pause.offset),
              previous = data()
                .assignments.filter((a) => a.to <= pause.offset)
                .at(-1);
            let index = next
              ? project().stories.findIndex((c) => c.id === next.cardId)
              : previous
                ? project().stories.findIndex((c) => c.id === previous.cardId) +
                  1
                : project().stories.length;
            project().stories.splice(Math.max(0, index), 0, c);
          }
          pause.cardId = c.id;
          if (assignmentMode() === "existing")
            advanceExistingCard(project(), chapter(), c.id);
          host.selectCard(c.id);
        });
      });
      root.addEventListener("input", () => captureDraft(root));
      root.addEventListener("keydown", (e) => {
        if (e.target.matches("textarea,input,select")) {
          e.stopPropagation();
          return;
        }
        const k = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && ["z", "y"].includes(k)) return;
        if (
          host.preferences().altUndoKeys &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          ["n", "m"].includes(k)
        ) {
          e.preventDefault();
          e.stopPropagation();
          k === "n" ? host.undo() : host.redo();
          return;
        }
        if (e.key === "Escape") {
          ui.tool = "select";
          ui.focusedLink = null;
          window.getSelection()?.removeAllRanges();
          host.render();
        }
        if (e.key !== "Tab") e.stopPropagation();
      });
      const cutGuide = document.createElement("div");
      cutGuide.className = "hl-cut-guide";
      cutGuide.hidden = true;
      cutGuide.setAttribute("aria-hidden", "true");
      document.body.append(cutGuide);
      cleanups.push(() => cutGuide.remove());
      root.addEventListener("pointermove", (e) => {
        cutGuide.hidden = true;
        if (ui.mode !== "cards" || ui.tool !== "scissors") return;
        const doc = root.querySelector("[data-hl-document]");
        if (!doc?.contains(e.target)) return;
        const offset = caretOffset(doc, e),
          h = data(),
          a = h.assignments.find((a) => offset > a.from && offset < a.to);
        if (!a) return;
        let split;
        try {
          split = splitPoint(chapter(), a.id, offset).offset;
        } catch {
          return;
        }
        const run = [...doc.querySelectorAll("[data-hl-offset]")].find(
          (r) => split >= +r.dataset.hlOffset && split < +r.dataset.hlEnd,
        );
        if (!run?.firstChild) return;
        const range = document.createRange(),
          local = split - +run.dataset.hlOffset;
        const walk = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
        let node = walk.nextNode(),
          left = local;
        while (node && left >= node.length) {
          left -= node.length;
          node = walk.nextNode();
        }
        if (!node) return;
        range.setStart(node, left);
        range.setEnd(node, Math.min(node.length, left + 1));
        const rect = range.getBoundingClientRect();
        cutGuide.hidden = false;
        cutGuide.style.left = rect.left + "px";
        cutGuide.style.top = rect.top - 2 + "px";
        cutGuide.style.height = rect.height + 4 + "px";
        cutGuide.dataset.offset = split;
      });
      root.addEventListener("pointerleave", () => (cutGuide.hidden = true));
      let pointerStarted = false, cutting = false;
      root.addEventListener("pointerdown", (e) => {
        pointerStarted =
          e.button === 0 &&
          !!e.target.closest("[data-hl-document]") &&
          !e.target.closest("[data-hl-badge]");
        if(pointerStarted && ui.mode === "cards" && ui.tool === "scissors"){
          e.preventDefault();pointerStarted=false;if(cutting)return;
          const doc=root.querySelector('[data-hl-document]');doc.focus({preventScroll:true});
          const offset=caretOffset(doc,e);cutting=true;
          handleSelection(doc,e,offset).catch(error=>host.notify(error.message||String(error))).finally(()=>{cutting=false;});return;
        }
        if (!pointerStarted && !e.target.closest("input,textarea,select")) {
          window.getSelection()?.removeAllRanges();
          e.preventDefault();
        }
      });
      const constrain = () => {
        if (!pointerStarted) return;
        const doc = root.querySelector("[data-hl-document]"),
          s = window.getSelection();
        if (!s || !doc?.contains(s.anchorNode) || doc.contains(s.focusNode))
          return;
        const backwards = !!(
          s.anchorNode.compareDocumentPosition(s.focusNode) &
          Node.DOCUMENT_POSITION_PRECEDING
        );
        const runs = doc.querySelectorAll("[data-hl-offset]"),
          run = backwards ? runs[0] : runs[runs.length - 1];
        if (run?.firstChild)
          s.setBaseAndExtent(
            s.anchorNode,
            s.anchorOffset,
            run.firstChild,
            backwards ? 0 : run.textContent.length,
          );
      };
      const up = (e) => {
        if (pointerStarted) {
          constrain();
          pointerStarted = false;
          const doc = root.querySelector("[data-hl-document]");
          if (doc)
            handleSelection(doc, e).catch((e) =>
              host.notify(e.message || String(e)),
            );
        }
      };
      document.addEventListener("pointerup", up);
      document.addEventListener("selectionchange", constrain);
      cleanups.push(() => {
        document.removeEventListener("pointerup", up);
        document.removeEventListener("selectionchange", constrain);
      });
      root.addEventListener("click", (e) => {
        const badge = e.target.closest("[data-hl-badge]");
        if (badge) {
          ui.focusedLink = badge.dataset.hlBadge;
          const a = data().assignments.find((a) => a.id === ui.focusedLink);
          if (a) host.selectCard(a.cardId);
          host.render();
          return;
        }
        const mode = e.target.closest("[data-hl-mode]");
        if (mode) {
          captureDraft(root);
          ui.mode = mode.dataset.hlMode;
          ui.tool = "select";
          host.render();
          return;
        }
        const color = e.target.closest("[data-hl-color]");
        if (color) {
          ui.category = color.dataset.hlColor;
          ui.mode = "categories";
          host.render();
          return;
        }
        const filter = e.target.closest("[data-hl-view]");
        if (filter) {
          commit("Change text view", () => {
            project().viewPrefs.hlView = filter.dataset.hlView;
          });
          return;
        }
        const del = e.target.closest("[data-hl-delete-category]");
        if (del) {
          ui.categoryDraft = ui.categoryDraft.filter(
            (c) => c.id !== del.dataset.hlDeleteCategory,
          );
          host.render();
          return;
        }
        const b = e.target.closest("[data-hl-action]");
        if (b) {
          e.preventDefault();
          act(b.dataset.hlAction, root).catch((error) =>
            host.notify(error.message),
          );
        }
      });
      root.addEventListener("change", async (e) => {
        if (e.target.dataset.hlChange === "split-kind") {
          ui.splitKind = e.target.value;
          return;
        }
        if (e.target.hasAttribute("data-hl-docx-file")) {
          const file = e.target.files?.[0];
          if (file) await host.importDocx(file);
          return;
        }
        if (e.target.hasAttribute("data-hl-text-file")) {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024)
            return host.notify("Choose a text file smaller than 2 MB.");
          try {
            ui.draft = await file.text();
            ui.intake = true;
            host.render();
          } catch (error) {
            host.notify(error.message);
          }
          return;
        }
        const kind = e.target.dataset.hlChange,
          value = e.target.value;
        if (!kind) return;
        captureDraft(root);
        if (kind === "assignment-mode") {
          ui.tool = "select";
          project().viewPrefs.hlAssignMode = value;
          host.save();
          host.render();
          return;
        }
      });
    }
    unmount = () => cleanups.forEach((fn) => fn());
  }
  function caption(cardId, { quick = false } = {}) {
    const passages = cardPassages(project(), cardId),
      runs = cardScriptRuns(project(), cardId, view());
    if (!passages.length || !runs.some((r) => r.text.trim())) return "";
    const a = passages[0];
    return `<div class="hl-card-passages" style="--hl-caption-size:${host.preferences().hlCaptionSize || 14}px">${quick ? `<div class="hl-card-passage">${runsMarkup(project(), runs)}</div>` : `<button type="button" class="hl-card-passage" data-hl-jump="${esc(a.assignmentId)}" data-hl-chapter="${esc(a.chapterId)}" aria-label="Show linked passage" title="Reveal this passage in Highlighter">${runsMarkup(project(), runs)}</button>`}</div>`;
  }
  function reveal(chapterId, assignmentId) {
    ui.focusedLink = assignmentId;
    ui.intake = false;
    host.showPanel(chapterId);
    host.render();
    document
      .querySelector(
        `[data-hl-link="${CSS.escape(assignmentId)}"],[data-hl-pause="${CSS.escape(assignmentId)}"]`,
      )
      ?.scrollIntoView({ block: "center", behavior: "auto" });
  }
  function chapterChanged() {
    ui.caret = 0;
    ui.focusedLink = null;
    ui.intake = false;
    ui.draft = "";
  }
  function chooseCard(cardId) {
    if (assignmentMode() !== "existing") return;
    if (
      !project().stories.some(
        (c) => c.id === cardId && c.chapterId === chapter().id,
      )
    )
      return;
    data().nextExistingCardId = cardId;
    host.save();
    host.render();
  }
  return { html, mount, caption, reveal, chapterChanged, chooseCard, ui,closeHelp:()=>{ui.help=false;document.querySelectorAll('.hl-help').forEach(el=>el.remove());} };
}
