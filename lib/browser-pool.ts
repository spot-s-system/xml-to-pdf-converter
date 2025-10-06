import puppeteer, { Browser } from "puppeteer";

let browserInstance: Browser | null = null;

/**
 * Get or create a shared browser instance
 * Reusing browser instances significantly improves performance
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  console.log("🚀 Launching new browser instance");
  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Optimize memory usage
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
    ],
  });

  // Clean up on process exit
  process.on('exit', async () => {
    if (browserInstance) {
      await browserInstance.close();
    }
  });

  return browserInstance;
}

/**
 * Close the shared browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
