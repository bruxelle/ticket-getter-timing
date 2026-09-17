const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const repoRoot = __dirname;
const events = [];
class AuthRequiredError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AuthRequiredError";
    this.details = details;
  }
}

const defaultAutoSelectionSettings = {
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
    phoneNumber: "09012345678",
  },
  runtime: {
    keepBrowserOpenMs: 0,
    loginKeepBrowserOpenMs: 600000,
    captureFullPageScreenshot: true,
    captureTrace: false,
    requireFavorite: true,
    requireAuthenticated: true,
    userDataDir: ".playwright-user-data/auto-selection",
  },
  siteDiscovery: {
    targetUrl: "",
    favoriteSourceUrl: "",
    favoriteArtistSelector: "#favorite-artist",
    learnedAt: "",
    favoriteArtistOptions: [],
    manualFavoriteOptions: [],
  },
};

function recordEvent(name, details = {}) {
  const entry = {
    name,
    at: new Date().toISOString(),
    ...details,
  };
  events.push(entry);
  return entry;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function formatJapanTimestamp(date = new Date()) {
  const localDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  return `${localDate.toISOString().replace("T", " ").replace("Z", "")} +09:00`;
}

function ensureDir(dirname) {
  const dirPath = path.join(repoRoot, dirname);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createAutoSelectionBaseProfile() {
  return {
    name: "auto-selection",
    allowedOrigins: [],
    actionTimeoutMs: 5000,
    headless: false,
    closeBrowserOnFinish: true,
    steps: [],
  };
}

function printMissingProfileUsage() {
  console.error("Site profile runner requires an explicit profile path.");
  console.error("Usage:");
  console.error("  npm run run:site-profile -- path/to/site_profile.json");
  console.error("");
  console.error("Auto-selection commands can use the target URL saved in auto_selection_settings.json,");
  console.error("or a temporary override:");
  console.error("  npm run run:auto-selection -- --target-url=https://example.com/event/placeholder");
}

function printMissingAutoSelectionTargetUsage() {
  console.error("Auto-selection requires a target URL or an explicit site profile.");
  console.error("Set siteDiscovery.targetUrl in auto_selection_settings.json via the settings UI,");
  console.error("pass a temporary target URL, or pass an explicit profile JSON:");
  console.error("");
  console.error("  npm run run:auto-selection -- --target-url=https://example.com/event/placeholder");
  console.error("  npm run login:auto-selection -- --target-url=https://example.com/event/placeholder");
  console.error("  npm run run:auto-selection -- path/to/site_profile.json");
}

function hasProfileTarget(profile) {
  return Boolean(
    String(profile.targetUrl || "").trim() ||
    String(profile.targetPath || "").trim()
  );
}

function hasAutoSelectionTarget(settings) {
  return Boolean(String(settings?.siteDiscovery?.targetUrl || "").trim());
}

function getCliOption(args, name) {
  const inlinePrefix = `${name}=`;
  const inlineValue = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inlineValue) {
    return inlineValue.slice(inlinePrefix.length);
  }

  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }

  return "";
}

function getPositionalArgs(args, optionsWithValue = []) {
  const skipIndexes = new Set();
  args.forEach((arg, index) => {
    if (optionsWithValue.includes(arg)) {
      skipIndexes.add(index + 1);
    }
  });
  return args.filter((arg, index) => !arg.startsWith("--") && !skipIndexes.has(index));
}

function normalizeTargetOverrideUrl(input) {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }

  const parsed = new URL(value);
  if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
    throw new Error("target URL must use http, https, or file.");
  }
  return parsed.href;
}

function applyTargetUrlOverride(settings, input) {
  const targetUrl = normalizeTargetOverrideUrl(input);
  if (!targetUrl) {
    return settings;
  }

  recordEvent("auto_selection_target_url_overridden", { targetUrl });
  return {
    ...settings,
    siteDiscovery: {
      ...settings.siteDiscovery,
      targetUrl,
    },
  };
}

function normalizeStoredOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }

  const seen = new Set();
  return options
    .map((option) => ({
      label: String(option.label || option.text || "").trim(),
      value: String(option.value || option.label || option.text || "").trim(),
    }))
    .filter((option) => {
      const key = `${option.label}\n${option.value}`;
      if (!option.label || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeAutoSelectionSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const siteDiscovery = {
    ...defaultAutoSelectionSettings.siteDiscovery,
    ...(source.siteDiscovery || {}),
  };
  const manualFavoriteOptions = normalizeStoredOptions(siteDiscovery.manualFavoriteOptions);
  const favoriteArtistOptions = normalizeStoredOptions([
    ...normalizeStoredOptions(siteDiscovery.favoriteArtistOptions),
    ...manualFavoriteOptions,
  ]);

  return {
    ...defaultAutoSelectionSettings,
    ...source,
    quantity: String(source.quantity || defaultAutoSelectionSettings.quantity),
    purchaser: {
      ...defaultAutoSelectionSettings.purchaser,
      ...(source.purchaser || {}),
    },
    runtime: {
      ...defaultAutoSelectionSettings.runtime,
      ...(source.runtime || {}),
    },
    siteDiscovery: {
      ...siteDiscovery,
      favoriteArtistOptions,
      manualFavoriteOptions,
    },
  };
}

function loadAutoSelectionSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    recordEvent("auto_selection_settings_defaulted", { settingsPath });
    return defaultAutoSelectionSettings;
  }
  const settings = normalizeAutoSelectionSettings(readJson(settingsPath));
  recordEvent("auto_selection_settings_loaded", { settingsPath, enabled: settings.enabled });
  return settings;
}

function maskPhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function sanitizeAutoSelectionSettingsForLog(settings) {
  if (!settings) {
    return null;
  }
  return {
    ...settings,
    purchaser: {
      lastName: settings.purchaser?.lastName ? "[set]" : "",
      firstName: settings.purchaser?.firstName ? "[set]" : "",
      phoneNumber: maskPhoneNumber(settings.purchaser?.phoneNumber),
    },
  };
}

function getAutoSelectionUserDataDir(settings) {
  return path.resolve(
    repoRoot,
    settings.runtime?.userDataDir || defaultAutoSelectionSettings.runtime.userDataDir,
  );
}

function getLoginKeepBrowserOpenMs(settings) {
  const envValue = Number(process.env.AUTO_SELECTION_LOGIN_KEEP_MS || "");
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }

  const settingsValue = Number(settings.runtime?.loginKeepBrowserOpenMs || 0);
  if (Number.isFinite(settingsValue) && settingsValue > 0) {
    return settingsValue;
  }

  return defaultAutoSelectionSettings.runtime.loginKeepBrowserOpenMs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function comparableOrigin(inputUrl) {
  const parsed = new URL(inputUrl);
  if (parsed.protocol === "file:") {
    return "file://";
  }
  return parsed.origin;
}

function resolveTargetUrl(profile) {
  if (profile.targetPath) {
    const targetPath = path.resolve(repoRoot, profile.targetPath);
    const targetUrl = pathToFileURL(targetPath);
    const query = profile.query || {};
    Object.entries(query).forEach(([key, value]) => {
      targetUrl.searchParams.set(key, String(value));
    });
    return targetUrl.href;
  }

  if (profile.targetUrl) {
    return profile.targetUrl;
  }

  throw new Error("Profile must include targetUrl or targetPath.");
}

function buildAutoSelectionProfile(baseProfile, settings) {
  const targetUrl = settings.siteDiscovery?.targetUrl || baseProfile.targetUrl;
  if (!targetUrl) {
    return baseProfile;
  }

  const targetOrigin = comparableOrigin(targetUrl);
  const allowedOrigins = Array.from(new Set([
    ...(baseProfile.allowedOrigins || []),
    targetOrigin,
  ]));

  return {
    ...baseProfile,
    name: `${baseProfile.name || "site-profile"}-auto-selection`,
    targetPath: "",
    targetUrl,
    allowedOrigins,
    headless: false,
    closeBrowserOnFinish: settings.runtime.closeBrowserOnFinish !== false,
  };
}

function assertAllowedUrl(inputUrl, profile) {
  const allowedOrigins = profile.allowedOrigins || [];
  if (allowedOrigins.length === 0) {
    throw new Error("Profile must include allowedOrigins.");
  }

  const origin = comparableOrigin(inputUrl);
  if (!allowedOrigins.includes(origin)) {
    throw new Error(`URL origin is not allowed by this profile: ${origin}`);
  }
}

function parseScheduledStart(input) {
  if (!input) {
    return null;
  }

  const isoDate = new Date(input);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const timeMatch = input.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!timeMatch) {
    throw new Error("scheduledStartAt must be empty, an ISO datetime, or HH:MM[:SS].");
  }

  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    Number(timeMatch[3] || "0"),
    0,
  );
  return scheduled;
}

async function waitUntilScheduledTime(scheduledStart) {
  if (!scheduledStart) {
    recordEvent("schedule_skipped");
    return null;
  }

  const targetTimeMs = scheduledStart.getTime();
  if (targetTimeMs <= Date.now()) {
    recordEvent("schedule_in_past", { scheduledStartAt: scheduledStart.toISOString() });
    return null;
  }

  recordEvent("schedule_wait_started", {
    scheduledStartAt: scheduledStart.toISOString(),
    waitMs: targetTimeMs - Date.now(),
  });

  while (true) {
    const remainingMs = targetTimeMs - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await sleep(Math.min(Math.max(remainingMs - 80, 10), 1000));
  }

  const triggeredAt = new Date();
  const result = {
    scheduledStartAt: scheduledStart.toISOString(),
    triggeredAt: triggeredAt.toISOString(),
    driftMs: triggeredAt.getTime() - targetTimeMs,
  };
  recordEvent("schedule_reached", result);
  return result;
}

function requireSelector(step) {
  if (!step.selector) {
    throw new Error(`Step "${step.name || step.action}" requires selector.`);
  }
}

async function guardCurrentPage(page, profile) {
  const pageUrl = page.url();
  if (pageUrl === "about:blank") {
    return;
  }
  assertAllowedUrl(pageUrl, profile);
}

async function detectAuthState(page) {
  const snapshot = await page.evaluate(() => {
    const visibleText = document.body?.innerText || "";
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const controlTexts = Array.from(document.querySelectorAll("a, button, [role='button'], input[type='submit']"))
      .filter(isVisible)
      .map((element) => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const hasControlText = (patterns) => controlTexts.some((text) => (
      patterns.some((pattern) => pattern.test(text))
    ));
    const loginTextSamples = visibleText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => /ログイン|電話番号認証|認証済/.test(line))
      .slice(0, 6);
    const path = window.location.pathname;
    const isLoginPage = /\/(login|signin|sign-in|auth)(\/|$)/i.test(path);

    return {
      url: window.location.href,
      title: document.title,
      isLoginPage,
      hasLoginAction: hasControlText([/^ログイン$/, /ログインする/, /^login$/i, /sign in/i]),
      hasSignupAction: hasControlText([/アカウントを作成/, /新規登録/, /会員登録/, /sign up/i]),
      hasAccountAction: hasControlText([/マイページ/, /アカウント設定/, /^アカウント$/, /ログアウト/, /My Page/i, /^Account$/i, /Account Settings/i]),
      hasLoginRequiredText: /ログインが必要|ログインしてください|ログインして(?:から|お申し込み|申込|購入)|ログイン.*必要/.test(visibleText),
      hasPhoneVerificationInfo: /認証済アカウントのみ申込可能|電話番号認証/.test(visibleText),
      hasPhoneVerificationBlockingText: /電話番号認証(が必要|を完了|してください|が完了していません)|電話番号.*認証.*必要/.test(visibleText),
      loginTextSamples,
    };
  }).catch((error) => ({
    url: page.url(),
    title: "",
    error: error.message,
  }));

  const needsManualLogin = !snapshot.hasAccountAction && (
    snapshot.isLoginPage ||
    snapshot.hasLoginAction ||
    snapshot.hasLoginRequiredText
  );
  const needsPhoneVerification = Boolean(snapshot.hasPhoneVerificationBlockingText);

  return {
    ...snapshot,
    needsManualLogin,
    needsPhoneVerification,
    authRequired: needsManualLogin || needsPhoneVerification,
  };
}

function shouldStopForAuthState(authState, phase) {
  if (authState.needsPhoneVerification) {
    return true;
  }
  if (authState.isLoginPage || authState.hasLoginAction) {
    return true;
  }
  if (phase !== "before_auto_selection" && authState.hasLoginRequiredText) {
    return true;
  }
  return false;
}

async function throwAuthRequired(page, artifactDir, authState, phase) {
  const screenshotPath = path.join(artifactDir, `auto-selection-auth-required-${timestampForFile()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
    recordEvent("auto_selection_auth_screenshot_failed", { message: error.message });
  });

  recordEvent("auto_selection_auth_required", {
    phase,
    screenshotPath,
    authState,
  });

  throw new AuthRequiredError(
    "Playwright の自動選択用ブラウザが未ログイン、または電話番号認証が未完了です。npm run login:auto-selection で手動ログインと認証を済ませてから、npm run run:auto-selection を再実行してください。",
    { phase, screenshotPath, authState },
  );
}

async function assertAuthenticatedForAutoSelection(page, settings, artifactDir, phase) {
  if (settings.runtime?.requireAuthenticated === false) {
    recordEvent("auto_selection_auth_check_skipped", { phase });
    return;
  }

  const authState = await detectAuthState(page);
  const authRequiredForPhase = shouldStopForAuthState(authState, phase);
  recordEvent("auto_selection_auth_checked", { phase, authRequiredForPhase, authState });
  if (authRequiredForPhase) {
    await throwAuthRequired(page, artifactDir, authState, phase);
  }
}

function getAutoSelectionSelectors(profile) {
  const selectors = profile.autoSelectionSelectors || {};
  return {
    releaseReadySelector: selectors.releaseReadySelector || "#start-application[data-unlocked=\"true\"]",
    ticketTypes: selectors.ticketTypes || {
      "一般": "#ticket-general",
      "学生": "#ticket-student",
      "VIP": "#ticket-vip",
    },
    quantity: selectors.quantity || "#ticket-quantity",
    startButton: selectors.startButton || "#start-application",
    favoriteArtist: selectors.favoriteArtist || "#favorite-artist",
    paymentMethods: selectors.paymentMethods || {
      "クレジットカード": "#payment-credit",
      "コンビニ決済（前払い）": "#payment-konbini",
    },
    lastName: selectors.lastName || "#last-name",
    firstName: selectors.firstName || "#first-name",
    phoneNumber: selectors.phoneNumber || "#phone-number",
    stopBeforePurchaseSelector: selectors.stopBeforePurchaseSelector || "#complete-application",
  };
}

function selectorForValue(selectorMap, value, fieldName) {
  const selector = selectorMap[value];
  if (!selector) {
    throw new Error(`Unsupported ${fieldName}: ${value}`);
  }
  return selector;
}

async function selectStoredOption(locator, label, value) {
  if (value) {
    try {
      await locator.selectOption({ value });
      return;
    } catch (error) {
      recordEvent("auto_select_value_fallback", { label, value, message: error.message });
    }
  }

  await locator.selectOption({ label });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function favoriteSearchTerms(settings) {
  const terms = new Set();
  [settings.favoriteArtistValue, settings.favoriteArtist].forEach((value) => {
    const raw = String(value || "").trim();
    const normalized = normalizeSearchText(raw);
    if (raw) {
      terms.add(raw);
    }
    if (normalized) {
      terms.add(normalized);
    }
  });
  return Array.from(terms).filter(Boolean);
}

function ticketSearchTerms(settings) {
  const labels = [settings.ticketTypeValue, settings.ticketType].filter(Boolean);
  const terms = new Set();

  labels.forEach((label) => {
    const base = String(label)
      .replace(/[¥￥]\s*[\d,]+/g, "")
      .replace(/\d+\s*円/g, "")
      .replace(/チケット|券/g, "")
      .trim();
    [label, base].forEach((candidate) => {
      const normalized = normalizeSearchText(candidate);
      if (normalized) {
        terms.add(normalized);
      }
    });
    const commonWords = base.match(/一般|通常|前方|優先|女性|学生|VIP|S席|A席|B席|C席/g) || [];
    commonWords.forEach((word) => terms.add(normalizeSearchText(word)));
  });

  return Array.from(terms).filter(Boolean);
}

async function clickTicketActionCard(page, settings, options = {}) {
  const terms = ticketSearchTerms(settings);
  const actionPatternSource = options.actionPatternSource || "^(選択する|申し込む|申し込み|申込|購入|購入する)$";
  const clickedEventName = options.clickedEventName || "auto_ticket_action_card_clicked";
  const notFoundEventName = options.notFoundEventName || "auto_ticket_action_card_not_found";
  const buttonLocator = page.locator("button, a, [role='button']");
  const match = await buttonLocator.evaluateAll((elements, payload) => {
    const targets = payload.targets;
    const normalize = (value) => String(value || "").replace(/\s+/g, "").trim();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const actionPattern = new RegExp(payload.actionPatternSource);
    let firstActionIndex = -1;
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestRawScore = 0;
    let bestText = "";

    elements.forEach((element, index) => {
      if (!isVisible(element)) {
        return;
      }
      const buttonText = normalize(element.innerText || element.textContent || "");
      if (!actionPattern.test(buttonText)) {
        return;
      }
      if (firstActionIndex < 0) {
        firstActionIndex = index;
      }

      let node = element;
      let cardText = "";
      for (let depth = 0; node && depth < 8; depth += 1) {
        cardText = normalize(node.innerText || node.textContent || "");
        const rawScore = targets.reduce((total, target) => (
          target && cardText.includes(target) ? total + Math.min(target.length, 24) : total
        ), 0);
        if (rawScore <= 0) {
          node = node.parentElement;
          continue;
        }
        const score = (rawScore * 1000) - (depth * 80) - Math.min(cardText.length, 3000);
        if (score > bestScore) {
          bestScore = score;
          bestRawScore = rawScore;
          bestIndex = index;
          bestText = cardText.slice(0, 160);
        }
        node = node.parentElement;
      }
    });

    return {
      index: bestRawScore > 0 ? bestIndex : firstActionIndex,
      score: bestRawScore,
      text: bestText,
      usedFirstAvailable: bestRawScore <= 0 && firstActionIndex >= 0,
    };
  }, { targets: terms, actionPatternSource }).catch((error) => ({
    index: -1,
    score: 0,
    text: "",
    usedFirstAvailable: false,
    error: error.message,
  }));

  if (match.index >= 0) {
    await buttonLocator.nth(match.index).click({ timeout: 2000 });
    recordEvent(clickedEventName, {
      ticketType: settings.ticketType,
      ticketTypeValue: settings.ticketTypeValue,
      searchTerms: terms,
      score: match.score,
      usedFirstAvailable: match.usedFirstAvailable,
      matchedText: match.text,
    });
    return true;
  }

  recordEvent(notFoundEventName, {
    ticketType: settings.ticketType,
    ticketTypeValue: settings.ticketTypeValue,
    searchTerms: terms,
    error: match.error,
  });
  return false;
}

async function selectFavoriteNativeOption(locator, settings, source) {
  const terms = favoriteSearchTerms(settings);
  const result = await locator.evaluate((select, targets) => {
    if (!select || select.tagName.toLowerCase() !== "select") {
      return { ok: false, reason: "not_select" };
    }

    const normalize = (value) => String(value || "").replace(/\s+/g, "").trim().toLowerCase();
    const normalizedTargets = targets.map(normalize).filter(Boolean);
    const options = Array.from(select.options).map((option, index) => ({
      index,
      label: (option.label || option.textContent || "").trim(),
      value: String(option.getAttribute("value") === null ? option.value : option.getAttribute("value")).trim(),
      disabled: option.disabled,
    })).filter((option) => option.label && !option.disabled);

    const match = options.find((option) => normalizedTargets.includes(normalize(option.value))) ||
      options.find((option) => normalizedTargets.includes(normalize(option.label)));

    if (!match) {
      return {
        ok: false,
        reason: "option_not_found",
        availableOptions: options.slice(0, 30).map((option) => option.label),
      };
    }

    select.selectedIndex = match.index;
    select.value = match.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    return {
      ok: select.selectedIndex === match.index || normalize(select.value) === normalize(match.value),
      selectedLabel: match.label,
      selectedValue: match.value,
    };
  }, terms).catch((error) => ({
    ok: false,
    reason: "evaluate_failed",
    error: error.message,
  }));

  if (result.ok) {
    recordEvent("auto_favorite_selected", {
      source,
      favoriteArtist: settings.favoriteArtist,
      favoriteArtistValue: settings.favoriteArtistValue,
      selectedLabel: result.selectedLabel,
    });
    return true;
  }

  recordEvent("auto_favorite_native_select_retry", {
    source,
    reason: result.reason,
    availableOptions: result.availableOptions,
    error: result.error,
  });
  return false;
}

async function chooseFavoriteFromNativeSelect(page, selectors, settings) {
  const explicitLocator = page.locator(selectors.favoriteArtist).first();
  if (await explicitLocator.count().catch(() => 0)) {
    if (await selectFavoriteNativeOption(explicitLocator, settings, "explicit_selector")) {
      return true;
    }
  }

  const terms = favoriteSearchTerms(settings);
  const match = await page.locator("select").evaluateAll((selects, targets) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, "").trim().toLowerCase();
    const normalizedTargets = targets.map(normalize).filter(Boolean);
    const fieldPattern = /お目当て|目当て|推し|出演|アーティスト|artist|favorite|performer/i;
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestOptionLabel = "";

    selects.forEach((select, index) => {
      const options = Array.from(select.options).map((option) => ({
        label: (option.label || option.textContent || "").trim(),
        value: String(option.getAttribute("value") === null ? option.value : option.getAttribute("value")).trim(),
        disabled: option.disabled,
      })).filter((option) => option.label && !option.disabled);
      const matchedOption = options.find((option) => normalizedTargets.includes(normalize(option.value))) ||
        options.find((option) => normalizedTargets.includes(normalize(option.label)));
      if (!matchedOption) {
        return;
      }

      let node = select;
      let fieldScore = 0;
      for (let depth = 0; node && depth < 7; depth += 1) {
        const text = node.innerText || node.textContent || "";
        if (fieldPattern.test(text)) {
          fieldScore += 500 - (depth * 40);
          break;
        }
        node = node.parentElement;
      }

      const optionScore = Math.min(matchedOption.label.length, 40) * 10;
      const score = fieldScore + optionScore - options.length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
        bestOptionLabel = matchedOption.label;
      }
    });

    return {
      index: bestIndex,
      score: bestScore,
      matchedOptionLabel: bestOptionLabel,
    };
  }, terms).catch((error) => ({ index: -1, error: error.message }));

  if (match.index >= 0) {
    return selectFavoriteNativeOption(page.locator("select").nth(match.index), settings, "native_select_heuristic");
  }

  recordEvent("auto_favorite_native_select_not_found", {
    favoriteArtist: settings.favoriteArtist,
    favoriteArtistValue: settings.favoriteArtistValue,
    error: match.error,
  });
  return false;
}

async function clickFavoriteTextOption(page, settings, source) {
  const terms = favoriteSearchTerms(settings);
  for (const term of terms) {
    const exactText = new RegExp(`^\\s*${escapeRegExp(term)}\\s*$`);
    const optionLocators = [
      page.getByRole("option", { name: exactText }).first(),
      page.getByRole("menuitem", { name: exactText }).first(),
      page.getByRole("button", { name: exactText }).first(),
      page.getByText(exactText).first(),
    ];

    for (const locator of optionLocators) {
      if (await locator.count().catch(() => 0)) {
        try {
          await locator.click({ timeout: 1500 });
          await page.waitForTimeout(250);
          recordEvent("auto_favorite_selected", {
            source,
            favoriteArtist: settings.favoriteArtist,
            favoriteArtistValue: settings.favoriteArtistValue,
            selectedLabel: term,
          });
          return true;
        } catch (error) {
          recordEvent("auto_favorite_text_option_retry", {
            source,
            term,
            message: error.message,
          });
        }
      }
    }
  }

  return false;
}

async function chooseFavoriteFromCustomDropdown(page, settings) {
  const controls = page.locator([
    "button",
    "[role='button']",
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    "[aria-haspopup='menu']",
    "input[role='combobox']",
    "div[tabindex]",
  ].join(", "));

  const matches = await controls.evaluateAll((elements) => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const fieldPattern = /お目当て|目当て|推し|出演|アーティスト|artist|favorite|performer/i;
    const placeholderPattern = /選択してください|選択|select|choose/i;

    return elements
      .map((element, index) => {
        if (!isVisible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") {
          return null;
        }

        const text = [
          element.innerText || element.textContent || "",
          element.getAttribute("aria-label") || "",
          element.getAttribute("placeholder") || "",
        ].join(" ");
        let score = placeholderPattern.test(text) ? 60 : 0;
        let node = element;
        let snippet = "";
        for (let depth = 0; node && depth < 7; depth += 1) {
          const ancestorText = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
          if (fieldPattern.test(ancestorText)) {
            score += 500 - (depth * 45);
            snippet = ancestorText.slice(0, 140);
            break;
          }
          node = node.parentElement;
        }

        return score > 0 ? { index, score, text: snippet || text.slice(0, 140) } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  }).catch((error) => {
    recordEvent("auto_favorite_dropdown_scan_failed", { message: error.message });
    return [];
  });

  for (const match of matches) {
    try {
      await controls.nth(match.index).click({ timeout: 1500 });
      await page.waitForTimeout(450);
      if (await clickFavoriteTextOption(page, settings, "custom_dropdown")) {
        recordEvent("auto_favorite_dropdown_used", {
          score: match.score,
          matchedText: match.text,
        });
        return true;
      }
      await page.keyboard.press("Escape").catch(() => {});
    } catch (error) {
      recordEvent("auto_favorite_dropdown_retry", {
        score: match.score,
        matchedText: match.text,
        message: error.message,
      });
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  const visibleOptionSamples = await page.locator("[role='option'], [role='menuitem'], li, button, [role='button']")
    .evaluateAll((elements) => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const seen = new Set();
      return elements
        .filter(isVisible)
        .map((element) => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim())
        .filter((text) => text && text.length <= 80 && !seen.has(text) && seen.add(text))
        .slice(0, 30);
    })
    .catch(() => []);
  recordEvent("auto_favorite_dropdown_not_found", { candidates: matches, visibleOptionSamples });
  return false;
}

async function chooseFavoriteFromRadioOrLabel(page, settings) {
  const result = await page.evaluate((targets) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, "").trim().toLowerCase();
    const normalizedTargets = targets.map(normalize).filter(Boolean);
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const labels = Array.from(document.querySelectorAll("label"));
    const label = labels.find((candidate) => {
      if (!isVisible(candidate)) {
        return false;
      }
      const text = candidate.innerText || candidate.textContent || "";
      const hasTarget = normalizedTargets.includes(normalize(text));
      const input = candidate.querySelector("input[type='radio'], input[type='checkbox']");
      return hasTarget && input;
    });

    if (!label) {
      return { ok: false, reason: "label_not_found" };
    }

    const input = label.querySelector("input[type='radio'], input[type='checkbox']");
    label.scrollIntoView({ block: "center" });
    label.click();
    input.click();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      ok: input.checked,
      selectedLabel: (label.innerText || label.textContent || "").replace(/\s+/g, " ").trim(),
    };
  }, favoriteSearchTerms(settings)).catch((error) => ({
    ok: false,
    reason: "evaluate_failed",
    error: error.message,
  }));

  if (result.ok) {
    recordEvent("auto_favorite_selected", {
      source: "radio_or_label",
      favoriteArtist: settings.favoriteArtist,
      favoriteArtistValue: settings.favoriteArtistValue,
      selectedLabel: result.selectedLabel,
    });
    return true;
  }

  recordEvent("auto_favorite_radio_label_not_found", {
    reason: result.reason,
    error: result.error,
  });
  return false;
}

async function selectTicketType(page, selectors, settings) {
  const mappedSelector = selectors.ticketTypes[settings.ticketType] || selectors.ticketTypes[settings.ticketTypeValue];
  if (mappedSelector) {
    await page.locator(mappedSelector).check({ force: true });
    return;
  }

  const labels = [settings.ticketTypeValue, settings.ticketType].filter(Boolean);
  for (const label of labels) {
    const exactText = new RegExp(`^${escapeRegExp(label)}$`);
    const locators = [
      page.getByLabel(label, { exact: true }),
      page.getByRole("button", { name: exactText }),
      page.getByText(label, { exact: true }),
    ];

    for (const locator of locators) {
      try {
        await locator.first().click({ timeout: 1200 });
        return;
      } catch (error) {
        recordEvent("auto_ticket_type_fallback_retry", {
          ticketType: settings.ticketType,
          ticketTypeValue: settings.ticketTypeValue,
          message: error.message,
        });
      }
    }
  }

  const normalizedLabels = labels.map(normalizeSearchText).filter(Boolean);
  const hasMatchingText = await page.evaluate((targets) => {
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, "");
    return targets.some((target) => bodyText.includes(target));
  }, normalizedLabels).catch(() => false);

  if (hasMatchingText) {
    if (await clickTicketActionCard(page, settings)) {
      return;
    }
    recordEvent("auto_ticket_type_click_skipped", {
      ticketType: settings.ticketType,
      ticketTypeValue: settings.ticketTypeValue,
      reason: "ticket_text_found_but_no_clickable_control",
    });
    return;
  }

  if (await clickTicketActionCard(page, settings)) {
    return;
  }

  throw new Error(`Ticket type could not be selected: ${settings.ticketType}`);
}

async function selectQuantity(page, selectors, settings) {
  const quantity = String(settings.quantity || "1");
  const markSelectedTicketCard = async (locator) => {
    await locator.evaluate((select) => {
      let node = select;
      for (let depth = 0; node && depth < 8; depth += 1) {
        const text = node.innerText || node.textContent || "";
        const hasApplyAction = /申し込み|申し込む|申込|購入/.test(text);
        const hasActionControl = Boolean(node.querySelector("button, a, [role='button']"));
        if (hasApplyAction && hasActionControl) {
          node.setAttribute("data-auto-selected-ticket-card", "true");
          return;
        }
        node = node.parentElement;
      }
    }).catch((error) => {
      recordEvent("auto_quantity_card_mark_failed", { message: error.message });
    });
  };
  const explicitLocator = page.locator(selectors.quantity);
  if (await explicitLocator.count().catch(() => 0)) {
    try {
      const select = explicitLocator.first();
      await select.selectOption(quantity, { timeout: 1200 });
      await markSelectedTicketCard(select);
      return;
    } catch (error) {
      recordEvent("auto_quantity_explicit_selector_fallback", { message: error.message });
    }
  }

  const labels = ticketSearchTerms(settings);
  const selectMatch = await page.locator("select").evaluateAll((selects, targets) => {
    const normalized = (value) => String(value || "").replace(/\s+/g, "").trim();
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestRawScore = 0;
    selects.forEach((select, index) => {
      let node = select;
      for (let depth = 0; node && depth < 8; depth += 1) {
        const text = normalized(node.innerText || node.textContent || "");
        const rawScore = targets.reduce((total, target) => (
          target && text.includes(target) ? total + Math.min(target.length, 24) : total
        ), 0);
        if (rawScore > 0) {
          const score = (rawScore * 1000) - (depth * 80) - Math.min(text.length, 3000);
          if (score > bestScore) {
            bestScore = score;
            bestRawScore = rawScore;
            bestIndex = index;
          }
        }
        node = node.parentElement;
      }
    });
    return { index: bestRawScore > 0 ? bestIndex : -1, score: bestRawScore };
  }, labels).catch((error) => ({ index: -1, score: 0, error: error.message }));

  if (selectMatch.index >= 0) {
    const select = page.locator("select").nth(selectMatch.index);
    await select.selectOption(quantity);
    await markSelectedTicketCard(select);
    recordEvent("auto_quantity_ticket_select_matched", {
      quantity,
      ticketType: settings.ticketType,
      ticketTypeValue: settings.ticketTypeValue,
      score: selectMatch.score,
    });
    return;
  }

  const ticketLabel = settings.ticketTypeValue || settings.ticketType;
  const ticketText = page.getByText(ticketLabel, { exact: false }).first();
  const ticketCard = ticketText.locator("xpath=ancestor::*[self::section or self::article or self::div][.//select][1]");
  if (await ticketCard.count().catch(() => 0)) {
    const select = ticketCard.locator("select").first();
    await select.selectOption(quantity);
    await markSelectedTicketCard(select);
    return;
  }

  const firstSelect = page.locator("select").filter({ hasText: "選択する" }).first();
  if (await firstSelect.count().catch(() => 0)) {
    await firstSelect.selectOption(quantity);
    await markSelectedTicketCard(firstSelect);
    return;
  }

  await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(quantity)}$`) }).first().click();
}

async function clickApplicationStartIfPresent(page, selectors, settings) {
  const waitAfterApplicationClick = async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };

  const markedCard = page.locator("[data-auto-selected-ticket-card='true']").first();
  if (await markedCard.count().catch(() => 0)) {
    const markedButton = markedCard
      .locator("button, a, [role='button']")
      .filter({ hasText: /申し込みをする|申し込みする|申し込み|申込|購入|購入する/ })
      .first();
    if (await markedButton.count().catch(() => 0)) {
      await markedButton.click({ timeout: 2000 });
      await waitAfterApplicationClick();
      recordEvent("auto_application_start_marked_card_clicked");
      return true;
    }
  }

  if (settings && await clickTicketActionCard(page, settings, {
    actionPatternSource: "^(申し込みをする|申し込みする|申し込み|申込|購入|購入する)$",
    clickedEventName: "auto_application_start_card_clicked",
    notFoundEventName: "auto_application_start_card_not_found",
  })) {
    await waitAfterApplicationClick();
    return true;
  }

  const candidates = [
    selectors.startButton,
    "button:has-text('申し込み')",
    "button:has-text('申込')",
    "button:has-text('購入')",
    "[role='button']:has-text('申し込み')",
    "[role='button']:has-text('申込')",
    "[role='button']:has-text('購入')",
  ];

  for (const selector of candidates) {
    if (!selector) {
      continue;
    }
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      try {
        await locator.click({ timeout: 1200 });
        await waitAfterApplicationClick();
        recordEvent("auto_application_start_clicked", { selector });
        return true;
      } catch (error) {
        recordEvent("auto_application_start_fallback", { selector, message: error.message });
      }
    }
  }

  return false;
}

async function chooseFavoriteIfPresent(page, selectors, settings) {
  if (!settings.favoriteArtist && !settings.favoriteArtistValue) {
    recordEvent("auto_favorite_skipped", { reason: "favorite_not_configured" });
    return false;
  }

  if (await chooseFavoriteFromNativeSelect(page, selectors, settings)) {
    return true;
  }

  if (await chooseFavoriteFromCustomDropdown(page, settings)) {
    return true;
  }

  if (await chooseFavoriteFromRadioOrLabel(page, settings)) {
    return true;
  }

  recordEvent("auto_favorite_skipped", { reason: "favorite_select_not_found" });
  return false;
}

async function choosePaymentIfPresent(page, selectors, settings) {
  const selectedPaymentText = async () => page.evaluate(() => {
    const checked = document.querySelector("input[type='radio']:checked");
    if (!checked) {
      return "";
    }
    let node = checked;
    for (let depth = 0; node && depth < 8; depth += 1) {
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (text) {
        return text;
      }
      node = node.parentElement;
    }
    return "";
  }).catch(() => "");

  const paymentText = settings.paymentMethod.replace("（前払い）", "");
  const mappedSelector = selectors.paymentMethods[settings.paymentMethod];
  if (mappedSelector && await page.locator(mappedSelector).count().catch(() => 0)) {
    await page.locator(mappedSelector).check({ force: true });
    recordEvent("auto_payment_selected", {
      paymentMethod: settings.paymentMethod,
      selectedText: await selectedPaymentText(),
    });
    return true;
  }

  const paymentTextLocator = page.getByText(paymentText, { exact: false }).first();
  if (await paymentTextLocator.count().catch(() => 0)) {
    const result = await page.evaluate((targetText) => {
      const labels = Array.from(document.querySelectorAll("label"));
      const label = labels.find((candidate) => (
        (candidate.innerText || candidate.textContent || "").includes(targetText) &&
        candidate.querySelector("input[type='radio']")
      ));
      if (!label) {
        return { ok: false, selectedText: "" };
      }

      const input = label.querySelector("input[type='radio']");
      label.scrollIntoView({ block: "center" });
      label.click();
      input.click();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        ok: input.checked,
        selectedText: (label.innerText || label.textContent || "").replace(/\s+/g, " ").trim(),
      };
    }, paymentText).catch((error) => ({ ok: false, selectedText: "", error: error.message }));
    await page.waitForTimeout(300);

    const selectedText = result.ok ? result.selectedText : await selectedPaymentText();
    recordEvent("auto_payment_selected", {
      paymentMethod: settings.paymentMethod,
      selectedText,
      verified: Boolean(result.ok && selectedText.includes(paymentText)),
      error: result.error,
    });
    return true;
  }

  recordEvent("auto_payment_skipped", { reason: "payment_input_not_found" });
  return false;
}

async function fillPurchaserIfPresent(page, selectors, settings) {
  const fillIfPresent = async (fieldName, selector, value, exactHints = [], fuzzyHints = []) => {
    const locators = [
      page.locator(selector).first(),
      ...exactHints.map((hint) => page.getByPlaceholder(hint, { exact: true }).first()),
      ...exactHints.map((hint) => page.getByLabel(hint, { exact: true }).first()),
      ...fuzzyHints.map((hint) => page.getByPlaceholder(hint, { exact: false }).first()),
      ...fuzzyHints.map((hint) => page.getByLabel(hint, { exact: false }).first()),
    ];
    for (const locator of locators) {
      if (await locator.count().catch(() => 0)) {
        try {
          await locator.fill(value, { timeout: 1200 });
          const verified = await locator.evaluate((element, expected) => (
            "value" in element && String(element.value) === String(expected)
          ), value).catch(() => false);
          recordEvent("auto_purchaser_field_fill_attempted", { fieldName, verified });
          if (verified) {
            return true;
          }
        } catch (error) {
          recordEvent("auto_purchaser_fill_fallback", { fieldName, message: error.message });
        }
      }
    }
    return false;
  };

  const results = {
    lastName: await fillIfPresent("lastName", selectors.lastName, settings.purchaser.lastName, ["姓"], ["名字", "Last", "Family"]),
    firstName: await fillIfPresent("firstName", selectors.firstName, settings.purchaser.firstName, ["名"], ["First", "Given"]),
    phoneNumber: await fillIfPresent("phoneNumber", selectors.phoneNumber, settings.purchaser.phoneNumber, [], ["電話番号", "電話", "TEL", "Phone", "080"]),
  };
  recordEvent("auto_purchaser_fill_attempted", results);
}

async function applyAutoSelection(page, profile, settings, artifactDir) {
  if (!settings.enabled) {
    recordEvent("auto_selection_skipped", { reason: "disabled" });
    return;
  }

  const startedAt = Date.now();
  const selectors = getAutoSelectionSelectors(profile);
  recordEvent("auto_selection_started", {
    ticketType: settings.ticketType,
    quantity: settings.quantity,
    paymentMethod: settings.paymentMethod,
    reloadBeforeApply: Boolean(settings.reloadBeforeApply),
  });

  if (settings.reloadBeforeApply) {
    await page.reload({ waitUntil: profile.gotoWaitUntil || "domcontentloaded" });
    recordEvent("page_reloaded_before_auto_selection", { url: page.url() });
  }

  await guardCurrentPage(page, profile);
  if (selectors.releaseReadySelector) {
    const ready = page.locator(selectors.releaseReadySelector).first();
    if (await ready.count().catch(() => 0)) {
      await page.waitForSelector(selectors.releaseReadySelector, { state: "visible" });
    }
  }

  await assertAuthenticatedForAutoSelection(page, settings, artifactDir, "before_auto_selection");

  await selectTicketType(page, selectors, settings);
  recordEvent("auto_ticket_type_selected", {
    ticketType: settings.ticketType,
    ticketTypeValue: settings.ticketTypeValue,
  });

  await selectQuantity(page, selectors, settings);
  recordEvent("auto_quantity_selected", { quantity: settings.quantity });

  await clickApplicationStartIfPresent(page, selectors, settings);
  recordEvent("auto_application_screen_opened");

  await assertAuthenticatedForAutoSelection(page, settings, artifactDir, "after_application_start");

  const favoriteSelected = await chooseFavoriteIfPresent(page, selectors, settings);
  if (!favoriteSelected && settings.runtime?.requireFavorite !== false) {
    const screenshotPath = path.join(artifactDir, `auto-selection-favorite-required-${timestampForFile()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
      recordEvent("auto_favorite_required_screenshot_failed", { message: error.message });
    });
    recordEvent("auto_favorite_required_not_selected", {
      favoriteArtist: settings.favoriteArtist,
      favoriteArtistValue: settings.favoriteArtistValue,
      screenshotPath,
    });
    throw new Error(`お目当てを選択できませんでした: ${settings.favoriteArtist || settings.favoriteArtistValue}`);
  }

  await choosePaymentIfPresent(page, selectors, settings);

  await fillPurchaserIfPresent(page, selectors, settings);

  if (selectors.stopBeforePurchaseSelector && await page.locator(selectors.stopBeforePurchaseSelector).count().catch(() => 0)) {
    await page.waitForSelector(selectors.stopBeforePurchaseSelector, { state: "visible" });
  }
  recordEvent("auto_selection_stopped_before_purchase", {
    stopBeforePurchaseSelector: selectors.stopBeforePurchaseSelector,
  });

  if (settings.runtime.captureFullPageScreenshot) {
    const screenshotPath = path.join(artifactDir, `auto-selection-ready-${timestampForFile()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    recordEvent("auto_selection_screenshot_saved", { screenshotPath });
  }

  await guardCurrentPage(page, profile);
  const completedAtDate = new Date();
  const completion = {
    operationName: "auto_selection",
    completedAt: completedAtDate.toISOString(),
    completedAtLocal: formatJapanTimestamp(completedAtDate),
    durationMs: completedAtDate.getTime() - startedAt,
  };
  recordEvent("auto_selection_finished", completion);
  return completion;
}

async function runStep(page, profile, step, artifactDir) {
  const startedAt = Date.now();
  recordEvent("step_started", {
    name: step.name || step.action,
    action: step.action,
  });

  if (step.timeoutMs) {
    page.setDefaultTimeout(step.timeoutMs);
  }

  await guardCurrentPage(page, profile);

  switch (step.action) {
    case "waitForLoadState":
      await page.waitForLoadState(step.state || "domcontentloaded");
      break;
    case "waitForURL":
      await page.waitForURL(step.urlRegex ? new RegExp(step.urlRegex) : step.url);
      break;
    case "waitForSelector":
      requireSelector(step);
      await page.waitForSelector(step.selector, { state: step.state || "visible" });
      break;
    case "click":
      requireSelector(step);
      await page.locator(step.selector).click({ force: Boolean(step.force) });
      break;
    case "fill":
      requireSelector(step);
      await page.locator(step.selector).fill(String(step.value || ""));
      break;
    case "selectOption":
      requireSelector(step);
      if (step.label) {
        await page.locator(step.selector).selectOption({ label: String(step.label) });
      } else {
        await page.locator(step.selector).selectOption(String(step.value || ""));
      }
      break;
    case "check":
      requireSelector(step);
      await page.locator(step.selector).check({ force: Boolean(step.force) });
      break;
    case "press":
      requireSelector(step);
      await page.locator(step.selector).press(step.key);
      break;
    case "screenshot": {
      const fileName = `${step.filePrefix || "site-profile"}-${timestampForFile()}.png`;
      const screenshotPath = path.join(artifactDir, fileName);
      await page.screenshot({ path: screenshotPath, fullPage: Boolean(step.fullPage) });
      recordEvent("screenshot_saved", { screenshotPath });
      break;
    }
    case "readText": {
      requireSelector(step);
      const text = await page.locator(step.selector).textContent();
      recordEvent("text_read", {
        name: step.name || step.selector,
        text: text ? text.trim() : "",
      });
      break;
    }
    default:
      throw new Error(`Unsupported step action: ${step.action}`);
  }

  await guardCurrentPage(page, profile);

  recordEvent("step_finished", {
    name: step.name || step.action,
    action: step.action,
    durationMs: Date.now() - startedAt,
  });
}

function writeLog(payload) {
  const logDir = ensureDir("logs");
  const logPath = path.join(logDir, `site-profile-run-${timestampForFile()}.json`);
  fs.writeFileSync(logPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return logPath;
}

function waitForLoginPreparationClose(context, keepBrowserOpenMs) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (reason) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(reason);
    };
    const timer = setTimeout(() => finish("timeout"), keepBrowserOpenMs);
    const checkAllPagesClosed = () => {
      setTimeout(() => {
        const openPages = context.pages().filter((candidate) => !candidate.isClosed());
        if (openPages.length === 0) {
          finish("all_pages_closed");
        }
      }, 350);
    };
    const watchPage = (candidate) => {
      candidate.once("close", checkAllPagesClosed);
    };

    context.once("close", () => finish("context_closed"));
    context.on("page", watchPage);
    context.pages().forEach(watchPage);
  });
}

async function latestOpenPage(context, fallbackPage) {
  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  return pages[pages.length - 1] || (fallbackPage && !fallbackPage.isClosed() ? fallbackPage : null);
}

async function prepareAutoSelectionLogin(profile, settings, settingsPath, profilePath) {
  const startedAt = new Date().toISOString();
  const targetUrl = resolveTargetUrl(profile);
  const userDataDir = getAutoSelectionUserDataDir(settings);
  const keepBrowserOpenMs = getLoginKeepBrowserOpenMs(settings);
  let context = null;
  let page = null;
  let status = "success";
  let message = "";

  recordEvent("auto_selection_login_prepare_started", {
    targetUrl,
    userDataDir,
    keepBrowserOpenMs,
  });

  try {
    context = await chromium.launchPersistentContext(userDataDir, { headless: false });
    page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(profile.actionTimeoutMs || 5000);
    await page.goto(targetUrl, { waitUntil: profile.gotoWaitUntil || "domcontentloaded" });
    recordEvent("auto_selection_login_page_opened", { targetUrl, currentUrl: page.url() });

    console.log("Playwright の自動選択用ブラウザを開きました。");
    console.log("このブラウザ内でログインと電話番号認証を完了してください。");
    console.log(`完了後はブラウザ全体を閉じてください。最大 ${Math.round(keepBrowserOpenMs / 1000)} 秒待機します。`);

    const closeReason = await waitForLoginPreparationClose(context, keepBrowserOpenMs);
    recordEvent("auto_selection_login_prepare_wait_finished", { closeReason });

    const activePage = await latestOpenPage(context, page);
    if (activePage) {
      const authState = await detectAuthState(activePage);
      recordEvent("auto_selection_login_prepare_auth_state", { authState });
    }
  } catch (error) {
    status = "error";
    message = error.message;
    recordEvent("auto_selection_login_prepare_failed", { message });
    throw error;
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }

    const logPath = writeLog({
      status,
      mode: "auto_selection_login_prepare",
      startedAt,
      finishedAt: new Date().toISOString(),
      message,
      profilePath,
      settingsPath,
      profile,
      autoSelection: sanitizeAutoSelectionSettingsForLog(settings),
      targetUrl,
      artifacts: {},
      events,
    });

    console.log(`Login preparation: ${status}`);
    console.log(`Log: ${logPath}`);
  }
}

async function run() {
  const args = process.argv.slice(2);
  const useAutoSelection = args.includes("--auto-selection");
  const prepareLogin = args.includes("--login") || args.includes("--prepare-login");
  const settingsArg = getCliOption(args, "--settings");
  const targetUrlOverride = getCliOption(args, "--target-url") ||
    getCliOption(args, "--target") ||
    process.env.AUTO_SELECTION_TARGET_URL ||
    "";
  const profileArg = getPositionalArgs(args, ["--settings", "--target-url", "--target"])[0] || "";
  const usesAutoSelectionProfile = useAutoSelection || prepareLogin;
  if (!profileArg && !usesAutoSelectionProfile) {
    printMissingProfileUsage();
    process.exitCode = 1;
    return;
  }

  const settingsPath = path.resolve(
    repoRoot,
    settingsArg || "auto_selection_settings.json"
  );
  const profilePath = profileArg ? path.resolve(repoRoot, profileArg) : "";
  const baseProfile = profilePath ? readJson(profilePath) : createAutoSelectionBaseProfile();
  const autoSelectionSettings = useAutoSelection || prepareLogin
    ? applyTargetUrlOverride(loadAutoSelectionSettings(settingsPath), targetUrlOverride)
    : null;
  if (usesAutoSelectionProfile && !hasProfileTarget(baseProfile) && !hasAutoSelectionTarget(autoSelectionSettings)) {
    printMissingAutoSelectionTargetUsage();
    process.exitCode = 1;
    return;
  }

  const profile = useAutoSelection || prepareLogin
    ? buildAutoSelectionProfile(baseProfile, autoSelectionSettings)
    : baseProfile;

  if (prepareLogin) {
    await prepareAutoSelectionLogin(profile, autoSelectionSettings, settingsPath, profilePath);
    return;
  }

  const targetUrl = resolveTargetUrl(profile);
  const scheduledStart = parseScheduledStart(profile.scheduledStartAt || "");
  const artifactDir = ensureDir("artifacts");
  const shouldCaptureTrace = useAutoSelection
    ? autoSelectionSettings.runtime?.captureTrace === true
    : profile.captureTrace === true;
  const tracePath = shouldCaptureTrace
    ? path.join(artifactDir, `site-profile-trace-${timestampForFile()}.zip`)
    : "";
  const startedAt = new Date().toISOString();
  const keepBrowserOpenMs = useAutoSelection
    ? Number(autoSelectionSettings.runtime.keepBrowserOpenMs || 0)
    : Number(profile.keepBrowserOpenMs || 0);

  assertAllowedUrl(targetUrl, profile);
  recordEvent("profile_loaded", {
    profilePath,
    profileName: profile.name,
    targetUrl,
  });

  const browser = useAutoSelection
    ? null
    : await chromium.launch({ headless: Boolean(profile.headless) });
  const context = useAutoSelection
    ? await chromium.launchPersistentContext(
      getAutoSelectionUserDataDir(autoSelectionSettings),
      { headless: false }
    )
    : await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(profile.actionTimeoutMs || 5000);
  if (shouldCaptureTrace) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }

  let status = "success";
  let message = "";
  let scheduleResult = null;
  let operationCompletion = null;

  try {
    const operationStartedAt = Date.now();
    scheduleResult = await waitUntilScheduledTime(scheduledStart);
    await page.goto(targetUrl, { waitUntil: profile.gotoWaitUntil || "domcontentloaded" });
    recordEvent("page_opened", { targetUrl });

    if (useAutoSelection) {
      operationCompletion = await applyAutoSelection(page, profile, autoSelectionSettings, artifactDir);
    } else {
      for (const step of profile.steps || []) {
        await runStep(page, profile, step, artifactDir);
      }
      const completedAtDate = new Date();
      operationCompletion = {
        operationName: "site_profile_steps",
        completedAt: completedAtDate.toISOString(),
        completedAtLocal: formatJapanTimestamp(completedAtDate),
        durationMs: completedAtDate.getTime() - operationStartedAt,
      };
      recordEvent("operation_completed", operationCompletion);
    }
  } catch (error) {
    status = error instanceof AuthRequiredError ? "auth_required" : "error";
    message = error.message;
    recordEvent("run_failed", { status, message });
    throw error;
  } finally {
    if (shouldCaptureTrace) {
      await context.tracing.stop({ path: tracePath }).catch((error) => {
        recordEvent("trace_save_failed", { message: error.message });
      });
      recordEvent("trace_saved", { tracePath });
    } else {
      recordEvent("trace_skipped");
    }

    const logPath = writeLog({
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      operationCompletedAt: operationCompletion?.completedAt || "",
      operationCompletedAtLocal: operationCompletion?.completedAtLocal || "",
      operationDurationMs: operationCompletion?.durationMs ?? null,
      message,
      profilePath,
      profile,
      autoSelection: sanitizeAutoSelectionSettingsForLog(autoSelectionSettings),
      targetUrl,
      schedule: scheduleResult,
      artifacts: tracePath ? { tracePath } : {},
      events,
    });

    console.log(`Site profile run: ${status}`);
    console.log(`Profile: ${profile.name}`);
    console.log(`Log: ${logPath}`);
    if (tracePath) {
      console.log(`Trace: ${tracePath}`);
    } else {
      console.log("Trace: skipped");
    }

    if (keepBrowserOpenMs > 0) {
      await page.waitForTimeout(keepBrowserOpenMs);
    }
    if (profile.closeBrowserOnFinish !== false) {
      await context.close();
      if (browser) {
        await browser.close();
      }
    }
  }
}

run().catch((error) => {
  console.error("Site profile runner failed.");
  if (error instanceof AuthRequiredError) {
    console.error(error.message);
    if (error.details?.screenshotPath) {
      console.error(`Screenshot: ${error.details.screenshotPath}`);
    }
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
