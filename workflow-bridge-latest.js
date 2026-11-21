/* SW AI OFFICE adapter for the canonical SW_AI_Office_Latest.html.
 * Intercepts only Alex's send action. Other employee chats keep their native LLM path.
 * The canonical office HTML and its existing runDirective implementation remain untouched.
 */
(function () {
  'use strict';
  if (window.__SW_LATEST_WORKFLOW_BRIDGE__) return;
  window.__SW_LATEST_WORKFLOW_BRIDGE__ = true;

  const textOf = value => String(value == null ? '' : value).trim();

  function departmentOf(person) {
    const badge = textOf(person.badge), room = textOf(person.room);
    if (badge.includes('경영관리')) return '경영관리팀';
    if (badge.includes('총무')) return '총무팀';
    if (badge.includes('전략기획')) return '전략기획팀';
    if (badge.includes('법무')) return '법무팀';
    if (badge.includes('IR')) return 'IR팀';
    if (badge.includes('기술') || badge.includes('IT')) return '기술·IT팀';
    if (room === 'hq') return '본부장실';
    if (room === 'ceo') return '대표이사실';
    if (room === 'legal') return '법무팀';
    if (room === 'ir') return 'IR팀';
    if (room === 'it') return '기술·IT팀';
    return '경영관리팀';
  }

  function employeeRoster() {
    if (typeof EMP === 'undefined' || !Array.isArray(EMP)) {
      throw new Error('사무실 직원 명단을 읽을 수 없습니다.');
    }
    const roster = EMP.map(person => ({
      id: person.id === 'ceo1' ? 'COO' : textOf(person.id),
      name: textOf(person.name),
      department: departmentOf(person),
      position: textOf(person.badge),
      instruction: textOf(person.duty)
    }));
    if (!roster.some(person => person.id === 'COO')) {
      throw new Error('대표이사 피터(COO) 정보가 직원 명단에 없습니다.');
    }
    return roster;
  }

  function pendingPayload(task, selected, employees) {
    const key = 'swV315PendingWorkflowTask';
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
    const createdAt = pending && (pending.createdAt || pending.lastAttemptAt);
    const age = createdAt && Date.parse(createdAt) ? Date.now() - Date.parse(createdAt) : Infinity;
    const canResume = !!(pending && pending.payload && age >= 0 && age < 24 * 60 * 60 * 1000 &&
      pending.payload.task === task &&
      pending.payload.employeeId === textOf(selected.id) &&
      JSON.stringify(pending.payload.employees) === JSON.stringify(employees) &&
      pending.payload.taskId && pending.payload.idempotencyKey);
    const taskId = canResume ? pending.payload.taskId :
      (crypto.randomUUID ? crypto.randomUUID() : 'sw-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    const payload = canResume ? pending.payload : {
      task,
      taskId,
      idempotencyKey: taskId,
      employee: textOf(selected.name),
      employeeId: textOf(selected.id),
      department: departmentOf(selected),
      position: textOf(selected.badge),
      instruction: textOf(selected.duty),
      employees
    };
    try {
      localStorage.setItem(key, JSON.stringify({
        payload,
        state: 'pending',
        createdAt: canResume && pending.createdAt ? pending.createdAt : new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        resumed: canResume
      }));
    } catch (_) {}
    return { key, taskId, payload };
  }

  async function executeAlexInstruction() {
    const selected = typeof E === 'function' && typeof st !== 'undefined' ? E(st.sel) : null;
    if (!selected || selected.id !== 'alex') return;
    const input = typeof inp !== 'undefined' ? inp : document.getElementById('inp');
    const instruction = textOf(input && input.value);
    if (!instruction) return;
    if (st.wfRun) {
      const hint = document.getElementById('hint');
      if (hint) hint.textContent = '업무가 진행 중입니다. 현재 업무가 끝난 뒤 다시 지시해 주세요.';
      return;
    }

    const file = st.file;
    const task = (instruction + (file
      ? '\n\n[첨부 파일: ' + textOf(file.name || '파일') + ']\n' +
        (textOf(file.text) || '파일 본문 텍스트가 추출되지 않았습니다. 파일명만 확인할 수 있습니다.')
      : '')).trim();
    const employees = employeeRoster();
    const pending = pendingPayload(task, selected, employees);
    const history = st.hist.alex = st.hist.alex || [];
    history.push({
      role: 'user',
      content: task,
      show: (file ? '📎 ' + textOf(file.name) + '\n' : '') + instruction,
      t: typeof T === 'function' ? T() : ''
    });
    input.value = '';
    st.file = null;
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = '';
    st.wfRun = true;
    if (typeof setPhase === 'function') setPhase('alex', '업무 접수 및 배정 중');
    if (typeof drawChat === 'function') drawChat();

    try {
      if (!window.parent || !window.parent.SWWorkflowBridge ||
          typeof window.parent.SWWorkflowBridge.execute !== 'function') {
        throw new Error('업무 엔진이 연결되지 않았습니다. 통합 실행 화면에서 업무 엔진 연결값을 설정해 주세요.');
      }
      const result = await window.parent.SWWorkflowBridge.execute(pending.payload, progress => {
        const stage = textOf(progress && (progress.currentStage || progress.status)) || '업무 수행 중';
        st.phase.alex = '업무 처리 중 · ' + stage;
        st.busy.alex = true;
        if (typeof drawCards === 'function') drawCards();
        if (typeof drawChat === 'function') drawChat();
      });

      const status = textOf(result.workflow && result.workflow.status).toLowerCase();
      const lines = [
        status === 'completed' ? '[업무 완료]' :
          status === 'partial' ? '[부분 완료 · 추가 확인 필요]' : '[업무 미완료 · 대표 승인 불가]',
        textOf(result.reply) || '본부장 최종 보고가 반환되지 않았습니다.'
      ];
      if (Array.isArray(result.deliverables) && result.deliverables.length) {
        lines.push('', '[전문 직원 결과물]');
        result.deliverables.forEach((item, index) => {
          lines.push((index + 1) + '. ' + textOf(item.title || item.name || '결과물') +
            ' · ' + textOf(item.department) + ' · ' + textOf(item.status));
          if (item.teamLeader) lines.push('검수 담당: ' + textOf(item.teamLeader));
          if (item.content) lines.push(textOf(item.content).slice(0, 7000));
        });
      }
      if (result.workflow && result.workflow.reviewGate) {
        lines.push('', '[검수·승인 상태]',
          '최종 검수 통과: ' + (result.workflow.reviewGate.finalReleaseAllowed === true ? '예' : '아니오'),
          '대표 승인 전 외부 실행: 수행하지 않음');
      }
      history.push({
        role: 'assistant',
        content: lines.join('\n'),
        show: '📋 본부장 최종 보고\n\n' + lines.join('\n'),
        t: typeof T === 'function' ? T() : '',
        wf: true
      });
      try {
        const saved = JSON.parse(localStorage.getItem(pending.key) || 'null');
        if (saved && saved.payload && saved.payload.taskId === pending.taskId) {
          localStorage.removeItem(pending.key);
        }
      } catch (_) {}
      if (typeof wfLog === 'function') {
        // The complete report is already in chat history; keep the status line concise.
        const hintEl = document.getElementById('hint');
        if (hintEl) hintEl.textContent = status === 'completed' ? '업무 완료 · 대표 승인 대기' :
          status === 'partial' ? '부분 완료 · 추가 확인 필요' : '업무 미완료 · 결과 확인 필요';
      }
    } catch (error) {
      const message = '실제 업무처리 실패 · 완료된 업무가 아닙니다.\n' + textOf(error && error.message || error);
      history.push({
        role: 'assistant', content: message, show: '⚠ ' + message,
        t: typeof T === 'function' ? T() : '', wf: true
      });
      try {
        const saved = JSON.parse(localStorage.getItem(pending.key) || 'null');
        if (saved && saved.payload && saved.payload.taskId === pending.taskId) {
          saved.state = 'resume_required';
          saved.lastError = textOf(error && error.message || error);
          saved.lastAttemptAt = new Date().toISOString();
          localStorage.setItem(pending.key, JSON.stringify(saved));
        }
      } catch (_) {}
    } finally {
      st.wfRun = false;
      if (typeof setPhase === 'function') setPhase('alex', null);
      if (typeof drawCards === 'function') drawCards();
      if (typeof drawChat === 'function') drawChat();
      if (typeof msgs !== 'undefined' && msgs) msgs.scrollTop = msgs.scrollHeight;
    }
  }

  function isAlexSelected() {
    return typeof st !== 'undefined' && st.sel === 'alex' && !st.robotChat;
  }
  function onSendClick(event) {
    const target = event.target && event.target.closest ? event.target.closest('#send') : null;
    if (!target || !isAlexSelected()) return;
    const input = document.getElementById('inp');
    if (!textOf(input && input.value)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    executeAlexInstruction();
  }
  function onInputKeydown(event) {
    if (event.target !== document.getElementById('inp') ||
        event.key !== 'Enter' || event.shiftKey || event.isComposing || !isAlexSelected() ||
        !textOf(event.target.value)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    executeAlexInstruction();
  }

  document.addEventListener('click', onSendClick, true);
  document.addEventListener('keydown', onInputKeydown, true);
  window.dispatchEvent(new CustomEvent('sw-latest-workflow-bridge-ready'));
})();
