import { NextResponse } from "next/server";
import { parseItinerary } from "@/lib/itineraryImport";

/**
 * Parse an uploaded itinerary file and report what would be imported.
 *
 * This route only parses — it writes nothing. The client shows the result for
 * confirmation and then creates the trip through the normal mutate API, so a
 * preview can never leave half a trip behind.
 *
 * Accepts multipart/form-data with a `file` field, or a raw HTML body with
 * `?filename=` for scripted use.
 */
export async function POST(req: Request) {
  let html = "";
  let filename = "itinerary.html";

  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (typeof file === "string" || file === null) {
        return NextResponse.json(
          { error: "No file was uploaded. Attach an HTML file in the 'file' field." },
          { status: 400 }
        );
      }
      filename = file.name || filename;
      html = await file.text();
    } else {
      const url = new URL(req.url);
      filename = url.searchParams.get("filename") ?? filename;
      html = await req.text();
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read the upload: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  if (!html.trim()) {
    return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
  }

  // A guard against handing a 200MB HTML file to a regex engine. Itineraries
  // are tens of kilobytes; anything past this is not one.
  const MAX_BYTES = 2_000_000;
  if (html.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${Math.round(html.length / 1000)}KB, which is too large to be an itinerary.` },
      { status: 413 }
    );
  }

  if (!/<html|<body|<section|<div/i.test(html)) {
    return NextResponse.json(
      { error: "That does not look like an HTML file. Upload the exported itinerary page." },
      { status: 400 }
    );
  }

  const parsed = parseItinerary(html);

  // A file with no recognisable sections is the wrong file, not an empty trip.
  if (parsed.reservations.length === 0 && !parsed.trip.startDate) {
    return NextResponse.json(
      {
        error:
          "Could not find any flights, lodging, or dates in that file. Check that it is the exported itinerary page.",
      },
      { status: 422 }
    );
  }

  return NextResponse.json({ filename, ...parsed });
}
