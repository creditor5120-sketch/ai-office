// SW AI OFFICE Worker v51.21 - representative decision audit
export default {

  async fetch(request, env) {

    const corsHeaders = {

      "Access-Control-Allow-Origin": "https://creditor5120-sketch.github.io",

      "Access-Control-Allow-Methods": "POST, OPTIONS",

      "Access-Control-Allow-Headers": "Content-Type, Authorization"

    };

    const json = (data, status = 200) =>

      new Response(JSON.stringify(data), {

        status,

        headers: {

          ...corsHeaders,

          "Content-Type": "application/json; charset=utf-8"

        }

      });

    if (request.method === "OPTIONS") {

      return new Response(null, { headers: corsHeaders });

    }

    if (request.method !== "POST") {

      return json({ error: "POST 요청만 허용됩니다." }, 405);

    }

    // 브라우저 CORS는 인증 수단이 아니므로 모든 POST 요청에 별도 비밀 토큰을 요구한다.
    // OFFICE_ACCESS_TOKEN은 Cloudflare Worker Secret으로만 설정하고 코드/저장소에 넣지 않는다.
    const expectedAccessToken = String(env.OFFICE_ACCESS_TOKEN || "").trim();
    if (!expectedAccessToken) {
      return json({ error: "서버 API 인증 비밀값이 설정되지 않았습니다." }, 503);
    }
    const suppliedAuthorization = String(request.headers.get("Authorization") || "");
    const expectedAuthorization = "Bearer " + expectedAccessToken;
    let authDifference = suppliedAuthorization.length ^ expectedAuthorization.length;
    const authLength = Math.max(suppliedAuthorization.length, expectedAuthorization.length);
    for (let i = 0; i < authLength; i++) {
      authDifference |= (suppliedAuthorization.charCodeAt(i) || 0) ^ (expectedAuthorization.charCodeAt(i) || 0);
    }
    if (authDifference !== 0) {
      return json({ error: "API 인증에 실패했습니다." }, 401);
    }

    let currentStage = "업무 접수 및 D1 저장";
    let body = null;
    let task = "";
    let taskId = null;
    let idempotencyKey = null;
    let dbReady = false;
    let lockToken = null;
    let quotaEncountered = false;
    let aiCallFailureEncountered = false;
    let aiCallFailureMessage = "";
    let aiCallCursor = 0;
    let aiCallsThisRequest = 0;
    const MAX_NEW_AI_CALLS_PER_REQUEST = 1;
    const cachedAiCalls = new Map();

    // OpenRouter/Cloudflare 런타임별 Abort 오류 문구를 공통 시간 초과로 판별한다.
    // 내부 단계의 catch에서 오류가 포장되더라도 재개 판정이 원인을 놓치지 않게 한다.
    const isTimeoutFailure = value =>
      /OPENROUTER_TIMEOUT|timeout|timed\s*out|aborted due to timeout|operation was aborted/i
        .test(String(value?.message || value || ""));

    const writeTaskEvent = async (eventType, stage, detail = {}) => {
      if (!env.DB || !taskId) return;
      await env.DB.prepare(
        `INSERT INTO task_events (event_id, task_id, event_type, actor, stage, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), taskId, eventType, "SW AI OFFICE Worker v51.21", stage || null, JSON.stringify(detail), new Date().toISOString()).run();
    };

    let lastRecordedStage = null;

    // 주요 업무 단계의 시작·완료를 D1 감사 이력에 남긴다.
    const setCurrentStage = async (nextStage, detail = {}) => {
      if (lastRecordedStage && lastRecordedStage !== nextStage) {
        await writeTaskEvent("WORKFLOW_STAGE_COMPLETED", lastRecordedStage, {
          outcome: "다음 단계로 정상 진입",
          nextStage
        });
      }
      currentStage = nextStage;
      await writeTaskEvent("WORKFLOW_STAGE_STARTED", nextStage, {
        ...detail,
        executionVersion: "v51.21"
      });
      lastRecordedStage = nextStage;
    };

    const updateTask = async (values) => {
      if (!env.DB || !taskId || !lockToken) throw new Error("SW_AI_LOCK_LOST");
      const result = await env.DB.prepare(
        `UPDATE tasks SET status = ?, current_stage = ?, partial_result_json = COALESCE(?, partial_result_json),
         error_message = ?, attempt_count = COALESCE(?, attempt_count), updated_at = ?,
         started_at = COALESCE(started_at, ?), completed_at = ? WHERE task_id = ? AND lock_token = ?
         AND (? = 0 OR control_request NOT IN ('PAUSE', 'CANCEL'))`
      ).bind(
        values.status, values.stage || currentStage, values.resultJson ?? null,
        values.error ?? null, values.attemptCount ?? null, new Date().toISOString(),
        values.startedAt ?? null, values.completedAt ?? null, taskId, lockToken,
        values.requireNoControl ? 1 : 0
      ).run();
      if ((result.meta?.changes ?? 0) !== 1) {
        if (values.requireNoControl) {
          const current = await env.DB.prepare(
            `SELECT control_request, lock_token FROM tasks WHERE task_id = ?`
          ).bind(taskId).first();
          const control = String(current?.control_request || "NONE").toUpperCase();
          if (current?.lock_token === lockToken && ["PAUSE", "CANCEL"].includes(control)) {
            throw new Error("SW_AI_CONTROL_CHANGED");
          }
        }
        throw new Error("SW_AI_LOCK_LOST");
      }
    };

    const releaseTaskLock = async () => {
      if (!env.DB || !taskId || !lockToken) return;
      const releasedToken = lockToken;
      await env.DB.prepare(
        `UPDATE tasks SET lock_token = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE task_id = ? AND lock_token = ?`
      ).bind(new Date().toISOString(), taskId, releasedToken).run();
      lockToken = null;
      try { await writeTaskEvent("TASK_LOCK_RELEASED", "업무 실행 잠금 해제", {}); }
      catch (eventError) { console.error("잠금 해제 이력 기록 실패:", eventError.message); }
    };

    const renewTaskLock = async () => {
      if (!lockToken) throw new Error("SW_AI_LOCK_LOST");
      const now = new Date().toISOString();
      const expires = new Date(Date.now() + 180000).toISOString();
      const result = await env.DB.prepare(
        `UPDATE tasks SET lease_expires_at = ?, updated_at = ?
         WHERE task_id = ? AND lock_token = ?`
      ).bind(expires, now, taskId, lockToken).run();
      if ((result.meta?.changes ?? 0) !== 1) throw new Error("SW_AI_LOCK_LOST");
    };

    const checkTaskControl = async () => {
      const row = await env.DB.prepare(
        `SELECT control_request FROM tasks WHERE task_id = ?`
      ).bind(taskId).first();
      const control = String(row?.control_request || "NONE").toUpperCase();
      if (control === "CANCEL") throw new Error("SW_AI_CANCELLED");
      if (control === "PAUSE") throw new Error("SW_AI_PAUSED");
      if (quotaEncountered) throw new Error("SW_AI_QUOTA_WAIT");
      if (aiCallFailureEncountered) {
        // 시간 초과는 일반 단계 실패로 바꾸지 않고 상위 재개 처리까지 원인 코드를 보존한다.
        const failurePrefix = isTimeoutFailure(aiCallFailureMessage)
          ? "OPENROUTER_TIMEOUT: "
          : "SW_AI_STEP_FAILED: ";
        throw new Error(failurePrefix + aiCallFailureMessage);
      }
    };

    const saveAiCheckpoint = async (index, signature, value) => {
      await renewTaskLock();
      const now = new Date().toISOString();
      const payload = JSON.stringify({ version: 2, index, signature, value });
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO task_checkpoints
           (checkpoint_id, task_id, stage_key, stage_name, checkpoint_json, created_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM tasks WHERE task_id = ? AND lock_token = ?)`
        ).bind(crypto.randomUUID(), taskId, `v51_ai_call_${index}`, currentStage, payload, now, taskId, lockToken),
        env.DB.prepare(
          `UPDATE tasks SET checkpoint_stage = ?, checkpoint_json = ?, execution_version = 'v51.21', updated_at = ?
           WHERE task_id = ? AND lock_token = ?`
        ).bind(currentStage, JSON.stringify({ version: 2, lastAiCallIndex: index, resumeStrategy: "signature_checked_replay" }), now, taskId, lockToken),
        env.DB.prepare(
          `INSERT INTO task_events (event_id, task_id, event_type, actor, stage, detail_json, created_at)
           SELECT ?, ?, 'AI_CALL_CHECKPOINT_SAVED', 'SW AI OFFICE Worker v51', ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM tasks WHERE task_id = ? AND lock_token = ?)`
        ).bind(crypto.randomUUID(), taskId, currentStage, JSON.stringify({ callIndex: index, checkpointVersion: 2 }), now, taskId, lockToken)
      ]);
      if ((results?.[0]?.meta?.changes ?? 0) !== 1 ||
          (results?.[1]?.meta?.changes ?? 0) !== 1 ||
          (results?.[2]?.meta?.changes ?? 0) !== 1) {
        throw new Error("SW_AI_LOCK_LOST");
      }
    };

    const assertWorkflowControl = async () => {
      await checkTaskControl();
      await renewTaskLock();
    };

    try {
      body = await request.json();

      // 다른 기기·브라우저에서도 서버에 저장된 대표 결정 이력을 조회한다.
      if (body.action === "get_representative_decision") {
        if (!env.DB) return json({ error: "D1 DB 바인딩이 없어 승인 이력을 조회할 수 없습니다." }, 503);
        taskId = String(body.taskId || "").trim();
        if (!taskId) return json({ error: "업무 ID가 없습니다." }, 400);
        const taskRow = await env.DB.prepare(
          `SELECT task_id FROM tasks WHERE task_id = ?`
        ).bind(taskId).first();
        if (!taskRow) return json({ error: "해당 업무를 찾을 수 없습니다.", taskId }, 404);
        const event = await env.DB.prepare(
          `SELECT detail_json, created_at FROM task_events
           WHERE task_id = ? AND event_type = 'REPRESENTATIVE_DECISION'
           ORDER BY created_at DESC, rowid DESC LIMIT 1`
        ).bind(taskId).first();
        if (!event) return json({ taskId, decision: null, recordedAt: null, message: "아직 대표 결정이 기록되지 않았습니다." }, 200);
        let detail = {};
        try { detail = JSON.parse(event.detail_json || "{}"); } catch (_) {}
        return json({ taskId, ...detail, recordedAt: event.created_at || detail.recordedAt || null }, 200);
      }

      // 대표 화면에서 서버에 저장된 업무 단계별 감사 이력을 조회한다.
      if (body.action === "get_task_history") {
        if (!env.DB) return json({ error: "D1 DB 바인딩이 없어 업무 이력을 조회할 수 없습니다." }, 503);
        taskId = String(body.taskId || "").trim();
        if (!taskId) return json({ error: "업무 ID가 없습니다." }, 400);
        const taskRow = await env.DB.prepare(
          `SELECT task_id, status, current_stage, created_at, updated_at, completed_at
           FROM tasks WHERE task_id = ?`
        ).bind(taskId).first();
        if (!taskRow) return json({ error: "해당 업무를 찾을 수 없습니다.", taskId }, 404);
        const rows = await env.DB.prepare(
          `SELECT event_id, event_type, actor, stage, detail_json, created_at
           FROM task_events WHERE task_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT 301`
        ).bind(taskId).all();
        const events = (rows.results || []).map(row => {
          let detail = {};
          try { detail = JSON.parse(row.detail_json || "{}"); } catch (_) {
            detail = { parseError: "이력 상세 JSON을 해석하지 못했습니다." };
          }
          return {
            eventId: row.event_id,
            eventType: row.event_type,
            actor: row.actor,
            stage: row.stage,
            detail,
            createdAt: row.created_at
          };
        }).reverse();
        const truncated = events.length > 300;
        const visibleEvents = events.slice(-300);
        return json({
          task: {
            taskId: taskRow.task_id,
            status: taskRow.status,
            currentStage: taskRow.current_stage,
            createdAt: taskRow.created_at,
            updatedAt: taskRow.updated_at,
            completedAt: taskRow.completed_at
          },
          eventCount: visibleEvents.length,
          events: visibleEvents,
          truncated
        }, 200);
      }

      // 대표 승인·반려는 기존 D1 task_events에 추가 기록한다.
      // 결과물 원문을 변경하지 않는 append-only 의사결정 기록이다.
      if (body.action === "representative_decision") {
        // 일반 API 토큰과 분리된 대표 승인 전용 비밀값을 추가로 요구한다.
        const expectedRepresentativeToken = String(env.REPRESENTATIVE_ACCESS_TOKEN || "").trim();
        if (!expectedRepresentativeToken) {
          return json({ error: "대표 승인 전용 인증값이 Worker Secret에 설정되지 않았습니다." }, 503);
        }
        const suppliedRepresentativeAuthorization = String(request.headers.get("X-Representative-Authorization") || "");
        const expectedRepresentativeAuthorization = "Bearer " + expectedRepresentativeToken;
        let representativeAuthDifference = suppliedRepresentativeAuthorization.length ^ expectedRepresentativeAuthorization.length;
        const representativeAuthLength = Math.max(suppliedRepresentativeAuthorization.length, expectedRepresentativeAuthorization.length);
        for (let i = 0; i < representativeAuthLength; i++) {
          representativeAuthDifference |= (suppliedRepresentativeAuthorization.charCodeAt(i) || 0) ^ (expectedRepresentativeAuthorization.charCodeAt(i) || 0);
        }
        if (representativeAuthDifference !== 0) {
          return json({ error: "대표 승인 전용 인증에 실패했습니다." }, 401);
        }
        if (!env.DB) return json({ error: "D1 DB 바인딩이 없어 승인 이력을 기록할 수 없습니다." }, 503);
        taskId = String(body.taskId || "").trim();
        const decision = String(body.decision || "").trim().toUpperCase();
        const reason = String(body.reason || "").trim().slice(0, 4000);
        if (!taskId) return json({ error: "업무 ID가 없습니다." }, 400);
        if (!["APPROVE", "REJECT"].includes(decision)) {
          return json({ error: "승인 또는 반려 중 하나를 선택해야 합니다." }, 400);
        }
        if (decision === "REJECT" && !reason) {
          return json({ error: "반려 사유를 입력해야 합니다." }, 400);
        }

        const saved = await env.DB.prepare(
          `SELECT task_id, status, partial_result_json FROM tasks WHERE task_id = ?`
        ).bind(taskId).first();
        if (!saved) return json({ error: "해당 업무를 찾을 수 없습니다.", taskId }, 404);
        if (!["COMPLETED", "PARTIAL_COMPLETED"].includes(String(saved.status || ""))) {
          return json({ error: "업무 결과가 확정되지 않아 대표 결정을 기록할 수 없습니다.", taskId, status: saved.status }, 409);
        }

        let result = null;
        try { result = JSON.parse(saved.partial_result_json || "null"); } catch (_) {}
        if (!result || !result.workflow) {
          return json({ error: "저장된 최종 업무 보고서가 없어 결정을 기록할 수 없습니다.", taskId }, 409);
        }
        const releaseAllowed = result.workflow?.reviewGate?.finalReleaseAllowed === true;
        if (decision === "APPROVE" && !releaseAllowed) {
          return json({
            error: "전문 직원의 최종 검수가 모두 승인되지 않아 대표 승인을 진행할 수 없습니다.",
            taskId,
            resultStatus: result.workflow?.resultStatus || result.workflow?.status || "미확인"
          }, 409);
        }

        const prior = await env.DB.prepare(
          `SELECT detail_json, created_at FROM task_events
           WHERE task_id = ? AND event_type = 'REPRESENTATIVE_DECISION'
           ORDER BY created_at DESC, rowid DESC LIMIT 1`
        ).bind(taskId).first();
        if (prior) {
          let priorDetail = {};
          try { priorDetail = JSON.parse(prior.detail_json || "{}"); } catch (_) {}
          if (priorDetail.decision === decision) {
            return json({ taskId, ...priorDetail, recordedAt: prior.created_at, duplicate: true, message: "동일한 결정이 이미 기록되어 있습니다." }, 200);
          }
          return json({ error: "이미 결정이 기록된 업무입니다. 기존 결정을 덮어쓰지 않았습니다.", taskId, priorDecision: priorDetail.decision, recordedAt: prior.created_at }, 409);
        }

        const recordedAt = new Date().toISOString();
        const decisionDetail = {
          decision,
          decisionLabel: decision === "APPROVE" ? "대표 승인" : "대표 반려",
          actor: "대표 승인 전용 토큰 사용자(개인별 신원 미확인)",
          reason: reason || "",
          reportStatus: result.workflow?.resultStatus || result.workflow?.status || "미확인",
          finalReleaseAllowed: releaseAllowed,
          recordedAt,
          attributionNote: "일반 API 인증과 별도의 대표 승인 전용 토큰을 통과한 요청. 개인별 계정 로그인·신원 검증은 구현되지 않음."
        };
        // 중복 요청이 동시에 도착해도 단일 SQL의 조건부 INSERT로 최초 결정만 기록한다.
        const insertDecision = await env.DB.prepare(
          `INSERT INTO task_events (event_id, task_id, event_type, actor, stage, detail_json, created_at)
           SELECT ?, ?, 'REPRESENTATIVE_DECISION', ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM task_events WHERE task_id = ? AND event_type = 'REPRESENTATIVE_DECISION'
           )`
        ).bind(
          crypto.randomUUID(), taskId, decisionDetail.actor, decisionDetail.decisionLabel,
          JSON.stringify(decisionDetail), recordedAt, taskId
        ).run();
        if ((insertDecision.meta?.changes ?? 0) !== 1) {
          const concurrent = await env.DB.prepare(
            `SELECT detail_json, created_at FROM task_events
             WHERE task_id = ? AND event_type = 'REPRESENTATIVE_DECISION'
             ORDER BY created_at DESC, rowid DESC LIMIT 1`
          ).bind(taskId).first();
          let concurrentDetail = {};
          try { concurrentDetail = JSON.parse(concurrent?.detail_json || "{}"); } catch (_) {}
          if (concurrentDetail.decision === decision) {
            return json({ taskId, ...concurrentDetail, recordedAt: concurrent?.created_at || null, duplicate: true, message: "동일한 결정이 먼저 기록되어 중복 요청은 새로 저장하지 않았습니다." }, 200);
          }
          return json({ error: "다른 결정이 먼저 기록되었습니다. 기존 결정을 덮어쓰지 않았습니다.", taskId, priorDecision: concurrentDetail.decision || null, recordedAt: concurrent?.created_at || null }, 409);
        }

        return json({
          taskId,
          decision,
          decisionLabel: decisionDetail.decisionLabel,
          actor: decisionDetail.actor,
          reason: decisionDetail.reason,
          attributionNote: decisionDetail.attributionNote,
          recordedAt,
          finalReleaseAllowed: releaseAllowed,
          message: decision === "APPROVE" ? "대표 승인 이력을 기록했습니다." : "대표 반려 이력을 기록했습니다."
        }, 200);
      }

      task = String(body.task || "").trim();
      const employees = Array.isArray(body.employees)
        ? body.employees.filter(employee => employee && typeof employee === "object")
        : [];
      if (!task) return json({ error: "업무 지시 내용이 비어 있습니다." }, 400);
      if (employees.length === 0) return json({ error: "직원 명단을 전달받지 못했습니다." }, 400);
      if (employees.length > 50) return json({ error: "직원 명단이 허용 범위를 초과했습니다." }, 400);
      if (!employees.some(e => String(e.id || "").trim() === "COO")) {
        return json({ error: "COO 데이터 없음", employeeCount: employees.length, employeeIds: employees.map(e => e.id) }, 400);
      }
      if (!env.DB) return json({ error: "D1 DB 바인딩이 없어 업무를 안전하게 접수할 수 없습니다." }, 503);

      taskId = String(body.taskId || crypto.randomUUID()).trim();
      idempotencyKey = String(body.idempotencyKey || taskId).trim();
      if (!taskId || !idempotencyKey) return json({ error: "taskId 또는 idempotencyKey가 비어 있습니다." }, 400);

      const normalizedEmployees = employees.map(employee => ({
        id: String(employee.id ?? ""),
        name: String(employee.name ?? ""),
        department: String(employee.department ?? ""),
        position: String(employee.position ?? ""),
        instruction: String(employee.instruction ?? "")
      }));
      const requestFingerprint = JSON.stringify({ task, employees: normalizedEmployees });

      const now = new Date().toISOString();
      const executionNow = new Date();
      let executionDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
      }).format(executionNow);
      let executionDateTime = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", dateStyle: "full", timeStyle: "short"
      }).format(executionNow);
      const inputPayload = {
        ...body,
        _swExecutionContext: { executionDate, executionDateTime },
        _swRequestFingerprint: requestFingerprint
      };
      const insertResult = await env.DB.prepare(
        `INSERT OR IGNORE INTO tasks
         (task_id, idempotency_key, task, status, current_stage, input_json, partial_result_json, error_message, attempt_count, created_at, updated_at, started_at, completed_at)
         VALUES (?, ?, ?, 'RECEIVED', '업무 접수', ?, NULL, NULL, 0, ?, ?, NULL, NULL)`
      ).bind(taskId, idempotencyKey, task, JSON.stringify(inputPayload), now, now).run();

      const savedTask = await env.DB.prepare(
        `SELECT task_id, task, status, current_stage, input_json, partial_result_json, attempt_count, control_request, lock_token, lease_expires_at FROM tasks WHERE idempotency_key = ?`
      ).bind(idempotencyKey).first();

      if (!savedTask) throw new Error("D1 업무 접수 기록을 확인할 수 없습니다.");
      // 재시도 시 최초 요청 본문과 기준일·시각을 유지해 다른 업무가 체크포인트를 재사용하지 못하게 한다.
      let savedInput = {};
      try {
        savedInput = JSON.parse(savedTask.input_json || "{}");
        const savedContext = savedInput?._swExecutionContext;
        if (savedContext && /^\d{4}-\d{2}-\d{2}$/.test(String(savedContext.executionDate || "")) && savedContext.executionDateTime) {
          executionDate = savedContext.executionDate;
          executionDateTime = savedContext.executionDateTime;
        }
      } catch (contextError) { console.warn("최초 실행 기준일 복원 실패:", contextError.message); }
      const dateContext = `
[시스템 기준 일시]
- 대한민국 기준일: ${executionDate}
- 대한민국 기준 시각: ${executionDateTime}

[날짜 작성 규칙]
- 현재 현황, 점검 보고서, 업무 처리 보고서의 작성일은 위 기준일을 사용한다.
- 사용자가 특정 과거 또는 미래 기준일을 지정한 경우에는 그 지시를 우선한다.
- 확인되지 않은 과거 날짜를 현재 실행일처럼 작성하지 않는다.
- 문서번호의 연도도 해당 문서의 실제 작성 기준일과 일치시킨다.
- 기준일과 실제 사실 확인일을 혼동하지 않는다.
`;
      if (savedTask.task_id !== taskId) {
        return json({ error: "동일한 idempotencyKey가 다른 업무 ID에 이미 연결되어 있습니다.", taskId: savedTask.task_id }, 409);
      }
      if (insertResult.meta?.changes === 0) {
        let savedFingerprint = String(savedInput._swRequestFingerprint || "");
        if (!savedFingerprint && Array.isArray(savedInput.employees)) {
          const legacyEmployees = savedInput.employees
            .filter(employee => employee && typeof employee === "object")
            .map(employee => ({
              id: String(employee.id ?? ""),
              name: String(employee.name ?? ""),
              department: String(employee.department ?? ""),
              position: String(employee.position ?? ""),
              instruction: String(employee.instruction ?? "")
            }));
          savedFingerprint = JSON.stringify({ task: String(savedTask.task || ""), employees: legacyEmployees });
        }
        if (!savedFingerprint || savedFingerprint !== requestFingerprint) {
          return json({ error: "기존 업무 ID의 최초 요청 내용과 달라 재개를 차단했습니다. 최초 업무 내용과 직원 명단을 그대로 사용해야 합니다.", taskId, status: savedTask.status }, 409);
        }
      }

      if (insertResult.meta?.changes === 0) {
        if (String(savedTask.control_request || "NONE").toUpperCase() === "CANCEL" &&
            !(savedTask.status === "PROCESSING" && savedTask.lease_expires_at && savedTask.lease_expires_at > now)) {
          await env.DB.prepare(
            `UPDATE tasks SET status = 'CANCELLED', error_message = '사용자 취소 요청', updated_at = ?, completed_at = ? WHERE task_id = ?`
          ).bind(now, now, taskId).run();
          await writeTaskEvent("TASK_CANCELLED", "업무 취소", { source: "control_request" });
          return json({ taskId, status: "CANCELLED", message: "취소 요청이 반영되었습니다." }, 200);
        }
        if (savedTask.status === "COMPLETED" || savedTask.status === "PARTIAL_COMPLETED") {
          let prior = null;
          try { prior = JSON.parse(savedTask.partial_result_json || "null"); } catch (_) {}
          if (prior) return json({ ...prior, duplicate: true, taskId });
        }
        if (savedTask.status === "CANCELLED") {
          return json({ error: "취소된 업무는 재개할 수 없습니다.", taskId, status: savedTask.status }, 409);
        }
        if (savedTask.status === "RECEIVED") {
          return json({ error: "동일한 업무가 이미 접수되어 처리 대기 중입니다.", taskId, status: savedTask.status }, 409);
        }
        if (savedTask.status === "PROCESSING" && savedTask.lease_expires_at && savedTask.lease_expires_at > now) {
          return json({ error: "동일한 업무가 이미 처리 중이야.", taskId, status: savedTask.status, currentStage: savedTask.current_stage }, 409);
        }
        await env.DB.prepare(
          `UPDATE tasks SET status = 'PROCESSING', control_request = CASE WHEN status IN ('PAUSED', 'WAITING_FOR_API_QUOTA') AND control_request = 'PAUSE' THEN 'NONE' ELSE control_request END,
           error_message = NULL, attempt_count = attempt_count + 1, updated_at = ?, started_at = COALESCE(started_at, ?) WHERE task_id = ?`
        ).bind(now, now, taskId).run();
      } else {
        await env.DB.prepare(
          `UPDATE tasks SET status = 'PROCESSING', attempt_count = attempt_count + 1, updated_at = ?, started_at = ? WHERE task_id = ?`
        ).bind(now, now, taskId).run();
      }
      dbReady = true;
      lockToken = crypto.randomUUID();
      const leaseNow = new Date().toISOString();
      const leaseUntil = new Date(Date.now() + 180000).toISOString();
      const lockResult = await env.DB.prepare(
        `UPDATE tasks SET lock_token = ?, lease_expires_at = ?, execution_version = 'v51.21', updated_at = ?
         WHERE task_id = ? AND (lock_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`
      ).bind(lockToken, leaseUntil, leaseNow, taskId, leaseNow).run();
      if ((lockResult.meta?.changes ?? 0) !== 1) {
        lockToken = null;
        return json({ error: "다른 실행이 업무를 처리 중이거나 실행 잠금이 유효합니다.", taskId, status: "PROCESSING" }, 409);
      }

      const savedCheckpoints = await env.DB.prepare(
        `SELECT stage_key, checkpoint_json FROM task_checkpoints WHERE task_id = ? AND stage_key LIKE 'v51_ai_call_%' ORDER BY created_at, rowid`
      ).bind(taskId).all();
      for (const row of (savedCheckpoints.results || [])) {
        try {
          const match = String(row.stage_key).match(/^v51_ai_call_(\d+)$/);
          const saved = JSON.parse(row.checkpoint_json || "{}");
          if (match && saved.version === 2 && Number.isInteger(saved.index) &&
              typeof saved.signature === "string" && typeof saved.value === "string") {
            cachedAiCalls.set(Number(match[1]), { signature: saved.signature, value: saved.value });
          }
        } catch (_) {}
      }

      await writeTaskEvent("TASK_LOCK_ACQUIRED", "업무 실행 잠금", { executionVersion: "v51.21", leaseExpiresAt: leaseUntil });
      await writeTaskEvent("TASK_ACCEPTED", "업무 접수", {
        taskId, idempotencyKey, retry: insertResult.meta?.changes === 0,
        cachedAiCallCount: cachedAiCalls.size, executionVersion: "v51.21"
      });

      if (!env.OPENROUTER_API_KEY) throw new Error("OpenRouter API 키가 설정되지 않았습니다.");

      await setCurrentStage("요청 처리");

      const findEmployee = id =>

  employees.find(e => String(e.id || "").trim() === id);

const coo = findEmployee("COO");

console.log("=== COO 진단 정보 ===");

console.log("직원 수:", employees.length);

console.log("직원 ID 목록:", JSON.stringify(employees.map(e => e.id)));

console.log("전달된 직원 ID:", body.employeeId);

console.log("본부장 데이터:", JSON.stringify(coo || null));

      const employeeList = employees.map(e => ({

        id: e.id,

        name: e.name,

        department: e.department,

        position: e.position,

        instruction: e.instruction

      }));

      const departmentOptions = [

        ...new Set(

          employees

            .filter(e => String(e.position).includes("팀장"))

            .map(e => e.department)

        )

      ];

async function askAIBare(systemPrompt, userPrompt, jsonMode = false, continuationDepth = 0) {
  let response;
  let rawBody = "";

  // 최초 호출 + 최대 2회 재시도. 일시적인 서버·요청 제한 오류만 재시도한다.
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + env.OPENROUTER_API_KEY
        },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          model: "nvidia/nemotron-3-ultra-550b-a55b:free",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.3,
          // 담당자 배정 JSON은 짧게, 일반 실행계획·결과물은 과도한 출력으로 지연되지 않게 제한한다.
          max_tokens: jsonMode ? 2048 : currentStage === "본부장 실행계획 수립" ? 3072 : 8192
        })
      });
    } catch (error) {
      const errorName = String(error?.name || "");
      const errorMessage = String(error?.message || error || "");
      const isTimeout = /timeout|timed\s*out|aborted due to timeout|operation was aborted/i.test(
        errorName + " " + errorMessage
      );
      if (isTimeout) {
        // 시간 초과는 무한 재시도하지 않고, 최초 호출에 한해 1회만 재시도한다.
        if (attempt < 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        // 런타임별 오류 이름 차이를 통일해 상위 단계에서 재개 대상으로 식별한다.
        throw new Error("OPENROUTER_TIMEOUT: OpenRouter 응답 시간 초과(회당 60초, 1회 재시도 포함). " + errorMessage);
      }
      if (attempt === 2) {
        throw new Error("OpenRouter 네트워크 호출 실패: " + errorMessage);
      }
      await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
      continue;
    }

    if (response.ok) break;

    const retryable = [429, 500, 502, 503, 504, 524].includes(response.status);
    if (!retryable || attempt === 2) break;
    await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
  }

  if (!response) throw new Error("OpenRouter API 응답을 받지 못했습니다.");

  // 오류 응답은 JSON이 아닐 수도 있으므로 안전하게 처리한다.
  rawBody = await response.text();
  if (!response.ok) {
    let errorData = null;
    try { errorData = JSON.parse(rawBody); } catch (_) {}
    const detail = errorData?.error?.message || rawBody.slice(0, 500) || "응답 본문 없음";
    const errorCode = errorData?.error?.code || errorData?.error?.status || "UPSTREAM_ERROR";
    throw new Error("HTTP " + response.status + " / " + errorCode + " / " + detail);
  }

  let result;
  try {
    result = JSON.parse(rawBody);
  } catch (error) {
    throw new Error("OpenRouter 성공 응답 JSON 해석 실패: " + error.message + " / " + rawBody.slice(0, 300));
  }

  const choice = result.choices?.[0];
  const messageContent = choice?.message?.content;
  const text = typeof messageContent === "string"
    ? messageContent
    : Array.isArray(messageContent)
      ? messageContent.map(part => typeof part === "string" ? part : part.text || "").join("")
      : "";

  if (!text) {
    const reason = choice?.finish_reason || result.error?.message || "응답 내용 없음";
    throw new Error("AI 답변을 받지 못했습니다: " + reason);
  }

  // 답변이 길이 제한으로 끝난 경우 한 차례 이어서 작성한다.
  if (!jsonMode && choice?.finish_reason === "length" && continuationDepth < 1) {
    const continuation = await askAIBare(
      systemPrompt,
      "앞선 답변의 마지막 문장 다음부터 이어서 작성하라. 이미 작성한 내용을 반복하거나 요약하지 말고 문서의 나머지 부분을 완결하라.\n\n" +
      "--- 지금까지 작성된 내용 ---\n" + text,
      false,
      continuationDepth + 1
    );
    return text + "\n\n" + continuation;
  }

  return text;
}

async function askAI(systemPrompt, userPrompt, jsonMode = false) {
  const callIndex = aiCallCursor++;
  await checkTaskControl();
  await renewTaskLock();

  const effectiveSystemPrompt = `${dateContext}\n\n${systemPrompt}`;
  const signatureInput = JSON.stringify({ systemPrompt, userPrompt, jsonMode, executionDate });
  const signatureBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signatureInput));
  const signature = Array.from(new Uint8Array(signatureBytes), byte => byte.toString(16).padStart(2, "0")).join("");

  const cached = cachedAiCalls.get(callIndex);
  if (cached && cached.signature === signature) {
    return cached.value;
  }

  // 한 번의 HTTP 요청에서는 새 AI 호출을 하나만 수행한다.
  // 다음 요청은 같은 taskId로 재개하며 저장된 체크포인트를 재사용한다.
  if (aiCallsThisRequest >= MAX_NEW_AI_CALLS_PER_REQUEST) {
    throw new Error("SW_AI_YIELD");
  }
  aiCallsThisRequest++;
  const aiCallStartedAt = Date.now();

  try {
    const value = await askAIBare(effectiveSystemPrompt, userPrompt, jsonMode, 0);
    await saveAiCheckpoint(callIndex, signature, value);
    cachedAiCalls.set(callIndex, { signature, value });
    try {
      await writeTaskEvent("AI_CALL_COMPLETED", currentStage, {
        callIndex,
        elapsedMs: Date.now() - aiCallStartedAt,
        outputLength: String(value || "").length,
        model: "nvidia/nemotron-3-ultra-550b-a55b:free"
      });
    } catch (eventError) { console.error("AI 호출 완료 이력 기록 실패:", eventError.message); }
    return value;
  } catch (error) {
    try {
      await writeTaskEvent("AI_CALL_FAILED", currentStage, {
        callIndex,
        elapsedMs: Date.now() - aiCallStartedAt,
        error: String(error?.message || error),
        timeout: /OPENROUTER_TIMEOUT/i.test(String(error?.message || error))
      });
    } catch (eventError) { console.error("AI 호출 실패 이력 기록 실패:", eventError.message); }
    if (error.message === "SW_AI_YIELD") {
      // 정상적인 분할 실행 신호이므로 AI 호출 실패로 기록하지 않는다.
      throw error;
    }
    if (/(?:HTTP\s+)?(?:402|429)\b|RESOURCE_EXHAUSTED|insufficient[_\s-]?quota|quota|rate.?limit|payment required|credit balance|no credits/i.test(error.message || "")) {
      quotaEncountered = true;
    } else if (!["SW_AI_PAUSED", "SW_AI_CANCELLED", "SW_AI_QUOTA_WAIT"].includes(error.message)) {
      aiCallFailureEncountered = true;
      aiCallFailureMessage = error.message || "알 수 없는 AI 호출 오류";
    }
    throw error;
  }
}

      function parseJSON(text) {

        try {

          return JSON.parse(text);

        } catch {

          const cleaned = text

            .replace(/```json/gi, "")

            .replace(/```/g, "")

            .trim();

          const match = cleaned.match(/\{[\s\S]*\}/);

          if (!match) {

            throw new Error("AI 응답을 JSON으로 읽을 수 없습니다.");

          }

          return JSON.parse(match[0]);

        }

      }

      function extractJudgment(text) {
        const normalized = String(text || "")
          .replace(/[*_`]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const match = normalized.match(
          /(?:검수\s*판정|판정)\s*[:：]?\s*(조건부\s*승인|승인|반려)/
        );
        return match ? match[1].replace(/\s+/g, " ") : null;
      }

      const directoryText = JSON.stringify(employeeList, null, 2);

      // 1. 본부장: 업무 분석 및 담당자 배정

      await setCurrentStage("본부장 업무 분석 및 배정", { responsibleRole: "본부장 알렉스", activity: "업무 분석 및 담당 팀 배정" });

      const planText = await askAI(

        String(coo.instruction || "") + `

너는 SW AI OFFICE의 본부장이다.

사용자는 대표이사이자 최종 의사결정권자다.

사용자의 업무를 분석하고 적합한 부서와 전문 직원을 선정한다.

[배정 원칙]

- 직원 명단에 실제 존재하는 ID만 선택한다.

- 주관 부서는 반드시 제공된 부서 목록 중 하나를 선택한다.

- 전문 직원은 반드시 주관 부서 소속이어야 한다.

- 팀장은 전문 직원으로 선정하지 않는다.

- 필요한 직원만 선정하고 불필요한 인력 동원은 피한다.

- 복수 전문 직원이 필요한 경우 최대 3명까지 선정한다.

- 협업 부서는 실제 필요한 경우에만 지정한다.

- 계약 체결, 투자 실행, 대외 공시, 외부 발송 등 실제 외부 행위가 업무에 포함되면 approvalRequired를 true로 지정한다.
- 단순 초안 작성, 검토, 조사, 분석만 요청된 경우 실제 외부 행위와 구분하여 승인 필요 여부를 판단한다.
- 사용자의 명시적 승인 없이 계약 체결, 투자 실행, 대외 공시, 외부 발송을 완료한 것으로 판단하지 않는다.
- 실제 수행하지 않은 업무를 완료했다고 표현하지 않는다.

반드시 JSON으로만 답변한다.

다른 설명이나 마크다운은 출력하지 않는다.

`,

        `사용자 업무 지시:

${task}

부서 목록:

${JSON.stringify(departmentOptions)}

직원 명단:

${directoryText}

다음 형식으로 결정해.

{

  "leadDepartment": "주관 부서명",

  "specialistIds": ["전문 직원 ID"],

  "collaboratingDepartments": ["협업 부서명"],

  "reason": "담당 부서와 직원 선정 이유",

  "priority": "P1 또는 P2 또는 P3 또는 P4",

  "approvalRequired": true,

  "approvalReason": "승인이 필요한 이유 또는 없음"

}`,

        true

      );

      const plan = parseJSON(planText);

      // AI가 반환한 배정 결과의 유효성 검증
      if (
        !plan.leadDepartment ||
        !departmentOptions.includes(plan.leadDepartment)
      ) {
        throw new Error("본부장이 유효한 주관 부서를 지정하지 못했습니다.");
      }

      if (!Array.isArray(plan.specialistIds)) {
        throw new Error("전문 직원 배정 결과가 올바르지 않습니다.");
      }

      plan.specialistIds = [...new Set(
        plan.specialistIds.map(id => String(id).trim()).filter(Boolean)
      )];

      plan.collaboratingDepartments = Array.isArray(plan.collaboratingDepartments)
        ? [...new Set(plan.collaboratingDepartments)]
            .filter(department =>
              departmentOptions.includes(department) &&
              department !== plan.leadDepartment
            )
        : [];

      plan.priority = ["P1", "P2", "P3", "P4"].includes(plan.priority)
        ? plan.priority
        : "P3";

      plan.approvalRequired = plan.approvalRequired !== false;
      plan.approvalReason = String(plan.approvalReason || "").trim();

      // 2. 담당 직원 및 팀장 확인

      await setCurrentStage("담당 직원 및 팀장 확인", { responsibleRole: "본부장 알렉스", activity: "전문 직원과 팀장 배정 확인" });

      const allowedDepartments = new Set([
        plan.leadDepartment,
        ...plan.collaboratingDepartments
      ]);

      const validSpecialists = plan.specialistIds
        .map(id => findEmployee(id))
        .filter(e =>
          e &&
          String(e.id || "").trim() !== "COO" &&
          allowedDepartments.has(e.department) &&
          !String(e.position || "").includes("팀장")
        );

      const deduplicatedSpecialists = [
        ...new Map(validSpecialists.map(e => [e.id, e])).values()
      ];

      // 주관팀 직원을 먼저 확보한 뒤 협업팀 직원을 추가하고 최대 3명으로 제한한다.
      const leadSpecialists = deduplicatedSpecialists.filter(
        e => e.department === plan.leadDepartment
      );
      const collaboratingSpecialists = deduplicatedSpecialists.filter(
        e => e.department !== plan.leadDepartment
      );
      const uniqueSpecialists = [
        ...leadSpecialists.slice(0, 1),
        ...collaboratingSpecialists
      ].slice(0, 3);

      if (uniqueSpecialists.length === 0) {
        throw new Error("주관 부서 및 협업 부서의 전문 직원을 선정하지 못했습니다.");
      }
      if (!uniqueSpecialists.some(e => e.department === plan.leadDepartment)) {
        throw new Error("주관 부서의 전문 직원이 배정되지 않았습니다.");
      }

      const actuallyCollaboratingDepartments = new Set(
        uniqueSpecialists
          .map(e => e.department)
          .filter(department => department !== plan.leadDepartment)
      );
      plan.collaboratingDepartments = plan.collaboratingDepartments.filter(
        department => actuallyCollaboratingDepartments.has(department)
      );

      const teamLeadersByDepartment = {};
      for (const specialist of uniqueSpecialists) {
        const department = specialist.department;
        if (!teamLeadersByDepartment[department]) {
          const leader = employees.find(e =>
            e.department === department &&
            String(e.position || "").includes("팀장")
          );
          if (!leader) throw new Error(department + " 팀장을 찾을 수 없습니다.");
          teamLeadersByDepartment[department] = leader;
        }
      }

      // 기존 호환성을 위해 주관팀 팀장 참조를 유지한다.
      const teamLeader = teamLeadersByDepartment[plan.leadDepartment];
      const getTeamLeader = specialist => teamLeadersByDepartment[specialist.department];

      // 3. 본부장: 실행계획 수립

      await setCurrentStage("본부장 실행계획 수립", { responsibleRole: "본부장 알렉스", activity: "실행 순서와 검수 기준 수립" });

      const cooPlan = await askAI(

        String(coo.instruction || "") + `

너는 SW AI OFFICE의 본부장이다.

담당 직원과 팀장이 실제로 업무를 수행할 수 있도록 실행계획을 수립한다.

업무 범위, 실행 순서, 검수 기준, 위험 요소를 구체적으로 작성한다.

`,

        `사용자 업무 지시:

${task}

업무 배정:

${JSON.stringify(plan, null, 2)}

담당 전문 직원:

${JSON.stringify(uniqueSpecialists, null, 2)}

검수 담당 팀장:

${JSON.stringify(teamLeader, null, 2)}

실행계획을 작성해.

각 직원의 담당 업무와 검수 기준을 명확하게 구분해.`

      );

// 4. 전문 직원: 완성본 단일 작성
// 여러 장별 호출과 별도 AI 완결성 감사 호출을 제거해 524 타임아웃 위험을 줄인다.
await setCurrentStage("전문 직원 완성본 작성", { responsibleRole: "담당 전문 직원", participants: (uniqueSpecialists || []).map(item => item.name) });
const specialistResults = [];

for (const specialist of uniqueSpecialists) {
  const specialistErrors = [];
  let resultText = "";
  let completeness = { passed: false, missingSections: [], notes: "완성본 작성 전" };

  try {
    resultText = await askAI(
      String(specialist.instruction || "") + `

너는 SW AI OFFICE의 전문 실무 담당자다.
사용자의 원래 지시와 본부장 실행계획에 따라 실제로 사용할 수 있는 완성된 결과물을 작성한다.

[필수 작성 원칙]
- 개요나 작성계획만 제시하지 말고 요청된 결과물 전문을 작성한다.
- 여러 장·항목이 요구되면 빠짐없이 모두 작성하고, 제목만 남기거나 생략하지 않는다.
- 문서의 첫 부분부터 마지막 결론까지 완결한다.
- 분량이 길더라도 핵심 항목을 임의로 생략하지 않는다.
- 제공되지 않은 사실, 수치, 회사 내부 규정은 만들어내지 않는다.
- 법률 적용은 거래 유형과 법 적용 요건을 구분하고, 불확실하면 확인 필요로 표시한다.
- 실제 외부 실행을 완료했다고 표현하지 않는다.
- 사실, 분석, 제안, 가정 및 미확인 사항을 구분한다.
- 본인이 담당하는 전문 영역에 집중하되, 사용자 요청의 전체 범위를 충족한다.
`,
      `사용자 원래 업무 지시:
${task}

본부장 실행계획:
${cooPlan}

담당 전문 직원:
${specialist.name} (${specialist.position})

담당 업무에 맞춰 사용자가 요청한 결과물의 완성본 전문을 작성하라. 모든 필수 장·절을 포함하고 마지막 항목까지 작성하라.`
    );

    const cleanText = String(resultText || "").trim();
    const hasFailureMarker = /AI 호출 오류로 작성하지 못했습니다|작성하지 못했습니다|후속 작성이 필요합니다/.test(cleanText);
    const looksTruncated = cleanText.length < 300 || /(?:^|\n)#{1,6}\s*[^\n]{0,30}$/.test(cleanText);
    completeness = {
      passed: !hasFailureMarker && !looksTruncated,
      missingSections: [],
      notes: hasFailureMarker
        ? "결과물에 작성 실패 표시가 포함되어 있습니다."
        : looksTruncated
          ? "결과물 길이가 지나치게 짧거나 마지막 제목에서 끝나 완결성을 확인할 수 없습니다."
          : "기본 길이 및 작성 실패 표시 검사를 통과했습니다. 팀장 검수에서 내용 완결성을 추가 확인합니다."
    };

    if (!completeness.passed) specialistErrors.push(completeness.notes);

    specialistResults.push({
      id: specialist.id,
      name: specialist.name,
      department: specialist.department,
      teamLeader: getTeamLeader(specialist).name,
      result: cleanText,
      status: completeness.passed ? "completed" : "partial",
      completeness,
      errors: specialistErrors
    });
  } catch (error) {
    if (error.message === "SW_AI_YIELD") throw error;
    specialistErrors.push("전문 직원 결과물 작성 실패: " + error.message);
    specialistResults.push({
      id: specialist.id,
      name: specialist.name,
      department: specialist.department,
      teamLeader: getTeamLeader(specialist).name,
      result: resultText || "[전문 직원 결과물 작성 실패]",
      status: "failed",
      completeness,
      errors: specialistErrors
    });
  }
}

// 5. 팀장: 전문 직원 결과물 검수

await setCurrentStage("팀장 1차 검수", { responsibleRole: "각 담당 팀장", participants: [...new Set((uniqueSpecialists || []).map(item => getTeamLeader(item)?.name).filter(Boolean))] });

const reviewResults = [];

for (const specialist of specialistResults) {

  // 결과물이 전혀 없는 직원은 검수 생략

  if (
    !specialist.result.trim() ||
    specialist.status === "failed" ||
    specialist.result.trim().length < 300
  ) {

    reviewResults.push({

      id: specialist.id,

      name: specialist.name,

      review: specialist.status === "failed"
        ? "전문 직원 결과물 작성이 실패하여 팀장 검수를 생략했습니다. 작성 실패 원인은 미완료 사항에 기록했습니다."
        : "검수 가능한 분량의 결과물이 없어 팀장 검수를 생략했습니다.",

      status: "failed"

    });

    continue;

  }

  try {

    const reviewer = getTeamLeader(specialist);
    if (!reviewer) throw new Error(specialist.name + " 담당 팀장을 찾을 수 없습니다.");

    const review = await askAI(

      String(reviewer.instruction || "") + `

너는 SW AI OFFICE의 해당 부서 팀장이다.

전문 직원이 작성한 결과물의 품질을 검수한다.

[필수 독립 검수 기준]

일반적인 문장 품질 확인에 그치지 말고, 결과물의 핵심 주장과 근거를 항목별로 검증한다. 작성자의 결론이나 기존 검수자의 승인을 그대로 신뢰하지 않는다.

1. 법률·규정 검수(법률 또는 규정이 포함된 경우)
- 법령명, 조문 번호, 조문 내용, 적용 요건 및 법적 효과가 서로 일치하는지 확인한다.
- 민법·상법 등 서로 다른 법률의 규정과 법정이율을 혼동하지 않는다.
- 권리 행사기간, 소멸시효, 하자담보책임 기간, 계약상 보증기간 등 성격이 다른 기간을 구분한다.
- 법률상 의무·권리, 판례 법리, 계약 당사자의 합의, 업계 관행, 실무상 권고를 명확히 구분한다.
- 법적 근거가 확인되지 않는 관행이나 협상 제안을 법률상 기준 또는 일반적인 법적 의무처럼 표현하지 않았는지 확인한다.
- 법령의 예외, 적용 대상, 거래 유형 및 요건을 누락하지 않았는지 확인한다.
- 존재 여부나 현행 여부를 확신할 수 없는 조문·판례·행정해석은 임의로 맞다고 판단하지 말고 '추가 확인 필요'로 분류한다.
- 외부 법령 데이터베이스나 원문을 실제 조회하지 않았다면 '최신 법령 원문 대조 완료' 또는 '독립적인 법률 검증 완료'라고 표현하지 않는다.

2. 수치·기간·비율 검수
- 이율, 지연배상률, 손해배상 한도, 비율, 금액, 날짜 및 기간의 근거와 계산을 확인한다.
- 법정 기준인지 계약상 제안인지 업계 관행인지 구분한다.
- 근거 없는 수치나 보편적 기준처럼 제시된 협상 수치는 오류 또는 확인 필요 사항으로 표시한다.

3. 계약·실무 검수
- 계약 성립 요건과 서면 작성·서명 요건을 혼동하지 않는다.
- 책임 제한, 간접손해 배제, 면책 및 손해배상 예정 조항의 효력에 예외가 있는지 확인한다.
- 대리권·위임 및 인감증명 등 증빙 요구가 거래 위험에 비례하는지 확인한다.
- 실제 업무에 필요한 핵심 절차, 상대방 통지·검사 의무 및 권리 행사 요건이 누락되지 않았는지 확인한다.

4. 일반 품질 검수
- 정확성, 완성도, 논리와 근거, 실무 활용 가능성, 누락 및 오류를 확인한다.
- 사실, 분석, 제안, 가정 및 미확인 사항을 구분한다.
- AI 작성 결과물과 실제 외부 업무 실행을 구분한다.
- 문서 전체에서 계약 당사자 명칭(갑/을)과 역할(공급자/구매자/수급인/도급인)이 일관되는지 전수 대조한다. 특정 당사자의 지위가 지시문에 없으면 임의로 ABKO 또는 특정 회사를 갑·을로 단정하지 않는다.
- 결과물이 여러 전문 직원의 협업 산출물인 경우 각 직원의 필수 담당 내용이 최종 통합본에 실제 포함되었는지 대조한다. 별도 결과물에만 존재하는 내용을 통합 완료로 판단하지 않는다.
- 법률상 의무, 계약상 제안, 회사 내부 규정, 업계 관행 및 AI의 가정을 서로 다른 항목으로 표시했는지 확인한다. 내부 규정이나 회사 정책을 제공받지 않았다면 내부 기준이 이미 존재하는 것처럼 표현하지 않는다.
- 법률 검토 결과물에서 법령 원문이나 공식 자료가 제공되지 않았고 외부 조회도 수행하지 않았다면, 법률 조문과 현행성은 검증 미완료로 표시한다.

[판정 원칙]
- 중대한 법률 오류, 잘못된 조문 인용 또는 핵심 사실 오류가 있으면 반려한다.
- 근거 확인이 필요한 핵심 법률·수치가 남아 있으면 승인하지 말고 조건부 승인 또는 반려한다.
- 확인할 수 없는 사항을 추정으로 채우거나 오류가 없다고 단정하지 않는다.
- 승인 판정에는 핵심 주장별 근거와 검수 이유를 제시한다.

검수 의견은 구체적이고 간결하게 작성한다. 결과물 전체를 다시 작성하지 않는다.

`,

      `사용자 원래 지시:

${task}

본부장 실행계획:

${cooPlan}

검수 대상 전문 직원:

${specialist.name}

검수 대상 결과물:

${specialist.result}

다음 항목으로 검수해.

1. 검수 판정: 승인 / 조건부 승인 / 반려

2. 주요 검수 의견

3. 발견된 오류 및 누락

4. 수정이 필요한 사항

5. 추가 확인이 필요한 사항`

    );

    reviewResults.push({

      id: specialist.id,

      name: specialist.name,

      review,

      status: "completed"

    });

  } catch (error) {
    if (error.message === "SW_AI_YIELD") throw error;

    reviewResults.push({

      id: specialist.id,

      name: specialist.name,

      review: "팀장 검수 실패: " + error.message,

      status: "failed"

    });

    // 다른 직원의 검수 계속 진행

    continue;

  }

}

// 5-1. 전문 직원: 조건부 승인 또는 반려인 경우에만 수정
await setCurrentStage("전문 직원 결과물 수정", { responsibleRole: "담당 전문 직원", participants: (specialistResults || []).map(item => item.name) });

for (const specialist of specialistResults) {
  const reviewItem = reviewResults.find(item => item.id === specialist.id);
  if (!reviewItem || reviewItem.status !== "completed") {
    specialist.status = specialist.status === "failed" ? "failed" : "partial";
    specialist.errors = Array.isArray(specialist.errors) ? specialist.errors : [];
    specialist.errors.push("팀장 1차 검수 실패로 수정 작업을 수행하지 못했습니다.");
    continue;
  }

  const firstJudgment = extractJudgment(reviewItem.review);
  const requiresRevision = firstJudgment !== "승인";
  if (!requiresRevision) {
    specialist.revised = false;
    specialist.firstReviewJudgment = "승인";
    continue;
  }

  try {
    const revisedResult = await askAI(
      String(specialist.instruction || "") + `

너는 전문 직원의 결과물 수정 담당자다.
팀장의 1차 검수 의견을 실제 본문에 반영하여 기존 결과물 전체를 수정한다.
기존의 정상적인 내용은 유지하고, 누락된 항목을 보완하며, 중복과 오류를 정리한다.
수정할 수 없는 사항은 임의로 채우지 말고 확인 필요로 표시한다.
수정된 결과물 전문만 출력한다.
`,
      `사용자 원래 업무 지시:
${task}

기존 결과물 전문:
${specialist.result}

팀장 1차 검수 의견:
${reviewItem.review}

위 지적 사항을 실제 본문에 반영한 수정 결과물 전문을 처음부터 끝까지 작성하라.`
    );

    const revised = String(revisedResult || "").trim();
    const revisedHasFailureMarker = /AI 호출 오류로 작성하지 못했습니다|작성하지 못했습니다|후속 작성이 필요합니다/.test(revised);
    const revisedLooksTruncated = /(?:^|\n)#{1,6}\s*[^\n]{0,30}$/.test(revised);
    if (revised.length >= 300 && !revisedHasFailureMarker && !revisedLooksTruncated) {
      specialist.result = revised;
      specialist.revised = true;
      specialist.status = "completed";
      specialist.completeness = {
        passed: true,
        missingSections: [],
        notes: "팀장 1차 검수 의견을 반영한 수정 결과물이 기본 완결성 검사를 통과했습니다."
      };
      specialist.errors = (specialist.errors || []).filter(
        item => !String(item).includes("검수 의견 반영 수정 실패")
      );
    } else {
      throw new Error("수정 결과물이 비어 있거나 완결성을 확인할 수 없습니다.");
    }
  } catch (error) {
    if (error.message === "SW_AI_YIELD") throw error;
    specialist.status = "partial";
    specialist.errors = Array.isArray(specialist.errors) ? specialist.errors : [];
    specialist.errors.push("검수 의견 반영 수정 실패: " + error.message);
  }
}

 // 5-2. 팀장: 수정 결과물 2차 최종 검수
await setCurrentStage("팀장 2차 최종 검수", { responsibleRole: "각 담당 팀장", participants: [...new Set((uniqueSpecialists || []).map(item => getTeamLeader(item)?.name).filter(Boolean))] });

const finalReviewResults = [];

// 1차 검수에서 지적한 항목을 빠뜨리지 않도록 구조화한다.
// AI 추출이 실패하면 원문 섹션을 보수적으로 읽고, 그래도 추출되지 않으면 승인 게이트를 닫는다.
function extractFirstReviewIssuesFallback(reviewText) {
  const lines = String(reviewText || "").split(/\r?\n/);
  const found = [];
  let capture = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) {
      capture = /(발견된 오류|오류 및 누락|수정이 필요한|추가 확인이 필요한|보완 사항|미흡 사항)/.test(line);
      continue;
    }
    if (/^\s*(?:\d+[.)]|[-*•])\s*/.test(line) && capture) {
      const item = line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").replace(/[*_`]/g, "").trim();
      if (item.length >= 8) found.push(item.slice(0, 500));
    }
  }
  return [...new Set(found)];
}

function normalizeIssueText(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

for (const specialist of specialistResults) {
  const firstReview = reviewResults.find(
    item => item.id === specialist.id
  );

  const hasUsableResult =
    typeof specialist.result === "string" &&
    specialist.result.trim().length > 0 &&
    specialist.status !== "failed";

  if (!hasUsableResult) {
    finalReviewResults.push({
      id: specialist.id,
      name: specialist.name,
      status: "failed",
      judgment: "검수 불가",
      review: "검수할 수 있는 결과물이 없어 2차 검수를 진행하지 않았습니다."
    });
    specialist.status = "partial";
    continue;
  }

  if (!firstReview || firstReview.status !== "completed") {
    finalReviewResults.push({
      id: specialist.id,
      name: specialist.name,
      status: "failed",
      judgment: "검수 미완료",
      review: "1차 검수 결과가 없어 2차 검수를 진행할 수 없습니다."
    });
    specialist.status = "partial";
    continue;
  }

  const firstJudgment = extractJudgment(firstReview.review);
  // 1차 승인 여부와 관계없이 2차 독립 검수를 수행한다.
  // 1차 검수에서 보완이 요구됐지만 수정되지 않은 경우에만 검수를 중단한다.
  if (firstJudgment !== "승인" && specialist.revised !== true) {
    finalReviewResults.push({
      id: specialist.id,
      name: specialist.name,
      status: "failed",
      judgment: "수정 실패",
      review: "1차 검수에서 보완이 필요했으나 수정 결과물을 확보하지 못해 2차 검수를 생략했습니다. " +
        (specialist.errors || []).join(" / ")
    });
    specialist.status = "partial";
    continue;
  }

  try {
    let firstReviewIssues = extractFirstReviewIssuesFallback(firstReview.review);
    let firstReviewIssueExtractionFailed = false;

    try {
      const issueExtractionText = await askAI(
        `너는 검수 기록 구조화 담당자다. 검수 의견의 모든 오류, 누락, 수정 요구, 추가 확인 요구를 빠짐없이 항목별로 추출한다. 작성자의 결론이나 승인 문구는 지적사항으로 추출하지 않는다. 같은 내용의 반복만 합친다. 반드시 JSON 객체만 출력한다.
{ "issues": [ { "issue": "원문에 근거한 구체적 지적사항", "category": "수정 또는 외부확인 또는 품질", "requiresExternalVerification": true } ] }`,
        `아래 팀장 1차 검수 원문에서 실제 지적사항을 모두 추출하라. 특히 '발견된 오류 및 누락', '수정이 필요한 사항', '추가 확인이 필요한 사항'에 있는 항목을 빠뜨리지 말라.

${firstReview.review}`,
        true
      );
      const extracted = parseJSON(issueExtractionText);
      if (Array.isArray(extracted.issues) && extracted.issues.length > 0) {
        firstReviewIssues = extracted.issues
          .map(item => String(item.issue || "").trim())
          .filter(item => item.length >= 8)
          .slice(0, 30);
      } else if (firstReviewIssues.length === 0 && firstJudgment !== "승인") {
        firstReviewIssueExtractionFailed = true;
      }
    } catch (extractError) {
      if (firstReviewIssues.length === 0 && firstJudgment !== "승인") {
        firstReviewIssueExtractionFailed = true;
      }
    }
    specialist.firstReviewIssues = firstReviewIssues;
    const issueOwnerKey = String(specialist.id || "STAFF")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 32) || "STAFF";
    specialist.firstReviewIssueRecords = firstReviewIssues.map((issue, index) => ({
      issueId: `${issueOwnerKey}-ISSUE-${String(index + 1).padStart(3, "0")}`,
      issue
    }));
    specialist.firstReviewIssueExtractionFailed = firstReviewIssueExtractionFailed;

    const reviewer = getTeamLeader(specialist);
    if (!reviewer) throw new Error(specialist.name + " 담당 팀장을 찾을 수 없습니다.");

    const finalReviewText = await askAI(
      String(reviewer.instruction || "") + `

너는 SW AI OFFICE의 해당 부서 팀장이다.
전문 직원 결과물에 대한 별도 단계의 2차 검수자다. 1차 검수자의 승인 여부를 정답으로 간주하지 말고, 결과물 자체를 처음부터 독립적으로 다시 검토한다.

[검수 원칙]
- 수정된 결과물이면 아래에 제공된 1차 검수 지적사항을 빠짐없이 각각 대조한다.
- revisionChecks에는 아래 지적사항의 issueId를 그대로 복사해 항목별로 정확히 1개씩 기록한다.
- issue에는 해당 지적사항을 그대로 복사한다.
- 각 항목은 반드시 evidenceQuote와 evidenceLocation을 작성한다. evidenceQuote에는 수정된 결과물 본문에 실제 존재하는 연속된 문장을 12자 이상 그대로 복사하고, evidenceLocation에는 장·절·항 또는 표의 위치를 적는다.
- detail은 판단 이유를 설명하는 필드이며 증거 인용문으로 대체할 수 없다. evidenceQuote와 detail을 혼동하지 않는다.
- evidenceQuote는 공백·문장부호를 정규화한 뒤에도 수정 결과물 본문에서 실제로 검색되어야 한다. 문구가 있으면 반영 사실은 인정하되, 내용이 부정확하거나 불충분하면 "일부 반영"으로 판정하고 미해결 이유를 별도로 적는다.
- 실제 본문에 관련 내용이 존재하지만 법률적 정확성·충분성이 부족한 경우, 존재 자체를 부정하거나 "반영 근거 미확인"으로 처리하지 않는다.
- 본문에서 근거를 찾지 못하면 result를 반드시 "미반영" 또는 "확인 불가"로 기록한다. 작성자의 설명이나 수정했다고 주장하는 문구는 증거가 아니다.
- 수정되지 않은 결과물이면 1차 검수 결과와 무관하게 전체 내용의 오류·누락·근거를 새로 점검한다.
- 수정했다고 주장하는 것만으로 반영된 것으로 판단하지 않는다. 본문에서 실제 반영 여부를 확인한다.
- 법률·조문·판례·수치·기간·비율·사실관계의 근거를 항목별로 확인한다.
- 민법 제582조를 검토할 때에는 6개월의 기산점이 매수인이 하자를 안 날이라는 점, 매수인의 권리 종류별 법적 성격을 구분하고, 약정으로 법정 권리행사기간을 당연히 단축·배제할 수 있다고 단정하지 않았는지 확인한다. 민법 제582조의 기간을 목적물 인도일로부터 6개월이라고 잘못 설명하지 않는다.
- 상법 조문을 검토할 때 표현대표이사는 제395조, 명의대여자 책임은 제24조, 대표이사 선임·대표권 관련 근거는 제389조 제3항 및 제209조 준용 관계를 구분한다. 제209조 자체를 주식회사 대표이사 조문이라고 표시하지 않는다.
- 공정거래법 제45조를 현행 불공정거래행위 조문으로 언급하는 경우, 구법 제23조와의 연혁·적용시점을 혼동하지 않는다.
- 법률상 규정과 계약상 합의, 업계 관행, 협상 제안 및 실무 권고를 구분한다.
- 계약 당사자의 갑·을 및 공급자·구매자 역할이 문서 전체에서 일관되는지 확인한다. 지시문에 당사자 지위가 없으면 특정 회사의 역할을 임의로 가정한 부분을 오류로 지적한다.
- 복수 직원이 작성한 결과물이 통합되었다고 주장하는 경우, 각 직원의 필수 담당 내용이 최종 결과물 본문에 실제 존재하는지 확인한다. 별도 산출물을 통합본에 포함된 것으로 간주하지 않는다.
- 내부 처리기한, 검토 SLA, 갱신 알림 시점 등은 회사 내부 규정이 제공되지 않았다면 법적 의무나 확정된 회사 정책이 아니라 제안으로 분류한다.
- 외부 법령 원문 또는 공식 출처가 이 작업에 제공되지 않았고 실제 조회도 수행되지 않았다면, 법률 조문·현행성 검증은 미완료라고 판단하고 verificationNeeded에 구체적으로 적는다.
- 작성자가 '반영했다'고 설명한 내용이 실제 본문에 없으면 미반영으로 판정한다.
- 법령 원문 등 외부 원천을 실제 조회하지 않은 경우 최신성 또는 원문 대조를 완료했다고 주장하지 않는다.
- 확인할 수 없는 핵심 근거는 verificationNeeded에 구체적으로 기재한다.
- 새로 발견된 오류와 위험은 newRisks에 기재한다.
- 중대한 오류 또는 핵심 지적 미반영이 있으면 반려한다.
- 핵심 근거의 추가 확인이 필요하거나 일부 보완이 필요하면 조건부 승인한다.
- 모든 핵심 주장에 충분한 근거가 있고 중대한 문제가 없을 때만 승인한다.
- 작성자 또는 1차 검수자의 설명을 증거로 취급하지 말고 반드시 수정 결과물 본문에서 근거 문장을 직접 찾아 판단한다.
- 본문 내 원칙과 예시·대안 문구의 수치가 충돌하는지 별도로 대조한다.
- '최종 승인', '최종 확정', '배포 가능' 표현이 실제 검수 판정과 충돌하는지 확인한다.
- 법령 원문을 조회할 수 없는 환경에서는 조문이 정확해 보이더라도 법률 검증 완료로 승인하지 않는다.
- 검수 요약(summary)은 judgment와 반드시 같은 결론이어야 하며, 조건부 승인 또는 반려를 최종 승인이라고 표현해서는 안 된다.

[판정 기준]
- 승인: 주요 지적 사항이 모두 반영되고 중대한 문제가 없음.
- 조건부 승인: 일부 보완 또는 추가 확인이 필요함.
- 반려: 핵심 지적 사항이 미반영되었거나 중대한 오류가 있음.

반드시 JSON 객체만 출력한다. 마크다운이나 설명 문장을 JSON 앞뒤에 붙이지 않는다.
다음 구조와 키 이름을 정확히 사용한다.

{
  "judgment": "승인 또는 조건부 승인 또는 반려",
  "revisionChecks": [
    {
      "issueId": "담당자ID-ISSUE-001",
      "issue": "1차 검수 지적 사항",
      "result": "반영 또는 일부 반영 또는 미반영 또는 확인 불가",
      "detail": "수정 결과물의 반영 정도와 남은 문제에 대한 설명",
      "evidenceQuote": "수정 결과물 본문에서 그대로 복사한 연속 문장",
      "evidenceLocation": "제X조 제X항 또는 제X장 X절"
    }
  ],
  "completedChanges": ["실제로 반영된 수정 사항"],
  "unresolvedIssues": ["미반영 또는 미흡 사항"],
  "newRisks": ["새로 발견된 오류 및 위험"],
  "verificationNeeded": ["추가 확인이 필요한 사항"],
  "summary": "최종 검수 종합 의견"
}

해당 항목이 없으면 배열은 빈 배열 []로 출력한다.
revisionChecks의 result 값은 반드시 "반영", "일부 반영", "미반영", "확인 불가" 중 하나로 작성한다.
`,
      `사용자 원래 업무 지시:
${task}

전문 직원:
${specialist.name}

1차 팀장 검수 의견:
${firstReview.review}

1차 검수 지적사항 구조화 목록(아래 각 항목을 revisionChecks에 하나씩 그대로 기재할 것):
${(specialist.firstReviewIssueRecords || []).map(item => `${item.issueId}: ${item.issue}`).join("\n") || "추출된 항목 없음"}

수정된 결과물 전문:
${specialist.result}

전문 직원의 기존 작업 상태:
${specialist.status}

위 자료를 대조하여 수정 결과물의 2차 최종 검수를 수행해.`,
      true
    );

    const reviewData = parseJSON(finalReviewText);
    const allowedJudgments = ["승인", "조건부 승인", "반려"];
    let judgment = allowedJudgments.includes(reviewData.judgment)
      ? reviewData.judgment
      : "판정 불명";

    const revisionChecks = Array.isArray(reviewData.revisionChecks)
      ? reviewData.revisionChecks
      : [];

    // 2차 검수 응답에서 증거 인용이 빠진 경우, 수정 결과물 원문을 다시 제공해
    // 누락된 항목만 별도 추출한다. 인용문은 아래에서 실제 본문 존재 여부를 재검증한다.
    const evidenceTargets = (specialist.firstReviewIssueRecords || []).filter(record => {
      const matched = revisionChecks.find(check =>
        String(check.issueId || "") === record.issueId ||
        v48IssueMatches(check.issue, record.issue)
      );
      return !matched || !v48HasBodyEvidence(specialist.result, matched.evidenceQuote);
    });
    if (evidenceTargets.length > 0) {
      try {
        const evidenceRepairText = await askAI(
          "너는 검수 증거 추출기다. 제공된 결과물 본문에 실제로 존재하는 연속 문장만 그대로 인용한다. 추정하거나 문장을 새로 만들지 않는다. 인용문은 최소 12자이며 본문에서 그대로 검색 가능해야 한다. 근거를 찾지 못하면 evidenceQuote와 evidenceLocation을 빈 문자열로 둔다. 반드시 JSON 객체만 출력한다.",
          `아래 각 지적사항별로 결과물 본문에서 직접 확인할 수 있는 증거를 추출하라. issueId를 그대로 유지하라. {"items":[{"issueId":"...","evidenceQuote":"...","evidenceLocation":"..."}]}

지적사항:
${evidenceTargets.map(item => `${item.issueId}: ${item.issue}`).join("\n")}

결과물 본문:
${String(specialist.result || "")}`,
          true
        );
        const evidenceRepair = parseJSON(evidenceRepairText);
        for (const item of (Array.isArray(evidenceRepair.items) ? evidenceRepair.items : [])) {
          const target = evidenceTargets.find(record => record.issueId === String(item.issueId || ""));
          const quote = String(item.evidenceQuote || "").trim();
          if (!target || !v48HasBodyEvidence(specialist.result, quote)) continue;
          let check = revisionChecks.find(entry => String(entry.issueId || "") === target.issueId);
          if (!check) {
            check = revisionChecks.find(entry => v48IssueMatches(entry.issue, target.issue));
          }
          if (check) {
            check.issueId = target.issueId;
            check.issue = target.issue;
            check.evidenceQuote = quote;
            check.evidenceLocation = String(item.evidenceLocation || "본문 내 위치 미특정");
          }
        }
      } catch (evidenceRepairError) {
        console.log("검수 증거 재추출 실패:", evidenceRepairError.message);
      }
    }

    const unresolvedIssues = Array.isArray(reviewData.unresolvedIssues)
      ? reviewData.unresolvedIssues.filter(
          item => item && !["없음", "해당 없음"].includes(String(item).trim())
        )
      : [];

    // AI가 승인이라고 했더라도 미반영 사항이 구조화된 결과에 있으면 승인으로 처리하지 않는다.
    const newRisks = Array.isArray(reviewData.newRisks)
      ? reviewData.newRisks.filter(
          item => item && !["없음", "해당 없음"].includes(String(item).trim())
        )
      : [];
    const verificationNeeded = Array.isArray(reviewData.verificationNeeded)
      ? reviewData.verificationNeeded.filter(
          item => item && !["없음", "해당 없음"].includes(String(item).trim())
        )
      : [];

    // 결과물 원문은 아래의 모든 결정론적 검사보다 먼저 초기화한다.
    // 기존 코드에서는 이 선언보다 앞서 deliverableText를 참조해 TDZ 오류가 발생했다.
    const deliverableText = String(specialist.result || "");

    // Worker에는 법령 원문을 조회하는 공식 법령 API/검색 기능이 연결되어 있지 않다.
    // 법률·규정 관련 결과물은 공식 원문 대조 전까지 검증 완료로 처리하지 않는다.
    const legalContentPattern = /(민법|상법|공정거래법|하도급법|개인정보보호법|전자상거래법|상표법|특허법|근로기준법|산업안전보건법|법률\s*제|시행령|시행규칙|제\s*\d+조|조문|판례|법정이율|소멸시효|제척기간)/i;
    const requiresLegalSourceCheck = legalContentPattern.test(String(specialist.result || ""));

    // 반복적으로 발생한 대표적인 조문 오기·법리 오류를 결정론적으로 탐지한다.
    if (/민법\s*제\s*582조/.test(deliverableText) && /인도받은\s*날.{0,25}6개월|인도한\s*날.{0,25}6개월/.test(deliverableText)) {
      newRisks.push("민법 제582조의 6개월 기간을 목적물 인도일 기준으로 설명한 문구가 탐지되었습니다. 원칙적인 기산점은 매수인이 하자를 안 날이므로 해당 문구를 정정해야 합니다.");
    }
    if (/민법\s*제\s*582조/.test(deliverableText) && /당사자.{0,30}약정.{0,30}(?:우선|단축|배제)|제582조.{0,50}본\s*조의\s*기간에\s*따른다/.test(deliverableText)) {
      newRisks.push("민법 제582조의 법정 권리행사기간을 당사자 약정으로 당연히 단축·배제하거나 계약기간이 우선한다고 단정한 표현이 탐지되었습니다. 약정의 유효성은 별도 법률 검토 없이 단정할 수 없습니다.");
    }
    if (/상법\s*제\s*39조.{0,30}표현대표|상법\s*제\s*41조.{0,30}명의대여/.test(deliverableText)) {
      newRisks.push("상법 조문 번호와 법리가 잘못 연결된 표현이 탐지되었습니다. 표현대표이사는 제395조, 명의대여자 책임은 제24조를 확인해야 합니다.");
    }

    if (requiresLegalSourceCheck && !verificationNeeded.some(item => /법령|조문|원문|공식 출처|현행성/.test(String(item)))) {
      verificationNeeded.push("공식 법령 원문 및 현행 조문 대조가 수행되지 않았습니다. 관련 법령명·조문 번호·조문 내용·시행일·적용 요건을 국가법령정보센터 등 공식 원문으로 별도 확인해야 합니다.");
    }

    // 결과물의 원문과 구조화된 검수 결과를 코드에서 추가 대조한다.
    const isLegalDeliverable = legalContentPattern.test(deliverableText);

    // 법률 결과물의 수치가 법정 기준인지 협상 예시인지 명확하지 않으면 별도 확인 대상으로 올린다.
    if (isLegalDeliverable && /(지체상금|지연배상|하자보증|검수기간|대금\s*지급|시정기간)/.test(deliverableText)) {
      const numericTerms = deliverableText.match(/(?:지체상금|지연배상|하자보증|검수기간|대금\s*지급|시정기간)[^\n]{0,100}(?:\d+(?:\.\d+)?\s*%|\d+\s*일|\d+\s*개월|\d+\s*년)/g) || [];
      const unqualifiedNumbers = numericTerms.filter(line =>
        !/(예시|예정|예시적|협상|당사자\s*약정|거래별\s*합의|법정\s*기준이\s*아님|참고\s*수치)/.test(line)
      );
      if (unqualifiedNumbers.length > 0) {
        newRisks.push("법률상 기준인지 협상 예시인지 구분되지 않은 수치가 포함되어 있습니다: " + unqualifiedNumbers.slice(0, 3).join(" / "));
      }
    }

    // 조건부 승인·반려인데 결과물 본문이 최종 확정 또는 배포 가능으로 표현하면 상태 충돌로 기록한다.
    const containsFinalityClaim = /(최종\s*(?:승인|확정|배포)|배포\s*가능|조건부\s*승인\s*사항이\s*해소)/.test(deliverableText);
    if (containsFinalityClaim && judgment !== "승인") {
      unresolvedIssues.push("결과물 본문에 최종 승인·확정·배포를 단정하는 표현이 있으나 시스템의 2차 검수 판정은 '" + judgment + "'입니다. 본문 결론을 판정에 맞게 정정해야 합니다.");
    }

    // 1차 검수 지적사항을 항목별로 대조하지 않은 경우 승인 금지.
    const normalizedChecks = revisionChecks.map(item => ({
      issue: normalizeIssueText(item.issue),
      detail: normalizeIssueText(item.detail),
      evidenceQuote: item.evidenceQuote,
      evidenceLocation: item.evidenceLocation,
      result: item.result
    }));
    const normalizedDeliverable = normalizeIssueText(specialist.result);
    const missingFirstReviewIssues = firstReviewIssues.filter(issue => {
      const expected = normalizeIssueText(issue);
      if (!expected) return false;
      return !normalizedChecks.some(check => {
        const issueMatched = check.issue === expected ||
          (expected.length >= 18 && (check.issue.includes(expected) || expected.includes(check.issue)));
        // 증거는 설명(detail)이 아니라 별도 evidenceQuote 필드로 검증한다.
        const quote = normalizeIssueText(check.evidenceQuote);
        const evidenceQuotedInBody = quote.length >= 12 && normalizedDeliverable.includes(quote);
        return issueMatched;
      });
    });
    for (const missingIssue of missingFirstReviewIssues) {
      revisionChecks.push({
        issue: missingIssue,
        result: "확인 불가",
        detail: "2차 검수 결과에서 수정된 본문상의 구체적인 반영 근거를 항목별로 확인하지 못했습니다."
      });
      unresolvedIssues.push("1차 검수 지적사항의 수정 여부를 항목별로 입증하지 못했습니다: " + missingIssue);
    }
    if (firstReviewIssueExtractionFailed) {
      unresolvedIssues.push("1차 검수 지적사항 목록을 신뢰성 있게 추출하지 못해 항목별 재검수를 완료할 수 없습니다.");
    }

    const hasUnresolvedRevision = unresolvedIssues.length > 0 ||
      newRisks.length > 0 ||
      verificationNeeded.length > 0 ||
      revisionChecks.some(item =>
        !["반영", "해당 없음"].includes(item.result)
      );

    if (judgment === "승인" && hasUnresolvedRevision) {
      judgment =
        revisionChecks.some(item => item.result === "미반영") ||
        newRisks.some(item => /중대|치명|위법|허위|잘못된 조문|핵심 오류|당사자 역할 역전|통합 누락/.test(String(item)))
          ? "반려"
          : "조건부 승인";
    }

    // 결과물 상태가 부분 완료이거나 1차 검수 보완사항을 실제로 수정하지 않았다면 승인 금지.
    if (judgment === "승인" && specialist.status !== "completed") {
      judgment = "조건부 승인";
      unresolvedIssues.push("전문 직원 결과물의 작업 상태가 완료가 아니므로 무조건 승인할 수 없습니다.");
    }

    // 1차 지적사항이 있는데 2차 검수의 본문 대조 기록이 비어 있으면 승인 금지.
    if (judgment === "승인" && revisionChecks.length === 0 && firstJudgment !== "승인") {
      judgment = "조건부 승인";
      unresolvedIssues.push("1차 검수 지적 사항에 대한 2차 대조 내역이 없습니다.");
    }

    // 판정값과 요약 문구는 AI의 자유서술에 맡기지 않고 코드에서 일치시킨다.
    const deterministicSummary = judgment === "승인"
      ? "2차 별도 단계 검수 결과 승인 기준을 충족했습니다. 다만 본 판정은 AI 검수 범위 내 결과이며 외부 원문 확인이나 실제 외부 실행을 의미하지 않습니다."
      : judgment === "조건부 승인"
        ? "2차 검수 결과 조건부 승인입니다. 아래 미해결 사항 및 추가 확인 사항이 해소되고 재검수를 통과하기 전까지 최종 승인 또는 배포로 취급할 수 없습니다."
        : judgment === "반려"
          ? "2차 검수 결과 반려입니다. 핵심 오류 또는 미반영 사항을 수정한 후 처음부터 재검수해야 하며 현재 결과물은 승인·배포할 수 없습니다."
          : "검수 판정을 확정하지 못했습니다. 검수 실패로 처리하며 결과물을 승인·배포할 수 없습니다.";

    const normalizedReviewData = {
      ...reviewData,
      judgment,
      revisionChecks,
      completedChanges: Array.isArray(reviewData.completedChanges) ? reviewData.completedChanges : [],
      unresolvedIssues,
      newRisks,
      verificationNeeded,
      summary: deterministicSummary
    };

    const reviewContent = JSON.stringify(normalizedReviewData, null, 2);

    finalReviewResults.push({
      id: specialist.id,
      name: specialist.name,
      status: judgment === "판정 불명" ? "failed" : "completed",
      judgment,
      review: reviewContent,
      details: normalizedReviewData
    });

    if (judgment !== "승인" || specialist.status !== "completed") {
      specialist.status = "partial";
    }
  } catch (error) {
    if (error.message === "SW_AI_YIELD") throw error;
    finalReviewResults.push({
      id: specialist.id,
      name: specialist.name,
      status: "failed",
      judgment: "검수 실패",
      review: "2차 최종 검수 실패: " + error.message
    });

    specialist.status = "partial";
    specialist.errors = Array.isArray(specialist.errors)
      ? specialist.errors
      : [];
    specialist.errors.push(
      "팀장 2차 최종 검수 실패: " + error.message
    );
  }
}


// 5-3. 폐쇄형 수정 루프: 2차 검수에서 발견된 수정 가능 오류를 실제 본문에 반영하고 재검수한다.
await setCurrentStage("검수 지적사항 실제 수정 및 재검수", { responsibleRole: "담당 전문 직원 및 팀장", participants: (specialistResults || []).map(item => item.name) });

function deterministicContentIssues(content) {
  const value = String(content || "");
  const issues = [];

  // 테스트에서 실제 발견된 비문·의미 없는 생성 오류와 자주 쓰이는 오염 표현
  const malformedPhrases = [
    "일당 1가마니",
    "시소를 최고",
    "그 시소를 최고",
    "이행을 최고" // 법률 문맥에서 오용된 경우는 AI 검수에서 별도 판단
  ];
  for (const phrase of malformedPhrases) {
    if (value.includes(phrase) && phrase !== "이행을 최고") {
      issues.push("문맥상 의미가 성립하지 않는 생성 오류 표현: " + phrase);
    }
  }

  // 지체상금·지연배상 수치가 법정 기준 또는 협상 예시인지 불분명한 경우
  const numericLines = value.split(/\r?\n/).filter(line =>
    /(지체상금|지연배상|지연손해금|하자보증)/.test(line) &&
    /(?:\d+(?:\.\d+)?\s*%|\d+\s*일|\d+\s*개월|\d+\s*년)/.test(line) &&
    !/(예시|협상안|당사자\s*약정|거래별\s*합의|참고\s*수치|법정\s*기준이\s*아님)/.test(line)
  );
  if (numericLines.length) {
    issues.push("법정 기준인지 계약상 협상 예시인지 구분되지 않은 지체상금·지연배상 수치가 있음: " + numericLines.slice(0, 4).join(" / "));
  }

  // 결과물 내부에 최종 승인·배포를 단정하는 문구가 남아 있는지
  if (/(최종\s*(?:승인|확정|배포)\s*(?:완료|가능)|배포\s*가능)/.test(value)) {
    issues.push("실제 검수 판정과 충돌할 수 있는 최종 승인·배포 단정 문구가 있음");
  }

  return [...new Set(issues)];
}

for (const specialist of specialistResults) {
  const firstReviewIssues = Array.isArray(specialist.firstReviewIssues)
    ? specialist.firstReviewIssues
    : [];
  const reviewIndex = finalReviewResults.findIndex(item => item.id === specialist.id);
  if (reviewIndex < 0) continue;

  const priorReview = finalReviewResults[reviewIndex];
  const detail = priorReview.details || {};
  const lintIssues = deterministicContentIssues(specialist.result);
  const reviewIssues = [
    ...(detail.unresolvedIssues || []),
    ...(detail.newRisks || []),
    ...lintIssues
  ].filter(Boolean);

  // 외부 원문 조회처럼 Worker가 수행할 수 없는 검증은 자동 수정 대상으로 삼지 않는다.
  const actionableIssues = reviewIssues.filter(issue =>
    !/공식 법령 원문|현행 조문 대조|외부 원문|공식 출처.*조회|외부 조회/.test(String(issue))
  );

  if (actionableIssues.length === 0) continue;

  try {
    const before = String(specialist.result || "");
    const corrected = await askAI(
      String(specialist.instruction || "") + `

너는 SW AI OFFICE 전문 직원의 2차 검수 지적사항 수정 담당자다.
이번 단계는 실제 결과물 본문을 고치는 단계다. 검수 의견을 설명하거나 반박하지 말고 결과물 전문을 처음부터 끝까지 다시 작성하라.

[반드시 지킬 사항]
- 아래 지적사항을 실제 본문에서 제거하거나 정확하게 바로잡는다.
- 근거가 없는 법률·수치·기간·비율을 임의로 만들어내지 않는다.
- 법정 의무, 계약상 제안, 협상 예시, 업계 관행 및 내부 운영 권고를 명확히 구분한다.
- 지체상금·지연배상률·상한 등 법적 근거가 확인되지 않은 수치는 보편적 법정 기준처럼 쓰지 않는다. 필요하면 수치를 삭제하고 '당사자 간 별도 합의'로 정리한다.
- 문맥상 의미가 성립하지 않는 문구, 오탈자, 깨진 문장, 잘못된 단어를 제거한다.
- 법령 원문 조회가 필요한 사항은 검증 완료라고 쓰지 말고 확인 필요로 남긴다.
- 원래 요청된 필수 내용과 정상적인 설명은 유지한다.
- 결과물 전문만 출력한다. 수정 설명이나 검수 보고는 출력하지 않는다.
`,
      `사용자 원래 지시:
${task}

현재 결과물 전문:
${before}

2차 검수 및 자동 품질검사에서 실제 확인된 수정 대상:
${actionableIssues.map((x, i) => `${i + 1}. ${x}`).join("\n")}

위 사항을 본문에 실제 반영한 수정 결과물 전문을 작성하라.`
    );

    const correctedText = String(corrected || "").trim();
    if (correctedText.length < 300 ||
        /AI 호출 오류로 작성하지 못했습니다|작성하지 못했습니다|후속 작성이 필요합니다/.test(correctedText)) {
      throw new Error("수정 결과물이 비어 있거나 실패 표시가 포함되어 있습니다.");
    }

    specialist.result = correctedText;
    specialist.revisedAfterSecondReview = true;
    specialist.status = "completed";

    // 수정 후 동일 팀장 단계에 재검수 요청. 본문 자체를 검수 대상으로 전달한다.
    const reviewer = getTeamLeader(specialist);
    if (!reviewer) throw new Error(specialist.name + " 담당 팀장을 찾을 수 없습니다.");

    const recheckText = await askAI(
      String(reviewer.instruction || "") + `

너는 SW AI OFFICE 팀장이다. 앞선 검수 결과를 그대로 복사하지 말고 아래 수정된 결과물 전문을 새로 독립 검수하라.
특히 지적사항이 실제로 제거·수정됐는지, 수정 과정에서 새로운 오류가 생겼는지 본문을 직접 확인하라.
공식 원문을 조회하지 않았다면 법률 현행성 검증 완료로 판정하지 말라.
중대한 오류가 있으면 반려, 핵심 근거 확인이 남으면 조건부 승인, 모든 핵심 검토기준을 충족한 경우에만 승인하라.
JSON 객체만 출력하라. 다음 키를 정확히 사용하라:
{
 "judgment":"승인 또는 조건부 승인 또는 반려",
 "revisionChecks":[{"issueId":"ISSUE-001","issue":"지적사항","result":"반영 또는 일부 반영 또는 미반영 또는 확인 불가","detail":"수정 본문에서 확인한 근거"}],
 "completedChanges":["실제 수정 사항"],
 "unresolvedIssues":["남은 문제"],
 "newRisks":["새로 발견된 위험"],
 "verificationNeeded":["외부 확인 필요 사항"],
 "summary":"검수 요약"
}
`,
      `사용자 지시:
${task}

1차 검수 지적사항(고유 ID 유지):
${(specialist.firstReviewIssueRecords || []).map(item => `${item.issueId}: ${item.issue}`).join("\n")}

2차 검수 및 자동 품질검사 추가 수정 대상:
${actionableIssues.join("\n")}

수정된 결과물 전문:
${specialist.result}

위 수정본을 처음부터 끝까지 재검수하라.`,
      true
    );

    const recheck = parseJSON(recheckText);
    const allowed = ["승인", "조건부 승인", "반려"];
    let newJudgment = allowed.includes(recheck.judgment) ? recheck.judgment : "판정 불명";
    const recheckUnresolved = Array.isArray(recheck.unresolvedIssues)
      ? recheck.unresolvedIssues.filter(x => x && !["없음", "해당 없음"].includes(String(x).trim()))
      : [];
    const recheckRisks = Array.isArray(recheck.newRisks)
      ? recheck.newRisks.filter(x => x && !["없음", "해당 없음"].includes(String(x).trim()))
      : [];
    const recheckVerify = Array.isArray(recheck.verificationNeeded)
      ? recheck.verificationNeeded.filter(x => x && !["없음", "해당 없음"].includes(String(x).trim()))
      : [];
    const remainingLint = deterministicContentIssues(specialist.result);

    // 수정 후 재검수에서도 외부 법령 원문 미조회 사실은 사라지지 않는다.
    const legalPatternAfterRevision = /(민법|상법|공정거래법|하도급법|개인정보보호법|전자상거래법|상표법|특허법|근로기준법|산업안전보건법|법률\s*제|시행령|시행규칙|제\s*\d+조|조문|판례|법정이율|소멸시효|제척기간)/i;
    if (legalPatternAfterRevision.test(String(specialist.result || "")) &&
        !recheckVerify.some(item => /법령|조문|원문|공식 출처|현행성/.test(String(item)))) {
      recheckVerify.push("Worker에서 공식 법령 원문을 실제 조회하지 않았으므로 법령명·조문 번호·조문 내용·시행일·적용 요건의 현행성 검증이 미완료입니다.");
    }

    // 재검수 결과에도 1차 지적사항이 모두 들어갔는지 다시 확인한다.
    const recheckChecks = Array.isArray(recheck.revisionChecks) ? recheck.revisionChecks : [];
    const recheckNormalized = recheckChecks.map(item => ({
      issue: normalizeIssueText(item.issue),
      evidenceQuote: normalizeIssueText(item.evidenceQuote)
    }));
    const normalizedRevisedBody = normalizeIssueText(specialist.result);
    const missingOnRecheck = firstReviewIssues.filter(issue => {
      const expected = normalizeIssueText(issue);
      return expected && !recheckNormalized.some(check => {
        const issueMatched = check.issue === expected ||
          (expected.length >= 18 && (check.issue.includes(expected) || expected.includes(check.issue)));
        return issueMatched && check.evidenceQuote.length >= 12 && normalizedRevisedBody.includes(check.evidenceQuote);
      });
    });
    if (missingOnRecheck.length) {
      recheckUnresolved.push(...missingOnRecheck.map(issue => "재검수에서 1차 지적사항별 반영 여부 확인 누락: " + issue));
    }

    if (remainingLint.length || recheckUnresolved.length || recheckRisks.length || recheckVerify.length) {
      if (newJudgment === "승인") newJudgment = "조건부 승인";
    }
    if (recheckChecks.some(item => !["반영", "해당 없음"].includes(item.result))) {
      if (newJudgment === "승인") newJudgment = "조건부 승인";
    }
    if (missingOnRecheck.length && newJudgment === "승인") newJudgment = "조건부 승인";
    if (recheckVerify.length && newJudgment === "승인") newJudgment = "조건부 승인";
    if (remainingLint.length) {
      newJudgment = "반려";
      recheckUnresolved.push(...remainingLint.map(x => "자동 품질검사 미통과: " + x));
    }

    const normalized = {
      ...recheck,
      judgment: newJudgment,
      revisionChecks: Array.isArray(recheck.revisionChecks) ? recheck.revisionChecks : [],
      completedChanges: Array.isArray(recheck.completedChanges) ? recheck.completedChanges : [],
      unresolvedIssues: recheckUnresolved,
      newRisks: recheckRisks,
      verificationNeeded: recheckVerify,
      summary: newJudgment === "승인"
        ? "2차 지적사항 수정 후 재검수에서 승인 기준을 충족했습니다. 외부 원문 확인 및 실제 외부 실행을 의미하지 않습니다."
        : newJudgment === "조건부 승인"
          ? "2차 지적사항을 수정한 뒤 재검수했으나 추가 확인 또는 보완이 남아 있습니다. 최종 승인·배포할 수 없습니다."
          : "수정 후 재검수에서 중대한 오류 또는 품질검사 미통과 사항이 확인되어 반려합니다."
    };

    finalReviewResults[reviewIndex] = {
      ...priorReview,
      status: newJudgment === "판정 불명" ? "failed" : "completed",
      judgment: newJudgment,
      review: JSON.stringify(normalized, null, 2),
      details: normalized,
      recheckedAfterRevision: true
    };

    if (newJudgment !== "승인") specialist.status = "partial";
  } catch (error) {
    if (error.message === "SW_AI_YIELD") throw error;
    specialist.status = "partial";
    specialist.errors = Array.isArray(specialist.errors) ? specialist.errors : [];
    specialist.errors.push("2차 검수 지적사항 수정·재검수 실패: " + error.message);
    finalReviewResults[reviewIndex] = {
      ...priorReview,
      status: "failed",
      judgment: "재검수 실패",
      review: String(priorReview.review || "") + "\n\n2차 수정·재검수 실패: " + error.message
    };
  }
}


// v49: 담당자별 고유 이슈 ID, 본문 증거 자동 추출, 미해결 목록 정합성을 대조한다.
function v48IssueMatches(left, right) {
  const a = normalizeIssueText(left);
  const b = normalizeIssueText(right);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)));
}

function v48HasBodyEvidence(body, quote) {
  const normalizedBody = normalizeIssueText(body);
  const normalizedQuote = normalizeIssueText(quote);
  return normalizedQuote.length >= 12 && normalizedBody.includes(normalizedQuote);
}

// v49: AI가 evidenceQuote를 누락해도 결과물 본문에서 관련 문장을 결정론적으로 추출한다.
// 이 기능은 문구의 존재만 입증하며, 법률적 정확성이나 외부 사실의 진실성까지 입증하지 않는다.
function v49ExtractBodyEvidence(body, issue) {
  const source = String(body || "");
  const issueText = String(issue || "");
  if (!source.trim() || !issueText.trim()) return null;

  const stopWords = new Set([
    "관련", "내용", "사항", "부분", "필요", "검토", "확인", "요청", "수정",
    "보완", "반영", "기재", "작성", "설명", "제시", "명확", "구체", "대해",
    "대한", "경우", "통해", "위해", "그리고", "또는", "있음", "없음",
    "하여", "하는", "한다", "해야", "있다", "없다", "것으로", "하도록"
  ]);
  const tokens = [...new Set((issueText.match(/[가-힣]{2,}|[A-Za-z]{2,}|\d+(?:\.\d+)?%?/g) || [])
    .map(token => token.toLowerCase())
    .filter(token => !stopWords.has(token) && token.length >= 2))];
  if (!tokens.length) return null;

  const lines = source.split(/\r?\n/);
  const candidates = [];
  let offset = 0;
  for (const line of lines) {
    const cleanLine = line.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (cleanLine.length >= 12 && !/^#{1,6}\s/.test(cleanLine)) {
      // 한 줄에 여러 문장이 있으면 문장 단위로 나눠 가장 직접적인 근거를 선택한다.
      const sentences = cleanLine.match(/[^.!?。！？]+[.!?。！？]?/g) || [cleanLine];
      for (const sentence of sentences) {
        const quote = sentence.trim();
        if (quote.length < 12) continue;
        const normalized = normalizeIssueText(quote);
        const matched = tokens.filter(token => normalized.includes(normalizeIssueText(token)));
        const score = matched.reduce((sum, token) => sum + Math.min(token.length, 8), 0);
        if (score > 0) candidates.push({ quote: quote.slice(0, 360), score, offset });
      }
    }
    offset += line.length + 1;
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.quote.length - b.quote.length);
  const best = candidates[0];
  const preceding = source.slice(0, best.offset);
  const headings = preceding.split(/\r?\n/).filter(line =>
    /^\s*(?:#{1,6}\s+|\d+(?:\.\d+)*[.)]?\s+|제\s*\d+조)/.test(line)
  );
  return {
    evidenceQuote: best.quote,
    evidenceLocation: headings.length ? headings[headings.length - 1].trim().slice(0, 120) : "본문 내 관련 문장"
  };
}

function v49ReconcileEvidenceStatus(check, evidence) {
  if (!check || !evidence) return check;
  const result = String(check.result || "").trim();
  const detail = String(check.detail || "");
  // AI가 본문상 문구의 존재를 인정하면서도 '확인 불가'로 분류한 모순만 바로잡는다.
  if (result === "확인 불가" && /(본문에.{0,40}(?:있|존재|포함)|문구가.{0,30}(?:있|존재|기재)|기재되어 있|추가되어 있|포함되어 있|실제로 확인)/.test(detail)) {
    check.result = "일부 반영";
    check.detail = detail + " 본문에 관련 문구가 존재하므로 문구 반영 여부는 확인됩니다. 다만 요청 취지의 완전한 충족 여부 또는 별도 사실 검증은 남아 있어 일부 반영으로 정정했습니다.";
  }
  return check;
}

function v48IsEmptyIssue(value) {
  return !value || ["없음", "해당 없음", "없습니다", "해당사항 없음"].includes(String(value).trim());
}

for (const specialist of specialistResults) {
  const reviewIndex = finalReviewResults.findIndex(item => item.id === specialist.id);
  if (reviewIndex < 0) continue;

  const finalReview = finalReviewResults[reviewIndex];

  // 2차 검수 호출 자체가 실패한 경우, 정합성 정리 과정에서 완료로 둔갑시키지 않는다.
  if (finalReview.status !== "completed") {
    specialist.status = "partial";
    finalReview.judgment = finalReview.judgment || "검수 미완료";
    finalReview.review = finalReview.review || "2차 최종 검수 실행이 완료되지 않아 승인 여부를 판단할 수 없습니다.";
    continue;
  }

  const details = finalReview.details || {};
  const issueRecords = Array.isArray(specialist.firstReviewIssueRecords)
    ? specialist.firstReviewIssueRecords
    : (specialist.firstReviewIssues || []).map((issue, index) => ({
        issueId: `${String(specialist.id || "STAFF").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "STAFF"}-ISSUE-${String(index + 1).padStart(3, "0")}`,
        issue
      }));
  const checks = Array.isArray(details.revisionChecks) ? [...details.revisionChecks] : [];
  const unresolved = (Array.isArray(details.unresolvedIssues) ? [...details.unresolvedIssues] : [])
    .filter(item => !v48IsEmptyIssue(item));
  const risks = (Array.isArray(details.newRisks) ? [...details.newRisks] : [])
    .filter(item => !v48IsEmptyIssue(item));
  const verification = (Array.isArray(details.verificationNeeded) ? [...details.verificationNeeded] : [])
    .filter(item => !v48IsEmptyIssue(item));
  const body = String(specialist.result || "");
  const conflicts = [];
  const missingEvidence = [];

  // 2차 검수 응답의 누락·중복 ID를 그대로 두지 않고, 각 1차 지적사항에
  // 검수 항목을 정확히 하나씩 연결한다. 이미 사용한 항목은 다른 지적사항에 재사용하지 않는다.
  const usedCheckIndexes = new Set();
  const normalizedChecksForIssues = [];

  for (const record of issueRecords) {
    let matchIndex = checks.findIndex((check, index) =>
      !usedCheckIndexes.has(index) && String(check.issueId || "") === record.issueId
    );
    if (matchIndex < 0) {
      matchIndex = checks.findIndex((check, index) =>
        !usedCheckIndexes.has(index) && v48IssueMatches(check.issue, record.issue)
      );
    }

    let check;
    let aiCheckMissing = false;
    if (matchIndex >= 0) {
      usedCheckIndexes.add(matchIndex);
      check = { ...checks[matchIndex], issueId: record.issueId, issue: record.issue };
    } else {
      // AI가 항목별 검수 기록을 누락한 경우, Worker가 본문 근거를 먼저 직접 검색한다.
      aiCheckMissing = true;
      check = {
        issueId: record.issueId,
        issue: record.issue,
        result: "확인 불가",
        detail: "2차 검수 응답에서 이 지적사항에 대한 개별 검수 기록을 받지 못했습니다.",
        evidenceQuote: null,
        evidenceLocation: null
      };
    }

    // AI 인용문이 없거나 본문과 일치하지 않으면 Worker가 직접 관련 문장을 찾는다.
    let extractedEvidence = null;
    if (!v48HasBodyEvidence(body, check.evidenceQuote)) {
      extractedEvidence = v49ExtractBodyEvidence(body, record.issue);
      if (extractedEvidence) {
        check.evidenceQuote = extractedEvidence.evidenceQuote;
        check.evidenceLocation = extractedEvidence.evidenceLocation;
        check = v49ReconcileEvidenceStatus(check, extractedEvidence);
        if (aiCheckMissing) {
          check.result = "일부 반영";
          check.detail = "AI의 개별 검수 기록은 누락되었으나 Worker가 결과물 본문에서 관련 문장을 직접 추출했습니다. 문구의 존재는 확인되지만 요청 취지의 완전한 충족 여부는 별도 검수가 필요합니다.";
        }
      }
    }
    if (aiCheckMissing && !extractedEvidence) {
      missingEvidence.push(`${record.issueId}: 2차 검수 응답에 개별 확인 기록이 누락되었고 본문에서도 관련 근거를 찾지 못했습니다.`);
      unresolved.push(`${record.issueId}: 2차 검수 항목 및 본문 근거 누락 — ${record.issue}`);
    }
    normalizedChecksForIssues.push(check);
  }

  // 1차 지적사항에 대응하지 않는 중복·불명 항목은 별도 충돌로 남긴다.
  checks.forEach((check, index) => {
    if (!usedCheckIndexes.has(index)) {
      conflicts.push(`1차 지적사항과 연결되지 않은 2차 검수 항목이 존재합니다: ${String(check.issueId || check.issue || `항목 ${index + 1}`)}`);
    }
  });

  checks.splice(0, checks.length, ...normalizedChecksForIssues);

  // AI가 남긴 "1차 지적사항별 반영 여부 확인 누락" 문구는
  // 실제 revisionChecks가 존재하면 오래된 미해결 문구이므로 제거한다.
  // 이후 아래 항목별 판정에서 일부 반영·미반영·확인 불가 사유를 새로 기록한다.
  for (const record of issueRecords) {
    const matchedCheck = checks.find(item => String(item.issueId || "") === record.issueId);
    if (!matchedCheck) continue;
    unresolved.splice(0, unresolved.length, ...unresolved.filter(item => {
      const value = String(item || "").trim();
      const staleReviewGap = value.startsWith("재검수에서 1차 지적사항별 반영 여부 확인 누락:");
      return !(staleReviewGap && v48IssueMatches(value, record.issue));
    }));
  }

  for (const record of issueRecords) {
    const check = checks.find(item => item.issueId === record.issueId);
    if (!check) continue;
    let checkResult = String(check.result || "").trim();
    const unresolvedMatch = unresolved.find(item => v48IssueMatches(item, record.issue));
    const hasEvidence = v48HasBodyEvidence(body, check.evidenceQuote);

    if (!hasEvidence) {
      missingEvidence.push(`${record.issueId}: 본문에 실제로 존재하는 evidenceQuote를 확인하지 못했습니다.`);
      if (checkResult !== "미반영") {
        checkResult = "확인 불가";
        check.result = checkResult;
      }
    }
    // 동일 지적사항이 미해결 목록에 남아 있으면 '반영'으로 둘 수 없다.
    // 검수 결과를 일부 반영으로 자동 정정하고, 미해결 사유는 그대로 보존한다.
    if (checkResult === "반영" && unresolvedMatch) {
      check.result = "일부 반영";
      check.detail = String(check.detail || "") +
        " [시스템 정합성 보정] 동일 지적사항이 미해결 목록에 남아 있어 완전 반영이 아닌 일부 반영으로 정정했습니다.";
      checkResult = "일부 반영";
    }
    if (["일부 반영", "미반영", "확인 불가"].includes(checkResult)) {
      if (!unresolvedMatch) unresolved.push(`${record.issueId}: ${checkResult} — ${record.issue}`);
    }
  }

  // 결과물에 적힌 완료·검증·배포 표현은 시스템 판정과 별도로 검사한다.
  const bodyClaimsFinality = /(최종.{0,20}(?:완료|완성|승인|확정|배포)|완벽히\s*반영\s*완료|법적.{0,20}검증.{0,10}완료|법률.{0,20}검증.{0,10}완료|배포\s*가능)/i.test(body);

  let judgment = ["승인", "조건부 승인", "반려"].includes(finalReview.judgment)
    ? finalReview.judgment
    : "반려";

  if (conflicts.length > 0) {
    judgment = "반려";
    unresolved.push(...conflicts.map(item => "판정 정합성 오류: " + item));
  }
  if (risks.some(item => /민법 제582조|상법 조문 번호와 법리/.test(String(item)))) {
    judgment = "반려";
    unresolved.push("중대한 법률 조문 또는 법리 오류가 탐지되어 반려합니다. 오류 문구를 수정하고 공식 법령 원문 대조 후 재검수해야 합니다.");
  }
  if (missingEvidence.length > 0) {
    if (judgment === "승인") judgment = "반려";
    unresolved.push(...missingEvidence);
  }
  if (bodyClaimsFinality && judgment !== "승인") {
    judgment = "반려";
    unresolved.push("결과물 본문에 최종 완성·승인·법률 검증 완료·배포 가능을 단정하는 문구가 있으나 최종 검수 판정과 일치하지 않습니다. 본문 자체를 수정한 뒤 재검수해야 합니다.");
  }
  if (unresolved.length > 0 || risks.length > 0 || verification.length > 0) {
    if (judgment === "승인") judgment = "조건부 승인";
  }
  if (specialist.status !== "completed" && judgment === "승인") {
    judgment = "조건부 승인";
    unresolved.push("전문 직원 결과물 상태가 완료가 아니므로 승인할 수 없습니다.");
  }

  const unique = values => [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
  const normalizedDetails = {
    ...details,
    judgment,
    revisionChecks: checks,
    issueRegister: issueRecords.map(record => {
      const check = checks.find(item => String(item.issueId || "") === record.issueId) || {};
      return {
        issueId: record.issueId,
        issue: record.issue,
        status: String(check.result || "확인 불가"),
        evidenceQuote: check.evidenceQuote || null,
        evidenceLocation: check.evidenceLocation || null,
        reason: check.detail || ""
      };
    }),
    consistencyConflicts: unique(conflicts),
    missingEvidence: unique(missingEvidence),
    unresolvedIssues: unique(unresolved),
    newRisks: unique(risks),
    verificationNeeded: unique(verification),
    summary: judgment === "승인"
      ? "최종 정합성 검사 통과. 1차 지적사항, 2차 판정, 본문 증거 및 미해결 목록이 일치합니다."
      : judgment === "조건부 승인"
        ? "최종 정합성 검사 결과 조건부 승인입니다. 미해결 또는 외부 확인 사항을 해소하고 재검수하기 전까지 최종 배포할 수 없습니다."
        : "최종 정합성 검사에서 판정 충돌, 근거 부족 또는 본문 상태 모순이 확인되어 반려합니다. 결과물을 수정하고 재검수해야 합니다."
  };

  finalReviewResults[reviewIndex] = {
    ...finalReview,
    status: "completed",
    judgment,
    review: JSON.stringify(normalizedDetails, null, 2),
    details: normalizedDetails,
    v49IntegrityGate: true,
    evidenceValidation: "evidenceQuote 필드의 실제 본문 존재 여부를 검증"
  };

  specialist.status = judgment === "승인" ? "completed" : "partial";
}

// 결과물 본문 자체에 잘못된 최종 확정 표현이 남지 않도록 상태 정정 고지를 붙인다.
for (const specialist of specialistResults) {
  const finalReview = finalReviewResults.find(item => item.id === specialist.id);
  if (!finalReview || finalReview.judgment !== "승인") {
    const statusLabel = finalReview?.judgment || "검수 미완료";
    const notice = `\n\n---\n\n## SW AI OFFICE 검수 상태 정정 고지\n\n본 결과물의 시스템상 검수 판정은 **${statusLabel}**입니다. 본문에 기재된 '최종 승인', '최종 확정' 또는 '배포 가능' 등의 표현은 이 판정과 충돌하는 경우 효력이 없습니다. 미해결 사항 및 추가 확인 사항을 해소하고 재검수를 통과하기 전까지 본 결과물을 최종 승인본 또는 대외 배포본으로 사용하지 마십시오.`;
    if (!String(specialist.result || "").includes("SW AI OFFICE 검수 상태 정정 고지")) {
      specialist.result = `> SW AI OFFICE 최종 검수 상태: **${statusLabel}** — 최종 승인·대외 배포 전용 결과물이 아님.\n\n` + String(specialist.result || "") + notice;
    }
    specialist.status = "partial";
  }
}

// 코드가 최종 완료 여부를 직접 판정한다. AI 보고 문구에 맡기지 않는다.
const allSpecialistsApproved =
  specialistResults.length > 0 &&
  specialistResults.every(specialist => {
    const finalReview = finalReviewResults.find(
      item => item.id === specialist.id
    );

    return (
      specialist.status === "completed" &&
      finalReview &&
      finalReview.status === "completed" &&
      finalReview.judgment === "승인"
    );
  });

const usableDeliverableCount = specialistResults.filter(
  item =>
    typeof item.result === "string" &&
    item.result.trim().length > 0 &&
    item.status !== "failed"
).length;

const overallStatus = allSpecialistsApproved
  ? "완료"
  : usableDeliverableCount > 0
    ? "부분 완료"
    : "미완료";

const overallStatusReason = allSpecialistsApproved
  ? "모든 전문 직원 결과물이 정상 작성되었고 팀장 2차 최종 검수에서 승인되었습니다."
  : usableDeliverableCount > 0
    ? "결과물은 작성되었으나 일부 작성 오류, 검수 미완료, 조건부 승인 또는 반려 사항이 있어 전체 완료로 판정할 수 없습니다."
    : "사용 가능한 전문 직원 결과물이 없어 업무를 완료하지 못했습니다.";

const pendingFollowups = finalReviewResults
  .filter(item =>
    item.status !== "completed" || item.judgment !== "승인"
  )
  .map(item =>
    "- " + item.name + ": " + item.judgment + " / " + item.review
  );

const followupSummary = pendingFollowups.length > 0
  ? pendingFollowups.join("\n\n")
  : "팀장 2차 최종 검수에서 추가 보완이 필요한 사항은 확인되지 않았습니다.";

// 6. 본부장: 통합 검토 및 최종 보고
await writeTaskEvent("TASK_REVIEW_RESULTS_RECORDED", "팀장 최종 검수", {
  specialistCount: specialistResults.length,
  firstReviewCount: reviewResults.length,
  finalReviewCount: finalReviewResults.length,
  approvedCount: finalReviewResults.filter(item => item.judgment === "승인").length
});
await assertWorkflowControl();
if (quotaEncountered) throw new Error("SW_AI_QUOTA_WAIT");
if (aiCallFailureEncountered) throw new Error("SW_AI_STEP_FAILED: " + aiCallFailureMessage);
await setCurrentStage("본부장 최종 검토 및 보고", { responsibleRole: "본부장 알렉스", activity: "전문 직원 결과 통합 및 대표 보고" });

let finalReport;
const finalReportFallback = true;

// 본부장 최종 보고는 이미 확정된 업무 데이터로 코드가 작성한다.
// 별도의 OpenRouter 호출을 제거해 마지막 보고 단계에서 전체 요청이 524로 실패하는 일을 방지한다.
const reportLines = [
  "# SW AI OFFICE 본부장 업무 처리 보고",
  "",
  "## 1. 업무 처리 결과",
  "",
  `**전체 판정: ${overallStatus}**`,
  "",
  overallStatusReason,
  "",
  "## 2. 담당 부서 및 직원",
  "",
  `- 주관 부서: ${plan.leadDepartment || "미확인"}`,
  `- 담당 직원: ${specialistResults.map(item => item.name).join(", ") || "없음"}`,
  `- 담당 팀장: ${[...new Map(uniqueSpecialists.map(e => [e.department, getTeamLeader(e)])).values()].map(e => `${e.department} ${e.name}`).join(", ")}`,
  "",
  "## 3. 실제 작성된 결과물",
  "",
  ...specialistResults.map(item => `- ${item.name}: ${String(item.result || "").length}자 / 상태: ${item.status}`),
  "",
  "결과물 전문은 별도 결과물 영역에서 제공합니다.",
  "",
  "## 4. 팀장 1차 검수 결과",
  "",
  ...reviewResults.flatMap(item => [`### ${item.name}`, "", item.review || "검수 의견 없음", ""]),
  "## 5. 팀장 2차 최종 검수 결과",
  "",
  ...finalReviewResults.flatMap(item => [`### ${item.name} — ${item.judgment}`, "", item.review || "검수 의견 없음", ""]),
  "## 6. 미완료 사항 및 위험",
  "",
  ...specialistResults.flatMap(item => (item.errors || []).map(error => `- ${item.name}: ${error}`)),
  ...finalReviewResults.flatMap(item => {
    const details = item.details || {};
    return [
      ...(details.unresolvedIssues || []).map(value => `- ${item.name} 미해결: ${value}`),
      ...(details.newRisks || []).map(value => `- ${item.name} 신규 위험: ${value}`),
      ...(details.verificationNeeded || []).map(value => `- ${item.name} 추가 검증: ${value}`)
    ];
  }),
  ...(finalReviewResults.some(item => item.judgment !== "승인")
    ? ["- 최종 승인 게이트: 조건부 승인·반려·검수 미완료 결과물은 재검수 통과 전 최종 확정 또는 배포할 수 없습니다."]
    : []),
  "",
  "## 7. 사용자 승인 또는 결정이 필요한 사항",
  "",
  plan.approvalRequired
    ? (plan.approvalReason || "실제 외부 실행 전 대표이사의 승인이 필요합니다.")
    : "배정 단계에서 별도 승인이 지정되지 않았습니다. 실제 외부 실행은 별도 권한과 승인 절차를 따릅니다.",
  "",
  "## 8. 후속 조치",
  "",
  followupSummary,
  "",
  "## 9. AI가 실제로 완료한 작업과 외부 실행이 필요한 업무",
  "",
  "- AI 수행: 업무 분석, 담당자 배정, 실행계획 수립, 결과물 작성, 검수 및 필요한 수정 시도",
  "- 외부 실행: 계약 체결, 투자 실행, 대외 공시, 외부 발송 등은 수행하지 않았습니다.",
  "",
  "## 10. 사실 및 미확인 사항",
  "",
  "- 본 보고서는 코드에 기록된 결과물과 검수 응답을 바탕으로 자동 구성했습니다.",
  "- Worker에는 공식 법령 원문을 조회하는 기능이 연결되어 있지 않습니다. 법률·조문·현행성은 공식 원문 대조 전까지 검증 완료로 보지 않습니다.",
  "- 팀장 2차 검수는 동일 OpenRouter 모델을 별도 검수 단계와 지시문으로 호출한 절차이며, 사람 또는 별도 AI 모델에 의한 외부 독립감사를 의미하지 않습니다.",
  "- 법률·수치·외부 사실의 독립적인 검증이 이루어지지 않은 사항은 별도 확인이 필요합니다.",
  "- 조건부 승인 또는 부분 완료 상태의 결과물은 대표이사의 최종 승인 및 미해결 사항 해소 전까지 최종 배포본으로 취급하지 않습니다.",
  "- 본 보고서는 본부장 AI의 별도 생성문이 아닌, 확정된 처리 데이터에 따른 자동 보고서입니다."
];
finalReport = reportLines.join("\n");

// 최종 저장 직전에도 일시정지·취소·잠금 상태를 다시 확인한다.
await assertWorkflowControl();

const successPayload = {
  version: "v51.21",
  taskId,
  reply: finalReport,

  deliverables: specialistResults.map((item, index) => ({
    id: item.id,
    title: item.name || `결과물 ${index + 1}`,
    department: item.department || "",
    teamLeader: item.teamLeader || "",
    content: item.result,
    status: item.status,
    completeness: item.completeness || null,
    recoveredIssues: item.recoveredIssues || [],
    errors: item.errors || []
  })),

  reviewResults,
  finalReviewResults,

  workflow: {
    status: overallStatus === "완료" ? "completed" : overallStatus === "부분 완료" ? "partial" : "failed",
    resultStatus: overallStatus,
    resultStatusReason: overallStatusReason,
    reviewGate: {
      allSpecialistsApproved,
      finalReleaseAllowed: allSpecialistsApproved,
      rule: "모든 전문 직원 결과물이 completed 상태이고 팀장 2차 검수 judgment가 승인인 경우에만 최종 완료로 판정합니다.",
      integrityGate: "1차 지적사항 고유 ID, 2차 판정, 실제 본문 인용 증거, 미해결 목록의 상호 모순을 코드로 대조합니다. 반영/미해결 충돌 또는 본문 상태 모순은 반려 처리합니다.",
      legalSourceVerification: "공식 법령 원문 조회 기능이 연결되지 않아 법령 원문 대조는 별도 확인이 필요합니다.",
      reviewIndependence: "동일 OpenRouter 모델을 별도 검수 단계로 호출한 절차이며 사람 또는 별도 AI 모델의 독립감사는 아닙니다."
    },
    completenessChecks: specialistResults.map(item => ({
      id: item.id,
      name: item.name,
      ...(item.completeness || { passed: false, notes: "검사 정보 없음" })
    })),
    finalReportFallback,
    priority: plan.priority || "P3",
    leadDepartment: plan.leadDepartment,
    specialists: uniqueSpecialists.map(e => e.name),
    teamLeader: teamLeader.name,
    teamLeaders: [...new Map(uniqueSpecialists.map(e => [e.department, getTeamLeader(e)])).values()].map(e => ({ department: e.department, name: e.name })),
    collaboratingDepartments: plan.collaboratingDepartments || [],
    approvalRequired: Boolean(plan.approvalRequired),
    approvalReason: plan.approvalReason || "",
    externalExecution: "not_performed",
    executionStatus: overallStatus === "완료"
      ? "ai_review_approved_external_not_performed"
      : overallStatus === "부분 완료"
        ? "ai_work_partially_completed_external_not_performed"
        : "ai_work_incomplete_external_not_performed",
    stages: [
      "본부장 업무 분석 및 배정 완료",
      "본부장 실행계획 수립 완료",
      "전문 직원 결과물 작성 및 상태 확인 완료",
      "팀장 1차 검수 결과 기록 완료",
      "전문 직원 수정 작업 시도 완료",
      "팀장 2차 최종 검수 결과 기록 완료",
      finalReportFallback
        ? "본부장 최종 보고서 자동 구성 완료"
        : "본부장 최종 검토 및 보고 완료"
    ]
  }
};

await updateTask({
  status: successPayload.workflow.status === "completed" ? "COMPLETED" : "PARTIAL_COMPLETED",
  stage: "본부장 최종 검토 및 보고",
  resultJson: JSON.stringify(successPayload),
  error: null,
  completedAt: new Date().toISOString(),
  requireNoControl: true
});
try {
  if (lastRecordedStage) {
    await writeTaskEvent("WORKFLOW_STAGE_COMPLETED", lastRecordedStage, {
      outcome: "최종 보고서와 업무 결과 저장 완료"
    });
    lastRecordedStage = null;
  }
  await writeTaskEvent("TASK_COMPLETED", "본부장 최종 검토 및 보고", { status: successPayload.workflow.status });
} catch (eventError) {
  console.error("완료 이력 기록 실패:", eventError.message);
}
await releaseTaskLock();
return json(successPayload);

} catch (error) {
  const yielded = error.message === "SW_AI_YIELD";
  let timeoutResumable = false;
  let priorTimeoutCount = 0;
  if (isTimeoutFailure(error) && dbReady && taskId) {
    try {
      const priorTimeout = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM task_events
         WHERE task_id = ? AND event_type = 'AI_TIMEOUT_RESUME' AND stage = ?`
      ).bind(taskId, currentStage).first();
      // 모델 응답 지연에 대비해 동일 단계는 최대 3회까지만 체크포인트 재개한다.
      priorTimeoutCount = Number(priorTimeout?.total || 0);
      timeoutResumable = priorTimeoutCount < 3;
    } catch (timeoutCheckError) {
      console.error("시간 초과 재개 횟수 확인 실패:", timeoutCheckError.message);
    }
  }
  const resumable = yielded || timeoutResumable;
  let nextStatus = (resumable || error.message === "SW_AI_LOCK_LOST") ? "PROCESSING" : "PROCESSING_FAILED";
  if (error.message === "SW_AI_CONTROL_CHANGED") {
    try {
      const controlRow = await env.DB.prepare(
        `SELECT control_request FROM tasks WHERE task_id = ?`
      ).bind(taskId).first();
      const control = String(controlRow?.control_request || "NONE").toUpperCase();
      nextStatus = control === "CANCEL" ? "CANCELLED" : control === "PAUSE" ? "PAUSED" : "PROCESSING";
    } catch (_) {
      nextStatus = "PROCESSING";
    }
  }
  if (error.message === "SW_AI_PAUSED") nextStatus = "PAUSED";
  else if (error.message === "SW_AI_CANCELLED") nextStatus = "CANCELLED";
  else if (error.message === "SW_AI_QUOTA_WAIT" || quotaEncountered || /(?:HTTP\s+)?(?:402|429)\b|RESOURCE_EXHAUSTED|insufficient[_\s-]?quota|quota|rate.?limit|payment required|credit balance|no credits/i.test(error.message || "")) nextStatus = "WAITING_FOR_API_QUOTA";

  if (dbReady && taskId) {
    try {
      await updateTask({ status: nextStatus, stage: currentStage, error: resumable ? null : error.message });
      if (timeoutResumable) {
        await writeTaskEvent("AI_TIMEOUT_RESUME", currentStage, {
          status: "PROCESSING",
          retryCount: priorTimeoutCount + 1,
          maxRetriesForStage: 3,
          cachedAiCallCount: cachedAiCalls.size,
          nextAiCallIndex: aiCallCursor,
          error: error.message
        });
      }
      await writeTaskEvent(
        yielded ? "TASK_YIELDED_FOR_NEXT_REQUEST" : timeoutResumable ? "TASK_TIMEOUT_RESUME_REQUIRED" : nextStatus === "PAUSED" ? "TASK_PAUSED" : nextStatus === "CANCELLED" ? "TASK_CANCELLED" : nextStatus === "WAITING_FOR_API_QUOTA" ? "TASK_WAITING_FOR_QUOTA" : "TASK_FAILED",
        currentStage,
        { status: nextStatus, error: resumable ? null : error.message, cachedAiCallCount: cachedAiCalls.size, nextAiCallIndex: aiCallCursor, timeoutResumable }
      );
    } catch (dbError) {
      console.error("D1 상태 기록 실패:", dbError.message);
    }
    try { await releaseTaskLock(); } catch (lockError) { console.error("실행 잠금 해제 실패:", lockError.message); }
  }
  return json({
    taskId,
    status: nextStatus,
    currentStage,
    resumeRequired: resumable || nextStatus === "WAITING_FOR_API_QUOTA",
    cachedAiCallCount: cachedAiCalls.size,
    error: yielded
      ? "이번 요청의 AI 호출 단위를 마쳤습니다. 같은 taskId와 idempotencyKey로 이어서 처리합니다."
      : timeoutResumable
        ? "AI 응답 시간 초과가 발생했습니다. 저장된 체크포인트를 유지했으며 동일 단계 재개 횟수 한도 내에서 다시 처리할 수 있습니다."
      : nextStatus === "WAITING_FOR_API_QUOTA"
      ? "OpenRouter 할당량 또는 호출 제한으로 대기 중입니다. 같은 taskId와 idempotencyKey로 다시 요청하면 저장된 AI 결과를 재사용해 이어서 처리합니다."
      : nextStatus === "PAUSED"
        ? "업무가 안전한 AI 호출 경계에서 일시정지되었습니다."
        : nextStatus === "CANCELLED"
          ? "업무가 취소되었습니다."
          : currentStage + " 단계 실패: " + error.message
  }, resumable ? 202 : nextStatus === "WAITING_FOR_API_QUOTA" ? 429 : nextStatus === "PAUSED" || nextStatus === "CANCELLED" ? 200 : nextStatus === "PROCESSING" ? 409 : 500);
  }

}

};