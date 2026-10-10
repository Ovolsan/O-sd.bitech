// ==UserScript==
// @name         О sd.bitech
// @namespace    http://tampermonkey.net/
// @version      20261010.4
// @description  Кнопка виходу біля користувача в профілі. Компактні списки заявок. Ярлики. Моніторинг нових заявок + Звук и Фильтры + Системные уведомления
// @author       Ovolsan
// @match        *://sd.bitech.com.ua/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bitech.com.ua
// @updateURL    https://github.com/Ovolsan/O-sd.bitech/raw/refs/heads/main/O%20sd.bitech.user.js
// @downloadURL  https://github.com/Ovolsan/O-sd.bitech/raw/refs/heads/main/O%20sd.bitech.user.js
// ==/UserScript==

(function () {
    'use strict';
    const REQUESTS_PAGE_SIZE = '100';
    let requestsPageSizeNavigationPending = false;

    function ensureRequestsPageSize() {
        if (requestsPageSizeNavigationPending) return true;
        if (!/^\/admin\/requests\/?$/.test(window.location.pathname)) return false;
        const url = new URL(window.location.href);
        if (url.searchParams.get('pageSize') === REQUESTS_PAGE_SIZE) return false;
        // Angular читает размер страницы из URL, в том числе для пустых списков.
        url.searchParams.set('pageSize', REQUESTS_PAGE_SIZE);
        url.searchParams.set('currPage', '1');
        requestsPageSizeNavigationPending = true;
        window.location.replace(url.href);
        return true;
    }

    // Нормализуем адрес до запуска мониторинга и обработки первоначального списка.
    if (ensureRequestsPageSize()) return;

    let lastShortcutsSnapshot = '';
    let trackedSourceElements = []; // Массив для слежения за оригинальными элементами (не оторвал ли их Angular)

    // ================================КАРТА СОКРАЩЕНИЙ ОЧЕРЕДЕЙ============================
    const QUEUE_MAP = {
        'Виїзд': 'Виїзд',
        'Мої заявки': 'Заявки',
        'Мої черги': 'Черги',
        'IoT_LoRaWAN': 'LoRaWAN',
        'L1_Jira': 'Моніторинг',
        'NOC': 'NOC',
        'SOC': 'SOC',
        'Регламент': 'Регламент',
        'IoT_LoRaWAN_status': 'LoRaWAN status',
        'L0.email': 'Email',
        'TETRA_Information': 'TETRA info'
    };

    // ==============================КНОПКА ВЫХОДА В ПРОФИЛЕ==============================
    let profileLogoutControl = null;
    let profileLogoutOrigin = null;

    function manageLogoutButton() {
        const headerButton = [...document.querySelectorAll('.dpl-header button')]
            .find(button => button.querySelector('.fa-sign-out-alt') || button.textContent.trim() === 'Вийти');
        // Переносим весь компонент PrimeNG, сохраняя его обработчик onClick.
        const logoutControl = headerButton?.closest('p-button') || headerButton ||
            (profileLogoutOrigin?.parent.isConnected ? profileLogoutControl : null);
        if (!logoutControl) return;

        if (logoutControl !== profileLogoutControl) {
            profileLogoutControl = logoutControl;
            profileLogoutOrigin = {
                parent: logoutControl.parentNode,
                nextSibling: logoutControl.nextSibling,
                display: logoutControl.style.getPropertyValue('display'),
                displayPriority: logoutControl.style.getPropertyPriority('display')
            };
        }

        if (!/^\/admin\/profile\/?$/.test(window.location.pathname)) {
            // При переходах Angular возвращаем кнопку в её исходный контейнер и скрываем.
            const { parent, nextSibling } = profileLogoutOrigin;
            if (parent.isConnected && logoutControl.parentNode !== parent) {
                parent.insertBefore(logoutControl, nextSibling?.parentNode === parent ? nextSibling : null);
            }
            if (logoutControl.style.getPropertyValue('display') !== 'none') {
                logoutControl.style.setProperty('display', 'none', 'important');
            }
            return;
        }

        const userInput = document.querySelector('app-profile-page app-user-form app-text-input[key="header"] input');
        if (!userInput) {
            // Форма может появиться позже панели; ждём следующей DOM-мутации.
            logoutControl.style.setProperty('display', 'none', 'important');
            return;
        }

        const userControl = userInput.closest('.disabled-wrapper') || userInput;
        let row = userControl.closest('.ovolya-profile-user-row');
        if (!row) {
            row = document.createElement('div');
            row.className = 'ovolya-profile-user-row';
            row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:max-content;max-width:100%;';
            userControl.before(row);
            row.appendChild(userControl);
        }
        if (logoutControl.parentNode !== row) row.appendChild(logoutControl);
        const logoutButton = logoutControl.matches('button') ? logoutControl : logoutControl.querySelector('button');
        if (logoutButton) logoutButton.type = 'button'; // Не отправлять форму профиля при выходе.
        if (profileLogoutOrigin.display) {
            logoutControl.style.setProperty('display', profileLogoutOrigin.display, profileLogoutOrigin.displayPriority);
        } else {
            logoutControl.style.removeProperty('display');
        }
    }

    // =================================ПОИСК НИЖНЕГО КОНТЕЙНЕРА С КНОПКАМИ===========================
    const queuesMenuLinks = new WeakSet();
    function updateRequestsMenuLink() {
        const queuesPath = `/admin/requests?presetId=my-queues&pageSize=${REQUESTS_PAGE_SIZE}`;
        document.querySelectorAll('a.dpl-aside-link[href="/admin/requests"], a.dpl-aside-link[href="/admin/requests?presetId=my-queues"], a.dpl-aside-link[href="/admin/requests?presetId=my-queues&pageSize=100"]').forEach(link => {
            if (link.getAttribute('href') !== queuesPath) link.setAttribute('href', queuesPath);
            const label = [...link.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (label && label.textContent.trim() !== 'Черги') label.textContent = ' Черги ';
            if (!queuesMenuLinks.has(link)) {
                // Bypass Angular's original route while preserving native link navigation.
                link.addEventListener('click', event => event.stopImmediatePropagation(), true);
                queuesMenuLinks.add(link);
            }
        });
    }

    function findBottomActionContainer() {
        const containers = [...document.querySelectorAll('div.flex.flex-wrap.gap-2.mb-3, div.flex.gap-2')].filter(container => {
            if (container.querySelector('app-badge-link')) return false;
            const buttons = container.querySelectorAll('button, a[pbutton]');
            return [...buttons].some(btn => {
                const text = btn.textContent.trim();
                return text.includes('Фільтр') || text.includes('Фільтрувати') || text.includes('Додати') || text.includes('Редагувати') || btn.getAttribute('aria-label') === 'Інші дії' || btn.classList.contains('p-splitbutton-dropdown');
            });
        });
        return containers.length > 0 ? containers[containers.length - 1] : null;
    }

    // ====================================ЯРЛЫКИ КНОПОК====================================
    function createActionShortcuts(customContainer) {
        customContainer.querySelectorAll('.ovolya-shortcut-btn').forEach(el => el.remove());
        const container = findBottomActionContainer();
        if (!container) return;
        container.querySelectorAll('button, a[pbutton]').forEach(btn => {
            const text = btn.textContent.trim();
            let iconClass = '', title = '', actionType = '';

            if (text.includes('Фільтр') || text.includes('Фільтрувати')) { iconClass = 'ovolya-btn-filter'; title = 'Фільтрувати'; actionType = 'filter'; }
            else if (text.includes('Додати')) { iconClass = 'ovolya-btn-add'; title = 'Додати'; actionType = 'add'; }
            else if (text.includes('Редагувати')) { iconClass = 'ovolya-btn-edit'; title = 'Редагувати'; actionType = 'edit'; }
            else if (btn.getAttribute('aria-label') === 'Інші дії' || btn.classList.contains('p-splitbutton-dropdown')) { iconClass = 'ovolya-btn-more'; title = 'Інші дії'; actionType = 'more'; }
            else return;

            trackedSourceElements.push(btn); // Запоминаем оригинальную кнопку

            const shortcut = document.createElement('button');
            shortcut.className = `ovolya-shortcut-btn ovolya-btn-icon-mode ${iconClass}`;
            shortcut.title = title;
            shortcut.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();

                // Динамический поиск "живой" кнопки на случай, если Angular её только что перерисовал
                const liveContainer = findBottomActionContainer();
                if (liveContainer) {
                    const liveBtn = Array.from(liveContainer.querySelectorAll('button, a[pbutton]')).find(b => {
                        const t = b.textContent.trim();
                        if (actionType === 'filter') return t.includes('Фільтр') || t.includes('Фільтрувати');
                        if (actionType === 'add') return t.includes('Додати');
                        if (actionType === 'edit') return t.includes('Редагувати');
                        if (actionType === 'more') return b.getAttribute('aria-label') === 'Інші дії' || b.classList.contains('p-splitbutton-dropdown');
                        return false;
                    });
                    if (liveBtn) { liveBtn.click(); return; }
                }
                btn.click(); // Фолбек на старую
            });
            customContainer.appendChild(shortcut);
        });
    }

    // =================================ЯРЛЫКИ ОЧЕРЕДЕЙ===========================
    function createQueueShortcuts(customContainer) {
        customContainer.querySelectorAll('.ovolya-queue-shortcut').forEach(el => el.remove());
        const badgeLinks = document.querySelectorAll('app-badge-link');
        if (badgeLinks.length === 0) return;
        badgeLinks.forEach(badgeLink => {
            const anchor = badgeLink.querySelector('a');
            if (!anchor) return;
            let fullName = anchor.title || '';
            if (!fullName) {
                fullName = Array.from(anchor.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).join('').trim();
            }
            if (fullName === 'Мої заявки' || fullName === 'Мої черги') return;
            let shortName = QUEUE_MAP[fullName] || (fullName.length > 10 ? fullName.substring(0, 10) : fullName);

            trackedSourceElements.push(anchor); // Запоминаем оригинальную очередь

            const shortcut = document.createElement('a');
            shortcut.className = 'ovolya-queue-shortcut';
            shortcut.textContent = shortName;
            shortcut.title = fullName;
            shortcut.href = anchor.getAttribute('href') || '#';
            shortcut.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();

                // Динамический поиск
                const liveAnchors = Array.from(document.querySelectorAll('app-badge-link a'));
                const liveAnchor = liveAnchors.find(a => {
                     let n = a.title || Array.from(a.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).join('').trim();
                     return n === fullName;
                });
                if (liveAnchor) liveAnchor.click();
                else anchor.click();

                lastShortcutsSnapshot = '';
            });
            if (anchor.classList.contains('p-button-contrast')) shortcut.classList.add('active');
            customContainer.appendChild(shortcut);
        });
    }

    // ==================================ПЕРЕНОС КНОПОК И ОЧЕРЕДЕЙ==========================
    function relocateControlsAndQueues() {
        const sidebar = document.querySelector('aside, .sidebar, app-sidebar, .layout-sidebar');
        if (!sidebar) return;
        let customContainer = sidebar.querySelector('#ovolya-custom-sidebar-container');
        if (!customContainer) {
            customContainer = document.createElement('div');
            customContainer.id = 'ovolya-custom-sidebar-container';
            sidebar.appendChild(customContainer);
        }
        const queuesBlock = document.querySelector('div.flex.flex-wrap.gap-2.mb-3:has(app-badge-link)');
        if (queuesBlock && queuesBlock.style.display !== 'none') queuesBlock.style.display = 'none';

        // 1. Проверяем, не удалил ли Angular оригинальные кнопки из DOM
        if (trackedSourceElements.length > 0 && trackedSourceElements.some(el => !el.isConnected)) {
            lastShortcutsSnapshot = ''; // Принудительный сброс
        }

        // 2. Формируем снимок на основе ОРИГИНАЛЬНЫХ кнопок на странице, а не наших созданных ярлыков
        let currentSnapshot = '';
        document.querySelectorAll('app-badge-link a').forEach(a => {
            currentSnapshot += `Q:${a.textContent.trim()}:${a.classList.contains('p-button-contrast') ? '1' : '0'}|`;
        });
        const actionContainer = findBottomActionContainer();
        if (actionContainer) {
            actionContainer.querySelectorAll('button, a[pbutton]').forEach(btn => {
                currentSnapshot += `B:${btn.textContent.trim() || btn.getAttribute('aria-label') || ''}|`;
            });
        }

        if (currentSnapshot === lastShortcutsSnapshot && currentSnapshot !== '') return;

        trackedSourceElements = []; // Очищаем массив перед новым рендером
        createQueueShortcuts(customContainer);
        createActionShortcuts(customContainer);
        lastShortcutsSnapshot = currentSnapshot;
    }

    //=====================================ОПТИМИЗАЦИЯ СПИСКА ЗАЯВОК=======================
    function enhanceListPage() {
        document.querySelectorAll('.p-panel-header').forEach(header => {
            if (header.dataset.enhanced) return;
            const columns = Array.from(header.querySelectorAll('.request-column'));
            if (columns.length === 0) return;
            let ticketId = '', dateTime = '';
            const idElement = header.querySelector('.property-name');
            if (idElement && idElement.textContent.includes('Заявка #')) {
                const idMatch = idElement.textContent.match(/Заявка #(\d+)/);
                if (idMatch) ticketId = idMatch[1];
                const dateSpan = idElement.querySelector('app-datetime-property span');
                if (dateSpan) dateTime = dateSpan.textContent.trim();
            }
            const agentsCol = columns.find(col => col.querySelector('.property-name')?.textContent.includes('Агенти'));
            if (agentsCol && ticketId) {
                const contentDiv = agentsCol.querySelector('.request-column-content');
                if (contentDiv) {
                    const agentsListEl = contentDiv.querySelector('app-string-list-property');
                    let agentsText = agentsListEl ? agentsListEl.textContent.trim() : '';
                    if (agentsText === '-') agentsText = '';
                    const tooltipText = agentsText ? `Агенти: ${agentsText}` : 'Агенти не призначені';
                    Array.from(contentDiv.children).forEach(child => child.style.display = 'none');
                    const customSpan = document.createElement('span');
                    customSpan.className = 'ovolya-custom-agents';
                    customSpan.style.cssText = 'white-space: nowrap; cursor: help;';
                    customSpan.title = tooltipText;
                    customSpan.textContent = `${ticketId} • ${dateTime}`;
                    contentDiv.appendChild(customSpan);
                }
            }
            const statusCol = columns.find(col => col.querySelector('.property-name')?.textContent.includes('Статус'));
            const queueCol = columns.find(col => col.querySelector('.property-name')?.textContent.includes('Черга'));
            if (statusCol) statusCol.style.flexBasis = '11%';
            if (queueCol) queueCol.style.flexBasis = '7%';

            const titleLink = header.querySelector('a[href^="/admin/requests/"]');
            if (titleLink) {
                titleLink.style.display = 'inline-block';
                titleLink.style.maxWidth = '100%';
                titleLink.style.whiteSpace = 'nowrap';
                titleLink.style.overflow = 'hidden';
                titleLink.style.textOverflow = 'ellipsis';
                titleLink.title = titleLink.textContent.trim();
            }
            header.dataset.enhanced = 'true';
        });
    }

    // ===================================ЗАМЕНА ТЕКСТА СТАТУСА=========================
    function replaceStatusText() {
        if (typeof statusObserver !== 'undefined') statusObserver.disconnect();
        try {
            const target = 'Первинна обробка';
            const replacement = 'Потрогали';
            document.querySelectorAll('.status-badge, .p-badge, .request-column .property-value, .app-string-list-property').forEach(el => {
                if (el.textContent.includes(target)) {
                    el.textContent = el.textContent.replace(target, replacement);
                }
            });
        } finally {
            if (typeof statusObserver !== 'undefined') statusObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    // =========================НАСТРОЙКИ, ФИЛЬТРЫ И ЗВУК===================================
    // Механизм языков Notifications APC 204: резерв, кеш, проверка JSON и загрузка.
    const LANGUAGE_KEY = 'sd_lang';
    let currentLang = localStorage.getItem(LANGUAGE_KEY) || 'uk';
    const fallbackI18n = {
        "uk": {
            "langTitle": "Мова інтерфейсу / Язык интерфейса",
            "filterType": "Тип фільтра",
            "filterTitle": "Назва",
            "filterDepartment": "Відділ",
            "filterId": "ID",
            "filterValue": "Значення фільтра",
            "valuePlaceholder": "Значення…",
            "add": "Додати",
            "enabled": "Увімк.",
            "type": "Тип",
            "value": "Значення",
            "action": "Дія",
            "emptyFilters": "Список порожній",
            "filterLabel": "Фільтр {0}: {1}",
            "disableFilter": "Вимкнути фільтр",
            "enableFilter": "Увімкнути фільтр",
            "remove": "Видалити",
            "invalidId": "ID заявки має містити лише цифри",
            "duplicateFilter": "Такий фільтр уже існує",
            "permissionGranted": "Дозволено ✓",
            "permissionDenied": "Заблоковано вручну ⚠️",
            "permissionUnsupported": "Не підтримується браузером ❌",
            "permissionDefault": "Дозвіл не запитано ❌",
            "stdSoundTitle": "Стандартна мелодія (Денний режим)",
            "stdSoundDesc": "TTS \"Заявки\" + ця мелодія.",
            "afkSoundTitle": "AFK Мелодія (Нічний режим)",
            "afkSoundDesc": "TTS \"Заявки\" + ця мелодія (якщо увімкнено 🌙).",
            "file": "Файл",
            "fileLoaded": "Завантажено ✓",
            "noFile": "Файл не вибрано",
            "test": "Тест",
            "soundNote": "Файли до 2 МБ. Звук зупиняється кліком по сторінці.",
            "fileTooLarge": "Файл перевищує 2 МБ!",
            "notificationsTitle": "Системні сповіщення браузера",
            "notificationsDesc": "Сповіщення від ОС або браузера про нову заявку.",
            "requestPermission": "Запитати",
            "permissionHelp": "Сповіщення заблоковано вручну в браузері.\nВідкрий налаштування сайту (значок замка або інформації біля адреси) → Сповіщення → Дозволити, потім онови сторінку.",
            "monitorSettings": "Налаштування моніторингу",
            "pin": "Зробити цю вкладку вкладкою моніторингу",
            "monitoring": "моніторинг",
            "waiting": "очікування",
            "paused": "Пауза",
            "countdown": "Відлік",
            "timerStatus": "Таймер: {0} | {1} | {2}",
            "newCount": "Нових: {0}",
            "nightMode": "Ніч (AFK). Увімкнути денний режим",
            "dayMode": "День (Стандарт). Увімкнути нічний режим",
            "debugTooltip": "Наведи курсор, щоб показати кнопки. Натисни на очі, щоб перемкнути денний/нічний режим.",
            "filters": "Фільтри",
            "soundSettings": "Налаштування звуку",
            "closeMenu": "Закрити меню ({0})",
            "newTickets": "Нових заявок: {0}",
            "undefinedCriticality": "Невизначена",
            "notificationBody": "Нових заявок: {0}\nКритичність: {1}",
            "newTicketsTitle": "НОВІ ЗАЯВКИ",
            "ttsTickets": "заявки",
            "ttsCriticalTickets": "заявки перша критичність"
        },
        "ru": {
            "langTitle": "Мова інтерфейсу / Язык интерфейса",
            "filterType": "Тип фильтра",
            "filterTitle": "Название",
            "filterDepartment": "Отдел",
            "filterId": "ID",
            "filterValue": "Значение фильтра",
            "valuePlaceholder": "Значение…",
            "add": "Добавить",
            "enabled": "Вкл.",
            "type": "Тип",
            "value": "Значение",
            "action": "Действие",
            "emptyFilters": "Список пуст",
            "filterLabel": "Фильтр {0}: {1}",
            "disableFilter": "Выключить фильтр",
            "enableFilter": "Включить фильтр",
            "remove": "Удалить",
            "invalidId": "ID заявки должен содержать только цифры",
            "duplicateFilter": "Такой фильтр уже существует",
            "permissionGranted": "Разрешено ✓",
            "permissionDenied": "Заблокировано вручную ⚠️",
            "permissionUnsupported": "Не поддерживается браузером ❌",
            "permissionDefault": "Не запрошено ❌",
            "stdSoundTitle": "Стандартная мелодия (Дневной режим)",
            "stdSoundDesc": "TTS \"Заявки\" + эта мелодия.",
            "afkSoundTitle": "AFK Мелодия (Ночной режим)",
            "afkSoundDesc": "TTS \"Заявки\" + эта мелодия (если включено 🌙).",
            "file": "Файл",
            "fileLoaded": "Загружено ✓",
            "noFile": "Файл не выбран",
            "test": "Тест",
            "soundNote": "Файлы до 2 МБ. Звук останавливается кликом по странице.",
            "fileTooLarge": "Файл превышает 2 МБ!",
            "notificationsTitle": "Системные уведомления браузера",
            "notificationsDesc": "Уведомление от ОС или браузера о новой заявке.",
            "requestPermission": "Запросить",
            "permissionHelp": "Уведомления заблокированы вручную в браузере.\nОткрой настройки сайта (значок замка или информации слева от адреса) → Уведомления → Разрешить, затем обнови страницу.",
            "monitorSettings": "Настройки мониторинга",
            "pin": "Сделать эту вкладку вкладкой мониторинга",
            "monitoring": "мониторинг",
            "waiting": "ожидание",
            "paused": "Пауза",
            "countdown": "Отсчёт",
            "timerStatus": "Таймер: {0} | {1} | {2}",
            "newCount": "Новых: {0}",
            "nightMode": "Ночь (AFK). Включить дневной режим",
            "dayMode": "День (Стандарт). Включить ночной режим",
            "debugTooltip": "Наведите курсор, чтобы показать кнопки. Нажмите на глаза, чтобы переключить дневной/ночной режим.",
            "filters": "Фильтры",
            "soundSettings": "Настройки звука",
            "closeMenu": "Закрыть меню ({0})",
            "newTickets": "Новых заявок: {0}",
            "undefinedCriticality": "Не определена",
            "notificationBody": "Новых заявок: {0}\nКритичность: {1}",
            "newTicketsTitle": "НОВЫЕ ЗАЯВКИ",
            "ttsTickets": "заявки",
            "ttsCriticalTickets": "заявки первая критичность"
        }
    };
    const LANGUAGE_BASE_URL = 'https://raw.githubusercontent.com/Ovolsan/O-sd.bitech/main/languages/';
    const LANGUAGE_TIMEOUT_MS = 5000;
    const LANGUAGE_MAX_BYTES = 128 * 1024;
    const languageRequests = new Map();
    const loadedLanguages = new Set();
    const i18n = { uk: { ...fallbackI18n.uk }, ru: { ...fallbackI18n.ru } };
    if (!Object.hasOwn(i18n, currentLang)) currentLang = 'uk';

    function validateLanguage(pack, lang) {
        if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('Invalid language JSON');
        const translations = {};
        for (const key of Object.keys(fallbackI18n[lang])) {
            if (!Object.hasOwn(pack, key)) continue;
            const value = pack[key];
            if (typeof value !== 'string' || !value.trim() || value.length > 10000) {
                throw new Error('Invalid translation: ' + key);
            }
            translations[key] = value;
        }
        if (!Object.keys(translations).length) throw new Error('Empty language JSON');
        return translations;
    }

    // Сохранённый перевод доступен сразу, даже без подключения к GitHub.
    for (const lang of Object.keys(i18n)) {
        try {
            const cached = localStorage.getItem('sd_i18n_v1_' + lang);
            if (cached && cached.length <= LANGUAGE_MAX_BYTES) {
                i18n[lang] = { ...fallbackI18n[lang], ...validateLanguage(JSON.parse(cached), lang) };
            }
        } catch (error) {
            console.warn('[sd.bitech] Повреждён кеш перевода:', lang, error);
        }
    }

    function requestLanguage(url) {
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                let handle;
                let settled = false;
                const complete = (error, text) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    if (error) reject(error);
                    else resolve(text);
                };
                // Собственный таймер нужен и для режима fetch внутри менеджера.
                const timeout = setTimeout(() => {
                    complete(new Error('Language request timeout'));
                    try { handle?.abort(); } catch (error) { /* Ответ уже отменён. */ }
                }, LANGUAGE_TIMEOUT_MS);
                try {
                    handle = GM_xmlhttpRequest({
                        method: 'GET', url, anonymous: true, timeout: LANGUAGE_TIMEOUT_MS,
                        headers: { Accept: 'application/json' },
                        onload(response) {
                            const text = response.responseText;
                            if (response.status !== 200 || typeof text !== 'string' || text.length > LANGUAGE_MAX_BYTES) {
                                complete(new Error('Language HTTP response: ' + response.status));
                            } else complete(null, text);
                        },
                        onerror: () => complete(new Error('Language network error')),
                        ontimeout: () => complete(new Error('Language request timeout')),
                        onabort: () => complete(new Error('Language request aborted'))
                    });
                } catch (error) {
                    complete(error);
                }
            });
        }
        // Резерв для менеджеров userscript без GM_xmlhttpRequest.
        return (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), LANGUAGE_TIMEOUT_MS);
            try {
                const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
                if (!response.ok) throw new Error('Language HTTP response: ' + response.status);
                const text = await response.text();
                if (text.length > LANGUAGE_MAX_BYTES) throw new Error('Language file too large');
                return text;
            } finally {
                clearTimeout(timeout);
            }
        })();
    }

    function loadLanguage(lang) {
        if (!Object.hasOwn(fallbackI18n, lang) || loadedLanguages.has(lang)) return Promise.resolve();
        if (languageRequests.has(lang)) return languageRequests.get(lang);
        const request = (async () => {
            try {
                const text = await requestLanguage(LANGUAGE_BASE_URL + lang + '.json?_=' + Date.now());
                const translations = validateLanguage(JSON.parse(text), lang);
                i18n[lang] = { ...fallbackI18n[lang], ...translations };
                loadedLanguages.add(lang);
                try {
                    localStorage.setItem('sd_i18n_v1_' + lang, JSON.stringify(translations));
                } catch (error) {
                    console.warn('[sd.bitech] Перевод загружен, но не сохранён:', error);
                }
                // Запоздавший ответ другого языка не меняет выбранный язык.
                if (currentLang === lang) {
                    refreshInterfaceLanguage();
                }
            } catch (error) {
                console.warn('[sd.bitech] Используется резервный перевод:', lang, error);
            } finally {
                languageRequests.delete(lang);
            }
        })();
        languageRequests.set(lang, request);
        return request;
    }

    function t(key, ...args) {
        const value = i18n[currentLang]?.[key] || fallbackI18n.uk[key] || key;
        return value.replace(/\{(\d+)\}/g, (placeholder, index) =>
            args[index] === undefined ? placeholder : String(args[index]));
    }

    function htmlT(key, ...args) { return escapePanelText(t(key, ...args)); }

    function refreshInterfaceLanguage() {
        const panel = monitorDebugDiv?.querySelector('#ovolya-settings-panel');
        const focused = panel?.contains(document.activeElement) ? document.activeElement : null;
        const focusedId = focused?.id;
        const focusedFilter = focused?.matches('.ovolya-filter-switch') ? focused.dataset.idx : null;
        const valueInput = panel?.querySelector('#ovolya-filter-value');
        const draft = valueInput ? {
            type: panel.querySelector('#ovolya-filter-type').value,
            value: valueInput.value,
            start: valueInput.selectionStart,
            end: valueInput.selectionEnd
        } : null;
        lastRenderedTab = null;
        monitorUpdateDebug();
        if (draft && panel.querySelector('#ovolya-filter-value')) {
            panel.querySelector('#ovolya-filter-type').value = draft.type;
            const input = panel.querySelector('#ovolya-filter-value');
            input.value = draft.value;
            input.setSelectionRange(draft.start, draft.end);
        }
        const nextFocus = focusedId ? document.getElementById(focusedId)
            : focusedFilter !== null ? panel?.querySelector(`.ovolya-filter-switch[data-idx="${focusedFilter}"]`) : null;
        if (nextFocus) nextFocus.focus({ preventScroll: true });
        if (monitorPendingTickets.size) monitorShowNotification([...monitorPendingTickets.values()]);
    }

    function setInterfaceLanguage(lang) {
        if (!Object.hasOwn(fallbackI18n, lang)) return;
        currentLang = lang;
        localStorage.setItem(LANGUAGE_KEY, lang);
        refreshInterfaceLanguage();
        void loadLanguage(lang);
    }

    function requestFilterTypeName(type) {
        const key = { title: 'filterTitle', department: 'filterDepartment', id: 'filterId' }[type];
        return key ? t(key) : type;
    }

    let muteRules = JSON.parse(localStorage.getItem('sd_mute_rules') || '[]');
    if (muteRules.length > 0 && typeof muteRules[0] === 'string') {
        muteRules = muteRules.map(text => ({ type: 'title', text }));
        saveMuteRules();
    }
    let standardAudioData = localStorage.getItem('sd_snd_std') || null;
    let afkAudioData = localStorage.getItem('sd_snd_afk') || null;
    let isNightMode = localStorage.getItem('sd_night_mode') === 'true';
    let currentAudio = null;
    let currentUtterance = null;
    let audioGeneration = 0;
    let isMenuOpen = false;
    let activeTab = null;
    let lastRenderedTab = null;
    const REQUEST_FILTERS_KEY = 'sd_request_filter_rules';
    let requestFilterRules = JSON.parse(localStorage.getItem(REQUEST_FILTERS_KEY) || '[]');

    function saveRequestFilterRules() { localStorage.setItem(REQUEST_FILTERS_KEY, JSON.stringify(requestFilterRules)); }
    function saveMuteRules() { localStorage.setItem('sd_mute_rules', JSON.stringify(muteRules)); }

    function stopCurrentAudio() {
        ++audioGeneration;
        if (currentUtterance) {
            currentUtterance.onend = null;
            currentUtterance.onerror = null;
            currentUtterance = null;
        }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    }

    function monitorDismissAlerts() {
        stopCurrentAudio();
        ++monitorNotificationGeneration;
        document.querySelector('#ovolya-new-request-notification')?.remove();
        monitorPendingTickets.clear();
        monitorNotificationCount = 0;
        monitorStopTitleBlink();
        if (monitorBrowserNotification) {
            try { monitorBrowserNotification.close(); } catch (e) { }
            monitorBrowserNotification = null;
        }
        monitorUpdateDebug();
    }

    // глобальный сброс
    document.addEventListener('click', (e) => {
        if (e.isTrusted) monitorDismissAlerts();
    }, true);

    function playAlertSound(hasFirstCriticality = false, forceType = null) {
        stopCurrentAudio();
        const generation = audioGeneration;
        const text = t(hasFirstCriticality ? 'ttsCriticalTickets' : 'ttsTickets');
        let melodyStarted = false;
        const playMelody = () => {
            if (generation !== audioGeneration || melodyStarted) return;
            melodyStarted = true;
            currentUtterance = null;
            let audioData = null;
            if (forceType === 'std') audioData = standardAudioData;
            else if (forceType === 'afk') audioData = afkAudioData;
            else audioData = isNightMode ? afkAudioData : standardAudioData;

            if (!audioData) return;
            try {
                const audio = new Audio(audioData);
                currentAudio = audio;
                audio.play().catch(e => console.log('[sd.bitech] Audio playback failed:', e));
                audio.onended = () => { if (currentAudio === audio) currentAudio = null; };
            } catch (e) { console.log('[sd.bitech] Audio error:', e); }
        };
        try {
            const utterance = new SpeechSynthesisUtterance(text);
            currentUtterance = utterance;
            utterance.lang = currentLang === 'uk' ? 'uk-UA' : 'ru-RU'; utterance.rate = 0.8; utterance.volume = 1;
            utterance.onend = playMelody;
            utterance.onerror = playMelody;
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.log('[sd.bitech] TTS error:', e);
            playMelody();
        }
    }

    // ======================Получение заявок======================================
    function getCurrentTickets() {
        const tickets = new Map();
        document.querySelectorAll('.request-column-content a[href^="/admin/requests/"]').forEach(link => {
            const href = link.getAttribute('href');
            const match = href.match(/\/admin\/requests\/(\d+)/);
            if (!match) return;
            const id = match[1];
            const title = link.getAttribute('title') || link.textContent.trim() || '';
            const row = link.closest('tr');
            let criticality = '';
            let department = '';
            if (row) {
                row.querySelectorAll('.col-6.md\\:col-12').forEach(col => {
                    const propertyName = col.querySelector('.property-name');
                    const value = col.querySelector('app-string-property span');
                    if (!propertyName || !value) return;
                    const name = propertyName.textContent.trim();
                    const text = value.textContent.trim();
                    if (name === 'Критичність') criticality = text;
                    if (name === 'Відділ') department = text;
                });
            }
            if (!tickets.has(id)) {
                tickets.set(id, { id, title, department, criticality });
            }
        });
        return Array.from(tickets.values());
    }

    // ======================Проверка заявки на фильтры======================================
    function isRequestFiltered(ticket) {
        for (const rule of requestFilterRules) {
            if (!rule || rule.enabled === false || !rule.type || !rule.text) continue;
            const ruleText = String(rule.text).trim();
            if (!ruleText) continue;
            if (rule.type === 'title') {
                if (String(ticket.title || '').toLowerCase().includes(ruleText.toLowerCase())) {
                    return true;
                }
            }
            if (rule.type === 'department') {
                if (String(ticket.department || '').toLowerCase().includes(ruleText.toLowerCase())) {
                    return true;
                }
            }
            if (rule.type === 'id') {
                if (String(ticket.id) === ruleText) {
                    return true;
                }
            }
        }
        return false;
    }

    // =================================Мониторинг заявок и таймер==========================
    const TARGET_URL = `https://sd.bitech.com.ua/admin/requests?presetId=my-queues&pageSize=${REQUESTS_PAGE_SIZE}`;
    const MONITOR_LOCK_KEY = 'ovolya_sd_new_requests_monitor_lock';
    const MONITOR_KNOWN_IDS_KEY = 'ovolya_sd_new_requests_known_ids';
    const MONITOR_TIMER_MAX_SEC = 10 * 60;
    const MONITOR_ADD_TIME_ON_BLUR_SEC = 2 * 20;
    const MONITOR_SESSION_KEY = 'ovolya_sd_monitor_resume';
    let monitorResume = null;
    try {
        monitorResume = JSON.parse(sessionStorage.getItem(MONITOR_SESSION_KEY) || 'null');
        sessionStorage.removeItem(MONITOR_SESSION_KEY);
    } catch (e) { }
    const monitorToken = monitorResume?.token || `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    let monitorIsOwner = false;
    let monitorTimeLeft = MONITOR_TIMER_MAX_SEC;
    let monitorIsPaused = false;
    let monitorLastTick = Date.now();
    let monitorHadClicks = false;

    // Переменные для пушей и уведомлений
    let monitorNotificationCount = 0;
    let monitorPendingTickets = new Map();
    let monitorTitleBlinking = false;
    let monitorOriginalTitle = document.title;
    let monitorBrowserNotification = null;
    let monitorNotificationGeneration = 0;

    let monitorDebugDiv = null;
    let monitorInitialized = false;

    // Цільова сторінка: /admin/requests з presetId=my-queues (дозволені додаткові query-параметри, напр. &queue=12)
    function isMonitorTargetPage() {
        try {
            const u = new URL(window.location.href);
            return u.pathname === '/admin/requests' && u.searchParams.get('presetId') === 'my-queues';
        } catch (e) {
            return false;
        }
    }

    function goToMonitorTargetPage() {
        if (window.location.href === TARGET_URL) {
            location.reload();
        } else {
            location.href = TARGET_URL;
        }
    }

    function monitorReadJSON(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
    function monitorWriteJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { } }
    function monitorReadLock() { try { const raw = localStorage.getItem(MONITOR_LOCK_KEY); if (!raw) return null; const lock = JSON.parse(raw); return (lock && lock.token && lock.expiresAt) ? lock : null; } catch (e) { return null; } }
    function monitorWriteLock() { try { localStorage.setItem(MONITOR_LOCK_KEY, JSON.stringify({ token: monitorToken, expiresAt: Date.now() + 8000 })); return true; } catch (e) { return false; } }

    function monitorAcquireLock() {
        const existing = monitorReadLock();
        // The owner tab can resume its timer after navigation to any page.
        if (!isMonitorTargetPage() && existing?.token !== monitorToken) return false;
        if (existing && existing.token !== monitorToken && existing.expiresAt > Date.now()) { monitorIsOwner = false; return false; }
        monitorWriteLock();
        monitorIsOwner = (monitorReadLock()?.token === monitorToken);
        return monitorIsOwner;
    }

    // Продовжуємо тримати lock навіть якщо користувач тимчасово пішов на іншу сторінку (напр. /create)
    function monitorRenewLock() {
        if (!monitorIsOwner) return;
        const lock = monitorReadLock();
        if (lock && lock.token !== monitorToken && lock.expiresAt > Date.now()) {
            monitorIsOwner = false;
            clearTimeout(monitorIdleTimeout);
            return;
        }
        monitorWriteLock();
    }
    function monitorReleaseLock() { try { if (monitorReadLock()?.token === monitorToken) localStorage.removeItem(MONITOR_LOCK_KEY); } catch (e) { } monitorIsOwner = false; }
    function monitorGetKnownIds() { const ids = monitorReadJSON(MONITOR_KNOWN_IDS_KEY, []); return Array.isArray(ids) ? ids.map(String) : []; }
    function monitorSaveKnownIds(ids) { const unique = [...new Set(ids.map(String))]; monitorWriteJSON(MONITOR_KNOWN_IDS_KEY, unique.slice(Math.max(0, unique.length - 1000))); }

    let monitorTicketsChecked = false;
    let monitorTicketsObserver = null;

    function monitorWaitForTickets() {
        if (monitorTicketsChecked || monitorTicketsObserver || !monitorIsOwner || !isMonitorTargetPage()) return;
        const selector = '.request-column-content a[href^="/admin/requests/"]';
        monitorTicketsObserver = new MutationObserver(records => {
            // Ignore timer/UI changes; only newly rendered ticket links matter.
            const hasTicketLinks = records.some(record => [...record.addedNodes].some(node =>
                node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))
            ));
            if (hasTicketLinks) monitorCheckForNewTickets();
        });
        monitorTicketsObserver.observe(document.body, { childList: true, subtree: true });
        // The table may already be rendered when monitoring starts.
        monitorCheckForNewTickets();
    }

    function monitorCheckForNewTickets() {
        if (monitorTicketsChecked) return;
        if (!isMonitorTargetPage()) return;
        if (!monitorIsOwner) return;
        if (monitorReadLock()?.token !== monitorToken) return;

        const currentTickets = getCurrentTickets();
        if (currentTickets.length === 0) return;

        // Compare IDs only once per document load, then stop watching the DOM.
        monitorTicketsChecked = true;
        monitorTicketsObserver?.disconnect();
        monitorTicketsObserver = null;

        const knownIds = monitorGetKnownIds();
        if (knownIds.length === 0) {
            monitorSaveKnownIds(currentTickets.map(t => t.id));
            return;
        }

        const knownSet = new Set(knownIds);
        const newTickets = currentTickets.filter(t => !knownSet.has(t.id));
        if (newTickets.length === 0) return;

        const unmutedTickets = newTickets.filter(ticket => !isRequestFiltered(ticket));
        monitorSaveKnownIds([...knownIds, ...newTickets.map(t => t.id)]);

        if (unmutedTickets.length > 0) {
            monitorNotifyNewTickets(unmutedTickets);
        }
    }

    // УВЕДОМЛЕНИЯ
    function monitorNotifyNewTickets(newTickets) {
        if (!Array.isArray(newTickets) || !newTickets.length) return;

        for (const ticket of newTickets) {
            monitorPendingTickets.set(String(ticket.id), ticket);
        }

        const tickets = [...monitorPendingTickets.values()];
        monitorNotificationCount = tickets.length;
        const hasFirstCriticality = tickets.some(t => /^1\s*\.\s*ЗК-1$/i.test(t.criticality?.trim() || ''));
        playAlertSound(hasFirstCriticality);
        monitorShowNotification(tickets);
        monitorStartTitleBlink();

        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        const criticalityCounts = new Map();
        for (const ticket of tickets) {
            const c = ticket.criticality?.trim() || t('undefinedCriticality');
            criticalityCounts.set(c, (criticalityCounts.get(c) || 0) + 1);
        }
        const criticalityText = [...criticalityCounts.entries()]
            .map(([name, count]) => count > 1 ? `${name} (${count})` : name)
            .join(', ');
        const body = t('notificationBody', tickets.length, criticalityText);
        const generation = ++monitorNotificationGeneration;

        const showBrowserNotification = () => {
            if (generation !== monitorNotificationGeneration) return;

            try {
                const notification = new Notification('sd.bitech', {
                    body,
                    icon: 'https://www.google.com/s2/favicons?sz=64&domain=bitech.com.ua',
                    tag: `sd-bitech-${generation}`,
                    requireInteraction: true
                });
                monitorBrowserNotification = notification;
                notification.onclick = () => {
                    window.focus();
                    notification.close();
                    if (monitorBrowserNotification === notification) {
                        monitorBrowserNotification = null;
                    }
                };

                notification.onclose = () => {
                    if (monitorBrowserNotification === notification) {
                        monitorBrowserNotification = null;
                    }
                };
            } catch (e) {
                console.log('[sd.bitech] Notification error:', e);
            }
        };
        if (monitorBrowserNotification) {
            const oldNotification = monitorBrowserNotification;
            monitorBrowserNotification = null;
            try { oldNotification.close(); } catch (e) {}
            setTimeout(showBrowserNotification, 150);
        } else {
            showBrowserNotification();
        }
    }

    function monitorShowNotification(tickets) {
        const old = document.querySelector('#ovolya-new-request-notification');
        if (old) old.remove();

        const notification = document.createElement('div');
        notification.id = 'ovolya-new-request-notification';
        notification.style.cssText = 'position:fixed;top:15px;right:15px;z-index:1000000;background:#26282f;color:#e8e8e8;border:1px solid #ffaa00;padding:12px 16px;min-width:230px;max-width:360px;box-shadow:0 4px 18px rgba(0,0,0,.45);font-family:Arial,sans-serif;font-size:14px;cursor:pointer;';

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;margin-bottom:7px;color:#ffaa00;';
        title.textContent = `🟠 ${t('newTickets', tickets.length)}`;
        notification.append(title);

        document.body.appendChild(notification);
    }

    function monitorStartTitleBlink() {
        if (!monitorTitleBlinking) {
            monitorOriginalTitle = document.title;
            monitorTitleBlinking = true;
        }
    }

    function monitorStopTitleBlink() {
        monitorTitleBlinking = false;
        if (Object.values(i18n).some(pack => document.title === `🟠 ${pack.newTicketsTitle}`)) {
            document.title = monitorOriginalTitle;
        }
    }

    // =====================DEBUG / НАСТРОЙКИ UI =======================================
    function escapePanelText(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function renderPanelContent(panel) {
        panel.innerHTML = '';
        const btnActionStyle = 'background:#35393b; color:#e8e6e3; border:0; padding:3px 6px; cursor:pointer; font:inherit; font-size:12px; line-height:1.2; white-space:nowrap; border-radius:0; margin:0;';

        if (activeTab === 'rules') {
            panel.innerHTML = `
        <div class="ovolya-filter-form">
            <select id="ovolya-filter-type" aria-label="${htmlT('filterType')}">
                <option value="title">${htmlT('filterTitle')}</option>
                <option value="department">${htmlT('filterDepartment')}</option>
                <option value="id">${htmlT('filterId')}</option>
            </select>
            <input id="ovolya-filter-value" placeholder="${htmlT('valuePlaceholder')}" aria-label="${htmlT('filterValue')}">
            <button type="button" id="ovolya-add-filter" style="${btnActionStyle} background:#1e3a5f;">${htmlT('add')}</button>
        </div>
        <table class="ovolya-filter-table">
            <thead><tr>
                <th scope="col">${htmlT('enabled')}</th><th scope="col">${htmlT('type')}</th>
                <th scope="col">${htmlT('value')}</th><th scope="col">${htmlT('action')}</th>
            </tr></thead><tbody>
            ${requestFilterRules.length === 0 ? `<tr><td colspan="4" class="ovolya-empty-filters">${htmlT('emptyFilters')}</td></tr>` : ''}
            ${requestFilterRules.map((rule, idx) => `
                <tr data-enabled="${rule.enabled !== false}">
                    <td class="ovolya-filter-state">
                        <button type="button" class="ovolya-filter-switch" role="switch" data-idx="${idx}"
                            aria-checked="${rule.enabled !== false}"
                            aria-label="${htmlT('filterLabel', requestFilterTypeName(rule.type), rule.text)}"
                            title="${htmlT(rule.enabled !== false ? 'disableFilter' : 'enableFilter')}">
                            <span aria-hidden="true"></span>
                        </button>
                    </td>
                    <td class="ovolya-filter-type">${escapePanelText(requestFilterTypeName(rule.type))}</td>
                    <td class="ovolya-filter-text">${escapePanelText(rule.text)}</td>
                    <td class="ovolya-filter-action">
                        <button type="button" class="ovolya-del-filter" data-idx="${idx}" style="${btnActionStyle} background:#522;">${htmlT('remove')}</button>
                    </td>
                </tr>
            `).join('')}
        </tbody></table>
    `;

            panel.querySelector('#ovolya-add-filter').onclick = () => {
                const type = panel.querySelector('#ovolya-filter-type').value;
                const text = panel.querySelector('#ovolya-filter-value').value.trim();
                if (!text) return;

                if (type === 'id' && !/^\d+$/.test(text)) {
                    alert(t('invalidId'));
                    return;
                }

                if (requestFilterRules.some(r => r.type === type && r.text.toLowerCase() === text.toLowerCase())) {
                    alert(t('duplicateFilter'));
                    return;
                }

                requestFilterRules.push({ type, text, enabled: true });
                saveRequestFilterRules();
                lastRenderedTab = null;
                monitorUpdateDebug();
                hideBlacklistedTickets();
            };

            panel.querySelectorAll('.ovolya-filter-switch').forEach(button => {
                button.onclick = () => {
                    const rule = requestFilterRules[Number(button.dataset.idx)];
                    rule.enabled = rule.enabled === false;
                    saveRequestFilterRules();
                    button.setAttribute('aria-checked', String(rule.enabled));
                    button.title = t(rule.enabled ? 'disableFilter' : 'enableFilter');
                    button.closest('tr').dataset.enabled = String(rule.enabled);
                    hideBlacklistedTickets();
                };
            });

            panel.querySelectorAll('.ovolya-del-filter').forEach(btn => {
                btn.onclick = () => {
                    requestFilterRules.splice(parseInt(btn.dataset.idx), 1);
                    saveRequestFilterRules();
                    lastRenderedTab = null;
                    monitorUpdateDebug();
                    hideBlacklistedTickets();
                };
            });
        } else if (activeTab === 'settings') {
            const notifPermission = ('Notification' in window) ? Notification.permission : 'unsupported';
            const notifStatusText = notifPermission === 'granted' ? t('permissionGranted')
                : notifPermission === 'denied' ? t('permissionDenied')
                : notifPermission === 'unsupported' ? t('permissionUnsupported')
                : t('permissionDefault');
            panel.innerHTML = `
                <div class="ovolya-settings-content">
                <p class="ovolya-monitor-status"></p>
                <section class="ovolya-setting-section">
                    <h4>${htmlT('langTitle')}</h4>
                    <div class="ovolya-setting-actions">
                        <button type="button" id="ovolya-lang-uk" lang="uk" aria-pressed="${currentLang === 'uk'}" style="${btnActionStyle} background:${currentLang === 'uk' ? '#1e3a60' : '#35393b'};">Українська <small>UA</small></button>
                        <button type="button" id="ovolya-lang-ru" lang="ru" aria-pressed="${currentLang === 'ru'}" style="${btnActionStyle} background:${currentLang === 'ru' ? '#1e3a60' : '#35393b'};">Русский <small>RU</small></button>
                    </div>
                </section>
                <section class="ovolya-setting-section">
                    <h4>${htmlT('stdSoundTitle')}</h4>
                    <p>${htmlT('stdSoundDesc')}</p>
                    <div class="ovolya-setting-actions">
                        <input type="file" id="file_std" accept="audio/*" style="display:none;">
                        <button type="button" id="btn_std" style="${btnActionStyle} background:#35393b;">${htmlT('file')}</button>
                        <span style="color:#9d9588; font-size:11px; flex-grow:1;">${htmlT(standardAudioData ? 'fileLoaded' : 'noFile')}</span>
                        <button type="button" id="test_std" style="${btnActionStyle}">${htmlT('test')}</button>
                    </div>
                </section>
                <section class="ovolya-setting-section">
                    <h4>${htmlT('afkSoundTitle')}</h4>
                    <p>${htmlT('afkSoundDesc')}</p>
                    <div class="ovolya-setting-actions">
                        <input type="file" id="file_afk" accept="audio/*" style="display:none;">
                        <button type="button" id="btn_afk" style="${btnActionStyle} background:#35393b;">${htmlT('file')}</button>
                        <span style="color:#9d9588; font-size:11px; flex-grow:1;">${htmlT(afkAudioData ? 'fileLoaded' : 'noFile')}</span>
                        <button type="button" id="test_afk" style="${btnActionStyle}">${htmlT('test')}</button>
                    </div>
                </section>
                <p class="ovolya-sound-note">${htmlT('soundNote')}</p>
                <section class="ovolya-setting-section">
                    <h4>${htmlT('notificationsTitle')}</h4>
                    <p>${htmlT('notificationsDesc')}</p>
                    <div class="ovolya-setting-actions">
                        <span id="notif_status" style="color:#9d9588; font-size:11px; flex-grow:1;">${escapePanelText(notifStatusText)}</span>
                        <button type="button" id="btn_notif_request" style="${btnActionStyle}">${htmlT('requestPermission')}</button>
                    </div>
                </section></div>
            `;
            panel.querySelector('#ovolya-lang-uk').onclick = () => setInterfaceLanguage('uk');
            panel.querySelector('#ovolya-lang-ru').onclick = () => setInterfaceLanguage('ru');
            const handleFile = (inputObj, storageKey, varName) => {
                if (inputObj.files.length === 0) return;
                const file = inputObj.files[0];
                if (file.size > 2.5 * 1024 * 1024) { alert(t('fileTooLarge')); return; }
                const reader = new FileReader();
                reader.onload = (e) => {
                    localStorage.setItem(storageKey, e.target.result);
                    if (varName === 'std') standardAudioData = e.target.result;
                    if (varName === 'afk') afkAudioData = e.target.result;
                    lastRenderedTab = null;
                    monitorUpdateDebug();
                };
                reader.readAsDataURL(file);
            };
            panel.querySelector(`#btn_std`).onclick = () => panel.querySelector(`#file_std`).click();
            panel.querySelector(`#file_std`).onchange = (e) => handleFile(e.target, 'sd_snd_std', 'std');
            panel.querySelector(`#test_std`).onclick = () => playAlertSound(false, 'std');
            panel.querySelector(`#btn_afk`).onclick = () => panel.querySelector(`#file_afk`).click();
            panel.querySelector(`#file_afk`).onchange = (e) => handleFile(e.target, 'sd_snd_afk', 'afk');
            panel.querySelector(`#test_afk`).onclick = () => playAlertSound(false, 'afk');
            panel.querySelector(`#btn_notif_request`).onclick = () => {
                if (!('Notification' in window)) return;
                if (Notification.permission === 'denied') {
                    alert(t('permissionHelp'));
                    return;
                }
                Notification.requestPermission().then(() => {
                    lastRenderedTab = null;
                    monitorUpdateDebug();
                });
            };
        }
    }

    const monitorMenuIcons = {
        rules: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v6l-4 2v-8Z"/></svg>',
        settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-.7 3-2 .9-2.7-.9-2 3.5 2.1 2v2l-2.1 2 2 3.5 2.7-.9 2 .9L9 22h4l.7-3 2-.9 2.7.9 2-3.5-2.1-2v-2l2.1-2-2-3.5-2.7.9-2-.9L13 3Z" transform="translate(1 -.5) scale(.95)"/><circle cx="12" cy="12" r="3"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
        sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/></svg>',
        moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14a8.7 8.7 0 0 1-10-10A8.7 8.7 0 1 0 20 14Z"/></svg>',
        pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 3 8 2-2 6 3 4-6-1-4 3-1-5 4-3Z"/><path d="m9 15-5 6"/></svg>'
    };
    let monitorDockHovered = false;
    let monitorDockFocused = false;
    let monitorDockSuppressReveal = false;

    function monitorUpdateDockVisibility() {
        if (!monitorDebugDiv) return;
        const dock = monitorDebugDiv.querySelector('.ovolya-monitor-dock');
        const navigation = dock.querySelector('.ovolya-monitor-navigation');
        const expanded = isMenuOpen || !window.matchMedia('(hover:hover)').matches ||
            (!monitorDockSuppressReveal && (monitorDockHovered || monitorDockFocused));
        dock.dataset.expanded = String(expanded);
        navigation.setAttribute('aria-hidden', String(!expanded));
        navigation.querySelectorAll('button').forEach(button => { button.tabIndex = expanded ? 0 : -1; });
    }

    function monitorCloseMenu() {
        isMenuOpen = false;
        monitorDockSuppressReveal = true;
        monitorUpdateDebug();
        if (monitorDebugDiv.contains(document.activeElement)) {
            monitorDebugDiv.querySelector('#ovolya-monitor-timer-btn').focus({ preventScroll: true });
        }
    }

    function monitorOpenSection(tab) {
        if (isMenuOpen && activeTab === tab) {
            monitorCloseMenu();
            return;
        }
        isMenuOpen = true;
        monitorDockSuppressReveal = false;
        activeTab = tab;
        lastRenderedTab = null;
        monitorUpdateDebug();
        monitorDebugDiv.querySelector('#ovolya-settings-panel').scrollTop = 0;
    }

    function monitorCreateDebug() {
        if (monitorDebugDiv) return;
        const style = document.createElement('style');
        style.id = 'ovolya-monitor-menu-style';
        // Оформление версии 20261010.2; фон кнопки с глазами прозрачен.
        // Собственные фоны открытых панелей сохраняются.
        style.textContent = `
            #ovolya-monitor-debug-container { position:fixed; bottom:0; left:0; display:flex; flex-direction:column; align-items:flex-start; gap:0; padding:0; margin:0; z-index:9998; font:13px sans-serif; color:#c8c3bc; max-width:calc(100vw - 2px); max-height:calc(100vh - 2px); max-height:calc(100dvh - 2px); min-height:0; }
            #ovolya-monitor-debug-container [hidden] { display:none !important; }
            #ovolya-monitor-debug-container #ovolya-settings-panel { display:none; background:#272a2c; color:#c8c3bc; border:0; max-width:calc(100vw - 2px); max-height:calc(100vh - 34px); max-height:calc(100dvh - 34px); min-height:0; flex:0 1 auto; overflow:auto; overscroll-behavior:contain; padding:0; margin:0; box-sizing:border-box; box-shadow:none; }
            #ovolya-monitor-debug-container .ovolya-monitor-dock { display:flex; flex:0 0 auto; align-items:stretch; gap:0; padding:0; margin:0; height:32px; max-width:100%; }
            #ovolya-monitor-debug-container .ovolya-monitor-dock button { display:flex; position:relative; align-items:center; justify-content:center; flex:0 0 36px; width:36px; height:32px; min-width:0; min-height:0; margin:0; padding:0; border:0; border-radius:0; box-sizing:border-box; background:#272a2c; color:#c8c3bc; cursor:pointer; font:inherit; line-height:1; transition:background .2s ease,color .2s ease; }
            #ovolya-monitor-debug-container button:hover { filter:brightness(1.15); }
            #ovolya-monitor-debug-container button:focus-visible, #ovolya-monitor-debug-container input:focus-visible, #ovolya-monitor-debug-container select:focus-visible { outline:2px solid #86b9ff; outline-offset:-2px; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn { flex-basis:48px; width:48px; background:transparent; color:#a5e4ba; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn[data-paused="true"] { color:#b8c0ca; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn[data-unread="true"] { color:#ffbf62; }
            #ovolya-monitor-debug-container .ovolya-timer-eyes { width:36px; height:24px; transition:opacity .2s ease; }
            #ovolya-monitor-debug-container .ovolya-eye-open { transform-box:view-box; transform-origin:0 12px; animation:ovolya-eye-blink 8s ease-in-out infinite; }
            #ovolya-monitor-debug-container .ovolya-eye-pupil { animation:ovolya-eye-look 12s ease-in-out infinite; }
            #ovolya-monitor-debug-container .ovolya-eye-closed { opacity:0; animation:ovolya-eye-lids 8s ease-in-out infinite; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn[data-paused="true"] :is(.ovolya-eye-open,.ovolya-eye-pupil,.ovolya-eye-closed) { animation:none; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn[data-paused="true"] .ovolya-eye-open { opacity:0; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn[data-paused="true"] .ovolya-eye-closed { opacity:1; }
            #ovolya-monitor-debug-container .ovolya-monitor-navigation { display:flex; flex:0 0 auto; width:max-content; max-width:0; opacity:0; overflow:hidden; visibility:hidden; pointer-events:none; transform:translateX(-6px); transition:max-width .28s ease,opacity .2s ease,transform .28s ease,visibility 0s .28s; }
            #ovolya-monitor-debug-container .ovolya-monitor-dock[data-expanded="true"] .ovolya-monitor-navigation { max-width:108px; opacity:1; visibility:visible; pointer-events:auto; transform:translateX(0); transition-delay:0s; }
            #ovolya-monitor-debug-container .ovolya-monitor-navigation svg { display:block; width:19px; height:19px; }
            #ovolya-monitor-debug-container .ovolya-nav-close { display:none; }
            #ovolya-monitor-debug-container .ovolya-monitor-dock button[data-current="true"] { background:#4c252b; color:#ffb7be; }
            #ovolya-monitor-debug-container button[data-current="true"] .ovolya-nav-icon { display:none; }
            #ovolya-monitor-debug-container button[data-current="true"] .ovolya-nav-close { display:block; }
            #ovolya-monitor-debug-container .ovolya-mode-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#ffd180; opacity:0; transition:opacity .2s ease; pointer-events:none; }
            #ovolya-monitor-debug-container .ovolya-mode-overlay svg { display:block; width:19px; height:19px; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn[data-night="true"] .ovolya-mode-overlay { color:#c5d0ff; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn:is(:hover,:focus-visible) .ovolya-mode-overlay { opacity:1; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn:is(:hover,:focus-visible) .ovolya-timer-eyes { opacity:.12; }
            #ovolya-monitor-debug-container .ovolya-moon-icon { display:none; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn[data-night="true"] .ovolya-sun-icon { display:none; }
            #ovolya-monitor-debug-container #ovolya-monitor-timer-btn[data-night="true"] .ovolya-moon-icon { display:block; }
            #ovolya-monitor-debug-container .ovolya-unread-badge { position:absolute; top:1px; right:1px; min-width:10px; padding:1px 2px; background:#ffb74d; color:#17191c; font:700 9px/1 sans-serif; border-radius:6px; pointer-events:none; }
            #ovolya-monitor-debug-container .ovolya-filter-form { display:flex; flex-wrap:wrap; gap:4px; align-items:center; padding:6px; margin:0; }
            #ovolya-monitor-debug-container .ovolya-filter-form :is(input,select) { background:#35393b; color:#e8e6e3; border:1px solid #3e4446; padding:3px 6px; font:inherit; box-sizing:border-box; border-radius:0; margin:0; height:26px; }
            #ovolya-monitor-debug-container #ovolya-filter-value { flex:1; min-width:120px; }
            #ovolya-monitor-debug-container .ovolya-filter-table { width:100%; min-width:380px; margin:0; border:0; border-collapse:collapse; table-layout:auto; text-align:left; font:inherit; }
            #ovolya-monitor-debug-container .ovolya-filter-table th { border:0; padding:3px 6px; background:#2b2f31; color:#e8e6e3; font:inherit; font-weight:bold; white-space:nowrap; position:sticky; top:0; z-index:1; }
            #ovolya-monitor-debug-container .ovolya-filter-table td { border:0; padding:3px 6px; font:inherit; line-height:1.35; vertical-align:top; }
            #ovolya-monitor-debug-container :is(.ovolya-filter-state,.ovolya-filter-type,.ovolya-filter-action) { width:1%; white-space:nowrap; }
            #ovolya-monitor-debug-container .ovolya-filter-state, #ovolya-monitor-debug-container .ovolya-filter-action { text-align:center; }
            #ovolya-monitor-debug-container .ovolya-filter-text { overflow-wrap:anywhere; }
            #ovolya-monitor-debug-container .ovolya-filter-table tr[data-enabled="false"] :is(.ovolya-filter-type,.ovolya-filter-text) { color:#7e8791; }
            #ovolya-monitor-debug-container .ovolya-empty-filters { text-align:center; color:#9d9588; }
            #ovolya-monitor-debug-container .ovolya-filter-switch { display:inline-flex; position:relative; width:28px; height:16px; min-width:28px; margin:0; padding:0; border:0; border-radius:10px; background:#525963; cursor:pointer; vertical-align:middle; }
            #ovolya-monitor-debug-container .ovolya-filter-switch span { position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%; background:#e2e7ed; transition:transform .15s ease; }
            #ovolya-monitor-debug-container .ovolya-filter-switch[aria-checked="true"] { background:#438560; }
            #ovolya-monitor-debug-container .ovolya-filter-switch[aria-checked="true"] span { transform:translateX(12px); }
            #ovolya-monitor-debug-container .ovolya-settings-content { padding:6px; display:flex; flex-direction:column; gap:8px; }
            #ovolya-monitor-debug-container .ovolya-setting-section { margin:0; padding:0; border:0; background:#2b2f31; }
            #ovolya-monitor-debug-container .ovolya-setting-section h4 { margin:0 0 4px; padding:0; border:0; font:700 14px sans-serif; color:inherit; }
            #ovolya-monitor-debug-container .ovolya-setting-section p { margin:0 0 4px; color:#9d9588; font-size:12px; }
            #ovolya-monitor-debug-container .ovolya-setting-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:0; }
            #ovolya-monitor-debug-container :is(.ovolya-monitor-status,.ovolya-sound-note) { margin:0; font-size:12px; overflow-wrap:anywhere; }
            #ovolya-monitor-debug-container .ovolya-monitor-status { color:#b3aca2; }
            #ovolya-monitor-debug-container .ovolya-sound-note { color:#ffaa00; }
            @keyframes ovolya-eye-blink { 0%,10%,20%,100% { transform:scaleY(1); } 14%,16% { transform:scaleY(.03); } }
            @keyframes ovolya-eye-lids { 0%,12%,18%,100% { opacity:0; } 14%,16% { opacity:1; } }
            @keyframes ovolya-eye-look { 0%,12%,88%,100% { transform:translateX(0); } 28%,40% { transform:translateX(-2px); } 64%,76% { transform:translateX(2px); } }
            @media (prefers-reduced-motion:reduce) { #ovolya-monitor-debug-container *, #ovolya-monitor-debug-container *::before, #ovolya-monitor-debug-container *::after { animation:none !important; transition:none !important; } }
        `;
        document.head.appendChild(style);
        monitorDebugDiv = document.createElement('div');
        monitorDebugDiv.id = 'ovolya-monitor-debug-container';

        const panel = document.createElement('div');
        panel.id = 'ovolya-settings-panel';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', t('monitorSettings'));

        const bottomRow = document.createElement('div');
        bottomRow.className = 'ovolya-monitor-dock';
        const timerBtn = document.createElement('button');
        timerBtn.id = 'ovolya-monitor-timer-btn';
        timerBtn.type = 'button';
        timerBtn.innerHTML = `<svg class="ovolya-timer-eyes" viewBox="0 0 36 24" fill="none" aria-hidden="true">
            <g class="ovolya-eye-open"><ellipse cx="9" cy="12" rx="6" ry="7" fill="currentColor"/><ellipse class="ovolya-eye-pupil" cx="9" cy="12" rx="2.5" ry="3.5" fill="#19232a"/></g>
            <g class="ovolya-eye-open"><ellipse cx="27" cy="12" rx="6" ry="7" fill="currentColor"/><ellipse class="ovolya-eye-pupil" cx="27" cy="12" rx="2.5" ry="3.5" fill="#19232a"/></g>
            <g class="ovolya-eye-closed" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 11q6 6 12 0M21 11q6 6 12 0"/></g>
            </svg><span class="ovolya-mode-overlay" aria-hidden="true"><span class="ovolya-sun-icon">${monitorMenuIcons.sun}</span><span class="ovolya-moon-icon">${monitorMenuIcons.moon}</span></span><span class="ovolya-unread-badge" hidden aria-hidden="true"></span>`;
        timerBtn.onclick = () => {
            isNightMode = !isNightMode;
            localStorage.setItem('sd_night_mode', isNightMode);
            stopCurrentAudio();
            monitorUpdateDebug();
        };

        const navigation = document.createElement('div');
        navigation.className = 'ovolya-monitor-navigation';
        const pinBtn = document.createElement('button');
        pinBtn.id = 'ovolya-monitor-pin-btn';
        pinBtn.type = 'button';
        pinBtn.innerHTML = monitorMenuIcons.pin;
        pinBtn.title = t('pin');
        pinBtn.setAttribute('aria-label', pinBtn.title);
        pinBtn.onclick = () => { if (isMonitorTargetPage()) { monitorWriteLock(); monitorCheckOwnership(); } };
        navigation.appendChild(pinBtn);

        for (const [id, tab] of [['ovolya-menu-rules-btn', 'rules'], ['ovolya-menu-sound-btn', 'settings']]) {
            const button = document.createElement('button');
            button.id = id;
            button.type = 'button';
            button.innerHTML = `<span class="ovolya-nav-icon">${monitorMenuIcons[tab]}</span><span class="ovolya-nav-close">${monitorMenuIcons.close}</span>`;
            button.setAttribute('aria-controls', panel.id);
            button.onclick = () => monitorOpenSection(tab);
            navigation.appendChild(button);
        }
        bottomRow.addEventListener('pointerenter', () => { monitorDockHovered = true; monitorDockSuppressReveal = false; monitorUpdateDockVisibility(); });
        bottomRow.addEventListener('pointerleave', () => { monitorDockHovered = false; monitorDockSuppressReveal = false; monitorUpdateDockVisibility(); });
        bottomRow.addEventListener('focusin', event => {
            monitorDockFocused = event.target.matches(':focus-visible');
            if (!monitorDebugDiv.contains(event.relatedTarget)) monitorDockSuppressReveal = false;
            monitorUpdateDockVisibility();
        });
        bottomRow.addEventListener('focusout', () => queueMicrotask(() => {
            monitorDockFocused = bottomRow.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
            if (!bottomRow.contains(document.activeElement)) monitorDockSuppressReveal = false;
            monitorUpdateDockVisibility();
        }));
        monitorDebugDiv.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); monitorCloseMenu(); }
        });
        bottomRow.append(timerBtn, navigation);
        monitorDebugDiv.append(panel, bottomRow);
        document.body.appendChild(monitorDebugDiv);
    }

    function monitorUpdateDebug() {
        const container = monitorDebugDiv;
        if (!container) return;
        container.style.display = isMonitorTargetPage() || isMenuOpen ? 'flex' : 'none';
        const panel = container.querySelector('#ovolya-settings-panel');
        const timerBtn = container.querySelector('#ovolya-monitor-timer-btn');
        const minutes = Math.floor(Math.max(0, monitorTimeLeft) / 60);
        const seconds = Math.floor(Math.max(0, monitorTimeLeft) % 60);
        const status = t(monitorIsOwner ? 'monitoring' : 'waiting');
        const timerPaused = !monitorIsOwner || monitorIsPaused;
        const timerText = t('timerStatus', `${minutes}:${String(seconds).padStart(2, '0')}`, status, t(timerPaused ? 'paused' : 'countdown'));
        timerBtn.title = `${timerText}${monitorNotificationCount > 0 ? ` | ${t('newCount', monitorNotificationCount)}` : ''}
${t(isNightMode ? 'nightMode' : 'dayMode')}
${t('debugTooltip')}`;
        timerBtn.setAttribute('aria-label', timerBtn.title);
        timerBtn.setAttribute('aria-pressed', String(isNightMode));
        timerBtn.dataset.night = String(isNightMode);
        panel.setAttribute('aria-label', t('monitorSettings'));
        panel.lang = currentLang;
        timerBtn.dataset.paused = String(timerPaused);
        timerBtn.dataset.unread = String(monitorNotificationCount > 0);
        const badge = timerBtn.querySelector('.ovolya-unread-badge');
        badge.hidden = monitorNotificationCount === 0;
        const badgeText = monitorNotificationCount > 99 ? '99+' : String(monitorNotificationCount);
        if (badge.textContent !== badgeText) badge.textContent = badgeText;
        for (const [id, tab, label] of [['ovolya-menu-rules-btn', 'rules', t('filters')], ['ovolya-menu-sound-btn', 'settings', t('soundSettings')]]) {
            const button = container.querySelector(`#${id}`);
            const selected = isMenuOpen && activeTab === tab;
            button.title = selected ? t('closeMenu', label) : label;
            button.setAttribute('aria-label', button.title);
            button.setAttribute('aria-expanded', String(selected));
            button.dataset.current = String(selected);
        }
        const pinBtn = container.querySelector('#ovolya-monitor-pin-btn');
        pinBtn.hidden = monitorIsOwner;
        pinBtn.title = t('pin');
        pinBtn.setAttribute('aria-label', pinBtn.title);
        panel.style.display = isMenuOpen ? 'block' : 'none';
        panel.style.width = activeTab === 'rules' ? '640px' : '468px';
        if (isMenuOpen && activeTab !== lastRenderedTab) {
            renderPanelContent(panel);
            lastRenderedTab = activeTab;
        }
        const statusLine = panel.querySelector('.ovolya-monitor-status');
        if (statusLine && statusLine.textContent !== timerText) statusLine.textContent = timerText;
        monitorUpdateDockVisibility();
    }

    // =======================АКТИВНОСТЬ ПОЛЬЗОВАТЕЛЯ=====================================
    let monitorIdleTimeout = null;
    function monitorSetWorking() {
        if (!monitorIsOwner) return;
        monitorIsPaused = true;
        clearTimeout(monitorIdleTimeout);
        monitorIdleTimeout = setTimeout(() => {
            if (!monitorIsOwner) return;
            monitorIsPaused = false; monitorLastTick = Date.now();
            if (monitorHadClicks) { monitorTimeLeft = Math.min(monitorTimeLeft + MONITOR_ADD_TIME_ON_BLUR_SEC, MONITOR_TIMER_MAX_SEC); monitorHadClicks = false; }
            monitorUpdateDebug();
        }, 10000);
        monitorUpdateDebug();
    }

    setInterval(() => {
        if (!monitorIsOwner) return;
        const now = Date.now();
        const delta = (now - monitorLastTick) / 1000;
        monitorLastTick = now;
        if (!monitorIsPaused) {
            monitorTimeLeft -= delta;
            if (monitorTimeLeft <= 0) {
                monitorTimeLeft = 0;
                monitorIsPaused = true;
                monitorRenewLock();
                if (!monitorIsOwner) return;
                // Завжди повертаємо на цільову сторінку (навіть якщо користувач пішов на /create тощо)
                goToMonitorTargetPage();
                return;
            }
        }
        monitorUpdateDebug();
    }, 1000);

    function monitorCheckOwnership() {
        const lock = monitorReadLock();
        if (lock && lock.token !== monitorToken && lock.expiresAt > Date.now()) {
            if (monitorIsOwner) { monitorIsOwner = false; clearTimeout(monitorIdleTimeout); }
            monitorUpdateDebug(); return;
        }
        if (!monitorIsOwner) {
            if (monitorAcquireLock()) {
                monitorLastTick = Date.now(); monitorTimeLeft = MONITOR_TIMER_MAX_SEC;
                monitorWaitForTickets();
            }
        }
        monitorUpdateDebug();
    }

    // ==========================ИНИЦИАЛИЗАЦИЯ==================================
    function initNewRequestsMonitor() {
        if (monitorInitialized) return;
        monitorInitialized = true;

        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        monitorCreateDebug();
        if (monitorAcquireLock() && monitorResume?.token === monitorToken && Number.isFinite(monitorResume.timeLeft)) {
            monitorTimeLeft = monitorResume.timeLeft > 0
                ? Math.min(monitorResume.timeLeft, MONITOR_TIMER_MAX_SEC)
                : MONITOR_TIMER_MAX_SEC;
        }
        monitorResume = null;
        monitorLastTick = Date.now();
        monitorUpdateDebug();

        monitorWaitForTickets();
        setTimeout(() => {
            if (window.location.pathname.startsWith('/admin/requests')) {
                hideBlacklistedTickets();
            }
        }, 2000);

        setInterval(() => { if (monitorIsOwner) monitorRenewLock(); }, 2500);
        setInterval(monitorCheckOwnership, 3000);
    }

    ['mousemove', 'keydown', 'click', 'wheel'].forEach(evt => window.addEventListener(evt, () => { monitorSetWorking(); if (evt === 'click') monitorHadClicks = true; }));
    window.addEventListener('blur', () => { clearTimeout(monitorIdleTimeout); monitorIsPaused = false; monitorLastTick = Date.now(); monitorTimeLeft = Math.min(monitorTimeLeft + MONITOR_ADD_TIME_ON_BLUR_SEC, MONITOR_TIMER_MAX_SEC); monitorHadClicks = false; monitorUpdateDebug(); });

    setInterval(() => {
        if (monitorNotificationCount > 0) {
            monitorTitleBlinking = !monitorTitleBlinking;
            document.title = monitorTitleBlinking ? `🟠 ${t('newTicketsTitle')}` : monitorOriginalTitle;
        }
    }, 1000);

    window.addEventListener('popstate', () => {
        monitorCheckOwnership();
        runAllTasks();
    });
    window.addEventListener('hashchange', () => {
        monitorCheckOwnership();
        runAllTasks();
    });

    window.addEventListener('storage', (e) => {
        if (e.key === MONITOR_LOCK_KEY) monitorCheckOwnership();
        if (e.key === LANGUAGE_KEY) {
            currentLang = Object.hasOwn(fallbackI18n, e.newValue) ? e.newValue : 'uk';
            refreshInterfaceLanguage();
            void loadLanguage(currentLang);
        }
        if (e.key === 'sd_night_mode') {
            isNightMode = e.newValue === 'true';
            stopCurrentAudio();
            monitorUpdateDebug();
        }
        if (e.key === REQUEST_FILTERS_KEY) {
            try {
                const rules = JSON.parse(e.newValue || '[]');
                if (!Array.isArray(rules)) return;
                requestFilterRules = rules;
                lastRenderedTab = null;
                monitorUpdateDebug();
                hideBlacklistedTickets();
            } catch (error) { console.log('[sd.bitech] Could not read updated filters:', error); }
        }
    });
    window.addEventListener('beforeunload', () => {
        if (!monitorIsOwner || monitorReadLock()?.token !== monitorToken) return;
        // Preserve ownership and remaining time in this tab across full navigation.
        try {
            sessionStorage.setItem(MONITOR_SESSION_KEY, JSON.stringify({ token: monitorToken, timeLeft: monitorTimeLeft }));
        } catch (e) { }
        monitorRenewLock();
    });

    initNewRequestsMonitor();
    void loadLanguage(currentLang);

    const statusObserver = new MutationObserver(replaceStatusText);
    statusObserver.observe(document.body, { childList: true, subtree: true });
    replaceStatusText();

    function hideBlacklistedTickets() {
        const tickets = getCurrentTickets();
        for (const t of tickets) {
            const link = document.querySelector(`.request-column-content a[href="/admin/requests/${t.id}"]`);
            if (link) {
                const ticketRow = link.closest('tr');
                if (ticketRow) {
                    const shouldHide = isRequestFiltered(t);
                    const targetDisplay = shouldHide ? 'none' : '';
                    if (ticketRow.style.display !== targetDisplay) {
                        ticketRow.style.display = targetDisplay;
                    }
                }
            }
        }
    }

    function runAllTasks() {
        observer.disconnect();
        try {
            if (ensureRequestsPageSize()) return;
            manageLogoutButton();
            updateRequestsMenuLink();
            if (window.location.pathname === '/admin/requests' || window.location.pathname === '/admin/requests/') {
                relocateControlsAndQueues();
                enhanceListPage();
                hideBlacklistedTickets();
            } else {
                const customContainer = document.getElementById('ovolya-custom-sidebar-container');
                if (customContainer) customContainer.remove();
                lastShortcutsSnapshot = '';
            }
        } finally { observer.observe(document.body, { childList: true, subtree: true }); }
    }

    const observer = new MutationObserver(() => { runAllTasks(); });
    observer.observe(document.body, { childList: true, subtree: true });
    runAllTasks();
})();
