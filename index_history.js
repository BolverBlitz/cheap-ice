require('dotenv').config({ quiet: true });
const ProjectManager = require('./lib/projectManager.js');
const { IngressHistorySimulator } = require('./lib/ice.js');
const VideoGenerator = require('./lib/ffmpeg.js');

const screenshotDir = process.env.SCREENSHOT_DIR || './screenshots';

const pm = new ProjectManager(process.cwd(), 'history');
const ffmpeg = new VideoGenerator(parseInt(process.env.TARGET_FPS) || 30, pm.projectDir, screenshotDir);

(async () => {
    if (process.env.DEBUG == 'true') console.log("Running in DEBUG mode.");
    const { config, command } = await pm.getConfiguration();

    if(config.numberOfScreenshots === 0) {
        console.error("For history simulation, 'Run until stopped' is not supported. Please specify a finite number of screenshots or duration.");
        process.exit(1);
    }

    const iceBot = new IngressHistorySimulator(
        config.intelUrl,
        screenshotDir,
    );

    if (command !== 'skip') {
        // Current time minus config.numberOfScreenshots * config.screenshotInterval
        const getDataUntilTimestamp = Date.now() - (config.numberOfScreenshots * config.screenshotInterval * 1000);
        await iceBot.fetchHistoryUntil(getDataUntilTimestamp);
    }

    await iceBot.simulateHistory(
        screenshotDir,
        config.screenshotInterval,
        config.screenshotWidth,
        config.screenshotHeight
    );

    const ffmpegAvailable = await ffmpeg.checkFFmpeg();
    if (!ffmpegAvailable) {
        console.error("FFmpeg is not available. Skipping video generation.");
        process.exit(1);
    }

    await ffmpeg.generateVideo(config.screenshotInterval);
})();
