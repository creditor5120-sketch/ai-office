/* SW AI OFFICE workflow bridge for SW_AI_Office_Latest.html
 * Loaded by office-v315-integrated.html after the untouched office iframe finishes loading.
 * This file intentionally does not edit the source HTML file on disk or in the repository.
 */
(function () {
  'use strict';
  if (window.__SW_WORKFLOW_BRIDGE_V315__) return;
  window.__SW_WORKFLOW_BRIDGE_V315__ = true;
  const originalCallConfiguredLLM = window.callConfiguredLLM;
  const textOf = value => String(value == null ? '' : value).trim();

  function departmentOf(person) {
    const badge = textOf(person.badge), room = textOf(person.room);
    if (badge.includes('경영관리')) return '경영관리팀';
    if (badge.includes('총무')) return '총무팀';
    if (badge.includes('전략기획')) return '전략기획팀';
    if (badge.includes('법무')) return '법무팀';
    if (badge.includes('IR')) return 'IR팀';
    if (badge.includes('기술') || badge.includes('IT')) return '기술·IT팀';
    if (room === 'legal') return '법무팀';
    if (room === 'ir') return 'IR팀';
    if (room === 'it') return '기술·IT팀';
    if (room === 'hq') return '본부장실';
    if (room === 'ceo') return '대표이사실';
    return '경영관리팀';
  }

  function toWorkerEmployees() {
    if (typeof EMP === 'undefined' || !Array.isArray(EMP)) throw new Error('사무실 직원 명단을 읽을 수 없습니다.');
    const list = EMP.filter(person => person && person.id !== 'ceo1').map(person => ({
      id: textOf(person.id), name: textOf(person.name), department: departmentOf(person),
      position: textOf(person.badge), instruction: textOf(person.duty)
    }));
    const ceo = EMP.find(person => person && person.id === 'ceo1');
    if (!ceo) throw new Error('대표이사 직원 정보가 없습니다.');
    list.push({ id: 'COO', name: textOf(ceo.name), department: '대표이사실', position: '대표이사', instruction: textOf(ceo.duty) });
    if (!list.some(person => person.id === 'COO')) throw new Error('대표이사(COO) 정보가 없습니다.');
    return list;
  }

  function readTask(inputMsgs) {
    const lastUser = [...(Array.isArray(inputMsgs) ? inputMsgs : [])].reverse().find(item => item && item.role === 'user');
    let task = textOf(lastUser && lastUser.content);
    const marker = '[사용자 요청]', markerAt = task.lastIndexOf(marker);
    if (markerAt >= 0) task = task.slice(markerAt + marker.length).trim();
    return task;
  }

  async function executeWithWorker(inputMsgs) {
    const task = readTask(inputMsgs);
    if (!task) throw new Error('업무 지시 내용이 비어 있습니다.');
    const selected = typeof E === 'function' ? E(st.sel) : null;
    if (!selected) throw new Error('현재 선택된 직원을 확인할 수 없습니다.');
    const employeeId = textOf(selected.id);
    const employeeRoster = toWorkerEmployees();
    const pendingKey = 'swV315PendingWorkflowTask';
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(pendingKey) || 'null'); } catch (_) {}
    const pendingCreatedAt = pending && (pending.createdAt || pending.lastAttemptAt);
    const pendingAgeMs = pendingCreatedAt && Date.parse(pendingCreatedAt) ?
      Date.now() - Date.parse(pendingCreatedAt) : Number.POSITIVE_INFINITY;
    // 이전 호출이 브라우저 종료·대기시간 초과 등으로 끝나지 않았다면
    // 24시간 이내 동일 지시·직원·조직 명단일 때만 최초 taskId/idempotencyKey를 재사용한다.
    const canResume = pending && pending.payload && pendingAgeMs >= 0 && pendingAgeMs < 24 * 60 * 60 * 1000 &&
      pending.payload.task === task && pending.payload.employeeId === employeeId &&
      JSON.stringify(pending.payload.employees) === JSON.stringify(employeeRoster) &&
      pending.payload.taskId && pending.payload.idempotencyKey;
    const taskId = canResume
      ? pending.payload.taskId
      : (crypto.randomUUID ? crypto.randomUUID() : 'sw-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    const payload = canResume ? pending.payload : {
      task, taskId, idempotencyKey: taskId, employee: textOf(selected.name),
      employeeId, department: departmentOf(selected),
      position: textOf(selected.badge), instruction: textOf(selected.duty), employees: employeeRoster
    };
    try {
      localStorage.setItem(pendingKey, JSON.stringify({
        payload, state: 'pending',
        createdAt: canResume && pending.createdAt ? pending.createdAt : new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        resumed: Boolean(canResume)
      }));
    } catch (_) {}
    let data;
    try {
      data = await window.parent.SWWorkflowBridge.execute(payload, progress => {
        const status = progress.currentStage || progress.status || '업무 처리 중';
        try { localStorage.setItem('sw_v315_last_progress', JSON.stringify({ taskId, status, at: new Date().toISOString() })); } catch (_) {}
        const progressBubble = document.querySelector('#msgs .b.ai:last-child');
        if (progressBubble) progressBubble.textContent = '업무 처리 중 · ' + status;
      });
    } catch (error) {
      try {
        const savedPending = JSON.parse(localStorage.getItem(pendingKey) || 'null');
        if (savedPending && savedPending.payload && savedPending.payload.taskId === taskId) {
          savedPending.state = 'resume_required';
          savedPending.lastError = textOf(error && error.message || error);
          savedPending.lastAttemptAt = new Date().toISOString();
          localStorage.setItem(pendingKey, JSON.stringify(savedPending));
        }
      } catch (_) {}
      try {
        const history = JSON.parse(localStorage.getItem('swV315WorkflowTaskHistory') || '[]');
        history.unshift({ taskId, task, reply: '', deliverables: [], workflow: {}, error: textOf(error && error.message || error), status: '처리 미완료 또는 재개 필요', savedAt: new Date().toISOString() });
        localStorage.setItem('swV315WorkflowTaskHistory', JSON.stringify(history.slice(0, 30)));
      } catch (_) {}
      throw error;
    }
    const workflowStatus = textOf(data.workflow && data.workflow.status).toLowerCase();
    const resultLabel = workflowStatus === 'completed' ? '업무 완료' : workflowStatus === 'partial' ? '부분 완료 · 추가 확인 필요' : '업무 미완료 · 대표 승인 불가';
    const sections = ['[' + resultLabel + ']', textOf(data.reply) || '업무 처리 결과가 비어 있습니다.'];
    if (Array.isArray(data.deliverables) && data.deliverables.length) {
      sections.push('\n\n[전문 직원 결과물]');
      data.deliverables.forEach((item, index) => {
        sections.push('\n' + (index + 1) + '. ' + textOf(item.title || item.name || '결과물') + ' · ' + textOf(item.department) + ' · ' + textOf(item.status));
        if (item.teamLeader) sections.push('검수 담당: ' + textOf(item.teamLeader));
        if (item.content) sections.push('\n' + textOf(item.content).slice(0, 7000));
      });
    }
    if (data.workflow && data.workflow.reviewGate) {
      sections.push('\n\n[검수·승인 상태]');
      sections.push('최종 검수 통과: ' + (data.workflow.reviewGate.finalReleaseAllowed === true ? '예' : '아니오'));
      sections.push('대표 승인 전 외부 실행: 수행하지 않음');
    }
    try {
      const savedPending = JSON.parse(localStorage.getItem(pendingKey) || 'null');
      if (savedPending && savedPending.payload && savedPending.payload.taskId === taskId) localStorage.removeItem(pendingKey);
    } catch (_) {}
    try {
      const history = JSON.parse(localStorage.getItem('swV315WorkflowTaskHistory') || '[]');
      history.unshift({ taskId, task, reply: data.reply || '', deliverables: data.deliverables || [], workflow: data.workflow || {}, status: workflowStatus, savedAt: new Date().toISOString() });
      localStorage.setItem('swV315WorkflowTaskHistory', JSON.stringify(history.slice(0, 30)));
    } catch (_) {}
    return { text: sections.join('\n'), taskId, workflow: data.workflow || {}, deliverables: data.deliverables || [] };
  }

  window.callConfiguredLLM = async function (inputMsgs) {
    const selected = typeof E === 'function' ? E(st.sel) : null;
    if (selected && selected.id === 'alex') {
      try { return await executeWithWorker(inputMsgs); }
      catch (error) {
        // The original office falls back to a canned local reply on thrown errors.
        // Return a visible failure result instead so an unsuccessful workflow is never presented as completed work.
        return { text: '실제 업무처리 실패 · 완료된 업무가 아닙니다.\n' + textOf(error && error.message || error) };
      }
    }
    if (typeof originalCallConfiguredLLM === 'function') return originalCallConfiguredLLM(inputMsgs);
    throw new Error('기존 대화 엔진을 사용할 수 없습니다.');
  };
  window.dispatchEvent(new CustomEvent('sw-workflow-bridge-ready'));
})();
