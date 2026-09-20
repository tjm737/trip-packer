/*
 * Type declaration for airports-json, which ships no types of its own.
 *
 * Only the fields this project reads are declared. The shape mirrors a single
 * OurAirports record; every field is optional because the upstream CSV has
 * blanks (a small strip often has no IATA code, and a closed field has no
 * scheduled service).
 */
declare module "airports-json" {
  export type AirportRecord = {
    id?: string;
    ident?: string;
    type?: string;
    name?: string;
    latitude_deg?: string;
    longitude_deg?: string;
    elevation_ft?: string;
    continent?: string;
    iso_country?: string;
    iso_region?: string;
    municipality?: string;
    scheduled_service?: string;
    gps_code?: string;
    iata_code?: string;
    local_code?: string;
    home_link?: string;
    wikipedia_link?: string;
    keywords?: string;
  };

  const airports: { airports: AirportRecord[] } | AirportRecord[];
  export default airports;
}
