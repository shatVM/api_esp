// Примітка: цей код передбачає, що в DOM є елементи з id: uploadList, detailView, deleteAllBtn,
// prevPage, nextPage, currentPage, itemsPerPageSelect, PINControl (та його чекбокси).

let currentPage = 1;
let itemsPerPage = 5;
let totalItems = 0;

/**
 * Завантажує список завантажень із сервера.
 * @param {number} page - Номер сторінки для завантаження.
 * @param {number} limit - Кількість елементів на сторінці.
 */
async function fetchList(page = 1, limit = itemsPerPage) {
    try {
        const res = await fetch(`/api/uploads?page=${page}&limit=${limit}`);
        if (!res.ok) {
            throw new Error('Network response not ok: ' + res.status);
        }

        const data = await res.json();
        const items = data.items || [];

        // Логуємо кожен елемент списку для налагодження
        console.log('=== Page ' + page + ' items ===');
        items.forEach((item, index) => {
            console.log(`Item ${index + 1}:`, item);
        });
        console.log('=== End of page items ===');

        totalItems = data.pagination?.totalItems || items.length;
        const listEl = document.getElementById('uploadList');

        if (!listEl) return; // Захист від відсутності елемента

        listEl.innerHTML = '';

        if (!items || items.length === 0) {
            // Створюємо порожні елементи, якщо немає даних
            for (let i = 0; i < limit; i++) {
                const emptyLi = createEmptyListItem();
                listEl.appendChild(emptyLi);
            }
            updatePagination(page);
            return;
        }

        // Додаємо реальні елементи
        for (const it of items) {
            const li = createListItem(it);
            listEl.appendChild(li);
        }

        // Додаємо порожні елементи, якщо потрібно заповнити сторінку
        const remainingSlots = limit - items.length;
        if (remainingSlots > 0) {
            for (let i = 0; i < remainingSlots; i++) {
                const emptyLi = createEmptyListItem();
                listEl.appendChild(emptyLi);
            }
        }

        updatePagination(page);
    } catch (e) {
        console.error('Failed to fetch list', e);
        const listEl = document.getElementById('uploadList');
        if (listEl) {
            listEl.innerHTML = '<li class="error">Failed to load uploads</li>';
        }
    }
}

/**
 * Оновлює стан кнопок пагінації та відображення поточної сторінки.
 * @param {number} page - Поточний номер сторінки.
 */
function updatePagination(page) {
    currentPage = page;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageSpan = document.getElementById('currentPage');

    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
    if (pageSpan) pageSpan.textContent = `${page} of ${totalPages}`;
}

// --- Утилітарні функції для створення елементів списку та обробки даних ---

/**
 * Створює <li> елемент для запису завантаження.
 * @param {object} it - Об'єкт даних завантаження.
 * @returns {HTMLLIElement} - Створений елемент списку.
 */
function createListItem(it) {
    const li = document.createElement('li');
    li.dataset.id = it.id ?? '';
    li.classList.add('device-item'); // Додаємо клас для делегування подій

    // Отримання інформації про пристрій та мережу
    const deviceName = it.device?.name || it.summary || 'Unknown Device';
    const chipModel = it.device?.chipModel || 'Unknown Model';
    const ip = it.network?.ip || 'No IP';

    // Логування структури елемента для налагодження
    console.log('Item structure:', {
        id: it.id,
        summary: it.summary,
        device: it.device,
        network: it.network,
        time: it.time
    });

    li.innerHTML = `
        <div class="list-row">
            <div class="meta">
                <strong class="device-name">
                    ${escapeHtml(deviceName)} ${deviceName !== '⚠️ Unnamed Device' ? `- ${escapeHtml(chipModel)}` : ''}
                </strong><br/>
                <small class="device-ip">📍 ${escapeHtml(ip)}</small><br/>
                <small class="upload-time">🕒 ${new Date(it.time).toLocaleString()}</small>
                <div class="sensor-preview">
                    <small class="sensor ${!it.sensors?.temperature_aht ? 'empty' : ''}"> 🌡️ ${it.sensors?.temperature_aht ?? '--°C'} </small>
                    <small class="sensor ${!it.sensors?.humidity_aht ? 'empty' : ''}"> 💧 ${it.sensors?.humidity_aht !== null ? `${it.sensors.humidity_aht}%` : '--%'} </small>
                    <small class="sensor ${!it.sensors?.lux ? 'empty' : ''}"> ☀️ ${it.sensors?.lux !== null ? `${it.sensors.lux} lux` : '-- lux'} </small>
                </div>
            </div>
            <div class="actions">
                <button data-id="${escapeHtml(it.id ?? '')}" class="del">🗑️ Delete</button>
            </div>
        </div>
    `;

    // Клік по елементу — завантажити деталі
    li.addEventListener('click', () => loadDetail(it.id, li));

    // Кнопка видалення — stopPropagation, щоб не спрацьовував li click
    const delBtn = li.querySelector('.del');
    if (delBtn) {
        delBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            deleteItem(it.id, li);
        });
    }

    // Tooltip element (прихований за замовчуванням через CSS)
    const tooltip = document.createElement('div');
    tooltip.className = 'device-tooltip';
    tooltip.innerHTML = `
        <table class="device-info">
            <tr><th colspan="2">Device Information</th></tr>
            <tr><td>Name:</td><td>${escapeHtml(it.device?.name ?? '⚠️ Unnamed Device')}</td></tr>
            <tr><td>Chip Model:</td><td>${escapeHtml(it.device?.chipModel ?? '❓ Unknown Model')}</td></tr>
            <tr><td>CPU Freq:</td><td>${it.device?.cpuFreqMHz ? escapeHtml(it.device.cpuFreqMHz) + ' MHz' : '📊 N/A'}</td></tr>
            <tr><td>Flash Size:</td><td>${it.device?.flashSizeMB ? escapeHtml(it.device.flashSizeMB) + ' MB' : '💾 N/A'}</td></tr>
            <tr><td>SDK Version:</td><td>${escapeHtml(it.device?.sdkVersion ?? '🔄 Unknown Version')}</td></tr>
            <tr><td>MAC:</td><td>${escapeHtml(it.device?.macAddress ?? '🔒 No MAC Address')}</td></tr>
            <tr><th colspan="2">Network</th></tr>
            <tr><td>SSID:</td><td>${escapeHtml(it.network?.ssid ?? '📡 Not Connected')}</td></tr>
            <tr><td>IP:</td><td>${escapeHtml(it.network?.ip ?? '🔌 No IP Address')}</td></tr>
            <tr><td>RSSI:</td><td>${it.network?.rssi ? escapeHtml(it.network.rssi) + ' dBm' : '📶 No Signal'}</td></tr>
            <tr><th colspan="2">Sensor Data</th></tr>
            <tr><td>Light:</td><td>☀️ ${it.sensors?.lux !== null ? `${escapeHtml(it.sensors.lux)} lux` : '<span class="no-data">No data</span>'}</td></tr>
            <tr><td>AHT Temp:</td><td>🌡️ ${it.sensors?.temperature_aht !== null ? `${escapeHtml(it.sensors.temperature_aht)}°C` : '<span class="no-data">No data</span>'}</td></tr>
            <tr><td>AHT Humidity:</td><td>💧 ${it.sensors?.humidity_aht !== null ? `${escapeHtml(it.sensors.humidity_aht)}%` : '<span class="no-data">No data</span>'}</td></tr>
            <tr><td>DHT Temp:</td><td>🌡️ ${it.sensors?.temperature_dht !== null ? `${escapeHtml(it.sensors.temperature_dht)}°C` : '<span class="no-data">No data</span>'}</td></tr>
            <tr><td>DHT Humidity:</td><td>💧 ${it.sensors?.humidity_dht !== null ? `${escapeHtml(it.sensors.humidity_dht)}%` : '<span class="no-data">No data</span>'}</td></tr>
            <tr><td>Uptime:</td><td>⏱️ ${it.sensors?.uptime !== null ? `${escapeHtml(it.sensors.uptime)}ms` : '<span class="no-data">No data</span>'}</td></tr>
        </table>
    `;

    // show tooltip on hover (при використанні делегування, цей блок можна прибрати)
    li.addEventListener('mouseenter', (ev) => {
        // position the tooltip relative to li
        li.appendChild(tooltip);
        tooltip.setAttribute('aria-hidden', 'false');
    });
    li.addEventListener('mouseleave', (ev) => {
        tooltip.setAttribute('aria-hidden', 'true');
        if (tooltip.parentElement === li) li.removeChild(tooltip);
    });

    return li;
}

/**
 * Створює порожній <li> елемент для заповнення простору сторінки.
 * @returns {HTMLLIElement} - Порожній елемент списку.
 */
function createEmptyListItem() {
    const li = document.createElement('li');
    li.className = 'empty';
    li.innerHTML = `
        <div class="list-row">
            <div class="meta">
                <strong class="device-name empty-text">Device Name</strong><br/>
                <small class="device-ip empty-text">📍 IP Address</small><br/>
                <small class="upload-time empty-text">🕒 Time</small>
                <div class="sensor-preview">
                    <small class="sensor empty"> 🌡️ --°C </small>
                    <small class="sensor empty"> 💧 --% </small>
                    <small class="sensor empty"> ☀️ -- lux </small>
                </div>
            </div>
            <div class="actions">
                <button class="del" disabled style="opacity: 0.3">🗑️ Delete</button>
            </div>
        </div>
    `;
    return li;
}

/**
 * Проста функція-екскейпер для безпечної вставки тексту у HTML-шаблон.
 * @param {string} str - Рядок для екранування.
 * @returns {string} - Екранований рядок.
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Рекурсивне перетворення об'єкта/масиву в HTML-таблицю.
 * @param {any} obj - Об'єкт або масив для перетворення.
 * @returns {string} - HTML-код таблиці.
 */
function jsonToTable(obj) {
    if (obj === null) return '<em>null</em>';
    if (typeof obj !== 'object') return escapeHtml(String(obj));

    let table = '<table>';
    if (Array.isArray(obj)) {
        // Масив — кожен елемент в окремому рядку
        obj.forEach((val, i) => {
            table += `<tr><td><strong>[${i}]</strong></td><td>${jsonToTable(val)}</td></tr>`;
        });
    } else {
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            table += `<tr><td><strong>${escapeHtml(key)}</strong></td><td>${jsonToTable(val)}</td></tr>`;
        }
    }
    table += '</table>';
    return table;
}

// --- Функції обробки дій: деталі, видалення ---

/**
 * Завантажує деталі завантаження та відображає їх.
 * @param {string} id - ID завантаження.
 * @param {HTMLLIElement} liEl - Елемент списку, на який клікнули.
 */
async function loadDetail(id, liEl) {
    try {
        document.querySelectorAll('#uploadList li').forEach(x => x.classList.remove('active'));
        if (liEl) liEl.classList.add('active');

        const detailView = document.getElementById('detailView');
        if (!detailView) return;

        const res = await fetch('/api/uploads/' + encodeURIComponent(id));
        if (!res.ok) {
            detailView.innerText = 'Failed to load detail: ' + res.status;
            return;
        }

        const obj = await res.json();
        // Побудова детального перегляду: метадані + дані
        let detailHtml = '<h3>Metadata</h3>' + jsonToTable(obj.meta ?? {});
        detailHtml += '<h3>Data</h3>' + jsonToTable(obj.data ?? {});

        detailView.innerHTML = detailHtml;
    } catch (e) {
        console.error('Failed to load detail', e);
        const detailView = document.getElementById('detailView');
        if (detailView) {
            detailView.innerHTML = '<p class="error">Could not load or parse details for this upload.</p>';
        }
    }
}

/**
 * Видаляє окреме завантаження.
 * @param {string} id - ID завантаження для видалення.
 * @param {HTMLLIElement} liEl - Елемент списку, який потрібно видалити.
 */
async function deleteItem(id, liEl) {
    if (!confirm('Are you sure you want to delete this upload?')) return;

    try {
        const res = await fetch('/api/uploads/' + encodeURIComponent(id), {
            method: 'DELETE'
        });

        if (!res.ok) {
            alert('Failed to delete item. Server responded: ' + res.status);
            return;
        }

        // Прибрати зі списку і очистити детальний перегляд, якщо потрібно
        if (liEl) liEl.remove();

        const activeItem = document.querySelector('#uploadList li.active');
        const detailView = document.getElementById('detailView');
        if (!activeItem && detailView) {
            detailView.innerHTML = '<p>Select an upload on the left to see details.</p>';
        }

        // Якщо список порожній — показати повідомлення
        const listEl = document.getElementById('uploadList');
        if (listEl && listEl.children.length === 0) {
            listEl.innerHTML = '<li>No uploads yet</li>';
        }
        
        // Зменшити загальну кількість та оновити пагінацію
        totalItems--;
        fetchList(currentPage, itemsPerPage);
    } catch (e) {
        console.error('Delete failed', e);
        alert('An error occurred during deletion.');
    }
}

/**
 * Видаляє усі завантаження.
 */
async function deleteAllItems() {
    if (!confirm('Are you sure you want to delete all uploads?')) return;

    try {
        const res = await fetch('/api/uploads', {
            method: 'DELETE'
        });

        if (!res.ok) {
            alert('Failed to delete all items. Server responded: ' + res.status);
            return;
        }

        // Очистити UI
        const listEl = document.getElementById('uploadList');
        if (listEl) {
            listEl.innerHTML = '<li>No uploads yet</li>';
        }

        const detailView = document.getElementById('detailView');
        if (detailView) {
            detailView.innerHTML = '<p>Select an upload on the left to see details.</p>';
        }
        
        // Скинути пагінацію
        totalItems = 0;
        currentPage = 1;
        updatePagination(1);
    } catch (e) {
        console.error('Delete all failed', e);
        alert('An error occurred during deletion.');
    }
}

/**
 * Завантажує стан пінів і оновлює UI.
 */
async function fetchPinStates() {
    try {
        const res = await fetch('/pinstate');
        if (!res.ok) {
            throw new Error('Network response not ok: ' + res.status);
        }
        const states = await res.json();
        renderPinStates(states);
    } catch (e) {
        console.error('Failed to fetch pin states', e);
    }
}

/**
 * Оновлює UI для відображення стану пінів.
 * @param {object} states - Об'єкт зі станами пінів.
 */
function renderPinStates(states) {
    const pinStateContainer = document.getElementById('pinState');
    if (!pinStateContainer) {
        return;
    }

    for (const pin in states) {
        const pinElement = pinStateContainer.querySelector(`[data-pin="${pin}"]`);
        if (pinElement) {
            const statusElement = pinElement.querySelector('.pin-status');
            if (statusElement) {
                if (states[pin] === 1) {
                    statusElement.textContent = 'ON';
                    statusElement.classList.remove('red');
                    statusElement.classList.add('green');
                } else {
                    statusElement.textContent = 'OFF';
                    statusElement.classList.remove('green');
                    statusElement.classList.add('red');
                }
            }
        }
    }
}

// --- Ініціалізація та обробники подій DOMContentLoaded ---


document.addEventListener('DOMContentLoaded', () => {
    // 1. Налаштування кількості елементів на сторінці
    const itemsPerPageSelect = document.getElementById('itemsPerPageSelect');
    if (itemsPerPageSelect) {
        // Переконуємось, що select відповідає початковому значенню
        itemsPerPageSelect.value = itemsPerPage.toString();
        itemsPerPageSelect.addEventListener('change', (e) => {
            itemsPerPage = parseInt(e.target.value, 10);
            // Скидаємо до першої сторінки при зміні кількості елементів
            currentPage = 1;
            fetchList(1, itemsPerPage);
        });
    }

    // 2. Початкове завантаження списку
    fetchList(1, itemsPerPage);
    fetchPinStates();

    // 3. Налаштування обробників пагінації
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                fetchList(currentPage - 1);
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(totalItems / itemsPerPage);
            if (currentPage < totalPages) {
                fetchList(currentPage + 1);
            }
        });
    }

    // 4. Обробник кнопки "Видалити все"
    const deleteAllBtn = document.getElementById('deleteAllBtn');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', deleteAllItems);
    }

    // 5. Делеговані обробники наведення для спливаючих підказок (tooltip)
    const uploadList = document.getElementById('uploadList');
    if (uploadList) {
        uploadList.addEventListener('mouseover', (ev) => {
            const li = ev.target.closest && ev.target.closest('li.device-item');
            if (!li) return;
            const tt = li.querySelector('.device-tooltip');
            if (tt) tt.setAttribute('aria-hidden', 'false');
        });

        uploadList.addEventListener('mouseout', (ev) => {
            const li = ev.target.closest && ev.target.closest('li.device-item');
            if (!li) return;
            const tt = li.querySelector('.device-tooltip');
            if (tt) tt.setAttribute('aria-hidden', 'true');
        });
    }

    // --- Обробка подій Server-Sent Events (SSE) ---
    if (!!window.EventSource) {
        const es = new EventSource('/events');

        es.addEventListener('new', (e) => {
            try {
                const d = JSON.parse(e.data);
                console.log('New item received via SSE:', d);

                // Якщо ми на сторінці 1, додаємо новий елемент
                if (currentPage === 1) {
                    const listEl = document.getElementById('uploadList');
                    if (!listEl) return;
                    
                    // Очищаємо повідомлення "No uploads" (якщо є)
                    const first = listEl.querySelector('li');
                    if (first && first.textContent.trim() === 'No uploads yet') {
                        listEl.innerHTML = '';
                    }

                    // Додаємо новий елемент нагорі
                    const li = createListItem(d);
                    listEl.prepend(li);

                    // Видаляємо зайві елементи, якщо перевищено ліміт
                    const items = listEl.querySelectorAll('li:not(.empty)');
                    const emptyItems = listEl.querySelectorAll('li.empty');

                    if (items.length > itemsPerPage) {
                        // Видаляємо останній *реальний* елемент
                        items[items.length - 1].remove();
                    } else if (items.length + emptyItems.length > itemsPerPage) {
                        // Якщо є порожні елементи, видаляємо один з них
                        emptyItems[emptyItems.length - 1].remove();
                    }
                }

                // Оновлюємо загальну кількість та пагінацію
                totalItems++;
                updatePagination(currentPage);
                fetchPinStates();
            } catch (err) {
                console.error('Invalid SSE "new" data', err);
            }
        });

        es.addEventListener('deleted', (e) => {
            try {
                const d = JSON.parse(e.data);
                // Видаляємо елемент зі списку, якщо він існує
                const el = document.querySelector(`#uploadList li[data-id="${CSS.escape ? CSS.escape(d.id) : d.id}"]`);
                if (el) el.remove();

                // Очищаємо детальний перегляд, якщо було видалено активний елемент
                const detailView = document.getElementById('detailView');
                const activeItem = document.querySelector('#uploadList li.active');
                if (!activeItem && detailView) {
                    detailView.innerHTML = '<p>Select an upload on the left to see details.</p>';
                }

                // Якщо список порожній, показуємо повідомлення
                const listEl = document.getElementById('uploadList');
                if (listEl && listEl.children.length === 0) {
                    listEl.innerHTML = '<li>No uploads yet</li>';
                }
                
                // Зменшуємо загальну кількість та оновлюємо пагінацію
                totalItems--;
                updatePagination(currentPage);
                fetchPinStates();
            } catch (err) {
                console.error('Invalid SSE "deleted" data', err);
            }
        });

        es.addEventListener('deleted_all', (e) => {
            try {
                const listEl = document.getElementById('uploadList');
                if (listEl) listEl.innerHTML = '<li>No uploads yet</li>';

                const detailView = document.getElementById('detailView');
                if (detailView) {
                    detailView.innerHTML = '<p>Select an upload on the left to see details.</p>';
                }

                // Скидаємо пагінацію
                totalItems = 0;
                currentPage = 1;
                updatePagination(1);
            } catch (err) {
                console.error('Invalid SSE "deleted_all" data', err);
            }
        });

        es.onerror = (err) => {
            console.warn('SSE connection error', err);
            // Браузер спробує перепідключитись автоматично
        };
    }

    // --- Управління станом PIN-контролю ---
    const pinControl = document.getElementById('PINControl');
    if (pinControl) {
        const switches = pinControl.querySelectorAll('input[type="checkbox"]');

        // Завантаження початкових станів
        fetch('/pinstate')
            .then(res => res.json())
            .then(states => {
                switches.forEach(switchEl => {
                    const pin = switchEl.id.replace('Switch', '');
                    if (states[pin] !== undefined) {
                        // 1 вважається "увімкненим" (checked)
                        switchEl.checked = states[pin] === 1; 
                    }
                });
            })
            .catch(err => console.error('Failed to fetch pin states', err));

        // Додавання обробників подій зміни стану
        switches.forEach(switchEl => {
            switchEl.addEventListener('change', (event) => {
                const pin = event.target.id.replace('Switch', '');
                const state = event.target.checked ? 1 : 0;

                fetch(`/api/pins/${pin}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ state })
                })
                .then(res => {
                    if (!res.ok) {
                        throw new Error('Server returned non-ok status: ' + res.status);
                    }
                    return res.json();
                })
                .then(data => {
                    if (data.status !== 'ok') {
                        console.error(`Failed to update pin ${pin} state. Response:`, data);
                    } else {
                        fetchPinStates();
                    }
                })
                .catch(err => {
                    console.error(`Failed to update pin ${pin} state. Restoring previous state.`, err);
                    // У разі помилки, повертаємо чекбокс до попереднього стану
                    event.target.checked = !event.target.checked; 
                });
            });
        });
    }
});