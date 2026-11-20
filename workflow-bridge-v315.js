/* SW AI OFFICE workflow bridge for SW_AI_Office_v3_15.html
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
    const taskId = crypto.randomUUID ? crypto.randomUUID() : 'sw-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    const payload = {
      task, taskId, idempotencyKey: taskId, employee: textOf(selected.name),
      employeeId: textOf(selected.id), department: departmentOf(selected),
      position: textOf(selected.badge), instruction: textOf(selected.duty), employees: toWorkerEmployees()
    };
    const data = await window.parent.SWWorkflowBridge.execute(payload, progress => {
      const status = progress.currentStage || progress.status || '업무 처리 중';
      try { localStorage.setItem('sw_v315_last_progress', JSON.stringify({ taskId, status, at: new Date().toISOString() })); } catch (_) {}
    });
    const sections = [textOf(data.reply) || '업무 처리 결과가 비어 있습니다.'];
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
      const history = JSON.parse(localStorage.getItem('swV315WorkflowTaskHistory') || '[]');
      history.unshift({ taskId, task, reply: data.reply || '', deliverables: data.deliverables || [], workflow: data.workflow || {}, savedAt: new Date().toISOString() });
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
        return { text: '실제 업무처리 실패 · 완료된 업무가 아닙니다.\\n' + textOf(error && error.message || error) };
      }
    }
    if (typeof originalCallConfiguredLLM === 'function') return originalCallConfiguredLLM(inputMsgs);
    throw new Error('기존 대화 엔진을 사용할 수 없습니다.');
  };
  window.dispatchEvent(new CustomEvent('sw-workflow-bridge-ready'));
})();
