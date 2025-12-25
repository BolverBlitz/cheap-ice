require('dotenv').config({ quiet: true });
const ProjectManager = require('./lib/projectManager.js');
const { IngressIceReplica } = require('./lib/ice.js');
const VideoGenerator = require('./lib/ffmpeg.js');

const screenshotDir = process.env.SCREENSHOT_DIR || './screenshots';

const pm = new ProjectManager(process.cwd());
const ffmpeg = new VideoGenerator(parseInt(process.env.TARGET_FPS) || 30, pm.projectDir, screenshotDir);

(async () => {
    if (process.env.DEBUG == 'true') console.log("Running in DEBUG mode.");
    const { config, command } = await pm.getConfiguration();

    if (command !== 'skip') {
        const iceBot = new IngressIceReplica(
            config.intelUrl,
            screenshotDir,
            config.screenshotInterval,
            config.numberOfScreenshots,
            config.screenshotWidth,
            config.screenshotHeight
        );

        pm.listenForStopCommand(() => {
            iceBot.stop();
        });

        await iceBot.run();
    }

    const ffmpegAvailable = await ffmpeg.checkFFmpeg();
    if (!ffmpegAvailable) {
        console.error("FFmpeg is not available. Skipping video generation.");
        process.exit(1);
    }

    await ffmpeg.generateVideo(config.screenshotInterval);
})();
