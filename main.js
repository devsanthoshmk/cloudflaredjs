import { spawn, exec } from 'child_process';
import { createInterface } from 'readline';
import * as fs from 'node:fs';

export function createTunnel() {

    let child;
    const args={}
    function startCloudflared({port, verbose = false, autoFaultDetectionAndUpdate = false, successCallback = () => { }, delay = 3000, afterFaultRetries = 10, faultCallback}) {
        args.port = port;
        args.verbose = verbose;
        args.autoFaultDetectionAndUpdate = autoFaultDetectionAndUpdate;
        args.successCallback = successCallback;
        args.faultCallback = faultCallback;
        args.delay = delay;
        args.afterFaultRetries = afterFaultRetries;

        const sathiyam = new Promise((resolve) => {
            const CLOUDFLARED_BIN = 'cloudflared';
            const CLOUD_ARGS = ['tunnel', '--url', `http://localhost:${port}`];

            child = spawn(CLOUDFLARED_BIN, CLOUD_ARGS, {
                stdio: ['ignore', 'pipe', 'pipe'], // pipe stdout/stderr for parsing
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
                    fs.appendFile(`./cloudflaredjs.${port}.logs.txt`, line + "\n", (err) => {
                    if (err) {
                        console.error('Error appending to file:', err);
                        return;
                    }
                    });
                }
                if (urlFound) return;
                if (counter === 11) throw new Error(`To automatically update the dynamic tunnel link on disconnect set autoFaultDetectionAndUpdate=true and callback function to update the dynamic url`)
                const match = line.match(/https?:\/\/[^\s)]+/i);
                if (match) {
                    const url = match[0].trim();
                    if (/trycloudflare\.com$/i.test(url)) {
                        detectedUrl = url;
                        urlFound = true; urlFound
                        // console.info(detectedUrl); // <-- only print the URL
                        process.on('SIGINT', killChild);
                        process.on('SIGTERM', killChild);
                        process.on('exit', killChild);
                        process.on('uncaughtException', (err) => { killChild(); throw err; });
                        process.on('unhandledRejection', () => killChild());

                        resolve(detectedUrl)
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
        clearInterval(retryInterval);
        if (cleaningUp) return;
        if (!child) return;
        cleaningUp = true;
        
        if (!child.killed) {
        const pid = child.pid;
        if (pid) {
        if (process.platform === 'win32') {
            exec(`taskkill /PID ${pid} /T /F`, () => {});
        } else {
            try { process.kill(-pid, 'SIGTERM'); } catch (e) { child.kill('SIGTERM'); }
        }
        } else {
            child.kill();
        }
    }
    }

    let retryInterval;

    async function retryUpdate(link_sathiyam, successCallback, faultCallback) {
        if (args.verbose === true) {
            console.log("Starting auto fault detection and update for cloudflared tunnel");
        }

        let link = await link_sathiyam;
        let overallRetries=0  //overall count from the last update
        let faultRetries = 0;
        
        const retry = async () => {
            try {
                if (args.afterFaultRetries < faultRetries) {
                    console.error("Exceeded number of fault retries")
                    clearInterval(retryInterval);
                    faultCallback();
                    throw new Error("Exceeded number of fault retries")
                }
                const res = await fetch(link);
                // console.log("retring for ",overallRetries,res.status)
                if (res.status !== 200) {
                    clearInterval(retryInterval);
                    overallRetries
                    // console.log("updating")
                    killChild()
                    console.error("Lost connection retring fault retires",faultRetries)
                    link = await startCloudflared(args);
                    // console.log("in retry ", link)
                    successCallback(link);
                    faultRetries++;
                } else {
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
        retryInterval = setInterval(retry,args.delay,)
        
    }
    return { startCloudflared, killChild };
}
