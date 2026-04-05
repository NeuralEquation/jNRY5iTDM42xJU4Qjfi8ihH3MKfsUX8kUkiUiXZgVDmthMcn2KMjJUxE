(function () {
  "use strict";

  const STORAGE_KEYS = {
    waitTimes: "tdlWaitTimes",
    selectedAttractions: "tdlSelectedAttractions",
    locationFallback: "tdlLocationFallback",
    lastKnownPosition: "tdlLastKnownPosition",
    routeStartTime: "tdlRouteStartTime",
    showRouteTimes: "tdlShowRouteTimes"
  };

  const WAIT_STEP = 15;
  const WAIT_WEIGHT = 1.0;
  const TRAVEL_WEIGHT = 1.25;
  const UNKNOWN_WAIT_PENALTY = 45;

  const AREA_CODE_MAP = {
    "ワールドバザール": "WB",
    "アドベンチャーランド": "AD",
    "ウエスタンランド": "WS",
    "クリッターカントリー": "CC",
    "ファンタジーランド": "FL",
    "トゥーンタウン": "TO",
    "トゥモローランド": "TL"
  };

  const AREA_TRAVEL_MINUTES = {
    CENTER: { WB: 8, AD: 8, WS: 10, CC: 15, FL: 8, TO: 12, TL: 8 },
    WB: { WB: 6, AD: 8, WS: 12, CC: 15, FL: 10, TO: 12, TL: 8 },
    AD: { WB: 8, AD: 6, WS: 8, CC: 12, FL: 10, TO: 15, TL: 12 },
    WS: { WB: 12, AD: 8, WS: 6, CC: 8, FL: 8, TO: 12, TL: 15 },
    CC: { WB: 15, AD: 12, WS: 8, CC: 6, FL: 8, TO: 15, TL: 18 },
    FL: { WB: 10, AD: 10, WS: 8, CC: 8, FL: 6, TO: 8, TL: 10 },
    TO: { WB: 12, AD: 15, WS: 12, CC: 15, FL: 8, TO: 6, TL: 8 },
    TL: { WB: 8, AD: 12, WS: 15, CC: 18, FL: 10, TO: 8, TL: 6 }
  };

  const AREA_DISPLAY_NAMES = Object.keys(AREA_CODE_MAP).reduce(function (result, key) {
    result[AREA_CODE_MAP[key]] = key;
    return result;
  }, {});
  AREA_DISPLAY_NAMES.EN = "入口付近";

  const AREA_CENTERS = {
    WB: { lat: 35.6330, lng: 139.8800 },
    AD: { lat: 35.6318, lng: 139.8773 },
    WS: { lat: 35.6314, lng: 139.8757 },
    CC: { lat: 35.6299, lng: 139.8756 },
    FL: { lat: 35.6320, lng: 139.8789 },
    TO: { lat: 35.6332, lng: 139.8830 },
    TL: { lat: 35.6330, lng: 139.8817 }
  };

  const PARK_REFERENCE_COORDINATES = { lat: 35.6322, lng: 139.8788 };
  const ENTRANCE_COORDINATES = { lat: 35.6329, lng: 139.8807 };
  const PARK_OUTSIDE_THRESHOLD_METERS = 1600;
  const ENTRANCE_THRESHOLD_METERS = 220;

  const UNAVAILABLE_ATTRACTION_IDS = new Set([
    "attr-155-ad",
    "attr-159-wl",
    "attr-164-fl",
    "attr-169-fl"
  ]);

  // 2026/04/24 の運営予定で休止になっているレストラン。
  const UNAVAILABLE_RESTAURANT_IDS = new Set([
    "rest-336-wl",
    "rest-335-wl",
    "rest-337-wl"
  ]);

  const LANDMARK_CHOICES = [
    { id: "attr-151-wb", label: "ワールドバザール / オムニバス付近" },
    { id: "attr-153-ad", label: "アドベンチャーランド / ジャングルクルーズ付近" },
    { id: "attr-160-wl", label: "ウエスタンランド / ビッグサンダー・マウンテン付近" },
    { id: "attr-162-cc", label: "クリッターカントリー / スプラッシュ・マウンテン付近" },
    { id: "attr-197-fl", label: "ファンタジーランド / 美女と野獣“魔法のものがたり”付近" },
    { id: "attr-175-tt", label: "トゥーンタウン / ロジャーラビットのカートゥーンスピン付近" },
    { id: "attr-189-tl", label: "トゥモローランド / モンスターズ・インク“ライド＆ゴーシーク！”付近" },
    { id: "entrance", label: "入口付近" }
  ];

  const state = {
    attractions: Array.isArray(window.TDS_ATTRACTIONS) ? window.TDS_ATTRACTIONS.slice() : [],
    restaurants: Array.isArray(window.TDS_RESTAURANTS) ? window.TDS_RESTAURANTS.slice() : [],
    restaurantMenus: Array.isArray(window.TDS_RESTAURANT_MENUS) ? window.TDS_RESTAURANT_MENUS.slice() : [],
    restaurantMenuIndex: {},
    restaurantGenreMap: {},
    waitTimes: loadStoredObject(STORAGE_KEYS.waitTimes, {}),
    selectedAttractions: loadStoredArray(STORAGE_KEYS.selectedAttractions),
    fallback: loadStoredObject(STORAGE_KEYS.locationFallback, null),
    lastKnownPosition: loadStoredObject(STORAGE_KEYS.lastKnownPosition, null),
    routeStartTime: loadStoredObject(STORAGE_KEYS.routeStartTime, ""),
    showRouteTimes: loadStoredObject(STORAGE_KEYS.showRouteTimes, false),
    isOffline: !window.navigator.onLine,
    gps: {
      status: "idle",
      position: null,
      errorMessage: ""
    },
    activeTab: "attractions"
  };

  const attractionMap = new Map(state.attractions.map(function (item) {
    return [item.id, item];
  }));

  const refs = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    if (!state.attractions.length || !state.restaurants.length) {
      document.body.innerHTML = "<main class=\"app-shell\"><section class=\"panel\"><h1>Data not found</h1><p>attractions.js または restaurants.js を読み込めませんでした。</p></section></main>";
      return;
    }

    state.selectedAttractions = state.selectedAttractions.filter(function (id) {
      return attractionMap.has(id);
    });
    buildRestaurantMenuIndex();

    populateSelect(refs.attractionAreaFilter, [{ value: "", label: "すべて" }].concat(
      uniqueValues(state.attractions.map(function (item) { return item.area; })).map(function (area) {
        return { value: area, label: area };
      })
    ));

    populateSelect(refs.attractionDisplayFilter, [{ value: "", label: "すべて" }].concat(
      uniqueValues(state.attractions.map(function (item) {
        return item.displayCategory || "";
      }).filter(Boolean)).map(function (category) {
        return { value: category, label: category };
      })
    ));

    populateSelect(refs.restaurantAreaFilter, [{ value: "", label: "すべて" }].concat(
      uniqueValues(state.restaurants.map(function (item) { return item.area; })).map(function (area) {
        return { value: area, label: area };
      })
    ));

    populateSelect(refs.restaurantCategoryFilter, [{ value: "", label: "すべて" }].concat(
      uniqueValues(state.restaurants.map(function (item) { return item.category; })).map(function (category) {
        return { value: category, label: category };
      })
    ));

    populateSelect(refs.fallbackLandmarkSelect, LANDMARK_CHOICES.map(function (choice) {
      return { value: choice.id, label: choice.label };
    }));

    if (state.fallback && (state.fallback.type === "landmark" || state.fallback.type === "entrance") && state.fallback.attractionId) {
      refs.fallbackLandmarkSelect.value = state.fallback.attractionId;
    }

    bindEvents();
    registerServiceWorker();
    refs.routeStartTime.value = isValidTimeString(state.routeStartTime) ? state.routeStartTime : "";
    renderAll();
    requestGpsLocation();
  }

  function cacheElements() {
    refs.attractionsList = document.getElementById("attractions-list");
    refs.restaurantsList = document.getElementById("restaurants-list");
    refs.rankingList = document.getElementById("ranking-list");
    refs.rankingSummary = document.getElementById("ranking-summary");
    refs.locationStatus = document.getElementById("location-status");
    refs.locationModeBanner = document.getElementById("location-mode-banner");
    refs.fallbackPanel = document.getElementById("fallback-panel");
    refs.fallbackLandmarkSelect = document.getElementById("fallback-landmark-select");
    refs.attractionSearch = document.getElementById("attraction-search");
    refs.attractionAreaFilter = document.getElementById("attraction-area-filter");
    refs.attractionDisplayFilter = document.getElementById("attraction-display-filter");
    refs.restaurantSearch = document.getElementById("restaurant-search");
    refs.restaurantAreaFilter = document.getElementById("restaurant-area-filter");
    refs.restaurantCategoryFilter = document.getElementById("restaurant-category-filter");
    refs.routeStartTime = document.getElementById("route-start-time");
    refs.toggleTimesButton = document.getElementById("toggle-times-button");
    refs.attractionsCount = document.getElementById("attractions-count");
    refs.restaurantsCount = document.getElementById("restaurants-count");
  }

  function bindEvents() {
    document.querySelectorAll(".tab-button").forEach(function (button) {
      button.addEventListener("click", function () {
        switchTab(button.getAttribute("data-tab"));
      });
    });

    refs.attractionSearch.addEventListener("input", renderAttractions);
    refs.attractionAreaFilter.addEventListener("change", renderAttractions);
    refs.attractionDisplayFilter.addEventListener("change", renderAttractions);
    refs.restaurantSearch.addEventListener("input", renderRestaurants);
    refs.restaurantAreaFilter.addEventListener("change", renderRestaurants);
    refs.restaurantCategoryFilter.addEventListener("change", renderRestaurants);
    refs.routeStartTime.addEventListener("input", handleRouteStartTimeChange);

    document.getElementById("retry-location-button").addEventListener("click", function () {
      requestGpsLocation();
    });
    document.getElementById("ranking-retry-location-button").addEventListener("click", function () {
      requestGpsLocation();
    });
    document.getElementById("clear-ranking-button").addEventListener("click", clearRanking);
    document.getElementById("use-current-time-button").addEventListener("click", useCurrentTime);
    refs.toggleTimesButton.addEventListener("click", toggleRouteTimes);
    document.getElementById("use-landmark-button").addEventListener("click", applyLandmarkFallback);
    document.getElementById("use-center-button").addEventListener("click", applyCenterFallback);

    refs.attractionsList.addEventListener("click", handleAttractionListClick);
    refs.attractionsList.addEventListener("input", handleWaitInput);
    refs.attractionsList.addEventListener("change", handleWaitInput);

    refs.rankingList.addEventListener("click", function (event) {
      const removeButton = event.target.closest("[data-remove-ranking]");
      if (!removeButton) {
        return;
      }
      removeFromRanking(removeButton.getAttribute("data-remove-ranking"));
    });

    window.addEventListener("online", handleNetworkChange);
    window.addEventListener("offline", handleNetworkChange);
  }

  function renderAll() {
    renderLocation();
    renderAttractions();
    renderRanking();
    renderRestaurants();
  }

  function renderAttractions() {
    const searchValue = refs.attractionSearch.value.trim().toLowerCase();
    const areaValue = refs.attractionAreaFilter.value;
    const displayValue = refs.attractionDisplayFilter.value;

    const filtered = state.attractions.filter(function (item) {
      const textPool = [item.name, item.area, item.category, item.displayCategory || "", item.description, item.searchText || ""]
        .join(" ")
        .toLowerCase();
      if (searchValue && !textPool.includes(searchValue)) {
        return false;
      }
      if (areaValue && item.area !== areaValue) {
        return false;
      }
      if (displayValue && item.displayCategory !== displayValue) {
        return false;
      }
      return true;
    });

    refs.attractionsCount.textContent = filtered.length + "件";
    refs.attractionsList.innerHTML = filtered.map(renderAttractionCard).join("");
  }

  function renderAttractionCard(item) {
    const waitTime = getWaitTime(item.id);
    const alreadyAdded = state.selectedAttractions.includes(item.id);
    const unavailable = isAttractionUnavailable(item);
    const waitValue = waitTime === null ? "" : String(waitTime);
    const waitBadge = waitTime === null
      ? "<span class=\"badge neutral\">待ち時間: 未入力</span>"
      : "<span class=\"badge\">待ち時間: " + waitTime + "分</span>";

    return "" +
      "<article class=\"card attraction-card" + (unavailable ? " is-unavailable" : "") + "\">" +
        "<div class=\"attraction-visual\">" +
          (item.imageUrl ? "<img src=\"" + escapeHtml(item.imageUrl) + "\" alt=\"" + escapeHtml(item.name) + "\" loading=\"lazy\" decoding=\"async\">" : "") +
          (unavailable ? "<span class=\"unavailable-stamp\">休止中</span>" : "") +
        "</div>" +
        "<div class=\"card-body\">" +
          "<div class=\"card-topline\">" +
            "<p class=\"card-subtitle\">" + escapeHtml(item.area) + "</p>" +
            waitBadge +
          "</div>" +
          "<h3 class=\"card-title\">" + escapeHtml(item.name) + "</h3>" +
          "<div class=\"badge-row\">" +
            "<span class=\"badge\">" + escapeHtml(item.category) + "</span>" +
            (item.displayCategory ? "<span class=\"badge alt\">" + escapeHtml(item.displayCategory) + "</span>" : "") +
            (unavailable ? "<span class=\"badge unavailable\">休止中</span>" : "") +
          "</div>" +
          "<p class=\"card-description\">" + escapeHtml(item.description || "") + "</p>" +
          "<div class=\"wait-controls\" aria-label=\"" + escapeHtml(item.name) + " の待ち時間入力\">" +
            "<button class=\"wait-button\" type=\"button\" data-wait-action=\"decrease\" data-id=\"" + escapeHtml(item.id) + "\" " + (unavailable ? "disabled" : "") + ">-15</button>" +
            "<input class=\"wait-input\" inputmode=\"numeric\" pattern=\"[0-9]*\" placeholder=\"分\" aria-label=\"" + escapeHtml(item.name) + " の待ち時間\" data-wait-input=\"" + escapeHtml(item.id) + "\" value=\"" + escapeHtml(waitValue) + "\" " + (unavailable ? "disabled" : "") + ">" +
            "<button class=\"wait-button\" type=\"button\" data-wait-action=\"increase\" data-id=\"" + escapeHtml(item.id) + "\" " + (unavailable ? "disabled" : "") + ">+15</button>" +
          "</div>" +
        "<div class=\"card-footer\">" +
          "<div class=\"inline-actions\">" +
                "<button class=\"" + (alreadyAdded || unavailable ? "secondary-button" : "primary-button") + "\" type=\"button\" data-add-ranking=\"" + escapeHtml(item.id) + "\" " + (alreadyAdded || unavailable ? "disabled" : "") + ">" +
                (unavailable ? "休止中" : alreadyAdded ? "追加済み" : "候補に追加") +
              "</button>" +
            "</div>" +
            renderDetailLink(item.detailUrl) +
          "</div>" +
        "</div>" +
      "</article>";
  }

  function renderRanking() {
    const selectedItems = state.selectedAttractions.map(function (id) {
      return attractionMap.get(id);
    }).filter(Boolean);

    refs.rankingSummary.innerHTML = buildRankingSummary(selectedItems);
    refs.toggleTimesButton.classList.toggle("is-on", Boolean(state.showRouteTimes));
    refs.toggleTimesButton.setAttribute("aria-pressed", state.showRouteTimes ? "true" : "false");

    if (!selectedItems.length) {
      refs.rankingList.innerHTML = renderEmptyState(
        "まだ候補がありません。",
        "アトラクション一覧で「候補に追加」を押すと、ここで待ち時間と移動しやすさを比べられます。"
      );
      return;
    }

    if (!hasTravelBasis()) {
      const gpsLocationState = getGpsLocationState();
      refs.rankingList.innerHTML = renderEmptyState(
        "位置情報がまだ確定していません。",
        gpsLocationState && gpsLocationState.type === "park_outside"
          ? "GPSではパーク外になりました。「入口付近」、「近い目印」、または「位置がわからない」を選ぶと候補が表示されます。"
          : "「GPSの再取得」を試すか、「入口付近」、「近い目印」、または「位置がわからない」を選ぶと候補が表示されます。"
      );
      return;
    }

    const scored = selectedItems.map(function (item) {
      const waitTime = getWaitTime(item.id);
      const travelInfo = getTravelInfo(item);
      const effectiveWait = waitTime === null ? UNKNOWN_WAIT_PENALTY : waitTime;
      const rawScore = 100 - (effectiveWait * WAIT_WEIGHT) - (travelInfo.minutes * TRAVEL_WEIGHT);
      const displayScore = Math.max(0, Math.round(rawScore));

      return {
        item: item,
        waitTime: waitTime,
        travelInfo: travelInfo,
        rawScore: rawScore,
        displayScore: displayScore
      };
    }).sort(function (a, b) {
      if (b.rawScore !== a.rawScore) {
        return b.rawScore - a.rawScore;
      }
      return a.item.name.localeCompare(b.item.name, "ja");
    });

    const routeTimeline = buildRouteTimeline(scored);

    refs.rankingList.innerHTML = scored.map(function (entry, index) {
      const waitLabel = entry.waitTime === null ? "未入力" : entry.waitTime + "分";
      const travelLabel = entry.travelInfo.minutes + "分";
      const travelHint = entry.travelInfo.mode === "gps"
        ? "GPS概算 / " + escapeHtml(AREA_DISPLAY_NAMES[entry.travelInfo.areaCode] || "")
        : entry.travelInfo.mode === "fallback-center"
          ? "CENTER基準"
          : entry.travelInfo.mode === "fallback-entrance"
            ? "入口付近基準"
          : "目印エリア基準";
      const routeStep = routeTimeline[index];
      const timelineHtml = state.showRouteTimes && routeStep
        ? "" +
          "<div class=\"timeline-block\">" +
            "<p class=\"timeline-line\">" + escapeHtml(routeStep.arrivalTime) + " 到着</p>" +
            "<p class=\"timeline-line\">移動 " + routeStep.travelMinutes + "分 / 待ち " + routeStep.waitMinutes + "分</p>" +
            "<p class=\"timeline-line\">" + escapeHtml(routeStep.readyTime) + " 次へ移動</p>" +
          "</div>"
        : "<p class=\"card-description\">" + escapeHtml(entry.item.description || "") + "</p>";

      return "" +
        "<article class=\"ranking-card\">" +
          (entry.item.imageUrl
            ? "<div class=\"ranking-visual attraction-visual\"><img src=\"" + escapeHtml(entry.item.imageUrl) + "\" alt=\"" + escapeHtml(entry.item.name) + "\" loading=\"lazy\" decoding=\"async\"></div>"
            : "") +
          "<div class=\"ranking-body\">" +
          "<div class=\"ranking-row\">" +
            "<div class=\"inline-actions\">" +
              "<div class=\"rank-number " + getRankClass(index) + "\">#" + (index + 1) + "</div>" +
              "<div>" +
                "<h3 class=\"card-title\">" + escapeHtml(entry.item.name) + "</h3>" +
                "<p class=\"card-subtitle\">" + escapeHtml(entry.item.area) + "</p>" +
              "</div>" +
            "</div>" +
            "<div class=\"badge-row\">" +
              "<span class=\"score-pill\">スコア " + entry.displayScore + "</span>" +
              "<span class=\"badge alt\">" + escapeHtml(entry.item.displayCategory || entry.item.category) + "</span>" +
            "</div>" +
          "</div>" +
          "<div class=\"badge-row\">" +
            "<span class=\"badge\">待ち時間: " + waitLabel + "</span>" +
            "<span class=\"badge alt\">移動: " + travelLabel + "</span>" +
            (entry.travelInfo.mode === "fallback-center" ? "" : "<span class=\"badge neutral\">" + travelHint + "</span>") +
          "</div>" +
          timelineHtml +
          "<div class=\"ranking-meta\">" +
            renderDetailLink(entry.item.detailUrl) +
            "<button class=\"ghost-button\" type=\"button\" data-remove-ranking=\"" + escapeHtml(entry.item.id) + "\">外す</button>" +
          "</div>" +
          "</div>" +
        "</article>";
    }).join("");
  }

  function renderRestaurants() {
    const filtered = getFilteredRestaurants();

    refs.restaurantsCount.textContent = filtered.length + "件";
    if (!filtered.length) {
      refs.restaurantsList.innerHTML = renderEmptyState("見つかりません", "エリアや分類を変えると探しやすくなります。");
      return;
    }

    refs.restaurantsList.innerHTML = filtered.map(function (entry) {
      const item = entry.item;
      const unavailable = isRestaurantUnavailable(item);
      const matchedMenusHtml = buildMatchedMenusHtml(entry.matchedMenus);
      const genreBadges = buildRestaurantGenreBadges(item.id);
      return "" +
        "<article class=\"restaurant-card" + (unavailable ? " is-unavailable" : "") + "\">" +
          (item.imageUrl
            ? "<div class=\"restaurant-visual\"><img src=\"" + escapeHtml(item.imageUrl) + "\" alt=\"" + escapeHtml(item.name) + "\" loading=\"lazy\" decoding=\"async\">" + (unavailable ? "<span class=\"unavailable-stamp\">休止中</span>" : "") + "</div>"
            : "") +
          "<div class=\"restaurant-body\">" +
            "<div class=\"card-topline\">" +
              "<p class=\"restaurant-meta\">" + escapeHtml(item.area) + "</p>" +
              "<div class=\"badge-row\">" +
                "<span class=\"badge\">" + escapeHtml(item.category) + "</span>" +
                (item.serviceType ? "<span class=\"badge alt\">" + escapeHtml(item.serviceType) + "</span>" : "") +
                (unavailable ? "<span class=\"badge unavailable\">休止中</span>" : "") +
              "</div>" +
            "</div>" +
            "<h3 class=\"restaurant-title\">" + escapeHtml(item.name) + "</h3>" +
            "<p class=\"restaurant-description\">" + escapeHtml(item.description || "") + "</p>" +
            (genreBadges ? "<div class=\"badge-row restaurant-genre-row\">" + genreBadges + "</div>" : "") +
            matchedMenusHtml +
            "<div class=\"restaurant-footer\">" +
              renderDetailLink(item.detailUrl) +
            "</div>" +
          "</div>" +
        "</article>";
    }).join("");
  }

  function renderLocation() {
    const pieces = [];
    const gpsLocationState = getGpsLocationState();
    const effectiveLocationState = getEffectiveLocationState();
    renderLocationModeBanner();
    if (state.isOffline) {
      pieces.push(renderLocationCard("オフライン中", buildOfflineLocationMessage(), "danger"));
    }
    if (state.gps.status === "requesting") {
      pieces.push(renderLocationCard("GPS取得中", state.isOffline ? "オフラインでも取得を試しています。" : "現在地を確認しています。", "neutral"));
    } else if (state.gps.status === "success" && state.gps.position) {
      if (gpsLocationState && gpsLocationState.type === "park_outside") {
        pieces.push(renderLocationCard("GPSを使用中", "パーク外", "danger"));
      } else if (gpsLocationState && gpsLocationState.type === "entrance") {
        pieces.push(renderLocationCard("GPSを使用中", "入口付近", "ok"));
      } else {
        const detail = (AREA_DISPLAY_NAMES[gpsLocationState && gpsLocationState.areaCode] || "不明エリア") + " 付近";
        pieces.push(renderLocationCard("GPSを使用中", detail, "ok"));
      }
    } else if (state.gps.status === "error") {
      pieces.push(renderLocationCard("GPSを使えません", state.gps.errorMessage || "下から場所を選んでください。", "danger"));
    } else if (state.lastKnownPosition) {
      pieces.push(renderLocationCard("前回の位置あり", "再取得できます。", "neutral"));
    } else {
      pieces.push(renderLocationCard("位置未設定", "GPSを再取得してください。", "neutral"));
    }

    if (effectiveLocationState && effectiveLocationState.source === "fallback") {
      pieces.push(renderLocationCard("手動で使用中", effectiveLocationState.label, "neutral"));
    }

    refs.locationStatus.innerHTML = pieces.join("");
    refs.fallbackPanel.classList.toggle("is-hidden", state.gps.status !== "error" && (!gpsLocationState || gpsLocationState.type !== "park_outside"));
  }

  function renderLocationModeBanner() {
    const gpsLocationState = getGpsLocationState();
    if (state.gps.status === "success" && state.gps.position && (!gpsLocationState || gpsLocationState.type !== "park_outside")) {
      refs.locationModeBanner.className = "location-mode-banner is-hidden";
      refs.locationModeBanner.textContent = "";
      return;
    }

    if (!state.fallback) {
      refs.locationModeBanner.className = "location-mode-banner is-hidden";
      refs.locationModeBanner.textContent = "";
      return;
    }

    if (state.fallback.type === "entrance") {
      refs.locationModeBanner.className = "location-mode-banner landmark";
      refs.locationModeBanner.textContent = "現在の基準: 入口付近";
      return;
    }

    if (state.fallback.type === "landmark") {
      const attraction = attractionMap.get(state.fallback.attractionId);
      refs.locationModeBanner.className = "location-mode-banner landmark";
      refs.locationModeBanner.textContent = "現在の基準: 目印" + (attraction ? " / " + attraction.name : "");
      return;
    }

    refs.locationModeBanner.className = "location-mode-banner center";
    refs.locationModeBanner.textContent = "現在の基準: 位置がわからない";
  }

  function handleAttractionListClick(event) {
    const waitButton = event.target.closest("[data-wait-action]");
    if (waitButton) {
      adjustWaitTime(waitButton.getAttribute("data-id"), waitButton.getAttribute("data-wait-action"));
      return;
    }

    const addButton = event.target.closest("[data-add-ranking]");
    if (addButton) {
      addToRanking(addButton.getAttribute("data-add-ranking"));
    }
  }

  function handleWaitInput(event) {
    const input = event.target.closest("[data-wait-input]");
    if (!input) {
      return;
    }

    const id = input.getAttribute("data-wait-input");
    if (isAttractionUnavailable(attractionMap.get(id))) {
      return;
    }
    input.value = input.value.replace(/[^\d]/g, "");

    const cleaned = input.value.trim();
    if (!cleaned) {
      delete state.waitTimes[id];
      persistState();
      renderRanking();
      if (event.type === "change") {
        renderAttractions();
      }
      return;
    }

    const parsed = parseInt(cleaned, 10);
    if (Number.isNaN(parsed)) {
      return;
    }

    state.waitTimes[id] = { waitTime: Math.max(0, parsed) };
    persistState();
    renderRanking();
    if (event.type === "change") {
      renderAttractions();
    }
  }

  function adjustWaitTime(id, direction) {
    if (isAttractionUnavailable(attractionMap.get(id))) {
      return;
    }
    const current = getWaitTime(id);
    if (direction === "increase") {
      setWaitTime(id, (current === null ? 0 : current) + WAIT_STEP);
      return;
    }

    const nextValue = current === null ? 0 : Math.max(0, current - WAIT_STEP);
    setWaitTime(id, nextValue);
  }

  function setWaitTime(id, value) {
    state.waitTimes[id] = { waitTime: Math.max(0, Math.round(value)) };
    persistState();
    renderAttractions();
    renderRanking();
  }

  function getWaitTime(id) {
    const entry = state.waitTimes[id];
    return entry && Number.isInteger(entry.waitTime) ? entry.waitTime : null;
  }

  function addToRanking(id) {
    if (isAttractionUnavailable(attractionMap.get(id))) {
      return;
    }
    if (!state.selectedAttractions.includes(id)) {
      state.selectedAttractions.push(id);
      persistState();
      renderAttractions();
      renderRanking();
    }
  }

  function removeFromRanking(id) {
    state.selectedAttractions = state.selectedAttractions.filter(function (selectedId) {
      return selectedId !== id;
    });
    persistState();
    renderAttractions();
    renderRanking();
  }

  function clearRanking() {
    state.selectedAttractions = [];
    persistState();
    renderAttractions();
    renderRanking();
  }

  function requestGpsLocation() {
    if (!navigator.geolocation) {
      handleGpsFailure("この端末ではGPSが利用できません。");
      return;
    }

    state.gps.status = "requesting";
    state.gps.errorMessage = "";
    renderLocation();

    navigator.geolocation.getCurrentPosition(function (position) {
      state.gps.status = "success";
      state.gps.position = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy || null
      };
      state.lastKnownPosition = state.gps.position;
      saveJson(STORAGE_KEYS.lastKnownPosition, state.lastKnownPosition);
      renderLocation();
      renderRanking();
    }, function (error) {
      const messageMap = {
        1: "位置情報が拒否されました。",
        2: "位置情報を取得できません。",
        3: "GPSがタイムアウトしました。"
      };
      handleGpsFailure(messageMap[error.code] || "GPS取得に失敗しました。");
    }, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 60000
    });
  }

  function handleGpsFailure(message) {
    state.gps.status = "error";
    state.gps.position = null;
    state.gps.errorMessage = message;
    renderLocation();
    renderRanking();
  }

  function applyLandmarkFallback() {
    const attractionId = refs.fallbackLandmarkSelect.value;
    if (attractionId === "entrance") {
      state.fallback = {
        type: "entrance",
        attractionId: "entrance",
        area: null
      };
      saveJson(STORAGE_KEYS.locationFallback, state.fallback);
      renderLocation();
      renderRanking();
      return;
    }

    const attraction = attractionMap.get(attractionId);
    if (!attraction) {
      return;
    }

    state.fallback = {
      type: "landmark",
      attractionId: attraction.id,
      area: attraction.area
    };
    saveJson(STORAGE_KEYS.locationFallback, state.fallback);
    renderLocation();
    renderRanking();
  }

  function applyCenterFallback() {
    state.fallback = {
      type: "unknown-center",
      attractionId: null,
      area: null
    };
    saveJson(STORAGE_KEYS.locationFallback, state.fallback);
    renderLocation();
    renderRanking();
  }

  function getTravelInfo(attraction) {
    const areaCode = AREA_CODE_MAP[attraction.area];
    const locationState = getEffectiveLocationState();

    if (!locationState || locationState.type === "park_outside") {
      return null;
    }

    if (locationState.source === "gps" && state.gps.position) {
      const center = AREA_CENTERS[areaCode];
      const origin = locationState.type === "entrance" ? ENTRANCE_COORDINATES : state.gps.position;
      const distanceMeters = haversineMeters(origin.lat, origin.lng, center.lat, center.lng);
      return {
        minutes: Math.max(2, Math.round(distanceMeters / 65)),
        mode: "gps",
        areaCode: locationState.type === "entrance" ? "EN" : areaCode
      };
    }

    if (locationState.type === "unknown-center") {
      return {
        minutes: AREA_TRAVEL_MINUTES.CENTER[areaCode],
        mode: "fallback-center",
        areaCode: areaCode
      };
    }

    if (locationState.type === "entrance") {
      const center = AREA_CENTERS[areaCode];
      const distanceMeters = haversineMeters(ENTRANCE_COORDINATES.lat, ENTRANCE_COORDINATES.lng, center.lat, center.lng);
      return {
        minutes: Math.max(2, Math.round(distanceMeters / 65)),
        mode: "fallback-entrance",
        areaCode: "EN"
      };
    }

    const originAreaCode = locationState.areaCode;
    return {
      minutes: AREA_TRAVEL_MINUTES[originAreaCode][areaCode],
      mode: "fallback-landmark",
      areaCode: areaCode
    };
  }

  function hasTravelBasis() {
    return Boolean(getEffectiveLocationState());
  }

  function getNearestAreaCode(position) {
    let nearestCode = "MI";
    let nearestDistance = Number.POSITIVE_INFINITY;

    Object.keys(AREA_CENTERS).forEach(function (code) {
      const center = AREA_CENTERS[code];
      const distance = haversineMeters(position.lat, position.lng, center.lat, center.lng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCode = code;
      }
    });

    return nearestCode;
  }

  function buildRankingSummary(selectedItems) {
    const pills = [
      "<span class=\"summary-pill\">選択中 " + selectedItems.length + "件</span>"
    ];

    if (isValidTimeString(state.routeStartTime)) {
      pills.push("<span class=\"summary-pill\">開始 " + escapeHtml(state.routeStartTime) + "</span>");
    } else {
      pills.push("<span class=\"summary-pill alt\">開始時刻を入力</span>");
    }

    pills.push("<span class=\"summary-pill" + (state.showRouteTimes ? "" : " alt") + "\">" + (state.showRouteTimes ? "時刻表示: ON" : "時刻表示: OFF") + "</span>");

    if (state.gps.status === "success" && state.gps.position) {
      const gpsLocationState = getGpsLocationState();
      if (gpsLocationState && gpsLocationState.type === "park_outside") {
        pills.push("<span class=\"summary-pill alt\">GPS: パーク外</span>");
      } else if (gpsLocationState && gpsLocationState.type === "entrance") {
        pills.push("<span class=\"summary-pill\">GPS: 入口付近</span>");
      } else {
        pills.push("<span class=\"summary-pill\">GPS利用中</span>");
      }
      if (gpsLocationState && gpsLocationState.type === "park_outside" && state.fallback) {
        pills.push("<span class=\"summary-pill\">手動位置を使用中</span>");
      }
    } else if (state.fallback && state.fallback.type === "entrance") {
      pills.push("<span class=\"summary-pill\">入口付近</span>");
    } else if (state.fallback && state.fallback.type === "landmark") {
      const attraction = attractionMap.get(state.fallback.attractionId);
      pills.push("<span class=\"summary-pill\">目印基準: " + escapeHtml(attraction ? attraction.name : "選択済み") + "</span>");
    } else if (state.fallback && state.fallback.type === "unknown-center") {
      pills.push("<span class=\"summary-pill center-pill\">センター基準</span>");
    } else {
      pills.push("<span class=\"summary-pill alt\">位置未確定</span>");
    }

    return pills.join("");
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll(".tab-button").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-tab") === tabName);
    });
    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      panel.classList.toggle("is-hidden", panel.getAttribute("data-panel") !== tabName);
    });
  }

  function renderLocationCard(title, detail, tone) {
    return "" +
      "<div class=\"location-card\">" +
        "<div class=\"card-topline\">" +
          "<strong>" + escapeHtml(title) + "</strong>" +
          (tone === "danger" ? "" : "<span class=\"status-pill " + tone + "\">" + escapeHtml(toneLabel(tone)) + "</span>") +
        "</div>" +
        "<p class=\"location-detail\">" + escapeHtml(detail) + "</p>" +
      "</div>";
  }

  function renderDetailLink(url) {
    if (state.isOffline) {
      return "<span class=\"detail-link is-disabled\">オフライン中は開けません</span>";
    }
    return "<a class=\"detail-link\" href=\"" + escapeHtml(url) + "\" target=\"_blank\" rel=\"noreferrer\">公式詳細を見る</a>";
  }

  function renderEmptyState(title, body) {
    return "" +
      "<div class=\"empty-state\">" +
        "<strong>" + escapeHtml(title) + "</strong>" +
        "<p>" + escapeHtml(body) + "</p>" +
      "</div>";
  }

  function toneLabel(tone) {
    if (tone === "ok") {
      return "使用中";
    }
    if (tone === "danger") {
      return "";
    }
    return "情報";
  }

  function buildOfflineLocationMessage() {
    if (state.gps.status === "success" && state.gps.position) {
      return "公式詳細は開けません。GPSは現在使えています。";
    }
    return "公式詳細は開けません。GPSが使えないときは入口付近、目印、または位置がわからないを使ってください。";
  }

  function populateSelect(select, options) {
    select.innerHTML = options.map(function (option) {
      return "<option value=\"" + escapeHtml(option.value) + "\">" + escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function persistState() {
    saveJson(STORAGE_KEYS.waitTimes, state.waitTimes);
    saveJson(STORAGE_KEYS.selectedAttractions, state.selectedAttractions);
    saveJson(STORAGE_KEYS.routeStartTime, state.routeStartTime);
    saveJson(STORAGE_KEYS.showRouteTimes, Boolean(state.showRouteTimes));
  }

  function uniqueValues(values) {
    return Array.from(new Set(values));
  }

  function getFilteredRestaurants() {
    const searchValue = refs.restaurantSearch.value.trim();
    const searchTokens = tokenizeSearchValue(searchValue);
    const areaValue = refs.restaurantAreaFilter.value;
    const categoryValue = refs.restaurantCategoryFilter.value;

    return state.restaurants.reduce(function (result, item) {
      const matchedMenus = getMatchedMenus(item.id, searchTokens);
      const textMatched = matchesSearchText(item._searchText || "", searchTokens);
      if (searchTokens.length && !textMatched && !matchedMenus.length) {
        return result;
      }
      if (areaValue && item.area !== areaValue) {
        return result;
      }
      if (categoryValue && item.category !== categoryValue) {
        return result;
      }
      result.push({
        item: item,
        matchedMenus: matchedMenus
      });
      return result;
    }, []);
  }

  function getMatchedMenus(restaurantId, searchTokens) {
    if (!searchTokens.length) {
      return [];
    }

    return (state.restaurantMenuIndex[restaurantId] || []).filter(function (entry) {
      return matchesSearchText(entry.searchText, searchTokens);
    }).map(function (entry) {
      return entry.menu;
    });
  }

  function buildMatchedMenusHtml(matchedMenus) {
    if (!matchedMenus.length) {
      return "";
    }

    const visibleMenus = matchedMenus.slice(0, 3);
    const itemsHtml = visibleMenus.map(function (menu) {
      const priceLabel = typeof menu.price === "number"
        ? "¥" + menu.price.toLocaleString("ja-JP")
        : "価格未設定";
      return "<li>" + escapeHtml(menu.name) + " <span class=\"matched-menu-price\">(" + escapeHtml(priceLabel) + ")</span></li>";
    }).join("");

    return "" +
      "<div class=\"matched-menu-block\">" +
        "<p class=\"restaurant-description matched-menu-heading\">一致したメニュー</p>" +
        "<ul class=\"matched-menu-list\">" + itemsHtml + "</ul>" +
        (matchedMenus.length > visibleMenus.length
          ? "<p class=\"restaurant-description matched-menu-more\">ほか" + escapeHtml(String(matchedMenus.length - visibleMenus.length)) + "件</p>"
          : "") +
      "</div>";
  }

  function buildRestaurantGenreBadges(restaurantId) {
    const genres = (state.restaurantGenreMap[restaurantId] || []).slice(0, 4);

    return genres.map(function (genre) {
      return "<span class=\"badge neutral\">" + escapeHtml(genre) + "</span>";
    }).join("");
  }

  function tokenizeSearchValue(value) {
    if (!value) {
      return [];
    }

    return uniqueValues(value.split(/[\s\u3000,、・\/]+/).reduce(function (result, token) {
      return result.concat(expandSearchToken(token.trim()));
    }, []).filter(Boolean));
  }

  function expandSearchToken(token) {
    const normalized = compactSearchText(normalizeSearchText(token));
    if (!normalized) {
      return [];
    }

    const synonymGroups = [
      ["はんはーかー", "はーかー"],
      ["ほっととっく", "とっく"],
      ["ふれんちふらい", "ふらいほてと", "ほてと"],
      ["すはけってぃ", "はすた"],
      ["えひ", "えび", "えひちり", "しゅりんふ", "かいろう"],
      ["ちきん", "とり", "からあけ"],
      ["ひいふ", "きゆうにく", "すてーき", "ろーすとひいふ"],
      ["ほーく", "ふたにく", "へーこん", "そーせーし"],
      ["かれー", "かりー"],
      ["はん", "らいす", "ほうる", "とん"],
      ["けーき", "むーす", "ふりん", "はふえ", "すいーつ", "てさーと"],
      ["こーひー", "らて", "てぃー", "とりんく", "しゆーす", "そーた"],
      ["ひさ", "ひっつぁ", "かるつぉーね"],
      ["らーめん", "めん", "うとん"],
      ["さんと", "はん", "ふれっと"],
      ["わっふる", "はんけーき"],
      ["あいす", "しぇいく", "さんてー"],
      ["まん", "にくまん"]
    ];

    const expanded = synonymGroups.reduce(function (result, group) {
      if (group.includes(normalized)) {
        return result.concat(group);
      }
      return result;
    }, [normalized]);

    return uniqueValues(expanded);
  }

  function matchesSearchText(text, searchTokens) {
    if (!searchTokens.length) {
      return true;
    }

    return searchTokens.every(function (token) {
      return text.includes(token);
    });
  }

  function normalizeSearchText(value) {
    return toHiragana(String(value || ""))
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‐‑‒–—―ーｰ]/g, "ー");
  }

  function compactSearchText(value) {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/[・･\-_\/]/g, "")
      .replace(/ー/g, "");
  }

  function toHiragana(value) {
    return String(value || "").replace(/[ァ-ヶ]/g, function (char) {
      return String.fromCharCode(char.charCodeAt(0) - 0x60);
    });
  }

  function buildRestaurantMenuIndex() {
    state.restaurantMenuIndex = {};
    state.restaurantGenreMap = {};

    state.restaurants.forEach(function (item) {
      item._searchText = compactSearchText(normalizeSearchText([
        item.name,
        item.area,
        item.category,
        item.serviceType || "",
        item.description || ""
      ].join(" ")));
      state.restaurantMenuIndex[item.id] = [];
      state.restaurantGenreMap[item.id] = [];
    });

    state.restaurantMenus.forEach(function (menu) {
      if (!menu || !menu.restaurantId || !menu.name) {
        return;
      }

      if (!state.restaurantMenuIndex[menu.restaurantId]) {
        state.restaurantMenuIndex[menu.restaurantId] = [];
      }

      state.restaurantMenuIndex[menu.restaurantId].push({
        menu: menu,
        searchText: compactSearchText(normalizeSearchText([menu.name].concat(Array.isArray(menu.genres) ? menu.genres : []).join(" ")))
      });

      if (!state.restaurantGenreMap[menu.restaurantId]) {
        state.restaurantGenreMap[menu.restaurantId] = [];
      }

      (Array.isArray(menu.genres) ? menu.genres : []).forEach(function (genre) {
        if (genre && !state.restaurantGenreMap[menu.restaurantId].includes(genre)) {
          state.restaurantGenreMap[menu.restaurantId].push(genre);
        }
      });
    });
  }

  function isAttractionUnavailable(item) {
    return Boolean(item) && UNAVAILABLE_ATTRACTION_IDS.has(item.id);
  }

  function isRestaurantUnavailable(item) {
    return Boolean(item) && UNAVAILABLE_RESTAURANT_IDS.has(item.id);
  }

  function getRankClass(index) {
    if (index === 0) {
      return "rank-1";
    }
    if (index === 1) {
      return "rank-2";
    }
    if (index === 2) {
      return "rank-3";
    }
    return "rank-other";
  }

  function loadStoredObject(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function loadStoredArray(key) {
    const value = loadStoredObject(key, []);
    return Array.isArray(value) ? Array.from(new Set(value)) : [];
  }

  function saveJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Ignore storage quota issues in the static client.
    }
  }

  function handleNetworkChange() {
    state.isOffline = !window.navigator.onLine;
    renderAll();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {
        // Ignore registration errors in unsupported environments.
      });
    });
  }

  function handleRouteStartTimeChange() {
    const value = refs.routeStartTime.value;
    state.routeStartTime = isValidTimeString(value) ? value : "";
    persistState();
    renderRanking();
  }

  function useCurrentTime() {
    const now = new Date();
    const value = padTwo(now.getHours()) + ":" + padTwo(now.getMinutes());
    state.routeStartTime = value;
    refs.routeStartTime.value = value;
    persistState();
    renderRanking();
  }

  function toggleRouteTimes() {
    state.showRouteTimes = !state.showRouteTimes;
    persistState();
    renderRanking();
  }

  function buildRouteTimeline(scoredItems) {
    if (!isValidTimeString(state.routeStartTime)) {
      return [];
    }

    const steps = [];
    let currentMinutes = parseTimeStringToMinutes(state.routeStartTime);
    let previousAreaCode = null;

    scoredItems.forEach(function (entry, index) {
      const currentAreaCode = AREA_CODE_MAP[entry.item.area];
      const travelMinutes = index === 0
        ? entry.travelInfo.minutes
        : getTravelMinutesBetweenAreas(previousAreaCode, currentAreaCode);
      const waitMinutes = entry.waitTime === null ? UNKNOWN_WAIT_PENALTY : entry.waitTime;
      const arrivalMinutes = currentMinutes + travelMinutes;
      const readyMinutes = arrivalMinutes + waitMinutes;

      steps.push({
        arrivalTime: formatMinutesToTimeString(arrivalMinutes),
        readyTime: formatMinutesToTimeString(readyMinutes),
        travelMinutes: travelMinutes,
        waitMinutes: waitMinutes
      });

      currentMinutes = readyMinutes;
      previousAreaCode = currentAreaCode;
    });

    return steps;
  }

  function getTravelMinutesBetweenAreas(fromAreaCode, toAreaCode) {
    if (!fromAreaCode || !toAreaCode) {
      return 0;
    }
    return AREA_TRAVEL_MINUTES[fromAreaCode][toAreaCode];
  }

  function parseTimeStringToMinutes(value) {
    if (!isValidTimeString(value)) {
      return null;
    }
    const parts = value.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function formatMinutesToTimeString(totalMinutes) {
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return padTwo(hours) + ":" + padTwo(minutes);
  }

  function isValidTimeString(value) {
    return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
  }

  function padTwo(value) {
    return String(value).padStart(2, "0");
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371000 * c;
  }

  function getGpsLocationState() {
    if (state.gps.status !== "success" || !state.gps.position) {
      return null;
    }

    const position = state.gps.position;
    const accuracyPadding = Math.min(position.accuracy || 0, 400);
    const parkDistance = haversineMeters(position.lat, position.lng, PARK_REFERENCE_COORDINATES.lat, PARK_REFERENCE_COORDINATES.lng);
    if (parkDistance > PARK_OUTSIDE_THRESHOLD_METERS + accuracyPadding) {
      return {
        type: "park_outside",
        label: "パーク外",
        source: "gps"
      };
    }

    const entranceDistance = haversineMeters(position.lat, position.lng, ENTRANCE_COORDINATES.lat, ENTRANCE_COORDINATES.lng);
    if (entranceDistance <= ENTRANCE_THRESHOLD_METERS + Math.min(position.accuracy || 0, 120)) {
      return {
        type: "entrance",
        label: "入口付近",
        areaCode: "EN",
        source: "gps"
      };
    }

    const nearestCode = getNearestAreaCode(position);
    return {
      type: "area",
      label: AREA_DISPLAY_NAMES[nearestCode] || "不明エリア",
      areaCode: nearestCode,
      source: "gps"
    };
  }

  function getFallbackLocationState() {
    if (!state.fallback) {
      return null;
    }

    if (state.fallback.type === "unknown-center") {
      return {
        type: "unknown-center",
        label: "位置がわからない",
        source: "fallback"
      };
    }

    if (state.fallback.type === "entrance") {
      return {
        type: "entrance",
        label: "入口付近",
        areaCode: "EN",
        source: "fallback"
      };
    }

    const originAreaCode = AREA_CODE_MAP[state.fallback.area];
    if (!originAreaCode) {
      return null;
    }

    return {
      type: "area",
      label: state.fallback.area,
      areaCode: originAreaCode,
      source: "fallback"
    };
  }

  function getEffectiveLocationState() {
    const gpsLocationState = getGpsLocationState();
    if (gpsLocationState && gpsLocationState.type !== "park_outside") {
      return gpsLocationState;
    }

    const fallbackLocationState = getFallbackLocationState();
    if (fallbackLocationState) {
      return fallbackLocationState;
    }

    return null;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
