import { readDocx } from "./docx-reader.js";
import {
  canImportDocx,
  suggestChapterTargets,
  matchingChapters,
  applyDocxImport,
  chapterMatchLabel,
} from "./script-import-model.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function createDocxIntake(host) {
  let pending = null,
    request = 0;
  function html() {
    const project = host.project(),
      { parsed, mapping, filename } = pending;
    return `<p class="docx-filename">${esc(filename)}</p><p>Heading 1 creates chapters; Heading 2 creates subchapters. Text becomes read-only. Existing drawings and card notes stay in their matched chapters.</p><div class="docx-chapter-list">${parsed.sections
      .map(
        (section) =>
          `<section class="docx-chapter ${section.level === 2 ? "docx-subchapter" : ""}"><strong>${esc(section.name)}</strong><span>${section.text.length.toLocaleString()} characters · ${section.marks.length} colored ${section.marks.length === 1 ? "annotation" : "annotations"}</span><label>Import into<select data-docx-target="${esc(section.key)}"><option value="new" ${mapping[section.key] === "new" ? "selected" : ""}>Create ${section.level === 2 ? "subchapter" : "chapter"}</option>${matchingChapters(
            project,
            section,
            mapping,
          )
            .map(
              (ch) =>
                `<option value="${esc(ch.id)}" ${mapping[section.key] === ch.id ? "selected" : ""}>${esc(chapterMatchLabel(project, ch))}</option>`,
            )
            .join(
              "",
            )}</select></label><details><summary>Text preview</summary><div class="docx-text-preview">${esc(section.text || "(Empty chapter)")}</div></details></section>`,
      )
      .join(
        "",
      )}</div>${parsed.warnings.length ? `<ul class="docx-import-notes">${parsed.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}<p>Unselected existing chapters keep their titles, position, drawings, and notes. This import can be undone in one step.</p>`;
  }
  function show() {
    host.modal("Import DOCX chapters", html(), [
      { text: "Cancel", action: "cancel-docx-import" },
      { text: "Import chapters", action: "apply-docx-import", primary: true },
    ]);
  }
  async function open(file) {
    if (!canImportDocx(host.project()))
      return host.notify(
        "Delete all chapter and subchapter text before importing a DOCX.",
      );
    const ticket = ++request,
      id = host.project().id;
    host.notify("Reading DOCX…");
    try {
      const parsed = await readDocx(file);
      if (ticket !== request || host.project()?.id !== id) return;
      if (!canImportDocx(host.project()))
        throw Error(
          "This project now has script text. The DOCX was not imported.",
        );
      pending = {
        projectId: id,
        filename: file.name,
        parsed,
        mapping: suggestChapterTargets(host.project(), parsed.sections),
      };
      show();
    } catch (e) {
      host.notify(e.message);
    }
  }
  function changed(key, target) {
    if (!pending || host.project()?.id !== pending.projectId) return;
    pending.mapping[key] = target;
    for (const section of pending.parsed.sections)
      if (
        section.level === 2 &&
        pending.mapping[section.key] !== "new" &&
        !matchingChapters(host.project(), section, pending.mapping).some(
          (c) => c.id === pending.mapping[section.key],
        )
      )
        pending.mapping[section.key] = "new";
    show();
  }
  function apply() {
    if (!pending || host.project()?.id !== pending.projectId)
      return host.notify("Choose the DOCX again for this project.");
    try {
      let imported;
      host.commit("Import DOCX chapters", () => {
        imported = applyDocxImport(
          host.project(),
          pending.parsed,
          pending.mapping,
          host.createChapter,
          pending.filename,
        );
      });
      pending = null;
      host.closeModal();
      host.selectChapter(imported.firstChapterId);
      host.notify("DOCX chapters imported");
    } catch (e) {
      host.notify(e.message);
    }
  }
  function cancel() {
    pending = null;
    request++;
    host.closeModal();
  }
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-docx-target]"))
      changed(e.target.dataset.docxTarget, e.target.value);
  });
  return { open, apply, cancel };
}
