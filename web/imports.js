"use strict";

/* Une archive ambiguë n'associe jamais silencieusement deux documents. */
let archiveChoiceQueue = Promise.resolve();
function chooseArchive(choices) {
  const show = () => new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "settings archive-choice";
    dialog.setAttribute("aria-label", "Choisir une facture dans l’archive");
    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "settings-body";
    form.appendChild(Object.assign(document.createElement("h2"), { textContent: "Plusieurs documents dans l’archive" }));
    form.appendChild(Object.assign(document.createElement("p"), { textContent: "Choisissez le XML à lire et, si vous connaissez sa correspondance, son PDF. Vous pouvez ouvrir le XML seul." }));
    const select = (label, entries, optional) => {
      const wrap = document.createElement("label");
      wrap.textContent = label + " ";
      const field = document.createElement("select");
      field.className = "zoom-select";
      field.setAttribute("aria-label", label);
      field.required = !optional;
      field.appendChild(new Option(optional ? "Sans PDF associé" : "Choisir un XML…", ""));
      for (const entry of entries) field.appendChild(new Option(entry.name, String(entry.index)));
      if (!optional && entries.length === 1) field.value = String(entries[0].index);
      wrap.appendChild(field); form.appendChild(wrap);
      return field;
    };
    const xml = select("XML", choices.xml, false);
    const pdf = select("PDF", choices.pdf, true);
    const actions = Object.assign(document.createElement("div"), { className: "lines-tools" });
    const cancel = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: "Annuler" });
    cancel.addEventListener("click", () => dialog.close());
    actions.append(cancel, Object.assign(document.createElement("button"), { type: "submit", className: "btn primary", textContent: "Ouvrir la sélection" }));
    form.appendChild(actions);
    let selection = null;
    form.addEventListener("submit", () => { selection = { xml: Number(xml.value), pdf: pdf.value === "" ? null : Number(pdf.value) }; });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(selection); }, { once: true });
    dialog.appendChild(form); document.body.appendChild(dialog); dialog.showModal();
  });
  const pending = archiveChoiceQueue.then(show);
  archiveChoiceQueue = pending.catch(() => {});
  return pending;
}

async function parseArchiveChoice(load, selection) {
  let result = await load(selection);
  if (result?.archive_choices) {
    selection = await chooseArchive(result.archive_choices);
    if (!selection) throw new Error("Ouverture de l’archive annulée.");
    result = await load(selection);
    if (result?.archive_choices) throw new Error("La sélection de l’archive n’a pas pu être appliquée.");
  }
  return result;
}
