/**
 * @file This module provides a wrapper around the 'cloudflared' binary
 * to create and manage a persistent tunnel from a local port to a
 * public trycloudflare.com URL. It includes automatic fault detection
 * and tunnel restarting.
 */

import { spawn, exec } from 'child_process';
import { createInterface } from 'readline';
import * as fs from 'node:fs';

/**
 * Creates a new tunnel manager instance.
 * This function acts as a factory, returning methods to start and stop
 * the cloudflared tunnel, while managing the child process and restart
 * configuration in its own closure.
 *
 * @returns {{startCloudflared: Function, killChild: Function}} An object containing
 * functions to start and kill the tunnel.
 */
export function createTunnel() {

    /** @type {import('child_process').ChildProcess | null} */
    let child = null; // Holds the spawned cloudflared child process

    /** @type {object} */
    const args = {}; // Stores the configuration for automatic restarts

    /** @type {NodeJS.Timeout | null} */
    let retryInterval = null; // Holds the interval timer for health checks

    /**
     * Starts the cloudflared tunnel.
     * It spawns the 'cloudflared' binary, parses its output to find the
     * public URL, and optionally sets up a health check loop to restart
     * the tunnel if it becomes unresponsive.
     *
     * @param {object} options - Configuration options for the tunnel.
     * @param {number} options.port - The local port to expose (e.g., 3000).
     * @param {boolean} [options.verbose=false] - Enable detailed logging to the console and a log file.
     * @param {boolean} [options.autoFaultDetectionAndUpdate=false] - Enable automatic health checks and restarts.
     * @param {function(string): void} [options.successCallback=()=>{}] - Callback function to be called with the *new* URL after a successful restart.
     * @param {number} [options.delay=8000] - The interval (in ms) for health checks.
     * @param {number} [options.afterFaultRetries=10] - The number of *consecutive* failed health checks before giving up and calling `faultCallback`.
     * @param {function(): void} options.faultCallback - Callback function to be called when fault retries are exhausted.
     * @returns {Promise<string>} A promise that resolves with the public trycloudflare.com URL.
     * @throws {Error} Throws an error if auto-update is enabled without providing necessary callbacks.
     */
    function startCloudflared({ port, verbose = false, autoFaultDetectionAndUpdate = false, successCallback = () => { }, delay = 8000, afterFaultRetries = 10, faultCallback }) {
        
        // Store all arguments in the closure scope for use in `retryUpdate`
        args.port = port;
        args.verbose = verbose;
        args.autoFaultDetectionAndUpdate = autoFaultDetectionAndUpdate;
        args.successCallback = successCallback;
        args.faultCallback = faultCallback;
        args.delay = delay;
        args.afterFaultRetries = afterFaultRetries;

        // if (verbose === true) {
        //     console.log(`[cloudflared-js] startCloudflared called with port=${port}, autoFaultDetectionAndUpdate=${autoFaultDetectionAndUpdate}, delay=${delay}, afterFaultRetries=${afterFaultRetries}`);
        // }

        // This Promise (`sathiyam`) is the core of the function.
        // It resolves when the URL is successfully parsed from the child process output.
        const sathiyam = new Promise((resolve, reject) => {
            const CLOUDFLARED_BIN = 'cloudflared';
            const CLOUD_ARGS = ['tunnel', '--url', `http://localhost:${port}`];

            // if (verbose === true) {
            //     console.log(`[cloudflared-js] Spawning: ${CLOUDFLARED_BIN} ${CLOUD_ARGS.join(' ')}`);
            // }

            // Spawn the cloudflared process.
            // We pipe stdio to parse its output for the URL.
            child = spawn(CLOUDFLARED_BIN, CLOUD_ARGS, {
                stdio: ['ignore', 'pipe', 'pipe'], // pipe stdout/stderr for parsing
                detached: process.platform !== 'win32', // Use detached mode for process group killing on Linux/macOS
            });

            if (child && child.pid && verbose === true) {
                console.log(`[cloudflared-js] Spawned cloudflared (pid=${child.pid})`);
            }

            // --- Attach process event listeners for observability ---
            child.on('error', (err) => {
                if (verbose === true) console.error('[cloudflared-js] child process error:', err);
                reject(err); // Reject the promise if the process fails to spawn
            });
            child.on('exit', (code, signal) => {
                if (verbose === true) console.log(`[cloudflared-js] child exited with code=${code} signal=${signal}`);
            });
            // console.log(child.pid)

            let detectedUrl = null;
            let urlFound = false;

            // Use readline to parse stdout and stderr line by line
            const rlOut = createInterface({ input: child.stdout });
            const rlErr = createInterface({ input: child.stderr });
            
            let counter = 0; // Line counter for early failure detection

            /**
             * Parses a line of output to find the trycloudflare.com URL.
             * @param {string} line - A line of text from stdout or stderr.
             */
            function tryExtractUrl(line) {
                if (verbose === true) {
                    // Log to a file for debugging
                    fs.appendFile(`./cloudflaredjs.${port}.logs.txt`, line + "\n", (err) => {
                        if (err) {
                            console.error('[cloudflared-js] Error appending to file:', err);
                            return;
                        }
                    });
                }
                
                if (urlFound) return; // Stop processing once URL is found

                // Failsafe: If no URL is found after 11 lines, assume it failed.
                if (counter === 11) {
                    if (verbose === true) console.debug(`[cloudflared-js] No URL till line ${counter}. So Terminating process.`);
                    // Reject the promise if the URL isn't found quickly
                    const err = new Error(`Cloudflared failed to start. No URL found after 11 lines of output.`);
                    reject(err);
                    killChild(); // Clean up the failed process
                    return;
                }

                // Regex to find any http/https URL in the line
                const match = line.match(/https?:\/\/[^\s)]+/i);
                if (match) {
                    const url = match[0].trim();
                    // Verify it's the specific URL we want
                    if (/trycloudflare\.com$/i.test(url)) {
                        detectedUrl = url;
                        urlFound = true;
                        if (verbose === true) console.log(`[cloudflared-js] Detected trycloudflare URL: ${detectedUrl}`);
                        
                        // --- Attach global process listeners to ensure cleanup ---
                        // These listeners call killChild() when the main Node.js process exits.
                        process.on('SIGINT', killChild);  // Ctrl+C
                        process.on('SIGTERM', killChild); // `kill` command
                        process.on('exit', killChild);    // Normal exit
                        process.on('uncaughtException', (err) => { killChild(); throw err; }); // Crash
                        process.on('unhandledRejection', () => killChild()); // Unhandled promise

                        resolve(detectedUrl); // Resolve the main promise with the URL
                    } else {
                        if (verbose === true) console.log(`[cloudflared-js] Found URL but doesn't match trycloudflare: ${url}`);
                    }
                } else {
                    counter++;
                }
            }

            rlOut.on('line', tryExtractUrl);
            rlErr.on('line', tryExtractUrl);
        });

        // --- Auto Fault-Detection Logic ---
        if (typeof successCallback === "function" && autoFaultDetectionAndUpdate && typeof faultCallback === "function") {
            // If enabled, start the health check loop *after* the initial URL is found.
            retryUpdate(sathiyam, successCallback, faultCallback);
        } else if (autoFaultDetectionAndUpdate && (typeof successCallback !== "function" || typeof faultCallback !== "function")) {
            // Fail fast if auto-update is requested but callbacks are missing
            return Promise.reject(new Error(`To automatically update the dynamic tunnel link on disconnect set autoFaultDetectionAndUpdate=true and callback function to update the dynamic url`));
        }

        // Return the main promise that resolves with the URL
        return sathiyam;
    }


    // ---- cleanup ----
    let cleaningUp = false; // Latch to prevent multiple kill attempts

    /**
     * Kills the spawned cloudflared child process and stops health checks.
     * This function is designed to be idempotent (safe to call multiple times).
     */
    function killChild() {
        if (args.verbose === true) {
            console.log("[cloudflared-js] killChild() invoked");
        }

        // Always stop the health check loop, if it's running
        if (retryInterval) {
            clearInterval(retryInterval);
            retryInterval = null;
        }

        if (cleaningUp) {
            if (args.verbose === true) console.log("[cloudflared-js] already cleaning up, returning");
            return;
        }
        if (!child) {
            if (args.verbose === true) console.log("[cloudflared-js] no child process to kill");
            return;
        }
        
        cleaningUp = true; // Set the latch

        if (!child.killed) {
            const pid = child.pid;
            if (args.verbose === true) console.log(`[cloudflared-js] Attempting to kill child (pid=${pid})`);
            
            if (pid) {
                try {
                    if (process.platform === 'win32') {
                        // Windows: Use taskkill to forcefully kill the process and its children (/T)
                        exec(`taskkill /PID ${pid} /T /F`, (err) => {
                            if (args.verbose === true) {
                                if (err) console.error("[cloudflared-js] taskkill error:", err);
                                else console.log("[cloudflared-js] taskkill executed");
                            }
                        });
                    } else {
                        // Linux/macOS: Kill the entire process group by using a negative PID.
                        // This is more reliable for stopping all related processes.
                        // This requires the `detached: true` option in spawn().
                        process.kill(-pid, 'SIGTERM');
                        if (args.verbose === true) console.log("[cloudflared-js] Sent SIGTERM to process group");
                    }
                } catch (e) {
                    if (args.verbose === true) console.warn("[cloudflared-js] kill process group failed, killing child directly", e);
                    // Fallback to killing the single process if group-kill fails
                    child.kill('SIGTERM');
                }
            } else {
                // Fallback if PID is not available for some reason
                if (args.verbose === true) console.log("[cloudflared-js] child.pid not available, calling child.kill()");
                child.kill('SIGTERM');
            }
        } else {
            if (args.verbose === true) console.log("[cloudflared-js] child already killed");
        }
        child = null; // Clear the child reference
        cleaningUp = false; // Release the latch
    }


    /**
     * Manages the health check and restart loop.
     * This function is started by `startCloudflared` if auto-update is enabled.
     *
     * @param {Promise<string>} link_sathiyam - The promise for the *initial* tunnel URL.
     * @param {function(string): void} successCallback - The callback to notify of a *new* URL.
     * @param {function(): void} faultCallback - The callback to notify of *total failure*.
     */
    async function retryUpdate(link_sathiyam, successCallback, faultCallback) {
        
        // Wait for the first URL to be established
        let link = await link_sathiyam;
        
        let overallRetries = 0; // Total check attempts since the last success
        let faultRetries = 0;   // *Consecutive* failed attempts
        
        /**
         * The function that runs on each interval, performing the health check.
         */
        const retry = async () => {
            try {
                // Check if we've exceeded the consecutive failure limit
                if (args.afterFaultRetries < faultRetries) {
                    clearInterval(retryInterval);
                    retryInterval = null;
                    if (args.verbose === true) console.log("[cloudflared-js] Calling faultCallback due to exceeded retries");
                    faultCallback(); // Notify caller that the tunnel is down permanently
                    throw new Error("Exceeded number of fault retries");
                }

                if (args.verbose === true) console.log(`[cloudflared-js] Checking link (attempt ${overallRetries + 1}, faultRetries=${faultRetries}) -> ${link}`);
                
                // Perform the health check
                const res = await fetch(link);
                
                if (args.verbose === true) console.log(`[cloudflared-js] Fetch status: ${res.status}`);
                
                // If status is not 200 (or any other success status), it's considered a failure.
                if (res.status !== 200) {
                    if (args.verbose === true) console.log("[cloudflared-js] Detected non-200 status, rotating tunnel");
                    
                    // Stop the current interval. A new one will be started by the recursive call.
                    if(retryInterval) clearInterval(retryInterval);
                    retryInterval = null;

                    killChild(); // Kill the dead process
                    
                    // Start a new tunnel, using the saved `args`
                    link = await startCloudflared(args);
                    
                    if (args.verbose === true) console.log(`[cloudflared-js] Obtained new link: ${link}`);
                    
                    // Notify the user of the new, updated URL
                    successCallback(link);
                    
                    faultRetries++; // Increment consecutive failures
                } else {
                    // If the check was successful (status 200)
                    if (args.verbose === true) console.log("[cloudflared-js] Link healthy (200).");
                    faultRetries = 0; // Reset consecutive failure count
                }
                overallRetries++;
            } catch (e) {
                // This catch block handles network errors (e.g., fetch failed entirely)
                if (args.verbose === true) {
                    console.error("[cloudflared-js] Health check fetch error: ", e.message);
                }
                faultRetries++; // Count this as a failure
                overallRetries++;

                // If the error was from the fetch, but we're still within retry limits,
                // we'll just wait for the next interval.
                // If it was from `startCloudflared` (e.g., it failed to start),
                // the `startCloudflared` promise itself would have rejected,
                // and this `retry` function would have thrown, stopping the interval.
                // We'll restart the interval just in case it was cleared by a failure.
                if (!retryInterval && args.afterFaultRetries >= faultRetries) {
                     if (args.verbose) console.log("[cloudflared-js] Restarting interval after fetch error.");
                     retryInterval = setInterval(retry, args.delay);
                }
            }
        };

        // Start the health check loop
        if (args.verbose === true) console.log(`[cloudflared-js] Scheduling health check every ${args.delay}ms`);
        if (retryInterval) clearInterval(retryInterval); // Clear any old interval
        retryInterval = setInterval(retry, args.delay);
    }

    // Expose the public methods
    return { startCloudflared, killChild };
}