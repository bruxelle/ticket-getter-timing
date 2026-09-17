(function () {
  const elements = {
    targetUrl: document.getElementById("target-url"),
    targetDatetime: document.getElementById("target-datetime"),
    syncSamples: document.getElementById("sync-samples"),
    openMode: document.getElementById("open-mode"),
    openCount: document.getElementById("open-count"),
    openIntervalMs: document.getElementById("open-interval-ms"),
    enablePreconnect: document.getElementById("enable-preconnect"),
    syncNow: document.getElementById("sync-now"),
    armTimer: document.getElementById("arm-timer"),
    cancelTimer: document.getElementById("cancel-timer"),
    statusBox: document.getElementById("status-box"),
    offsetValue: document.getElementById("offset-value"),
    offsetNote: document.getElementById("offset-note"),
    delayValue: document.getElementById("delay-value"),
    delayNote: document.getElementById("delay-note"),
    countdownValue: document.getElementById("countdown-value"),
    countdownNote: document.getElementById("countdown-note"),
    sampleCount: document.getElementById("sample-count"),
    syncSource: document.getElementById("sync-source"),
    fireTime: document.getElementById("fire-time"),
    openPlan: document.getElementById("open-plan"),
    lastSyncAt: document.getElementById("last-sync-at")
  };

  const state = {
    bestSample: null,
    armed: false,
    targetEpochMs: null,
    correctedFireEpochMs: null,
    countdownIntervalId: null,
    timerId: null,
    finalFrameId: null,
    repeatTimeoutId: null,
    scheduledOpenCount: 1,
    completedOpenCount: 0,
    openIntervalMs: 0,
    targetHref: "",
    preopenedWindows: []
  };

  const formatSignedMs = (value) => `${value >= 0 ? "+" : ""}${Math.round(value)} ms`;
  const formatMs = (value) => `${Math.round(value)} ms`;

  const formatDateTime = (epochMs) => {
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) {
      return "未設定";
    }
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    const ms = String(date.getMilliseconds()).padStart(3, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
  };

  const formatCountdown = (remainingMs) => {
    if (remainingMs <= 0) {
      return "0.000 秒";
    }
    const totalSeconds = Math.floor(remainingMs / 1000);
    const ms = String(remainingMs % 1000).padStart(3, "0");
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${ms}`;
  };

  const setStatus = (message, tone) => {
    elements.statusBox.textContent = message;
    elements.statusBox.dataset.tone = tone || "default";
  };

  const toDatetimeLocalValue = (date) => {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  const parseTargetUrl = () => {
    try {
      return new URL(elements.targetUrl.value);
    } catch (error) {
      throw new Error("有効な URL を入力してください。");
    }
  };

  const parseTargetTime = () => {
    const raw = elements.targetDatetime.value;
    if (!raw) {
      throw new Error("目標時刻を入力してください。");
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new Error("目標時刻の形式を確認してください。");
    }
    return date.getTime();
  };

  const parseOpenSettings = () => {
    const requestedCount = Number(elements.openCount.value);
    const requestedIntervalMs = Number(elements.openIntervalMs.value);
    const count = Number.isFinite(requestedCount)
      ? Math.max(1, Math.min(20, Math.round(requestedCount)))
      : 1;
    const intervalMs = Number.isFinite(requestedIntervalMs)
      ? Math.max(0, Math.min(60000, Math.round(requestedIntervalMs)))
      : 0;

    if (elements.openMode.value === "same_tab" && count > 1) {
      throw new Error("同じタブで複数回開くことはできません。複数回にする場合は「新しいタブで開く」を選んでください。");
    }

    return { count, intervalMs };
  };

  const stopTimers = () => {
    if (state.timerId) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
    if (state.countdownIntervalId) {
      window.clearInterval(state.countdownIntervalId);
      state.countdownIntervalId = null;
    }
    if (state.finalFrameId) {
      window.cancelAnimationFrame(state.finalFrameId);
      state.finalFrameId = null;
    }
    if (state.repeatTimeoutId) {
      window.clearTimeout(state.repeatTimeoutId);
      state.repeatTimeoutId = null;
    }
    state.armed = false;
    elements.cancelTimer.disabled = true;
    elements.armTimer.disabled = false;
  };

  const closePreopenedWindows = () => {
    state.preopenedWindows.forEach((targetWindow) => {
      if (targetWindow && !targetWindow.closed) {
        targetWindow.close();
      }
    });
    state.preopenedWindows = [];
  };

  const preparePreopenedWindows = (targetUrl, count) => {
    closePreopenedWindows();

    for (let index = 0; index < count; index += 1) {
      const targetWindow = window.open("about:blank", "_blank");
      if (!targetWindow) {
        closePreopenedWindows();
        throw new Error("ブラウザにより空タブの事前作成がブロックされました。ポップアップを許可してから再度待機を開始してください。");
      }

      targetWindow.document.title = "Timing Assistant - standby";
      targetWindow.document.body.style.fontFamily = "system-ui, sans-serif";
      targetWindow.document.body.style.margin = "24px";
      targetWindow.document.body.textContent = `指定時刻まで待機中です。発火時刻に ${targetUrl.host} を開きます。`;
      state.preopenedWindows.push(targetWindow);
    }
  };

  const updateCountdown = () => {
    if (!state.correctedFireEpochMs) {
      elements.countdownValue.textContent = "--";
      elements.countdownNote.textContent = "補正後の発火時刻を設定すると表示されます。";
      return;
    }

    const offsetMs = state.bestSample ? state.bestSample.offsetMs : 0;
    const correctedNow = Date.now() + offsetMs;
    const remainingMs = Math.max(0, state.targetEpochMs - correctedNow);
    elements.countdownValue.textContent = formatCountdown(remainingMs);
    elements.countdownNote.textContent = `補正後の現在時刻: ${formatDateTime(correctedNow)}`;
  };

  const applyPreconnect = (targetUrl) => {
    const origin = targetUrl.origin;
    const existing = document.querySelector(`link[data-preconnect-origin="${origin}"]`);
    if (existing) {
      return;
    }

    const preconnect = document.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = origin;
    preconnect.crossOrigin = "anonymous";
    preconnect.dataset.preconnectOrigin = origin;
    document.head.appendChild(preconnect);

    const dnsPrefetch = document.createElement("link");
    dnsPrefetch.rel = "dns-prefetch";
    dnsPrefetch.href = origin;
    dnsPrefetch.dataset.preconnectOrigin = origin;
    document.head.appendChild(dnsPrefetch);
  };

  const openTarget = () => {
    if (elements.openMode.value === "same_tab") {
      window.location.assign(state.targetHref);
      return;
    }

    const targetWindow = state.preopenedWindows[state.completedOpenCount];
    if (!targetWindow || targetWindow.closed) {
      setStatus("事前作成したタブが閉じられているため、URL を開けませんでした。もう一度待機を開始してください。", "warn");
      stopTimers();
      return;
    }

    try {
      targetWindow.opener = null;
    } catch (error) {
      // Some browsers may prevent changing opener; navigation can still proceed.
    }
    targetWindow.location.href = state.targetHref;
    state.completedOpenCount += 1;

    if (state.completedOpenCount >= state.scheduledOpenCount) {
      setStatus(`指定時刻に達したため、URL を ${state.completedOpenCount} 回開きました。`, "ok");
      stopTimers();
      return;
    }

    const remainingCount = state.scheduledOpenCount - state.completedOpenCount;
    setStatus(`指定時刻に達したため、URL を ${state.completedOpenCount} 回開きました。残り ${remainingCount} 回を ${formatMs(state.openIntervalMs)} 間隔で開きます。`, "ok");
    state.repeatTimeoutId = window.setTimeout(openTarget, state.openIntervalMs);
  };

  const scheduleOpen = () => {
    const remainingLocalMs = state.correctedFireEpochMs - Date.now();
    if (remainingLocalMs <= 0) {
      openTarget();
      return;
    }

    if (remainingLocalMs > 100) {
      state.timerId = window.setTimeout(scheduleOpen, Math.max(remainingLocalMs - 60, 25));
      return;
    }

    const tick = () => {
      const now = Date.now();
      if (now >= state.correctedFireEpochMs) {
        openTarget();
        return;
      }
      state.finalFrameId = window.requestAnimationFrame(tick);
    };

    state.finalFrameId = window.requestAnimationFrame(tick);
  };

  const renderSample = (sample, count) => {
    if (!sample) {
      elements.offsetValue.textContent = "未取得";
      elements.delayValue.textContent = "未取得";
      elements.sampleCount.textContent = "0";
      elements.syncSource.textContent = "未取得";
      elements.openPlan.textContent = "未設定";
      elements.lastSyncAt.textContent = "未同期";
      return;
    }

    elements.offsetValue.textContent = formatSignedMs(sample.offsetMs);
    elements.offsetNote.textContent = `サーバー - 手元時計。正の値はサーバーのほうが進んでいます。`;
    elements.delayValue.textContent = formatMs(sample.delayMs);
    elements.delayNote.textContent = `最小遅延サンプルを採用。最新計測時刻: ${formatDateTime(sample.clientReceiveEpochMs)}`;
    elements.sampleCount.textContent = String(count);
    elements.syncSource.textContent = sample.source || "server_clock";
    elements.lastSyncAt.textContent = formatDateTime(sample.clientReceiveEpochMs);
  };

  const fetchTimeSample = async () => {
    const clientSendEpochMs = Date.now();
    const response = await fetch("/api/time-sync", {
      method: "GET",
      cache: "no-store",
      headers: {
        "cache-control": "no-store"
      }
    });

    if (!response.ok) {
      throw new Error(`/api/time-sync failed: ${response.status}`);
    }

    const payload = await response.json();
    const clientReceiveEpochMs = Date.now();
    const serverReceiveEpochMs = Number(payload.serverReceiveEpochMs);
    const serverSendEpochMs = Number(payload.serverSendEpochMs);
    const offsetMs = ((serverReceiveEpochMs - clientSendEpochMs) + (serverSendEpochMs - clientReceiveEpochMs)) / 2;
    const delayMs = (clientReceiveEpochMs - clientSendEpochMs) - (serverSendEpochMs - serverReceiveEpochMs);

    return {
      source: payload.source || "server_clock",
      clientSendEpochMs,
      clientReceiveEpochMs,
      serverReceiveEpochMs,
      serverSendEpochMs,
      offsetMs,
      delayMs
    };
  };

  const synchronizeTime = async () => {
    const requestedSamples = Number(elements.syncSamples.value);
    const sampleCount = Number.isFinite(requestedSamples)
      ? Math.max(1, Math.min(7, Math.round(requestedSamples)))
      : 3;

    setStatus("時刻同期を実行中です。最小遅延サンプルを選びます。", "pending");
    elements.syncNow.disabled = true;

    try {
      const samples = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const sample = await fetchTimeSample();
        samples.push(sample);
      }

      samples.sort((left, right) => left.delayMs - right.delayMs);
      state.bestSample = samples[0];
      renderSample(state.bestSample, samples.length);
      updateCountdown();
      setStatus(`時刻同期が完了しました。推定オフセットは ${formatSignedMs(state.bestSample.offsetMs)} です。`, "ok");
      return state.bestSample;
    } finally {
      elements.syncNow.disabled = false;
    }
  };

  const armTimer = async () => {
    let createdPreopenedWindows = false;

    try {
      const targetUrl = parseTargetUrl();
      const targetEpochMs = parseTargetTime();
      const openSettings = parseOpenSettings();
      const now = Date.now();
      if (targetEpochMs <= now - 1000) {
        throw new Error("目標時刻が過去です。未来の時刻を指定してください。");
      }

      stopTimers();
      closePreopenedWindows();

      if (elements.openMode.value === "new_tab") {
        preparePreopenedWindows(targetUrl, openSettings.count);
        createdPreopenedWindows = true;
      }

      if (!state.bestSample) {
        await synchronizeTime();
      }

      if (elements.enablePreconnect.checked) {
        applyPreconnect(targetUrl);
      }

      state.targetEpochMs = targetEpochMs;
      state.correctedFireEpochMs = targetEpochMs - (state.bestSample ? state.bestSample.offsetMs : 0);
      state.scheduledOpenCount = openSettings.count;
      state.completedOpenCount = 0;
      state.openIntervalMs = openSettings.intervalMs;
      state.targetHref = targetUrl.href;
      state.armed = true;
      elements.cancelTimer.disabled = false;
      elements.armTimer.disabled = true;
      elements.fireTime.textContent = formatDateTime(state.correctedFireEpochMs);
      elements.openPlan.textContent = `${openSettings.count} 回 / ${formatMs(openSettings.intervalMs)} 間隔`;
      updateCountdown();
      state.countdownIntervalId = window.setInterval(updateCountdown, 100);

      const correctedNow = Date.now() + (state.bestSample ? state.bestSample.offsetMs : 0);
      const remainingMs = targetEpochMs - correctedNow;
      setStatus(`待機を開始しました。補正後の残り時間は ${formatCountdown(Math.max(0, remainingMs))} です。URL は ${openSettings.count} 回、${formatMs(openSettings.intervalMs)} 間隔で開きます。`, "ok");
      scheduleOpen();
    } catch (error) {
      stopTimers();
      if (createdPreopenedWindows) {
        closePreopenedWindows();
      }
      setStatus(error.message, "warn");
    }
  };

  const cancelTimer = () => {
    stopTimers();
    closePreopenedWindows();
    state.targetEpochMs = null;
    state.correctedFireEpochMs = null;
    state.completedOpenCount = 0;
    state.targetHref = "";
    elements.fireTime.textContent = "未設定";
    elements.openPlan.textContent = "未設定";
    updateCountdown();
    setStatus("待機を解除しました。", "pending");
  };

  const initialize = () => {
    const defaultTarget = new Date(Date.now() + 5 * 60 * 1000);
    defaultTarget.setMilliseconds(0);
    elements.targetDatetime.value = toDatetimeLocalValue(defaultTarget);
    elements.syncNow.addEventListener("click", () => {
      synchronizeTime().catch((error) => {
        setStatus(`時刻同期に失敗しました: ${error.message}`, "warn");
      });
    });
    elements.armTimer.addEventListener("click", () => {
      armTimer().catch((error) => {
        setStatus(`待機開始に失敗しました: ${error.message}`, "warn");
      });
    });
    elements.cancelTimer.addEventListener("click", cancelTimer);
    renderSample(null, 0);
    updateCountdown();
  };

  initialize();
})();
