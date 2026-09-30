import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12/lib/marked.esm.js';

const SUPABASE_URL = 'https://mutrlpfqziiiixlvixjd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5yfCALC5WKr2tCaWkonGVA_7nGocT0b';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const GUIDE_FILES = {
  'social-studies': '01-social-studies.md',
  'religion': '02-religion.md',
  'science': '03-science.md',
  'english': '04-english.md',
  'espanol': '05-espanol.md',
  'aprender-a-amar': '06-aprender-a-amar.md',
  'math': '07-math.md',
};
const PERIOD = '2026-2027 P1';

const $app = document.getElementById('app');
let user = null;
let subjectsCache = null;
let cleanup = [];

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { $app.innerHTML = html; window.scrollTo(0, 0); };
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - today) / 86400000);
}
function countdownPill(dateStr) {
  const n = daysUntil(dateStr);
  if (n < 0) return `<span class="countdown past">Done</span>`;
  if (n === 0) return `<span class="countdown today">Exam today</span>`;
  if (n === 1) return `<span class="countdown soon">Tomorrow</span>`;
  return `<span class="countdown ${n <= 3 ? 'soon' : ''}">In ${n} days</span>`;
}
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (s) => { s = Math.max(0, s | 0); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ':' : '') + String(mm).padStart(hh ? 2 : 1, '0') + ':' + String(ss).padStart(2, '0'); };
const scoreClass = (s) => (s >= 80 ? 'good' : s >= 60 ? 'mid' : 'bad');
const T = (lang, en, es) => (lang === 'es' ? es : en);

async function subjects() {
  if (subjectsCache) return subjectsCache;
  const { data, error } = await sb.from('subjects').select('*, topics(id, idx, title, photo_request)').order('sort');
  if (error) throw error;
  data.forEach((s) => s.topics.sort((a, b) => a.idx - b.idx));
  subjectsCache = data;
  return data;
}
async function subject(id) { return (await subjects()).find((s) => s.id === id); }

async function discardExam(id, lang) {
  if (!confirm(T(lang, 'Discard this exam? It will be deleted and can\'t be recovered.', '¿Descartar este examen? Se borra y no se puede recuperar.'))) return false;
  const { data, error } = await sb.rpc('discard_exam', { p_exam: id });
  if (error || !data) { toast(error ? error.message : T(lang, 'It can\'t be discarded while Claude is grading it.', 'No se puede descartar mientras Claude lo califica.')); return false; }
  try { localStorage.removeItem('exam-start-' + id); } catch {}
  toast(T(lang, 'Exam discarded', 'Examen descartado'));
  return true;
}

// ---------- router ----------
const routes = [
  [/^#\/?$/, viewHome],
  [/^#\/plan$/, viewPlan],
  [/^#\/guide\/([\w-]+)$/, viewGuide],
  [/^#\/notes\/([\w-]+)$/, viewNotes],
  [/^#\/exam\/new(?:\/([\w-]+))?$/, viewNewExam],
  [/^#\/exam\/([0-9a-f-]{36})$/, viewExam],
  [/^#\/results\/([0-9a-f-]{36})$/, viewResults],
  [/^#\/history$/, viewHistory],
  [/^#\/settings$/, viewSettings],
];
async function route() {
  cleanup.forEach((fn) => fn()); cleanup = [];
  const hash = location.hash || '#/';
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === hash));
  if (!user) return viewLogin();
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await fn(...m.slice(1)); } catch (e) { console.error(e); h(`<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message || e)}</p><a class="btn" href="#/">Back home</a></div>`); }
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

// ---------- login ----------
function viewLogin() {
  document.getElementById('topbar').hidden = true;
  h(`<div class="auth card">
      <div class="brand-mark">E</div>
      <h1>Estudios de Examenes</h1>
      <p class="muted">Sign in to study and take your practice exams.</p>
      <form id="f">
        <label for="em">Email</label><input id="em" type="email" autocomplete="email" required>
        <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" minlength="6" required>
        <div class="row" style="margin-top:16px">
          <button class="btn primary" type="submit">Sign in</button>
          <button class="btn ghost" type="button" id="su">Create account</button>
        </div>
        <p id="msg" class="small muted"></p>
      </form></div>`);
  const msg = document.getElementById('msg');
  const creds = () => ({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value });
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault(); msg.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword(creds());
    msg.textContent = error ? error.message : '';
  };
  document.getElementById('su').onclick = async () => {
    const c = creds();
    if (!c.email || c.password.length < 6) { msg.textContent = 'Enter an email and a password (6+ characters).'; return; }
    msg.textContent = 'Creating account…';
    const { data, error } = await sb.auth.signUp({ ...c, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) msg.textContent = error.message;
    else if (!data.session) msg.textContent = 'Account created. Check your email to confirm it, then sign in.';
  };
}

// ---------- home ----------
async function viewHome() {
  const subs = await subjects();
  const [{ data: prog }, { data: photos }, { data: exams }] = await Promise.all([
    sb.from('topic_progress').select('topic_id, status'),
    sb.from('note_photos').select('subject_id, topic_id').eq('period', PERIOD),
    sb.from('exams').select('id, subject_id, status, score, started_at').order('started_at', { ascending: false }),
  ]);
  const progMap = Object.fromEntries((prog || []).map((p) => [p.topic_id, p.status]));
  const upcoming = subs.filter((s) => daysUntil(s.exam_date) >= 0);
  const next = upcoming.sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0];
  const pending = (exams || []).filter((e) => ['submitted', 'grading'].includes(e.status));
  const open = (exams || []).filter((e) => e.status === 'in_progress');

  const cards = (await subjects()).map((s) => {
    const topics = s.topics;
    const c = { yes: 0, almost: 0, no: 0 };
    topics.forEach((t) => { const v = progMap[t.id]; if (v) c[v]++; });
    const pct = (n) => (topics.length ? (n / topics.length) * 100 : 0);
    const needPhotos = s.notes_closed ? [] : topics.filter((t) => t.photo_request);
    const withPhotos = new Set((photos || []).filter((p) => p.subject_id === s.id).map((p) => p.topic_id));
    const missing = needPhotos.filter((t) => !withPhotos.has(t.id)).length;
    const graded = (exams || []).filter((e) => e.subject_id === s.id && e.status === 'graded');
    const last = graded[0];
    const best = graded.reduce((m, e) => Math.max(m, Number(e.score)), 0);
    return `<div class="card subject-card stack">
      <div class="spread"><h3>${esc(s.name)}</h3>${countdownPill(s.exam_date)}</div>
      <div class="small muted">Exam: ${fmtDate(s.exam_date)} · ${s.lang === 'es' ? 'Español' : 'English'}</div>
      <div>
        <div class="meter" title="Mastery"><span class="m-yes" style="width:${pct(c.yes)}%"></span><span class="m-almost" style="width:${pct(c.almost)}%"></span><span class="m-no" style="width:${pct(c.no)}%"></span></div>
        <div class="stat" style="margin-top:6px"><b>${c.yes}</b>/${topics.length} topics mastered${c.almost ? ` · ${c.almost} almost` : ''}${c.no ? ` · ${c.no} to review` : ''}</div>
      </div>
      <div class="stat">${last ? `Last exam: <b>${Number(last.score)}</b>/100 · Best: <b>${best}</b>` : 'No exams yet'}</div>
      <div>${missing ? `<span class="pill warn">${missing} topic${missing > 1 ? 's' : ''} missing notes</span>` : `<span class="pill ok">Notes complete</span>`}</div>
      <div class="row">
        <a class="btn sm" href="#/guide/${s.id}">Guide</a>
        <a class="btn sm" href="#/notes/${s.id}">Notes</a>
        <a class="btn sm primary" href="#/exam/new/${s.id}">Take exam</a>
      </div></div>`;
  }).join('');

  h(`<div class="spread"><div><h1>Hi! Ready to study?</h1>
        <p class="muted">${next ? `Next exam: <b>${esc(next.name)}</b> — ${fmtDate(next.exam_date)} (${daysUntil(next.exam_date) === 0 ? 'today' : daysUntil(next.exam_date) === 1 ? 'tomorrow' : 'in ' + daysUntil(next.exam_date) + ' days'})` : 'All exams are done. 🎉'}</p></div>
        <a class="btn primary" href="#/exam/new">New exam</a></div>
      ${open.map((e) => `<div class="card spread" style="margin-bottom:14px"><span>You have an exam in progress (${esc(subs.find((s) => s.id === e.subject_id)?.name)}).</span><span class="row"><button class="btn sm ghost" data-discard="${e.id}">Discard</button><a class="btn sm primary" href="#/exam/${e.id}">Continue</a></span></div>`).join('')}
      ${pending.map((e) => `<div class="card spread" style="margin-bottom:14px"><span>Claude is grading your ${esc(subs.find((s) => s.id === e.subject_id)?.name)} exam…</span><a class="btn sm" href="#/results/${e.id}">See status</a></div>`).join('')}
      <div class="grid">${cards}</div>`);
  $app.querySelectorAll('[data-discard]').forEach((b) => (b.onclick = async () => { if (await discardExam(b.dataset.discard, 'en')) viewHome(); }));
}

// ---------- plan ----------
async function viewPlan() {
  const md = await (await fetch('guias/00-plan-de-estudio.md', { cache: 'no-cache' })).text();
  h(`<article class="guide">${marked.parse(md)}</article>`);
}

// ---------- guide ----------
async function signedUrls(paths) {
  if (!paths.length) return {};
  const { data } = await sb.storage.from('apuntes').createSignedUrls(paths, 3600);
  return Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl]));
}
function thumbsHtml(list, urls) {
  return `<div class="thumbs">${list.map((p) => {
    const u = urls[p.path];
    const isImg = /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(p.path);
    return `<a href="${esc(u)}" target="_blank" rel="noopener">${isImg ? `<img src="${esc(u)}" alt="${esc(p.file_name)}" loading="lazy">` : `<span class="file">${esc(p.file_name || 'file')}</span>`}</a>`;
  }).join('')}</div>`;
}

async function viewGuide(id) {
  const s = await subject(id);
  if (!s) return (location.hash = '#/');
  const [mdRes, { data: prog }, { data: photos }] = await Promise.all([
    fetch('guias/' + GUIDE_FILES[id], { cache: 'no-cache' }),
    sb.from('topic_progress').select('topic_id, status'),
    sb.from('note_photos').select('topic_id, path, file_name').eq('subject_id', id).eq('period', PERIOD).order('created_at'),
  ]);
  const md = await mdRes.text();
  const progMap = Object.fromEntries((prog || []).map((p) => [p.topic_id, p.status]));
  const urls = await signedUrls((photos || []).map((p) => p.path));
  const lang = s.lang;

  h(`<div class="row" style="margin-bottom:12px"><a class="btn sm ghost" href="#/">← Home</a><a class="btn sm" href="#/notes/${id}">${T(lang, 'My notes', 'Mis apuntes')}</a><a class="btn sm primary" href="#/exam/new/${id}">${T(lang, 'Take exam', 'Hacer examen')}</a></div>
     <article class="guide" id="g">${marked.parse(md)}</article>`);

  const g = document.getElementById('g');
  let topic = null;
  const byIdx = Object.fromEntries(s.topics.map((t) => [t.idx, t]));
  // Remove the static final checklist (it's live on the home page now).
  const els = [...g.children];
  const ci = els.findIndex((el) => el.tagName === 'H2' && /checklist/i.test(el.textContent));
  if (ci >= 0) els.slice(ci).forEach((el) => el.remove());

  for (const el of [...g.children]) {
    if (el.tagName === 'H2') {
      const m = el.textContent.match(/^\s*(\d+)\./);
      topic = m ? byIdx[Number(m[1])] : null;
      continue;
    }
    if (el.tagName !== 'P' || !topic) continue;
    const txt = el.textContent;
    if (/^📷/.test(txt.trim())) {
      const mine = (photos || []).filter((p) => p.topic_id === topic.id);
      const div = document.createElement('div');
      div.className = 'notes-inline';
      div.innerHTML = mine.length
        ? `📷 <b>${T(lang, 'My notes', 'Mis apuntes')}</b> (${mine.length})${thumbsHtml(mine, urls)}`
        : topic.photo_request && !s.notes_closed
          ? `📷 ${T(lang, 'No notes yet for this topic.', 'Todavía no hay apuntes de este tema.')} <a href="#/notes/${id}">${T(lang, 'Attach them', 'Agrégalos')}</a>`
          : '';
      if (div.innerHTML) el.replaceWith(div); else el.remove();
    } else if (/Have I mastered this\?|¿Lo domino\?/.test(txt)) {
      const t = topic;
      const box = document.createElement('div');
      box.className = 'mastery';
      const labels = lang === 'es' ? { yes: 'Sí', almost: 'Más o menos', no: 'No' } : { yes: 'Yes', almost: 'Almost', no: 'No' };
      box.innerHTML = `<span class="q">${T(lang, 'Have I mastered this?', '¿Lo domino?')}</span>` +
        ['yes', 'almost', 'no'].map((v) => `<button class="seg ${progMap[t.id] === v ? 'on' : ''}" data-v="${v}">${labels[v]}</button>`).join('');
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('.seg'); if (!b) return;
        const v = b.dataset.v;
        box.querySelectorAll('.seg').forEach((x) => x.classList.toggle('on', x === b));
        const { error } = await sb.from('topic_progress').upsert({ user_id: user.id, topic_id: t.id, status: v, updated_at: new Date().toISOString() });
        if (error) toast('Could not save: ' + error.message);
      });
      el.replaceWith(box);
    }
  }
}

// ---------- notes ----------
async function viewNotes(id) {
  const s = await subject(id);
  if (!s) return (location.hash = '#/');
  const lang = s.lang;
  const { data: photos } = await sb.from('note_photos').select('id, topic_id, path, file_name').eq('subject_id', id).eq('period', PERIOD).order('created_at');
  const urls = await signedUrls((photos || []).map((p) => p.path));
  const rows = s.topics.filter((t) => (s.notes_closed ? (photos || []).some((p) => p.topic_id === t.id) : t.photo_request)).map((t) => {
    const mine = (photos || []).filter((p) => p.topic_id === t.id);
    return `<div class="topic-row">
      <div class="spread"><b>${t.idx}. ${esc(t.title)}</b>${mine.length ? `<span class="pill ok">${mine.length} ${T(lang, 'attached', 'adjuntas')}</span>` : `<span class="pill warn">${T(lang, 'Missing', 'Falta')}</span>`}</div>
      ${s.notes_closed ? '' : `<div class="small muted">${esc(t.photo_request)}</div>`}
      ${mine.length ? thumbsHtml(mine, urls) : ''}
      ${s.notes_closed ? '' : `<div><label class="btn sm file-btn">＋ ${T(lang, 'Attach files', 'Adjuntar archivos')}<input type="file" multiple accept="image/*,application/pdf" data-topic="${t.id}"></label></div>`}
    </div>`;
  }).join('');
  h(`<div class="row" style="margin-bottom:12px"><a class="btn sm ghost" href="#/">← Home</a><a class="btn sm" href="#/guide/${id}">${T(lang, 'Guide', 'Guía')}</a></div>
     <div class="card"><h1>${esc(s.name)} — ${T(lang, 'Notes', 'Apuntes')}</h1>
     <p class="muted">${T(lang, `Attach photos of your notebook and book pages for each topic. They are saved for this period (${PERIOD}) and reused to improve your guides.`, `Adjunta fotos de tu cuaderno y del libro para cada tema. Se guardan para este periodo (${PERIOD}) y se reutilizan para mejorar tus guías.`)}</p>
     <div>${rows}</div></div>`);
  $app.querySelectorAll('input[type=file]').forEach((inp) => {
    inp.onchange = async () => {
      const files = [...inp.files]; if (!files.length) return;
      toast(T(lang, 'Uploading…', 'Subiendo…'), 60000);
      for (const f of files) {
        const blob = await shrinkImage(f);
        const safe = f.name.replace(/[^\w.-]+/g, '_').replace(/\.(heic|heif|png|webp)$/i, '.jpg');
        const path = `${user.id}/${id}/${inp.dataset.topic}-${Date.now()}-${safe}`;
        let up;
        for (let attempt = 1; attempt <= 3; attempt++) {
          up = await sb.storage.from('apuntes').upload(path, blob, { contentType: blob.type || undefined, upsert: true });
          if (!up.error) break;
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
        if (up.error) { toast('Upload failed: ' + up.error.message); return; }
        const { error } = await sb.from('note_photos').insert({ user_id: user.id, subject_id: id, topic_id: Number(inp.dataset.topic), period: PERIOD, path, file_name: f.name });
        if (error) { toast('Save failed: ' + error.message); return; }
      }
      toast(T(lang, 'Saved!', '¡Guardado!'));
      viewNotes(id);
    };
  });
}

// Resize big photos in the browser so uploads are fast (max 2200px, JPEG 0.8). PDFs go as-is.
async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || file.size < 700 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}

// ---------- new exam ----------
async function viewNewExam(preselect) {
  const subs = await subjects();
  const { data: photos } = await sb.from('note_photos').select('subject_id, topic_id').eq('period', PERIOD);
  const sel = preselect && subs.find((s) => s.id === preselect) ? preselect : (subs.filter((s) => daysUntil(s.exam_date) >= 0).sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0] || subs[0]).id;
  h(`<a class="btn sm ghost" href="#/">← Home</a>
    <div class="card stack" style="margin-top:12px;max-width:640px">
      <h1>New exam</h1>
      <p class="muted">Open-answer questions from your guide. You'll get different questions each time on the same topics, and the ones you missed come back first. Claude grades everything at the end (out of 100).</p>
      <div><label for="sub">Subject</label><select id="sub">${subs.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)} — ${fmtDate(s.exam_date)}</option>`).join('')}</select></div>
      <div><label for="cnt">Number of questions</label><select id="cnt"><option value="10">10 (quick)</option><option value="25">25</option><option value="40">40</option><option value="67" selected>67 (full exam)</option></select></div>
      <div id="miss"></div>
      <div class="row"><button class="btn primary" id="go">Start exam ⏱</button></div>
    </div>`);
  const renderMissing = () => {
    const s = subs.find((x) => x.id === document.getElementById('sub').value);
    const have = new Set((photos || []).filter((p) => p.subject_id === s.id).map((p) => p.topic_id));
    const miss = s.notes_closed ? [] : s.topics.filter((t) => t.photo_request && !have.has(t.id));
    document.getElementById('miss').innerHTML = miss.length
      ? `<div class="notes-inline"><b>${T(s.lang, 'Notes missing', 'Faltan apuntes')}</b> ${T(s.lang, '— the system asks for:', '— el sistema pide:')}<ul>${miss.map((t) => `<li>${esc(t.photo_request)}</li>`).join('')}</ul>
          <p class="small muted">${T(s.lang, 'You can still take the exam now: the questions come from your study guide.', 'Puedes hacer el examen ahora: las preguntas salen de tu guía de estudio.')}</p>
          <div class="row"><a class="btn sm" href="#/notes/${s.id}">${T(s.lang, 'Attach notes first', 'Primero adjuntar apuntes')}</a></div></div>`
      : `<span class="pill ok">${T(s.lang, 'All notes attached', 'Apuntes completos')}</span>`;
    document.getElementById('go').textContent = miss.length ? T(s.lang, 'Start without notes ⏱', 'Empezar sin apuntes ⏱') : T(s.lang, 'Start exam ⏱', 'Empezar examen ⏱');
  };
  document.getElementById('sub').onchange = renderMissing; renderMissing();
  document.getElementById('go').onclick = async (e) => {
    e.target.disabled = true;
    const { data, error } = await sb.rpc('start_exam', { p_subject: document.getElementById('sub').value, p_count: Number(document.getElementById('cnt').value) });
    if (error) { e.target.disabled = false; return toast(error.message); }
    location.hash = '#/exam/' + data;
  };
}

// ---------- take exam ----------
async function viewExam(examId) {
  const { data: exam, error } = await sb.from('exams').select('*').eq('id', examId).single();
  if (error || !exam) throw new Error('Exam not found');
  if (exam.status !== 'in_progress') return (location.hash = '#/results/' + examId);
  const s = await subject(exam.subject_id);
  const lang = s.lang;
  const { data: qs } = await sb.from('exam_questions_v').select('*').eq('exam_id', examId).order('idx');
  const topicName = Object.fromEntries(s.topics.map((t) => [t.id, t.title]));
  const answers = Object.fromEntries(qs.map((q) => [q.answer_id, q.answer || '']));
  const saved = { ...answers };
  const startKey = 'exam-start-' + examId;
  let startMs = Date.parse(exam.started_at);
  try { const v = localStorage.getItem(startKey); if (v) startMs = Number(v); } catch {}
  let cur = 0;

  h(`<div class="exam-bar"><div><b>${esc(s.name)}</b> <span class="muted small">· ${qs.length} ${T(lang, 'questions', 'preguntas')}</span></div>
      <div class="row"><span class="timer" id="tm">0:00</span><button class="btn sm ghost" id="disc">${T(lang, 'Discard', 'Descartar')}</button><button class="btn sm primary" id="sub">${T(lang, 'Submit exam', 'Entregar examen')}</button></div></div>
    <div class="qnav" id="nav"></div>
    <div class="card stack" id="qc"></div>`);

  const tm = document.getElementById('tm');
  const tick = () => (tm.textContent = fmtTime((Date.now() - startMs) / 1000));
  tick(); const iv = setInterval(tick, 1000); cleanup.push(() => clearInterval(iv));

  const save = async (q) => {
    if (answers[q.answer_id] === saved[q.answer_id]) return;
    const text = answers[q.answer_id];
    const { error } = await sb.rpc('save_answer', { p_answer_id: q.answer_id, p_text: text });
    if (!error) saved[q.answer_id] = text; else toast('Not saved: ' + error.message);
  };
  const autosave = setInterval(() => save(qs[cur]), 5000); cleanup.push(() => clearInterval(autosave));

  const nav = () => {
    document.getElementById('nav').innerHTML = qs.map((q, i) => `<button class="${answers[q.answer_id].trim() ? 'done' : ''} ${i === cur ? 'cur' : ''}" data-i="${i}">${i + 1}</button>`).join('');
  };
  const show = (i) => {
    cur = i; const q = qs[i];
    document.getElementById('qc').innerHTML = `
      <div class="topic-tag">${T(lang, 'Question', 'Pregunta')} ${i + 1} ${T(lang, 'of', 'de')} ${qs.length} · ${esc(topicName[q.topic_id] || '')}</div>
      <div class="question-text">${esc(q.prompt)}</div>
      <textarea id="ans" placeholder="${T(lang, 'Write your answer here…', 'Escribe tu respuesta aquí…')}">${esc(answers[q.answer_id])}</textarea>
      <div class="spread"><button class="btn" id="prev" ${i === 0 ? 'disabled' : ''}>← ${T(lang, 'Previous', 'Anterior')}</button>
      ${i < qs.length - 1 ? `<button class="btn primary" id="next">${T(lang, 'Next', 'Siguiente')} →</button>` : `<button class="btn primary" id="fin">${T(lang, 'Finish & submit', 'Terminar y entregar')}</button>`}</div>`;
    const ta = document.getElementById('ans');
    ta.oninput = () => { answers[q.answer_id] = ta.value; };
    ta.onblur = () => { save(q); nav(); };
    document.getElementById('prev').onclick = () => { save(q); show(i - 1); };
    const nx = document.getElementById('next'); if (nx) nx.onclick = () => { save(q); show(i + 1); };
    const fn = document.getElementById('fin'); if (fn) fn.onclick = submit;
    nav(); ta.focus({ preventScroll: true });
  };
  document.getElementById('nav').onclick = (e) => { const b = e.target.closest('button'); if (b) { save(qs[cur]); show(Number(b.dataset.i)); } };

  async function submit() {
    const blank = qs.filter((q) => !answers[q.answer_id].trim()).length;
    if (!confirm(blank ? T(lang, `${blank} question(s) are blank. Submit anyway?`, `Hay ${blank} pregunta(s) en blanco. ¿Entregar de todos modos?`) : T(lang, 'Submit your exam for grading?', '¿Entregar tu examen para calificar?'))) return;
    for (const q of qs) await save(q);
    const elapsed = Math.round((Date.now() - startMs) / 1000);
    const { error } = await sb.rpc('submit_exam', { p_exam: examId, p_elapsed: elapsed });
    if (error) return toast(error.message);
    try { localStorage.removeItem(startKey); } catch {}
    sb.functions.invoke('calificar', { body: { exam_id: examId } }).then(({ data, error }) => {
      if (error || data?.fired === false) console.warn('Grading trigger:', error || data);
    });
    location.hash = '#/results/' + examId;
  }
  document.getElementById('sub').onclick = submit;
  document.getElementById('disc').onclick = async () => { if (await discardExam(examId, lang)) location.hash = '#/'; };
  show(0);
}

// ---------- results ----------
async function viewResults(examId) {
  const { data: exam } = await sb.from('exams').select('*').eq('id', examId).single();
  if (!exam) throw new Error('Exam not found');
  if (exam.status === 'in_progress') return (location.hash = '#/exam/' + examId);
  const s = await subject(exam.subject_id);
  const lang = s.lang;
  if (exam.status !== 'graded') {
    h(`<a class="btn sm ghost" href="#/">← Home</a>
      <div class="card stack" style="margin-top:12px;text-align:center;align-items:center;display:flex;flex-direction:column">
        <div class="spinner"></div>
        <h2>${exam.status === 'error' ? 'Grading had a problem' : 'Claude is grading your exam…'}</h2>
        <p class="muted">${esc(s.name)} · ${exam.question_count} questions · time ${fmtTime(exam.elapsed_seconds)}</p>
        <p class="small muted">This usually takes a few minutes. This page updates by itself — you can leave and come back later.</p>
        <button class="btn sm" id="retry">Ask Claude again</button>
      </div>`);
    document.getElementById('retry').onclick = async () => {
      const { data, error } = await sb.functions.invoke('calificar', { body: { exam_id: examId } });
      toast(error ? 'Could not reach the grader.' : data?.fired ? 'Sent to Claude ✔' : 'Queued — Claude checks for pending exams every hour.');
    };
    const iv = setInterval(async () => {
      const { data } = await sb.from('exams').select('status').eq('id', examId).single();
      if (data?.status === 'graded') { clearInterval(iv); viewResults(examId); }
    }, 10000);
    cleanup.push(() => clearInterval(iv));
    return;
  }
  const { data: qs } = await sb.from('exam_questions_v').select('*').eq('exam_id', examId).order('idx');
  const topicName = Object.fromEntries(s.topics.map((t) => [t.id, t.title]));
  const sc = Number(exam.score);
  // per-topic breakdown
  const byTopic = {};
  qs.forEach((q) => { (byTopic[q.topic_id] ||= []).push(q.score ?? 0); });
  const topicRows = Object.entries(byTopic).map(([tid, arr]) => {
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    return `<tr><td>${esc(topicName[tid] || '')}</td><td><b class="score-${scoreClass(avg)}">${avg}</b></td><td class="muted">${arr.length}</td></tr>`;
  }).join('');
  h(`<div class="row" style="margin-bottom:12px"><a class="btn sm ghost" href="#/">← Home</a><a class="btn sm" href="#/guide/${s.id}">${T(lang, 'Guide', 'Guía')}</a><a class="btn sm primary" href="#/exam/new/${s.id}">${T(lang, 'New exam', 'Nuevo examen')}</a><button class="btn sm ghost" id="disc">${T(lang, 'Discard exam', 'Descartar examen')}</button></div>
    <div class="card stack">
      <div class="spread"><div><div class="muted">${esc(s.name)} · ${new Date(exam.submitted_at).toLocaleString()}</div>
        <div class="score-big score-${scoreClass(sc)}">${sc}<span style="font-size:1.4rem" class="muted">/100</span></div></div>
        <div class="stat">⏱ ${fmtTime(exam.elapsed_seconds)}<br>${qs.length} ${T(lang, 'questions', 'preguntas')}</div></div>
      ${exam.summary ? `<div class="answer-box">${esc(exam.summary)}</div>` : ''}
      <table class="hist"><tr><th>${T(lang, 'Topic', 'Tema')}</th><th>${T(lang, 'Score', 'Calificación')}</th><th>#</th></tr>${topicRows}</table>
    </div>
    <h2>${T(lang, 'Question by question', 'Pregunta por pregunta')}</h2>
    <div class="stack">${qs.map((q, i) => `<div class="card result-q ${scoreClass(q.score ?? 0)} stack">
        <div class="spread"><span class="topic-tag">${i + 1} · ${esc(topicName[q.topic_id] || '')}</span><b class="score-${scoreClass(q.score ?? 0)}">${q.score ?? 0}/100</b></div>
        <div class="question-text">${esc(q.prompt)}</div>
        <div><div class="small muted">${T(lang, 'Your answer', 'Tu respuesta')}</div><div class="answer-box">${esc(q.answer || '—')}</div></div>
        ${q.feedback ? `<div><div class="small muted">${T(lang, 'Feedback', 'Comentarios')}</div><div>${esc(q.feedback)}</div></div>` : ''}
        ${q.model_answer && (q.score ?? 0) < 100 ? `<div><div class="small muted">${T(lang, 'Model answer', 'Respuesta modelo')}</div><div class="model-box">${esc(q.model_answer)}</div></div>` : ''}
      </div>`).join('')}</div>`);
  document.getElementById('disc').onclick = async () => { if (await discardExam(examId, lang)) location.hash = '#/history'; };
}

// ---------- history ----------
async function viewHistory() {
  const subs = await subjects();
  const { data: exams } = await sb.from('exams').select('*').order('started_at', { ascending: false });
  const blocks = subs.map((s) => {
    const list = (exams || []).filter((e) => e.subject_id === s.id);
    if (!list.length) return '';
    const graded = list.filter((e) => e.status === 'graded').slice().reverse();
    return `<div class="card stack"><div class="spread"><h3 style="margin:0">${esc(s.name)}</h3><span class="muted small">${graded.length} graded</span></div>
      ${graded.length > 1 ? `<div class="chart" title="Score over time">${graded.map((e) => `<div style="height:${Math.max(3, Number(e.score))}%" title="${Number(e.score)}"></div>`).join('')}</div>` : ''}
      <table class="hist"><tr><th>Date</th><th>Score</th><th>Time</th><th>Qs</th><th></th></tr>
      ${list.map((e) => `<tr><td>${new Date(e.started_at).toLocaleDateString()}</td>
        <td>${e.status === 'graded' ? `<b class="score-${scoreClass(Number(e.score))}">${Number(e.score)}</b>` : `<span class="pill">${e.status.replace('_', ' ')}</span>`}</td>
        <td>${e.elapsed_seconds ? fmtTime(e.elapsed_seconds) : '—'}</td><td>${e.question_count}</td>
        <td class="row"><a href="#/${e.status === 'in_progress' ? 'exam' : 'results'}/${e.id}">Open</a>${e.status !== 'grading' ? `<button class="btn sm ghost" data-discard="${e.id}" aria-label="Discard exam">✕</button>` : ''}</td></tr>`).join('')}</table></div>`;
  }).join('');
  h(`<h1>History</h1><div class="stack">${blocks || '<p class="muted">No exams yet. <a href="#/exam/new">Take your first one</a>.</p>'}</div>`);
  $app.querySelectorAll('[data-discard]').forEach((b) => (b.onclick = async () => { if (await discardExam(b.dataset.discard, 'en')) viewHistory(); }));
}

// ---------- settings ----------
async function viewSettings() {
  const { data: st } = await sb.rpc('routine_status');
  h(`<h1>Settings</h1>
    <div class="card stack" style="max-width:640px">
      <h3 style="margin:0">Claude grading routine</h3>
      <p class="muted small">When you submit an exam, this site fires your Claude routine through its API trigger. Paste the routine's API trigger URL and token here (from claude.ai → Routines → your routine → API trigger).</p>
      <div><label for="u">API trigger URL</label><input id="u" type="url" placeholder="https://api.anthropic.com/v1/claude_code/routines/…/fire" value="${esc(st?.url || '')}"></div>
      <div><label for="tk">Token ${st?.has_token ? '<span class="pill ok">saved</span>' : ''}</label><input id="tk" type="password" placeholder="${st?.has_token ? 'Leave blank to keep the saved token' : 'sk-ant-…'}"></div>
      <div class="row"><button class="btn primary" id="sv">Save</button></div>
    </div>
    <div class="card stack" style="max-width:640px;margin-top:14px">
      <div class="spread"><span class="muted">Signed in as <b>${esc(user.email)}</b></span><button class="btn sm" id="out">Sign out</button></div>
    </div>`);
  document.getElementById('sv').onclick = async () => {
    const { error } = await sb.rpc('set_routine_config', { p_url: document.getElementById('u').value, p_token: document.getElementById('tk').value });
    toast(error ? error.message : 'Saved ✔'); if (!error) viewSettings();
  };
  document.getElementById('out').onclick = () => sb.auth.signOut();
}

// ---------- boot ----------
let booted = false;
sb.auth.onAuthStateChange((_e, session) => {
  const was = user?.id;
  user = session?.user || null;
  document.getElementById('topbar').hidden = !user;
  if (!booted || was !== user?.id) { booted = true; subjectsCache = null; setTimeout(route); }
});
