# cloudflared-js — Module documentation

**Purpose:**
This module starts a `cloudflared` tunnel that exposes a local `http://localhost:<port>` service and returns the dynamic `trycloudflare.com` URL produced by `cloudflared`. It includes an optional automatic fault-detection-and-update feature that will detect when the tunnel goes down, restart `cloudflared`, and call user-supplied callbacks.

---

## Quick summary

- **Exported function:** `createTunnel()`
  Factory function that returns an isolated tunnel manager instance with `{ startCloudflared, killChild }` methods.

- **`startCloudflared(options)`** starts a `cloudflared` process and resolves a `Promise` with the dynamic public URL (the `trycloudflare.com` link) once it appears in `cloudflared` stdout/stderr.

- **Optional behavior:** when `autoFaultDetectionAndUpdate` is `true` and both `successCallback` and `faultCallback` are functions, the module will periodically check the dynamic URL and, on failure, restart `cloudflared` and call the callbacks.

- **Important runtime requirements:**

  - `cloudflared` binary must be installed and available in `PATH`.
  - The module uses Node built-in `child_process`, `readline`, and `fs`.
  - Uses closure-scoped state (encapsulated per tunnel instance) and process-level handlers (SIGINT, SIGTERM, exit, etc.).
  - Requires Node.js 18+ for native `fetch` support.

---

## Installation / prerequisites

1. Install `cloudflared` on the host machine and ensure it can be run by simply calling `cloudflared` from a shell (i.e., it's in `PATH`). See the official Cloudflare documentation for installation instructions for your OS.
2. Use Node.js 18+ (required for native `fetch` API used in health checks).
3. Install via npm: `npm install cloudflaredjs`
4. Import this module in your code and call `createTunnel()` to get a tunnel instance.

---

## API

### `createTunnel() : { startCloudflared, killChild }`

Factory function that creates an isolated tunnel manager instance. Each instance maintains its own child process and configuration in a closure.

**Returns:**

- `startCloudflared` **(function)** — starts the tunnel
- `killChild` **(function)** — stops the tunnel and cleans up

### `startCloudflared(options) : Promise<string>`

**Parameters (single `options` object):**

- `port` **(number, required)** — the local port to forward, e.g. `3000`. The module will attempt to forward `http://localhost:<port>`.

- `verbose` **(boolean, default `false`)** — when `true`, the module appends cloudflared stdout/stderr lines to `./cloudflaredjs.<port>.logs.txt` and prints additional runtime information to console.

- `autoFaultDetectionAndUpdate` **(boolean, default `false`)** — when `true`, the module will start automatic monitoring/restart logic to detect a faulty tunnel and attempt to obtain a new link. **Note:** This is the correct spelling (previously misspelled as "autoFaultDetectionAndUptate").

- `successCallback` **(function, default `() => {}`)** — a callback that is called with the new public link when a restart produces a new link. If `autoFaultDetectionAndUpdate` is enabled, this must be a function. Signature: `(url: string) => void`.

- `faultCallback` **(function, required if auto-update enabled)** — a callback invoked when fault-detection exhausts its retry budget. Required when `autoFaultDetectionAndUpdate` is enabled. Signature: `() => void`.

- `delay` **(number, default `8000`)** — interval in milliseconds between health checks of the tunnel URL when `autoFaultDetectionAndUpdate` is enabled.

- `afterFaultRetries` **(number, default `10`)** — number of **consecutive** failed health checks allowed before giving up and calling `faultCallback`. **Note:** This is the correct spelling (previously misspelled as "afterFaultReties"). The code compares `args.afterFaultRetries < faultRetries` for termination.

**Returns:**

- On success, a `Promise` that resolves to the detected public `trycloudflare.com` URL string.
- If `autoFaultDetectionAndUpdate` is set to `true` but either `successCallback` or `faultCallback` are not functions, the function immediately returns a rejected `Promise` with an `Error`.

**Behavior detail:**

- The module spawns `cloudflared tunnel --url http://localhost:<port>` with stdio pipes and parses `child.stdout` and `child.stderr` line-by-line using `readline.createInterface`.
- It looks for the first HTTP(S) URL matching `/https?:\/\/[^\s)]+/i`. When the found URL ends with `trycloudflare.com`, it resolves the returned `Promise` with that URL.
- Includes a safety check: if no URL is found within the first 11 lines of output, it rejects the promise and kills the child process.
- Logs are written to `./cloudflaredjs.<port>.logs.txt` when `verbose` is enabled.

### `killChild() : void`

Stops the spawned cloudflared child process and clears all health check intervals.

**Behavior:**

- Idempotent (safe to call multiple times)
- Clears the `retryInterval` if running
- Kills the process using:
  - `taskkill /PID <pid> /T /F` on Windows
  - `process.kill(-pid, 'SIGTERM')` on Unix (kills process group)
  - Falls back to `child.kill('SIGTERM')` if group kill fails
- Sets internal `child` reference to `null`

---

## Example usage

### Basic usage

```js
import { createTunnel } from "cloudflaredjs";

const tunnel1 = createTunnel();

(async () => {
  try {
    const url = await tunnel1.startCloudflared({ port: 3000 });
    console.log("Tunnel URL:", url);

    // When done:
    // tunnel1.killChild();
  } catch (err) {
    console.error("Failed to start cloudflared tunnel:", err);
  }
})();
```

### With automatic update + callbacks

```js
import { createTunnel } from "cloudflaredjs";

const tunnel1 = createTunnel();

function gotNewLink(newLink) {
  console.log("New cloudflared link:", newLink);
  // e.g. update a remote config, notify client, update DNS, etc.
}

function onFault() {
  console.error("cloudflared auto-restart exceeded retry limit.");
  // fallback behavior (alert operator, stop server, etc.)
}

tunnel1
  .startCloudflared({
    port: 5500,
    verbose: false,
    autoFaultDetectionAndUpdate: true, // correct spelling
    successCallback: gotNewLink,
    faultCallback: onFault,
    delay: 8000,
    afterFaultRetries: 10, // correct spelling
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

- **Factory pattern:** `createTunnel()` returns an object with methods. Each instance maintains its own closure-scoped state (`child`, `args`, `retryInterval`, `cleaningUp`), allowing multiple independent tunnels.

- **Process spawn:** uses `spawn('cloudflared', ['tunnel', '--url', 'http://localhost:<port>'], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })` and parses both stdout and stderr.

- **URL extraction:** uses regex `/https?:\/\/[^\s)]+/i` and further checks `trycloudflare.com` with `/trycloudflare\.com$/i`.

- **Safety mechanism:** Rejects the promise if no URL is found in the first 11 lines of output (uses a `counter` variable).

- **Logging:** if `verbose` is `true`, the module appends every parsed line to `./cloudflaredjs.<port>.logs.txt` using `fs.appendFile`.

- **Auto-fault detection (`retryUpdate`):**

  - When enabled, `retryUpdate()` awaits the initial URL promise.
  - Sets a repeating `setInterval` (stored in closure-scoped `retryInterval`) that:
    - Performs `fetch(link)` health check.
    - Tracks `faultRetries` (consecutive failures) and `overallRetries` (total attempts).
    - If response status is not `200`, it:
      - Increments `faultRetries`
      - Calls `killChild()`
      - Starts new `cloudflared` via `startCloudflared({ ...args })`
      - Calls `successCallback(newLink)` with the new URL
      - Recursively calls `retryUpdate()` with the new promise
    - If `faultRetries` exceeds `args.afterFaultRetries`:
      - Clears the interval
      - Calls `faultCallback()`
      - Throws an error
    - On successful 200 response, resets `faultRetries` to 0

- **Cleanup (`killChild`):**
  - Uses a `cleaningUp` latch to prevent concurrent kill attempts
  - Always clears `retryInterval` first
  - Platform-specific process termination:
    - Windows: `taskkill /PID <pid> /T /F`
    - Unix: `process.kill(-pid, 'SIGTERM')` (process group)
    - Fallback: `child.kill('SIGTERM')`

---

## Known issues, caveats & best practices

1. **Multiple tunnel instances:**

   - ✅ The factory pattern now supports multiple concurrent tunnels properly
   - Each `createTunnel()` call creates an isolated instance
   - No global state conflicts

2. **Cloudflare rate limits:**

   - **Do not** create more than 3–4 simultaneous tunnels
   - **Do not** restart tunnels in rapid succession
   - Excessive use may result in temporary IP blocking (10–15 minutes)

3. **`fetch` API requirement:**

   - Requires Node.js 18+ for native `fetch` support
   - For older Node versions, install `node-fetch` polyfill

4. **No explicit fetch timeouts:**

   - The `fetch(link)` call has no timeout configuration
   - Hanging requests could delay health check intervals
   - Consider wrapping with `AbortController` and timeout

5. **11-line safety check:**

   - The module rejects if no URL found in first 11 output lines
   - If `cloudflared` is slow to start, this might trigger prematurely
   - Consider making this configurable

6. **Health check behavior:**

   - Only checks for HTTP 200 status
   - Any non-200 response (including redirects, 404, 500) triggers restart
   - Consider customizable success criteria

7. **Consecutive vs total retries:**

   - `afterFaultRetries` counts **consecutive** failures only
   - Resets to 0 on any successful check
   - Total attempts tracked separately in `overallRetries`

8. **Log file management:**
   - Creates `./cloudflaredjs.<port>.logs.txt` per tunnel
   - No automatic rotation or size limits
   - Consider implementing log rotation for production use

---

## Type definitions

```ts
type TunnelInstance = {
  startCloudflared: (options: StartOptions) => Promise<string>;
  killChild: () => void;
};

type StartOptions = {
  port: number;
  verbose?: boolean;
  autoFaultDetectionAndUpdate?: boolean;
  successCallback?: (newLink: string) => void;
  faultCallback?: () => void;
  delay?: number;
  afterFaultRetries?: number;
};

export function createTunnel(): TunnelInstance;
```

---

## Recommended improvements

- ✅ **Fixed:** Option name typos corrected (`autoFaultDetectionAndUpdate`, `afterFaultRetries`)
- ✅ **Fixed:** `successCallback` now defaults to a function, not a string
- ✅ **Fixed:** Instance-based architecture eliminates global state issues
- ✅ **Implemented:** Counter increments properly for 11-line safety check

**Future enhancements:**

- Add configurable fetch timeout with `AbortController`
- Implement log rotation or streaming logger
- Add TypeScript definitions file (`.d.ts`)
- Add configurable success status codes (not just 200)
- Add graceful shutdown delay before `killChild()`
- Support custom `cloudflared` binary path
- Add event emitter pattern for tunnel lifecycle events
- Unit tests with mocked `cloudflared` output
- Integration tests with real `cloudflared` (if available in CI)

---

## Example README snippet

````markdown
# cloudflaredjs

Start a `cloudflared` tunnel and obtain the dynamic `trycloudflare.com` link.

## Requirements

- `cloudflared` must be installed and in PATH
- Node.js 18+ (for native fetch)

## Installation

```bash
npm install cloudflaredjs
```
````

## Usage

```js
import { createTunnel } from "cloudflaredjs";

const tunnel = createTunnel();

const url = await tunnel.startCloudflared({ port: 3000 });
console.log("Tunnel URL:", url);

// Stop when done
tunnel.killChild();
```

## Auto-restart example

```js
const tunnel = createTunnel();

await tunnel.startCloudflared({
  port: 3000,
  autoFaultDetectionAndUpdate: true,
  successCallback: (url) => console.log("New URL:", url),
  faultCallback: () => console.error("Tunnel failed permanently"),
  delay: 8000,
  afterFaultRetries: 10,
});
```
