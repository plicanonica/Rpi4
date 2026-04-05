'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  path: '',       // current directory (relative to storage root)
  view: 'grid',   // 'grid' | 'list'
  pendingRename: null,
  pendingDelete: null,
};

// ── Bootstrap modal instances ─────────────────────────────────────────────
const modals = {};
['mkdir', 'rename', 'delete', 'preview'].forEach(id => {
  modals[id] = new bootstrap.Modal(document.getElementById(`modal-${id}`));
});
const uploadToast = new bootstrap.Toast(document.getElementById('upload-toast'), { autohide: false });

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fileIcon(item) {
  if (item.is_dir) return '<i class="bi bi-folder-fill text-warning"></i>';
  const m = item.mime || '';
  if (m.startsWith('image/'))  return '<i class="bi bi-file-image text-success"></i>';
  if (m.startsWith('video/'))  return '<i class="bi bi-file-play text-danger"></i>';
  if (m.startsWith('audio/'))  return '<i class="bi bi-file-music text-purple" style="color:#9b59b6"></i>';
  if (m.startsWith('text/') || m === 'application/json') return '<i class="bi bi-file-text text-secondary"></i>';
  if (m.includes('pdf'))       return '<i class="bi bi-file-pdf text-danger"></i>';
  if (m.includes('zip') || m.includes('tar') || m.includes('gzip')) return '<i class="bi bi-file-zip text-warning"></i>';
  if (m.includes('word') || m.includes('document')) return '<i class="bi bi-file-word text-primary"></i>';
  if (m.includes('spreadsheet') || m.includes('excel')) return '<i class="bi bi-file-excel" style="color:#217346"></i>';
  return '<i class="bi bi-file-earmark text-secondary"></i>';
}

function isPreviewable(item) {
  const m = item.mime || '';
  return (
    m.startsWith('image/') ||
    m.startsWith('video/') ||
    m.startsWith('audio/') ||
    m.startsWith('text/') ||
    m === 'application/json' ||
    m === 'application/xml'
  );
}

// ── API calls ─────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Load directory ────────────────────────────────────────────────────────
async function loadFiles(path) {
  state.path = path;
  setLoading(true);
  try {
    const data = await api(`/api/files?path=${encodeURIComponent(path)}`);
    renderBreadcrumb(data.breadcrumbs);
    renderDisk(data.disk);
    renderFiles(data.entries);
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  document.getElementById('loading').classList.toggle('d-none', !on);
  document.getElementById('grid-view').classList.toggle('d-none', on);
  document.getElementById('list-view').classList.toggle('d-none', on || state.view !== 'list');
}

function showError(msg) {
  document.getElementById('empty-state').classList.add('d-none');
  // simple inline alert
  const el = document.createElement('div');
  el.className = 'alert alert-danger m-3';
  el.textContent = msg;
  document.getElementById('main-content').prepend(el);
  setTimeout(() => el.remove(), 5000);
}

// ── Breadcrumb ────────────────────────────────────────────────────────────
function renderBreadcrumb(crumbs) {
  const ol = document.getElementById('breadcrumb');
  ol.innerHTML = `<li class="breadcrumb-item"><a href="#" data-path="" class="text-decoration-none crumb"><i class="bi bi-house-door"></i> Home</a></li>`;
  crumbs.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'breadcrumb-item' + (i === crumbs.length - 1 ? ' active' : '');
    if (i === crumbs.length - 1) {
      li.textContent = c.name;
    } else {
      li.innerHTML = `<a href="#" data-path="${c.path}" class="text-decoration-none crumb">${c.name}</a>`;
    }
    ol.appendChild(li);
  });
}

// ── Disk usage ────────────────────────────────────────────────────────────
function renderDisk(disk) {
  if (!disk) return;
  const pct = Math.round((disk.used / disk.total) * 100);
  document.getElementById('storage-bar').style.width = pct + '%';
  document.getElementById('storage-label').textContent =
    `${fmtSize(disk.free)} free`;
}

// ── File rendering ────────────────────────────────────────────────────────
function renderFiles(entries) {
  const empty = document.getElementById('empty-state');
  const grid  = document.getElementById('grid-view');
  const tbody = document.getElementById('list-tbody');

  grid.innerHTML = '';
  tbody.innerHTML = '';

  if (entries.length === 0) {
    empty.classList.remove('d-none');
    return;
  }
  empty.classList.add('d-none');

  entries.forEach(item => {
    grid.appendChild(makeGridCard(item));
    tbody.appendChild(makeListRow(item));
  });
}

function makeGridCard(item) {
  const col = document.createElement('div');
  col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';
  col.innerHTML = `
    <div class="file-card p-2 h-100" data-path="${item.path}" data-isdir="${item.is_dir}">
      <div class="text-center file-icon py-1">${fileIcon(item)}</div>
      <div class="file-name text-center mt-1">${escHtml(item.name)}</div>
      <div class="file-meta text-center">${item.is_dir ? 'Folder' : fmtSize(item.size)}</div>
      <div class="card-actions d-flex justify-content-center gap-1 mt-1">
        ${item.is_dir ? '' : `<button class="btn btn-sm btn-link p-0 action-download" title="Download"><i class="bi bi-download"></i></button>`}
        ${!item.is_dir && isPreviewable(item) ? `<button class="btn btn-sm btn-link p-0 action-preview" title="Preview"><i class="bi bi-eye"></i></button>` : ''}
        <button class="btn btn-sm btn-link p-0 action-rename" title="Rename"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-link text-danger p-0 action-delete" title="Delete"><i class="bi bi-trash"></i></button>
      </div>
    </div>`;
  bindCardEvents(col.querySelector('.file-card'), item);
  return col;
}

function makeListRow(item) {
  const tr = document.createElement('tr');
  tr.dataset.path = item.path;
  tr.innerHTML = `
    <td>
      <div class="d-flex align-items-center gap-2">
        <span class="list-icon">${fileIcon(item)}</span>
        <span class="list-name">${escHtml(item.name)}</span>
      </div>
    </td>
    <td class="d-none d-md-table-cell text-secondary small">${fmtDate(item.modified)}</td>
    <td class="d-none d-md-table-cell text-end text-secondary small">${item.is_dir ? '—' : fmtSize(item.size)}</td>
    <td class="text-end">
      <div class="d-flex justify-content-end gap-1">
        ${item.is_dir ? '' : `<button class="btn btn-sm btn-outline-secondary action-download" title="Download"><i class="bi bi-download"></i></button>`}
        ${!item.is_dir && isPreviewable(item) ? `<button class="btn btn-sm btn-outline-secondary action-preview" title="Preview"><i class="bi bi-eye"></i></button>` : ''}
        <button class="btn btn-sm btn-outline-secondary action-rename" title="Rename"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger action-delete" title="Delete"><i class="bi bi-trash"></i></button>
      </div>
    </td>`;
  bindCardEvents(tr, item);
  return tr;
}

function bindCardEvents(el, item) {
  // Open folder or preview on click (but not on action buttons)
  el.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    if (item.is_dir) {
      loadFiles(item.path);
    } else if (isPreviewable(item)) {
      openPreview(item);
    }
  });

  const dl = el.querySelector('.action-download');
  if (dl) dl.addEventListener('click', e => { e.stopPropagation(); downloadFile(item); });

  const pv = el.querySelector('.action-preview');
  if (pv) pv.addEventListener('click', e => { e.stopPropagation(); openPreview(item); });

  el.querySelector('.action-rename').addEventListener('click', e => { e.stopPropagation(); openRename(item); });
  el.querySelector('.action-delete').addEventListener('click', e => { e.stopPropagation(); openDelete(item); });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Download ──────────────────────────────────────────────────────────────
function downloadFile(item) {
  const a = document.createElement('a');
  a.href = `/api/download?path=${encodeURIComponent(item.path)}`;
  a.download = item.name;
  a.click();
}

// ── Preview ───────────────────────────────────────────────────────────────
function openPreview(item) {
  const url = `/api/preview?path=${encodeURIComponent(item.path)}`;
  const body = document.getElementById('preview-body');
  const m = item.mime || '';

  document.getElementById('preview-title').textContent = item.name;
  document.getElementById('preview-download').href = `/api/download?path=${encodeURIComponent(item.path)}`;

  body.innerHTML = '';
  if (m.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = item.name;
    body.appendChild(img);
  } else if (m.startsWith('video/')) {
    const vid = document.createElement('video');
    vid.src = url;
    vid.controls = true;
    vid.autoplay = false;
    body.appendChild(vid);
  } else if (m.startsWith('audio/')) {
    const aud = document.createElement('audio');
    aud.src = url;
    aud.controls = true;
    body.appendChild(aud);
  } else {
    // text / JSON / XML — fetch and display
    body.innerHTML = `<pre><code>Loading…</code></pre>`;
    fetch(url).then(r => r.text()).then(txt => {
      body.innerHTML = `<pre><code>${escHtml(txt)}</code></pre>`;
    });
  }

  modals.preview.show();
}

// ── Rename ────────────────────────────────────────────────────────────────
function openRename(item) {
  state.pendingRename = item;
  const input = document.getElementById('rename-input');
  input.value = item.name;
  document.getElementById('rename-error').classList.add('d-none');
  modals.rename.show();
  setTimeout(() => { input.select(); }, 300);
}

document.getElementById('rename-confirm').addEventListener('click', async () => {
  const new_name = document.getElementById('rename-input').value.trim();
  const err = document.getElementById('rename-error');
  if (!new_name) { err.textContent = 'Name cannot be empty'; err.classList.remove('d-none'); return; }
  try {
    await api('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.pendingRename.path, new_name }),
    });
    modals.rename.hide();
    loadFiles(state.path);
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('d-none');
  }
});

document.getElementById('rename-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('rename-confirm').click();
});

// ── Delete ────────────────────────────────────────────────────────────────
function openDelete(item) {
  state.pendingDelete = item;
  document.getElementById('delete-name').textContent = item.name;
  modals.delete.show();
}

document.getElementById('delete-confirm').addEventListener('click', async () => {
  try {
    await api('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.pendingDelete.path }),
    });
    modals.delete.hide();
    loadFiles(state.path);
  } catch (e) {
    showError(e.message);
    modals.delete.hide();
  }
});

// ── New folder ────────────────────────────────────────────────────────────
document.getElementById('btn-mkdir').addEventListener('click', () => {
  document.getElementById('mkdir-name').value = '';
  document.getElementById('mkdir-error').classList.add('d-none');
  modals.mkdir.show();
  setTimeout(() => document.getElementById('mkdir-name').focus(), 300);
});

document.getElementById('mkdir-confirm').addEventListener('click', async () => {
  const name = document.getElementById('mkdir-name').value.trim();
  const err  = document.getElementById('mkdir-error');
  if (!name) { err.textContent = 'Name cannot be empty'; err.classList.remove('d-none'); return; }
  try {
    await api('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.path, name }),
    });
    modals.mkdir.hide();
    loadFiles(state.path);
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('d-none');
  }
});

document.getElementById('mkdir-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('mkdir-confirm').click();
});

// ── Upload ────────────────────────────────────────────────────────────────
document.getElementById('btn-upload').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', e => {
  uploadFiles(Array.from(e.target.files));
  e.target.value = '';
});

async function uploadFiles(files) {
  if (!files.length) return;
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));

  document.getElementById('upload-status').textContent = `Uploading ${files.length} file(s)…`;
  document.getElementById('upload-progress').style.width = '0%';
  uploadToast.show();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?path=${encodeURIComponent(state.path)}`);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        document.getElementById('upload-progress').style.width = pct + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        document.getElementById('upload-status').textContent = `Uploaded: ${data.saved.join(', ')}`;
        document.getElementById('upload-progress').style.width = '100%';
        document.getElementById('upload-progress').classList.remove('progress-bar-animated');
        setTimeout(() => { uploadToast.hide(); loadFiles(state.path); }, 1500);
        resolve(data);
      } else {
        document.getElementById('upload-status').textContent = 'Upload failed.';
        reject(new Error('Upload failed'));
      }
    };
    xhr.onerror = () => { document.getElementById('upload-status').textContent = 'Network error.'; reject(); };
    xhr.send(fd);
  });
}

// ── Drag & drop ───────────────────────────────────────────────────────────
let dragCounter = 0;
document.addEventListener('dragenter', e => {
  if (e.dataTransfer.types.includes('Files')) {
    dragCounter++;
    document.getElementById('drop-overlay').classList.remove('d-none');
  }
});
document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    document.getElementById('drop-overlay').classList.add('d-none');
  }
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  document.getElementById('drop-overlay').classList.add('d-none');
  const files = Array.from(e.dataTransfer.files);
  if (files.length) uploadFiles(files);
});

// ── View toggle ───────────────────────────────────────────────────────────
document.getElementById('view-grid').addEventListener('click', () => {
  state.view = 'grid';
  document.getElementById('grid-view').classList.remove('d-none');
  document.getElementById('list-view').classList.add('d-none');
  document.getElementById('view-grid').classList.add('active');
  document.getElementById('view-list').classList.remove('active');
});

document.getElementById('view-list').addEventListener('click', () => {
  state.view = 'list';
  document.getElementById('grid-view').classList.add('d-none');
  document.getElementById('list-view').classList.remove('d-none');
  document.getElementById('view-list').classList.add('active');
  document.getElementById('view-grid').classList.remove('active');
});

// ── Breadcrumb navigation (delegated) ─────────────────────────────────────
document.getElementById('breadcrumb').addEventListener('click', e => {
  const a = e.target.closest('.crumb');
  if (a) { e.preventDefault(); loadFiles(a.dataset.path); }
});

// ── Theme toggle ──────────────────────────────────────────────────────────
document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-bs-theme') === 'dark';
  html.setAttribute('data-bs-theme', isDark ? 'light' : 'dark');
  document.getElementById('theme-toggle').innerHTML =
    isDark ? '<i class="bi bi-moon-stars"></i>' : '<i class="bi bi-sun"></i>';
});

// ── Clean up preview video when modal closes ──────────────────────────────
document.getElementById('modal-preview').addEventListener('hide.bs.modal', () => {
  document.getElementById('preview-body').innerHTML = '';
});

// ── Init ──────────────────────────────────────────────────────────────────
loadFiles('');
