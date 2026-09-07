// ==UserScript==
// @name         О sd.bitech
// @namespace    http://tampermonkey.net/
// @version      20260906.7
// @description  Видалення кнопки виходу. Компактні списки заявок. Ярлики. Моніторинг нових заявок + Звук и Фильтры + Системные уведомления
// @author       Ovolsan
// @match        *://sd.bitech.com.ua/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bitech.com.ua
// @updateURL    https://github.com/Ovolsan/O-sd.bitech/raw/refs/heads/main/O%20sd.bitech.user.js
// @downloadURL  https://github.com/Ovolsan/O-sd.bitech/raw/refs/heads/main/O%20sd.bitech.user.js
// ==/UserScript==

(function () {
    'use strict';
    let lastShortcutsSnapshot = '';

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

    // ==============================УДАЛЕНИЕ КНОПКИ ВЫХОДА==============================
    function manageLogoutButton() {
        const logoutBtn = [...document.querySelectorAll('button')]
            .find(b => b.querySelector('.fa-sign-out-alt') || b.textContent.trim() === "Вийти");
        if (!logoutBtn) return;
        if (!window.location.pathname.includes('/admin/profile')) {
            logoutBtn.remove();
        }
    }

    // =================================ПОИСК НИЖНЕГО КОНТЕЙНЕРА С КНОПКАМИ===========================
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
            let iconClass = '', title = '';
            if (text.includes('Фільтр') || text.includes('Фільтрувати')) { iconClass = 'ovolya-btn-filter'; title = 'Фільтрувати'; }
            else if (text.includes('Додати')) { iconClass = 'ovolya-btn-add'; title = 'Додати'; }
            else if (text.includes('Редагувати')) { iconClass = 'ovolya-btn-edit'; title = 'Редагувати'; }
            else if (btn.getAttribute('aria-label') === 'Інші дії' || btn.classList.contains('p-splitbutton-dropdown')) { iconClass = 'ovolya-btn-more'; title = 'Інші дії'; }
            else return;

            const shortcut = document.createElement('button');
            shortcut.className = `ovolya-shortcut-btn ovolya-btn-icon-mode ${iconClass}`;
            shortcut.title = title;
            shortcut.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); btn.click(); });
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
            if (fullName === 'Мої заявки') return;
            let shortName = QUEUE_MAP[fullName] || (fullName.length > 10 ? fullName.substring(0, 10) : fullName);

            const shortcut = document.createElement('a');
            shortcut.className = 'ovolya-queue-shortcut';
            shortcut.textContent = shortName;
            shortcut.title = fullName;
            shortcut.href = anchor.getAttribute('href') || '#';
            shortcut.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); anchor.click(); lastShortcutsSnapshot = ''; });
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

        const currentSnapshot = Array.from(customContainer.querySelectorAll('.ovolya-queue-shortcut, .ovolya-shortcut-btn'))
            .map(el => `${el.className}:${el.textContent.trim()}:${el.title}`).join('|');
        if (currentSnapshot === lastShortcutsSnapshot && currentSnapshot !== '') return;

        createQueueShortcuts(customContainer);
        createActionShortcuts(customContainer);
        lastShortcutsSnapshot = Array.from(customContainer.querySelectorAll('.ovolya-queue-shortcut, .ovolya-shortcut-btn'))
            .map(el => `${el.className}:${el.textContent.trim()}:${el.title}`).join('|');
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
    const requestFilterTypeNames = {
        title: 'Название',
        department: 'Отдел',
        id: 'ID'
    };
    let muteRules = JSON.parse(localStorage.getItem('sd_mute_rules') || '[]');
    if (muteRules.length > 0 && typeof muteRules[0] === 'string') {
        muteRules = muteRules.map(text => ({ type: 'title', text }));
        saveMuteRules();
    }
    let standardAudioData = localStorage.getItem('sd_snd_std') || null;
    let afkAudioData = localStorage.getItem('sd_snd_afk') || null;
    let isNightMode = localStorage.getItem('sd_night_mode') === 'true';
    let currentAudio = null;
    let isMenuOpen = false;
    let activeTab = null;
    let lastRenderedTab = null;
    const REQUEST_FILTERS_KEY = 'sd_request_filter_rules';
    let requestFilterRules = JSON.parse(localStorage.getItem(REQUEST_FILTERS_KEY) || '[]');

    function saveRequestFilterRules() { localStorage.setItem(REQUEST_FILTERS_KEY, JSON.stringify(requestFilterRules)); }
    function saveMuteRules() { localStorage.setItem('sd_mute_rules', JSON.stringify(muteRules)); }

    function stopCurrentAudio() { if (currentAudio) { currentAudio.pause(); currentAudio = null; } }

    // глобальный сброс
    document.addEventListener('click', (e) => {
        if (e.target.closest('#ovolya-monitor-debug-container')) return;

        if (e.isTrusted && currentAudio) stopCurrentAudio();

        if (monitorNotificationCount > 0) {
            const notif = document.querySelector('#ovolya-new-request-notification');
            if (notif) notif.remove();

            monitorPendingTickets.clear();
            monitorNotificationCount = 0;
            monitorStopTitleBlink();
            monitorUpdateDebug();
            
            if (monitorBrowserNotification) {
                try { monitorBrowserNotification.close(); } catch(err) {}
                monitorBrowserNotification = null;
            }
        }
    }, true);

    function playAlertSound(hasFirstCriticality = false, forceType = null) {
        stopCurrentAudio();
        const text = hasFirstCriticality ? 'заявки перша критичність' : 'заявки';
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'uk-UA'; utterance.rate = 0.8; utterance.volume = 1;

        utterance.onend = () => {
            let audioData = null;
            if (forceType === 'std') audioData = standardAudioData;
            else if (forceType === 'afk') audioData = afkAudioData;
            else audioData = isNightMode ? afkAudioData : standardAudioData;

            if (!audioData) return;
            currentAudio = new Audio(audioData);
            currentAudio.play().catch(e => console.log('Autoplay blocked:', e));
            currentAudio.onended = () => { currentAudio = null; };
        };
        speechSynthesis.speak(utterance);
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
            if (!rule || !rule.type || !rule.text) continue;
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
    const TARGET_URL = 'https://sd.bitech.com.ua/admin/requests?presetId=my-queues';
    const MONITOR_LOCK_KEY = 'ovolya_sd_new_requests_monitor_lock';
    const MONITOR_KNOWN_IDS_KEY = 'ovolya_sd_new_requests_known_ids';
    const MONITOR_TIMER_MAX_SEC = 10 * 60;
    const MONITOR_ADD_TIME_ON_BLUR_SEC = 2 * 20;
    const monitorToken = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

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

    // СТРОГАЯ ПРОВЕРКА URL
    function isMonitorTargetPage() {
        return window.location.href === TARGET_URL;
    }

    function monitorReadJSON(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
    function monitorWriteJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { } }
    function monitorReadLock() { try { const raw = localStorage.getItem(MONITOR_LOCK_KEY); if (!raw) return null; const lock = JSON.parse(raw); return (lock && lock.token && lock.expiresAt) ? lock : null; } catch (e) { return null; } }
    function monitorWriteLock() { try { localStorage.setItem(MONITOR_LOCK_KEY, JSON.stringify({ token: monitorToken, expiresAt: Date.now() + 8000 })); return true; } catch (e) { return false; } }

    function monitorAcquireLock() {
        if (!isMonitorTargetPage()) return false;
        const existing = monitorReadLock();
        if (existing && existing.token !== monitorToken && existing.expiresAt > Date.now()) { monitorIsOwner = false; return false; }
        monitorWriteLock();
        monitorIsOwner = (monitorReadLock()?.token === monitorToken);
        return monitorIsOwner;
    }

    function monitorRenewLock() { if (monitorIsOwner && isMonitorTargetPage()) monitorWriteLock(); }
    function monitorReleaseLock() { try { if (monitorReadLock()?.token === monitorToken) localStorage.removeItem(MONITOR_LOCK_KEY); } catch (e) { } monitorIsOwner = false; }
    function monitorGetKnownIds() { const ids = monitorReadJSON(MONITOR_KNOWN_IDS_KEY, []); return Array.isArray(ids) ? ids.map(String) : []; }
    function monitorSaveKnownIds(ids) { const unique = [...new Set(ids.map(String))]; monitorWriteJSON(MONITOR_KNOWN_IDS_KEY, unique.slice(Math.max(0, unique.length - 1000))); }

    function monitorCheckForNewTickets() {
        if (!isMonitorTargetPage()) return;
        if (!monitorIsOwner) return;
        
        const currentTickets = getCurrentTickets();
        if (currentTickets.length === 0) return;
        
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
            const c = ticket.criticality?.trim() || 'Невизначена';
            criticalityCounts.set(c, (criticalityCounts.get(c) || 0) + 1);
        }
        const criticalityText = [...criticalityCounts.entries()]
            .map(([name, count]) => count > 1 ? `${name} (${count})` : name)
            .join(', ');
        const body = `Нових заявок: ${tickets.length}\nКритичність: ${criticalityText}`;
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
        notification.style.cssText = 'position:fixed;top:15px;right:15px;z-index:1000000;background:#26282f;color:#e8e8e8;border:1px solid #ffaa00;border-radius:6px;padding:12px 16px;min-width:230px;max-width:360px;box-shadow:0 4px 18px rgba(0,0,0,.45);font-family:Arial,sans-serif;font-size:14px;cursor:pointer;';

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;margin-bottom:7px;color:#ffaa00;';
        title.textContent = `🟠 Нових заявок: ${tickets.length}`;
        notification.append(title);

        notification.addEventListener('click', () => {
            notification.remove();
            monitorPendingTickets.clear();
            monitorNotificationCount = 0;
            monitorStopTitleBlink();
            monitorUpdateDebug();
        });
        document.body.appendChild(notification);
        setTimeout(() => { if (notification.isConnected) notification.remove(); }, 15000);
    }

    function monitorStartTitleBlink() { 
        if (!monitorTitleBlinking) {
            monitorOriginalTitle = document.title;
            monitorTitleBlinking = true; 
        }
    }
    
    function monitorStopTitleBlink() { 
        monitorTitleBlinking = false; 
        if (document.title.includes('🟠 НОВЫЕ ЗАЯВКИ')) {
            document.title = monitorOriginalTitle; 
        }
    }

    // =====================DEBUG / НАСТРОЙКИ UI =======================================
    function renderPanelContent(panel) {
        panel.innerHTML = '';
        const btnActionStyle = 'background:#444; color:#fff; border:none; padding:6px 12px; cursor:pointer; border-radius:3px;';

        if (activeTab === 'rules') {
            panel.innerHTML = `
        <div style="display:flex; gap:10px; margin-bottom:15px; align-items:center;">
            <select id="ovolya-filter-type" style="background:#222; color:#fff; border:1px solid #555; padding:6px 10px; border-radius:3px;">
                <option value="title">Название</option>
                <option value="department">Отдел</option>
                <option value="id">ID</option>
            </select>
            <input id="ovolya-filter-value" placeholder="Значение..." style="flex-grow:1; padding:6px 10px; background:#222; color:#fff; border:1px solid #555; border-radius:3px;">
            <button id="ovolya-add-filter" style="background:#1e3a5f; color:#fff; border:none; padding:6px 12px; border-radius:3px; cursor:pointer;">Добавить</button>
        </div>
        <table style="width:100%; border-collapse:collapse; text-align:left; font-family: sans-serif; font-size:13px;">
            <tr>
                <th style="border:1px solid #444; padding:8px; background:#2a2a2a;">Тип</th>
                <th style="border:1px solid #444; padding:8px; background:#2a2a2a;">Значение</th>
                <th style="border:1px solid #444; padding:8px; background:#2a2a2a; width:80px;">Действие</th>
            </tr>
            ${requestFilterRules.length === 0 ? `<tr><td colspan="3" style="border:1px solid #444; padding:8px; text-align:center; color:#888;">Список пуст</td></tr>` : ''}
            ${requestFilterRules.map((rule, idx) => `
                <tr>
                    <td style="border:1px solid #444; padding:8px;">${requestFilterTypeNames[rule.type] || rule.type}</td>
                    <td style="border:1px solid #444; padding:8px; word-break: break-all;">${rule.text}</td>
                    <td style="border:1px solid #444; padding:8px; text-align:center;">
                        <button class="ovolya-del-filter" data-idx="${idx}" style="background:#522; color:#fff; border:none; padding:4px 8px; border-radius:3px; cursor:pointer;">Удалить</button>
                    </td>
                </tr>
            `).join('')}
        </table>
    `;

            panel.querySelector('#ovolya-add-filter').onclick = () => {
                const type = panel.querySelector('#ovolya-filter-type').value;
                const text = panel.querySelector('#ovolya-filter-value').value.trim();
                if (!text) return;

                if (type === 'id' && !/^\d+$/.test(text)) {
                    alert('ID заявки должен содержать только цифры');
                    return;
                }

                if (requestFilterRules.some(r => r.type === type && r.text.toLowerCase() === text.toLowerCase())) {
                    alert('Такой фильтр уже существует');
                    return;
                }

                requestFilterRules.push({ type, text });
                saveRequestFilterRules();
                lastRenderedTab = null;
                monitorUpdateDebug();
                hideBlacklistedTickets();
            };

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
            const notifStatusText = notifPermission === 'granted' ? 'Разрешено ✓'
                : notifPermission === 'denied' ? 'Заблокировано вручную ⚠️'
                : notifPermission === 'unsupported' ? 'Не поддерживается браузером ❌'
                : 'Не запрошено ❌';
            panel.innerHTML = `
                <div style="margin-bottom:15px; padding:10px; border:1px solid #444; background:#222; border-radius:4px; font-family: sans-serif;">
                    <h4 style="margin:0 0 5px 0;">Стандартная мелодия (☀️ День)</h4>
                    <p style="color:#888; font-size: 11px; margin:0 0 10px 0;">TTS "Заявки" + эта мелодия.</p>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="file" id="file_std" accept="audio/*" style="display:none;">
                        <button id="btn_std" style="${btnActionStyle} background:#333; border:1px solid #555;">Файл</button>
                        <span style="color:#888; font-size:11px; flex-grow:1;">${standardAudioData ? 'Загружено ✓' : 'Нет файла ❌'}</span>
                        <button id="test_std" style="${btnActionStyle}">Тест</button>
                    </div>
                </div>
                <div style="padding:10px; border:1px solid #444; background:#222; border-radius:4px; font-family: sans-serif;">
                    <h4 style="margin:0 0 5px 0;">AFK Мелодия (🌙 Ночь)</h4>
                    <p style="color:#888; font-size: 11px; margin:0 0 10px 0;">TTS "Заявки" + эта мелодия (Ночной режим).</p>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="file" id="file_afk" accept="audio/*" style="display:none;">
                        <button id="btn_afk" style="${btnActionStyle} background:#333; border:1px solid #555;">Файл</button>
                        <span style="color:#888; font-size:11px; flex-grow:1;">${afkAudioData ? 'Загружено ✓' : 'Нет файла ❌'}</span>
                        <button id="test_afk" style="${btnActionStyle}">Тест</button>
                    </div>
                </div>
                <p style="color:#ffaa00; font-size:11px; margin-top: 10px; font-family: sans-serif;">Файлы до 2 МБ. Звук останавливается кликом по странице.</p>
                <div style="margin-top:15px; padding:10px; border:1px solid #444; background:#222; border-radius:4px; font-family: sans-serif;">
                    <h4 style="margin:0 0 5px 0;">Системные уведомления браузера</h4>
                    <p style="color:#888; font-size: 11px; margin:0 0 10px 0;">Всплывающее уведомление от ОС/браузера при новой заявке (отдельно от звука и попапа на странице).</p>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span id="notif_status" style="color:#888; font-size:11px; flex-grow:1;">${notifStatusText}</span>
                        <button id="btn_notif_request" style="${btnActionStyle}">Запросить</button>
                    </div>
                </div>
            `;
            const handleFile = (inputObj, storageKey, varName) => {
                if (inputObj.files.length === 0) return;
                const file = inputObj.files[0];
                if (file.size > 2.5 * 1024 * 1024) { alert('Файл >2 МБ!'); return; }
                const reader = new FileReader();
                reader.onload = (e) => {
                    localStorage.setItem(storageKey, e.target.result);
                    if (varName === 'std') standardAudioData = e.target.result;
                    if (varName === 'afk') afkAudioData = e.target.result;
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
                    alert('Уведомления заблокированы вручную в браузере.\nОткрой настройки сайта (значок замка/инфо слева от адреса) → Уведомления → Разрешить, затем обнови страницу.');
                    return;
                }
                Notification.requestPermission().then(() => {
                    lastRenderedTab = null;
                    monitorUpdateDebug();
                });
            };
        }
    }

    function monitorCreateDebug() {
        if (monitorDebugDiv) return;
        monitorDebugDiv = document.createElement('div');
        monitorDebugDiv.id = 'ovolya-monitor-debug-container';
        monitorDebugDiv.style.cssText = `position: fixed; bottom: 10px; left: 10px; display: flex; flex-direction: column; z-index: 9998; user-select: none; font-family: sans-serif; font-size: 13px; align-items: flex-start;`;

        const panel = document.createElement('div');
        panel.id = 'ovolya-settings-panel';
        panel.style.cssText = `display: none; background: #1a1a1a; border: 1px solid #444; width: 420px; max-height: 60vh; overflow-y: auto; padding: 15px; border-radius: 6px; margin-bottom: 5px; color: #ccc; box-shadow: 0 -4px 15px rgba(0,0,0,0.5);`;

        const modeBtn = document.createElement('div');
        modeBtn.id = 'ovolya-mode-btn';
        modeBtn.style.cssText = `display: none; background: #222; color: #fff; padding: 5px 12px; border: 1px solid #444; border-radius: 4px; cursor: pointer; width: max-content; margin-bottom: 5px;`;
        modeBtn.onclick = () => { isNightMode = !isNightMode; localStorage.setItem('sd_night_mode', isNightMode); monitorUpdateDebug(); };

        const bottomRow = document.createElement('div');
        bottomRow.style.cssText = `display: flex; gap: 5px; align-items: stretch;`;

        const timerBtn = document.createElement('div');
        timerBtn.id = 'ovolya-monitor-timer-btn';
        timerBtn.style.cssText = `background: #222; color: #0f0; padding: 5px 12px; font-family: monospace; border-radius: 4px; cursor: pointer; border: 1px solid #444; display: flex; align-items: center; justify-content: center; min-height: 28px; box-sizing: border-box;`;
        timerBtn.title = 'Настройки таймера и фильтров';
        timerBtn.onclick = () => {
            isMenuOpen = !isMenuOpen;
            if (isMenuOpen) {
                activeTab = 'rules';
                lastRenderedTab = null;
            } else {
                activeTab = null;
            }
            monitorUpdateDebug();
        };

        const pinBtn = document.createElement('div');
        pinBtn.id = 'ovolya-monitor-pin-btn';
        pinBtn.style.cssText = `background: #222; color: #fff; padding: 0 10px; cursor: pointer; border: 1px solid #444; border-radius: 4px; display: flex; align-items: center;`;
        pinBtn.textContent = '📌';
        pinBtn.onclick = () => { if (isMonitorTargetPage()) { monitorWriteLock(); monitorCheckOwnership(); } };

        const btnRules = document.createElement('div');
        btnRules.id = 'ovolya-menu-rules-btn';
        btnRules.textContent = '🔕 Чёрный список';
        btnRules.style.cssText = `display: none; color: #ccc; padding: 0 12px; cursor: pointer; border: 1px solid #444; border-radius: 4px; align-items: center;`;
        btnRules.onclick = () => { activeTab = 'rules'; lastRenderedTab = null; monitorUpdateDebug(); };

        const btnSound = document.createElement('div');
        btnSound.id = 'ovolya-menu-sound-btn';
        btnSound.textContent = '🔊 Звук';
        btnSound.style.cssText = `display: none; color: #ccc; padding: 0 12px; cursor: pointer; border: 1px solid #444; border-radius: 4px; align-items: center;`;
        btnSound.onclick = () => { activeTab = 'settings'; lastRenderedTab = null; monitorUpdateDebug(); };

        monitorDebugDiv.append(panel, modeBtn, bottomRow);
        bottomRow.append(timerBtn, pinBtn, btnRules, btnSound);
        document.body.appendChild(monitorDebugDiv);
    }

    function monitorUpdateDebug() {
        const container = document.querySelector('#ovolya-monitor-debug-container');
        if (!container) return;
        const panel = container.querySelector('#ovolya-settings-panel');
        const timerBtn = container.querySelector('#ovolya-monitor-timer-btn');
        const pinBtn = container.querySelector('#ovolya-monitor-pin-btn');
        const modeBtn = container.querySelector('#ovolya-mode-btn');
        const rulesBtn = container.querySelector('#ovolya-menu-rules-btn');
        const soundBtn = container.querySelector('#ovolya-menu-sound-btn');
        
        if (!isMonitorTargetPage() && !isMenuOpen) {
            if (container.style.display !== 'none') container.style.display = 'none'; 
            return;
        } else {
            if (container.style.display !== 'flex') container.style.display = 'flex';
        }
        
        const m = Math.floor(Math.max(0, monitorTimeLeft) / 60);
        const s = Math.floor(Math.max(0, monitorTimeLeft) % 60);
        let status = monitorIsOwner ? 'моніторинг' : 'очікування';
        let timerText = `🔄 ${m}:${String(s).padStart(2, '0')} | ${status}`;
        
        if (monitorNotificationCount > 0) timerText += ` | 🟠 нових: ${monitorNotificationCount}`;
        
        if (isMenuOpen) {
            timerBtn.textContent = '❌ Закрыть';
            timerBtn.style.color = '#fff'; timerBtn.style.background = '#522'; timerBtn.style.border = '1px solid #a44';
            modeBtn.style.display = 'block';
            modeBtn.textContent = isNightMode ? '🌙 Ночь (AFK)' : '☀️ День (Стандарт)';
            modeBtn.style.background = isNightMode ? '#1e3a5f' : '#222';
            rulesBtn.style.display = 'flex'; soundBtn.style.display = 'flex';
            rulesBtn.style.background = activeTab === 'rules' ? '#444' : '#222';
            soundBtn.style.background = activeTab === 'settings' ? '#444' : '#222';
            panel.style.display = activeTab ? 'block' : 'none';
            if (activeTab && activeTab !== lastRenderedTab) {
                renderPanelContent(panel);
                lastRenderedTab = activeTab;
            }
        } else {
            timerBtn.textContent = timerText;
            if (monitorNotificationCount > 0) { 
                timerBtn.style.color = '#ffaa00'; timerBtn.style.border = '1px solid #ffaa00'; timerBtn.style.background = '#222'; 
            } else { 
                timerBtn.style.color = '#0f0'; timerBtn.style.border = '1px solid #444'; timerBtn.style.background = '#222'; 
            }
            modeBtn.style.display = 'none'; rulesBtn.style.display = 'none'; soundBtn.style.display = 'none'; panel.style.display = 'none';
        }
        if (pinBtn) pinBtn.style.display = (monitorIsOwner || isMenuOpen) ? 'none' : 'flex';
    }

    // =======================АКТИВНОСТЬ ПОЛЬЗОВАТЕЛЯ=====================================
    let monitorIdleTimeout = null;
    function monitorSetWorking() {
        if (!monitorIsOwner || !isMonitorTargetPage()) return;
        monitorIsPaused = true;
        clearTimeout(monitorIdleTimeout);
        monitorIdleTimeout = setTimeout(() => {
            if (!monitorIsOwner || !isMonitorTargetPage()) return;
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
                if (isMonitorTargetPage()) {
                    location.reload();
                } else {
                    monitorReleaseLock();
                }
                return;
            }
        }
        monitorUpdateDebug();
    }, 1000);

    function monitorCheckOwnership() {
        if (!isMonitorTargetPage()) {
            if (monitorIsOwner) {
                monitorReleaseLock();
            }
            monitorUpdateDebug();
            return;
        }

        const lock = monitorReadLock();
        if (lock && lock.token !== monitorToken && lock.expiresAt > Date.now()) {
            if (monitorIsOwner) { monitorIsOwner = false; clearTimeout(monitorIdleTimeout); }
            monitorUpdateDebug(); return;
        }
        if (!monitorIsOwner) {
            if (monitorAcquireLock()) {
                monitorLastTick = Date.now(); monitorTimeLeft = MONITOR_TIMER_MAX_SEC;
                monitorCheckForNewTickets();
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
        if (isMonitorTargetPage()) {
            monitorAcquireLock();
        }
        monitorLastTick = Date.now();
        monitorUpdateDebug();
        
        setTimeout(() => {
            if (monitorIsOwner && isMonitorTargetPage()) { monitorCheckForNewTickets(); } 
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
            document.title = monitorTitleBlinking ? '🟠 НОВЫЕ ЗАЯВКИ' : monitorOriginalTitle;
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

    window.addEventListener('storage', (e) => { if (e.key === MONITOR_LOCK_KEY) monitorCheckOwnership(); });
    window.addEventListener('beforeunload', () => { clearTimeout(monitorIdleTimeout); monitorReleaseLock(); });
    
    initNewRequestsMonitor();

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
            manageLogoutButton();
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