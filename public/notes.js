import { noteStatusLabels, localDay, findResult } from '/domain.mjs';
import { renderBold, mountBoldEditors, boldValues, validateBoldEditors } from '/bold.js';

export function createNotesUI({ getState, isDemo, isBusy, mutate, escape, icon, readLocal, saveLocal, dateTime, imagesUI, showError, focusResult }) {
  const $ = selector => document.querySelector(selector);
  let query = '';
  let archived = false;
  let draftKey = '';
  let editingId;
  const getNotes = () => getState().notes || [];
  function editorValues(form) {
    const formatting = boldValues(form);
    return { ...Object.fromEntries(new FormData(form)), ...formatting, images: imagesUI.get(form), sources: [...form.querySelectorAll('[data-source-id]:checked')].map(input => ({ resultId: input.dataset.sourceId })) };
  }

  function sourcesHTML(sources = []) {
    return sources.length ? `<div class="note-sources"><span class="source-heading">来源结果</span>${sources.map(source => {
      const found = findResult(getState(), source.resultId);
      const title = found ? `${found.task.title} / ${found.step.title} / ${found.result.title}` : `${source.taskTitle} / ${source.stepTitle} / ${source.resultTitle}`;
      return `<button type="button" class="source-link" data-note-action="source" data-result="${escape(source.resultId)}" ${found ? '' : 'disabled'}>${icon('record')}<span>${escape(title)}${found ? '' : '（来源已删除）'}</span>${found ? icon('arrow') : ''}</button>`;
    }).join('')}</div>` : '';
  }

  function sourceOptions(sources = []) {
    const options = getState().tasks.flatMap(task => task.steps.flatMap(step => (step.results || []).map(result => ({ resultId: result.id, taskTitle: task.title, stepTitle: step.title, resultTitle: result.title }))));
    const available = new Set(options.map(source => source.resultId));
    options.push(...sources.filter(source => !available.has(source.resultId)));
    return `<details class="source-options" ${sources.length ? 'open' : ''}><summary>关联来源结果${sources.length ? ` · ${sources.length}` : ''}</summary><div class="source-choices">${options.length ? options.map(source => `<label><input type="checkbox" data-source-id="${escape(source.resultId)}" ${sources.some(item => item.resultId === source.resultId) ? 'checked' : ''}><span>${escape(`${source.taskTitle || ''} / ${source.stepTitle || ''} / ${source.resultTitle || ''}`)}${available.has(source.resultId) ? '' : '（来源已删除）'}</span></label>`).join('') : '<p>添加结果记录后，可以在这里关联。</p>'}</div></details>`;
  }

  function linkResult(resultId) {
    const found = findResult(getState(), resultId);
    if (!found) return showError('来源结果已不存在，请刷新后重试');
    const notes = getNotes().filter(note => !note.archivedAt);
    $('#editor').innerHTML = `<section class="note-reader"><div class="dialog-top"><div class="dialog-icon">${icon('book')}</div><button class="icon-button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div><h2 id="dialog-title">关联思考与结论</h2><p class="dialog-description">${escape(found.result.title)}</p><button class="button primary" data-note-action="new-from-result" data-result="${escape(resultId)}">${icon('plus')}新建关联记录</button><div class="link-note-list">${notes.map(note => {
      const linked = note.sources?.some(source => source.resultId === resultId);
      return `<button class="source-link" data-note-action="link" data-note="${escape(note.id)}" data-result="${escape(resultId)}" ${linked ? 'disabled' : ''}><span>${escape(note.title)}</span>${linked ? '已关联' : icon('plus')}</button>`;
    }).join('') || '<p class="note-empty">还没有可关联的记录。</p>'}</div><div class="dialog-footer"><span>关联会保留原有内容</span><button class="button secondary" data-action="close-dialog">关闭</button></div></section>`;
    if (!$('#editor').open) $('#editor').showModal();
  }

  function renderList() {
    const notes = getNotes().filter(note => !!note.archivedAt === archived &&
      `${note.title}\n${note.conclusion}\n${note.content}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    $('#notes-list').innerHTML = notes.length ? notes.map(note => `<article class="note-item" data-note-id="${escape(note.id)}">
      <button class="note-open" data-note-action="read" data-note="${escape(note.id)}" aria-label="查看记录：${escape(note.title)}">
        <strong>${renderBold(note.title, note.bold?.title)}</strong>
      </button>
      ${note.conclusion ? `<section class="note-inline-section"><h3>当前结论</h3><p class="note-inline-text">${renderBold(note.conclusion, note.bold?.conclusion)}</p></section>` : '<p class="note-preview">尚未填写当前结论，可在详情中补充。</p>'}
      ${imagesUI.gallery(note.images)}
      ${sourcesHTML(note.sources)}
      <div class="note-meta"><span class="note-type ${note.status}">${noteStatusLabels[note.status]}</span><time>${localDay(new Date(note.updatedAt))}</time></div>
      <button class="note-detail-link" data-note-action="read" data-note="${escape(note.id)}">查看详情与编辑 ${icon('arrow')}</button>
    </article>`).join('') : `<p class="note-empty">${query ? '没有找到相关记录。' : archived ? '暂时没有归档记录。' : '把有用的信息、思考和结论放在这里，之后随时回看。'}</p>`;
    const count = getNotes().filter(note => !!note.archivedAt === archived).length;
    $('#notes-count').textContent = `${archived ? '归档' : '保留'} ${count} 条`;
    $('#notes-archive-toggle').textContent = archived ? '返回记录' : '查看归档';
    $('#notes-archive-toggle').setAttribute('aria-pressed', String(archived));
  }

  function mount() {
    $('.insights > .insight-panel').insertAdjacentHTML('afterend', `<section class="insight-panel notes-panel" aria-label="思考与结论">
      <div class="panel-heading"><h2>${icon('book')}思考与结论</h2><button class="icon-button note-add" data-note-action="new" aria-label="新建思考记录" title="新建思考记录">${icon('plus')}</button></div>
      <div class="notes-view-row"><p class="notes-caption">当前结论 · 长期保留，随时回看。</p></div>
      <input id="notes-search" class="notes-search" type="search" aria-label="搜索思考与结论" placeholder="搜索信息或结论…" value="${escape(query)}">
      <div class="notes-list" id="notes-list"></div>
      <div class="notes-bottom"><span id="notes-count"></span><button id="notes-archive-toggle" data-note-action="toggle-archive"></button></div>
    </section>`);
    renderList();
  }

  function openEditor(noteId, resultId) {
    const note = getNotes().find(item => item.id === noteId);
    if (noteId && !note) return;
    editingId = noteId;
    draftKey = `procision-note-draft:${isDemo() ? 'demo' : 'real'}:${noteId || (resultId ? `result:${resultId}` : 'new')}`;
    let draft;
    try { draft = JSON.parse(readLocal(draftKey)); } catch { /* A damaged browser draft never replaces saved data. */ }
    const result = resultId ? findResult(getState(), resultId)?.result : undefined;
    const source = draft || note || (result ? { title: result.title, sources: [{ resultId }] } : {});
    $('#editor').innerHTML = `<form id="note-form" class="note-editor">
      <div class="dialog-top"><div class="dialog-icon">${icon('book')}</div><button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div>
      <h2 id="dialog-title">${note ? '编辑记录' : '新建思考记录'}</h2>
      <p class="dialog-description">留下现在的思考，以及值得记住的结论。记录在所有日期都可查看。</p>
      <label class="field-label" for="note-title">记录标题 <span>*</span></label>
      <input id="note-title" name="title" class="field" required maxlength="200" autocomplete="off" placeholder="例如：市场回撤时，套利中心的漂移与 mu 更新" value="${escape(source.title || '')}">
      <label class="field-label" for="note-conclusion">当前结论 <small>显示在右侧记录中</small></label>
      <textarea id="note-conclusion" name="conclusion" class="field" maxlength="20000" rows="3" placeholder="最想记住的是什么？也可以先写下尚待验证的判断。">${escape(source.conclusion || '')}</textarea>
      <label class="field-label" for="note-content">思考过程与有用信息 <small>可粘贴长文本</small></label>
      <textarea id="note-content" name="content" class="field" maxlength="200000" rows="7" placeholder="记录现象、推理过程、背景资料，或贴上相关对话。支持多行文本。">${escape(source.content || '')}</textarea>
      ${sourceOptions(source.sources ?? note?.sources)}
      <div class="field-label" id="note-status-label">记录类型</div>
      <div class="status-options note-status-options" role="radiogroup" aria-labelledby="note-status-label">${Object.entries(noteStatusLabels).map(([value, label]) => `<label class="status-option ${value === 'thought' ? 'waiting' : 'active'}"><input type="radio" name="status" value="${value}" ${(source.status || 'thought') === value ? 'checked' : ''}><span><i></i>${label}</span></label>`).join('')}</div>
      <div class="dialog-footer"><span>${draft ? '已恢复未保存的草稿' : 'Ctrl + Enter 保存 · 修改保留历史'}</span><div><button type="button" class="button secondary" data-action="close-dialog">取消</button><button type="submit" class="button primary">${icon('check')}保存记录</button></div></div>
    </form>`;
    if (!$('#editor').open) $('#editor').showModal();
    const form = $('#note-form');
    const currentDraftKey = draftKey;
    mountBoldEditors(form, source);
    imagesUI.mount(form, source.images ?? note?.images ?? [], currentDraftKey, () => saveLocal(currentDraftKey, JSON.stringify(editorValues(form))));
    $('#note-title').focus();
  }

  function readNote(noteId) {
    const note = getNotes().find(item => item.id === noteId);
    if (!note) return;
    const versions = note.versions || [];
    $('#editor').innerHTML = `<article class="note-reader">
      <div class="dialog-top"><div class="dialog-icon">${icon('book')}</div><button class="icon-button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div>
      <h2 id="dialog-title">${renderBold(note.title, note.bold?.title)}</h2>
      <div class="note-meta"><span class="note-type ${note.status}">${noteStatusLabels[note.status]}</span><time>${localDay(new Date(note.createdAt))} 记录 · ${dateTime(note.updatedAt)} 更新</time>${note.archivedAt ? '<span>已归档</span>' : ''}</div>
      ${note.conclusion ? `<section class="note-section note-conclusion"><h3>当前结论</h3><p class="note-text">${renderBold(note.conclusion, note.bold?.conclusion)}</p></section>` : ''}
      ${note.content ? `<section class="note-section"><h3>思考过程与有用信息</h3><p class="note-text">${renderBold(note.content, note.bold?.content)}</p></section>` : ''}
      ${sourcesHTML(note.sources)}
      ${versions.length ? `<details class="note-history"><summary>历史版本 · ${versions.length} 次修改前的记录</summary>${versions.map(version => `<details class="note-version"><summary>${localDay(new Date(version.at))} ${dateTime(version.at).split(' ').at(-1)} · ${renderBold(version.title, version.bold?.title)} · ${noteStatusLabels[version.status]}</summary>${version.conclusion ? `<h4>当时的结论</h4><p class="note-text">${renderBold(version.conclusion, version.bold?.conclusion)}</p>` : ''}${version.content ? `<h4>当时的思考过程</h4><p class="note-text">${renderBold(version.content, version.bold?.content)}</p>` : ''}</details>`).join('')}</details>` : ''}
      <div class="dialog-footer"><button class="note-archive" data-note-action="${note.archivedAt ? 'restore' : 'archive'}" data-note="${escape(note.id)}">${note.archivedAt ? '恢复到记录' : '归档（仍可找回）'}</button><div><button class="button secondary" data-action="close-dialog">关闭</button>${!note.archivedAt ? `<button class="button primary" data-note-action="edit" data-note="${escape(note.id)}">${icon('edit')}编辑记录</button>` : ''}</div></div>
    </article>`;
    $('#editor .dialog-footer').insertAdjacentHTML('beforebegin', imagesUI.gallery(note.images));
    $('#editor').querySelectorAll('.note-version').forEach((element, index) => element.insertAdjacentHTML('beforeend', imagesUI.gallery(versions[index].images)));
    $('#editor').querySelectorAll('.note-version').forEach((element, index) => element.insertAdjacentHTML('beforeend', sourcesHTML(versions[index].sources)));
    if (!$('#editor').open) $('#editor').showModal();
    $('#editor').scrollTop = 0;
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-note-action]');
    if (!button || isBusy()) return;
    const { noteAction: action, note: noteId } = button.dataset;
    switch (action) {
      case 'new': openEditor(); break;
      case 'new-from-result': openEditor(undefined, button.dataset.result); break;
      case 'source': focusResult(button.dataset.result); break;
      case 'link':
        if (await mutate({ type: 'link-note-result', noteId, resultId: button.dataset.result }, '已关联来源结果')) $('#editor').close();
        break;
      case 'edit': openEditor(noteId); break;
      case 'read': readNote(noteId); break;
      case 'toggle-archive': archived = !archived; renderList(); break;
      case 'archive': case 'restore':
        if (await mutate({ type: `${action}-note`, noteId }, action === 'archive' ? '已归档，可在“查看归档”中找回' : '记录已恢复')) $('#editor').close();
        break;
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'notes-search') { query = event.target.value; renderList(); }
    if (event.target.closest('#note-form')) saveLocal(draftKey, JSON.stringify(editorValues($('#note-form'))));
  });
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'note-form') return;
    event.preventDefault();
    if (isBusy() || !imagesUI.ready(event.target)) return;
    try { validateBoldEditors(event.target); } catch (error) { showError(error.message); return; }
    const values = editorValues(event.target);
    const submittedDraftKey = draftKey;
    const submit = event.target.querySelector('[type=submit]');
    submit.disabled = true;
    if (await mutate({ type: editingId ? 'edit-note' : 'create-note', noteId: editingId, ...values }, '记录已保存')) {
      await imagesUI.commit(event.target);
      saveLocal(submittedDraftKey, null);
      $('#editor').close();
    }
    submit.disabled = false;
  });
  document.addEventListener('keydown', event => {
    if ($('#image-viewer')?.open) return;
    if ($('#editor').open && $('#note-form') && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault(); $('#note-form').requestSubmit();
    }
  });
  return { mount, linkResult };
}
