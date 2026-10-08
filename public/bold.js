// Plain text remains the source of truth; bold ranges are optional metadata.
const editors = new WeakMap();
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderBold(text = '', ranges = []) {
  let cursor = 0;
  let html = '';
  for (const [start, end] of ranges) {
    if (start < cursor || end <= start || start >= text.length) continue;
    html += escape(text.slice(cursor, start)) + '<strong>' + escape(text.slice(start, end)) + '</strong>';
    cursor = Math.min(end, text.length);
  }
  return html + escape(text.slice(cursor));
}

function readEditor(editor) {
  let text = '';
  const bold = [];
  const append = (value, strong) => {
    const start = text.length;
    text += value;
    if (!strong || !value.length) return;
    if (bold.at(-1)?.[1] === start) bold.at(-1)[1] = text.length;
    else bold.push([start, text.length]);
  };
  const visit = (node, strong = false) => {
    if (node.nodeType === Node.TEXT_NODE) return append(node.data, strong);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === 'BR') {
      // Browsers keep a final BR as a caret placeholder on an empty line.
      if (!node.nextSibling && (!node.previousSibling || node.previousSibling.nodeName === 'BR')) return;
      return append('\n', strong);
    }
    const block = node !== editor && /^(DIV|P)$/.test(node.tagName);
    if (block && node.previousSibling) append('\n', false);
    const weight = node.style.fontWeight;
    const isBold = weight ? weight === 'bold' || Number(weight) >= 600 : strong || /^(B|STRONG)$/.test(node.tagName);
    for (const child of node.childNodes) visit(child, isBold);
  };
  visit(editor);
  return { text, bold };
}

export function mountBoldEditors(form, source) {
  const fields = [];
  for (const name of ['title', 'description', 'conclusion', 'content']) {
    const input = form.elements.namedItem(name);
    if (!input) continue;
    const id = input.id;
    const label = form.querySelector(`label[for="${id}"]`);
    label.id = `${id}-label`;
    input.id = `${id}-value`;
    input.hidden = true;
    input.required = false;
    const toolbar = document.createElement('div');
    toolbar.className = 'bold-toolbar';
    toolbar.innerHTML = `<button type="button" class="bold-toggle" aria-label="${name === 'title' ? '标题' : name === 'conclusion' ? '结论' : '正文'}加粗" aria-pressed="false" title="加粗"><b>B</b></button>`;
    const editor = document.createElement('div');
    editor.id = id;
    editor.className = `field bold-editor ${name === 'title' ? 'bold-title-editor' : 'bold-content-editor'}`;
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-labelledby', label.id);
    editor.setAttribute('aria-multiline', String(name !== 'title'));
    if (name === 'title') editor.setAttribute('aria-required', 'true');
    editor.dataset.placeholder = input.placeholder;
    editor.innerHTML = renderBold(input.value, source.bold?.[name]);
    input.before(toolbar, editor);
    label.addEventListener('click', () => editor.focus());
    const button = toolbar.querySelector('button');
    const sync = () => {
      const value = readEditor(editor);
      input.value = value.text;
      return value;
    };
    const toggle = () => {
      editor.focus();
      document.execCommand('bold');
      // A collapsed selection changes the typing style without an input event.
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      button.setAttribute('aria-pressed', String(document.queryCommandState('bold')));
    };
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', toggle);
    editor.addEventListener('input', sync);
    editor.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault(); toggle();
      }
      if (event.key === 'Enter' && !(event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (name !== 'title') document.execCommand('insertLineBreak');
      }
    });
    editor.addEventListener('paste', event => {
      if ([...event.clipboardData?.items || []].some(item => item.kind === 'file')) return;
      event.preventDefault();
      let value = event.clipboardData?.getData('text/plain') || '';
      if (name === 'title') value = value.replace(/[\r\n]+/g, ' ');
      document.execCommand('insertText', false, value);
    });
    // Image drops continue through the existing attachment handler.
    editor.addEventListener('drop', event => {
      if (!event.dataTransfer?.files.length) event.preventDefault();
    });
    fields.push({ name, input, editor, button, sync });
  }
  editors.set(form, fields);
}

export function boldValues(form) {
  const fields = editors.get(form);
  if (!fields) return {};
  const bold = {};
  for (const field of fields) bold[field.name] = field.sync().bold;
  return { bold };
}

export function validateBoldEditors(form) {
  for (const { name, input, editor, sync } of editors.get(form) || []) {
    const { text } = sync();
    if ((name === 'title' && !text.trim()) || text.length > input.maxLength) {
      editor.focus();
      throw new Error(`${name === 'title' ? '标题不能为空，且' : '内容'}不能超过 ${input.maxLength} 个字符`);
    }
  }
}

document.addEventListener('selectionchange', () => {
  const editor = document.activeElement;
  if (!editor?.classList.contains('bold-editor')) return;
  const field = editors.get(editor.closest('form'))?.find(field => field.editor === editor);
  field?.button.setAttribute('aria-pressed', String(document.queryCommandState('bold')));
});
