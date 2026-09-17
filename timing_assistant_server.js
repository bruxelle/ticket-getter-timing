const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const port = Number(process.env.PORT || "4173");
const host = process.env.HOST || "127.0.0.1";

const files = {
  "/": path.join(__dirname, "timing_assistant.html"),
  "/timing_assistant.html": path.join(__dirname, "timing_assistant.html"),
  "/timing_assistant.js": path.join(__dirname, "timing_assistant.js"),
  "/auto-selection": path.join(__dirname, "auto_selection_settings.html"),
  "/auto_selection_settings.html": path.join(__dirname, "auto_selection_settings.html"),
  "/auto_selection_settings.js": path.join(__dirname, "auto_selection_settings.js"),
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

const autoSelectionSettingsPath = path.join(__dirname, "auto_selection_settings.json");
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
    sourceMode: "performers",
    performersSelector: "#performing-artists",
    ticketInfoSelector: "",
    favoriteArtistSelector: "#favorite-artist",
    learnedAt: "",
    ticketTypeOptions: [
      { label: "一般", value: "一般" },
      { label: "学生", value: "学生" },
      { label: "VIP", value: "VIP" },
    ],
    favoriteArtistOptions: [
      { label: "アーティストA", value: "アーティストA" },
      { label: "アーティストB", value: "アーティストB" },
      { label: "アーティストC", value: "アーティストC" },
      { label: "全体目当て", value: "全体目当て" },
    ],
    manualFavoriteOptions: [],
  },
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath);
  const contentType = contentTypes[ext] || "application/octet-stream";
  try {
    const body = fs.readFileSync(filePath);
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store, max-age=0",
    });
    response.end(body);
  } catch (error) {
    sendJson(response, 404, { error: "not_found" });
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request_body_too_large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function pickAllowed(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

function normalizeFavoriteOptions(options, fallback = []) {
  if (!Array.isArray(options)) {
    return fallback;
  }

  const seen = new Set();
  return options
    .map((option) => {
      const label = String(option.label || option.text || "").trim();
      const value = String(option.value || option.label || option.text || "").trim();
      return { label, value };
    })
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
  const purchaser = source.purchaser && typeof source.purchaser === "object" ? source.purchaser : {};
  const runtime = source.runtime && typeof source.runtime === "object" ? source.runtime : {};
  const siteDiscovery = source.siteDiscovery && typeof source.siteDiscovery === "object" ? source.siteDiscovery : {};
  const keepBrowserOpenMs = Number(runtime.keepBrowserOpenMs);
  const ticketTypeOptions = normalizeFavoriteOptions(
    siteDiscovery.ticketTypeOptions,
    defaultAutoSelectionSettings.siteDiscovery.ticketTypeOptions
  );
  const manualFavoriteOptions = normalizeFavoriteOptions(siteDiscovery.manualFavoriteOptions, []);
  const favoriteArtistOptions = normalizeFavoriteOptions([
    ...normalizeFavoriteOptions(
      siteDiscovery.favoriteArtistOptions,
      defaultAutoSelectionSettings.siteDiscovery.favoriteArtistOptions
    ),
    ...manualFavoriteOptions,
  ]);
  const ticketType = String(source.ticketType || ticketTypeOptions[0]?.label || defaultAutoSelectionSettings.ticketType).trim();
  const favoriteArtist = String(source.favoriteArtist || favoriteArtistOptions[0]?.label || defaultAutoSelectionSettings.favoriteArtist).trim();

  return {
    enabled: Boolean(source.enabled),
    reloadBeforeApply: source.reloadBeforeApply !== false,
    ticketType,
    ticketTypeValue: String(source.ticketTypeValue || ticketTypeOptions.find((option) => option.label === ticketType)?.value || ticketType).trim(),
    quantity: pickAllowed(String(source.quantity || ""), ["1", "2", "3", "4"], defaultAutoSelectionSettings.quantity),
    favoriteArtist,
    favoriteArtistValue: String(source.favoriteArtistValue || favoriteArtistOptions.find((option) => option.label === favoriteArtist)?.value || favoriteArtist).trim(),
    paymentMethod: pickAllowed(
      source.paymentMethod,
      ["クレジットカード", "コンビニ決済（前払い）"],
      defaultAutoSelectionSettings.paymentMethod
    ),
    purchaser: {
      lastName: typeof purchaser.lastName === "string"
        ? purchaser.lastName.trim()
        : defaultAutoSelectionSettings.purchaser.lastName,
      firstName: typeof purchaser.firstName === "string"
        ? purchaser.firstName.trim()
        : defaultAutoSelectionSettings.purchaser.firstName,
      phoneNumber: typeof purchaser.phoneNumber === "string"
        ? purchaser.phoneNumber.trim()
        : defaultAutoSelectionSettings.purchaser.phoneNumber,
    },
    runtime: {
      keepBrowserOpenMs: Number.isFinite(keepBrowserOpenMs)
        ? Math.max(0, Math.min(600000, Math.round(keepBrowserOpenMs)))
        : defaultAutoSelectionSettings.runtime.keepBrowserOpenMs,
      loginKeepBrowserOpenMs: Number.isFinite(Number(runtime.loginKeepBrowserOpenMs))
        ? Math.max(10000, Math.min(3600000, Math.round(Number(runtime.loginKeepBrowserOpenMs))))
        : defaultAutoSelectionSettings.runtime.loginKeepBrowserOpenMs,
      captureFullPageScreenshot: runtime.captureFullPageScreenshot !== false,
      captureTrace: runtime.captureTrace === true,
      requireFavorite: runtime.requireFavorite !== false,
      requireAuthenticated: runtime.requireAuthenticated !== false,
      userDataDir: typeof runtime.userDataDir === "string" && runtime.userDataDir.trim()
        ? runtime.userDataDir.trim()
        : defaultAutoSelectionSettings.runtime.userDataDir,
    },
    siteDiscovery: {
      targetUrl: String(siteDiscovery.targetUrl || "").trim(),
      favoriteSourceUrl: String(siteDiscovery.favoriteSourceUrl || "").trim(),
      sourceMode: siteDiscovery.sourceMode === "select" ? "select" : "performers",
      performersSelector: String(siteDiscovery.performersSelector || "").trim(),
      ticketInfoSelector: String(siteDiscovery.ticketInfoSelector || "").trim(),
      favoriteArtistSelector: String(siteDiscovery.favoriteArtistSelector || defaultAutoSelectionSettings.siteDiscovery.favoriteArtistSelector).trim(),
      learnedAt: String(siteDiscovery.learnedAt || ""),
      ticketTypeOptions,
      favoriteArtistOptions,
      manualFavoriteOptions,
    },
  };
}

function readAutoSelectionSettings() {
  if (!fs.existsSync(autoSelectionSettingsPath)) {
    return defaultAutoSelectionSettings;
  }
  const raw = fs.readFileSync(autoSelectionSettingsPath, "utf8");
  return normalizeAutoSelectionSettings(JSON.parse(raw));
}

function writeAutoSelectionSettings(settings) {
  const normalized = normalizeAutoSelectionSettings(settings);
  fs.writeFileSync(autoSelectionSettingsPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function normalizeDiscoveryUrl(input) {
  if (!input) {
    throw new Error("事前に読み込むサイトURLを入力してください。");
  }

  const parsed = new URL(input);
  if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
    throw new Error("読み込み可能なURLは http / https / file のみです。");
  }
  return parsed.href;
}

async function discoverFavoriteOptions(payload) {
  const targetUrl = normalizeDiscoveryUrl(payload.targetUrl);
  const requestedSelector = String(payload.selector || "").trim();
  const performersSelector = String(payload.performersSelector || "").trim();
  const ticketInfoSelector = String(payload.ticketInfoSelector || "").trim();
  const sourceMode = payload.sourceMode === "select" ? "select" : "performers";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});

    const discovery = await page.evaluate(({ selector, performersSelector: requestedPerformersSelector, ticketInfoSelector: requestedTicketInfoSelector, sourceMode: requestedSourceMode }) => {
      const optionText = (option) => (option.label || option.textContent || "").trim();
      const cssPath = (element) => {
        if (element.id) {
          return `#${CSS.escape(element.id)}`;
        }
        if (element.name) {
          return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
        }
        const siblings = Array.from(document.querySelectorAll(element.tagName.toLowerCase()));
        const index = siblings.indexOf(element) + 1;
        return `${element.tagName.toLowerCase()}:nth-of-type(${index})`;
      };
      const cleanCandidate = (text) => String(text || "")
        .replace(/\s+/g, " ")
        .replace(/^(出演アーティスト|出演者|ラインナップ|line[-\s]?up|artists?|performers?|cast)\s*[:：]?/i, "")
        .trim();
      const isNoise = (text) => {
        const value = cleanCandidate(text);
        return (
          !value ||
          value.length > 80 ||
          /^(詳細|受付|販売|発売|開場|開演|日程|会場|料金|チケット|注意|未定|選択してください)$/i.test(value) ||
          /(販売前|公開|想定|候補|情報)/.test(value) ||
          /https?:\/\//i.test(value)
        );
      };
      const splitCandidateText = (text) => String(text || "")
        .replace(/出演アーティスト|出演者|ラインナップ|LINEUP|Lineup|Artists?|Performers?|Cast/gi, "\n")
        .split(/[\n\r、，,／\/｜|;；]+/)
        .map(cleanCandidate)
        .filter((value) => !isNoise(value));
      const uniqueOptions = (values) => {
        const seen = new Set();
        return values
          .map(cleanCandidate)
          .filter((value) => {
            if (isNoise(value) || seen.has(value)) {
              return false;
            }
            seen.add(value);
            return true;
          })
          .map((value) => ({ label: value, value }));
      };
      const compactTicketLabel = (text) => cleanCandidate(text)
        .replace(/\s+(?=¥|￥|\d[\d,]*\s*円)/g, "")
        .trim();
      const textForSelect = (select) => {
        const labels = Array.from(select.labels || []).map((label) => label.textContent || "");
        const ariaLabel = select.getAttribute("aria-label") || "";
        const nearby = select.closest("label, .field, fieldset, section, div")?.textContent || "";
        return [select.id, select.name, ariaLabel, ...labels, nearby].join(" ").toLowerCase();
      };
      const scoreSelect = (select) => {
        const text = textForSelect(select);
        let score = 0;
        if (/お目当て|目当て|推し|希望|出演|アーティスト|artist|favorite|performer/.test(text)) {
          score += 100;
        }
        score += Array.from(select.options).filter((option) => optionText(option) && option.value !== "").length;
        return score;
      };

      const discoverFromSelect = () => {
        let select = null;
        if (selector) {
          const selected = document.querySelector(selector);
          if (!selected) {
            throw new Error(`指定セレクタが見つかりません: ${selector}`);
          }
          if (selected.tagName.toLowerCase() !== "select") {
            throw new Error(`指定セレクタは select 要素ではありません: ${selector}`);
          }
          select = selected;
        } else {
          select = Array.from(document.querySelectorAll("select"))
            .sort((left, right) => scoreSelect(right) - scoreSelect(left))[0] || null;
        }

        if (!select) {
          throw new Error("候補を取得できる select 要素が見つかりません。");
        }

        const options = Array.from(select.options)
          .map((option) => {
            const rawValue = option.getAttribute("value");
            return {
              label: optionText(option),
              value: String(rawValue === null ? option.value : rawValue).trim(),
              disabled: option.disabled,
            };
          })
          .filter((option) => option.label && option.value && !option.disabled);

        if (options.length === 0) {
          throw new Error("select 要素は見つかりましたが、有効な候補がありません。");
        }

        return {
          sourceMode: "select",
          selectorUsed: cssPath(select),
          options,
        };
      };

      const scorePerformerContainer = (element) => {
        const text = (element.textContent || "").replace(/\s+/g, " ");
        let score = 0;
        if (/出演アーティスト|出演者|出演|ラインナップ|line[-\s]?up|artists?|performers?|cast/i.test(text)) {
          score += 120;
        }
        score += element.querySelectorAll("[data-artist], [data-performer], li, a, [class*='artist'], [class*='performer'], [class*='cast']").length * 8;
        if (text.length > 1200) {
          score -= 80;
        }
        return score;
      };

      const collectPerformerLineCandidates = (element) => {
        const lines = String(element.innerText || element.textContent || "")
          .split(/[\n\r]+/)
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const values = [];
        const startPattern = /^(出演|出演アーティスト|出演者|ラインナップ|LINEUP|Artists?|Performers?|Cast)\s*[:：]?/i;
        const stopPattern = /^(TICKET\s*INFO|販売情報|チケット情報|券種|詳細|お支払い方法|公演日時|会場)\b/i;

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (!startPattern.test(line)) {
            continue;
          }

          values.push(...splitCandidateText(line.replace(startPattern, "")));
          for (let cursor = index + 1; cursor < Math.min(lines.length, index + 12); cursor += 1) {
            const currentLine = lines[cursor];
            if (stopPattern.test(currentLine)) {
              break;
            }
            values.push(...splitCandidateText(currentLine));
          }

          const options = uniqueOptions(values);
          if (options.length > 0) {
            return options;
          }
        }

        return [];
      };

      const collectPerformerCandidates = (element) => {
        const values = [];
        const nodes = [
          ...(element.matches("[data-artist], [data-performer], li, a, [class*='artist-name'], [class*='performer-name'], [class*='cast-name'], [class*='name']")
            ? [element]
            : []),
          ...Array.from(element.querySelectorAll("[data-artist], [data-performer], [itemprop='performer'], li, a, [class*='artist-name'], [class*='performer-name'], [class*='cast-name'], [class*='name'], h3, h4"))
        ];

        nodes.forEach((node) => {
          const directValue = node.getAttribute("data-artist") || node.getAttribute("data-performer") || node.textContent || "";
          const parts = splitCandidateText(directValue);
          values.push(...parts);
        });

        if (values.length < 2) {
          values.push(...splitCandidateText(element.textContent || ""));
        }

        return uniqueOptions(values);
      };

      const discoverFromPerformers = () => {
        let containers = [];
        let selectorUsed = "";
        if (requestedPerformersSelector) {
          containers = Array.from(document.querySelectorAll(requestedPerformersSelector));
          if (containers.length > 0) {
            selectorUsed = requestedPerformersSelector;
          }
        }
        if (containers.length === 0) {
          containers = Array.from(document.querySelectorAll("section, article, aside, ul, ol, dl, table, div"))
            .map((element) => ({ element, score: scorePerformerContainer(element) }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, 3)
            .map((item) => item.element);
          selectorUsed = containers[0] ? cssPath(containers[0]) : "";
        }

        for (const container of containers) {
          const lineOptions = collectPerformerLineCandidates(container);
          if (lineOptions.length > 0 && lineOptions.length <= 30) {
            return {
              sourceMode: "performers",
              selectorUsed: selectorUsed || cssPath(container),
              options: lineOptions,
            };
          }
        }

        const options = uniqueOptions(containers.flatMap((container) => (
          collectPerformerCandidates(container).map((option) => option.label)
        )));

        if (options.length === 0) {
          throw new Error("出演アーティスト欄から候補を抽出できませんでした。セレクタを見直してください。");
        }

        return {
          sourceMode: "performers",
          selectorUsed,
          options,
        };
      };

      const scoreTicketContainer = (element) => {
        const text = (element.textContent || "").replace(/\s+/g, " ");
        let score = 0;
        if (/TICKET\s*INFO|販売情報|チケット情報|券種|チケット種別/i.test(text)) {
          score += 150;
        }
        score += (text.match(/¥|￥|\d[\d,]*\s*円/g) || []).length * 18;
        score += element.querySelectorAll("[data-ticket], [data-ticket-type], li, article, section, [class*='ticket'], [class*='price']").length * 4;
        if (text.length > 2500) {
          score -= 80;
        }
        return score;
      };

      const splitTicketLines = (text) => String(text || "")
        .split(/[\n\r]+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

      const isTicketNoise = (text) => {
        const value = cleanCandidate(text);
        return (
          !value ||
          value.length > 100 ||
          /^(TICKET INFO|販売情報|販売前|販売中|販売終了|販売終了したチケットを表示|認証済アカウントのみ申込可能|お支払い方法|詳細|整理番号順入場|1ドリンク別。?)$/i.test(value) ||
          /^(\d{4}\/|\d{4}-|\d{1,2}:\d{2})/.test(value)
        );
      };

      const collectTicketCandidates = (element) => {
        const values = [];
        const nodes = [
          ...(element.matches("[data-ticket], [data-ticket-type], li, article, section, [class*='ticket-card'], [class*='ticket-item'], [class*='price']")
            ? [element]
            : []),
          ...Array.from(element.querySelectorAll("[data-ticket], [data-ticket-type], li, article, section, [class*='ticket-card'], [class*='ticket-item'], [class*='price']"))
        ];

        nodes.forEach((node) => {
          const directValue = node.getAttribute("data-ticket") || node.getAttribute("data-ticket-type") || "";
          if (directValue) {
            values.push(directValue);
          }
        });

        const lines = splitTicketLines(element.innerText || element.textContent || "");
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (!/(¥|￥|\d[\d,]*\s*円)/.test(line)) {
            continue;
          }

          const previous = lines[index - 1] || "";
          const next = lines[index + 1] || "";
          const hasNameAndPrice = /[^\d\s,¥￥円]/.test(line.replace(/TICKET INFO|販売情報/gi, ""));
          let candidate = hasNameAndPrice ? line : `${previous}${line}`;

          if (isTicketNoise(candidate) && next && !/(販売前|販売中|販売終了|\d{4}\/|\d{1,2}:\d{2})/.test(next)) {
            candidate = `${line}${next}`;
          }

          candidate = compactTicketLabel(candidate);
          if (!isTicketNoise(candidate)) {
            values.push(candidate);
          }
        }

        return uniqueOptions(values);
      };

      const discoverFromTicketInfo = () => {
        let containers = [];
        let selectorUsed = "";
        if (requestedTicketInfoSelector) {
          containers = Array.from(document.querySelectorAll(requestedTicketInfoSelector));
          if (containers.length > 0) {
            selectorUsed = requestedTicketInfoSelector;
          }
        }
        if (containers.length === 0) {
          containers = Array.from(document.querySelectorAll("section, article, aside, main, ul, ol, div"))
            .map((element) => ({ element, score: scoreTicketContainer(element) }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, 3)
            .map((item) => item.element);
          selectorUsed = containers[0] ? cssPath(containers[0]) : "";
        }

        const options = uniqueOptions(containers.flatMap((container) => (
          collectTicketCandidates(container).map((option) => option.label)
        )));

        return {
          selectorUsed,
          options,
        };
      };

      const discovery = requestedSourceMode === "select"
        ? discoverFromSelect()
        : discoverFromPerformers();

      return {
        pageTitle: document.title,
        ticketInfo: discoverFromTicketInfo(),
        ...discovery,
      };
    }, {
      selector: requestedSelector,
      performersSelector,
      ticketInfoSelector,
      sourceMode,
    });

    return {
      targetUrl,
      learnedAt: new Date().toISOString(),
      ...discovery,
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const server = http.createServer((request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "missing_url" });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (url.pathname === "/api/time-sync") {
    const serverReceiveEpochMs = Date.now();
    const payload = {
      source: "local_server_clock",
      serverNowIso: new Date(serverReceiveEpochMs).toISOString(),
      serverReceiveEpochMs,
      serverSendEpochMs: Date.now(),
    };
    sendJson(response, 200, payload);
    return;
  }

  if (url.pathname === "/api/auto-selection-settings") {
    if (request.method === "GET") {
      try {
        sendJson(response, 200, readAutoSelectionSettings());
      } catch (error) {
        sendJson(response, 500, { error: error.message });
      }
      return;
    }

    if (request.method === "POST") {
      readRequestBody(request)
        .then((body) => {
          const payload = body ? JSON.parse(body) : {};
          sendJson(response, 200, writeAutoSelectionSettings(payload));
        })
        .catch((error) => {
          sendJson(response, 400, { error: error.message });
        });
      return;
    }

    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (url.pathname === "/api/discover-favorite-options") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    readRequestBody(request)
      .then(async (body) => {
        const payload = body ? JSON.parse(body) : {};
        const discovery = await discoverFavoriteOptions(payload);
        const currentSettings = normalizeAutoSelectionSettings(payload.settings || readAutoSelectionSettings());
        const favoriteArtistOptions = normalizeFavoriteOptions(discovery.options);
        const ticketTypeOptions = normalizeFavoriteOptions(discovery.ticketInfo.options);
        const currentOption = favoriteArtistOptions.find((option) => (
          option.label === currentSettings.favoriteArtist ||
          option.value === currentSettings.favoriteArtistValue
        ));
        const currentTicketOption = ticketTypeOptions.find((option) => (
          option.label === currentSettings.ticketType ||
          option.value === currentSettings.ticketTypeValue
        ));
        const selectedOption = currentOption || favoriteArtistOptions[0];
        const selectedTicketOption = currentTicketOption || ticketTypeOptions[0] || {
          label: currentSettings.ticketType,
          value: currentSettings.ticketTypeValue,
        };
        const nextSettings = {
          ...currentSettings,
          ticketType: selectedTicketOption.label,
          ticketTypeValue: selectedTicketOption.value,
          favoriteArtist: selectedOption.label,
          favoriteArtistValue: selectedOption.value,
          siteDiscovery: {
            ...currentSettings.siteDiscovery,
            targetUrl: discovery.targetUrl,
            sourceMode: discovery.sourceMode,
            performersSelector: discovery.sourceMode === "performers"
              ? discovery.selectorUsed
              : currentSettings.siteDiscovery.performersSelector,
            ticketInfoSelector: discovery.ticketInfo.selectorUsed || currentSettings.siteDiscovery.ticketInfoSelector,
            favoriteArtistSelector: discovery.sourceMode === "select"
              ? discovery.selectorUsed
              : currentSettings.siteDiscovery.favoriteArtistSelector,
            learnedAt: discovery.learnedAt,
            ticketTypeOptions,
            favoriteArtistOptions,
          },
        };
        const settings = payload.dryRun
          ? normalizeAutoSelectionSettings(nextSettings)
          : writeAutoSelectionSettings(nextSettings);

        sendJson(response, 200, {
          discovery: {
            targetUrl: discovery.targetUrl,
            pageTitle: discovery.pageTitle,
            sourceMode: discovery.sourceMode,
            performersSelectorUsed: discovery.selectorUsed,
            ticketInfoSelectorUsed: discovery.ticketInfo.selectorUsed,
            learnedAt: discovery.learnedAt,
            favoriteArtistOptions,
            ticketTypeOptions,
          },
          settings,
        });
      })
      .catch((error) => {
        sendJson(response, 400, { error: error.message });
      });
    return;
  }

  const filePath = files[url.pathname];
  if (filePath) {
    sendFile(response, filePath);
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Timing Assistant server running at http://${host}:${port}`);
});
