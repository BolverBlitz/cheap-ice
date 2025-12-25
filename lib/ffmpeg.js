const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getuserInput } = require('./utils.js');

class VideoGenerator {
    constructor(target_fps, projectDir, screenshotDir) {
        this.target_fps = target_fps;
        this.projectDir = projectDir;
        this.screenshotDir = screenshotDir;
        this.outputPath = path.join(this.projectDir, 'output_timelapse.mp4');
    }

    /**
     * Checks if FFmpeg is installed and accessible.
     * @returns {Promise<boolean>} Resolves to true if FFmpeg is found, otherwise rejects with an error.
     */
    async checkFFmpeg() {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', ['-version']);
            ffmpeg.on('error', (err) => {
                reject(new Error("FFmpeg not found. Please install FFmpeg and ensure it's in your system PATH."));
            });
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve(true);
                } else {
                    reject(new Error("FFmpeg not found. Please install FFmpeg and ensure it's in your system PATH."));
                }
            });
        });
    }

    /**
     * Generates a video based on user input regarding speed factor or constant time.
     */
    async generateVideo(screenshotInterval) {
        console.log("\n--- Video Generation Wizard ---");

        const files = fs.readdirSync(this.screenshotDir)
            .filter(f => f.endsWith('.png'))
            .sort((a, b) => parseInt(a) - parseInt(b));

        const totalFrames = files.length;
        if (totalFrames === 0) {
            console.error("No screenshots found.");
            return;
        }

        console.log(`Found ${totalFrames} screenshots.`);

        console.log("\nChoose Generation Mode:");
        console.log("1. Speed Factor (e.g., 'Make it 10x faster than real life')");
        console.log("2. Constant Time (e.g., 'Fit everything into 60 seconds')");
        
        const mode = await getuserInput("Select Mode (1 or 2): ");

        let finalFPS = this.target_fps; // Default FPS

        if (mode === '1') {
            // --- SPEED FACTOR ---
            
            const factorStr = await getuserInput("Enter desired speed factor (e.g. 60 for 60x speed): ");
            const factor = parseFloat(factorStr);

            // FORMULA: SpeedFactor = screenshotInterval * FPS
            // Therefore: FPS = SpeedFactor / screenshotInterval
            const calculatedFPS = factor / screenshotInterval;

            console.log(`\n--- Calculation ---`);
            console.log(`To achieve ${factor}x speed with a ${screenshotInterval}s interval:`);
            console.log(`Required Framerate: ${calculatedFPS.toFixed(2)} FPS`);

            // --- WARNING LOGIC ---
            if (calculatedFPS > screenshotInterval) {
                console.warn(`\n⚠️  WARNING: HIGH FRAMERATE ⚠️`);
                console.warn(`You requested ${calculatedFPS.toFixed(2)} FPS.`);
                console.warn(`Not all Frames may be included in the final video.`);
            } 
            else if (calculatedFPS < screenshotInterval) {
                console.warn(`\n⚠️  WARNING: LOW FRAMERATE ⚠️`);
                console.warn(`You requested ${calculatedFPS.toFixed(2)} FPS.`);
                console.warn(`This will look like a slow slideshow, not a video.`);
            }

            finalFPS = calculatedFPS;

        } else if (mode === '2') {
            // --- CONSTANT TIME ---
            const targetDurationStr = await getuserInput("Enter target video duration (seconds): ");
            const targetDuration = parseFloat(targetDurationStr);
            
            // Calculate strictly based on frames available
            // FPS = TotalFrames / Duration
            const calculatedFPS = totalFrames / targetDuration;

            console.log(`\n--- Calculation ---`);
            console.log(`To fit ${totalFrames} frames into ${targetDuration} seconds:`);
            console.log(`Required Framerate: ${calculatedFPS.toFixed(2)} FPS`);

            if (calculatedFPS > screenshotInterval) {
                 console.warn(`\n⚠️  WARNING: Resulting video requires ${calculatedFPS.toFixed(0)} FPS to fit in that time.`);
            }

            finalFPS = calculatedFPS;
        }

        // Round to 2 decimals for FFmpeg CLI compatibility
        finalFPS = Math.round(finalFPS * 100) / 100;

        await this.#renderWithPipe(files, finalFPS);
    }

    /**
     * Pipes images directly into FFmpeg.
     */
    async #renderWithPipe(files, fps) {
        return new Promise((resolve, reject) => {
            console.log(`\nStarting Render @ ${fps} FPS...`);
            console.log(`Output: ${this.outputPath}`);

            const args = [
                '-y',
                '-f', 'image2pipe',
                '-vcodec', 'png',
                '-framerate', fps.toString(), // Input FPS
                '-i', '-',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-r', this.target_fps.toString(), // Output FPS
                this.outputPath
            ];

            console.log("Running FFmpeg with arguments:", args.join(' '));

            const ffmpeg = spawn('ffmpeg', args);

            ffmpeg.stderr.on('data', (data) => {
                // Optional: console.log(data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    console.log(`\n✅ Video generated successfully!`);
                    resolve();
                } else {
                    console.error(`FFmpeg Error: Exited with code ${code}`);
                    reject(new Error("FFmpeg failed"));
                }
            });

            // Write Pipe
            const writeImages = async () => {
                for (const file of files) {
                    const filePath = path.join(this.screenshotDir, file);
                    const buffer = fs.readFileSync(filePath);
                    
                    if (!ffmpeg.stdin.write(buffer)) {
                        await new Promise(r => ffmpeg.stdin.once('drain', r));
                    }
                }
                ffmpeg.stdin.end();
            };

            writeImages().catch(err => {
                console.error("Pipe Error:", err);
                ffmpeg.kill();
            });
        });
    }
}

module.exports = VideoGenerator;