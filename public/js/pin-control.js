/**
 * Ініціалізує логіку керування пінами на сторінці.
 * Ця функція знаходить усі необхідні елементи та додає обробники подій.
 */
function initializePinControl() {

    /**
     * Завантажує стан пінів із сервера та оновлює UI.
     */
    async function fetchPinStates() {
        try {
            const res = await fetch('/pinstate');
            if (!res.ok) {
                throw new Error('Network response not ok: ' + res.status);
            }
            const states = await res.json();
            renderPinStates(states);
            updateSwitches(states);
        } catch (e) {
            console.error('Failed to fetch pin states', e);
        }
    }

    /**
     * Оновлює UI (колір та текст) для відображення стану пінів.
     * @param {object} states - Об'єкт зі станами пінів (напр., { pin4: 1, pin5: 0 }).
     */
    function renderPinStates(states) {
        const pinStateContainer = document.getElementById('pinState');
        if (!pinStateContainer) return;

        for (const pinName in states) {
            const pinElement = pinStateContainer.querySelector(`[data-pin="${pinName}"]`);
            if (pinElement) {
                const statusElement = pinElement.querySelector('.pin-status');
                if (statusElement) {
                    const isPinOn = states[pinName] === 1;
                    statusElement.textContent = isPinOn ? 'ON' : 'OFF';
                    statusElement.classList.toggle('green', isPinOn);
                    statusElement.classList.toggle('red', !isPinOn);
                }
            }
        }
    }

    /**
     * Оновлює стан перемикачів (checkboxes) відповідно до даних з сервера.
     * @param {object} states - Об'єкт зі станами пінів.
     */
    function updateSwitches(states) {
        // Оновлюємо всі перемикачі, що знаходяться в #PINControl або приховані
        const switches = document.querySelectorAll('#PINControl input[type="checkbox"], div[style*="display: none"] input[type="checkbox"]');
        switches.forEach(switchEl => {
            const pin = switchEl.id.replace('Switch', '');
            if (states[pin] !== undefined) {
                switchEl.checked = states[pin] === 1;
            }
        });
    }

    /**
     * Обробник події зміни стану перемикача. Відправляє запит на сервер.
     * Використовує "оптимістичне" оновлення UI для миттєвого відгуку.
     * @param {Event} event - Подія зміни.
     */
    function handleSwitchChange(event) {
        const pin = event.target.id.replace('Switch', '');
        const newState = event.target.checked ? 1 : 0;
        const oldState = newState === 1 ? 0 : 1;

        // Оптимістичне оновлення: змінюємо UI негайно
        const pinElement = document.querySelector(`[data-pin="${pin}"]`);
        if (pinElement) {
            const statusElement = pinElement.querySelector('.pin-status');
            if (statusElement) {
                const isPinOn = newState === 1;
                statusElement.textContent = isPinOn ? 'ON' : 'OFF';
                statusElement.classList.toggle('green', isPinOn);
                statusElement.classList.toggle('red', !isPinOn);
            }
        }

        // Відправляємо запит на сервер у фоновому режимі
        fetch(`/api/pins/${pin}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: newState })
        })
        .then(res => {
            if (!res.ok) {
                // Якщо сервер повернув помилку, відкочуємо зміни
                throw new Error('Server returned non-ok status: ' + res.status);
            }
            return res.json();
        })
        .then(data => {
            if (data.status !== 'ok') {
                // Якщо статус відповіді не 'ok', також відкочуємо
                throw new Error(`Server response was not ok: ${JSON.stringify(data)}`);
            }
            // Успіх! Нічого не робимо, бо UI вже оновлено.
            console.log(`Pin ${pin} state successfully updated to ${newState}.`);
        })
        .catch(err => {
            console.error(`Failed to update pin ${pin}. Reverting UI.`, err);
            // Відкат UI до попереднього стану
            event.target.checked = !event.target.checked; // Повертаємо чекбокс
            if (pinElement) {
                const statusElement = pinElement.querySelector('.pin-status');
                if (statusElement) {
                    const isPinOn = oldState === 1;
                    statusElement.textContent = isPinOn ? 'ON' : 'OFF';
                    statusElement.classList.toggle('green', isPinOn);
                    statusElement.classList.toggle('red', !isPinOn);
                }
            }
        });
    }

    // --- Прив'язка обробників подій ---

    // 1. Керування через клік по блоку стану
    const pinStateContainer = document.getElementById('pinState');
    if (pinStateContainer) {
        pinStateContainer.addEventListener('click', (event) => {
            const pinElement = event.target.closest('.pin');
            if (!pinElement) return;

            const pinName = pinElement.dataset.pin; // напр., "pin4"
            const switchElement = document.getElementById(`${pinName}Switch`);

            if (switchElement) {
                switchElement.click(); // Ініціюємо клік на відповідному перемикачі
            }
        });
    }

    // 2. Обробники для всіх перемикачів
    const switches = document.querySelectorAll('#PINControl input[type="checkbox"], div[style*="display: none"] input[type="checkbox"]');
    switches.forEach(switchEl => {
        switchEl.addEventListener('change', handleSwitchChange);
    });

    // --- Початкове завантаження ---
    fetchPinStates();
}

// Ініціалізуємо логіку, коли DOM буде готовий
document.addEventListener('DOMContentLoaded', () => {
    initializePinControl();
    setupRealtimeSensorUpdates(); // Додаємо ініціалізацію оновлень
});

/**
 * Форматує числове значення до одного знаку після коми.
 * @param {number | string | null | undefined} value - Вхідне значення.
 * @param {string} unit - Одиниця виміру.
 * @returns {string} - Відформатований рядок або 'N/A'.
 */
function formatSensorValue(value, unit) {
    const num = parseFloat(value);
    if (isNaN(num)) {
        return 'N/A';
    }
    return `${num.toFixed(1)} ${unit}`;
}

/**
 * Розраховує відсоток заряду батареї 18650 на основі напруги.
 * @param {number} voltage - Поточна напруга батареї.
 * @returns {number} - Відсоток заряду (0-100).
 */
function calculateBatteryPercentage(voltage) {
    const MIN_VOLTAGE = 3.0; // Повністю розряджена
    const MAX_VOLTAGE = 4.2; // Повністю заряджена

    if (voltage <= MIN_VOLTAGE) return 0;
    if (voltage >= MAX_VOLTAGE) return 100;

    const percentage = ((voltage - MIN_VOLTAGE) / (MAX_VOLTAGE - MIN_VOLTAGE)) * 100;
    return Math.round(percentage);
}

/**
 * Налаштовує отримання оновлень даних датчиків в реальному часі через SSE.
 */
function setupRealtimeSensorUpdates() {
    // Перевіряємо, чи є на сторінці блок для інформації з датчиків
    const sensorInfoBlock = document.getElementById('SensorInfo');
    if (!sensorInfoBlock) {
        return; // Якщо блоку немає, нічого не робимо
    }

    // Перевірка підтримки SSE браузером
    if (typeof(EventSource) === "undefined") {
        console.warn("SSE not supported by this browser. Sensor data will not update automatically.");
        return;
    }

    const source = new EventSource('/events');

    source.onopen = function() {
        console.log("SSE connection established for real-time sensor updates.");
    };

    // Ця подія надсилається з сервера щоразу, коли надходить новий пакет даних
    source.addEventListener('new', async function(event) {
        console.log("New data received via SSE. Fetching latest sensor values...");
        try {
            const response = await fetch('/api/latest-data');
            if (!response.ok) {
                throw new Error(`Failed to fetch latest data: ${response.status}`);
            }
            const data = await response.json();

            // Оновлюємо значення на сторінці
            const tempEl = document.getElementById('sensor-temp');
            const humidEl = document.getElementById('sensor-humid');
            const luxEl = document.getElementById('sensor-lux');
            const batteryEl = document.getElementById('sensor-battery');
            const batteryItemEl = document.getElementById('battery-item');

            // Використовуємо '??' для відображення 'N/A', якщо дані відсутні
            if (tempEl) tempEl.textContent = formatSensorValue(data.temperature_aht_c, '°C');
            if (humidEl) humidEl.textContent = formatSensorValue(data.humidity_aht_pct, '%');
            if (luxEl) luxEl.textContent = formatSensorValue(data.lux, 'lux');
            
            if (batteryEl && batteryItemEl) {
                const voltage = data.battery_v;
                batteryEl.textContent = formatSensorValue(voltage, 'V');
                
                const percentage = calculateBatteryPercentage(voltage);
                batteryItemEl.style.setProperty('--battery-level-pct', `${percentage}%`);
            }
        } catch (error) {
            console.error("Error updating sensor data:", error);
        }
    });

    source.onerror = function(err) {
        console.error("SSE connection error:", err);
    };
}