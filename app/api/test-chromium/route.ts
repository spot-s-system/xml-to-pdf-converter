import { NextResponse } from 'next/server';

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      message: 'No longer using Chromium - using lightweight libraries instead',
      libraries: {
        xslt: 'xslt3 (SaxonJS)',
        pdf: 'jspdf + jsdom',
      },
    });
  } catch (error) {
    console.error('Test failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
