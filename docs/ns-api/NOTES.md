# NS API: where real responses differ from the spec

Check these alongside `reisinformatie-openapi.json`.

- **`uicCode` vs `UICCode` on journey stops.** The `Station` schema says `UICCode`, but the
  `stop` of each stop in a `/api/v2/journey` response uses `uicCode`, as the trips response does.
- **`kind` only with `departureUicCode`.** A journey stop only gets `kind: "DEPARTURE"` when the
  request passes `departureUicCode`. Always pass it, and fall back to matching `stop.uicCode`.
- **`numberOfParts` is carriages.** In `actualStock`/`plannedStock`, `numberOfParts` is the number
  of carriages (8 for two 4-carriage VIRM units); the number of units is `len(trainParts)`.
  Stock can differ per stop; later stops may have placeholder stock identifiers (`"0"`).
- **`v3/trips` returns an object.** The response is an object with a `trips` array, although the
  spec says an array.
- **Next page of trips.** Pass `scrollRequestForwardContext` back as the `context` query
  parameter. The spec shows the field on each trip; we read it from the response object, then from
  the last trip. Verify against a real response.

- **Train route.** The train's destination is the leg's `direction` in the trips response. Its
  first stop is the first entry of `stops` in the `/api/v2/journey` response (`stop.name`, with
  `status: "ORIGIN"`); no extra call is needed beyond the one made for the train size.

A real journey response is in `backend/tests/fixtures/ns_journey_3148.json`.

- **`stationType` values.** The spec types `stationType` as a plain string. Real `v2/stations`
  responses use `MEGA_STATION`, `KNOOPPUNT_INTERCITY_STATION`, `INTERCITY_STATION`,
  `KNOOPPUNT_SNELTREIN_STATION`, `SNELTREIN_STATION`, `KNOOPPUNT_STOPTREIN_STATION`,
  `STOPTREIN_STATION` and `FACULTATIEF_STATION` (checked November 2026). Utrecht Centraal is a
  `MEGA_STATION`; station search ranks on this.

- **Train images.** Each entry of `trainParts` in `actualStock`/`plannedStock` has `image.uri`, a
  side view of that unit on `vt.ns-mlab.nl` (e.g. `virmm1_4.png` and `virm_4.png` for two VIRM
  units of one train: the file depends on the subtype, not only `trainType`). The images seen are
  transparent PNGs of 2259 × 119 px per 4-carriage unit (checked November 2026). Placeholder units
  (`stockIdentifier: "0"`) also carry an image.
