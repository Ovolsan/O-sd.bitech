// ==UserScript==
// @name         О sd.bitech
// @namespace    http://tampermonkey.net/
// @version      20261030.6
// @description  Кнопка виходу біля користувача в профілі. Компактні списки заявок. Ярлики. Моніторинг нових заявок + Звук и Фильтры + Системные уведомления. Налаштування блоків заявки (ПКМ на «Зберегти»)
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

    // ===============================НАСТРОЙКА БЛОКОВ ЗАЯВКИ==============================
    // Блок — ячейка .rf-grid > .rf-cell. Порядок задаётся CSS order: Angular продолжает владеть разметкой.
    const REQUEST_LAYOUT_KEY = 'sd_request_layout_v1';
    const REQUEST_FIELD_SELECTOR = '[key][label], app-iframe[label]';
    let requestLayout = readRequestLayout();
    let requestLayoutEditing = false;
    let requestLayoutMenu = null;
    let requestLayoutDragCancel = null;
    let requestLayoutRefreshTimer = null;

    function readRequestLayout() {
        try {
            const layout = JSON.parse(localStorage.getItem(REQUEST_LAYOUT_KEY) || 'null');
            if (layout && typeof layout === 'object') {
                return {
                    blocks: Array.isArray(layout.blocks) ? layout.blocks.filter(block => Array.isArray(block?.ids)) : [],
                    hiddenLabels: Array.isArray(layout.hiddenLabels) ? layout.hiddenLabels : [],
                    hiddenFields: Array.isArray(layout.hiddenFields) ? layout.hiddenFields : [],
                    fieldHeights: layout.fieldHeights && typeof layout.fieldHeights === 'object' ? layout.fieldHeights : {},
                    hiddenOptions: layout.hiddenOptions && typeof layout.hiddenOptions === 'object' ? layout.hiddenOptions : {}
                };
            }
        } catch (e) { console.warn('[sd.bitech] Повреждена настройка блоков заявки:', e); }
        return createEmptyRequestLayout();
    }

    function createEmptyRequestLayout() { return { blocks: [], hiddenLabels: [], hiddenFields: [], fieldHeights: {}, hiddenOptions: {} }; }

    function saveRequestLayout() { localStorage.setItem(REQUEST_LAYOUT_KEY, JSON.stringify(requestLayout)); }

    function getLayoutCells(grid) { return [...grid.children].filter(el => el.classList.contains('rf-cell')); }

    function getVisualCells(grid) {
        return getLayoutCells(grid)
            .map((cell, domIndex) => ({ cell, domIndex, order: Number(cell.style.order) || 0 }))
            .sort((a, b) => a.order - b.order || a.domIndex - b.domIndex)
            .map(item => item.cell);
    }

    // Поля ячейки верхнего уровня: шаблоны внутри «Опис статусу» не считаются отдельным полем.
    function getCellFields(cell) {
        return [...cell.querySelectorAll(REQUEST_FIELD_SELECTOR)]
            .filter(field => field.parentElement.closest(`${REQUEST_FIELD_SELECTOR}, .rf-cell`) === cell);
    }

    function getFieldId(field) { return field.getAttribute('key') || 'label:' + field.getAttribute('label').trim(); }

    function getFieldTitle(field) {
        return field.getAttribute('label').trim() + (field.querySelector('.control-label-asterisk') ? ' *' : '');
    }

    // Набор полей ячейки зависит от статуса (например, «Відключення» появляется не всегда),
    // поэтому блок узнаётся по любому из своих полей.
    function getCellIds(cell, fields = getCellFields(cell)) {
        const ids = fields.map(getFieldId);
        return ids.length ? ids : ['cell:' + [...cell.classList].join('.')];
    }

    function getCellTitle(cell) {
        return getCellFields(cell).map(field => field.getAttribute('label').trim()).join(' / ') || t('layoutTitle');
    }

    function findLayoutBlock(ids) { return requestLayout.blocks.findIndex(block => block.ids.some(id => ids.includes(id))); }

    function getOptionText(option) {
        return (option.querySelector('.radio-button-label-text, .checkbox-label-text') || option).textContent.trim();
    }

    function isRequestFieldEmpty(field) {
        if (field.matches('app-radio-button-group')) return !field.querySelector('.p-radiobutton-checked');
        if (field.matches('app-checkbox-group')) return !field.querySelector('[data-p-checked="true"]');
        if (field.matches('app-text-input, app-textarea')) {
            const input = field.querySelector('textarea, input');
            return !!input && !input.value.trim();
        }
        if (field.matches('app-select, app-multiselect, app-datetime-picker')) {
            const wrapper = field.querySelector('.p-inputwrapper');
            return !!wrapper && !wrapper.classList.contains('p-inputwrapper-filled');
        }
        return false;
    }

    function applyRequestFieldState(field) {
        const id = getFieldId(field);
        const labelHidden = requestLayout.hiddenLabels.includes(id);
        field.classList.toggle('ovolya-rf-label-hidden', labelHidden);
        // Одна ячейка сайта может держать несколько полей («Опис заявки» и «Первинна діагностика»).
        field.classList.toggle('ovolya-rf-field-hidden', requestLayout.hiddenFields.includes(id));
        if (labelHidden) {
            // Скрытая подпись остаётся в подсказке при наведении.
            const title = getFieldTitle(field);
            if (field.title !== title) field.title = title;
            field.dataset.ovolyaTitle = 'true';
        } else if (field.dataset.ovolyaTitle) {
            field.removeAttribute('title');
            delete field.dataset.ovolyaTitle;
        }
        const hiddenOptions = Array.isArray(requestLayout.hiddenOptions[id]) ? requestLayout.hiddenOptions[id] : [];
        field.querySelectorAll('.radio-button-label, .checkbox-label').forEach(option => {
            option.classList.toggle('ovolya-rf-option-hidden', hiddenOptions.includes(getOptionText(option)));
        });
        field.classList.toggle('ovolya-rf-empty', isRequestFieldEmpty(field));
        // Минимальная высота многострочного поля (например, «Опис статусу») из режима настройки.
        const textarea = field.querySelector('textarea');
        if (textarea) {
            const height = Number(requestLayout.fieldHeights[id]);
            const value = height > 0 ? `${height}px` : '';
            if (textarea.style.getPropertyValue('min-height') !== value) {
                if (value) textarea.style.setProperty('min-height', value, 'important');
                else textarea.style.removeProperty('min-height');
            }
        }
    }

    // В режиме настройки высоту поля задают его же уголком: после отпускания она запоминается как минимальная.
    function saveRequestTextareaHeight(textarea) {
        const field = textarea.closest(REQUEST_FIELD_SELECTOR);
        if (!field || !textarea.style.height) return;
        const height = Math.round(textarea.getBoundingClientRect().height);
        textarea.style.removeProperty('height');
        requestLayout.fieldHeights[getFieldId(field)] = height;
        commitRequestLayout();
    }

    const requestLayoutIcons = {
        eye: '<svg class="ovolya-rf-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
        pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5M9 3h6M10 3v7.5L7 14v3h10v-3l-3-3.5V3"/></svg>',
        eyeOff: '<svg class="ovolya-rf-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
    };

    const requestMoveSteps = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    const requestChevron = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;

    function createRequestCellBar() {
        const bar = document.createElement('nav');
        bar.className = 'ovolya-rf-ui ovolya-rf-bar';
        for (const [action, html] of [
            ['drag', '⠿'],
            ['left', requestChevron('m15 6-6 6 6 6')], ['right', requestChevron('m9 6 6 6-6 6')],
            ['up', requestChevron('m6 15 6-6 6 6')], ['down', requestChevron('m6 9 6 6 6-6')],
            ['row', requestLayoutIcons.pin],
            ['block', requestLayoutIcons.eye + requestLayoutIcons.eyeOff], ['labels', 'Aa'],
            ['fields', requestChevron('M4 6h16M4 12h16M4 18h10')]
        ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.action = action;
            button.innerHTML = html;
            bar.append(button);
        }
        bar.querySelector('[data-action="drag"]').addEventListener('pointerdown', startRequestBlockDrag);
        bar.addEventListener('click', event => {
            const button = event.target.closest('button');
            const cell = bar.closest('.rf-cell');
            if (!button || !cell) return;
            const step = requestMoveSteps[button.dataset.action];
            if (step) moveRequestBlockByStep(cell, ...step);
            if (button.dataset.action === 'row') toggleRequestRow(cell);
            if (button.dataset.action === 'block') toggleRequestBlockHidden(cell);
            if (button.dataset.action === 'labels') toggleRequestCellLabels(cell);
            if (button.dataset.action === 'fields') showRequestFieldsMenu(cell, button);
        });
        return bar;
    }

    // Ручки по краям блока, как в HTML Note: справа — ширина, снизу — высота, в углу — обе.
    function createRequestResizeHandles() {
        return ['r', 'b', 'br'].map(edge => {
            const handle = document.createElement('i');
            handle.className = 'ovolya-rf-ui ovolya-rf-handle';
            handle.dataset.edge = edge;
            handle.addEventListener('pointerdown', startRequestBlockDrag);
            return handle;
        });
    }

    function setRequestBarButton(bar, action, title, pressed) {
        const button = bar.querySelector(`[data-action="${action}"]`);
        if (button.title !== title) {
            button.title = title;
            button.setAttribute('aria-label', title);
        }
        if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
    }

    // Обновляются только атрибуты: изменение детей перезапустило бы общий MutationObserver.
    function updateRequestCellBar(cell, block, fields) {
        let bar = cell.querySelector(':scope > .ovolya-rf-bar');
        if (!requestLayoutEditing) {
            cell.querySelectorAll(':scope > .ovolya-rf-ui').forEach(el => el.remove());
            return;
        }
        if (!bar) {
            bar = createRequestCellBar();
            cell.append(bar, ...createRequestResizeHandles());
        }
        const hidden = !!block?.hidden;
        const labelsHidden = fields.length > 0 && fields.every(field => requestLayout.hiddenLabels.includes(getFieldId(field)));
        const title = getCellTitle(cell);
        if (bar.title !== title) bar.title = title;
        setRequestBarButton(bar, 'drag', t('layoutDrag'));
        setRequestBarButton(bar, 'left', t('layoutMoveLeft'));
        setRequestBarButton(bar, 'right', t('layoutMoveRight'));
        setRequestBarButton(bar, 'up', t('layoutMoveUp'));
        setRequestBarButton(bar, 'down', t('layoutMoveDown'));
        const pinned = !!getRequestPlace(block, getGridColumnCount(cell.parentElement))?.row;
        setRequestBarButton(bar, 'row', t(pinned ? 'layoutRowStop' : 'layoutRowStart'), pinned);
        cell.querySelectorAll(':scope > .ovolya-rf-handle').forEach(handle => {
            const title = t(handle.dataset.edge === 'r' ? 'layoutResizeWidth' : handle.dataset.edge === 'b' ? 'layoutResizeHeight' : 'layoutResize');
            if (handle.title !== title) handle.title = title;
        });
        setRequestBarButton(bar, 'block', t(hidden ? 'layoutShowBlock' : 'layoutHideBlock'), hidden);
        setRequestBarButton(bar, 'labels', t(labelsHidden ? 'layoutShowLabels' : 'layoutHideLabels'), labelsHidden);
        bar.querySelector('[data-action="labels"]').hidden = fields.length === 0;
        const hiddenFields = fields.filter(field => requestLayout.hiddenFields.includes(getFieldId(field))).length;
        setRequestBarButton(bar, 'fields', t('layoutFields'), hiddenFields > 0);
        bar.querySelector('[data-action="fields"]').hidden = fields.length < 2;
    }

    function updateRequestLayoutHint(grid) {
        let hint = grid.previousElementSibling?.classList.contains('ovolya-rf-hint') ? grid.previousElementSibling : null;
        if (!requestLayoutEditing) {
            hint?.remove();
            return;
        }
        if (hint) return;
        hint = document.createElement('section');
        hint.className = 'ovolya-rf-ui ovolya-rf-hint';
        const title = document.createElement('strong');
        title.textContent = t('layoutTitle');
        const text = document.createElement('p');
        text.textContent = t('layoutHint');
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'ovolya-rf-btn';
        reset.textContent = t('layoutResetShort');
        reset.addEventListener('click', resetRequestLayout);
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'ovolya-rf-btn ovolya-rf-btn-primary';
        done.textContent = t('layoutDoneShort');
        done.addEventListener('click', () => setRequestLayoutEditing(false));
        hint.append(title, text, reset, done);
        grid.before(hint);
    }

    // Число колонок берём из правил сайта (3/2/1 по ширине окна), а не из вычисленной сетки:
    // её раздувают неявные колонки от наших же координат.
    let requestGridColumnRules = null;
    function getGridColumnCount(grid) {
        if (!requestGridColumnRules?.length) {
            requestGridColumnRules = [];
            for (const sheet of document.styleSheets) {
                let rules;
                try { rules = sheet.cssRules; } catch (e) { continue; }
                for (const rule of rules) {
                    const media = rule.media?.mediaText || '';
                    for (const inner of rule.media ? rule.cssRules : [rule]) {
                        const value = inner.selectorText?.includes('.rf-grid') && inner.style?.gridTemplateColumns;
                        if (!value) continue;
                        const repeat = value.match(/^repeat\(\s*(\d+)/);
                        requestGridColumnRules.push({ media, count: repeat ? Number(repeat[1]) : value.split(/\s+(?![^(]*\))/).length });
                    }
                }
            }
        }
        let count = 0;
        for (const rule of requestGridColumnRules) {
            if (!rule.media || window.matchMedia(rule.media).matches) count = rule.count;
        }
        return count || getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    }

    // Место блока хранится отдельно для каждого числа колонок: { "3": { x, w, y, mh } }.
    // x и w — колонки; y — только порядок. Блоки укладываются в свои колонки сверху вниз
    // и поднимаются, когда выше никого нет (блок скрыт или отсутствует в этой заявке).
    function getRequestPlace(block, cols) {
        const place = block?.place?.[cols];
        if (!place || ![place.x, place.y, place.w].every(Number.isFinite)) return null;
        const w = Math.min(Math.max(Math.round(place.w), 1), cols);
        return {
            x: Math.min(Math.max(Math.round(place.x), 1), cols - w + 1),
            y: place.y,
            w,
            mh: Number.isFinite(place.mh) && place.mh > 0 ? place.mh : 0,
            row: place.row === true
        };
    }

    function hasRequestPlaces(cols) { return requestLayout.blocks.some(block => getRequestPlace(block, cols)); }

    function setRequestStyle(element, property, value) {
        if (element.style[property] !== value) element.style[property] = value;
    }

    const REQUEST_STACK_GAP = 4;
    const REQUEST_STACK_GAP_EDIT = 14;
    const requestObservedCells = new WeakSet();
    // Высота блока меняется вместе с содержимым (статус, текст, размер поля) — тогда раскладка пересчитывается.
    const requestResizeObserver = new ResizeObserver(() => scheduleRequestFormRefresh());

    // Места всех блоков страницы. Блок без сохранённого места встаёт за соседом по разметке сайта.
    function getRequestItems(grid, cols) {
        let previousKey = -1;
        let previousY = -1;
        return getLayoutCells(grid).map((cell, domIndex) => {
            const fields = getCellFields(cell);
            const index = findLayoutBlock(getCellIds(cell, fields));
            const block = requestLayout.blocks[index];
            const key = index >= 0 ? index : previousKey + 0.001;
            previousKey = key;
            const span = cell.classList.contains('rf-span-3') ? cols : cell.classList.contains('rf-span-2') ? 2 : 1;
            const place = getRequestPlace(block, cols) || { x: 1, w: Math.min(span, cols), y: previousY + 0.001, mh: 0 };
            previousY = place.y;
            return { cell, fields, block, key, domIndex, place };
        });
    }

    function applyRequestLayout(grid) {
        const cols = getGridColumnCount(grid);
        const stacked = hasRequestPlaces(cols);
        const hasBlocks = requestLayout.blocks.length > 0;
        const items = getRequestItems(grid, cols);
        for (const { cell, fields, block } of items) {
            cell.classList.toggle('ovolya-rf-block-hidden', !!block?.hidden);
            fields.forEach(applyRequestFieldState);
            updateRequestCellBar(cell, block, fields);
        }
        // Без своих мест (другое число колонок) блоки идут по сетке сайта в сохранённом порядке.
        [...items].sort((a, b) => a.key - b.key || a.domIndex - b.domIndex).forEach(({ cell }, rank) => {
            setRequestStyle(cell, 'order', hasBlocks ? String(rank) : '');
        });
        if (stacked) {
            stackRequestCells(grid, cols, items);
            return;
        }
        setRequestStyle(grid, 'gridAutoRows', '');
        setRequestStyle(grid, 'rowGap', '');
        for (const { cell } of items) {
            for (const property of ['gridColumn', 'gridRow', 'alignSelf', 'minHeight']) setRequestStyle(cell, property, '');
            cell.classList.remove('ovolya-rf-row');
        }
    }

    // Строки сетки по 1px: каждый блок встаёт сразу под нижним краем своих колонок.
    function stackRequestCells(grid, cols, items) {
        setRequestStyle(grid, 'gridAutoRows', '1px');
        setRequestStyle(grid, 'rowGap', '0px');
        for (const { cell, place } of items) {
            setRequestStyle(cell, 'gridColumn', `${place.x} / span ${place.w}`);
            setRequestStyle(cell, 'alignSelf', 'start');
            setRequestStyle(cell, 'minHeight', place.mh ? `${place.mh}px` : '');
            cell.classList.toggle('ovolya-rf-row', !!place.row);
            if (!requestObservedCells.has(cell)) {
                requestObservedCells.add(cell);
                requestResizeObserver.observe(cell);
            }
        }
        // Высота зависит только от ширины, поэтому читается один раз после расстановки по колонкам.
        const heights = items.map(({ cell }) => cell.getBoundingClientRect().height);
        const gap = requestLayoutEditing ? REQUEST_STACK_GAP_EDIT : REQUEST_STACK_GAP;
        const bottoms = new Array(cols).fill(0);
        items.map((item, index) => ({ ...item, height: heights[index] }))
            .sort((a, b) => a.place.y - b.place.y || a.place.x - b.place.x)
            .forEach(({ cell, place, height }) => {
                // Закреплённый ряд начинается ниже всего, что стоит до него, во всех колонках:
                // блоки после него встают на ту же линию и не съезжают относительно друг друга.
                // Линия держится, даже если сам закреплённый блок скрыт.
                if (place.row) bottoms.fill(Math.max(...bottoms));
                // Скрытый или пустой блок места не занимает.
                if (!height) {
                    setRequestStyle(cell, 'gridRow', '');
                    return;
                }
                const top = Math.max(...bottoms.slice(place.x - 1, place.x - 1 + place.w));
                const span = Math.ceil(height) + gap;
                setRequestStyle(cell, 'gridRow', `${top + 1} / span ${span}`);
                bottoms.fill(top + span, place.x - 1, place.x - 1 + place.w);
            });
    }

    // Записывает в настройку все блоки страницы в текущем порядке; неизвестные встают за соседом.
    function ensureRequestLayoutBlocks(grid) {
        let insertAt = 0;
        for (const cell of getVisualCells(grid)) {
            const ids = getCellIds(cell);
            let index = findLayoutBlock(ids);
            if (index < 0) {
                index = insertAt;
                requestLayout.blocks.splice(index, 0, { ids, hidden: false });
            } else {
                const block = requestLayout.blocks[index];
                ids.forEach(id => { if (!block.ids.includes(id)) block.ids.push(id); });
            }
            insertAt = index + 1;
        }
    }

    function getRequestBlock(cell) {
        ensureRequestLayoutBlocks(cell.parentElement);
        return requestLayout.blocks[findLayoutBlock(getCellIds(cell))];
    }

    function commitRequestLayout() {
        saveRequestLayout();
        enhanceRequestForm();
    }

    // Границы колонок сетки в координатах окна.
    function measureRequestGrid(grid) {
        const style = getComputedStyle(grid);
        const rect = grid.getBoundingClientRect();
        const sizes = value => value === 'none' ? [] : value.split(' ').map(parseFloat);
        const tracks = (list, start, gap) => {
            let position = start;
            return list.map(size => {
                const track = { start: position, end: position + size };
                position += size + gap;
                return track;
            });
        };
        return {
            columns: tracks(sizes(style.gridTemplateColumns), rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), parseFloat(style.columnGap) || 0)
        };
    }

    // Номер колонки (с 1) под точкой.
    function findRequestTrack(tracks, position) {
        const index = tracks.findIndex(track => position <= track.end);
        return index < 0 ? tracks.length + 1 : index + 1;
    }

    // Переводит текущую раскладку в места блоков, не сдвигая ни одного из них.
    function snapshotRequestLayout(grid, cols) {
        ensureRequestLayoutBlocks(grid);
        if (hasRequestPlaces(cols)) {
            for (const { block, place } of getRequestItems(grid, cols)) {
                if (!getRequestPlace(block, cols)) block.place = { ...block.place, [cols]: place };
            }
        } else {
            // Сетка сайта: колонки берутся с экрана, порядок — сверху вниз и слева направо.
            const metrics = measureRequestGrid(grid);
            getLayoutCells(grid)
                .map(cell => ({ cell, rect: cell.getBoundingClientRect() }))
                .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
                .forEach(({ cell, rect }, index) => {
                    const block = requestLayout.blocks[findLayoutBlock(getCellIds(cell))];
                    const x = Math.min(findRequestTrack(metrics.columns, rect.left + 1), cols);
                    const last = Math.min(findRequestTrack(metrics.columns, rect.right - 1), cols);
                    block.place = { ...block.place, [cols]: { x, y: index, w: Math.max(1, last - x + 1) } };
                });
        }
        normalizeRequestOrder(cols);
    }

    // Порядок — целые числа подряд; список блоков повторяет его для раскладки при другом числе колонок.
    function normalizeRequestOrder(cols) {
        const sorted = requestLayout.blocks.filter(block => getRequestPlace(block, cols))
            .sort((a, b) => a.place[cols].y - b.place[cols].y || a.place[cols].x - b.place[cols].x);
        sorted.forEach((block, index) => { block.place[cols] = { ...getRequestPlace(block, cols), y: index }; });
        requestLayout.blocks = requestLayout.blocks.map(block => getRequestPlace(block, cols) ? sorted.shift() : block);
    }

    // Видимые блоки, которые делят колонки x..x+w-1, в порядке укладки.
    function getRequestColumnNeighbours(grid, cell, cols, x, w) {
        return getLayoutCells(grid)
            .filter(other => other !== cell)
            .map(other => ({ rect: other.getBoundingClientRect(), place: getRequestPlace(requestLayout.blocks[findLayoutBlock(getCellIds(other))], cols) }))
            .filter(({ rect, place }) => rect.height > 0 && place && place.x < x + w && x < place.x + place.w)
            .sort((a, b) => a.place.y - b.place.y);
    }

    // Куда встанет блок в колонках x..x+w-1, если отпустить его на высоте pointerY.
    function getRequestDropTarget(grid, cell, cols, x, w, pointerY) {
        const neighbours = getRequestColumnNeighbours(grid, cell, cols, x, w);
        let nextIndex = neighbours.findIndex(({ rect }) => pointerY < rect.top + rect.height / 2);
        if (nextIndex < 0) nextIndex = neighbours.length;
        const previous = neighbours[nextIndex - 1];
        const next = neighbours[nextIndex];
        const gap = REQUEST_STACK_GAP_EDIT / 2;
        return {
            y: previous && next ? (previous.place.y + next.place.y) / 2 : previous ? previous.place.y + 0.5 : next ? next.place.y - 0.5 : -1,
            lineY: next ? next.rect.top - gap : previous ? previous.rect.bottom + gap : grid.getBoundingClientRect().top
        };
    }

    function setRequestPlace(cell, changes) {
        const grid = cell.parentElement;
        const cols = getGridColumnCount(grid);
        snapshotRequestLayout(grid, cols);
        const block = getRequestBlock(cell);
        block.place[cols] = { ...getRequestPlace(block, cols), ...changes };
        normalizeRequestOrder(cols);
        commitRequestLayout();
    }

    // ‹ › — соседняя колонка; ˄ ˅ — обмен местами с соседом сверху или снизу в своих колонках.
    function moveRequestBlockByStep(cell, dx, dy) {
        const grid = cell.parentElement;
        const cols = getGridColumnCount(grid);
        snapshotRequestLayout(grid, cols);
        const place = getRequestPlace(getRequestBlock(cell), cols);
        if (dx) {
            setRequestPlace(cell, { x: Math.min(Math.max(place.x + dx, 1), cols - place.w + 1) });
            return;
        }
        const neighbours = getRequestColumnNeighbours(grid, cell, cols, place.x, place.w);
        const neighbour = dy < 0 ? neighbours.filter(n => n.place.y < place.y).at(-1) : neighbours.find(n => n.place.y > place.y);
        if (neighbour) setRequestPlace(cell, { y: neighbour.place.y + (dy < 0 ? -0.5 : 0.5) });
    }

    function getRequestScroller(grid) {
        for (let el = grid.parentElement; el && el !== document.body; el = el.parentElement) {
            const overflow = getComputedStyle(el).overflowY;
            if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) return el;
        }
        return document.scrollingElement;
    }

    function toggleRequestBlockHidden(cell) {
        const block = getRequestBlock(cell);
        block.hidden = !block.hidden;
        commitRequestLayout();
    }

    // 📌 — блок открывает ряд вместе с соседями, которые сейчас стоят рядом с ним в других колонках
    // (например, «Відповідальний відділ» и «Відповідальний агент»). Порядок перестраивается так:
    // всё, что выше, — затем этот блок и его соседи слева направо — затем остальное.
    function toggleRequestRow(cell) {
        const grid = cell.parentElement;
        const cols = getGridColumnCount(grid);
        snapshotRequestLayout(grid, cols);
        const block = getRequestBlock(cell);
        const place = getRequestPlace(block, cols);
        if (place.row) {
            setRequestPlace(cell, { row: false });
            return;
        }
        const rect = cell.getBoundingClientRect();
        // Все блоки с местом, в том числе отсутствующие в этой заявке (у них нет rect).
        const cellsByBlock = new Map(getLayoutCells(grid).map(other => [requestLayout.blocks[findLayoutBlock(getCellIds(other))], other]));
        const others = requestLayout.blocks.filter(other => other !== block && getRequestPlace(other, cols)).map(other => {
            const otherRect = cellsByBlock.get(other)?.getBoundingClientRect();
            return { block: other, place: getRequestPlace(other, cols), rect: otherRect?.height > 0 ? otherRect : null };
        });
        // В каждой свободной колонке сосед — ближайший по высоте блок, который начинается не выше
        // середины закреплённого и не ниже его нижнего края с небольшим запасом.
        const used = new Set(Array.from({ length: place.w }, (_, i) => place.x + i));
        const members = [];
        others
            .filter(({ rect: r }) => r && r.top >= rect.top - rect.height / 2 && r.top <= rect.bottom + 50)
            .sort((a, b) => Math.abs(a.rect.top - rect.top) - Math.abs(b.rect.top - rect.top))
            .forEach(item => {
                const columns = Array.from({ length: item.place.w }, (_, i) => item.place.x + i);
                if (columns.some(column => used.has(column))) return;
                columns.forEach(column => used.add(column));
                members.push(item);
            });
        members.sort((a, b) => a.place.x - b.place.x);
        const rest = others.filter(item => !members.includes(item));
        const isAbove = ({ place: p, rect: r }) => r ? r.top < rect.top - 4 : p.y < place.y;
        const byOrder = (a, b) => a.place.y - b.place.y;
        const ordered = [...rest.filter(isAbove).sort(byOrder), { block, place }, ...members, ...rest.filter(item => !isAbove(item)).sort(byOrder)];
        ordered.forEach((item, index) => { item.block.place[cols] = { ...item.place, y: index }; });
        block.place[cols].row = true;
        normalizeRequestOrder(cols);
        commitRequestLayout();
    }

    function toggleRequestField(id) {
        const index = requestLayout.hiddenFields.indexOf(id);
        if (index >= 0) requestLayout.hiddenFields.splice(index, 1);
        else requestLayout.hiddenFields.push(id);
        commitRequestLayout();
    }

    // Список полей блока: каждое поле и его название прячутся отдельно, не трогая соседей по ячейке.
    function showRequestFieldsMenu(cell, anchor) {
        closeRequestLayoutMenu();
        const menu = document.createElement('nav');
        menu.className = 'ovolya-rf-ui ovolya-rf-menu';
        menu.setAttribute('role', 'menu');
        for (const field of getCellFields(cell)) {
            const id = getFieldId(field);
            const row = document.createElement('p');
            row.className = 'ovolya-rf-field-row';
            const item = document.createElement('button');
            item.type = 'button';
            item.setAttribute('role', 'menuitemcheckbox');
            item.className = 'ovolya-rf-field-item';
            item.innerHTML = requestLayoutIcons.eye + requestLayoutIcons.eyeOff;
            item.append(getFieldTitle(field));
            const label = document.createElement('button');
            label.type = 'button';
            label.setAttribute('role', 'menuitemcheckbox');
            label.className = 'ovolya-rf-field-label';
            label.textContent = 'Aa';
            const update = () => {
                const hidden = requestLayout.hiddenFields.includes(id);
                item.setAttribute('aria-checked', String(!hidden));
                item.title = t(hidden ? 'layoutShowField' : 'layoutHideField');
                const labelHidden = requestLayout.hiddenLabels.includes(id);
                label.setAttribute('aria-checked', String(!labelHidden));
                label.title = t(labelHidden ? 'layoutShowLabels' : 'layoutHideLabels');
            };
            update();
            item.addEventListener('click', () => {
                toggleRequestField(id);
                update();
            });
            label.addEventListener('click', () => {
                toggleRequestLabel(id);
                update();
            });
            row.append(item, label);
            menu.append(row);
        }
        document.body.append(menu);
        const rect = anchor.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(0, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 2))}px`;
        menu.style.top = `${Math.min(rect.bottom + 2, window.innerHeight - menuRect.height - 2)}px`;
        requestLayoutMenu = menu;
        menu.querySelector('button')?.focus({ preventScroll: true });
    }

    function toggleRequestLabel(id) {
        const index = requestLayout.hiddenLabels.indexOf(id);
        if (index >= 0) requestLayout.hiddenLabels.splice(index, 1);
        else requestLayout.hiddenLabels.push(id);
        commitRequestLayout();
    }

    function toggleRequestCellLabels(cell) {
        const ids = getCellFields(cell).map(getFieldId);
        const allHidden = ids.every(id => requestLayout.hiddenLabels.includes(id));
        requestLayout.hiddenLabels = requestLayout.hiddenLabels.filter(id => !ids.includes(id));
        if (!allHidden) requestLayout.hiddenLabels.push(...ids);
        commitRequestLayout();
    }

    function toggleRequestOption(id, text) {
        const options = Array.isArray(requestLayout.hiddenOptions[id]) ? requestLayout.hiddenOptions[id] : [];
        requestLayout.hiddenOptions[id] = options.includes(text) ? options.filter(option => option !== text) : [...options, text];
        if (!requestLayout.hiddenOptions[id].length) delete requestLayout.hiddenOptions[id];
        commitRequestLayout();
    }

    function resetRequestLayout() {
        if (!confirm(t('layoutResetConfirm'))) return;
        requestLayout = createEmptyRequestLayout();
        localStorage.removeItem(REQUEST_LAYOUT_KEY);
        enhanceRequestForm();
    }

    // ⠿ переносит блок в колонку под курсором и на место между соседями (синяя линия);
    // правый край меняет ширину в колонках, нижний — минимальную высоту.
    function startRequestBlockDrag(event) {
        if (event.button !== 0) return;
        const grip = event.currentTarget;
        const edge = grip.dataset.edge || '';
        const cell = grip.closest('.rf-cell');
        const grid = cell?.parentElement;
        if (!grid) return;
        event.preventDefault();
        grip.setPointerCapture(event.pointerId);
        const cols = getGridColumnCount(grid);
        snapshotRequestLayout(grid, cols);
        const start = getRequestPlace(getRequestBlock(cell), cols);
        // Блок держится за ту колонку, за которую его взяли.
        const grabColumn = Math.min(findRequestTrack(measureRequestGrid(grid).columns, event.clientX), cols) - start.x;
        const scroller = getRequestScroller(grid);
        let ghost = null, marker = null, target = null;
        const move = moveEvent => {
            if (!marker) {
                if (Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 4) return;
                marker = document.createElement('i');
                marker.className = `ovolya-rf-ui ${edge ? 'ovolya-rf-slot' : 'ovolya-rf-drop'}`;
                ghost = document.createElement('p');
                ghost.className = 'ovolya-rf-ui ovolya-rf-ghost';
                document.body.append(marker, ghost);
                cell.classList.add('ovolya-rf-moving');
                document.documentElement.classList.add('ovolya-rf-dragging');
            }
            if (moveEvent.clientY < 40) scroller.scrollBy(0, -24);
            else if (moveEvent.clientY > window.innerHeight - 40) scroller.scrollBy(0, 24);
            // Сетка пересчитывается на каждом шаге: страница могла прокрутиться.
            const columns = measureRequestGrid(grid).columns;
            const column = Math.min(findRequestTrack(columns, moveEvent.clientX), cols);
            const rect = cell.getBoundingClientRect();
            target = {};
            let x = start.x, w = start.w, top = rect.top, bottom = rect.bottom;
            if (!edge) {
                x = target.x = Math.min(Math.max(column - grabColumn, 1), cols - start.w + 1);
                const drop = getRequestDropTarget(grid, cell, cols, x, w, moveEvent.clientY);
                target.y = drop.y;
                top = drop.lineY - 1;
                bottom = drop.lineY + 1;
            }
            if (edge.includes('r')) w = target.w = Math.min(Math.max(column - start.x + 1, 1), cols - start.x + 1);
            if (edge.includes('b')) {
                target.mh = Math.max(0, Math.round((moveEvent.clientY - rect.top) / 4) * 4);
                bottom = rect.top + target.mh;
            }
            const first = columns[x - 1];
            const last = columns[x + w - 2];
            Object.assign(marker.style, {
                left: `${first.start}px`, top: `${top}px`,
                width: `${last.end - first.start}px`, height: `${Math.max(bottom - top, 2)}px`
            });
            ghost.style.left = `${moveEvent.clientX + 12}px`;
            ghost.style.top = `${moveEvent.clientY + 12}px`;
            ghost.textContent = getCellTitle(cell) + (edge ? ` · ${w} × ${target.mh ?? Math.round(rect.height)}px` : '');
        };
        const finish = finishEvent => {
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', finish);
            grip.removeEventListener('pointercancel', finish);
            requestLayoutDragCancel = null;
            ghost?.remove();
            marker?.remove();
            cell.classList.remove('ovolya-rf-moving');
            document.documentElement.classList.remove('ovolya-rf-dragging');
            if (finishEvent?.type === 'pointerup' && target && Object.keys(target).length) setRequestPlace(cell, target);
        };
        requestLayoutDragCancel = () => {
            if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
            finish(null);
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', finish);
        grip.addEventListener('pointercancel', finish);
    }

    function setRequestLayoutEditing(editing) {
        requestLayoutEditing = editing;
        document.documentElement.classList.toggle('ovolya-rf-edit', editing);
        if (editing && document.activeElement?.closest('.rf-grid')) document.activeElement.blur();
        enhanceRequestForm();
    }

    function closeRequestLayoutMenu() {
        requestLayoutMenu?.remove();
        requestLayoutMenu = null;
    }

    function showRequestLayoutMenu(x, y) {
        closeRequestLayoutMenu();
        const menu = document.createElement('nav');
        menu.className = 'ovolya-rf-ui ovolya-rf-menu';
        menu.setAttribute('role', 'menu');
        const items = [
            [requestLayoutEditing ? 'layoutDone' : 'layoutEdit', () => setRequestLayoutEditing(!requestLayoutEditing)],
            ['layoutReset', resetRequestLayout]
        ];
        for (const [key, action] of items) {
            const item = document.createElement('button');
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.textContent = t(key);
            item.addEventListener('click', () => { closeRequestLayoutMenu(); action(); });
            menu.append(item);
        }
        menu.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const buttons = [...menu.querySelectorAll('button')];
            const next = buttons.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1);
            buttons[(next + buttons.length) % buttons.length].focus();
        });
        document.body.append(menu);
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width - 2))}px`;
        menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 2))}px`;
        requestLayoutMenu = menu;
        menu.querySelector('button').focus({ preventScroll: true });
    }

    function ensureRequestLayoutStyle() {
        if (document.getElementById('ovolya-request-layout-style')) return;
        const style = document.createElement('style');
        style.id = 'ovolya-request-layout-style';
        // Оформление в стиле HTML Note: прямые углы, акцент #5aa9ff, панели #26282d / #2b3b52.
        style.textContent = `
            html:not(.ovolya-rf-edit) .rf-grid > .ovolya-rf-block-hidden { display:none !important; }
            .rf-grid .ovolya-rf-label-hidden .control-label-text { display:none !important; }
            html:not(.ovolya-rf-edit) .ovolya-rf-option-hidden:not(:has([data-p-checked="true"])) { display:none !important; }
            [key][label].ovolya-rf-empty { display:block; background-color:#202228; box-shadow:0 0 0 3px #202228; }
            html.ovolya-rf-edit .rf-grid > .rf-cell { position:relative; min-height:34px; outline:1px dashed #5aa9ff88; outline-offset:2px; }
            html.ovolya-rf-edit .rf-grid > .rf-cell > :not(.ovolya-rf-ui) { pointer-events:none; }
            html.ovolya-rf-edit .rf-grid :is(.radio-button-label, .checkbox-label, .control-label-text) { pointer-events:auto; cursor:pointer; }
            html.ovolya-rf-edit .rf-grid textarea { pointer-events:auto; resize:vertical !important; outline:1px dashed #5aa9ff88; outline-offset:-1px; }
            html.ovolya-rf-edit .rf-grid :is(.radio-button-label, .checkbox-label, .control-label-text):hover { outline:1px solid #5aa9ff; outline-offset:1px; }
            html.ovolya-rf-edit .rf-grid .ovolya-rf-option-hidden { opacity:.35 !important; text-decoration:line-through; outline:1px dashed #9a9ba3; outline-offset:-1px; }
            html:not(.ovolya-rf-edit) .rf-grid .ovolya-rf-field-hidden { display:none !important; }
            html.ovolya-rf-edit .rf-grid .ovolya-rf-field-hidden { opacity:.3; outline:1px dashed #9a9ba3; outline-offset:-1px; }
            .ovolya-rf-menu .ovolya-rf-field-row { display:flex; margin:0; padding:0; }
            .ovolya-rf-menu .ovolya-rf-field-item { display:flex; align-items:center; gap:8px; flex:1 1 auto; }
            .ovolya-rf-menu .ovolya-rf-field-label { flex:none; width:auto; padding:7px 12px; }
            .ovolya-rf-field-label[aria-checked="false"] { color:#9a9ba3; text-decoration:line-through; }
            .ovolya-rf-menu .ovolya-rf-field-item svg { flex:none; width:15px; height:15px; }
            .ovolya-rf-field-item .ovolya-rf-eye-off, .ovolya-rf-field-item[aria-checked="false"] .ovolya-rf-eye { display:none; }
            .ovolya-rf-field-item[aria-checked="false"] { color:#9a9ba3; text-decoration:line-through; }
            .ovolya-rf-field-item[aria-checked="false"] .ovolya-rf-eye-off { display:block; }
            html.ovolya-rf-edit .rf-grid > .ovolya-rf-block-hidden { outline-color:#9a9ba3; }
            html.ovolya-rf-edit .rf-grid > .ovolya-rf-block-hidden > :not(.ovolya-rf-ui) { opacity:.3; }
            .rf-grid > .ovolya-rf-moving { opacity:.45; }
            html.ovolya-rf-dragging, html.ovolya-rf-dragging * { cursor:grabbing !important; user-select:none !important; }
            .ovolya-rf-bar { position:absolute; top:-3px; right:-3px; z-index:3; display:flex; margin:0; padding:0; background:#2b3b52; box-shadow:0 6px 18px #000a; font:12px/1 'Segoe UI', Arial, sans-serif; }
            .ovolya-rf-bar button { display:flex; align-items:center; justify-content:center; width:24px; height:22px; margin:0; padding:0; border:0; border-radius:0; background:transparent; color:#cfe4ff; cursor:pointer; font:inherit; font-size:13px; }
            .ovolya-rf-bar button[hidden] { display:none; }
            .ovolya-rf-bar button:hover { background:#3a5272; }
            .ovolya-rf-bar button:focus-visible, .ovolya-rf-btn:focus-visible { outline:2px solid #5aa9ff; outline-offset:-2px; }
            .ovolya-rf-bar button[data-action="drag"] { cursor:grab; touch-action:none; }
            .ovolya-rf-bar button[data-action="labels"] { width:28px; font-size:12px; }
            .ovolya-rf-bar button[aria-pressed="true"] { background:#18191c; color:#9a9ba3; }
            .ovolya-rf-bar button[data-action="labels"][aria-pressed="true"] { text-decoration:line-through; }
            .ovolya-rf-bar button[data-action="row"][aria-pressed="true"] { background:#5aa9ff; color:#0b1320; }
            html.ovolya-rf-edit .rf-grid > .ovolya-rf-row { box-shadow:0 -2px 0 #5aa9ff; }
            .ovolya-rf-bar svg { display:block; width:15px; height:15px; }
            .ovolya-rf-bar .ovolya-rf-eye-off, .ovolya-rf-bar [aria-pressed="true"] .ovolya-rf-eye { display:none; }
            .ovolya-rf-bar [aria-pressed="true"] .ovolya-rf-eye-off { display:block; }
            .ovolya-rf-hint { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; margin:0 1rem 8px; padding:8px 10px; background:#26282d; border:1px solid #3a3c42; border-left:3px solid #5aa9ff; border-radius:0; color:#e6e6e9; font:12.5px/1.5 'Segoe UI', Arial, sans-serif; }
            .ovolya-rf-hint strong { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#9a9ba3; font-weight:700; }
            .ovolya-rf-hint p { flex:1 1 320px; margin:0; color:#9a9ba3; }
            .ovolya-rf-btn { height:26px; margin:0; padding:0 10px; border:1px solid #44464d; border-radius:0; background:#2a2c31; color:#e6e6e9; cursor:pointer; font:inherit; }
            .ovolya-rf-btn:hover { background:#33353b; }
            .ovolya-rf-btn-primary { background:#5aa9ff; border-color:#5aa9ff; color:#0b1320; font-weight:600; }
            .ovolya-rf-btn-primary:hover { background:#7bbaff; }
            .ovolya-rf-menu { position:fixed; z-index:100000; min-width:190px; margin:0; padding:4px 0; background:#26282d; border:1px solid #3a3c42; border-radius:0; box-shadow:0 8px 24px #000a; font:13px 'Segoe UI', Arial, sans-serif; }
            .ovolya-rf-menu button { display:block; width:100%; margin:0; padding:7px 14px; border:0; border-radius:0; background:transparent; color:#e6e6e9; text-align:left; white-space:nowrap; cursor:pointer; font:inherit; }
            .ovolya-rf-menu button:is(:hover, :focus-visible) { background:#2b3b52; color:#cfe4ff; outline:none; }
            .ovolya-rf-ghost { position:fixed; z-index:100001; margin:0; padding:4px 8px; pointer-events:none; background:#2b3b52; color:#cfe4ff; box-shadow:0 6px 18px #000a; font:12px 'Segoe UI', Arial, sans-serif; }
            .app-action-buttons .ovolya-save-moved { display:none !important; }
            .ovolya-save-tab { display:flex; align-items:center; justify-content:center; width:100%; border:0; border-radius:0; background:transparent; color:#cfd3da; cursor:pointer; }
            .ovolya-save-tab svg { display:block; width:26px; height:26px; fill:currentColor; }
            .ovolya-save-tab:hover { color:#cfe4ff; }
            .ovolya-save-tab:focus-visible { outline:2px solid #5aa9ff; outline-offset:-2px; }
            .ovolya-save-tab:disabled { opacity:.4; cursor:default; }
            .ovolya-save-tip { position:fixed; z-index:100001; margin:0; padding:4px 8px; pointer-events:none; background:#26282d; color:#e6e6e9; border:1px solid #3a3c42; box-shadow:0 6px 18px #000a; font:12px 'Segoe UI', Arial, sans-serif; white-space:nowrap; }
            .ovolya-rf-drop { position:fixed; z-index:100000; display:block; pointer-events:none; background:#5aa9ff; }
            .ovolya-rf-slot { position:fixed; z-index:100000; display:block; pointer-events:none; background:#5aa9ff26; outline:1px solid #5aa9ff; }
            .ovolya-rf-handle { position:absolute; z-index:3; display:block; opacity:0; touch-action:none; transition:opacity .1s; }
            .ovolya-rf-handle[data-edge="r"] { top:0; right:-7px; width:8px; height:100%; cursor:ew-resize; }
            .ovolya-rf-handle[data-edge="b"] { left:0; bottom:-7px; width:100%; height:8px; cursor:ns-resize; }
            .ovolya-rf-handle[data-edge="br"] { right:-9px; bottom:-9px; width:12px; height:12px; cursor:nwse-resize; background:#5aa9ff; }
            .rf-grid > .rf-cell:hover > .ovolya-rf-handle, .rf-grid > .ovolya-rf-moving > .ovolya-rf-handle { opacity:1; }
            .rf-grid > .rf-cell:hover > .ovolya-rf-handle:is([data-edge="r"], [data-edge="b"]) { background:#5aa9ff55; }
        `;
        document.head.appendChild(style);
    }

    // ======== «Зберегти» в левом меню заявки, под «Історія» ========
    // Ярлык нажимает настоящую кнопку формы: та остаётся в DOM скрытой, Angular отправляет форму как обычно.
    let requestSaveTip = null;

    function getRequestSaveButton() { return document.querySelector('app-requests-form .app-action-buttons button[type="submit"]'); }

    function hideRequestSaveTip() {
        requestSaveTip?.remove();
        requestSaveTip = null;
    }

    function showRequestSaveTip(tab) {
        hideRequestSaveTip();
        const rect = tab.getBoundingClientRect();
        requestSaveTip = document.createElement('p');
        requestSaveTip.className = 'ovolya-rf-ui ovolya-save-tip';
        requestSaveTip.textContent = tab.getAttribute('aria-label');
        document.body.append(requestSaveTip);
        requestSaveTip.style.left = `${rect.right + 6}px`;
        requestSaveTip.style.top = `${rect.top + (rect.height - requestSaveTip.offsetHeight) / 2}px`;
    }

    function createRequestSaveTab() {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'dpl-aside-link dpl-aside-tab ovolya-save-tab';
        tab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 9H5V5h10m-3 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6m5-16H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4Z"/></svg>';
        tab.addEventListener('click', () => {
            hideRequestSaveTip();
            getRequestSaveButton()?.click();
        });
        tab.addEventListener('pointerenter', () => showRequestSaveTip(tab));
        tab.addEventListener('pointerleave', hideRequestSaveTip);
        tab.addEventListener('focus', () => { if (tab.matches(':focus-visible')) showRequestSaveTip(tab); });
        tab.addEventListener('blur', hideRequestSaveTip);
        return tab;
    }

    function manageRequestSaveTab() {
        const saveButton = getRequestSaveButton();
        const tabs = [...document.querySelectorAll('.dpl-aside-group > .dpl-aside-tab')];
        const anchor = tabs.find(tab => tab.getAttribute('aria-label') === 'Історія') || tabs.at(-1);
        let tab = document.querySelector('.ovolya-save-tab');
        if (!saveButton || !anchor) {
            // Нет меню вкладок (например, создание заявки) — кнопка остаётся на своём месте.
            tab?.remove();
            hideRequestSaveTip();
            document.querySelectorAll('.ovolya-save-moved').forEach(el => el.classList.remove('ovolya-save-moved'));
            return;
        }
        if (!tab) tab = createRequestSaveTab();
        const group = anchor.parentElement;
        if (tab.previousElementSibling !== group) group.after(tab);
        const label = (saveButton.querySelector('.p-button-label') || saveButton).textContent.trim() || 'Зберегти';
        if (tab.getAttribute('aria-label') !== label) tab.setAttribute('aria-label', label);
        if (tab.disabled !== saveButton.disabled) tab.disabled = saveButton.disabled;
        const host = saveButton.closest('p-button') || saveButton;
        if (!host.classList.contains('ovolya-save-moved')) host.classList.add('ovolya-save-moved');
    }

    function enhanceRequestForm() {
        const grids = document.querySelectorAll('app-requests-form .rf-grid');
        if (grids.length) ensureRequestLayoutStyle();
        manageRequestSaveTab();
        if (!grids.length) {
            if (requestLayoutEditing) {
                requestLayoutEditing = false;
                document.documentElement.classList.remove('ovolya-rf-edit');
            }
            closeRequestLayoutMenu();
            return;
        }
        grids.forEach(grid => {
            applyRequestLayout(grid);
            updateRequestLayoutHint(grid);
        });
    }

    // Отметка пустых полей зависит от выбора; PrimeNG меняет только атрибуты, поэтому слушаем ввод.
    function scheduleRequestFormRefresh() {
        clearTimeout(requestLayoutRefreshTimer);
        requestLayoutRefreshTimer = setTimeout(enhanceRequestForm, 60);
    }
    ['input', 'change', 'click', 'keyup'].forEach(type => document.addEventListener(type, scheduleRequestFormRefresh, true));

    // В режиме настройки щелчок по варианту или подписи прячет его, а не меняет заявку.
    document.addEventListener('click', event => {
        if (!requestLayoutEditing || !(event.target instanceof Element) || event.target.closest('.ovolya-rf-ui')) return;
        if (!event.target.closest('app-requests-form .rf-grid')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const field = event.target.closest(REQUEST_FIELD_SELECTOR);
        if (!field) return;
        const option = event.target.closest('.radio-button-label, .checkbox-label');
        if (option) toggleRequestOption(getFieldId(field), getOptionText(option));
        else if (event.target.closest('.control-label-text')) toggleRequestLabel(getFieldId(field));
    }, true);

    document.addEventListener('contextmenu', event => {
        const button = event.target instanceof Element && event.target.closest('app-requests-form .app-action-buttons button[type="submit"], .ovolya-save-tab');
        if (!button) return;
        event.preventDefault();
        showRequestLayoutMenu(event.clientX, event.clientY);
    }, true);

    document.addEventListener('pointerdown', event => {
        if (requestLayoutMenu && !requestLayoutMenu.contains(event.target)) closeRequestLayoutMenu();
    }, true);
    document.addEventListener('pointerup', event => {
        if (requestLayoutEditing && event.target instanceof HTMLTextAreaElement && event.target.closest('.rf-grid')) {
            saveRequestTextareaHeight(event.target);
        }
    }, true);
    // Поля заявки не меняются, пока идёт настройка (вставка, перетаскивание текста и т. п.).
    document.addEventListener('beforeinput', event => {
        if (requestLayoutEditing && event.target instanceof Element && event.target.closest('.rf-grid')) event.preventDefault();
    }, true);
    window.addEventListener('blur', closeRequestLayoutMenu);
    window.addEventListener('resize', closeRequestLayoutMenu);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            if (requestLayoutDragCancel) requestLayoutDragCancel();
            else if (requestLayoutMenu) closeRequestLayoutMenu();
            else if (requestLayoutEditing) setRequestLayoutEditing(false);
            else return;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        // Клавиатура не меняет поля заявки, пока идёт настройка.
        if (requestLayoutEditing && event.key !== 'Tab' && event.target instanceof Element &&
            event.target.closest('.rf-grid') && !event.target.closest('.ovolya-rf-ui')) {
            event.preventDefault();
        }
    }, true);

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
            "ttsCriticalTickets": "заявки перша критичність",
            "layoutEdit": "Налаштувати блоки заявки",
            "layoutDone": "Завершити налаштування блоків",
            "layoutReset": "Скинути налаштування блоків",
            "layoutResetConfirm": "Скинути порядок блоків, приховані блоки, назви та варіанти?",
            "layoutTitle": "Налаштування блоків",
            "layoutHint": "Перетягніть блок за ⠿ у потрібну колонку: синя лінія показує, між якими блоками він стане. Блоки в колонці йдуть щільно один за одним і самі піднімаються, коли блок вище прихований або його немає в заявці. Правий край — ширина в колонках, нижній — мінімальна висота. Висоту текстового поля (наприклад, «Опис статусу») задайте його правим нижнім кутом — вона запам'ятається як мінімальна. Кнопка 📌 закріплює ряд: блок і сусіди праворуч стоять на одній лінії й не з'їжджають. Кнопка ☰ ховає окреме поле чи його назву, якщо в блоці їх кілька. Клік по назві ховає її одразу, як після збереження (повернути — «Aa»), клік по варіанту ховає або повертає його; прихована назва з'являється в підказці при наведенні. Esc — завершити.",
            "layoutMoveLeft": "У колонку ліворуч",
            "layoutMoveRight": "У колонку праворуч",
            "layoutMoveUp": "Вище в колонці",
            "layoutMoveDown": "Нижче в колонці",
            "layoutResizeWidth": "Тягніть, щоб змінити ширину",
            "layoutResizeHeight": "Тягніть, щоб змінити мінімальну висоту",
            "layoutResize": "Тягніть, щоб змінити ширину й мінімальну висоту",
            "layoutResetShort": "Скинути",
            "layoutDoneShort": "Готово",
            "layoutDrag": "Перетягнути блок",
            "layoutHideBlock": "Сховати блок",
            "layoutShowBlock": "Показати блок",
            "layoutHideLabels": "Сховати назву",
            "layoutShowLabels": "Показати назву",
            "layoutFields": "Поля блоку: сховати окреме поле",
            "layoutHideField": "Сховати поле",
            "layoutShowField": "Показати поле",
            "layoutRowStart": "Закріпити ряд: блок починає новий ряд, а блоки після нього в інших колонках стають на ту саму лінію",
            "layoutRowStop": "Ряд закріплено — натисніть, щоб відкріпити"
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
            "ttsCriticalTickets": "заявки первая критичность",
            "layoutEdit": "Настроить блоки заявки",
            "layoutDone": "Завершить настройку блоков",
            "layoutReset": "Сбросить настройку блоков",
            "layoutResetConfirm": "Сбросить порядок блоков, скрытые блоки, названия и варианты?",
            "layoutTitle": "Настройка блоков",
            "layoutHint": "Перетащите блок за ⠿ в нужную колонку: синяя линия показывает, между какими блоками он встанет. Блоки в колонке идут плотно друг за другом и сами поднимаются, когда блок выше скрыт или его нет в заявке. Правый край — ширина в колонках, нижний — минимальная высота. Высоту текстового поля (например, «Опис статусу») задайте его правым нижним углом — она запомнится как минимальная. Кнопка 📌 закрепляет ряд: блок и соседи справа стоят на одной линии и не съезжают. Кнопка ☰ скрывает отдельное поле или его название, если в блоке их несколько. Клик по названию скрывает его сразу, как после сохранения (вернуть — «Aa»), клик по варианту скрывает или возвращает его; скрытое название видно в подсказке при наведении. Esc — завершить.",
            "layoutMoveLeft": "В колонку слева",
            "layoutMoveRight": "В колонку справа",
            "layoutMoveUp": "Выше в колонке",
            "layoutMoveDown": "Ниже в колонке",
            "layoutResizeWidth": "Тяните, чтобы изменить ширину",
            "layoutResizeHeight": "Тяните, чтобы изменить минимальную высоту",
            "layoutResize": "Тяните, чтобы изменить ширину и минимальную высоту",
            "layoutResetShort": "Сбросить",
            "layoutDoneShort": "Готово",
            "layoutDrag": "Перетащить блок",
            "layoutHideBlock": "Скрыть блок",
            "layoutShowBlock": "Показать блок",
            "layoutHideLabels": "Скрыть название",
            "layoutShowLabels": "Показать название",
            "layoutFields": "Поля блока: скрыть отдельное поле",
            "layoutHideField": "Скрыть поле",
            "layoutShowField": "Показать поле",
            "layoutRowStart": "Закрепить ряд: блок начинает новый ряд, а блоки после него в других колонках встают на ту же линию",
            "layoutRowStop": "Ряд закреплён — нажмите, чтобы открепить"
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
        // Панели настройки блоков пересоздаются с новыми подписями.
        document.querySelectorAll('.rf-cell > .ovolya-rf-ui, .ovolya-rf-hint').forEach(el => el.remove());
        closeRequestLayoutMenu();
        enhanceRequestForm();
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
        if (e.key === REQUEST_LAYOUT_KEY) {
            requestLayout = readRequestLayout();
            enhanceRequestForm();
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
            enhanceRequestForm();
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
