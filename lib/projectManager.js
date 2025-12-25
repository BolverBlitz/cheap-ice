const fs = require('node:fs');
const path = require('node:path');
const { getuserInput } = require('./utils.js');

const fileName = "project.json";

class ProjectManager {
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.fullPath = path.join(this.projectDir, fileName);
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
            console.log(`5. Number of Screenshots: ${config.numberOfScreenshots === 0 ? "Until Stopped" : config.numberOfScreenshots}`);
            console.log("------------------------");
            console.log("Type 'yes' to run, 'no' to reset all, the number (1-5) to edit that setting, or 'skip' to go to video generation.");

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
                config.numberOfScreenshots = await this.#determineScreenshotMode(config.screenshotInterval);
                break;
            default:
                console.log("Invalid selection. Please type 'yes', 'no', or 1-5.");
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

        const parsedInterval = parseInt(interval);

        // Calculate screenshot count using the helper
        const numScreenshots = await this.#determineScreenshotMode(parsedInterval);

        const settings = {
            screenshotWidth: parseInt(width),
            screenshotHeight: parseInt(height),
            screenshotInterval: parsedInterval,
            intelUrl: intelUrl,
            numberOfScreenshots: numScreenshots
        };

        this.#saveSettings(settings);
        console.log("Settings saved.");
        
        return settings;
    }

    /**
     * Helper to Ask user for Mode (Count, Time, Infinite) and return the integer number of screenshots.
     */
    async #determineScreenshotMode(intervalSeconds) {
        console.log("\nSelect Screenshot Mode:");
        console.log("1. Specific Number of Screenshots");
        console.log("2. Constant Time (Run for specific duration)");
        console.log("3. Run until stopped");
        
        const mode = await getuserInput("Enter mode (1-3): ");
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
                console.log("Invalid duration. Defaulting to 0 (Until Stopped).");
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
            console.log("Set to run until stopped (0).");
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

    #parseDurationToSeconds(input) {
        if (!input) return 0;
        const parts = input.split(':').map(p => parseInt(p.trim()));
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