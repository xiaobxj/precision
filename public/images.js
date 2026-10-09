// Saved images live in SQLite. IndexedDB retains unfinished uploads across refreshes.
export function createImageUI({ escape, icon, isDemo, showError }) {
  const forms = new WeakMap();
  const demoUrls = new Map();
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('procision-image-drafts', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('uploads', { keyPath: 'key' });
      store.createIndex('draftKey', 'draftKey');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // Report storage failures when a user actually attaches an image.
  database.catch(() => {});

  async function draftStore(action, value) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('uploads', action === 'read' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('uploads');
      const request = action === 'read' ? store.index('draftKey').getAll(value) : action === 'put' ? store.put(value) : store.delete(value);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('图片草稿保存失败'));
    });
  }
  const urlFor = image => demoUrls.get(image.id) || `/api/images/${image.id}`;
  function gallery(images = []) {
    if (!images.length) return '';
    return `<div class="image-gallery">${images.map(image => `<button type="button" class="image-thumbnail" data-image-url="${escape(urlFor(image))}" data-image-name="${escape(image.name)}" aria-label="查看图片：${escape(image.name)}"><img src="${escape(urlFor(image))}" alt="${escape(image.name)}" loading="lazy"><span>${escape(image.name)}</span></button>`).join('')}</div>`;
  }

  function render(form) {
    const state = forms.get(form);
    const zone = form.querySelector('.image-composer');
    if (!state || !zone) return;
    zone.querySelector('.image-draft-list').innerHTML = state.items.map(item => `<div class="image-draft" data-upload-key="${escape(item.key)}">
      <button type="button" class="image-draft-preview" data-image-url="${escape(item.preview)}" data-image-name="${escape(item.name)}" aria-label="预览图片：${escape(item.name)}"><img src="${escape(item.preview)}" alt="${escape(item.name)}"></button>
      <div class="image-draft-caption"><span title="${escape(item.name)}">${escape(item.name)}</span><small class="${item.status === 'error' ? 'upload-error' : ''}">${item.status === 'ready' ? '已就绪' : item.status === 'error' ? escape(item.error || '上传失败') : '正在保存图片…'}</small></div>
      ${item.status === 'error' ? `<button type="button" class="image-retry" data-upload-action="retry" data-upload-key="${escape(item.key)}">重试</button>` : ''}
      <button type="button" class="image-remove" data-upload-action="remove" data-upload-key="${escape(item.key)}" aria-label="移除图片：${escape(item.name)}">${icon('close')}</button>
    </div>`).join('');
    zone.querySelector('.image-upload-status').textContent = state.loading ? '正在恢复图片草稿…' : state.message || (state.items.length ? `${state.items.length} / 20 张 · 保存记录后关联图片` : 'Ctrl + V 粘贴截图，也可拖入图片');
    const pending = state.loading || state.items.some(item => item.status !== 'ready');
    zone.setAttribute('aria-busy', String(pending));
    form.querySelector('[type=submit]').disabled = pending;
  }

  function get(form) { return (forms.get(form)?.items || []).filter(item => item.status === 'ready').map(item => item.image); }
  function ready(form) {
    const state = forms.get(form);
    if (!state) return true;
    if (state.loading || state.items.some(item => item.status !== 'ready')) {
      showError('请等待图片上传完成；失败的图片可重试或移除后再保存。');
      return false;
    }
    return true;
  }
  async function commit(form) {
    const state = forms.get(form);
    if (!state) return;
    await Promise.allSettled(state.items.filter(item => item.persisted).map(item => draftStore('remove', item.key)));
  }

  function unmount(form) {
    const state = forms.get(form);
    if (!state) return;
    state.dialog?.removeEventListener('close', state.onClose);
    if (!state.demo) for (const item of state.items) if (item.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview);
  }

  async function upload(form, item) {
    const state = forms.get(form);
    item.status = 'uploading'; item.error = ''; render(form);
    const controller = new AbortController(); item.controller = controller;
    try {
      if (!item.persisted) {
        await draftStore('put', { key: item.key, draftKey: state.draftKey, name: item.name, blob: item.blob });
        item.persisted = true;
      }
      if (!state.items.includes(item)) { await draftStore('remove', item.key); return; }
      let id;
      if (state.demo) {
        id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await item.blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
        demoUrls.set(id, item.preview);
      } else {
        const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': item.blob.type }, body: item.blob, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '图片上传失败');
        id = result.id;
      }
      if (!state.items.includes(item)) { await draftStore('remove', item.key); return; }
      item.image = { id, name: item.name }; item.status = 'ready';
      await draftStore('put', { key: item.key, draftKey: state.draftKey, name: item.name, blob: item.blob, image: item.image, demo: state.demo });
      state.onChange();
    } catch (error) {
      if (!state.items.includes(item)) return;
      item.status = 'error';
      item.error = error.name === 'TypeError' || error.name === 'TimeoutError' ? '连接失败，图片草稿已保留' : error.message || '上传失败，请重试';
    }
    render(form);
  }

  async function addFiles(form, files) {
    const state = forms.get(form);
    await state.hydration;
    state.message = '';
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { state.message = '支持 PNG、JPG、GIF、WebP 图片'; continue; }
      if (file.size > 10 * 1024 * 1024) { state.message = '单张图片不能超过 10 MB'; continue; }
      if (state.items.length >= 20) { state.message = '每条记录最多保存 20 张图片'; break; }
      const item = { key: crypto.randomUUID(), name: (file.name || '截图.png').slice(0, 200), blob: file, preview: URL.createObjectURL(file), status: 'uploading' };
      state.items.push(item); upload(form, item);
    }
    render(form);
  }

  function mount(form, images, draftKey, onChange) {
    const zone = document.createElement('section');
    zone.className = 'image-composer';
    zone.setAttribute('aria-label', '图片附件');
    zone.innerHTML = `<div class="image-composer-heading"><span>图片附件</span><label class="image-file-label">${icon('plus')}选择图片<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple aria-label="选择图片"></label></div><p class="image-upload-status" role="status"></p><div class="image-draft-list"></div>`;
    form.querySelector('textarea:last-of-type').after(zone);
    const state = { draftKey, onChange, demo: isDemo(), loading: true, items: (images || []).map(image => ({ key: crypto.randomUUID(), image, name: image.name, preview: urlFor(image), status: 'ready' })) };
    forms.set(form, state); render(form);
    state.hydration = (async () => {
      try {
        const records = await draftStore('read', draftKey);
        for (const record of records) {
          if (record.image && state.items.some(item => item.image?.id === record.image.id)) {
            const existing = state.items.find(item => item.image?.id === record.image.id);
            existing.key = record.key; existing.persisted = true;
            continue;
          }
          const item = { ...record, persisted: true, preview: record.blob ? URL.createObjectURL(record.blob) : urlFor(record.image), status: record.image ? 'ready' : 'uploading' };
          if (state.demo && record.image) demoUrls.set(record.image.id, item.preview);
          state.items.push(item);
        }
      } catch { state.message = '图片草稿存储不可用，请保持窗口打开'; }
      state.loading = false; render(form); state.onChange();
      for (const item of state.items.filter(item => item.status !== 'ready')) upload(form, item);
    })();
    form.addEventListener('paste', event => {
      const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
      if (files.length) { event.preventDefault(); addFiles(form, files); }
    });
    form.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); zone.classList.add('drag-over'); } });
    form.addEventListener('dragleave', event => { if (!form.contains(event.relatedTarget)) zone.classList.remove('drag-over'); });
    form.addEventListener('drop', event => {
      if (event.dataTransfer.files.length) { event.preventDefault(); zone.classList.remove('drag-over'); addFiles(form, [...event.dataTransfer.files]); }
    });
    zone.querySelector('input').addEventListener('change', event => { addFiles(form, [...event.target.files]); event.target.value = ''; });
    zone.addEventListener('click', async event => {
      const button = event.target.closest('[data-upload-action]'); if (!button) return;
      const item = state.items.find(item => item.key === button.dataset.uploadKey); if (!item) return;
      if (button.dataset.uploadAction === 'retry') return upload(form, item);
      item.controller?.abort(); state.items = state.items.filter(value => value !== item);
      await draftStore('remove', item.key).catch(() => { state.message = '移除草稿失败，请重试'; });
      state.onChange(); render(form);
    });
    state.dialog = form.closest('dialog');
    state.onClose = () => {
      // A previous editor's queued close event can arrive after the next opens.
      if (state.dialog.open && form.isConnected) return;
      unmount(form);
    };
    state.dialog.addEventListener('close', state.onClose);
  }

  const viewer = document.createElement('dialog');
  viewer.id = 'image-viewer'; viewer.setAttribute('aria-label', '图片预览');
  document.body.append(viewer);
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-image-url]'); if (!target) return;
    viewer.innerHTML = `<div class="image-viewer-toolbar"><span>${escape(target.dataset.imageName)}</span><a href="${escape(target.dataset.imageUrl)}" download="${escape(target.dataset.imageName)}">保存图片</a><button type="button" class="icon-button" aria-label="关闭图片预览">${icon('close')}</button></div><div class="image-viewer-canvas"><img src="${escape(target.dataset.imageUrl)}" alt="${escape(target.dataset.imageName)}"></div>`;
    viewer.querySelector('button').onclick = () => viewer.close();
    viewer.showModal();
  });
  viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
  return { mount, gallery, get, ready, commit, unmount };
}
