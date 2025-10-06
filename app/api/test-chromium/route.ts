import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer-core';
import chromium_pkg from '@sparticuz/chromium';

export async function GET() {
  try {
    const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';

    const info = {
      environment: {
        VERCEL: process.env.VERCEL,
        NODE_ENV: process.env.NODE_ENV,
        isProduction,
      },
      chromiumArgs: chromium_pkg.args,
    };

    console.log('Test Info:', info);

    // Try to get executable path
    let execPath;
    try {
      execPath = isProduction
        ? await chromium_pkg.executablePath()
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      console.log('✅ Executable path obtained:', execPath);
    } catch (error) {
      console.error('❌ Failed to get executable path:', error);
      throw error;
    }

    // Try to launch browser
    let browserLaunched = false;
    try {
      const browser = await puppeteer.launch({
        args: isProduction ? chromium_pkg.args : [],
        executablePath: execPath,
        headless: true,
      });

      browserLaunched = true;
      console.log('✅ Browser launched successfully');

      await browser.close();
      console.log('✅ Browser closed successfully');
    } catch (error) {
      console.error('❌ Browser launch failed:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      info,
      execPath,
      browserLaunched,
    });
  } catch (error) {
    console.error('Test failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
