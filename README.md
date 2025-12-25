# ICE - Intel Screenshot Automation

A Puppeteer-based automation tool to capture periodic screenshots of a Intel URL for timelapse generation.

## Setup

1. **Install Node.js** (v20+).
2. **Install dependencies:**
```bash
npm install
```
3. ** Optional: Create a `.env` file** in the root directory to set environment variables (if needed).
```txt
SCREENSHOT_DIR=./screenshots
VIDEO_FPS=30 # Output Video FPS
```

## Usage

**Start the tool:**

```bash
node index.js
```

Follow the on-screen wizard to configure:

* Resolution (Width/Height)
* Interval (Seconds)
* Target URL
* **Mode:** Fixed Count, Duration (`HH:MM`), or Infinite.

## Controls

* **Safe Stop:** Type `stop` and press **ENTER** in the console while running.
* *The tool will finish the current screenshot and close the browser safely.*


## Configuration

Settings are auto-saved to `project.json`.

* To reset, select **"No"** when asked to keep settings on startup.
* To edit specific values, select the corresponding number in the menu.

## Usage Recall (Work in Progress)
Did you forget to run the recorder while playing? No worries! Use this script to simulate past gameplay.  
THE SIMULATION IS VERY BASIC AND MAY NOT ACCURATELY REFLECT ACTUAL GAMEPLAY!  

**Start the tool:**

```bash
node index_recall.js

```
