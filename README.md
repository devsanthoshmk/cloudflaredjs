# 🌩️ cloudflaredjs

> A robust Node.js wrapper for **cloudflared** to create, manage, and automatically maintain "Quick Tunnels" with a stable, persistent URL.

---

## 🚨 The Problem

Cloudflare’s “Quick Tunnels” (`cloudflared tunnel --url http://localhost:3000`) are a fantastic way to instantly expose your local web server to the internet.  
But the generated URL (`https://[random-name].trycloudflare.com`) is **ephemeral** and **random** — it changes every time the tunnel restarts.

That makes it unusable for:

- **Sharing a demo URL** — can’t point `my-demo.pages.dev` to a changing address.
- **Webhook Development** — services like Stripe or GitHub require a fixed URL.
- **Multi-device Testing** — new URL every restart.

---

## 💡 The Solution

`cloudflaredjs` turns Cloudflare’s ephemeral tunnels into **self-healing, programmatically managed tunnels**.

It spawns and monitors a `cloudflared` process, captures its URL, and **automatically restarts** if it fails — invoking your callback with the new live URL each time.

You can store this URL in an external database (e.g., Supabase, Firebase, or Cloudflare KV) and have your frontend dynamically fetch it.

✅ Your public site (like `my-demo.pages.dev`) becomes a **stable, shareable endpoint** for your local dev server — complete with live HMR!

---

## ✨ Features

- 🚀 **Programmatic Control:** Start & stop `cloudflared` from Node.js.
- 🌐 **URL Parsing:** Returns the `.trycloudflare.com` URL as a Promise.
- 🩺 **Automatic Fault Detection:** Health checks to detect downtime.
- ♻️ **Auto-Restart & Update:** Reconnects automatically with new URL.
- 🧹 **Robust Cleanup:** Gracefully kills child processes on exit.
- 🔍 **Verbose Logging:** Optional detailed logs for debugging.

---

## ⚙️ Prerequisites

You must have [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation) installed and available in your system’s `PATH`.

---

## 📦 Installation

```bash
npm install cloudflaredjs
```

---

## 🧠 Usage

### 1️⃣ Basic Usage (Get URL Once)

For simple scripts where you just need the public URL once.

```js
import { createTunnel } from "cloudflaredjs";

const { startCloudflared, killChild } = createTunnel();

(async () => {
  try {
    const url = await startCloudflared({ port: 3000, verbose: true });
    console.log(`Tunnel started at: ${url}`);

    // ... your app logic ...

    // Stop tunnel when done
    // killChild();
  } catch (e) {
    console.error("Failed to start tunnel:", e);
  }
})();
```

---

### 2️⃣ Advanced Usage (The “Stable URL” Pattern)

Keep a tunnel **alive** and **auto-update** your database with the latest URL.

```js
import { createTunnel } from "cloudflaredjs";
// import { updateUrlInDatabase } from './my-database-client';

const { startCloudflared, killChild } = createTunnel();

const tunnelOptions = {
  port: 3000,
  verbose: true,
  autoFaultDetectionAndUpdate: true,
  delay: 8000,
  afterFaultRetries: 10,

  successCallback: async (url) => {
    console.log(`New tunnel URL: ${url}`);
    try {
      // await updateUrlInDatabase('my_demo_tunnel', url);
      console.log("Successfully updated database with new URL.");
    } catch (dbError) {
      console.error("Failed to update database:", dbError);
    }
  },

  faultCallback: () => {
    console.error("Tunnel has failed permanently. Sending alert...");
    // alertTeam('CRITICAL: Dev tunnel is down!');
  },
};

startCloudflared(tunnelOptions).catch((e) => {
  console.error("Failed to start initial tunnel:", e);
});

process.on("SIGINT", () => {
  console.log("Shutting down tunnel...");
  killChild();
  process.exit();
});
```

---

## 🧩 Use Case Example — The `<iframe>` Demo Site

### **Backend** (running `cloudflaredjs`)

Use the Advanced Usage example above to keep a live tunnel URL updated in your DB.

### **Frontend** (`my-demo.pages.dev`)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>My Dev Preview</title>
    <style>
      body,
      html {
        margin: 0;
        height: 100%;
      }
      iframe {
        width: 100%;
        height: 100%;
        border: none;
      }
      #loader {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        font-family: sans-serif;
        font-size: 1.2em;
        color: #555;
      }
    </style>
  </head>
  <body>
    <div id="loader">Loading latest dev build...</div>
    <iframe id="demo-frame" style="display:none;"></iframe>

    <script>
      const DB_URL = "https://your-api.com/get-tunnel-url?id=my_demo_tunnel";

      async function fetchTunnelUrl() {
        try {
          const response = await fetch(DB_URL);
          if (!response.ok) throw new Error("Failed to fetch URL");
          const data = await response.json();

          const iframe = document.getElementById("demo-frame");
          iframe.src = data.url;

          iframe.onload = () => {
            document.getElementById("loader").style.display = "none";
            iframe.style.display = "block";
          };
        } catch (error) {
          document.getElementById("loader").innerText =
            "Error loading preview. Please try again later.";
          console.error(error);
        }
      }

      fetchTunnelUrl();
    </script>
  </body>
</html>
```

Now you can share your **permanent URL** (like `my-demo.pages.dev`) — it will always display your live `localhost:3000` app.

---

## 📚 API Reference

### `createTunnel()`

Factory function that creates an isolated tunnel manager.

**Returns:** `{ startCloudflared, killChild }`

---

### `startCloudflared(options)`

Starts a cloudflared quick tunnel.

| Option                        | Type       | Default | Description                                                |
| ----------------------------- | ---------- | ------- | ---------------------------------------------------------- |
| `port`                        | `number`   | —       | **Required.** Local port to expose (e.g. 3000).            |
| `verbose`                     | `boolean`  | `false` | Enables detailed logging.                                  |
| `autoFaultDetectionAndUpdate` | `boolean`  | `false` | Automatically monitors and restarts tunnels.               |
| `successCallback(url)`        | `function` | —       | Called on every successful start/restart with the new URL. |
| `faultCallback()`             | `function` | —       | Called if the tunnel permanently fails after retries.      |
| `delay`                       | `number`   | `8000`  | Interval (ms) for health checks.                           |
| `afterFaultRetries`           | `number`   | `10`    | Number of failed checks before triggering `faultCallback`. |

**Returns:** `Promise<string>` — Resolves with the public tunnel URL.

---

### `killChild()`

Stops the tunnel process and cleans up all internal intervals.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).

---

## ⚠️ Disclaimer

`cloudflaredjs` is intended **only for testing, development, and preview purposes**.  
It is **not suitable for deploying production websites** — nor is it designed to be used as a permanent hosting solution.

This module operates on top of **Cloudflare Quick Tunnels**, and therefore **must comply with Cloudflare’s Terms of Service**.  
By using this package, **you are responsible** for ensuring your usage aligns with those terms.

### Please Note:

- Do **not** create or run more than **3–4 simultaneous tunnels**.
- Do **not** start tunnels repeatedly in short intervals.  
  Excessive use may lead to **temporary IP blocking by Cloudflare** (typically 10–15 minutes).
- Misuse of Quick Tunnels may cause the module to behave **unexpectedly** or fail.

Use responsibly, and always for legitimate development workflows.

---

## ❤️ Support

If you find this helpful, give it a ⭐ on GitHub!
