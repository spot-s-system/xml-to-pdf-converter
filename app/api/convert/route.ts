import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { convertZipToPdf } from "@/lib/zip-to-pdf";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "ファイルがアップロードされていません" },
        { status: 400 }
      );
    }

    if (!file.name.endsWith(".zip")) {
      return NextResponse.json(
        { error: "ZIPファイルをアップロードしてください" },
        { status: 400 }
      );
    }

    // Read ZIP file
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Extract all files including nested ZIPs
    const files: { [key: string]: string | Buffer } = {};

    for (const [filename, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;

      // Check if this is a nested ZIP
      if (filename.endsWith(".zip")) {
        const nestedZipData = await zipEntry.async("nodebuffer");
        const nestedZip = await JSZip.loadAsync(nestedZipData);

        // Extract nested ZIP contents
        for (const [nestedFilename, nestedEntry] of Object.entries(
          nestedZip.files
        )) {
          if (nestedEntry.dir) continue;

          if (
            nestedFilename.endsWith(".xml") ||
            nestedFilename.endsWith(".xsl")
          ) {
            files[nestedFilename] = await nestedEntry.async("text");
          }
        }
      } else if (filename.endsWith(".xml") || filename.endsWith(".xsl")) {
        files[filename] = await zipEntry.async("text");
      } else if (filename.endsWith(".txt")) {
        files[filename] = await zipEntry.async("text");
      }
    }

    // Convert XML files to PDF
    const pdfBuffer = await convertZipToPdf(files);

    // Create safe filename (encode Japanese characters)
    const originalFilename = file.name.replace(".zip", ".pdf");
    const encodedFilename = encodeURIComponent(originalFilename);

    // Return PDF as download
    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
      },
    });
  } catch (error) {
    console.error("Conversion error:", error);
    return NextResponse.json(
      {
        error: "PDF変換中にエラーが発生しました",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
