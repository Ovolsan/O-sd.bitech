(function () {
    'use strict';
    console.group('%c🛠️ Діагностика O sd.bitech', 'font-size:14px;font-weight:bold;color:#ffaa00');

    const TARGET_URL = 'https://sd.bitech.com.ua/admin/requests?presetId=my-queues';
    const KEYS = {
        lock: 'ovolya_sd_new_requests_monitor_lock',
        knownIds: 'ovolya_sd_new_requests_known_ids',
        force: 'ovolya_sd_force_monitor_acquire',
        mute: 'sd_mute_rules',
        filters: 'sd_request_filter_rules',
        sndStd: 'sd_snd_std',
        sndAfk: 'sd_snd_afk',
        night: 'sd_night_mode'
    };

    const ok = (msg, extra) => console.log('%c✅ ' + msg, 'color:#0f0', extra ?? '');
    const warn = (msg, extra) => console.warn('%c⚠️ ' + msg, 'color:#ffaa00', extra ?? '');
    const fail = (msg, extra) => console.error('%c❌ ' + msg, 'color:#f55', extra ?? '');
    const info = (msg, extra) => console.log('%cℹ️ ' + msg, 'color:#8cf', extra ?? '');

    function readJSON(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function isMonitorTargetPage() {
        try {
            const u = new URL(window.location.href);
            return u.pathname === '/admin/requests' && u.searchParams.get('presetId') === 'my-queues';
        } catch (e) {
            return false;
        }
    }

    // ─── 1. URL / сторінка ───────────────────────────────────────────
    console.group('1. URL і цільова сторінка');
    info('location.href', location.href);
    info('Точний TARGET_URL', TARGET_URL);
    info('Збіг href === TARGET_URL', location.href === TARGET_URL);
    if (isMonitorTargetPage()) {
        ok('isMonitorTargetPage() = true (pathname + presetId=my-queues, доп. params OK)');
    } else {
        warn('isMonitorTargetPage() = false — моніторинг нових заявок тут не активний');
    }
    console.groupEnd();

    // ─── 2. Lock / власник вкладки ───────────────────────────────────
    console.group('2. Lock моніторингу');
    const lock = readJSON(KEYS.lock, null);
    if (!lock) {
        warn('Lock відсутній — жодна вкладка не тримає моніторинг');
    } else {
        const leftMs = lock.expiresAt - Date.now();
        const alive = leftMs > 0;
        info('Lock raw', lock);
        info('expiresAt через', alive ? `${Math.round(leftMs / 1000)} с` : 'ПРОТУХ');
        if (alive) ok('Lock живий');
        else warn('Lock протух — найближча вкладка на target може перехопити');
    }
    const forceRaw = localStorage.getItem(KEYS.force);
    if (forceRaw) {
        const age = Date.now() - parseInt(forceRaw, 10);
        info('Force-acquire прапорець', { ts: forceRaw, ageMs: age, valid: age < 15000 });
        if (age < 15000) ok('Force-acquire активний (після таймер-перезавантаження)');
        else warn('Force-acquire застарів');
    } else {
        info('Force-acquire прапорця немає');
    }
    console.groupEnd();

    // ─── 3. UI моніторингу в DOM ─────────────────────────────────────
    console.group('3. UI моніторингу (DOM)');
    const debugBox = document.querySelector('#ovolya-monitor-debug-container');
    const timerBtn = document.querySelector('#ovolya-monitor-timer-btn');
    const pinBtn = document.querySelector('#ovolya-monitor-pin-btn');
    const notifPopup = document.querySelector('#ovolya-new-request-notification');
    if (debugBox) {
        ok('Контейнер #ovolya-monitor-debug-container є', {
            display: getComputedStyle(debugBox).display,
            timerText: timerBtn?.textContent?.trim() || null,
            pinVisible: pinBtn ? getComputedStyle(pinBtn).display !== 'none' : false
        });
        const t = timerBtn?.textContent || '';
        if (t.includes('моніторинг')) ok('Статус у UI: моніторинг (ця вкладка owner)');
        else if (t.includes('очікування')) warn('Статус у UI: очікування (lock у іншої вкладки або втрачено)');
        else if (t.includes('Закрыть') || t.includes('Закрити')) info('Відкрите меню налаштувань');
        else info('Текст таймера', t);
    } else {
        warn('UI моніторингу не знайдено (не target-сторінка або скрипт не ініціалізувався)');
    }
    if (notifPopup) warn('На екрані висить попап нових заявок', notifPopup.textContent?.trim());
    else info('Попап нових заявок відсутній');
    console.groupEnd();

    // ─── 4. Відомі ID заявок ─────────────────────────────────────────
    console.group('4. Відомі ID (анти-дублікат)');
    let ids = readJSON(KEYS.knownIds, []);
    if (!Array.isArray(ids)) ids = [];
    info(`Збережено ID: ${ids.length}`, ids.slice(-10));
    if (ids.length === 0) warn('Список порожній — наступна перевірка збереже поточні як «відомі» без алерту');
    else ok(`Останні ID: ${ids.slice(-5).join(', ')}`);
    console.groupEnd();

    // ─── 5. Поточні заявки на сторінці ───────────────────────────────
    console.group('5. Заявки, які бачить getCurrentTickets()-логіка');
    const tickets = [];
    document.querySelectorAll('.request-column-content a[href^="/admin/requests/"]').forEach(link => {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/admin\/requests\/(\d+)/);
        if (!match) return;
        const id = match[1];
        const title = link.getAttribute('title') || link.textContent.trim() || '';
        const row = link.closest('tr');
        let criticality = '', department = '';
        if (row) {
            row.querySelectorAll('.col-6.md\\:col-12, .col-6').forEach(col => {
                const propertyName = col.querySelector('.property-name');
                const value = col.querySelector('app-string-property span, .property-value, span');
                if (!propertyName) return;
                const name = propertyName.textContent.trim();
                const text = (value?.textContent || '').trim();
                if (name === 'Критичність') criticality = text;
                if (name === 'Відділ') department = text;
            });
        }
        if (!tickets.some(t => t.id === id)) {
            tickets.push({ id, title: title.slice(0, 60), department, criticality });
        }
    });
    info(`Знайдено заявок у DOM: ${tickets.length}`, tickets.slice(0, 8));
    if (tickets.length === 0 && isMonitorTargetPage()) {
        warn('На target-сторінці 0 заявок у DOM — перевірка нових нічого не побачить');
    }
    const knownSet = new Set(ids.map(String));
    const wouldBeNew = tickets.filter(t => !knownSet.has(String(t.id)));
    if (wouldBeNew.length) {
        warn(`Потенційно «нові» (немає в known_ids): ${wouldBeNew.length}`, wouldBeNew);
    } else if (tickets.length) {
        ok('Усі видимі заявки вже є в known_ids');
    }
    console.groupEnd();

    // ─── 6. Фільтри / чорний список ──────────────────────────────────
    console.group('6. Чорний список (request filters)');
    const filters = readJSON(KEYS.filters, []);
    const muteLegacy = readJSON(KEYS.mute, []);
    info('sd_request_filter_rules', filters);
    if (muteLegacy?.length) info('sd_mute_rules (legacy)', muteLegacy);
    if (!filters.length) info('Фільтрів немає — усі нові заявки будуть з алертом');
    else ok(`Активних правил: ${filters.length}`);
    console.groupEnd();

    // ─── 7. Звук і нічний режим ──────────────────────────────────────
    console.group('7. Звук / night mode');
    const std = localStorage.getItem(KEYS.sndStd);
    const afk = localStorage.getItem(KEYS.sndAfk);
    const night = localStorage.getItem(KEYS.night) === 'true';
    info('Нічний режим', night ? '🌙 ON (AFK мелодія)' : '☀️ OFF (стандарт)');
    if (std) ok(`Стандартна мелодія: є (~${Math.round(std.length / 1024)} KB dataURL)`);
    else warn('Стандартна мелодія не завантажена — буде лише TTS');
    if (afk) ok(`AFK мелодія: є (~${Math.round(afk.length / 1024)} KB dataURL)`);
    else warn('AFK мелодія не завантажена');
    if ('speechSynthesis' in window) ok('speechSynthesis доступний');
    else fail('speechSynthesis відсутній');
    console.groupEnd();

    // ─── 8. Системні пуші ────────────────────────────────────────────
    console.group('8. Notification API');
    if (!('Notification' in window)) {
        fail('Браузер не підтримує Notification');
    } else {
        info('permission', Notification.permission);
        if (Notification.permission === 'granted') {
            ok('Права granted');
            try {
                const n = new Notification('Тест sd.bitech', {
                    body: 'Якщо бачиш цей пуш — ОС/браузер їх пропускають.',
                    icon: 'https://www.google.com/s2/favicons?sz=64&domain=bitech.com.ua',
                    tag: 'sd-bitech-diag-' + Date.now()
                });
                ok('Тестовий пуш створено (дивись центр сповіщень, якщо не на екрані)');
                setTimeout(() => { try { n.close(); } catch (_) {} }, 8000);
            } catch (e) {
                fail('Помилка створення Notification', e);
            }
        } else if (Notification.permission === 'denied') {
            fail('Права denied — у налаштуваннях сайту (замочок біля URL) дозволь сповіщення');
        } else {
            warn('permission = default — зараз запрошу права…');
            Notification.requestPermission().then(p => {
                console.log('%cРезультат requestPermission:', 'color:#ffaa00', p);
            });
        }
    }
    console.groupEnd();

    // ─── 9. Ярлики / sidebar / logout ────────────────────────────────
    console.group('9. UI-модифікації скрипта');
    const customSide = document.querySelector('#ovolya-custom-sidebar-container');
    const shortcuts = document.querySelectorAll('.ovolya-queue-shortcut, .ovolya-shortcut-btn');
    const agentsCustom = document.querySelectorAll('.ovolya-custom-agents');
    const logoutBtn = [...document.querySelectorAll('button')].find(
        b => b.querySelector('.fa-sign-out-alt') || b.textContent.trim() === 'Вийти'
    );
    if (customSide) ok('Сайдбар-контейнер ярликів є', { children: customSide.children.length });
    else info('Сайдбар ярликів відсутній (не /admin/requests або ще не змонтовано)');
    info(`Ярликів черг/кнопок: ${shortcuts.length}`);
    info(`Кастомних «ID • дата» у списку: ${agentsCustom.length}`);
    if (window.location.pathname.includes('/admin/profile')) {
        info('Сторінка профілю — кнопка Вийти має залишатись');
    } else if (logoutBtn && logoutBtn.isConnected) {
        warn('Кнопка «Вийти» ще в DOM (скрипт мав би прибрати)');
    } else {
        ok('Кнопка «Вийти» відсутня (як і задумано поза /admin/profile)');
    }
    const potrogaly = [...document.querySelectorAll('.status-badge, .p-badge, .request-column .property-value')]
        .filter(el => el.textContent.includes('Потрогали'));
    const primary = [...document.querySelectorAll('.status-badge, .p-badge, .request-column .property-value')]
        .filter(el => el.textContent.includes('Первинна обробка'));
    if (potrogaly.length) ok(`Заміна статусу «Потрогали»: ${potrogaly.length} шт.`);
    if (primary.length) warn(`Ще є «Первинна обробка» без заміни: ${primary.length}`);
    console.groupEnd();

    // ─── 10. localStorage підсумок ───────────────────────────────────
    console.group('10. Усі ключі скрипта в localStorage');
    Object.entries(KEYS).forEach(([name, key]) => {
        const v = localStorage.getItem(key);
        if (v == null) info(`${name} (${key}): —`);
        else if (key.includes('snd_')) info(`${name}: dataURL ${Math.round(v.length / 1024)} KB`);
        else info(`${name}:`, v.length > 120 ? v.slice(0, 120) + '…' : v);
    });
    console.groupEnd();

    // ─── Дії (методи) ────────────────────────────────────────────────
    console.group('11. Швидкі дії (викликай з консолі)');
    window.__sdDiag = {
        /** Прибрати N останніх known ID → наступна перевірка сприйме їх як нові */
        forgetLastIds(n = 3) {
            let arr = readJSON(KEYS.knownIds, []);
            if (!Array.isArray(arr) || !arr.length) {
                warn('Немає ID для видалення');
                return [];
            }
            n = Math.min(n, arr.length);
            const removed = arr.splice(-n, n);
            localStorage.setItem(KEYS.knownIds, JSON.stringify(arr));
            ok(`Видалено з known_ids: ${removed.join(', ')}`);
            info('На наступному тіку моніторингу вони мають спрацювати як нові (якщо вкладка — owner і на target)');
            return removed;
        },
        /** Очистити всі known ID */
        clearKnownIds() {
            localStorage.removeItem(KEYS.knownIds);
            ok('known_ids очищено повністю');
        },
        /** Примусово скинути lock (усі вкладки стануть «очікування») */
        clearLock() {
            localStorage.removeItem(KEYS.lock);
            localStorage.removeItem(KEYS.force);
            ok('Lock і force-прапорець знято. Онови сторінку або натисни 📌');
        },
        /** Поставити force + перейти на TARGET_URL */
        forceGoTarget() {
            localStorage.setItem(KEYS.force, String(Date.now()));
            location.href = TARGET_URL;
        },
        /** Показати поточні заявки ще раз */
        tickets() {
            console.table(tickets);
            return tickets;
        },
        /** Тест TTS + (якщо є) мелодії через клік по UI — лише лог підказка */
        helpSound() {
            info('Звук з консолі надійно не запустити (autoplay policy). Відкрий меню таймера → 🔊 Звук → Тест');
        }
    };
    ok('Доступно: __sdDiag.forgetLastIds(3) | .clearKnownIds() | .clearLock() | .forceGoTarget() | .tickets()');
    console.log('%cПриклади:\n  __sdDiag.forgetLastIds(3)\n  __sdDiag.clearLock()\n  __sdDiag.forceGoTarget()', 'color:#aaa');
    console.groupEnd();

    console.log('%c—— кінець діагностики ——', 'color:#888');
    console.groupEnd();
})();