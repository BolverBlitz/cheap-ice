const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const IngressStateSimulator = require('./ingressSimulator.js');

const { getuserInput, parseE6 } = require('./utils.js');

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
            return true;
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
                    const timestamp = new Date().getTime();

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

/**
 * Extended Class: Adds History, Storage & Simulation
 */
class IngressHistorySimulator extends IngressIceReplica {
    constructor(url, storagePath, dbName = 'ingress_history.db') {
        super(url, storagePath);
        this.dbPath = path.join(storagePath, dbName);
        this.db = null;
        this.#initDB();
    }

    #initDB() {
        this.db = new sqlite3.Database(this.dbPath);
        this.db.serialize(() => {
            this.db.run(`CREATE TABLE IF NOT EXISTS portals (id TEXT PRIMARY KEY, lat REAL, lng REAL, name TEXT, address TEXT, team TEXT)`);
            this.db.run(`CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, timestamp INTEGER, type TEXT, action TEXT, portal_id TEXT, target_portal_id TEXT, FOREIGN KEY(portal_id) REFERENCES portals(id))`);
        });
    }

    /**
     * Parse raw plext data and normalize it
     */
    #parseIngressData(rawList) {
        if (!Array.isArray(rawList)) return [];

        return rawList.map(item => {
            const id = item[0];
            const timestamp = item[1];
            const plext = (item[2] && item[2].plext) ? item[2].plext : {};
            const markup = plext.markup || [];
            const text = plext.text || "";

            // IGNORE RULES 
            if (text.includes('is under attack by') ||
                text.includes('Your Kinetic Capsule now ready') ||
                text.includes('Drone returned')) {
                return null;
            }

            // EXTRACT TEAM FROM MARKUP
            // Find the player tag to see who performed the action
            let teamSuffix = null; // 'RES' or 'ENL'
            const playerTag = markup.find(m => m[0] === 'PLAYER');
            if (playerTag && playerTag[1].team) {
                if (playerTag[1].team === 'RESISTANCE') teamSuffix = 'RES';
                else if (playerTag[1].team === 'ENLIGHTENED') teamSuffix = 'ENL';
            }

            // Helper to append team to action (e.g., 'captured' -> 'captured_ENL')
            const tagAction = (baseAction) => teamSuffix ? `${baseAction}_${teamSuffix}` : baseAction;

            let parsed = {
                id,
                action: 'unknown',
                type: 'unknown',
                timestamp,
                cords1: null,
                cords2: null
            };

            // ETERMINE ACTION & TYPE

            if (text.includes('destroyed')) {
                parsed.action = 'destroy'; // Destroy makes things neutral, so team matters less here
                if (text.includes('Resonator')) parsed.type = 'reso';
                else if (text.includes('Link')) parsed.type = 'link';
                else if (text.includes('Control Field')) parsed.type = 'field';
                else if (text.includes('Mod')) parsed.type = 'mod';
            }
            else if (text.includes('neutralized by')) {
                parsed.action = 'destroy';
                parsed.type = 'portal';
            }
            else if (text.includes('won a CAT-')) {
                parsed.type = 'battlebeacon';
                const factionTag = markup.find(m => m[0] === 'FACTION');
                const winningTeam = factionTag ? factionTag[1].team : 'UNKNOWN';
                parsed.action = winningTeam === 'RESISTANCE' ? 'won_RES' : 'won_ENL';
            }
            else if (text.includes('deployed')) {
                parsed.action = tagAction('deploy'); // Becomes 'deploy_RES' or 'deploy_ENL'
                parsed.type = 'reso';
            }
            else if (text.includes('linked')) {
                parsed.action = tagAction('link');   // Becomes 'link_RES' or 'link_ENL'
                parsed.type = 'link';
            }
            else if (text.includes('created a Control Field')) {
                parsed.action = tagAction('field');  // Becomes 'field_RES' or 'field_ENL'
                parsed.type = 'field';
            }
            else if (text.includes('captured')) {
                parsed.action = tagAction('captured'); // Becomes 'captured_RES' or 'captured_ENL'
                parsed.type = 'portal';
            }

            // EXTRACT PORTALS
            if (markup.length > 0) {
                const portals = markup
                    .filter(m => Array.isArray(m) && m[0] === 'PORTAL')
                    .map(m => m[1]);

                const formatPortal = (p) => ({
                    id: p.guid,
                    lat: parseE6(p.latE6),
                    lng: parseE6(p.lngE6),
                    name: p.name,
                    address: p.address,
                    team: p.team // NOTE: This is the CURRENT team, not historical. Rely on action parsing.
                });

                if (portals[0]) parsed.cords1 = formatPortal(portals[0]);
                if (portals[1]) parsed.cords2 = formatPortal(portals[1]);
            }

            return parsed;
        }).filter(item => item !== null);
    }

    #saveToDB(parsedData) {
        if (!parsedData.length) return;
        const stmtPortal = this.db.prepare(`INSERT OR IGNORE INTO portals (id, lat, lng, name, address, team) VALUES (?, ?, ?, ?, ?, ?)`);
        const stmtAction = this.db.prepare(`INSERT OR IGNORE INTO actions (id, timestamp, type, action, portal_id, target_portal_id) VALUES (?, ?, ?, ?, ?, ?)`);
        this.db.serialize(() => {
            this.db.run("BEGIN TRANSACTION");
            parsedData.forEach(d => {
                if (d.cords1 && d.cords1.lat) stmtPortal.run(d.cords1.name, d.cords1.lat, d.cords1.lng, d.cords1.name, d.cords1.address, d.cords1.team);
                if (d.cords2 && d.cords2.lat) stmtPortal.run(d.cords2.name, d.cords2.lat, d.cords2.lng, d.cords2.name, d.cords2.address, d.cords2.team);
                const p1 = d.cords1 ? d.cords1.name : null;
                const p2 = d.cords2 ? d.cords2.name : null;
                stmtAction.run(d.id, d.timestamp, d.type, d.action, p1, p2);
            });
            this.db.run("COMMIT");
        });
        console.log(`Saved ${parsedData.length} events to database.`);
    }

    /**
     * Fetch history backwards until a specific timestamp
     * @param {number} untilTimestampMs - The timestamp (ms) to stop fetching at (exclusive)
     * @returns {Promise<void>} Resolves when target timestamp is reached or no more data exists
     */
    async fetchHistoryUntil(untilTimestampMs) {
        if (!this.browser) await this.startBrowser();

        console.log(`Starting History Fetch. Target: ${new Date(untilTimestampMs).toISOString()}`);

        const [initialRequest] = await Promise.all([
            this.page.waitForRequest(req => req.url().includes('/r/getPlexts') && req.method() === 'POST'),
            this.page.goto(this.url, { waitUntil: 'domcontentloaded' })
        ]);

        let basePayload = null;
        if (initialRequest && initialRequest.postData()) {
            basePayload = JSON.parse(initialRequest.postData());
        }

        if (!basePayload) throw new Error("Failed to capture base payload.");

        let currentMaxTimestamp = new Date().getTime();

        while (true) {
            const payload = {
                ...basePayload,
                "minTimestampMs": -1,
                "maxTimestampMs": currentMaxTimestamp,
                "plextContinuationGuid": ""
            };

            // Execute Fetch in Browser
            const responseData = await this.page.evaluate(async (p) => {
                const CSRF_TOKEN = document.cookie.match(/csrftoken=([\w-]+)/)?.[1] || '';
                try {
                    const res = await fetch('/r/getPlexts', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json; charset=UTF-8',
                            'X-CSRFToken': CSRF_TOKEN
                        },
                        body: JSON.stringify(p)
                    });
                    return await res.json();
                } catch (e) {
                    return null;
                }
            }, payload);

            if (!responseData || !responseData.result || responseData.result.length === 0) {
                console.log("No more data received from Intel.");
                return;
            }

            const rawItems = responseData.result;

            // Process Data
            const parsed = this.#parseIngressData(rawItems);
            this.#saveToDB(parsed);

            // The items are sorted NEWEST -> OLDEST
            const oldestItem = rawItems[rawItems.length - 1];
            const oldestTimestamp = oldestItem[1];

            console.log(`Fetched ${rawItems.length} items. Oldest in batch: ${new Date(oldestTimestamp).toISOString()}`);

            if (oldestTimestamp < untilTimestampMs) {
                console.log(`Target timestamp reached (${new Date(untilTimestampMs).toISOString()}). Stopping.`);
                return;
            }

            currentMaxTimestamp = oldestTimestamp - 1;

            await new Promise(r => setTimeout(r, 1500));
        }
    }

    /**
     * Helper: Promisified DB Query
     */
    async #queryDB(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    /**
    * Set times for simulation
    * @param {Number} historyContextMs
    * @param {Number} screenshotDurationMs
    */
    async setSimulationStart(historyContextMs, screenshotDurationMs) {
        this.historyContextTime = Date.now() - historyContextMs;
        this.screenshotDurationTime = Date.now() - screenshotDurationMs;
        console.log(`History Context Time set to: ${new Date(this.historyContextTime).toISOString()}`);
        console.log(`Simulation Start Time set to: ${new Date(this.screenshotDurationTime).toISOString()}`);
    }

    /**
     * SIMULATION METHOD (UPDATED)
     * @param {String} outputDir 
     * @param {Number} stepSeconds 
     * @param {Number} screenshotTimestamp 
     * @param {Number} screenshot_w 
     * @param {Number} screenshot_h 
     * @param {Boolean} screenshotPerAction
     */
    async simulateHistory(outputDir, stepSeconds = 1, screenshotTimestamp = 0, screenshot_w = 1920, screenshot_h = 1080, screenshotPerAction = false) {
        if (!this.browser) await this.startBrowser();
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const portals = await this.#queryDB("SELECT * FROM portals");
        const actions = await this.#queryDB("SELECT * FROM actions ORDER BY timestamp ASC");

        if (portals.length === 0) return console.error("No data.");
        if (actions.length === 0) return console.error("No actions found.");

        // Initialize Logic Engine
        const simulator = new IngressStateSimulator(portals);

        // Calculate Map Center & Zoom (URL Priority) ---
        let mapLat, mapLng, mapZoom;

        if (this.url) {
            try {
                const urlObj = new URL(this.url);
                const ll = urlObj.searchParams.get('ll'); // Extract "lat,lng"
                const z = urlObj.searchParams.get('z');   // Extract zoom

                if (ll) {
                    const [lat, lng] = ll.split(',').map(Number);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        mapLat = lat;
                        mapLng = lng;
                    }
                }
                if (z) mapZoom = Number(z);
            } catch (e) {
                console.warn("Could not parse this.url, falling back to auto-center.");
            }
        }

        // Fallback: If URL didn't provide coords, average the portals
        if (mapLat === undefined || mapLng === undefined) {
            mapLat = portals.reduce((sum, p) => sum + p.lat, 0) / portals.length;
            mapLng = portals.reduce((sum, p) => sum + p.lng, 0) / portals.length;
        }

        // Fallback: If URL didn't provide zoom, use class property or default
        const finalZoom = mapZoom || 13;
        // -------------------------------------------------------

        // Prepare Browser HTML
        const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/openlayers/dist/ol.css">
        <style>
            body, html, #map { margin: 0; width: 100%; height: 100%; background: #0e0e0e; overflow: hidden; }
            #comm, #header, #game_stats, .gmnoprint { display: none !important; }
            #timer { 
                position: absolute; top: 20px; right: 20px; 
                color: #0f0; font-family: monospace; font-size: 32px; 
                background: rgba(0,0,0,0.8); padding: 10px; z-index: 9999;
                border: 1px solid #0f0;
            }
        </style>
        <script src="https://cdn.jsdelivr.net/npm/openlayers/dist/ol.js"></script>
    </head>
    <body>
        <div id="timer">Loading...</div>
        <div id="map"></div>
        <script>
            const COLORS = { 'RES': '#0088FF', 'ENL': '#03DC03', 'NEUTRAL': '#444', 'MACHINA': '#F00' };
            const FILL_COLORS = { 'RES': 'rgba(0, 136, 255, 0.2)', 'ENL': 'rgba(3, 220, 3, 0.2)' };
            let map, vectorSource;

            window.initMap = (centerLat, centerLng) => {
                vectorSource = new ol.source.Vector();
                map = new ol.Map({
                    target: 'map',
                    layers: [
                        new ol.layer.Tile({ source: new ol.source.OSM({
                            url: 'https://cartodb-basemaps-{a-c}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png'
                        })}),
                        new ol.layer.Vector({ source: vectorSource })
                    ],
                    view: new ol.View({
                        center: ol.proj.fromLonLat([centerLng, centerLat]),
                        zoom: ${finalZoom}  /* CHANGED: Uses finalZoom variable */
                    })
                });
            };

            window.renderState = (state, timeStr) => {
                document.getElementById('timer').innerText = timeStr;
                vectorSource.clear();

                // Draw Fields
                state.fields.forEach(f => {
                    const p1 = state.portals.find(p => p.id === f.p1);
                    const p2 = state.portals.find(p => p.id === f.p2);
                    const p3 = state.portals.find(p => p.id === f.p3);
                    if(p1 && p2 && p3) {
                        const poly = new ol.Feature({
                            geometry: new ol.geom.Polygon([[
                                ol.proj.fromLonLat([p1.lng, p1.lat]),
                                ol.proj.fromLonLat([p2.lng, p2.lat]),
                                ol.proj.fromLonLat([p3.lng, p3.lat]),
                                ol.proj.fromLonLat([p1.lng, p1.lat])
                            ]])
                        });
                        poly.setStyle(new ol.style.Style({
                            fill: new ol.style.Fill({ color: FILL_COLORS[f.team] || 'rgba(100,100,100,0.1)' })
                        }));
                        vectorSource.addFeature(poly);
                    }
                });

                // Draw Links
                state.links.forEach(l => {
                    const p1 = state.portals.find(p => p.id === l.p1);
                    const p2 = state.portals.find(p => p.id === l.p2);
                    if(p1 && p2) {
                        const line = new ol.Feature({
                            geometry: new ol.geom.LineString([
                                ol.proj.fromLonLat([p1.lng, p1.lat]),
                                ol.proj.fromLonLat([p2.lng, p2.lat])
                            ])
                        });
                        const team = p1.team === 'NEUTRAL' ? 'RES' : p1.team; 
                        line.setStyle(new ol.style.Style({
                            stroke: new ol.style.Stroke({ color: COLORS[team] || '#fff', width: 2 })
                        }));
                        vectorSource.addFeature(line);
                    }
                });

                // Draw Portals
                state.portals.forEach(p => {
                    const point = new ol.Feature({
                        geometry: new ol.geom.Point(ol.proj.fromLonLat([p.lng, p.lat]))
                    });
                    point.setStyle(new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 5,
                            fill: new ol.style.Fill({ color: COLORS[p.team] || COLORS.NEUTRAL }),
                            stroke: new ol.style.Stroke({ color: '#fff', width: 1 })
                        })
                    }));
                    vectorSource.addFeature(point);
                });
            };
        </script>
    </body>
    </html>`;

        await this.page.setViewport({ width: screenshot_w || 1920, height: screenshot_h || 1080 });
        await this.page.setContent(htmlContent);

        // CHANGED: Pass mapLat/mapLng here instead of avgLat/avgLng
        await this.page.evaluate(({ lat, lng }) => window.initMap(lat, lng), { lat: mapLat, lng: mapLng });

        console.log("Waiting for map tiles to load...");
        try {
            await this.page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => { });
        } catch (e) { console.log("Network idle timeout (ignoring)"); }

        let screenshotCounter = 0;
        const captureFrame = async (time) => {
            const currentState = simulator.getCurrentState();
            const timeStr = new Date(time).toLocaleString();

            await this.page.evaluate(({ state, timeStr }) => {
                window.renderState(state, timeStr);
            }, { state: currentState, timeStr });

            const fileName = `${time}.png`;
            await this.page.screenshot({ path: path.join(outputDir, fileName), fullPage: true });

            screenshotCounter++;
            if (screenshotCounter % 50 === 0 || screenshotPerAction) {
                console.log(`[REC] Saved frame: ${timeStr}`);
            }
        };

        // --- TIMING SETUP ---
        const firstActionTime = actions[0].timestamp;
        const lastActionTime = actions[actions.length - 1].timestamp;

        const simulationStart = this.historyContextTime || firstActionTime;
        const recordingStart = screenshotTimestamp > 0 ? screenshotTimestamp : simulationStart;

        console.log(`Logic starts at: ${new Date(simulationStart).toLocaleString()}`);
        console.log(`Recording starts at: ${new Date(recordingStart).toLocaleString()}`);
        if (screenshotPerAction) console.log("MODE: PER-ACTION (StepSeconds ignored)");

        // --- SIMULATION LOOP ---

        if (screenshotPerAction) {
            for (const action of actions) {

                const shouldCapture = simulator.processAction(action);

                if (action.timestamp >= recordingStart) {
                    shouldCapture ? await captureFrame(action.timestamp) : null;
                } else if (action.timestamp >= simulationStart && action.timestamp % 60000 < 1000) {
                    process.stdout.write(`\r[SKIP] Fast-forwarding: ${new Date(action.timestamp).toLocaleTimeString()}`);
                }
            }

        } else {
            let actionIdx = 0;
            for (let time = simulationStart; time <= lastActionTime; time += stepSeconds * 1000) {

                while (actionIdx < actions.length && actions[actionIdx].timestamp <= time) {
                    simulator.processAction(actions[actionIdx]);
                    actionIdx++;
                }

                if (time >= recordingStart) {
                    await captureFrame(time);
                } else {
                    if (time % 60000 === 0) console.log(`[SKIP] Fast-forwarding logic: ${new Date(time).toLocaleTimeString()}`);
                }
            }
        }

        console.log(`\nSimulation complete.`);
    }
}

module.exports = { IngressIceReplica, IngressHistorySimulator };