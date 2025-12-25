require('dotenv').config({ quiet: true });
const ProjectManager = require('./lib/projectManager.js');
const IngressIceReplica = require('./lib/ice.js');

const pm = new ProjectManager(process.cwd());

(async () => {
    const config = await pm.getConfiguration();

    const screenshotDir = process.env.SCREENSHOT_DIR || './screenshots';

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

    console.log("All tasks completed.");

})();
