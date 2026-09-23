/* GDGoC 케로로 소대 · 계정 / 팀 신청 / 프로젝트 제안 (Supabase)
   로그인은 "이름 + 비밀번호". 이름을 hex로 바꾼 가짜 이메일을 Supabase Auth 계정으로 쓴다.
   supabase/schema.sql 의 rename_me() 와 같은 규칙이어야 한다. */
(() => {
  const cfg = window.SUPA;
  if (!cfg || !cfg.url || !window.supabase) return;
  const sb = window.supabase.createClient(cfg.url, cfg.key);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (n) => String(n).normalize('NFC').trim().replace(/\s+/g, ' ');
  const emailFor = (name) => 'm' + [...new TextEncoder().encode(name)].map((b) => b.toString(16).padStart(2, '0')).join('') + '@members.keroro.local';

  function friendly(msg = '') {
    if (/_likes_pkey/.test(msg)) return '이미 좋아요를 눌렀습니다. 새로고침해 주세요.';
    if (/applications_rank_check/.test(msg)) return '신청 종류가 맞지 않습니다. 새로고침한 뒤 다시 시도해 주세요.';
    if (/applications_user_rank_key|applications_user_id_team_slug_key/.test(msg)) return '이미 신청한 팀이거나 순위가 겹칩니다. 내 신청 현황을 확인해 주세요.';
    if (/already registered|already exists|duplicate|saving new user|profiles_name_key/i.test(msg)) return '이미 사용 중인 이름입니다. 다른 이름을 써 주세요.';
    if (/invalid login/i.test(msg)) return '이름 또는 비밀번호가 맞지 않습니다.';
    if (/password/i.test(msg) && /at least|length|short|weak/i.test(msg)) return '비밀번호는 6자 이상이어야 합니다.';
    if (/rate limit|too many/i.test(msg)) return '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.';
    if (/name length/i.test(msg)) return '이름은 2자 이상 20자 이하로 적어 주세요.';
    if (/Failed to fetch|NetworkError/i.test(msg)) return '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    console.error(msg);
    return '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
  }

  let me = null;      // my_profile() 한 줄 (대원 카드 포함)
  let myApps = [];    // my_applications() — 내 신청 전체 행

  async function loadMe() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { me = null; myApps = []; return; }
    const { data, error } = await sb.rpc('my_profile');
    // 읽기에 실패했는데 빈 프로필로 대체하면, 그 화면에서 저장할 때 진짜 대원 카드를 덮어쓴다.
    if (error) { console.error(error); me = null; myApps = []; return; }
    // 프로필 행이 아직 없는 경우(가입 직후 트리거 지연)에만 임시 프로필을 쓴다.
    me = data?.[0] ?? { id: session.user.id, name: session.user.user_metadata?.name || '이름 없음' };
  }

  async function loadMyApps() {
    if (!me) { myApps = []; return myApps; }
    const { data, error } = await sb.rpc('my_applications');
    if (error) console.error(error);
    myApps = data || [];
    return myApps;
  }

  const teamOf = (slug) => (window.TEAMS || {})[slug] || {};
  const nowIso = () => new Date().toISOString();

  /* ---------- 헤더 ---------- */
  function renderHeader() {
    const acc = $('#account'), login = $('#login-btn');
    if (!acc) return;
    acc.hidden = !me;
    login.hidden = !!me;
    if (me) $('#account-name').textContent = me.name;
    const staffLink = $('#staff-link');
    if (staffLink) staffLink.hidden = !me?.is_staff;
  }

  /* ---------- 가입 · 로그인 대화상자 ---------- */
  const authDlg = $('#auth-dialog');
  let mode = 'login';

  function setMode(m) {
    mode = m;
    $$('.tabs button', authDlg).forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    $('#auth-submit').textContent = m === 'signup' ? '가입하고 시작하기' : '로그인';
    $('#auth-hint').textContent = m === 'signup'
      ? '이름은 다른 대원에게 표시되며 나중에 바꿀 수 있습니다. 비밀번호는 잊지 마세요. 이메일이 없어 스스로 재설정할 수 없습니다.'
      : '처음이라면 "처음이에요"를 눌러 가입해 주세요.';
    $('#auth-error').hidden = true;
    $('[name=password]', authDlg).autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  }

  function openAuth(m) {
    if (!authDlg) return;
    setMode(m || mode);
    if (!authDlg.open) authDlg.showModal();
    $('[name=name]', authDlg).focus();
  }

  function showAuthError(msg) {
    const el = $('#auth-error');
    el.textContent = msg;
    el.hidden = false;
  }

  if (authDlg) {
    $$('.tabs button', authDlg).forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    $('#auth-close').onclick = () => { sessionStorage.setItem('authDismissed', '1'); authDlg.close(); };
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const name = norm(f.name.value), password = f.password.value;
      if (name.length < 2 || name.length > 20) return showAuthError('이름은 2자 이상 20자 이하로 적어 주세요.');
      if (password.length < 6) return showAuthError('비밀번호는 6자 이상이어야 합니다.');
      $('#auth-submit').disabled = true;
      const email = emailFor(name);
      const res = mode === 'signup'
        ? await sb.auth.signUp({ email, password, options: { data: { name } } })
        : await sb.auth.signInWithPassword({ email, password });
      $('#auth-submit').disabled = false;
      if (res.error) return showAuthError(friendly(res.error.message));
      if (!res.data.session) return showAuthError('가입은 됐지만 로그인되지 않았습니다. 운영진에게 Supabase의 "Confirm email" 설정을 꺼 달라고 알려 주세요.');
      f.reset();
      authDlg.close();
      await refresh();
    };
  }

  /* ---------- 한 칸짜리 입력 대화상자 (이름 변경, 비밀번호 변경) ---------- */
  const askDlg = $('#ask-dialog');
  function ask({ title, label, type = 'text', value = '', error = '' }) {
    return new Promise((resolve) => {
      $('#ask-title').textContent = title;
      $('#ask-label').textContent = label;
      const inp = $('#ask-input');
      inp.type = type; inp.value = value;
      const err = $('#ask-error');
      err.textContent = error; err.hidden = !error;
      askDlg.returnValue = '';
      askDlg.onclose = () => resolve(askDlg.returnValue === 'ok' ? inp.value : null);
      askDlg.showModal();
      inp.focus(); inp.select();
    });
  }

  async function renameFlow() {
    let error = '';
    for (;;) {
      const v = await ask({ title: '이름 변경', label: '새 이름', value: me.name, error });
      if (v == null) return;
      const name = norm(v);
      if (name.length < 2 || name.length > 20) { error = '이름은 2자 이상 20자 이하로 적어 주세요.'; continue; }
      if (name === me.name) return;
      const { error: e } = await sb.rpc('rename_me', { new_name: name });
      if (!e) return refresh();
      error = friendly(e.message);
    }
  }

  async function passwordFlow() {
    let error = '';
    for (;;) {
      const v = await ask({ title: '비밀번호 변경', label: '새 비밀번호 (6자 이상)', type: 'password', error });
      if (v == null) return;
      if (v.length < 6) { error = '비밀번호는 6자 이상이어야 합니다.'; continue; }
      const { error: e } = await sb.auth.updateUser({ password: v });
      if (!e) return;
      error = friendly(e.message);
    }
  }

  /* ---------- 대원 카드 ---------- */
  const cardDlg = $('#card-dialog');
  let cardResolve = null; // ensureCard()가 기다리는 중이면 함수

  function settleCard(ok) {
    const r = cardResolve;
    cardResolve = null;
    if (r) r(ok);
  }

  function openCard() {
    if (!cardDlg || !me) return;
    const f = $('#card-form');
    f.reset();
    ['department', 'grade', 'skill_note', 'hours', 'offline', 'schedule_note', 'teamwork_exp', 'note_to_staff']
      .forEach((n) => (f[n].value = me[n] ?? ''));
    const boxes = $$('[name=skills]', f), known = boxes.map((b) => b.value), have = me.skills || [];
    boxes.forEach((b) => (b.checked = have.includes(b.value)));
    f.skills_other.value = have.filter((s) => !known.includes(s)).join(', ');
    $('#card-error').hidden = true;
    if (!cardDlg.open) cardDlg.showModal();
    f.department.focus();
  }

  // 카드가 이미 작성돼 있으면 true, 아니면 대화상자를 열고 저장되면 true / 닫으면 false.
  function ensureCard() {
    if (!cardDlg || me?.card_completed_at) return Promise.resolve(true);
    return new Promise((resolve) => {
      settleCard(false);
      cardResolve = resolve;
      openCard();
    });
  }

  if (cardDlg) {
    cardDlg.addEventListener('close', () => settleCard(false));
    $('#card-close').onclick = () => cardDlg.close();
    $('#card-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, err = $('#card-error');
      const row = {};
      ['department', 'grade', 'skill_note', 'hours', 'offline', 'schedule_note', 'teamwork_exp', 'note_to_staff']
        .forEach((n) => (row[n] = f[n].value.trim()));
      if (!row.department || !row.grade || !row.hours || !row.offline) {
        err.textContent = '학과, 학년, 주당 시간, 오프라인 참여는 꼭 적어 주세요.';
        err.hidden = false;
        return;
      }
      const skills = [...new Set([
        ...$$('[name=skills]:checked', f).map((b) => b.value),
        ...f.skills_other.value.split(',').map((s) => s.trim()).filter(Boolean),
      ])];
      Object.keys(row).forEach((k) => { if (!row[k]) row[k] = null; });
      $('#card-submit').disabled = true;
      const { error } = await sb.from('profiles').update({
        ...row, skills,
        card_completed_at: me.card_completed_at ?? nowIso(),
        updated_at: nowIso(),
      }).eq('id', me.id);
      $('#card-submit').disabled = false;
      if (error) { err.textContent = friendly(error.message); err.hidden = false; return; }
      await loadMe();
      settleCard(true);      // close 이벤트보다 먼저 확정해야 false로 덮이지 않는다
      cardDlg.close();
    };
  }

  /* ---------- "배정되지 않을 경우" 라디오 (팀 폼 · 내 신청 현황 공용) ---------- */
  function wireFallback(box) {
    if (!box) return;
    const detail = $('.fallback-detail', box);
    const sync = () => { if (detail) detail.hidden = $('[name=fallback]:checked', box)?.value !== '1지망이 아니면 불참'; };
    $$('[name=fallback]', box).forEach((r) => { r.checked = r.value === me?.fallback; r.onchange = sync; });
    $$('[name=fallback_detail]', box).forEach((r) => (r.checked = r.value === me?.fallback_detail));
    sync();
  }

  // 선택이 없으면 아무것도 하지 않는다. 저장하면 error 또는 null.
  async function saveFallback(box) {
    const fb = $('[name=fallback]:checked', box)?.value;
    if (!fb) return null;
    const { error } = await sb.from('profiles').update({
      fallback: fb,
      fallback_detail: fb === '1지망이 아니면 불참' ? ($('[name=fallback_detail]:checked', box)?.value ?? null) : null,
      updated_at: nowIso(),
    }).eq('id', me.id);
    return error;
  }

  /* ---------- 내 신청 현황 ---------- */
  const mineDlg = $('#mine-dialog');

  function renderMine() {
    const list = $('#mine-list');
    // 프로젝트(rank 1·2) 먼저, 스터디(rank null) 나중
    const items = [...myApps.filter((a) => a.rank != null), ...myApps.filter((a) => a.rank == null)];
    list.innerHTML = items.length ? items.map((a) => {
      const t = teamOf(a.team_slug);
      const roles = esc(a.role_name) + (a.role_second ? ' / ' + esc(a.role_second) : '');
      const closed = t.status && t.status !== '모집중';
      const acts = (closed
        ? '<span class="muted">모집 마감</span>'
        : (a.rank == null ? '' : `<button type="button" data-swap="${a.id}">${3 - a.rank}지망으로 바꾸기</button>`)
          + `<a href="${esc(t.url ?? '#')}">신청서 보기·수정 →</a>`)
        + `<button type="button" data-drop="${a.id}">취소</button>`;
      const badge = a.rank == null ? '<span class="rank study">스터디</span>' : `<span class="rank">${a.rank}지망</span>`;
      return `<div class="mine-item"><div>${badge} <strong>${esc(t.title ?? a.team_slug)}</strong> <span class="muted">· ${roles}</span></div><div class="acts">${acts}</div></div>`;
    }).join('') : '<p class="muted">아직 신청한 팀이 없습니다. 팀 페이지에서 신청해 주세요.</p>';

    $$('[data-swap]', list).forEach((b) => (b.onclick = async () => {
      const a = myApps.find((x) => String(x.id) === b.dataset.swap);
      const { error } = await sb.rpc('set_rank', { app_id: a.id, new_rank: 3 - a.rank });
      if (error) return alert(friendly(error.message));
      await loadMyApps();
      renderMine();
      renderTeam();
    }));
    $$('[data-drop]', list).forEach((b) => (b.onclick = async () => {
      if (!confirm('신청을 취소할까요?')) return;
      const { error } = await sb.from('applications').delete().eq('id', b.dataset.drop);
      if (error) return alert(friendly(error.message));
      await loadMyApps();
      renderMine();
      renderTeam();
    }));

    const warn = $('#fallback-warn');
    const msg = me?.fallback === '2지망 팀에 참여' && !myApps.some((a) => a.rank === 2)
      ? '2지망 팀이 없습니다. 2지망을 신청하거나 선택을 바꿔 주세요.'
      : me?.fallback && !myApps.some((a) => a.rank === 1) ? '1지망 팀이 없습니다.' : '';
    warn.textContent = msg;
    warn.hidden = !msg;
  }

  async function openMine() {
    if (!mineDlg || !me) return;
    await loadMyApps();
    wireFallback($('#fallback-form'));
    renderMine();
    if (!mineDlg.open) mineDlg.showModal();
  }

  if (mineDlg) {
    $('#mine-close').onclick = () => mineDlg.close();
    $('#fallback-form').onsubmit = async (e) => {
      e.preventDefault();
      $('#fallback-save').disabled = true;
      const error = await saveFallback(e.target);
      $('#fallback-save').disabled = false;
      if (error) return alert(friendly(error.message));
      await loadMe();
      wireFallback(e.target);
      renderMine();
    };
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const details = btn.closest('details');
    if (details) details.open = false;
    switch (btn.dataset.act) {
      case 'login': openAuth('login'); break;
      case 'logout': await sb.auth.signOut(); await refresh(); break;
      case 'card': openCard(); break;
      case 'mine': await openMine(); break;
      case 'rename': await renameFlow(); break;
      case 'password': await passwordFlow(); break;
      case 'delete':
        if (!confirm('계정과 내가 남긴 신청·제안을 모두 지웁니다. 계속할까요?')) return;
        await sb.rpc('delete_me');
        try { await sb.auth.signOut(); } catch (_) { /* 이미 지워진 계정 */ }
        await refresh();
        break;
    }
  });

  /* ---------- 팀 상세: 신청 ---------- */
  let editId = null; // 수정 중인 내 신청 id (새 신청이면 null)

  // 1지망일 때만 "배정되지 않을 경우"를 묻는다.
  function syncRank(form) {
    const r = $('[name=rank]:checked', form);   // 스터디 폼에는 순위 라디오가 없다
    if (!r) return;
    const block = $('#fallback-block', form);
    if (block) block.hidden = r.value !== '1';
  }

  function openApplyForm(app) {
    const form = $('#apply-form');
    if (!form) return;
    form.reset();
    if (app) {
      $$('[name=rank]', form).forEach((r) => (r.checked = Number(r.value) === app.rank));
      form.role_name.value = app.role_name;
      if (form.role_second) form.role_second.value = app.role_second ?? '';
      $$('[name=role_flex]', form).forEach((r) => (r.checked = r.value === app.role_flex));
      form.motivation.value = app.motivation ?? '';
      form.concerns.value = app.concerns ?? '';
      form.takeaway.value = app.takeaway ?? '';
    }
    editId = app?.id ?? null;
    $('#apply-submit').textContent = app ? '수정 저장' : '신청하기';
    $('#apply-cancel-edit').hidden = !app;
    $('#apply-error').hidden = true;
    wireFallback($('#fallback-block', form));
    $$('[name=rank]', form).forEach((r) => (r.onchange = () => syncRank(form)));
    syncRank(form);
    const done = $('#apply-done');
    if (done) done.hidden = true;
    form.hidden = false;
  }

  async function renderTeam() {
    const card = $('.apply-card[data-team]');
    if (!card) return;
    const slug = card.dataset.team;
    const isStudy = card.dataset.kind === 'study';   // 스터디: 지망 순위 없음, 개수 제한 없음
    const open = card.dataset.status === '모집중';
    const loginBox = $('#apply-login'), form = $('#apply-form'), done = $('#apply-done'), list = $('#applicants');
    editId = null;
    if (loginBox) loginBox.hidden = !!me;
    if (form) form.hidden = true;
    if (done) done.hidden = true;
    if (list) list.hidden = true;
    if (!me) return;

    const { data: apps, error } = await sb.from('applications')
      .select('id,user_id,team_slug,rank,role_name,role_second,created_at,profiles(name,department,grade)')
      .eq('team_slug', slug).order('created_at');
    if (error) { console.error(error); return; }

    const mine = apps.find((a) => a.user_id === me.id);
    if (mine && done) {
      done.hidden = false;
      if (!isStudy) {
        $('#apply-rank').textContent = mine.rank === 2 ? '2지망' : '1지망';
        $('#apply-role').textContent = mine.role_name;
      }
    } else if (!mine && open) {
      openApplyForm(null);
    }

    if (list) {
      $('#applicant-count').textContent = apps.length;
      $('#applicant-list').innerHTML = apps.length
        ? apps.map((a) => {
            const p = a.profiles || {};
            const meta = [p.department, p.grade].filter(Boolean).join(' · ');
            return `<li><strong>${esc(p.name ?? '?')}</strong>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}<span class="role">${esc(a.role_name)}</span>${a.rank === 2 ? '<span class="rank2">2지망</span>' : ''}</li>`;
          }).join('')
        : '<li class="muted">아직 신청자가 없습니다.</li>';
      list.hidden = false;
    }

    if (form) {
      $('#apply-cancel-edit').onclick = () => renderTeam();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = $('#apply-error'), btn = $('#apply-submit');
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        err.hidden = true;
        const motivation = form.motivation.value.trim();
        if (!motivation) return fail(isStudy ? '참여하려는 이유를 적어 주세요.' : '지원하는 이유를 적어 주세요.');
        btn.disabled = true;
        try {
          const editing = editId;
          if (!editing && !(await ensureCard())) return;
          await loadMyApps();
          // 스터디는 개수 제한이 없다. 두 팀 제한은 순위가 있는 프로젝트 신청에만 적용된다.
          if (!isStudy && !editing && myApps.filter((a) => a.rank != null).length >= 2) return fail('이미 두 팀에 신청했습니다. 내 신청 현황에서 정리한 뒤 다시 신청해 주세요.');

          const rank = isStudy ? null : Number($('[name=rank]:checked', form).value);
          if (!isStudy) {
            const clash = myApps.find((a) => a.rank === rank && a.id !== editing);
            if (clash) {
              if (!confirm(`${teamOf(clash.team_slug).title ?? clash.team_slug}이(가) ${3 - rank}지망으로 바뀝니다. 계속할까요?`)) return;
              // 새 신청이면 반대 순위가 비어 있다(위에서 2건 미만임을 확인). 수정이면 set_rank로 맞바꾼다.
              const { error: e1 } = editing
                ? await sb.rpc('set_rank', { app_id: editing, new_rank: rank })
                : await sb.from('applications').update({ rank: 3 - rank, updated_at: nowIso() }).eq('id', clash.id);
              if (e1) return fail(friendly(e1.message));
            }
          }

          const row = {
            team_slug: slug, rank, motivation,
            role_name: form.role_name.value,
            role_second: form.role_second?.value || null,
            role_flex: $('[name=role_flex]:checked', form)?.value ?? null,
            concerns: form.concerns.value.trim() || null,
            takeaway: form.takeaway.value.trim() || null,
            updated_at: nowIso(),
          };
          const { error: e2 } = editing
            ? await sb.from('applications').update(row).eq('id', editing)
            : await sb.from('applications').insert({ ...row, user_id: me.id });
          if (e2) return fail(friendly(e2.message));

          if (rank === 1) {
            const e3 = await saveFallback($('#fallback-block', form));
            if (e3) return fail(friendly(e3.message));
          }
          form.reset();
          await refresh();
        } finally {
          btn.disabled = false;
        }
      };
    }
    if (done) {
      $('#edit-apply').onclick = () => openApplyForm(myApps.find((a) => a.id === mine.id) ?? mine);
      $('#cancel-apply').onclick = async () => {
        if (!confirm('신청을 취소할까요?')) return;
        const { error: e4 } = await sb.from('applications').delete().eq('id', mine.id);
        if (e4) return alert(friendly(e4.message));
        await refresh();
      };
    }
  }

  /* ---------- 목록: 신청 인원 배지 + 프로젝트 제안 ---------- */
  const proposeDlg = $('#propose-dialog');
  const STATUS_CLASS = { '제안됨': 'open', '검토중': 'open', '팀으로 전환됨': 'done', '보류': 'closed' };

  function openPropose(p) {
    const f = $('#propose-form');
    f.reset();
    f.id.value = p?.id ?? '';
    f.title.value = p?.title ?? '';
    f.tagline.value = p?.tagline ?? '';
    f.topics.value = (p?.topics ?? []).join(', ');
    f.body.value = p?.body ?? '';
    $('#propose-title').textContent = p ? '제안 수정' : '새 프로젝트 제안';
    $('#propose-submit').textContent = p ? '수정 저장' : '제안 올리기';
    $('#propose-error').hidden = true;
    proposeDlg.showModal();
    f.title.focus();
  }

  async function renderIndex() {
    const sec = $('#proposals');
    if (!sec) return;
    sec.hidden = !me;

    // 신청 인원은 로그인 전에도 보인다 (team_counts는 slug와 숫자만 돌려준다)
    const { data: rows, error: countErr } = await sb.rpc('team_counts');
    if (countErr) console.error(countErr);
    const counts = {};
    (rows || []).forEach((r) => { counts[r.team_slug] = r.n; });
    $$('.team-card').forEach((c) => {
      const n = counts[c.dataset.slug], el = $('.applicants', c);
      if (!el) return;
      el.hidden = !n;
      el.textContent = n ? ` · 신청 ${n}명` : '';
    });

    if (!me) return;

    const [{ data: props, error }, { data: likes }] = await Promise.all([
      // proposal_likes가 생기며 proposals↔profiles 경로가 둘이 되어 FK 이름으로 관계를 지정한다
      sb.from('proposals').select('*, profiles!proposals_user_id_fkey(name)').order('created_at', { ascending: false }),
      sb.from('proposal_likes').select('proposal_id,user_id'),
    ]);

    if (error) { console.error(error); return; }
    const likeCount = {}, myLike = {};
    (likes || []).forEach((l) => {
      likeCount[l.proposal_id] = (likeCount[l.proposal_id] || 0) + 1;
      if (l.user_id === me.id) myLike[l.proposal_id] = true;
    });
    $('#proposals-empty').hidden = props.length > 0;
    $('#proposal-grid').innerHTML = props.map((p) => `
      <article class="team-card proposal" data-id="${p.id}">
        <div class="card-content">
          <div class="card-meta">
            <span class="topic">${esc((p.topics || []).join(' · ')) || '토픽 미정'}</span>
            <span class="status ${STATUS_CLASS[p.status] || 'open'}">${esc(p.status)}</span>
          </div>
          <h2>${esc(p.title)}</h2>
          <p class="summary">${esc(p.tagline)}</p>
          ${p.body ? `<details class="more"><summary>자세히</summary><p>${esc(p.body).replace(/\n/g, '<br>')}</p></details>` : ''}
          <footer><button type="button" class="like${myLike[p.id] ? ' on' : ''}" data-like="${esc(p.id)}" aria-pressed="${!!myLike[p.id]}" aria-label="좋아요"><span class="heart">♥</span> <span class="n">${likeCount[p.id] || 0}</span></button>제안자 ${esc(p.profiles?.name ?? '?')}${p.user_id === me.id ? '<span class="mine"><button type="button" data-edit>수정</button><button type="button" data-remove>삭제</button></span>' : ''}</footer>
        </div>
      </article>`).join('');

    $$('#proposal-grid [data-like]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.like, was = b.classList.contains('on'), n = $('.n', b);
      b.disabled = true;
      b.classList.toggle('on', !was);
      b.setAttribute('aria-pressed', String(!was));
      n.textContent = Math.max(0, Number(n.textContent) + (was ? -1 : 1));
      const { error: e } = was
        ? await sb.from('proposal_likes').delete().match({ proposal_id: id, user_id: me.id })
        : await sb.from('proposal_likes').insert({ proposal_id: id, user_id: me.id });
      b.disabled = false;
      if (!e) return;
      b.classList.toggle('on', was);
      b.setAttribute('aria-pressed', String(was));
      n.textContent = Math.max(0, Number(n.textContent) + (was ? 1 : -1));
      alert(friendly(e.message));
    }));
    $$('#proposal-grid [data-edit]').forEach((b) => (b.onclick = () => openPropose(props.find((p) => String(p.id) === b.closest('.proposal').dataset.id))));
    $$('#proposal-grid [data-remove]').forEach((b) => (b.onclick = async () => {
      if (!confirm('이 제안을 삭제할까요?')) return;
      const { error: e } = await sb.from('proposals').delete().eq('id', b.closest('.proposal').dataset.id);
      if (e) return alert(friendly(e.message));
      renderIndex();
    }));
  }

  // ---------- 방명록 ----------
  // 스티커 경로: 마크업의 첫 스티커 src에서 파일명을 뗀 것(baseurl 포함). 상세 페이지에는 폼이 없어 빈 문자열.
  const STICKER_BASE = ($('#gb-form .gb-sticker img')?.getAttribute('src') || '').replace(/[a-z]+-\d\d\.png$/, '');
  let gbSticker = null;
  function fmtDate(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  // ponytail: 전부 불러와 브라우저에서 정렬·페이지. PostgREST가 요청당 1000행에서 자르므로(좋아요가 먼저 닿는다) 넘으면 집계 뷰/RPC로 바꾼다.
  let gbRows = [], gbLikeCount = {}, gbMyLike = {};
  let gbSort = 'new', gbPage = 1, gbSize = 5;

  async function renderGuestbook() {
    const sec = $('#guestbook');
    if (!sec) return;
    sec.hidden = !me;
    if (!me) return;

    const [{ data: rows, error }, { data: likes, error: likeErr }] = await Promise.all([
      sb.from('guestbook')
        .select('id,user_id,body,sticker,created_at,profiles!guestbook_user_id_fkey(name)')
        .order('created_at', { ascending: false }),
      sb.from('guestbook_likes').select('entry_id,user_id'),
    ]);
    if (error) { console.error(error); return; }
    if (likeErr) console.error(likeErr);
    gbRows = rows;
    gbLikeCount = {}; gbMyLike = {};
    (likes || []).forEach((l) => {
      gbLikeCount[l.entry_id] = (gbLikeCount[l.entry_id] || 0) + 1;
      if (l.user_id === me.id) gbMyLike[l.entry_id] = true;
    });
    drawGuestbook();
  }

  // 페이지 번호: 첫·끝·현재±1, 사이가 비면 '…'
  function gbPageList(cur, total) {
    const nums = [...new Set([1, cur - 1, cur, cur + 1, total])].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
    const out = [];
    nums.forEach((p, i) => { if (i && p - nums[i - 1] > 1) out.push('…'); out.push(p); });
    return out;
  }

  function drawGuestbook() {
    // gbRows는 최신순이고 sort는 안정 정렬이라, 인기순에서 좋아요 수가 같으면 최신순이 유지된다
    const sorted = gbSort === 'hot'
      ? [...gbRows].sort((a, b) => (gbLikeCount[b.id] || 0) - (gbLikeCount[a.id] || 0))
      : gbRows;
    const pages = Math.max(1, Math.ceil(sorted.length / gbSize));
    gbPage = Math.min(Math.max(1, gbPage), pages);
    const slice = sorted.slice((gbPage - 1) * gbSize, gbPage * gbSize);

    $('#gb-empty').hidden = gbRows.length > 0;
    $('#gb-tools').hidden = gbRows.length === 0;
    $$('[data-gb-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gbSort === gbSort)));

    $('#gb-list').innerHTML = slice.map((r) => `
      <article class="gb-entry" data-id="${esc(r.id)}">
        ${r.sticker ? `<img class="gb-entry-sticker" src="${STICKER_BASE}${esc(r.sticker)}.png" alt="">` : ''}
        <div class="gb-entry-body">
          <p>${esc(r.body)}</p>
          <footer><button type="button" class="like${gbMyLike[r.id] ? ' on' : ''}" data-like="${esc(r.id)}" aria-pressed="${!!gbMyLike[r.id]}" aria-label="좋아요"><span class="heart">♥</span> <span class="n">${gbLikeCount[r.id] || 0}</span></button>${esc(r.profiles?.name ?? '?')} · ${fmtDate(r.created_at)}${r.user_id === me.id ? ' <button type="button" class="gb-del" data-remove>삭제</button>' : ''}</footer>
        </div>
      </article>`).join('');

    $('#gb-pager').innerHTML = pages < 2 ? '' : [
      `<button type="button" class="gb-page" data-page="${gbPage - 1}" aria-label="이전 페이지"${gbPage === 1 ? ' disabled' : ''}>‹</button>`,
      ...gbPageList(gbPage, pages).map((p) => (p === '…'
        ? '<span class="gb-gap" aria-hidden="true">…</span>'
        : `<button type="button" class="gb-page" data-page="${p}"${p === gbPage ? ' aria-current="page"' : ''}>${p}</button>`)),
      `<button type="button" class="gb-page" data-page="${gbPage + 1}" aria-label="다음 페이지"${gbPage === pages ? ' disabled' : ''}>›</button>`,
    ].join('');

    $$('#gb-list [data-like]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.like, was = !!gbMyLike[id], n = $('.n', b);
      // 인기순이어도 누른 즉시 순서를 바꾸지 않는다(글이 눈앞에서 튀지 않도록). 다음 정렬·페이지 이동 때 반영.
      const set = (on) => {
        gbMyLike[id] = on;
        gbLikeCount[id] = Math.max(0, (gbLikeCount[id] || 0) + (on ? 1 : -1));
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        n.textContent = gbLikeCount[id];
      };
      b.disabled = true;
      set(!was);
      const { error: e } = was
        ? await sb.from('guestbook_likes').delete().match({ entry_id: id, user_id: me.id })
        : await sb.from('guestbook_likes').insert({ entry_id: id, user_id: me.id });
      b.disabled = false;
      if (e) { set(was); alert(friendly(e.message)); }
    }));

    $$('#gb-list [data-remove]').forEach((b) => (b.onclick = async () => {
      if (!confirm('이 글을 지울까요?')) return;
      const id = b.closest('.gb-entry').dataset.id;
      const { error: e } = await sb.from('guestbook').delete().eq('id', id);
      if (e) { alert(friendly(e.message)); return; }
      renderGuestbook();   // 현재 페이지 유지, 마지막 글이면 앞 페이지로 당겨진다
    }));
  }
  // 정렬·개수·페이지는 DB를 다시 부르지 않고 다시 그리기만 한다
  $$('[data-gb-sort]').forEach((b) => (b.onclick = () => { gbSort = b.dataset.gbSort; gbPage = 1; drawGuestbook(); }));
  const gbSizeSel = $('#gb-size');
  if (gbSizeSel) gbSizeSel.onchange = () => { gbSize = Number(gbSizeSel.value); gbPage = 1; drawGuestbook(); };
  const gbPager = $('#gb-pager');
  if (gbPager) gbPager.onclick = (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    gbPage = Number(b.dataset.page);
    drawGuestbook();
    $('#gb-pager [aria-current]')?.focus();
    $('#gb-tools').scrollIntoView({ block: 'nearest' });
  };
  // 스티커 선택(토글)과 제출 핸들러는 한 번만 연결한다
  $$('.gb-sticker').forEach((b) => (b.onclick = () => {
    gbSticker = gbSticker === b.dataset.sticker ? null : b.dataset.sticker;
    $$('.gb-sticker').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.sticker === gbSticker)));
  }));
  const gbForm = $('#gb-form');
  if (gbForm) gbForm.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#gb-error'), body = gbForm.body.value.trim();
    err.hidden = true;
    if (!body) { err.textContent = '내용을 적어 주세요.'; err.hidden = false; return; }
    $('#gb-submit').disabled = true;
    const { error } = await sb.from('guestbook').insert({ user_id: me.id, body, sticker: gbSticker });
    $('#gb-submit').disabled = false;
    if (error) { err.textContent = friendly(error.message); err.hidden = false; return; }
    gbForm.reset(); gbSticker = null;
    $$('.gb-sticker').forEach((x) => x.setAttribute('aria-checked', 'false'));
    gbSort = 'new'; gbPage = 1;
    renderGuestbook();
  };

  // ---------- 운영진 페이지 (읽기 전용) ----------
  // 권한은 DB 함수(staff_members / staff_applications)가 막는다. 운영진이 아니면 빈 배열이 온다.
  const ST_CARD = [
    ['skills', '다뤄 본 기술'], ['skill_note', '가장 깊게 다뤄 본 기술로 만든 것'], ['hours', '주당 투입 가능 시간'],
    ['offline', '오프라인 모임'], ['schedule_note', '병행 일정'], ['teamwork_exp', '팀 프로젝트 경험'],
    ['note_to_staff', '운영진·팀장에게 알릴 사항'], ['fallback', '미배정 시'], ['fallback_detail', '미배정 시(상세)'],
  ];
  const ST_APP = [
    ['role_name', '희망 역할(1지망)'], ['role_second', '희망 역할(2지망)'], ['role_flex', '역할 조정'],
    ['motivation', '지원 이유'], ['concerns', '궁금하거나 우려되는 점'], ['takeaway', '얻고 싶은 것 · 기여하고 싶은 바'],
  ];
  const stVal = (v) => (Array.isArray(v) ? v.join(', ') : v) || '';
  const stRows = (obj, fields) => fields.filter(([k]) => stVal(obj[k])).map(([k, label]) =>
    `<dt>${esc(label)}</dt><dd>${esc(stVal(obj[k])).replace(/\n/g, '<br>')}</dd>`).join('');
  const stText = (obj, fields) => fields.filter(([k]) => stVal(obj[k])).map(([k, label]) => `- ${label}: ${stVal(obj[k])}`).join('\n');
  const stRank = (a) => (a.rank == null ? '스터디' : `${a.rank}지망`);

  async function renderStaff() {
    const page = $('#staff-page');
    if (!page) return;
    const msg = $('#st-msg'), body = $('#st-body');
    body.hidden = true; msg.hidden = false;
    if (!me) { msg.textContent = '로그인이 필요합니다.'; return; }
    if (!me.is_staff) { msg.textContent = '운영진 전용 페이지입니다.'; return; }

    const [{ data: members, error: e1 }, { data: apps, error: e2 }] = await Promise.all([
      sb.rpc('staff_members'), sb.rpc('staff_applications'),
    ]);
    if (e1 || e2) { console.error(e1 || e2); msg.textContent = friendly((e1 || e2).message); return; }
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    const who = (m) => `${m.name}${m.department || m.grade ? ` (${[m.department, m.grade].filter(Boolean).join(' ')})` : ''}`;
    // 사이트에 있는 팀 먼저, 그 밖의 slug(삭제된 팀 등)는 뒤에
    const slugs = [...new Set([...Object.keys(window.TEAMS || {}), ...apps.map((a) => a.team_slug)])];

    const title = (s) => window.TEAMS?.[s]?.title ?? s;
    const roles = (s) => window.TEAMS?.[s]?.roles || [];
    // 모집 인원 "1~2" / "3" / "4명 이상" → [최소, 최대]. 숫자가 없으면 null
    const range = (c) => { const n = String(c ?? '').match(/\d+/g); return n ? [+n[0], +(n[1] ?? n[0])] : null; };
    const need = (s) => {
      const rs = roles(s).map((r) => range(r.count)).filter(Boolean);
      if (!rs.length) return '-';
      const lo = rs.reduce((x, r) => x + r[0], 0), hi = rs.reduce((x, r) => x + r[1], 0);
      return lo === hi ? `${lo}명` : `${lo}~${hi}명`;
    };

    $('#st-summary').innerHTML = `<thead><tr><th>팀</th><th>모집</th><th>1지망</th><th>2지망</th><th>합계</th></tr></thead><tbody>${slugs.map((s) => {
      const list = apps.filter((a) => a.team_slug === s), r1 = list.filter((a) => a.rank === 1).length;
      const ranks = s.startsWith('study-') ? '<td>-</td><td>-</td>' : `<td>${r1}</td><td>${list.length - r1}</td>`;
      return `<tr data-slug="${esc(s)}"><td>${esc(title(s))}</td><td>${need(s)}</td>${ranks}<td>${list.length}</td></tr>`;
    }).join('')}</tbody>`;

    // 대원별 한 줄: 1지망 / 2지망 / 스터디
    const pick = (m, r) => apps.find((a) => a.user_id === m.id && a.rank === r);
    const cell = (a) => (a ? `${esc(title(a.team_slug))}<br><span class="muted">${esc(a.role_name || '')}</span>` : '<span class="muted">-</span>');
    $('#st-people').innerHTML = `<thead><tr><th>대원</th><th>1지망</th><th>2지망</th><th>스터디</th><th>카드</th></tr></thead><tbody>${members.map((m) => {
      const mine = apps.filter((a) => a.user_id === m.id);
      const studies = mine.filter((a) => a.rank == null).map((a) => esc(title(a.team_slug))).join('<br>');
      return `<tr data-q="${esc(who(m))}" data-slugs="${esc(mine.map((a) => a.team_slug).join(' '))}"><td>${esc(who(m))}</td><td>${cell(pick(m, 1))}</td><td>${cell(pick(m, 2))}</td><td>${studies || '<span class="muted">-</span>'}</td><td>${m.card_completed_at ? '작성' : '<span class="muted">미작성</span>'}</td></tr>`;
    }).join('')}</tbody>`;

    // 역할별 집계: 신청서의 희망 역할(1순위) / 2순위 역할 기준. 1순위가 모집 인원 상한을 넘으면 빨갛게
    const roleTable = (s, list) => {
      const names = [...new Set([...roles(s).map((r) => r.name), ...list.map((a) => a.role_name).filter(Boolean)])];
      if (!names.length) return '';
      return `<div class="table-wrap"><table class="st-summary st-roles"><thead><tr><th>역할</th><th>모집</th><th>희망 역할로 신청</th><th>2순위 역할로 신청</th></tr></thead><tbody>${names.map((n) => {
        const r = roles(s).find((x) => x.name === n);
        const c1 = list.filter((a) => a.role_name === n).length, c2 = list.filter((a) => a.role_second === n).length;
        const lim = range(r?.count), over = lim && c1 > lim[1];
        const cnt = r ? esc(String(r.count)) + (/\d$/.test(String(r.count)) ? '명' : '') : '-';
        return `<tr><td>${esc(n)}</td><td>${cnt}</td><td${over ? ' class="st-over"' : ''}>${c1}</td><td>${c2}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    };

    $('#st-teams').innerHTML = slugs.map((s) => {
      const list = apps.filter((a) => a.team_slug === s);
      return `<section class="st-team" data-slug="${esc(s)}">
        <div class="st-team-head"><h3 class="section-title">${esc(title(s))} <span class="muted">${list.length}명</span></h3>
          ${list.length ? '<button type="button" class="link" data-st-copy>이 팀 신청서 복사</button>' : ''}</div>
        ${list.length ? roleTable(s, list) : ''}
        ${list.length ? list.map((a) => {
          const m = byId[a.user_id] || { name: '?' };
          return `<details class="st-app" data-q="${esc(who(m))}"><summary><strong>${esc(who(m))}</strong> · ${stRank(a)} · ${esc(a.role_name)}</summary>
            <h4>신청서</h4><dl>${stRows(a, ST_APP)}</dl>
            <h4>대원 카드</h4><dl>${stRows(m, ST_CARD) || '<dd class="muted">작성하지 않음</dd>'}</dl></details>`;
        }).join('') : '<p class="muted">아직 신청이 없습니다.</p>'}
      </section>`;
    }).join('');

    const applied = new Set(apps.filter((a) => a.rank != null).map((a) => a.user_id));   // 프로젝트 신청 기준
    const idle = members.filter((m) => !applied.has(m.id));
    $('#st-idle').innerHTML = idle.length
      ? idle.map((m) => `<details class="st-app" data-q="${esc(who(m))}"><summary><strong>${esc(who(m))}</strong>${m.card_completed_at ? '' : ' · <span class="muted">카드 미작성</span>'}</summary><dl>${stRows(m, ST_CARD) || '<dd class="muted">작성하지 않음</dd>'}</dl></details>`).join('')
      : '<p class="muted">모든 대원이 프로젝트를 신청했습니다.</p>';

    // 검색·필터 (화면에서 숨기기만 한다)
    const sel = $('#st-team');
    sel.innerHTML = '<option value="">모든 팀</option>' + slugs.map((s) => `<option value="${esc(s)}">${esc(title(s))}</option>`).join('');
    const applyFilter = () => {
      const q = $('#st-q').value.trim().toLowerCase(), t = sel.value;
      const miss = (el) => !!q && !el.dataset.q.toLowerCase().includes(q);
      $$('#st-summary tbody tr').forEach((tr) => (tr.hidden = !!t && tr.dataset.slug !== t));
      $$('#st-people tbody tr').forEach((tr) => (tr.hidden = miss(tr) || (!!t && !tr.dataset.slugs.split(' ').includes(t))));
      $$('.st-team').forEach((sec) => (sec.hidden = !!t && sec.dataset.slug !== t));
      $$('#st-teams .st-app, #st-idle .st-app').forEach((d) => (d.hidden = miss(d)));
    };
    $('#st-q').oninput = applyFilter; sel.onchange = applyFilter; applyFilter();

    // CSV: 신청서 한 줄씩 + 아무 데도 신청하지 않은 대원. 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다.
    $('#st-csv').onclick = () => {
      const head = ['이름', '학과', '학년', '팀', '지망', ...ST_APP.map((f) => f[1]), ...ST_CARD.map((f) => f[1]), '카드 작성'];
      const row = (m, a) => [m.name, m.department, m.grade, a ? title(a.team_slug) : '', a ? stRank(a) : '미신청',
        ...ST_APP.map(([k]) => (a ? stVal(a[k]) : '')), ...ST_CARD.map(([k]) => stVal(m[k])), m.card_completed_at ? '작성' : '미작성'];
      const rows = [head, ...apps.map((a) => row(byId[a.user_id] || { name: '?' }, a)),
        ...members.filter((m) => !apps.some((a) => a.user_id === m.id)).map((m) => row(m, null))];
      const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: `팀빌딩-신청현황-${new Date().toISOString().slice(0, 10)}.csv` });
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    $$('[data-st-copy]').forEach((b) => (b.onclick = async () => {
      const s = b.closest('.st-team').dataset.slug;
      const text = [`# ${title(s)}`, ...apps.filter((a) => a.team_slug === s).map((a) => {
        const m = byId[a.user_id] || { name: '?' };
        return `\n## ${who(m)} · ${stRank(a)}\n[신청서]\n${stText(a, ST_APP)}\n[대원 카드]\n${stText(m, ST_CARD) || '- 작성하지 않음'}`;
      })].join('\n');
      try { await navigator.clipboard.writeText(text); b.textContent = '복사했습니다'; }
      catch { b.textContent = '복사하지 못했습니다'; }
      setTimeout(() => (b.textContent = '이 팀 신청서 복사'), 2000);
    }));

    msg.hidden = true; body.hidden = false;
  }

  if (proposeDlg) {
    $('#propose-btn').onclick = () => openPropose(null);
    $('#propose-close').onclick = () => proposeDlg.close();
    $('#propose-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const row = {
        title: f.title.value.trim(), tagline: f.tagline.value.trim(),
        topics: f.topics.value.split(',').map((s) => s.trim()).filter(Boolean),
        body: f.body.value.trim() || null,
      };
      const err = $('#propose-error');
      if (row.title.length < 2) { err.textContent = '프로젝트명을 2자 이상 적어 주세요.'; err.hidden = false; return; }
      if (!row.tagline) { err.textContent = '한 줄 소개를 적어 주세요.'; err.hidden = false; return; }
      $('#propose-submit').disabled = true;
      const q = f.id.value
        ? sb.from('proposals').update({ ...row, updated_at: new Date().toISOString() }).eq('id', f.id.value)
        : sb.from('proposals').insert({ ...row, user_id: me.id });
      const { error: e2 } = await q;
      $('#propose-submit').disabled = false;
      if (e2) { err.textContent = friendly(e2.message); err.hidden = false; return; }
      proposeDlg.close();
      renderIndex();
    };
  }

  $$('.dlg-x').forEach((b) => (b.onclick = () => b.closest('dialog').close()));

  /* ---------- 진입 공지 (첫 화면에서만) ---------- */
  // 닫기(확인·×·Esc)는 기록하지 않는다 → 첫 화면에 다시 들어오면 또 뜬다.
  // "다시 보지 않기"만 localStorage에 기록한다. 저장소를 못 쓰면 매번 보여 준다.
  const noticeDlg = $('#notice-dialog');
  if (noticeDlg) {
    const noticeId = noticeDlg.dataset.noticeId;
    const key = 'notice-hidden';
    let hidden = false;
    try { hidden = window.localStorage.getItem(key) === noticeId; } catch { /* 무시 */ }
    $('#notice-ok').onclick = () => noticeDlg.close();
    $('#notice-never').onclick = () => {
      try { window.localStorage.setItem(key, noticeId); } catch { /* 무시 */ }
      noticeDlg.close();
    };
    if (!hidden) noticeDlg.showModal();
  }

  /* ---------- 시작 ---------- */
  async function refresh() {
    await loadMe();
    renderHeader();
    if (me) await loadMyApps();
    await Promise.all([renderTeam(), renderIndex(), renderGuestbook(), renderStaff()]);
  }

  refresh();
})();
