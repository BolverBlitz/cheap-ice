const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('node:fs');
const path = require('node:path');

const { getuserInput } = require('./utils.js');

/**
 * Ingress Ice Replica
 * A bot to take periodic screenshots of the Ingress Intel Map.
 * @constructor
 * @param {string} url - The URL of the Ingress Intel Map location to capture.
 * @param {string} screenshotPath - The directory path to save screenshots.
 * @param {number} intervalSeconds - The interval in seconds between screenshots. Default is 1 second.
 * @param {number} numberOfScreenshots - The total number of screenshots to take. Default is 60.
 * @param {number} screenshot_w - The width of the screenshot in pixels. Default is 1920.
 * @param {number} screenshot_h - The height of the screenshot in pixels. Default is 1080.
 */
class IngressIceReplica {
    constructor(url, screenshotPath, intervalSeconds = 10, numberOfScreenshots = 60, screenshot_w = 1920, screenshot_h = 1080) {
        this.url = url;
        this.screenshotPath = screenshotPath;

        if (!fs.existsSync(screenshotPath)) {
            fs.mkdirSync(screenshotPath, { recursive: true });
        }

        // Set Config
        this.screenshot_w = screenshot_w;
        this.screenshot_h = screenshot_h;
        this.intervalSeconds = intervalSeconds;
        this.numberOfScreenshots = numberOfScreenshots;

        // Internal
        this.blocking = false;
        this.stopRequested = false;

        // Make sure we can use google login and cookies
        puppeteer.use(StealthPlugin())
    }

    /**
     * Search for a string on the current page.
     * @param {String} searchString 
     * @returns {Promise<Boolean>}
     */
    #searchStringOnPage = async (searchString) => {
        const pageContent = await this.page.content();
        return pageContent.includes(searchString);
    }

    /**
     * Hide unwanted elements from the page before taking a screenshot.
     * @returns {Promise<void>}
     */
    #adjustPage = async () => {
        await this.page.addStyleTag({
            content: `
        /* Reset Dashboard to Fullscreen */
        #dashboard_container {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 9999 !important;
            background: #000 !important;
        }
        #map_canvas {
            width: 100% !important;
            height: 100% !important;
        }

        /* Remote unwanted UI Elements */
        #header, #chat, #comm, #game_stats, #player_stats, 
        #geotools, #filters_container, #portal_filter_header, 
        #tm_button, #shard_jumps_link, #updatestatus, 
        .img_snap {
            display: none !important;
        }

        .gm-style-mtc,              /* Map/Satellite Toggle */
        .gm-style-mtc-bbw,          /* Map/Satellite Toggle Container */
        .gm-bundled-control,        /* Zoom & Pegman Cluster */
        .gm-fullscreen-control,     /* Fullscreen Button */
        .gm-svpc,                   /* Street View Pegman Control */
        .gmp-internal-camera-control /* 3D Camera/Tilt controls */
        {
            display: none !important;
        }

        /* Keep Google Maps Copyright */
        .gm-style-cc {
            display: block !important; 
        }
        a[href*="google.com/maps"] img {
            display: block !important;
        }
        `
        });

        await this.page.evaluate(() => {
            // Force a resize event
            window.dispatchEvent(new Event('resize'));
        });
    }

    /**
     * Handle cookie consent banner if it appears.
     */
    #handleCookieConsent = async () => {
        try {
            const selector = '.ark-cookiebar-buttons button';

            await this.page.waitForSelector(selector, { visible: true, timeout: 2000 });

            const clicked = await this.page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('.ark-cookiebar-buttons button'));
                const acceptBtn = buttons.find(b => {
                    return b.textContent.trim() === 'Accept' && b.offsetParent !== null;
                });

                if (acceptBtn) {
                    acceptBtn.click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                console.log('Cookie banner accepted.');
            }
        } catch (error) {
            // Do nothing as the cookie banner did not appear or is accepted already
        }
    }

    /**
     * Start the browser instance.
     * @param {Boolean} headless 
     */
    async startBrowser(headless = false) {
        puppeteer.use(StealthPlugin())
        this.browser = await puppeteer.launch({
            headless: process.env.DEBUG == 'true' ? false : headless,
            userDataDir: path.join(__dirname, '..', 'puppeteer-data'),
        });
        this.page = await this.browser.newPage();
        await this.page.setViewport({
            width: parseInt(this.screenshot_w, 10) || 1920,
            height: parseInt(this.screenshot_h, 10) || 1080,
        });
    }

    /**
     * Close the browser instance.
     * @returns {Promise<void>}
     */
    closeBrowser = async () => {
        await this.browser.close();
    }

    /**
     * Guide the user through the login process, return true if logged in.
     * @returns {Promise<Boolean>}
     */
    login = async () => {
        let loggedIn = false;
        await this.page.goto('https://intel.ingress.com', { waitUntil: 'networkidle0' });

        const searchString = "Welcome to Ingress.";

        if (await this.#searchStringOnPage(searchString)) {
            await getuserInput('Press enter after you have logged in.');
        } else {
            console.log('Already logged in.');
            loggedIn = true;

        }

        await this.#handleCookieConsent();

        return loggedIn;
    }

    refreshAndTakeScreenshot = async (intervalSeconds, numberOfScreenshots) => {
        return new Promise(async (resolve, reject) => {
            this.stopRequested = false;
            let counter = 0;

            // Go to our URL
            await this.page.goto(this.url, { waitUntil: 'networkidle0' });

            this.intervalId = setInterval(async () => {
                try {
                    if (this.blocking) {
                        console.warn('Skipping screenshot, still processing previous one. (Your intervalSeconds may be too low)');
                        return; // Skip this iteration if blocking is true
                    }
                    if (this.stopRequested) {
                        clearInterval(this.intervalId);
                        this.blocking = false;
                        resolve();
                        return;
                    }
                    this.blocking = true;
                    await this.page.setViewport({ width: this.screenshot_w || 1080, height: this.screenshot_h || 1920 });
                    await this.page.reload({ waitUntil: 'networkidle0' });

                    await this.#adjustPage(); // Hide elements that we don't want to see in the screenshot

                    const element = await this.page.$('#map_canvas');
                    if (!element) {
                        throw new Error('Element not found for screenshot.');
                    }
                    // Generate ISO timestamp
                    const timestamp = new Date().toISOString().replace(/:/g, '-');

                    const screenshotPath = path.join(this.screenshotPath, `${timestamp}.png`);
                    const imageBuffer = await element.screenshot({
                        type: 'png',
                        clip: {
                            x: 0,
                            y: 0,
                            width: this.screenshot_w || 1080,
                            height: this.screenshot_h || 1920,
                        },
                        omitBackground: true,
                    });
                    fs.writeFileSync(screenshotPath, imageBuffer);
                    console.log(`Screenshot taken: ${screenshotPath} - (${counter + 1}/${numberOfScreenshots === 0 ? '∞' : numberOfScreenshots})`);

                    counter++;
                    this.blocking = false;
                    if (numberOfScreenshots !== 0 && counter >= numberOfScreenshots) {
                        clearInterval(this.intervalId);
                        resolve();
                    }
                } catch (error) {
                    console.error('An error occurred while taking a screenshot:', error);
                    clearInterval(this.intervalId);
                    reject(error);
                }
            }, intervalSeconds * 1000);
        });
    }

    stop = () => {
        console.log("Stop command received. Finishing current cycle before exiting...");
        this.stopRequested = true;
    }

    run = async () => {
        try {
            await this.startBrowser();
            const isLoggedIn = await this.login();
            await this.closeBrowser();

            await this.startBrowser(isLoggedIn);

            await this.refreshAndTakeScreenshot(this.intervalSeconds, this.numberOfScreenshots);

        } catch (error) {
            console.error('An error occurred:', error);
        } finally {
            await this.closeBrowser();
            console.log('Done!');
        }
    }

}

module.exports = IngressIceReplica;