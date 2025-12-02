const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

try {
    if (fs.existsSync(CONFIG_FILE)) {
        const rawConfig = fs.readFileSync(CONFIG_FILE, 'utf8');
        const config = JSON.parse(rawConfig);

        if (config.mqtt) {
            console.log('Original MQTT config:', config.mqtt);
            config.mqtt.username = "";
            config.mqtt.password = "";
            console.log('Updated MQTT config:', config.mqtt);
        }

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log('config.json has been updated successfully.');
    } else {
        console.error('Error: config.json does not exist. Run the main server first to create it.');
    }
} catch (e) {
    console.error('Failed to update config.json:', e);
}
