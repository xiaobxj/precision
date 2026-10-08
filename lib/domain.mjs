export const statuses = ['todo', 'active', 'waiting', 'done'];
export const statusLabels = { todo: '待开始', active: '进行中', waiting: '待跟进', done: '已完成' };
export const noteStatusLabels = { thought: '待验证', conclusion: '当前结论' };
export const localDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function text(value, label, max, required = true) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) {
    throw new Error(`${label}${required ? '不能为空，且' : ''}不能超过 ${max} 个字符`);
  }
  return value.trim();
}

function status(value) {
  if (!statuses.includes(value)) throw new Error('无效的进度状态');
  return value;
}

function boldRanges(value, rawText) {
  if (!Array.isArray(value) || value.length > rawText.length) throw new Error('无效的加粗格式');
  const offset = rawText.length - rawText.trimStart().length;
  const length = rawText.trim().length;
  const ranges = [];
  let previousEnd = 0;
  for (const range of value) {
    if (!Array.isArray(range) || range.length !== 2) throw new Error('无效的加粗格式');
    const [start, end] = range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < previousEnd || end <= start || end > rawText.length) throw new Error('无效的加粗格式');
    previousEnd = end;
    const from = Math.max(0, start - offset);
    const to = Math.min(length, end - offset);
    if (from < to) ranges.push([from, to]);
  }
  return ranges;
}

function imageReferences(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error('每条记录最多保存 20 张图片');
  return value.map(image => {
    if (!image || typeof image.id !== 'string' || !/^[a-f0-9]{64}$/.test(image.id)) throw new Error('无效的图片引用');
    return { id: image.id, name: text(image.name || '图片', '图片名称', 200) };
  });
}

// Only explicit text edits can add/change formatting. Other commands leave it intact.
function applyBoldFields(target, command, names, previous) {
  if (command.bold === undefined && !previous?.bold) return;
  if (command.bold !== undefined && (!command.bold || typeof command.bold !== 'object' || Array.isArray(command.bold))) throw new Error('无效的加粗格式');
  const bold = {};
  for (const name of names) {
    const raw = command[name] ?? '';
    bold[name] = command.bold !== undefined
      ? boldRanges(command.bold[name] ?? [], raw)
      : raw.trim() === previous[name] ? previous.bold[name] ?? [] : [];
  }
  target.bold = bold;
}

export function emptyState() { return { schema: 1, revision: 0, tasks: [], activities: [] }; }

export function stepStatus(step) {
  const children = step.substeps;
  if (!children?.length) return step.status;
  if (children.every(child => child.status === 'done')) return 'done';
  if (children.some(child => child.status === 'waiting')) return 'waiting';
  if (children.some(child => child.status === 'active' || child.status === 'done')) return 'active';
  return 'todo';
}

// Count each piece of work once: directions without children, otherwise their substeps.
export function progressItems(task) {
  return task.steps.flatMap(step => step.substeps?.length ? step.substeps : [step]);
}

export function taskStatus(task) {
  if (task.completedAt) return 'done';
  if (task.steps.some(step => stepStatus(step) === 'waiting')) return 'waiting';
  if (task.steps.some(step => ['active', 'done'].includes(stepStatus(step)))) return 'active';
  return 'todo';
}

export function tasksOnDay(tasks, day) {
  return tasks.filter(task => task.date === day || (task.date < day && (!task.completedAt || localDay(new Date(task.completedAt)) >= day)));
}

const noteCommands = new Set(['create-note', 'edit-note', 'archive-note', 'restore-note']);

function applyNoteCommand(state, command, now, makeId) {
  // Add notes only when used. Legacy documents and task commands remain valid.
  state.notes ??= [];
  const note = state.notes.find(item => item.id === command.noteId);
  if (command.type !== 'create-note' && !note) throw new Error('这条记录已不存在，请刷新后重试');
  if (command.type === 'create-note' || command.type === 'edit-note') {
    const fields = {
      title: text(command.title, '记录标题', 200),
      conclusion: text(command.conclusion ?? '', '当前结论', 20000, false),
      content: text(command.content ?? '', '思考过程', 200000, false),
      status: command.status ?? 'thought',
      ...(command.images !== undefined ? { images: imageReferences(command.images) } : note?.images ? { images: structuredClone(note.images) } : {}),
    };
    applyBoldFields(fields, command, ['title', 'conclusion', 'content'], note);
    if (!Object.hasOwn(noteStatusLabels, fields.status)) throw new Error('无效的记录类型');
    if (!fields.conclusion && !fields.content && !fields.images?.length) throw new Error('请填写当前结论、思考过程或粘贴图片');
    if (command.type === 'create-note') {
      state.notes.unshift({ id: makeId(), ...fields, createdAt: now, updatedAt: now, archivedAt: null, versions: [] });
    } else {
      if (note.archivedAt) throw new Error('请先恢复这条记录，再编辑');
      if (Object.keys(fields).some(key => JSON.stringify(fields[key]) !== JSON.stringify(note[key]))) {
        note.versions ??= [];
        note.versions.unshift({ title: note.title, conclusion: note.conclusion, content: note.content, status: note.status, at: note.updatedAt, ...(note.bold ? { bold: structuredClone(note.bold) } : {}), ...(note.images ? { images: structuredClone(note.images) } : {}) });
        Object.assign(note, fields, { updatedAt: now });
      }
    }
  } else {
    note.archivedAt = command.type === 'archive-note' ? now : null;
  }
  state.revision += 1;
  return state;
}

export function applyCommand(previous, command, now = new Date().toISOString(), makeId = () => crypto.randomUUID()) {
  if (!command || typeof command !== 'object') throw new Error('无效的操作');
  const state = structuredClone(previous);
  const { type } = command;
  if (noteCommands.has(type)) return applyNoteCommand(state, command, now, makeId);
  let task = state.tasks.find(item => item.id === command.taskId);
  let message = '';
  const findStep = () => {
    const step = task.steps.find(item => item.id === command.stepId);
    if (!step) throw new Error('这条进度已不存在，请刷新后重试');
    return step;
  };
  const reconcile = () => {
    task.completedAt = task.steps.length && task.steps.every(step => stepStatus(step) === 'done') ? (task.completedAt || now) : null;
  };
  const directionStatus = step => {
    if (!step.substeps?.length) return status(command.status);
    const derived = stepStatus(step);
    if (command.status !== undefined && command.status !== derived) throw new Error('方向状态由子进度自动汇总，请更新子进度');
    return derived;
  };
  if (type !== 'create-task' && !task) throw new Error('这个任务已不存在，请刷新后重试');
  switch (type) {
    case 'create-task': {
      if (!validDay(command.date)) throw new Error('请选择有效日期');
      task = { id: makeId(), title: text(command.title, '任务标题', 200), description: text(command.description ?? '', '任务说明', 10000, false), date: command.date, createdAt: now, updatedAt: now, completedAt: null, steps: [] };
      applyBoldFields(task, command, ['title', 'description']);
      if (command.images !== undefined) task.images = imageReferences(command.images);
      state.tasks.push(task);
      message = '创建了任务';
      break;
    }
    case 'edit-task':
      applyBoldFields(task, command, ['title', 'description'], task);
      task.title = text(command.title, '任务标题', 200);
      task.description = text(command.description ?? '', '任务说明', 10000, false);
      if (command.images !== undefined) task.images = imageReferences(command.images);
      message = '更新了任务说明';
      break;
    case 'delete-task':
      state.tasks = state.tasks.filter(item => item.id !== task.id);
      message = '删除了任务';
      break;
    case 'complete-task':
      if (task.steps.some(step => stepStatus(step) !== 'done')) throw new Error('请先完成任务下的所有步骤和子进度');
      task.completedAt = now;
      message = '完成了任务';
      break;
    case 'reopen-task':
      task.completedAt = null;
      message = '重新打开了任务';
      break;
    case 'create-step': {
      const step = { id: makeId(), title: text(command.title, '步骤标题', 200), content: text(command.content ?? '', '进度内容', 50000, false), status: status(command.status ?? 'active'), createdAt: now, updatedAt: now, completedAt: command.status === 'done' ? now : null };
      applyBoldFields(step, command, ['title', 'content']);
      if (command.images !== undefined) step.images = imageReferences(command.images);
      task.steps.push(step);
      reconcile();
      message = `添加进度 · ${step.title}`;
      break;
    }
    case 'edit-step': {
      const step = findStep();
      applyBoldFields(step, command, ['title', 'content'], step);
      step.title = text(command.title, '步骤标题', 200);
      step.content = text(command.content ?? '', '进度内容', 50000, false);
      if (command.images !== undefined) step.images = imageReferences(command.images);
      step.status = directionStatus(step);
      step.updatedAt = now;
      step.completedAt = step.status === 'done' ? (step.completedAt || now) : null;
      reconcile();
      message = `更新进度 · ${step.title}`;
      break;
    }
    case 'set-step-status': {
      const step = findStep();
      step.status = directionStatus(step);
      step.updatedAt = now;
      step.completedAt = step.status === 'done' ? (step.completedAt || now) : null;
      reconcile();
      message = `${statusLabels[step.status]} · ${step.title}`;
      break;
    }
    case 'delete-step': {
      const step = findStep();
      task.steps = task.steps.filter(item => item.id !== step.id);
      reconcile();
      message = `删除进度 · ${step.title}`;
      break;
    }
    case 'move-step': {
      const step = findStep();
      if (![-1, 1].includes(command.direction)) throw new Error('无效的排序方向');
      const index = task.steps.indexOf(step);
      const target = index + command.direction;
      if (target < 0 || target >= task.steps.length) throw new Error('该步骤已在边界位置');
      [task.steps[index], task.steps[target]] = [task.steps[target], task.steps[index]];
      message = `调整了步骤顺序 · ${step.title}`;
      break;
    }
    case 'create-result':
    case 'edit-result':
    case 'delete-result': {
      const step = findStep();
      const result = step.results?.find(item => item.id === command.resultId);
      if (type !== 'create-result' && !result) throw new Error('这条结果记录已不存在，请刷新后重试');
      if (type === 'delete-result') {
        step.results = step.results.filter(item => item.id !== result.id);
        message = `删除结果 · ${step.title} / ${result.title}`;
      } else {
        const fields = { title: text(command.title, '结果标题', 200), content: text(command.content ?? '', '结果内容', 50000, false) };
        if (command.bold !== undefined) {
          if (!command.bold || typeof command.bold !== 'object' || Array.isArray(command.bold)) throw new Error('无效的加粗格式');
          fields.bold = { title: boldRanges(command.bold.title ?? [], command.title), content: boldRanges(command.bold.content ?? [], command.content ?? '') };
        } else if (result?.bold) {
          // Older clients can still edit: retain formatting only for unchanged text.
          fields.bold = { title: fields.title === result.title ? result.bold.title : [], content: fields.content === result.content ? result.bold.content : [] };
        }
        if (command.images !== undefined) fields.images = imageReferences(command.images);
        if (type === 'create-result') {
          // Results are reference material, with no status or completion fields.
          step.results ??= [];
          step.results.push({ id: makeId(), ...fields, createdAt: now, updatedAt: now });
        } else {
          Object.assign(result, fields, { updatedAt: now });
        }
        message = `${type === 'create-result' ? '记录结果' : '更新结果'} · ${step.title} / ${fields.title}`;
      }
      step.updatedAt = now;
      // Do not reconcile task/direction completion when saving reference material.
      break;
    }
    case 'create-substep':
    case 'edit-substep':
    case 'set-substep-status':
    case 'delete-substep':
    case 'move-substep': {
      const step = findStep();
      // Existing directions are extended only when a child is first created.
      const children = step.substeps || [];
      let child = children.find(item => item.id === command.substepId);
      if (type !== 'create-substep' && !child) throw new Error('这条子进度已不存在，请刷新后重试');
      if (type === 'create-substep') {
        const nextStatus = status(command.status ?? 'active');
        child = { id: makeId(), title: text(command.title, '子进度标题', 200), content: text(command.content ?? '', '进度内容', 50000, false), status: nextStatus, createdAt: now, updatedAt: now, completedAt: nextStatus === 'done' ? now : null };
        applyBoldFields(child, command, ['title', 'content']);
        if (command.images !== undefined) child.images = imageReferences(command.images);
        children.push(child);
        step.substeps = children;
        message = `添加子进度 · ${step.title} / ${child.title}`;
      } else if (type === 'edit-substep' || type === 'set-substep-status') {
        if (type === 'edit-substep') {
          applyBoldFields(child, command, ['title', 'content'], child);
          child.title = text(command.title, '子进度标题', 200);
          child.content = text(command.content ?? '', '进度内容', 50000, false);
          if (command.images !== undefined) child.images = imageReferences(command.images);
        }
        child.status = status(command.status);
        child.updatedAt = now;
        child.completedAt = child.status === 'done' ? (child.completedAt || now) : null;
        message = `${type === 'edit-substep' ? '更新子进度' : statusLabels[child.status]} · ${step.title} / ${child.title}`;
      } else if (type === 'delete-substep') {
        step.substeps = children.filter(item => item.id !== child.id);
        // An empty direction becomes manual again, without a false completion.
        if (!step.substeps.length) step.status = 'active';
        message = `删除子进度 · ${step.title} / ${child.title}`;
      } else {
        if (![-1, 1].includes(command.direction)) throw new Error('无效的排序方向');
        const index = children.indexOf(child);
        const target = index + command.direction;
        if (target < 0 || target >= children.length) throw new Error('该子进度已在边界位置');
        [children[index], children[target]] = [children[target], children[index]];
        message = `调整了子进度顺序 · ${step.title} / ${child.title}`;
      }
      step.status = stepStatus(step);
      step.updatedAt = now;
      step.completedAt = step.status === 'done' ? (step.completedAt || now) : null;
      reconcile();
      break;
    }
    default: throw new Error('不支持的操作');
  }
  task.updatedAt = now;
  state.activities.unshift({ id: makeId(), taskId: task.id, taskTitle: task.title, message, at: now });
  state.revision += 1;
  return state;
}
