import SaxonJS from "xslt3";

export async function applyXsltTransformation(
  xmlContent: string,
  xslContent: string
): Promise<string> {
  console.log("🔄 XSLT transformation started");

  try {
    // Use SaxonJS to perform XSLT transformation
    const result = await SaxonJS.transform({
      stylesheetText: xslContent,
      sourceText: xmlContent,
      destination: "serialized",
    });

    console.log("✅ XSLT transformation completed");
    return result.principalResult as string;
  } catch (error) {
    console.error("❌ XSLT transformation failed:", error);
    throw new Error(
      `XSLT transformation failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
