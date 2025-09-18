/* CSVText – main logic */

const els = {
  csvFile: document.getElementById('csvFile'),
  hasHeader: document.getElementById('hasHeader'),
  btnParse: document.getElementById('btnParse'),
  csvInfo: document.getElementById('csvInfo'),

  messageTemplate: document.getElementById('messageTemplate'),
  btnDetectVars: document.getElementById('btnDetectVars'),
  detectedVars: document.getElementById('detectedVars'),

  mappingPanel: document.getElementById('mappingPanel'),
  mappingGrid: document.getElementById('mappingGrid'),
  phoneColumn: document.getElementById('phoneColumn'),

  sendPanel: document.getElementById('sendPanel'),
  btnStart: document.getElementById('btnStart'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),
  btnOpenSMS: document.getElementById('btnOpenSMS'),
  btnCopy: document.getElementById('btnCopy'),

  progressBar: document.getElementById('progressBar'),
  progressText: document.getElementById('progressText'),

  rowNum: document.getElementById('rowNum'),
  rowPhone: document.getElementById('rowPhone'),
  renderedMessage: document.getElementById('renderedMessage'),
  rowJson: document.getElementById('rowJson'),
};

let state = {
  headers: [],
  rows: [],
  vars: [],
  varToColumn: {},   // { varName: columnName }
  phoneCol: null,
  index: 0,
  started: false
};

// ---------- CSV Parsing ----------
els.btnParse.addEventListener('click', () => {
  const file = els.csvFile.files?.[0];
  if (!file) {
    toast('Please choose a CSV file first.');
    return;
  }
  Papa.parse(file, {
    header: !!els.hasHeader.checked,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (res) => {
      if (res.errors?.length) {
        console.warn(res.errors);
        toast('Some rows produced parse warnings; check console.');
      }

      if (els.hasHeader.checked) {
        state.headers = res.meta.fields || inferHeadersFromFirstRow(res.data[0]);
      } else {
        state.headers = inferHeadersFromFirstRow(res.data[0]);
      }

      // Normalize rows to object shape
      if (els.hasHeader.checked) {
        state.rows = res.data;
      } else {
        state.rows = res.data.map((arr) => {
          const obj = {};
          state.headers.forEach((h, i) => obj[h] = arr[i]);
          return obj;
        });
      }

      els.csvInfo.textContent = `Loaded ${state.rows.length} rows with ${state.headers.length} columns: ${state.headers.join(', ')}`;
      populatePhoneColumnSelect();
      if (state.vars.length) buildMappingUI(); // if variables already detected
      showSection(els.mappingPanel, true);
      showSection(els.sendPanel, true);
    }
  });
});

function inferHeadersFromFirstRow(row) {
  const len = Array.isArray(row) ? row.length : Object.keys(row || {}).length;
  return Array.from({length: len}, (_, i) => `col${i+1}`);
}

function populatePhoneColumnSelect() {
  els.phoneColumn.innerHTML = optionsHTML(['(choose…)'].concat(state.headers));
  els.phoneColumn.selectedIndex = 0;
  els.phoneColumn.addEventListener('change', () => {
    state.phoneCol = els.phoneColumn.value === '(choose…)'
      ? null
      : els.phoneColumn.value;
  });
}

// ---------- Variables Detection ----------
els.btnDetectVars.addEventListener('click', () => {
  const template = els.messageTemplate.value || '';
  const vars = detectVars(template);
  state.vars = vars;
  renderVarChips(vars);
  if (state.headers.length) {
    buildMappingUI();
    showSection(els.mappingPanel, true);
  }
});

function detectVars(str) {
  const re = /\{\{\s*([\w.\-]+)\s*\}\}/g;
  const set = new Set();
  let m;
  while ((m = re.exec(str)) !== null) set.add(m[1]);
  return Array.from(set);
}

function renderVarChips(vars) {
  els.detectedVars.innerHTML = '';
  if (!vars.length) {
    els.detectedVars.innerHTML = `<span class="muted">No variables detected yet.</span>`;
    return;
  }
  vars.forEach(v => {
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = `{{${v}}}`;
    els.detectedVars.appendChild(span);
  });
}

function buildMappingUI() {
  els.mappingGrid.innerHTML = '';
  state.varToColumn = state.varToColumn || {};
  state.vars.forEach(v => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <label>Map <code>{{${v}}}</code> to column</label>
      <select data-var="${escapeHTML(v)}">${optionsHTML(['(choose…)'].concat(state.headers))}</select>
      <p class="hint">Choose which CSV column will fill <code>{{${escapeHTML(v)}}}</code>.</p>
    `;
    const sel = wrap.querySelector('select');
    if (state.varToColumn[v]) sel.value = state.varToColumn[v];
    sel.addEventListener('change', () => {
      const choice = sel.value;
      state.varToColumn[v] = choice === '(choose…)'
        ? null
        : choice;
    });
    els.mappingGrid.appendChild(wrap);
  });

  // Phone column select populated in CSV step
  if (state.headers.length && !els.phoneColumn.options.length) {
    populatePhoneColumnSelect();
  }
}

// ---------- Session Controls ----------
els.btnStart.addEventListener('click', () => {
  if (!state.rows.length) {
    toast('Please parse a CSV first.');
    return;
  }
  if (!state.vars.every(v => state.varToColumn[v])) {
    toast('Please map all variables to a column.');
    return;
  }
  if (!state.phoneCol) {
    toast('Please choose a phone number column.');
    return;
  }

  state.started = true;
  state.index = 0;
  els.btnPrev.disabled = true;
  els.btnNext.disabled = false;
  els.btnOpenSMS.disabled = false;

  updatePreview();
});

els.btnPrev.addEventListener('click', () => {
  if (!state.started) return;
  state.index = Math.max(0, state.index - 1);
  updatePreview();
});

els.btnNext.addEventListener('click', () => {
  if (!state.started) return;
  state.index = Math.min(state.rows.length - 1, state.index + 1);
  updatePreview();
});

els.btnOpenSMS.addEventListener('click', () => {
  if (!state.started) return;
  const row = state.rows[state.index];
  const phone = sanitizePhone(row[state.phoneCol]);
  const msg = renderTemplate(els.messageTemplate.value, row, state.varToColumn);

  if (!phone) {
    toast('This row has an empty phone number.');
    return;
  }
  const url = smsURL(phone, msg);
  // Navigating the current tab maximizes compatibility with SMS handlers
  window.location.href = url;
});

els.btnCopy.addEventListener('click', async () => {
  const row = state.rows[state.index];
  const msg = renderTemplate(els.messageTemplate.value, row, state.varToColumn);
  try {
    await navigator.clipboard.writeText(msg);
    toast('Message copied to clipboard.');
  } catch {
    toast('Could not access clipboard.');
  }
});

// ---------- Rendering ----------
function updatePreview() {
  const total = state.rows.length;
  const idx = state.index;
  const row = state.rows[idx];

  const phoneRaw = row?.[state.phoneCol] ?? '';
  const phone = sanitizePhone(phoneRaw);

  els.rowNum.textContent = `${idx + 1}`;
  els.rowPhone.textContent = phone || '(empty)';
  els.rowJson.textContent = prettyJSON(row);

  const msg = renderTemplate(els.messageTemplate.value, row, state.varToColumn);
  els.renderedMessage.value = msg;

  els.progressText.textContent = `${idx + 1} / ${total}`;
  const pct = Math.round(((idx + 1) / total) * 100);
  els.progressBar.style.width = `${pct}%`;

  els.btnPrev.disabled = idx === 0;
  els.btnNext.disabled = idx >= total - 1;
}

function renderTemplate(tpl, row, map) {
  return tpl.replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (_, v) => {
    const col = map[v];
    let val = col ? row[col] : '';
    if (val === undefined || val === null) val = '';
    return String(val);
  });
}

// ---------- Helpers ----------
function optionsHTML(arr) {
  return arr.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );
}

function prettyJSON(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj ?? '');
  }
}

function sanitizePhone(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';
  // Keep leading + if present, then digits
  const plus = s.startsWith('+') ? '+' : '';
  const digits = s.replace(/[^\d]/g, '');
  return plus + digits;
}

function smsURL(number, body) {
  // Platform differences:
  // iOS: sms:+15551234&body=...
  // Android: sms:+15551234?body=...
  const isIOS = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream;
  const sep = isIOS ? '&' : '?';
  return `sms:${encodeURIComponent(number)}${sep}body=${encodeURIComponent(body)}`;
}

function showSection(el, on=true){ el.hidden = !on; }

function toast(msg) {
  // Lightweight, accessible toast
  let n = document.getElementById('toast');
  if (!n) {
    n = document.createElement('div');
    n.id = 'toast';
    n.setAttribute('role','status');
    n.setAttribute('aria-live','polite');
    Object.assign(n.style, {
      position:'fixed', inset:'auto 16px 16px auto', zIndex:9999,
      background:'#0f1520', color:'#e6eef7', border:'1px solid #1f2a3a',
      padding:'10px 12px', borderRadius:'10px', boxShadow:'0 10px 30px rgba(0,0,0,.25)'
    });
    document.body.appendChild(n);
  }
  n.textContent = msg;
  n.style.opacity = '1';
  clearTimeout(n._t);
  n._t = setTimeout(()=>{ n.style.opacity = '0'; }, 2000);
}
