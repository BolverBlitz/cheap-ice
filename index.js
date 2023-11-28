const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const readline = require('node:readline');
const fs = require('node:fs').promises;
const path = require('node:path');

class IngressIceReplica {
    constructor(username, password, url, screenshotPath, intervalSeconds = 10, numberOfScreenshots = 60, screenshot_w = 720, screenshot_h = 480) {
        this.username = username;
        this.password = password;
        this.url = url;
        this.screenshotPath = screenshotPath;

        // Set Config
        this.screenshot_w = screenshot_w;
        this.screenshot_h = screenshot_h;
        this.intervalSeconds = intervalSeconds;
        this.numberOfScreenshots = numberOfScreenshots;

        // Make sure we can use google login and cookies
        puppeteer.use(StealthPlugin())
    }

    #userInput = (query) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        return new Promise(resolve => rl.question(query, ans => {
            rl.close();
            resolve(ans);
        }))
    }

    #searchStringOnPage = async (searchString) => {
        const pageContent = await this.page.content();
        return pageContent.includes(searchString);
    }

    #hideElements = async () => {
        await this.page.evaluate(() => {
            const selectors = [
                '#comm',
                '#player_stats',
                '#game_stats',
                '#geotools',
                '#header',
                '#snapcontrol',
                '.img_snap',
                '#display_msg_text',
                '.gm-control-active.gm-fullscreen-control'
            ];

            selectors.forEach(selector => {
                const element = document.querySelector(selector);
                if (element) {
                    element.style.display = 'none';
                }
            });

            // Hide all elements with the class 'gmnoprint'
            const gmnoprintElements = document.querySelectorAll('.gmnoprint');
            gmnoprintElements.forEach(element => {
                element.style.display = 'none';
            });
        });
    }

    async startBrowser() {
        puppeteer.use(StealthPlugin())
        this.browser = await puppeteer.launch({
            headless: false,
            userDataDir: path.join(__dirname, 'puppeteer-data'),
        });
        this.page = await this.browser.newPage();
        await this.page.setViewport({
            width: parseInt(this.screenshot_w, 10) || 1920,
            height: parseInt(this.screenshot_h, 10) || 1080,
        });
    }

    login = async () => {
        await this.page.goto('https://intel.ingress.com', { waitUntil: 'networkidle2' });

        const searchString = "Welcome to Ingress.";

        if (await this.#searchStringOnPage(searchString)) {
            await this.#userInput('Press enter after you have logged in.');
        } else {
            console.log('Already logged in.');

        }

        // Deal with cookie banner
        try {
            await this.page.waitForXPath("//button[contains(text(), 'Accept')]", { timeout: 5000 }); // Adjust timeout as needed
            const buttons = await this.page.$x("//button[contains(text(), 'Accept')]");
            if (buttons.length > 0) {
                await buttons[0].click();
                console.log('Cookie banner accepted.');
            } else {
                console.log('Accept button not found.');
            }
        } catch (error) {
            console.log('No cookie banner found.');
        }

        return;
    }

    refreshAndTakeScreenshot = async (intervalSeconds, numberOfScreenshots) => {
        return new Promise(async (resolve, reject) => {
            let counter = 0;

            // Go to our URL
            await this.page.goto(this.url, { waitUntil: 'networkidle2' });

            const intervalId = setInterval(async () => {
                try {
                    await this.page.reload({ waitUntil: 'networkidle2' });
                    await this.#hideElements(); // Hide elements that we don't want to see in the screenshot

                    const element = await this.page.$('#map_canvas');
                    if (!element) {
                        throw new Error('Element not found for screenshot.');
                    }

                    const screenshotPath = `${this.screenshotPath}-${counter}.png`;
                    const imageBuffer = await element.screenshot({
                        type: 'png',
                        clip: {
                            x: 0,
                            y: 0,
                            width: parseInt(this.screenshot_w, 10) || 1080,
                            height: parseInt(this.screenshot_h, 10) || 1920,
                        },
                        omitBackground: true,
                    });
                    await fs.writeFile(screenshotPath, imageBuffer);
                    console.log(`Screenshot taken: ${screenshotPath}`);

                    counter++;
                    if (counter >= numberOfScreenshots) {
                        clearInterval(intervalId);
                        resolve();
                    }
                } catch (error) {
                    console.error('An error occurred while taking a screenshot:', error);
                    clearInterval(intervalId);
                    reject(error);
                }
            }, intervalSeconds * 1000);
        });
    }

    closeBrowser = async () => {
        await this.browser.close();
    }

    run = async () => {
        try {
            await this.startBrowser();
            await this.login();

            await this.refreshAndTakeScreenshot(this.intervalSeconds, this.numberOfScreenshots);

        } catch (error) {
            console.error('An error occurred:', error);
        } finally {
            await this.closeBrowser();
            console.log('Done!');
        }
    }

}

// Usage
const ingressBot = new IngressIceReplica('your_username', 'your_password', 'https://intel.ingress.com/', './screenshots');
(async () => {
    await ingressBot.run();
})();
