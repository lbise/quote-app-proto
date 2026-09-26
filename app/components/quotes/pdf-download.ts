/**
 * Download a PDF from an authenticated endpoint. Returns false when the server
 * refuses or fails, so the caller can explain it instead of opening an error page.
 */
export async function downloadPdf(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { headers: { accept: "application/pdf" } });
    if (!response.ok || response.headers.get("content-type") !== "application/pdf") return false;
    const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "Devis.pdf";
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    // Some mobile browsers read the object URL after the click returns.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  } catch {
    return false;
  }
}
