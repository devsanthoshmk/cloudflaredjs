# cloudflared-js — Module documentation

**Purpose:**
This module starts a `cloudflared` tunnel that exposes a local `http://localhost:<port>` service and returns the dynamic `trycloudflare.com` URL produced by `cloudflared`. It also includes an optional automatic fault-detection-and-update feature that will detect when the tunnel goes down, restart `cloudflared`, and call user-supplied callbacks.

---

## Quick summary

- **Exported function:** `startCloudflared(options)`
  Starts a `cloudflared` process and resolves a `Promise` with the dynamic public URL (the `trycloudflare.com` link) once it appears in `cloudflared` stdout/stderr.

- **Optional behavior:** when `autoFaultDetectionAndUptate` is `true` and both `successCallback` and `faultCallback` are functions, the module will periodically check the dynamic URL and, on failure, restart `cloudflared` and call the callbacks.

- **Important runtime requirements:**

  - `cloudflared` binary must be installed and available in `PATH`.
  - The module uses Node built-in `child_process`, `readline`, and `fs`.
  - It uses global mutable state (module-level `child`, `args`, `retryInterval`) and process-level handlers (SIGINT, SIGTERM, exit, etc.).

---

## Installation / prerequisites

1. Install `cloudflared` on the host machine and ensure it can be run by simply calling `cloudflared` from a shell (i.e., it's in `PATH`). See the official Cloudflare documentation for installation instructions for your OS.
2. Use Node.js (no specific version is enforced by the module, but recent LTS Node is recommended).
3. Import this module in your code and call `startCloudflared(...)`.

---

## API

### `startCloudflared(options) : Promise<string> | Error`

**Parameters (single `options` object):**

- `port` **(number, required)** — the local port to forward, e.g. `3000`. The module will attempt to forward `http://localhost:<port>`.
- `verbose` **(boolean, default `false`)** — when `true`, the module appends cloudflared stdout/stderr lines to `./cloudflaredjs.logs.txt` and prints additional runtime information (some `console.error` lines exist in the code).
- `autoFaultDetectionAndUptate` **(boolean, default `false`)** — when `true`, the module will start automatic monitoring/restart logic to detect a faulty tunnel and attempt to obtain a new link. **Note:** the code contains a spelling `autoFaultDetectionAndUptate` (missing 'd' in "Update") and uses that same name for the option — pass that exact key for the feature to be activated.
- `successCallback` **(function | string, default `"() => { }"`)** — a callback that is called with the new public link when a restart produces a new link. If `autoFaultDetectionAndUptate` is enabled, this must be a function. The module checks `typeof successCallback === "function"`.
- `faultCallback` **(function | undefined)** — a callback invoked when fault-detection exhausts its retry budget. Required when `autoFaultDetectionAndUptate` is enabled.
- `delay` **(number, default `3000`)** — interval in milliseconds between checks of the tunnel URL when `autoFaultDetectionAndUptate` is enabled.
- `afterFaultReties` **(number, default `10`)** — number of per-fault retries allowed before giving up and calling `faultCallback`. **Note:** spelled `afterFaultReties` in code (typo: "Reties" → "Retries"), so use that exact key if passing in options by object destructuring to the module. The code compares `args.afterFaultReties < faultRetries` for termination.

**Returns:**

- On success, a `Promise` that resolves to the detected public `trycloudflare.com` URL string.
- If `autoFaultDetectionAndUptate` is set to `true` but either `successCallback` or `faultCallback` are not functions, the function immediately returns an `Error`.

**Behavior detail:**

- The module spawns `cloudflared tunnel --url http://localhost:<port>` and parses `child.stdout` and `child.stderr` line-by-line using `readline.createInterface`.
- It looks for the first HTTP(S) URL matching `/https?:\/\/[^\s)]+/i`. When the found URL ends with `trycloudflare.com`, it resolves the returned `Promise` with that URL.
- On finding the URL, the module registers process cleanup handlers for `SIGINT`, `SIGTERM`, `exit`, `uncaughtException`, `unhandledRejection` that call an internal `killChild()` to stop the spawned child process.

---

## Example usage

```js
import { startCloudflared } from "./cloudflared-js.js";

(async () => {
  try {
    // Basic use: start tunnel and receive URL
    const url = await startCloudflared({ port: 3000 });
    console.log("Tunnel URL:", url);
  } catch (err) {
    console.error("Failed to start cloudflared tunnel:", err);
  }
})();
```

### With automatic update + callbacks

```js
import { startCloudflared } from "./cloudflared-js.js";

function gotNewLink(newLink) {
  console.log("New cloudflared link:", newLink);
  // e.g. update a remote config, notify client, update DNS, etc.
}

function onFault() {
  console.error("cloudflared auto-restart exceeded retry limit.");
  // fallback behavior (alert operator, stop server, etc.)
}

startCloudflared({
  port: 3000,
  verbose: true,
  autoFaultDetectionAndUptate: true, // NOTE: exact option name used by module
  successCallback: gotNewLink,
  faultCallback: onFault,
  delay: 5000,
  afterFaultReties: 5,
})
  .then((url) => {
    console.log("Initial link:", url);
  })
  .catch((err) => {
    console.error("Error:", err);
  });
```

---

## Implementation details / internal behavior

- **Process spawn:** the code uses `spawn('cloudflared', ['tunnel', '--url', 'http://localhost:<port>'], { stdio: ['ignore', 'pipe', 'pipe'] })` and parses both stdout and stderr to detect the URL.
- **URL extraction:** uses regex `/https?:\/\/[^\s)]+/i` and further checks `trycloudflare.com` with `/trycloudflare\.com$/i`.
- **Logging:** if `verbose` is `true`, the module appends every parsed line to `./cloudflaredjs.logs.txt` (using `fs.appendFile`) for debugging.
- **Auto-fault detection (retryUpdate):**

  - When enabled, `retryUpdate()` is started. It awaits the `Promise` that resolves with the initial link.
  - It sets a repeating `setInterval` (stored in module-level `retryInterval`) that:

    - Performs `fetch(link)`.
    - If response status is not `200`, it calls `killChild()`, starts a new `cloudflared` via `startCloudflared(...Object.values(args))`, assigns the new link, and calls `successCallback(newLink)`. It increments `faultRetries`.
    - If `faultRetries` exceeds `args.afterFaultReties`, it clears the interval and calls `faultCallback()` and throws an error.

  - `faultRetries` resets to zero on a successful 200 response.

- **Cleanup:** `killChild()` attempts to kill the child process:

  - If `child.pid` exists and `process.platform === 'win32'`, it runs `taskkill /PID <pid> /T /F`.
  - Otherwise, it attempts `process.kill(-pid, 'SIGTERM')` (kills process group) and falls back to `child.kill('SIGTERM')`. If no `pid` is set, it just calls `child.kill()`.

---

## Known issues, caveats & recommended fixes

1. **Option name typos:**

   - `autoFaultDetectionAndUptate` — spelled "Uptate" in the module. If you try to pass `autoFaultDetectionAndUpdate` it will not enable the feature. Use the exact key the module expects, or better: fix the source to correct the typo.
   - `afterFaultReties` — spelled "Reties" (missing 'r'). Same caution applies.
   - Recommendation: rename/migrate these option names to the correctly spelled ones and maintain backward compatibility (support both keys for a release cycle).

2. **`successCallback` default is a string:**

   - Default value is `"() => { }"` (a string) which means the code `typeof successCallback === "function"` will be `false` unless the caller passes a real function. This can cause surprising behavior. Recommendation: default should be `() => {}` (a function), not a string.

3. **Global mutable state & multiple calls:**

   - Module uses module-level variables `child`, `args`, `retryInterval`, and `cleaningUp`. Calling `startCloudflared()` more than once concurrently may lead to unpredictable behavior. If you need multiple tunnels concurrently, refactor to return per-instance controllers (recommended).

4. **`counter` and thrown Error:**

   - The code defines `let counter = 0` but never increments it. There is a check `if (counter === 11) throw new Error(...)` — since `counter` never changes, that check never fires. Either the counter is unused or the author intended to increment it per-line. This is a bug.

5. **`process.on('uncaughtException', (err) => { killChild(); throw err; });`**

   - Re-throwing in an `uncaughtException` handler will terminate the process as usual. That may be fine, but be aware that throwing inside such a handler may lead to abrupt exit. Consider graceful logging or clean shutdown strategies.

6. **`fetch` usage:**

   - The `retryUpdate` function uses `fetch(link)` — ensure Node runtime supports `fetch` (Node 18+ or polyfill). If running on older Node, polyfill `node-fetch` or upgrade Node.

7. **No explicit timeouts for network checks:**

   - The `fetch` call uses no timeout; a hanging network call may block the interval callback. Consider adding an abort timeout.

8. **Permission / firewall / port assumptions:**

   - The module assumes the local server is reachable at `http://localhost:<port>`. Ensure your service is bound to the correct interface and port.

---

## Recommended improvements (if you intend to maintain or enhance)

- Fix the option-name typos and default `successCallback` type.
- Convert to an instance class that returns a controller object with `start()`, `stop()`, and status properties rather than module-level globals.
- Implement per-line `counter` increment (if intended) or remove the dead code.
- Add unit tests and a small integration test that uses a local server and mocks the `cloudflared` output (or runs a real `cloudflared` in CI if available).
- Add a configurable `fetch` timeout and backoff strategy for retries.
- Provide TypeScript typings (a `.d.ts` or migrate to `.ts`) so callers get compile-time checking for option keys and callbacks.
- Use `fs.appendFileSync` or a rotating logger library if you need guaranteed log order or rotation for production logging.

---

## Type definitions (suggested) — for clarity

```ts
type StartOptions = {
  port: number;
  verbose?: boolean;
  autoFaultDetectionAndUptate?: boolean; // note spelling in module
  successCallback?: (newLink: string) => void;
  faultCallback?: () => void;
  delay?: number;
  afterFaultReties?: number; // note spelling in module
};
```

Return: `Promise<string>` — resolves with the trycloudflare URL (string).

---

## Example minimal README snippet

````
# cloudflared-js

Start a `cloudflared` tunnel and obtain the dynamic `trycloudflare.com` link from stdout.

Requirements:
- `cloudflared` must be installed and in PATH.
- Node 18+ (recommended for native fetch).

Usage:
```js
const { startCloudflared } = require('./cloudflared-js');

startCloudflared({ port: 3000 })
  .then(url => console.log('Tunnel URL:', url))
  .catch(err => console.error('Error starting tunnel:', err));
````

```

---

If you want, I can:
- produce an **annotated** (JSDoc) version of your source file (injecting JSDoc comments above exported functions and the internal helpers),
- or produce a cleaned-up, refactored version that fixes the typos, avoids module-level global state, and returns an instance controller (class) with `start()`/`stop()` (I will implement the improvements and tests).

Which of those would you like next?
```
