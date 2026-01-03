const fs = require('node:fs');
const path = require('node:path');
const { getuserInput } = require('./utils.js');

const fileName = "project.json";

class ProjectManager {
    constructor(projectDir, mode = 'default') {
        this.projectDir = projectDir;
        this.fullPath = path.join(this.projectDir, fileName);
        this.mode = mode;
    }

    /**
     * Main method to retrieve configuration.
     * Loops to allow editing specific settings until the user confirms.
     */
    async getConfiguration() {
        let config = this.#loadSettings();

        // If no config exists, go straight to creation
        if (!config) {
            return await this.#createNewSettings();
        }

        // Loop to allow modifications
        while (true) {
            console.log("\n--- Current Settings ---");
            console.log(`1. Width: ${config.screenshotWidth}`);
            console.log(`2. Height: ${config.screenshotHeight}`);
            console.log(`3. Interval: ${config.screenshotInterval} Seconds`);
            console.log(`4. Intel URL: ${config.intelUrl}`);
            
            // Logic to display what "0" means based on mode
            let countDisplay = config.numberOfScreenshots;
            if (config.numberOfScreenshots === 0) {
                if (this.mode === 'history') countDisplay = "Every Action (0)";
                else countDisplay = "Until Stopped (0)";
            }
            console.log(`5. Number of Screenshots: ${countDisplay}`);

            this.mode === 'history' ? console.log(`6. Get Intel Context for time: ${config.historyContextWindow} days`) : null;
            
            // Display readable date if timestamp exists
            let readableDate = "Not Set";
            if (config.screenshotTimestamp) {
                readableDate = new Date(config.screenshotTimestamp).toUTCString();
            }
            this.mode === 'history' ? console.log(`7. Screenshot Start Time (UTC): ${readableDate} (${config.screenshotTimestamp})`) : null;
            
            console.log("------------------------");
            console.log("Type 'yes' to run, 'no' to reset all, the number (1-7) to edit that setting, or 'skip' to go to video generation.");

            const input = await getuserInput("Selection: ");
            const choice = input.trim().toLowerCase();

            if (choice.startsWith('y')) {
                return { config: config, command: 'run' };
            }
            else if (choice.startsWith('n')) {
                return { config: await this.#createNewSettings(), command: 'run' };
            }
            else if (choice.startsWith('s')) {
                return { config: config, command: 'skip' };
            }
            else {
                await this.#editSingleSetting(config, choice);
                this.#saveSettings(config);
            }
        }
    }

    /**
     * Handles editing a specific field based on number input
     */
    async #editSingleSetting(config, choice) {
        switch (choice) {
            case '1':
                const w = await getuserInput("Enter new Width: ");
                config.screenshotWidth = parseInt(w);
                break;
            case '2':
                const h = await getuserInput("Enter new Height: ");
                config.screenshotHeight = parseInt(h);
                break;
            case '3':
                const i = await getuserInput("Enter new Interval (Seconds): ");
                config.screenshotInterval = parseInt(i);
                break;
            case '4':
                const url = await getuserInput("Enter new Intel URL: ");
                config.intelUrl = url;
                break;
            case '5':
                // Update Number of Screenshots
                config.numberOfScreenshots = await this.#determineScreenshotMode(config.screenshotInterval);
                
                // Update boolean flag based on result + mode
                if (this.mode === 'history' && config.numberOfScreenshots === 0) {
                    config.screenshotPerAction = true;
                } else {
                    config.screenshotPerAction = false;
                }
                break;
            case '6':
                if(this.mode === 'history') {
                    const days = await getuserInput("Enter number of days for Intel Context: ");
                    config.historyContextWindow = parseInt(days);
                } else {
                    console.log("Invalid selection.");
                }
                break;
            case '7':
                if (this.mode === 'history') {
                    const tsStr = await getuserInput("Enter Start Time (DD.MM.YYYY-HH:MM:SS): ");
                    const ts = this.#parseTimestampInput(tsStr);
                    if (ts) {
                        config.screenshotTimestamp = ts;
                        console.log("Timestamp updated.");
                    } else {
                        console.log("Invalid Date Format. Please use DD.MM.YYYY-HH:MM:SS");
                    }
                } else {
                    console.log("Invalid selection.");
                }
                break;
            default:
                console.log("Invalid selection.");
                break;
        }
    }

    /**
     * Wizard to create completely new settings
     */
    async #createNewSettings() {
        console.log("\n--- Creating New Configuration ---");

        const width = await getuserInput("Enter Screenshot Width: ");
        const height = await getuserInput("Enter Screenshot Height: ");
        const interval = await getuserInput("Enter Screenshot Interval (Seconds): ");
        const intelUrl = await getuserInput("Enter Intel URL: ");
        
        let historyContextWindow = 0;
        let screenshotTimestamp = 0;

        if (this.mode === 'history') {
            historyContextWindow = await getuserInput("Enter number of days for Intel Context: ");
            
            let validTime = false;
            while (!validTime) {
                const tsInput = await getuserInput("Enter Screenshot Start Time (DD.MM.YYYY-HH:MM:SS): ");
                screenshotTimestamp = this.#parseTimestampInput(tsInput);
                if (screenshotTimestamp) {
                    validTime = true;
                } else {
                    console.log("Invalid format. Please try again (e.g., 01.01.2023-12:00:00).");
                }
            }
        }

        const parsedInterval = parseInt(interval);
        const historyContextWindowSeconds = this.#parseDurationToSeconds(historyContextWindow);

        // Calculate screenshot count using the helper
        const numScreenshots = await this.#determineScreenshotMode(parsedInterval);

        // Determine Per-Action mode automatically based on result
        const isPerAction = (this.mode === 'history' && numScreenshots === 0);

        const settings = {
            screenshotWidth: parseInt(width),
            screenshotHeight: parseInt(height),
            screenshotInterval: parsedInterval,
            screenshotPerAction: isPerAction,
            intelUrl: intelUrl,
            numberOfScreenshots: numScreenshots,
            historyContextWindow: historyContextWindowSeconds ? parseInt(historyContextWindowSeconds) : 0,
            screenshotTimestamp: screenshotTimestamp
        };

        this.#saveSettings(settings);
        console.log("Settings saved.");

        return settings;
    }

    /**
     * Helper to Ask user for Mode (Count, Time, Infinite/Action)
     */
    async #determineScreenshotMode(intervalSeconds) {
        console.log("\nSelect Screenshot Mode:");
        console.log("1. Specific Number of Screenshots");
        console.log("2. Constant Time (Run for specific duration)");
        console.log("For example, for 2 hours at 1s interval at 60 FPS you would calculate (2(h)*60(min)*60(sec))/60(fps) = 120 Seconds - So 02:00");
        
        // Context-aware Option 3
        if(this.mode === 'history') {
            console.log("3. Capture Every Single Action (0)");
        } else {
            console.log("3. Run until stopped (0)");
        }

        const mode = await getuserInput("Enter mode: ");
        let result = 0;

        if (mode === '1') {
            const num = await getuserInput("Enter total number of screenshots: ");
            result = parseInt(num);
        }
        else if (mode === '2') {
            console.log("Enter duration in format DD:HH:MM or HH:MM");
            console.log("Examples: '1:00:00' (1 day), '15:00' (15 hours), '45' (45 mins)");

            const durationStr = await getuserInput("Enter Duration: ");
            const durationSec = this.#parseDurationToSeconds(durationStr);

            if (durationSec <= 0 || isNaN(durationSec)) {
                console.log("Invalid duration. Defaulting to 0.");
                result = 0;
            } else {
                // Calculate total frames: (Duration Sec) / Interval Sec
                const totalFrames = Math.floor(durationSec / intervalSeconds);
                console.log(`Duration parsed: ${durationSec} seconds.`);
                console.log(`Calculated ${totalFrames} screenshots for this duration.`);
                result = totalFrames;
            }
        }
        else {
            if (this.mode === 'history') {
                console.log("Set to Capture Every Action (0).");
            } else {
                console.log("Set to run until stopped (0).");
            }
            result = 0;
        }

        return result;
    }

    // --- UTILS ---

    #loadSettings() {
        if (!fs.existsSync(this.fullPath)) return null;
        try {
            return JSON.parse(fs.readFileSync(this.fullPath, 'utf8'));
        } catch (err) { return null; }
    }

    #saveSettings(settings) {
        if (!fs.existsSync(this.projectDir)) fs.mkdirSync(this.projectDir, { recursive: true });
        fs.writeFileSync(this.fullPath, JSON.stringify(settings, null, 4));
    }

    /**
     * Parses DD.MM.YYYY-HH:MM:SS into a UTC Timestamp (milliseconds)
     */
    #parseTimestampInput(input) {
        try {
            if (!input || !input.includes('-')) return null;

            const [datePart, timePart] = input.split('-'); // Split Date and Time
            const [day, month, year] = datePart.split('.'); // Split Day, Month, Year
            const [hour, minute, second] = timePart.split(':'); // Split Hour, Minute, Second

            // Validate all parts exist
            if (!day || !month || !year || !hour || !minute || !second) return null;
            const dateObj = new Date(Date.UTC(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
            ));

            return dateObj.getTime();
        } catch (e) {
            return null;
        }
    }

    #parseDurationToSeconds(input) {
        if (!input) return 0;
        const parts = input.toString().split(':').map(p => parseInt(p.trim()));
        let seconds = 0;

        if (parts.length === 3) {
            seconds += parts[0] * 86400; // DD
            seconds += parts[1] * 3600;  // HH
            seconds += parts[2] * 60;    // MM
        } else if (parts.length === 2) {
            seconds += parts[0] * 3600;  // HH
            seconds += parts[1] * 60;    // MM
        } else if (parts.length === 1) {
            seconds += parts[0] * 60;    // MM
        }
        return seconds;
    }

    listenForStopCommand(onStopCallback) {
        console.log("Type 'stop' and press ENTER to end the process...");
        const stdin = process.stdin;
        if (stdin.isPaused()) stdin.resume();
        stdin.setEncoding('utf8');

        const listener = (data) => {
            if (data.toString().trim().toLowerCase() === 'stop') {
                process.stdout.write("Stopping...\n");
                stdin.removeListener('data', listener);
                stdin.pause();
                if (typeof onStopCallback === 'function') onStopCallback();
            }
        };
        stdin.on('data', listener);
    }
}

module.exports = ProjectManager;