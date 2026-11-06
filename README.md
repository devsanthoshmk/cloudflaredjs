# cloudflaredjs

Cloudflare quick tunnels Node.js manager. Expose localhost to the internet with programmatic cloudflared process management, URL extraction, and automatic rotation.

## Purpose

`cloudflaredjs` is a Node.js wrapper for Cloudflare quick tunnels. It acts as an open source ngrok alternative that runs on Cloudflare edge infrastructure.

Cloudflare quick tunnels expose local web applications to the internet without an account, custom domain, or configuration file. Running `cloudflared tunnel --url http://localhost:3000` generates an ephemeral `trycloudflare.com` URL. When the tunnel connection drops, restarting `cloudflared` generates a different random URL.

`cloudflaredjs` manages this lifecycle in JavaScript. The module starts the child process, extracts the public URL from the process output, polls the connection, and restarts the tunnel when Cloudflare disconnects. You can capture the new URL in a callback and update your database, DNS records, or webhook endpoints.

## Architecture

`cloudflaredjs` coordinates four mechanisms:

1. Process spawning. The library calls `child_process.spawn` to run `cloudflared tunnel --url http://localhost:<port>`. On POSIX systems, it spawns detached child processes in an isolated process group. On Windows, it spawns standard child processes.
2. Output parsing. The module reads stdout and stderr lines through Node.js `readline`. It matches URLs ending with `trycloudflare.com` using regular expressions. If 11 lines pass without finding a URL, the startup promise rejects and the process terminates.
3. Health monitoring and rotation. When `autoFaultDetectionAndUpdate` is true, an interval timer polls the public tunnel URL using global `fetch` every `delay` milliseconds. If Cloudflare returns an HTTP 502 or 503 gateway error, the library kills the process, starts a fresh tunnel, and passes the new URL to `successCallback`. If consecutive failures exceed `afterFaultRetries`, the loop stops and calls `faultCallback`.
4. Clean termination. The `killChild` method stops the active tunnel and clears all active timers. On POSIX systems, it sends `SIGTERM` to the process group (`-pid`). On Windows, it calls `taskkill /PID <pid> /T /F`. The library also registers listeners for `SIGINT`, `SIGTERM`, `exit`, `uncaughtException`, and `unhandledRejection` to kill child processes before Node.js exits.

## Setup

### Prerequisites

- Node.js 18 or higher. The health check loop uses the native global `fetch` API.
- The `cloudflared` executable installed and available in your system `PATH`. Refer to Cloudflare documentation for official package manager or binary download instructions.

### Installation

Install the package directly from GitHub:

```bash
npm install github:devsanthoshmk/cloudflaredjs
```

## Usage

### Start a basic localhost tunnel

Start a single quick tunnel and obtain the public URL:

```javascript
import { createTunnel } from 'cloudflaredjs';

const tunnel = createTunnel();

try {
  const url = await tunnel.startCloudflared({
    port: 3000,
    verbose: true,
  });
  console.log('Tunnel public URL:', url);
} catch (error) {
  console.error('Failed to create tunnel:', error);
} finally {
  // Stop the tunnel when finished:
  // tunnel.killChild();
}
```

### Automatic tunnel rotation with callbacks

Monitor the tunnel and receive new URLs automatically when Cloudflare drops the connection:

```javascript
import { createTunnel } from 'cloudflaredjs';

const tunnel = createTunnel();

const url = await tunnel.startCloudflared({
  port: 3000,
  verbose: true,
  autoFaultDetectionAndUpdate: true,
  delay: 8000,
  afterFaultRetries: 10,
  successCallback: (newUrl) => {
    console.log('Tunnel rotated to new URL:', newUrl);
    // Write newUrl to your database, key-value store, or webhook destination
  },
  faultCallback: () => {
    console.error('Tunnel failed permanently after exhausting retries.');
  },
});

console.log('Initial tunnel URL:', url);

process.on('SIGINT', () => {
  tunnel.killChild();
  process.exit();
});
```

### Web preview with dynamic frontend

When sharing dev environments or testing webhooks, quick tunnel URLs change across restarts. To maintain a stable entry point, host a static page on Cloudflare Pages or Vercel that renders the dynamic URL inside an `<iframe>`:

1. The backend service runs `cloudflaredjs` and saves every new URL from `successCallback` to an API or database.
2. The static frontend queries that API on page load and assigns the target URL to the iframe `src`.
3. Visitors use the permanent frontend domain while viewing live updates from your local server.

## Configuration

The `startCloudflared` function accepts the following options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | number | None (required) | Local port number forwarded through the tunnel. |
| `verbose` | boolean | `false` | Prints runtime messages to the console and writes stdout and stderr logs to `./cloudflaredjs.<port>.logs.txt`. |
| `autoFaultDetectionAndUpdate` | boolean | `false` | Enables the background health check loop and restarts the tunnel on HTTP 502 or 503 errors. |
| `successCallback` | function | `() => {}` | Receives the new tunnel URL string after an automatic restart. |
| `faultCallback` | function | None | Called when consecutive restart failures exceed `afterFaultRetries`. Required when `autoFaultDetectionAndUpdate` is `true`. |
| `delay` | number | `8000` | Interval in milliseconds between health check requests. |
| `afterFaultRetries` | number | `10` | Maximum number of consecutive health check failures before stopping retries. |

### Methods

`createTunnel()` returns an object with two functions:

- `startCloudflared(options)`. Spawns the `cloudflared` process and returns a `Promise<string>` resolving to the `trycloudflare.com` URL.
- `killChild()`. Stops the running child process and clears the health check timer.

## Operational limits

Quick tunnels run on shared Cloudflare infrastructure under Cloudflare terms of service:

- Run no more than 3 to 4 simultaneous tunnels per machine.
- Avoid rapid restart loops. Frequent reconnections trigger temporary Cloudflare IP blocks that last 10 to 15 minutes.
- Quick tunnels target development, staging previews, and webhook testing. Do not use quick tunnels for permanent production hosting.

## License

MIT
