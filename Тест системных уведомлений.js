(function() {
    console.group("🛠️ Диагностика пушей и ложных срабатываний");
    
    // 1. Проверка прав и тестовый пуш
    if (!('Notification' in window)) {
        console.error("❌ Этот браузер вообще не поддерживает системные уведомления.");
    } else {
        console.log("🔔 Текущий статус прав:", Notification.permission);
        Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
                try {
                    new Notification("Тест sd.bitech", { 
                        body: "Если ты видишь этот пуш, значит ОС и браузер их пропускают!",
                        icon: 'https://www.google.com/s2/favicons?sz=64&domain=bitech.com.ua'
                    });
                    console.log("✅ Тестовый пуш отправлен. Ищи его в центре уведомлений ОС, если не вылез на экране.");
                } catch (e) {
                    console.error("❌ Ошибка при создании пуша:", e);
                }
            } else {
                console.warn("❌ Права на уведомления заблокированы (denied)! Проверь настройки сайта в адресной строке (замочек).");
            }
        });
    }

    // 2. Сброс последних ID заявок
    let ids = JSON.parse(localStorage.getItem('ovolya_sd_new_requests_known_ids') || '[]');
    if (ids.length > 0) {
        let countToRemove = Math.min(3, ids.length);
        let removed = ids.splice(-countToRemove, countToRemove);
        localStorage.setItem('ovolya_sd_new_requests_known_ids', JSON.stringify(ids));
        console.log(`🗑️ Удалены ID из памяти: ${removed.join(', ')}.`);
        console.log("⏳ На следующем тике проверки скрипт должен среагировать на эти заявки как на новые.");
    } else {
        console.log("📝 Список известных ID пуст, нечего удалять.");
    }
    
    console.groupEnd();
})();