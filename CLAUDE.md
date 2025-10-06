# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 15 application that converts Japanese government document ZIP files (containing XML/XSL pairs) into PDFs. The application:
- Accepts ZIP files (including nested ZIPs) via a drag-and-drop interface
- Extracts and processes XML/XSL document pairs
- Applies XSLT transformations using browser-based XSLTProcessor
- Generates PDFs using Puppeteer with Japanese font support
- Optimizes XSL stylesheets for A4 page rendering

## Commands

### Development
```bash
npm run dev          # Start development server with Turbopack
npm run build        # Build for production with Turbopack
npm start           # Start production server
npm run lint        # Run ESLint
```

### Docker Deployment
```bash
docker build -t xml-to-pdf-converter .
docker run -p 3000:3000 xml-to-pdf-converter
```

The application is configured for deployment on Render using the `render.yaml` configuration.

## Architecture

### Core Conversion Pipeline

The conversion process follows this flow:
1. **API Route** (`app/api/convert/route.ts`): Receives ZIP upload, extracts files (including nested ZIPs)
2. **Document Orchestration** (`lib/zip-to-pdf.ts`): Identifies document types, orders them (kagami first, then notifications), and coordinates conversion
3. **XSL Optimization** (`lib/xsl-adjuster.ts`): Adjusts XSL stylesheets for A4 PDF output
4. **XSLT Transformation** (`lib/xslt-processor.ts`): Transforms XML to HTML using browser-based XSLTProcessor via Puppeteer
5. **PDF Generation** (`lib/pdf-generator.ts`): Renders HTML to PDF using Puppeteer

### Document Types Supported

The system recognizes and processes these Japanese government documents in order:
- **kagami.xml**: Cover page (表紙) - always rendered first
- **7130001.xml**: Standard salary determination notice (標準報酬決定通知書)
- **7200001.xml**: Notice for employees aged 70+ (70歳以上被用者通知書)
- **henrei.xml**: Return ticket (返戻票)
- Generic XML/XSL pairs as fallback

### Key Technical Details

**Puppeteer Configuration:**
- Runs in headless mode with `--no-sandbox` and `--disable-setuid-sandbox` for containerized environments
- Requires Chromium with Japanese font support (configured in Dockerfile)
- Used for both XSLT transformation and PDF generation to ensure consistent rendering

**XSL Adjustments for PDF:**
- Scales dimensions from common government doc width (640px) to A4 width (794px)
- Fixes HTML tags to be XML-compliant (self-closing tags)
- Adds text wrapping for `<pre>` tags
- Inserts A4 page styles with proper margins

**Path Aliases:**
- `@/*` maps to the project root (configured in tsconfig.json)

**Japanese Language Support:**
- UI text is in Japanese
- Dockerfile includes Japanese fonts: `fonts-noto-cjk`, `fonts-ipafont-gothic`, `fonts-ipafont-mincho`
- PDF margins optimized for A4: 5mm top/bottom, 10mm left/right

### Frontend Architecture

- Built with Next.js 15 App Router
- Uses React 19 with client components for interactivity
- UI components from shadcn/ui (Radix UI primitives + Tailwind CSS)
- File upload handled via `FileDropzone` component with drag-and-drop support
- Progress tracking during conversion process

## Development Notes

- TypeScript strict mode is enabled
- The project uses Turbopack for faster builds and dev server
- All conversion logic runs server-side via API routes
- Puppeteer launches new browser instances per transformation/generation (closes after completion)
- Error handling includes detailed Japanese error messages for users
