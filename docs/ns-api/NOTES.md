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

A real journey response is in `backend/tests/fixtures/ns_journey_3148.json`.
