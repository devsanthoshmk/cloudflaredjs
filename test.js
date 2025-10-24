import { createTunnel } from './main.js';
const tunnel1 = createTunnel();
  try {
    const url = await tunnel1.startCloudflared({ port: 5500, verbose: true, autoFaultDetectionAndUpdate: true, successCallback: (link) => { console.log(link) }, faultCallback: () => { console.log("fault callback called") } });
    console.log('tunnel ready at', url);
  } catch (err) {
    console.error('cloudflared failed:', err);
  }
