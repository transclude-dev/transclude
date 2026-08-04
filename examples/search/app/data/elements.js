// What there is to search. A list in a module, because the point here is the
// request, not the store.

/** @type {{ tag: string, kind: string, summary: string }[]} */
export const elements = [
  { tag: 'a', kind: 'Text', summary: 'A hyperlink. The whole idea, in one tag.' },
  { tag: 'article', kind: 'Sections', summary: 'A self-contained composition.' },
  { tag: 'button', kind: 'Forms', summary: 'A control that does something when pressed.' },
  { tag: 'details', kind: 'Interactive', summary: 'A disclosure widget, with no script.' },
  { tag: 'dialog', kind: 'Interactive', summary: 'A modal, with focus handling built in.' },
  { tag: 'fieldset', kind: 'Forms', summary: 'A group of controls, with a legend.' },
  { tag: 'figure', kind: 'Grouping', summary: 'Content with a caption attached to it.' },
  { tag: 'form', kind: 'Forms', summary: 'A section that submits to a server.' },
  { tag: 'input', kind: 'Forms', summary: 'A field. Its type decides almost everything.' },
  { tag: 'label', kind: 'Forms', summary: 'Names a control, and clicking it focuses one.' },
  { tag: 'main', kind: 'Sections', summary: 'The dominant content of the document.' },
  { tag: 'output', kind: 'Forms', summary: 'The result of a calculation.' },
  { tag: 'picture', kind: 'Media', summary: 'Several sources, one image, chosen by the browser.' },
  { tag: 'progress', kind: 'Forms', summary: 'How far along something is.' },
  { tag: 'search', kind: 'Sections', summary: 'A set of controls for searching.' },
  { tag: 'select', kind: 'Forms', summary: 'A menu of options.' },
  { tag: 'slot', kind: 'Web components', summary: 'Where light DOM lands inside a shadow root.' },
  { tag: 'summary', kind: 'Interactive', summary: 'The visible part of a details element.' },
  { tag: 'table', kind: 'Tabular', summary: 'Data in rows and columns.' },
  { tag: 'template', kind: 'Scripting', summary: 'Markup the parser keeps but does not render.' },
  { tag: 'time', kind: 'Text', summary: 'A date or a duration a machine can read.' },
];

/** How many there are, so a page need not import the list to count it. */
export const total = elements.length;

/** @param {string} query */
export function search(query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return elements.filter(
    (item) =>
      item.tag.includes(needle) ||
      item.kind.toLowerCase().includes(needle) ||
      item.summary.toLowerCase().includes(needle),
  );
}
