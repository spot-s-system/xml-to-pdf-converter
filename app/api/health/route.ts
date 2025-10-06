import { NextResponse } from "next/server";
import { getBrowserStats } from "@/lib/browser-pool";

export async function GET() {
  const memoryUsage = process.memoryUsage();
  const browserStats = getBrowserStats();

  return NextResponse.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
    },
    browser: {
      isActive: browserStats.isActive,
      requestCount: browserStats.requestCount,
      maxRequests: browserStats.maxRequests,
      recycleAt: browserStats.maxRequests - browserStats.requestCount,
    },
    uptime: `${Math.round(process.uptime())}s`,
  });
}
