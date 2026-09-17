(function () {
  const defaultSettings = {
    enabled: false,
    reloadBeforeApply: true,
    ticketType: "VIP",
    ticketTypeValue: "VIP",
    quantity: "2",
    favoriteArtist: "アーティストB",
    favoriteArtistValue: "アーティストB",
    paymentMethod: "コンビニ決済（前払い）",
    purchaser: {
      lastName: "山田",
      firstName: "花子",
      phoneNumber: "09012345678"
    },
    siteDiscovery: {
      targetUrl: "",
      favoriteSourceUrl: "",
      sourceMode: "performers",
      performersSelector: "#performing-artists",
      ticketInfoSelector: "",
      favoriteArtistSelector: "#favorite-artist",
      learnedAt: "",
      ticketTypeOptions: [
        { label: "一般", value: "一般" },
        { label: "学生", value: "学生" },
        { label: "VIP", value: "VIP" }
      ],
      favoriteArtistOptions: [
        { label: "アーティストA", value: "アーティストA" },
        { label: "アーティストB", value: "アーティストB" },
        { label: "アーティストC", value: "アーティストC" },
        { label: "全体目当て", value: "全体目当て" }
      ],
      manualFavoriteOptions: []
    },
    runtime: {
      keepBrowserOpenMs: 0,
      loginKeepBrowserOpenMs: 600000,
      captureFullPageScreenshot: true,
      captureTrace: false,
      requireFavorite: true,
      requireAuthenticated: true,
      userDataDir: ".playwright-user-data/auto-selection"
    }
  };

  const elements = {
    form: document.getElementById("settings-form"),
    enabled: document.getElementById("enabled"),
    reloadBeforeApply: document.getElementById("reload-before-apply"),
    ticketType: document.getElementById("ticket-type"),
    quantity: document.getElementById("quantity"),
    discoveryUrl: document.getElementById("discovery-url"),
    favoriteSourceUrl: document.getElementById("favorite-source-url"),
    performersSelector: document.getElementById("performers-selector"),
    ticketInfoSelector: document.getElementById("ticket-info-selector"),
    favoriteSelector: document.getElementById("favorite-selector"),
    discoverFavoriteOptions: document.getElementById("discover-favorite-options"),
    discoverFavoriteOnly: document.getElementById("discover-favorite-only"),
    learnedOptions: document.getElementById("learned-options"),
    favoriteArtist: document.getElementById("favorite-artist"),
    manualFavoriteOptions: document.getElementById("manual-favorite-options"),
    paymentMethod: document.getElementById("payment-method"),
    lastName: document.getElementById("last-name"),
    firstName: document.getElementById("first-name"),
    phoneNumber: document.getElementById("phone-number"),
    keepBrowserOpenMs: document.getElementById("keep-browser-open-ms"),
    captureFullPageScreenshot: document.getElementById("capture-full-page-screenshot"),
    captureTrace: document.getElementById("capture-trace"),
    requireFavorite: document.getElementById("require-favorite"),
    reloadSettings: document.getElementById("reload-settings"),
    resetDefaults: document.getElementById("reset-defaults"),
    statusBox: document.getElementById("status-box")
  };
  let latestSettings = defaultSettings;

  const setStatus = (message, tone) => {
    elements.statusBox.textContent = message;
    elements.statusBox.dataset.tone = tone || "pending";
  };

  const normalizeSettings = (settings) => {
    const merged = {
      ...defaultSettings,
      ...settings,
      purchaser: {
        ...defaultSettings.purchaser,
        ...(settings && settings.purchaser ? settings.purchaser : {})
      },
      runtime: {
        ...defaultSettings.runtime,
        ...(settings && settings.runtime ? settings.runtime : {})
      },
      siteDiscovery: {
        ...defaultSettings.siteDiscovery,
        ...(settings && settings.siteDiscovery ? settings.siteDiscovery : {})
      }
    };

    merged.quantity = String(merged.quantity || defaultSettings.quantity);
    merged.ticketTypeValue = String(merged.ticketTypeValue || merged.ticketType || "");
    merged.siteDiscovery.ticketTypeOptions = normalizeOptions(merged.siteDiscovery.ticketTypeOptions);
    merged.favoriteArtistValue = String(merged.favoriteArtistValue || merged.favoriteArtist || "");
    merged.siteDiscovery.manualFavoriteOptions = normalizeOptions(merged.siteDiscovery.manualFavoriteOptions);
    merged.siteDiscovery.favoriteArtistOptions = normalizeOptions([
      ...normalizeOptions(merged.siteDiscovery.favoriteArtistOptions),
      ...merged.siteDiscovery.manualFavoriteOptions
    ]);
    merged.runtime.keepBrowserOpenMs = Math.max(0, Math.min(
      600000,
      Number(merged.runtime.keepBrowserOpenMs) || 0
    ));
    return merged;
  };

  const normalizeOptions = (options) => {
    if (!Array.isArray(options)) {
      return [];
    }

    const seen = new Set();
    return options
      .map((option) => ({
        label: String(option.label || option.text || "").trim(),
        value: String(option.value || option.label || option.text || "").trim()
      }))
      .filter((option) => option.label && !seen.has(`${option.label}\n${option.value}`) && seen.add(`${option.label}\n${option.value}`));
  };

  const parseManualFavoriteOptions = (value) => normalizeOptions(
    String(value || "")
      .split(/[\n,、]/)
      .map((label) => {
        const trimmed = label.trim();
        return { label: trimmed, value: trimmed };
      })
  );

  const mergeOptions = (...optionGroups) => normalizeOptions(optionGroups.flat());

  const renderLearnedOptions = (settings) => {
    const ticketOptions = normalizeOptions(settings.siteDiscovery.ticketTypeOptions);
    const favoriteOptions = normalizeOptions(settings.siteDiscovery.favoriteArtistOptions);
    const manualOptions = normalizeOptions(settings.siteDiscovery.manualFavoriteOptions);
    const learnedAt = settings.siteDiscovery.learnedAt
      ? `取得: ${new Date(settings.siteDiscovery.learnedAt).toLocaleString()}`
      : "未取得";

    elements.learnedOptions.innerHTML = "";
    const summary = document.createElement("div");
    summary.className = "stock-item";
    summary.innerHTML = `<strong>お目当て ${favoriteOptions.length}件 / 手入力 ${manualOptions.length}件 / チケット ${ticketOptions.length}件</strong><span>${learnedAt}</span>`;
    elements.learnedOptions.appendChild(summary);

    ticketOptions.slice(0, 8).forEach((option) => {
      const row = document.createElement("div");
      row.className = "stock-item";
      const label = document.createElement("strong");
      label.textContent = `チケット: ${option.label}`;
      const value = document.createElement("span");
      value.textContent = option.value;
      row.append(label, value);
      elements.learnedOptions.appendChild(row);
    });

    favoriteOptions.slice(0, 12).forEach((option) => {
      const row = document.createElement("div");
      row.className = "stock-item";
      const label = document.createElement("strong");
      label.textContent = `お目当て: ${option.label}`;
      const value = document.createElement("span");
      value.textContent = option.value;
      row.append(label, value);
      elements.learnedOptions.appendChild(row);
    });
  };

  const renderFavoriteOptions = (settings) => {
    const options = normalizeOptions(settings.siteDiscovery.favoriteArtistOptions);
    const selectedLabel = settings.favoriteArtist || options[0]?.label || "";
    const selectedValue = settings.favoriteArtistValue || options.find((option) => option.label === selectedLabel)?.value || selectedLabel;
    const hasSelected = options.some((option) => option.label === selectedLabel && option.value === selectedValue);
    const renderOptions = hasSelected || !selectedLabel
      ? options
      : [{ label: selectedLabel, value: selectedValue }, ...options];

    elements.favoriteArtist.innerHTML = "";
    renderOptions.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = option.label;
      optionElement.textContent = option.label;
      optionElement.dataset.optionValue = option.value;
      elements.favoriteArtist.appendChild(optionElement);
    });
  };

  const renderTicketTypeOptions = (settings) => {
    const options = normalizeOptions(settings.siteDiscovery.ticketTypeOptions);
    const selectedLabel = settings.ticketType || options[0]?.label || "";
    const selectedValue = settings.ticketTypeValue || options.find((option) => option.label === selectedLabel)?.value || selectedLabel;
    const hasSelected = options.some((option) => option.label === selectedLabel && option.value === selectedValue);
    const renderOptions = hasSelected || !selectedLabel
      ? options
      : [{ label: selectedLabel, value: selectedValue }, ...options];

    elements.ticketType.innerHTML = "";
    renderOptions.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = option.label;
      optionElement.textContent = option.label;
      optionElement.dataset.optionValue = option.value;
      elements.ticketType.appendChild(optionElement);
    });
  };

  const applySettingsToForm = (settings) => {
    const normalized = normalizeSettings(settings);
    latestSettings = normalized;
    elements.enabled.checked = Boolean(normalized.enabled);
    elements.reloadBeforeApply.checked = Boolean(normalized.reloadBeforeApply);
    renderTicketTypeOptions(normalized);
    elements.ticketType.value = normalized.ticketType;
    if (elements.ticketType.value !== normalized.ticketType && elements.ticketType.options.length > 0) {
      elements.ticketType.selectedIndex = 0;
    }
    elements.quantity.value = normalized.quantity;
    elements.discoveryUrl.value = normalized.siteDiscovery.targetUrl;
    elements.favoriteSourceUrl.value = normalized.siteDiscovery.favoriteSourceUrl || "";
    elements.performersSelector.value = normalized.siteDiscovery.performersSelector;
    elements.ticketInfoSelector.value = normalized.siteDiscovery.ticketInfoSelector;
    elements.favoriteSelector.value = normalized.siteDiscovery.favoriteArtistSelector;
    renderFavoriteOptions(normalized);
    elements.favoriteArtist.value = normalized.favoriteArtist;
    if (elements.favoriteArtist.value !== normalized.favoriteArtist && elements.favoriteArtist.options.length > 0) {
      elements.favoriteArtist.selectedIndex = 0;
    }
    elements.paymentMethod.value = normalized.paymentMethod;
    elements.lastName.value = normalized.purchaser.lastName;
    elements.firstName.value = normalized.purchaser.firstName;
    elements.phoneNumber.value = normalized.purchaser.phoneNumber;
    elements.keepBrowserOpenMs.value = String(normalized.runtime.keepBrowserOpenMs);
    elements.captureFullPageScreenshot.checked = Boolean(normalized.runtime.captureFullPageScreenshot);
    elements.captureTrace.checked = Boolean(normalized.runtime.captureTrace);
    elements.requireFavorite.checked = normalized.runtime.requireFavorite !== false;
    elements.manualFavoriteOptions.value = normalizeOptions(normalized.siteDiscovery.manualFavoriteOptions)
      .map((option) => option.label)
      .join("\n");
    renderLearnedOptions(normalized);
  };

  const collectSettingsFromForm = () => {
    const manualFavoriteOptions = parseManualFavoriteOptions(elements.manualFavoriteOptions.value);
    const favoriteOptions = mergeOptions(
      Array.from(elements.favoriteArtist.options).map((option) => ({
        label: option.textContent,
        value: option.dataset.optionValue || option.value
      })),
      manualFavoriteOptions
    );
    const selectedFavorite = elements.favoriteArtist.selectedOptions[0];
    const selectedTicketType = elements.ticketType.selectedOptions[0];
    return {
      enabled: elements.enabled.checked,
      reloadBeforeApply: elements.reloadBeforeApply.checked,
      ticketType: selectedTicketType ? selectedTicketType.textContent.trim() : elements.ticketType.value,
      ticketTypeValue: selectedTicketType ? selectedTicketType.dataset.optionValue || selectedTicketType.value : elements.ticketType.value,
      quantity: elements.quantity.value,
      favoriteArtist: selectedFavorite ? selectedFavorite.textContent.trim() : elements.favoriteArtist.value,
      favoriteArtistValue: selectedFavorite ? selectedFavorite.dataset.optionValue || selectedFavorite.value : elements.favoriteArtist.value,
      paymentMethod: elements.paymentMethod.value,
      purchaser: {
        lastName: elements.lastName.value.trim(),
        firstName: elements.firstName.value.trim(),
        phoneNumber: elements.phoneNumber.value.trim()
      },
      siteDiscovery: {
        targetUrl: elements.discoveryUrl.value.trim(),
        favoriteSourceUrl: elements.favoriteSourceUrl.value.trim(),
        sourceMode: "performers",
        performersSelector: elements.performersSelector.value.trim(),
        ticketInfoSelector: elements.ticketInfoSelector.value.trim(),
        favoriteArtistSelector: elements.favoriteSelector.value.trim() || "#favorite-artist",
        learnedAt: latestSettings.siteDiscovery.learnedAt,
        ticketTypeOptions: normalizeOptions(
          Array.from(elements.ticketType.options).map((option) => ({
            label: option.textContent,
            value: option.dataset.optionValue || option.value
          }))
        ),
        favoriteArtistOptions: favoriteOptions,
        manualFavoriteOptions
      },
      runtime: {
        ...latestSettings.runtime,
        keepBrowserOpenMs: Number(elements.keepBrowserOpenMs.value) || 0,
        captureFullPageScreenshot: elements.captureFullPageScreenshot.checked,
        captureTrace: elements.captureTrace.checked,
        requireFavorite: elements.requireFavorite.checked
      }
    };
  };

  const fetchSettings = async () => {
    const response = await fetch("/api/auto-selection-settings", {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`設定の取得に失敗しました: ${response.status}`);
    }

    return response.json();
  };

  const saveSettings = async (settings) => {
    const response = await fetch("/api/auto-selection-settings", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(settings)
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `設定の保存に失敗しました: ${response.status}`);
    }

    return response.json();
  };

  const discoverFavoriteOptions = async () => {
    const currentSettings = normalizeSettings(collectSettingsFromForm());
    const response = await fetch("/api/discover-favorite-options", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        targetUrl: currentSettings.siteDiscovery.targetUrl,
        sourceMode: currentSettings.siteDiscovery.sourceMode,
        performersSelector: currentSettings.siteDiscovery.performersSelector,
        ticketInfoSelector: currentSettings.siteDiscovery.ticketInfoSelector,
        selector: currentSettings.siteDiscovery.favoriteArtistSelector,
        settings: currentSettings
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `候補の取得に失敗しました: ${response.status}`);
    }

    return response.json();
  };

  const discoverFavoriteOnly = async () => {
    const currentSettings = normalizeSettings(collectSettingsFromForm());
    const favoriteSourceUrl = currentSettings.siteDiscovery.favoriteSourceUrl.trim();
    if (!favoriteSourceUrl) {
      throw new Error("お目当て候補だけ学習する別公演URLを入力してください。");
    }

    const response = await fetch("/api/discover-favorite-options", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        targetUrl: favoriteSourceUrl,
        sourceMode: currentSettings.siteDiscovery.sourceMode,
        performersSelector: currentSettings.siteDiscovery.performersSelector,
        selector: currentSettings.siteDiscovery.favoriteArtistSelector,
        settings: currentSettings,
        dryRun: true
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `候補の取得に失敗しました: ${response.status}`);
    }

    const payload = await response.json();
    const favoriteArtistOptions = mergeOptions(
      currentSettings.siteDiscovery.favoriteArtistOptions,
      payload.discovery.favoriteArtistOptions,
      currentSettings.siteDiscovery.manualFavoriteOptions
    );
    const currentFavoriteStillExists = favoriteArtistOptions.some((option) => (
      option.label === currentSettings.favoriteArtist ||
      option.value === currentSettings.favoriteArtistValue
    ));
    const selectedFavorite = currentFavoriteStillExists
      ? {
        label: currentSettings.favoriteArtist,
        value: currentSettings.favoriteArtistValue,
      }
      : favoriteArtistOptions[0] || {
        label: currentSettings.favoriteArtist,
        value: currentSettings.favoriteArtistValue,
      };

    const nextSettings = normalizeSettings({
      ...currentSettings,
      favoriteArtist: selectedFavorite.label,
      favoriteArtistValue: selectedFavorite.value,
      siteDiscovery: {
        ...currentSettings.siteDiscovery,
        favoriteSourceUrl,
        learnedAt: payload.discovery.learnedAt || new Date().toISOString(),
        favoriteArtistOptions,
      }
    });
    await saveSettings(nextSettings);

    return {
      ...payload,
      settings: nextSettings,
      favoriteCount: payload.discovery.favoriteArtistOptions.length,
    };
  };

  const loadSettings = async () => {
    setStatus("設定を読み込んでいます。", "pending");
    const settings = await fetchSettings();
    applySettingsToForm(settings);
    setStatus("設定を読み込みました。", "ok");
  };

  const initialize = () => {
    elements.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const settings = normalizeSettings(collectSettingsFromForm());
      try {
        setStatus("設定を保存しています。", "pending");
        await saveSettings(settings);
        applySettingsToForm(settings);
        setStatus("設定を保存しました。自動選択 runner はこの内容を使います。", "ok");
      } catch (error) {
        setStatus(error.message, "warn");
      }
    });

    elements.reloadSettings.addEventListener("click", () => {
      loadSettings().catch((error) => setStatus(error.message, "warn"));
    });

    elements.manualFavoriteOptions.addEventListener("change", () => {
      const settings = normalizeSettings(collectSettingsFromForm());
      applySettingsToForm(settings);
      setStatus("手入力候補をお目当ての選択肢に反映しました。", "pending");
    });

    elements.discoverFavoriteOptions.addEventListener("click", async () => {
      try {
        elements.discoverFavoriteOptions.disabled = true;
        setStatus("サイトを読み込んで、出演アーティストと販売情報を取得しています。", "pending");
        const payload = await discoverFavoriteOptions();
        applySettingsToForm(payload.settings);
        setStatus(`出演 ${payload.discovery.favoriteArtistOptions.length} 件 / チケット ${payload.discovery.ticketTypeOptions.length} 件をストックしました。`, "ok");
      } catch (error) {
        setStatus(error.message, "warn");
      } finally {
        elements.discoverFavoriteOptions.disabled = false;
      }
    });

    elements.discoverFavoriteOnly.addEventListener("click", async () => {
      try {
        elements.discoverFavoriteOnly.disabled = true;
        setStatus("別公演URLからお目当て候補を取得しています。", "pending");
        const payload = await discoverFavoriteOnly();
        applySettingsToForm(payload.settings);
        setStatus(`お目当て候補 ${payload.favoriteCount} 件を追加しました。`, "ok");
      } catch (error) {
        setStatus(error.message, "warn");
      } finally {
        elements.discoverFavoriteOnly.disabled = false;
      }
    });

    elements.resetDefaults.addEventListener("click", () => {
      applySettingsToForm(defaultSettings);
      setStatus("既定値をフォームに戻しました。保存すると反映されます。", "pending");
    });

    loadSettings().catch((error) => {
      applySettingsToForm(defaultSettings);
      setStatus(error.message, "warn");
    });
  };

  initialize();
})();
