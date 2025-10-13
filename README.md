ESP Receiver
============

Simple Node.js + Express server to receive aggregated JSON from the ESP device and save it to `received.json`.

Quick start (PowerShell):

1. Open a terminal in this folder (`esp-receiver`).
2. Install dependencies:

```powershell
npm install
```

3. Run the server:

```powershell
npm start
```

4. By default the server listens on port 3000. Configure your ESP firmware `RESULTS_POST_URL` to point to:

http://<YOUR_PC_IP>:3000/upload

To find your PC IP on Windows (PowerShell):

```powershell
ipconfig | Select-String "IPv4" -SimpleMatch
```

Then copy the IPv4 address and replace <YOUR_PC_IP> in the firmware constant.

When the ESP posts JSON it will be printed to the console and saved to `received.json` in this folder.
