import type { ClaimDocument, ClaimSection } from "@/lib/bagClaim";

/**
 * The bag claim sheet, as it appears on paper.
 *
 * Server-rendered and print-first, mirroring PrintableItinerary: `.print-sheet`
 * is white-on-black regardless of theme, because a printed page is not a
 * screen. Reusing that class rather than restyling is deliberate -- the two
 * documents should look like they came from the same app.
 *
 * The contents list is a real <table>. A claim form is read by comparing rows
 * against a physical bag, and a table is what gets columns to line up on paper
 * without the browser inventing an alignment. It also prints with the
 * label-style layout airline forms expect.
 */

/** Format an ISO date for a printed page, e.g. "21 Oct 2026". */
function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Section({ section }: { section: ClaimSection }) {
  return (
    <section className="print-section print-avoid-break">
      <h2>{section.categoryName ?? "Other items"}</h2>
      <table className="print-table">
        <thead>
          <tr>
            <th scope="col" className="print-col-item">Item</th>
            <th scope="col" className="print-col-qty">Qty</th>
            {/*
              A blank column for the traveller or the airline to write a value
              in. The app stores no prices, and leaving a ruled space is more
              useful than printing nothing -- this is the field a claim form
              actually requires.
            */}
            <th scope="col" className="print-col-value">Value</th>
          </tr>
        </thead>
        <tbody>
          {section.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.name}</td>
              <td className="print-col-qty">{line.quantity}</td>
              <td className="print-col-value" />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function PrintableBagClaim({ doc }: { doc: ClaimDocument }) {
  const { bag, trip, sections } = doc;

  return (
    <article className="print-sheet">
      <header className="print-header">
        <h1>Baggage claim — {bag.name}</h1>
        <div className="print-header-meta">
          <span>Trip: {trip.name}</span>
          {trip.destination && <span>{trip.destination}</span>}
          {trip.startDate && (
            <span>
              {fmtDate(trip.startDate)}
              {trip.endDate && trip.endDate !== trip.startDate
                ? ` – ${fmtDate(trip.endDate)}`
                : ""}
            </span>
          )}
        </div>
      </header>

      {/*
        The identifying details an airline asks for first. Rendered as a
        definition-like block rather than prose so it can be read off in one
        glance while standing at a desk.
      */}
      <section className="print-section print-avoid-break">
        <h2>Bag details</h2>
        <dl className="print-facts">
          <div>
            <dt>Bag</dt>
            <dd>{bag.name}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{bag.kindLabel}</dd>
          </div>
          <div>
            <dt>Tag number</dt>
            {/*
              An em dash, not an empty cell: "no tag recorded" and "tag number
              left blank by mistake" must look different on a claim form.
            */}
            <dd>{bag.tagNumber || "—"}</dd>
          </div>
          <div>
            <dt>Contents</dt>
            <dd>
              {doc.totalLines} {doc.totalLines === 1 ? "item" : "items"}
              {doc.totalItems !== doc.totalLines ? ` (${doc.totalItems} pieces)` : ""}
            </dd>
          </div>
        </dl>
        {bag.notes && <p className="print-item-notes">{bag.notes}</p>}
      </section>

      {sections.length === 0 ? (
        <section className="print-section">
          <h2>Contents</h2>
          <p className="print-empty">
            No items are recorded as being in this bag. Add them on the packing
            list and assign them to this bag, then print this sheet again.
          </p>
        </section>
      ) : (
        sections.map((section) => (
          <Section key={section.categoryName ?? "__unknown"} section={section} />
        ))
      )}

      {/*
        The caveat goes last and is not optional. This document looks like a
        complete claim packet, and the one thing it cannot contain is what the
        contents were worth. Saying so where it will be read is the difference
        between a form that gets completed and one that gets filed as-is and
        rejected.
      */}
      <footer className="print-footnote">
        <p>{doc.disclaimer}</p>
      </footer>
    </article>
  );
}
