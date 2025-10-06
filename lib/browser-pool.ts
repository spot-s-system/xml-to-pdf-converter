import puppeteer, { Browser } from "puppeteer";

let browserInstance: Browser | null = null;
let requestCount = 0;
// Restart browser after N requests to prevent memory leaks
// Can be configured via MAX_REQUESTS_PER_BROWSER env var (default: 50, Render free tier: 30)
const MAX_REQUESTS_PER_BROWSER = parseInt(process.env.MAX_REQUESTS_PER_BROWSER || "50", 10);

/**
 * Get or create a shared browser instance
 * Reusing browser instances significantly improves performance
 * Automatically restarts browser after MAX_REQUESTS_PER_BROWSER to prevent memory leaks
 */
export async function getBrowser(): Promise<Browser> {
  // Check if we need to restart the browser due to request limit
  if (browserInstance && requestCount >= MAX_REQUESTS_PER_BROWSER) {
    console.log(`♻️ Restarting browser after ${requestCount} requests to prevent memory leaks`);
    await closeBrowser();
  }

  // Create new browser if needed
  if (!browserInstance || !browserInstance.connected) {
    console.log("🚀 Launching new browser instance");
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Optimize memory usage
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
      ],
    });

    requestCount = 0;

    // Clean up on process exit
    process.once('SIGINT', async () => {
      await closeBrowser();
      process.exit(0);
    });

    process.once('SIGTERM', async () => {
      await closeBrowser();
      process.exit(0);
    });
  }

  requestCount++;
  return browserInstance;
}

/**
 * Close the shared browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (error) {
      console.error("Error closing browser:", error);
    } finally {
      browserInstance = null;
      requestCount = 0;
    }
  }
}

/**
 * Get current browser statistics
 */
export function getBrowserStats() {
  return {
    isActive: browserInstance !== null && browserInstance.connected,
    requestCount,
    maxRequests: MAX_REQUESTS_PER_BROWSER,
  };
}
