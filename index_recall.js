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

    if (config.numberOfScreenshots === 0 && config.screenshotPerAction !== true) {
        console.error("For history simulation, 'Run until stopped' is not supported. Please specify a finite number of screenshots or duration.");
        process.exit(1);
    }

    const iceBot = new IngressHistorySimulator(
        config.intelUrl,
        screenshotDir,
    );

    // Current time minus config.numberOfScreenshots * config.screenshotInterval or historyContextWindow (in days) whatever is larger
    const screenshotsMs = config.numberOfScreenshots * config.screenshotInterval * 1000;
    const historyContextMs = (config.historyContextWindow || 0) * 24 * 60 * 60 * 1000;
    const totalLookback = Math.max(screenshotsMs, historyContextMs);
    const getDataUntilTimestamp = Date.now() - totalLookback;
    await iceBot.setSimulationStart(historyContextMs, screenshotsMs)

    if (command !== 'skip') {
        await iceBot.fetchHistoryUntil(getDataUntilTimestamp);
    }

    await iceBot.simulateHistory(
        screenshotDir,
        config.screenshotInterval,
        config.screenshotTimestamp,
        config.screenshotWidth,
        config.screenshotHeight,
        config.screenshotPerAction
    );

    const ffmpegAvailable = await ffmpeg.checkFFmpeg();
    if (!ffmpegAvailable) {
        console.error("FFmpeg is not available. Skipping video generation.");
        process.exit(1);
    }

    await ffmpeg.generateVideo(config.screenshotInterval);
})();
