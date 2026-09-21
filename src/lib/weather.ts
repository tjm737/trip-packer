import { isValidDate } from "./dates";
import { extractAirportCode, lookupAirportCode } from "./airports";

export interface WeatherForecast {
  temperature: number;
  condition: string;
  icon: string;
  precipitation: number;
  windSpeed: number;
  humidity: number;
  daily: DailyWeather[];
}

export interface DailyWeather {
  date: string;
  tempMax: number;
  tempMin: number;
  condition: string;
  icon: string;
  precipitation: number;
}

interface GeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}

// Map WMO weather codes to readable conditions and icons
const WEATHER_MAP: Record<number, { condition: string; icon: string }> = {
  0: { condition: "Clear sky", icon: "☀️" },
  1: { condition: "Mainly clear", icon: "🌤️" },
  2: { condition: "Partly cloudy", icon: "⛅" },
  3: { condition: "Overcast", icon: "☁️" },
  45: { condition: "Foggy", icon: "🌫️" },
  48: { condition: "Icy fog", icon: "🌫️" },
  51: { condition: "Light drizzle", icon: "🌦️" },
  53: { condition: "Drizzle", icon: "🌧️" },
  55: { condition: "Heavy drizzle", icon: "🌧️" },
  56: { condition: "Freezing drizzle", icon: "🌨️" },
  57: { condition: "Heavy freezing drizzle", icon: "🌨️" },
  61: { condition: "Light rain", icon: "🌦️" },
  63: { condition: "Rain", icon: "🌧️" },
  65: { condition: "Heavy rain", icon: "🌧️" },
  66: { condition: "Freezing rain", icon: "🌨️" },
  67: { condition: "Heavy freezing rain", icon: "🌨️" },
  71: { condition: "Light snow", icon: "🌨️" },
  73: { condition: "Snow", icon: "❄️" },
  75: { condition: "Heavy snow", icon: "❄️" },
  77: { condition: "Snow grains", icon: "🌨️" },
  80: { condition: "Light showers", icon: "🌦️" },
  81: { condition: "Showers", icon: "🌧️" },
  82: { condition: "Heavy showers", icon: "🌧️" },
  85: { condition: "Snow showers", icon: "🌨️" },
  86: { condition: "Heavy snow showers", icon: "❄️" },
  95: { condition: "Thunderstorm", icon: "⛈️" },
  96: { condition: "Thunderstorm with hail", icon: "⛈️" },
  99: { condition: "Severe thunderstorm", icon: "⛈️" },
};

function getWeatherInfo(code: number): { condition: string; icon: string } {
  return WEATHER_MAP[code] || { condition: "Unknown", icon: "🌡️" };
}

/**
 * Resolve a destination to coordinates for the weather APIs.
 *
 * Destinations in this app are not always place names. They come from the trip
 * header, which people fill from boarding passes, so they look like "near MUC",
 * "MUC", "LHR (T5)" or "Philadelphia (PHL)". Open-Meteo's geocoder only
 * understands place names: it returns zero results for "near MUC", which made
 * BOTH the forecast and the historical climate panel render empty while the
 * network and the APIs were perfectly healthy.
 *
 * So an airport code is resolved offline against the OurAirports dataset first
 * (the same resolver the map and itinerary already use), and only genuine place
 * names are handed to Open-Meteo. This keeps one lookup path for codes across
 * the app rather than a second, weather-specific one.
 *
 * Returns null when neither path resolves, which callers treat as "no weather".
 */
async function resolveDestination(
  destination: string
): Promise<{ latitude: number; longitude: number } | null> {
  const code = extractAirportCode(destination);
  if (code) {
    const airport = lookupAirportCode(code);
    if (airport) {
      return { latitude: airport.lat, longitude: airport.lng };
    }
  }

  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(destination)}&count=1&language=en`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) return null;
  const geoData = await geoRes.json();
  if (!geoData.results || geoData.results.length === 0) return null;
  const geo = geoData.results[0];
  return { latitude: geo.latitude, longitude: geo.longitude };
}

// Map weather conditions to packing suggestions
interface PackingSuggestion {
  name: string;
  icon: string;
  quantity: number;
  category: string;
}

function getSuggestions(weather: WeatherForecast): PackingSuggestion[] {
  const suggestions: PackingSuggestion[] = [];

  /*
   * Temperature is judged from the highs and the lows SEPARATELY, not from a
   * single average of them.
   *
   * Averaging a trip into one number is what produced "thermal underwear" for a
   * 53F October trip: Munich's typical mid-October is a 62F afternoon and a 45F
   * morning, which averages to 53F and used to land in the cold band. The trip
   * is really mild days with cold mornings - two different packing problems - so
   * daywear is chosen from the highs and the extra layers from the lows.
   *
   * Thresholds are in °F, matching the unit requested from Open-Meteo. These
   * were originally Celsius; if the unit above is ever changed back, these must
   * change with it or every trip reports as freezing.
   */
  const days = weather.daily;
  if (days.length === 0) return suggestions;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const highAvg = mean(days.map((d) => d.tempMax));
  const lowAvg = mean(days.map((d) => d.tempMin));
  const coldestLow = Math.min(...days.map((d) => d.tempMin));
  const warmestHigh = Math.max(...days.map((d) => d.tempMax));

  /*
   * Daytime band: what the average high supports for daytime clothing.
   * HOT  - summer heat, sun protection matters
   * WARM - t-shirts, no jacket needed in the day
   * MILD - a light layer is enough during the day
   * COOL - a real jacket is needed even at the warmest hour
   */
  const HOT_HIGH_F = 86;
  const WARM_HIGH_F = 72;
  const MILD_HIGH_F = 58;
  const COLD_LOW_F = 50; // below this, evenings need real insulation
  const FREEZING_F = 32; // below this, ice and genuine winter gear

  /*
   * Daytime base clothing: what the average high supports.
   *
   * The OUTER LAYER is deliberately not part of this cascade - it is chosen
   * once below. Deciding it in here meant a below-freezing trip needed a fifth
   * branch to override the fourth, and doing that by appending produced two
   * coats ("Warm coat" + "Heavy winter coat") on a 25F trip.
   */
  if (highAvg >= HOT_HIGH_F) {
    suggestions.push(
      { name: "Sunscreen SPF 50+", icon: "☀️", quantity: 1, category: "Toiletries" },
      { name: "Lightweight breathable clothing", icon: "👕", quantity: 4, category: "Clothing" },
      { name: "Wide-brim hat", icon: "👒", quantity: 1, category: "Clothing" },
      { name: "Sunglasses", icon: "🕶️", quantity: 1, category: "Clothing" },
      { name: "Extra water bottle", icon: "🍶", quantity: 1, category: "Miscellaneous" }
    );
  } else if (highAvg >= WARM_HIGH_F) {
    suggestions.push(
      { name: "Short-sleeve shirts", icon: "👕", quantity: 4, category: "Clothing" },
      { name: "Shorts", icon: "🩳", quantity: 2, category: "Clothing" },
      { name: "Sunscreen", icon: "☀️", quantity: 1, category: "Toiletries" },
      { name: "Sunglasses", icon: "🕶️", quantity: 1, category: "Clothing" }
    );
  } else if (highAvg >= MILD_HIGH_F) {
    suggestions.push(
      { name: "Long-sleeve shirts", icon: "👕", quantity: 3, category: "Clothing" },
      { name: "Trousers/jeans", icon: "👖", quantity: 2, category: "Clothing" }
    );
  } else {
    suggestions.push(
      { name: "Long-sleeve shirts", icon: "👕", quantity: 3, category: "Clothing" },
      { name: "Warm sweaters", icon: "🧶", quantity: 2, category: "Clothing" }
    );
  }

  /*
   * The single outer layer, chosen from the warmest part of the day.
   *
   * Below freezing the whole trip is a winter trip, so the heavy coat applies.
   * Otherwise a cool day still needs a real coat; only a genuinely warm one
   * needs no outer layer at all.
   */
  if (highAvg < FREEZING_F) {
    suggestions.push(
      { name: "Heavy winter coat", icon: "🧥", quantity: 1, category: "Clothing" },
      { name: "Insulated boots", icon: "👢", quantity: 1, category: "Clothing" },
      { name: "Hand warmers", icon: "🔥", quantity: 1, category: "Miscellaneous" },
      { name: "Insulated water bottle", icon: "🍶", quantity: 1, category: "Miscellaneous" }
    );
  } else if (highAvg >= MILD_HIGH_F && highAvg < WARM_HIGH_F) {
    suggestions.push({ name: "Light jacket", icon: "🧥", quantity: 1, category: "Clothing" });
  } else if (highAvg < MILD_HIGH_F) {
    suggestions.push({ name: "Warm jacket/coat", icon: "🧥", quantity: 1, category: "Clothing" });
  }

  /*
   * Evening band: driven by the LOWS, which is where a trip's cold actually
   * lives. These stack on top of the daytime items rather than replacing them -
   * the point is "you have warm afternoons, but pack for the evenings".
   *
   * A single cold night is treated as a real risk (coldestLow), because one 38F
   * night still needs an extra layer even if the average low is comfortable.
   */
  if (lowAvg < COLD_LOW_F) {
    suggestions.push(
      { name: "Warm layers for evenings", icon: "🧶", quantity: 2, category: "Clothing" },
      { name: "Scarf", icon: "🧣", quantity: 1, category: "Clothing" }
    );
  }

  /*
   * Thermal base layers and true winter kit are reserved for nights that
   * actually approach or drop below freezing. This is the specific fix: they
   * used to appear for any trip averaging under 68F.
   *
   * Keyed off the coldest single night rather than the average low, so a mild
   * trip with one cold snap still gets the warning.
   */
  if (coldestLow < FREEZING_F) {
    suggestions.push(
      { name: "Thermal base layers", icon: "👕", quantity: 2, category: "Clothing" },
      { name: "Warm hat/beanie", icon: "🧢", quantity: 1, category: "Clothing" },
      { name: "Gloves", icon: "🧤", quantity: 1, category: "Clothing" }
    );
  }

  /*
   * Big swings between day and night need layers rather than a single heavy
   * coat - you shed the outer layer at 1pm and need it again by 8pm.
   */
  if (warmestHigh - coldestLow >= 25) {
    suggestions.push(
      { name: "Zip-up mid-layer", icon: "🧥", quantity: 1, category: "Clothing" }
    );
  }

  // Rain/precipitation suggestions. Thresholds in inches (was 20mm / 0.5mm),
  // now that precipitation_unit=inch is requested.
  const totalPrecip = weather.daily.reduce((sum, d) => sum + d.precipitation, 0);
  if (totalPrecip > 0.8 || weather.precipitation > 0.02) {
    suggestions.push(
      { name: "Waterproof rain jacket", icon: "🧥", quantity: 1, category: "Clothing" },
      { name: "Umbrella", icon: "☂️", quantity: 1, category: "Miscellaneous" },
      { name: "Waterproof shoes/boots", icon: "👟", quantity: 1, category: "Clothing" },
      { name: "Rain cover for backpack", icon: "🎒", quantity: 1, category: "Miscellaneous" },
      { name: "Plastic bags for wet clothes", icon: "📦", quantity: 5, category: "Miscellaneous" }
    );
  }

  // Wind suggestions. Threshold in mph (was 30 km/h), now that
  // windspeed_unit=mph is requested.
  if (weather.windSpeed > 19) {
    suggestions.push(
      { name: "Windproof jacket", icon: "🧥", quantity: 1, category: "Clothing" },
      { name: "Sunglasses (wraparound)", icon: "🕶️", quantity: 1, category: "Clothing" }
    );
  }

  // Snow suggestions
  const snowDays = weather.daily.filter(d => d.icon === "❄️" || d.icon === "🌨️").length;
  if (snowDays > 0) {
    suggestions.push(
      { name: "Snow boots", icon: "👢", quantity: 1, category: "Clothing" },
      { name: "Thermal socks", icon: "🧦", quantity: 3, category: "Clothing" },
      { name: "Balaclava/neck gaiter", icon: "🧣", quantity: 1, category: "Clothing" },
      { name: "Lip balm with SPF", icon: "💋", quantity: 1, category: "Toiletries" }
    );
  }

  return suggestions;
}

/**
 * Packing suggestions for a trip too far out for the forecast, derived from
 * historical climate instead.
 *
 * This exists because suggestions used to be produced ONLY from the 16-day
 * forecast. For a trip further out than that - which is most trips, since
 * they're planned months ahead - the forecast is null, so no suggestions were
 * ever generated and the packing tab silently showed nothing.
 *
 * `avgHigh` / `avgLow` are already averaged across the sampled years, so they
 * stand in for the forecast's per-day highs and lows. The spread between the
 * warmest and coldest sampled year is used as the day/night swing, which is
 * what drives the "pack layers" advice.
 */
export function getClimateSuggestions(climate: ClimateSummary): PackingSuggestion[] {
  /*
   * Build a synthetic day list: one "day" per sampled year, using that year's
   * average high/low. The shared temperature logic then sees a realistic spread
   * across years rather than one flat pair of numbers.
   *
   * `tempMaxPeak` / `tempMinFloor` are the single warmest and coldest readings
   * in the window, so using them as that year's max/min preserves the extremes
   * that drive the "thermal layers" and "pack layers" rules.
   */
  const years = climate.years;
  const daily: DailyWeather[] = years.length
    ? years.map((y) => ({
        date: "",
        tempMax: y.tempMaxPeak,
        tempMin: y.tempMinFloor,
        condition: y.condition,
        icon: "🌡️",
        precipitation: y.precipitationTotal,
      }))
    : [
        {
          date: "",
          tempMax: climate.avgHigh,
          tempMin: climate.avgLow,
          condition: "typical",
          icon: "🌡️",
          precipitation: climate.avgPrecipitation,
        },
      ];

  const suggestions = getSuggestions({
    temperature: climate.avgHigh,
    condition: "typical",
    icon: "🌡️",
    /*
     * The existing rain logic keys off `precipitation`, so a typical wet
     * window produces rain gear through that path. An earlier version of this
     * function added its own umbrella/waterproof block on top, which produced
     * two umbrellas and two waterproof jackets.
     */
    precipitation: climate.avgPrecipitation,
    windSpeed: 0,
    humidity: 0,
    daily,
  });

  return suggestions;
}

/**
 * Open-Meteo's forecast endpoint only reaches 16 days ahead. Beyond that the
 * forecast is meaningless, so the UI shows historical climate instead.
 */
export const MAX_FORECAST_DAYS = 16;

export async function getWeatherForDestination(
  destination: string,
  startDate: string,
  endDate: string
): Promise<WeatherForecast | null> {
  try {
    // Step 1: Resolve the destination (airport code or place name)
    const geo = await resolveDestination(destination);
    if (!geo) return null;

    // Step 2: Fetch weather forecast.
    // Dates are optional and may be missing/invalid — fall back to a 7-day
    // window, and clamp to Open-Meteo's 16-day forecast limit. Without this,
    // an empty endDate produced `forecast_days=NaN` and the request failed.
    let days = 7;
    if (isValidDate(startDate) && isValidDate(endDate)) {
      const span = Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000
      );
      if (Number.isFinite(span)) days = span + 1;
    }
    days = Math.min(MAX_FORECAST_DAYS, Math.max(1, days));
    // Imperial units throughout: the app displays °F / mph / inches. Requesting
    // the unit server-side (rather than converting client-side) keeps the
    // numbers exact and avoids rounding drift.
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max` +
      `&current_weather=true&timezone=auto&forecast_days=${days}` +
      `&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch`;
    const weatherRes = await fetch(weatherUrl);
    if (!weatherRes.ok) return null;
    const weatherData = await weatherRes.json();

    const daily: DailyWeather[] = weatherData.daily.time.map((date: string, i: number) => {
      const info = getWeatherInfo(weatherData.daily.weathercode[i]);
      return {
        date,
        tempMax: weatherData.daily.temperature_2m_max[i],
        tempMin: weatherData.daily.temperature_2m_min[i],
        condition: info.condition,
        icon: info.icon,
        precipitation: weatherData.daily.precipitation_sum[i],
      };
    });

    const currentInfo = getWeatherInfo(weatherData.current_weather.weathercode);

    const forecast: WeatherForecast = {
      temperature: weatherData.current_weather.temperature,
      condition: currentInfo.condition,
      icon: currentInfo.icon,
      precipitation: weatherData.current_weather.precipitation || 0,
      windSpeed: weatherData.current_weather.windspeed,
      humidity: 0, // Open-Meteo free tier doesn't include humidity in current weather
      daily,
    };

    return forecast;
  } catch {
    return null;
  }
}

export { getSuggestions };

/** True when the forecast endpoint's 16-day window can actually reach the trip. */
export function isWithinForecastRange(
  startDate: string,
  endDate: string,
  maxDays = MAX_FORECAST_DAYS
): boolean {
  if (!isValidDate(startDate)) return false;
  const start = new Date(`${startDate}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysOut = Math.floor((start.getTime() - today.getTime()) / 86_400_000);
  // Past trips are also "covered" in the sense that a forecast is meaningless,
  // so only treat future-but-reachable trips as having a usable forecast.
  if (daysOut < 0) return false;
  return daysOut < maxDays;
}

// ---------------------------------------------------------------------------
// Historical climate
// ---------------------------------------------------------------------------

export interface ClimateYear {
  year: number;
  tempMaxAvg: number;
  tempMinAvg: number;
  /** Highest single daily max across the window. */
  tempMaxPeak: number;
  /** Lowest single daily min across the window. */
  tempMinFloor: number;
  precipitationTotal: number;
  /** Days in the window with any measurable precipitation. */
  wetDays: number;
  /** Most common condition in the window. */
  condition: string;
  icon: string;
}

export interface ClimateSummary {
  years: ClimateYear[];
  /** Averages across every sampled year — the "typical" window. */
  avgHigh: number;
  avgLow: number;
  avgPrecipitation: number;
  avgWetDays: number;
  wettestYear: number;
  warmestYear: number;
  coolestYear: number;
  /** Inclusive date window sampled, in the trip's own month/day. */
  windowStart: string;
  windowEnd: string;
  /** How many years the archive actually returned data for. */
  sampledYears: number;
}

/**
 * Fetches the same calendar window from previous years so a trip can be shown
 * against typical conditions rather than the 16-day forecast (which is useless
 * for anything further out).
 *
 * Uses the Open-Meteo archive API, which reports °F / mph / inch with the same
 * unit params as the forecast endpoint. Archive coverage starts in 1945, but we
 * only sample the last `yearsBack` years to keep the payload small and the
 * comparison meaningful against a warming climate.
 */
export async function getHistoricalClimate(
  destination: string,
  startDate: string,
  endDate: string,
  yearsBack = 5
): Promise<ClimateSummary | null> {
  try {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return null;

    // Geocode (same source as the forecast, so coordinates agree)
    const geo = await resolveDestination(destination);
    if (!geo) return null;

    // Sample the same month/day in prior years. A window that runs over a
    // month boundary (or year boundary) is fine because we rebuild the date
    // from the trip's own month/day offsets rather than reusing strings.
    //
    // All date math stays in LOCAL time and is formatted from local parts.
    // Using toISOString() here would shift the window by a day for anyone west
    // of UTC (local midnight is the previous day in UTC).
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (!Number.isFinite(spanDays) || spanDays < 0) return null;

    const localISO = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const thisYear = new Date().getFullYear();

    // Open-Meteo's archive endpoint enforces a CONCURRENCY cap, not just a rate
    // cap: firing all N years at once reliably returns HTTP 429 with
    // {"reason":"Too many concurrent requests"}, which previously made every
    // year resolve to null and the UI claim "no historical data available" when
    // in fact the data exists and we were merely throttled.
    //
    // So: fetch sequentially, and retry a 429 after a short backoff. A handful
    // of years against a cheap endpoint is still well under a second of added
    // latency, and correctness beats the parallel shortcut here.
    const fetchYear = async (yr: number, sd: string, ed: string): Promise<ClimateYear | null> => {
      const url =
        `https://archive-api.open-meteo.com/v1/archive?latitude=${geo.latitude}&longitude=${geo.longitude}` +
        `&start_date=${sd}&end_date=${ed}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode` +
        `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto`;

      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const r = await fetch(url);
          if (r.status === 429) {
            // Throttled — wait and try again rather than discarding the year.
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((res) => setTimeout(res, 1200 * attempt));
              continue;
            }
            return null;
          }
          if (!r.ok) return null;
          const d = await r.json();
          const daily = d?.daily;
          if (!daily?.time?.length) return null;

          const maxes: number[] = daily.temperature_2m_max.filter((v: number | null) => v != null);
          const mins: number[] = daily.temperature_2m_min.filter((v: number | null) => v != null);
          const precips: number[] = daily.precipitation_sum.filter((v: number | null) => v != null);
          if (!maxes.length || !mins.length) return null;

          const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

          // Pick the most common weather code in the window
          const codes: number[] = (daily.weathercode || []).filter((v: number | null) => v != null);
          const counts: Record<number, number> = {};
          for (const c of codes) counts[c] = (counts[c] || 0) + 1;
          let topCode = 0;
          let topCount = -1;
          for (const key of Object.keys(counts)) {
            const c = Number(key);
            if (counts[c] > topCount) { topCount = counts[c]; topCode = c; }
          }
          const info = getWeatherInfo(topCode);

          return {
            year: yr,
            tempMaxAvg: Math.round(avg(maxes) * 10) / 10,
            tempMinAvg: Math.round(avg(mins) * 10) / 10,
            tempMaxPeak: Math.round(Math.max(...maxes)),
            tempMinFloor: Math.round(Math.min(...mins)),
            precipitationTotal: Math.round(precips.reduce((x, y) => x + y, 0) * 100) / 100,
            wetDays: precips.filter((p) => p > 0.01).length,
            condition: info.condition,
            icon: info.icon,
          } satisfies ClimateYear;
        } catch {
          return null;
        }
      }
      return null;
    };

    // Sequential on purpose — see the concurrency note above.
    const results: ClimateYear[] = [];
    for (let i = 1; i <= yearsBack; i++) {
      const yr = thisYear - i;
      const s = new Date(start);
      s.setFullYear(yr);
      const e = new Date(s.getTime() + spanDays * 86_400_000);
      const row = await fetchYear(yr, localISO(s), localISO(e));
      if (row) results.push(row);
    }

    if (results.length === 0) return null;

    results.sort((a, b) => a.year - b.year);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

    const warmest = results.reduce((a, b) => (b.tempMaxAvg > a.tempMaxAvg ? b : a));
    const coolest = results.reduce((a, b) => (b.tempMaxAvg < a.tempMaxAvg ? b : a));
    const wettest = results.reduce((a, b) => (b.precipitationTotal > a.precipitationTotal ? b : a));

    // spanDays is the difference, so the window's last day is spanDays after the start
    const s0 = new Date(`${startDate}T00:00:00`);
    const e0 = new Date(s0.getTime() + spanDays * 86_400_000);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    return {
      years: results,
      avgHigh: Math.round(avg(results.map((r) => r.tempMaxAvg)) * 10) / 10,
      avgLow: Math.round(avg(results.map((r) => r.tempMinAvg)) * 10) / 10,
      avgPrecipitation: Math.round(avg(results.map((r) => r.precipitationTotal)) * 100) / 100,
      avgWetDays: Math.round(avg(results.map((r) => r.wetDays)) * 10) / 10,
      wettestYear: wettest.year,
      warmestYear: warmest.year,
      coolestYear: coolest.year,
      windowStart: fmt(s0),
      windowEnd: fmt(e0),
      sampledYears: results.length,
    };
  } catch {
    return null;
  }
}
