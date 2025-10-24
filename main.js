import { spawn, exec } from 'child_process';
import { createInterface } from 'readline';
import * as fs from 'node:fs';

export function createTunnel() {

    let child;
    const args={}
    function startCloudflared({port, verbose = false, autoFaultDetectionAndUpdate = false, successCallback = () => { }, delay = 8000, afterFaultRetries = 10, faultCallback}) {
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

        const sathiyam = new Promise((resolve) => {
            const CLOUDFLARED_BIN = 'cloudflared';
            const CLOUD_ARGS = ['tunnel', '--url', `http://localhost:${port}`];

            // if (verbose === true) {
            //     console.log(`[cloudflared-js] Spawning: ${CLOUDFLARED_BIN} ${CLOUD_ARGS.join(' ')}`);
            // }

            child = spawn(CLOUDFLARED_BIN, CLOUD_ARGS, {
                stdio: ['ignore', 'pipe', 'pipe'], // pipe stdout/stderr for parsing
            });

            if (child && child.pid && verbose === true) {
                console.log(`[cloudflared-js] Spawned cloudflared (pid=${child.pid})`);
            }

            // attach process event listeners for observability
            child.on('error', (err) => {
                if (verbose === true) console.error('[cloudflared-js] child process error:', err);
            });
            child.on('exit', (code, signal) => {
                if (verbose === true) console.log(`[cloudflared-js] child exited with code=${code} signal=${signal}`);
            });

            // console.log(child.pid)

            let detectedUrl = null;
            let urlFound = false;

            // Only parse cloudflared output to find the trycloudflare URL
            const rlOut = createInterface({ input: child.stdout });
            const rlErr = createInterface({ input: child.stderr });
            let counter = 0
            function tryExtractUrl(line) {
                if (verbose === true) {
                    // write to log file as before and also print readable console log
                    fs.appendFile(`./cloudflaredjs.${port}.logs.txt`, line + "\n", (err) => {
                        if (err) {
                            console.error('[cloudflared-js] Error appending to file:', err);
                            return;
                        }
                    });
                }
                if (urlFound) return;
                if (counter === 11) {
                    if (verbose === true) console.debug(`[cloudflared-js] No URL till line ${counter}. So Terminating process.`);
                    throw new Error(`To automatically update the dynamic tunnel link on disconnect set autoFaultDetectionAndUpdate=true and callback function to update the dynamic url`)
                }
                const match = line.match(/https?:\/\/[^\s)]+/i);
                if (match) {
                    const url = match[0].trim();
                    if (/trycloudflare\.com$/i.test(url)) {
                        detectedUrl = url;
                        urlFound = true; urlFound
                        if (verbose === true) console.log(`[cloudflared-js] Detected trycloudflare URL: ${detectedUrl}`);
                        // console.info(detectedUrl); // <-- only print the URL
                        process.on('SIGINT', killChild);
                        process.on('SIGTERM', killChild);
                        process.on('exit', killChild);
                        process.on('uncaughtException', (err) => { killChild(); throw err; });
                        process.on('unhandledRejection', () => killChild());

                        resolve(detectedUrl)
                    } else {
                        if (verbose === true) console.log(`[cloudflared-js] Found URL but doesn't match trycloudflare: ${url}`);
                    }
                } else {
                    counter++;
                }
            }

            rlOut.on('line', tryExtractUrl);
            rlErr.on('line', tryExtractUrl);
        })

        if (typeof successCallback === "function" && autoFaultDetectionAndUpdate && typeof faultCallback === "function") {
            retryUpdate(sathiyam,successCallback,faultCallback)
        } else if(autoFaultDetectionAndUpdate && (typeof successCallback !== "function" || typeof faultCallback !== "function")) {
            return Promise.reject(new Error(`To automatically update the dynamic tunnel link on disconnect set autoFaultDetectionAndUpdate=true and callback function to update the dynamic url`))
        }
        return sathiyam

    }


    // ---- cleanup ----
    let cleaningUp = false;
    function killChild() {
        if (args.verbose === true) {
            console.log("[cloudflared-js] killChild() invoked");
        }

        clearInterval(retryInterval);
        if (cleaningUp) {
            if (args.verbose === true) console.log("[cloudflared-js] already cleaning up, returning");
            return;
        }
        if (!child) {
            if (args.verbose === true) console.log("[cloudflared-js] no child process to kill");
            return;
        }
        cleaningUp = true;
        
        if (!child.killed) {
            const pid = child.pid;
            if (args.verbose === true) console.log(`[cloudflared-js] Attempting to kill child (pid=${pid})`);
            if (pid) {
                if (process.platform === 'win32') {
                    exec(`taskkill /PID ${pid} /T /F`, (err) => {
                        if (args.verbose === true) {
                            if (err) console.error("[cloudflared-js] taskkill error:", err);
                            else console.log("[cloudflared-js] taskkill executed");
                        }
                    });
                } else {
                    try {
                        process.kill(-pid, 'SIGTERM');
                        if (args.verbose === true) console.log("[cloudflared-js] Sent SIGTERM to process group");
                    } catch (e) {
                        if (args.verbose === true) console.warn("[cloudflared-js] kill process group failed, killing child directly", e);
                        child.kill('SIGTERM');
                    }
                }
            } else {
                if (args.verbose === true) console.log("[cloudflared-js] child.pid not available, calling child.kill()");
                child.kill();
            }
        } else {
            if (args.verbose === true) console.log("[cloudflared-js] child already killed");
        }
    }

    let retryInterval;

    async function retryUpdate(link_sathiyam, successCallback, faultCallback) {
        // if (args.verbose === true) {
        //     console.log("Starting auto fault detection and update for cloudflared tunnel");
        // }

        let link = await link_sathiyam;
        // if (args.verbose === true) {
        //     console.log(`[cloudflared-js] initial link: ${link}`);
        // }
        let overallRetries=0  //overall count from the last update
        let faultRetries = 0;
        
        const retry = async () => {
            try {
                if (args.afterFaultRetries < faultRetries) {
                    clearInterval(retryInterval);
                    if (args.verbose === true) console.log("[cloudflared-js] Calling faultCallback due to exceeded retries");
                    faultCallback();
                    throw new Error("Exceeded number of fault retries")
                }
                if (args.verbose === true) console.log(`[cloudflared-js] Checking link (attempt ${overallRetries + 1}, faultRetries=${faultRetries}) -> ${link}`);
                const res = await fetch(link);
                if (args.verbose === true) console.log(`[cloudflared-js] Fetch status: ${res.status}`);
                // console.log("retring for ",overallRetries,res.status)
                if (res.status !== 200) {
                    clearInterval(retryInterval);
                    overallRetries
                    // console.log("updating")
                    if (args.verbose === true) console.log("[cloudflared-js] Detected non-200 status, rotating tunnel");
                    killChild()
                    link = await startCloudflared(args);
                    if (args.verbose === true) console.log(`[cloudflared-js] Obtained new link: ${link}`);
                    // console.log("in retry ", link)
                    successCallback(link);
                    faultRetries++;
                } else {
                    if (args.verbose === true) console.log("[cloudflared-js] Link healthy (200).");
                    faultRetries = 0; //reset fault retries on success
                }
                overallRetries++;
            } catch (e) {
                if (args.verbose === true) {
                    console.error("Error from cloudflaredjs: ", e)
                }
                faultRetries++;
                overallRetries++;
            }
        }
        if (args.verbose === true) console.log(`[cloudflared-js] Scheduling health check every ${args.delay}ms`);
        retryInterval = setInterval(retry,args.delay,)
        
    }
    return { startCloudflared, killChild };
}
