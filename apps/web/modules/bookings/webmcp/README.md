# WebMCP on the booking page

Opt-in (`NEXT_PUBLIC_WEBMCP_ENABLED=1`). In browsers that support [WebMCP](https://webmachinelearning.github.io/webmcp/), the public booking page registers tools through `document.modelContext` so a browser assistant can work with the page the visitor already has open.

| Tool | What it does |
| --- | --- |
| `get-booking-page` | Event details, durations, locations, timezone, current selection |
| `get-available-slots` | Bookable times; with a `date`, also shows that day on the page |
| `select-time-slot` | Picks a listed time (reserves it like a click) and opens the form |
| `get-booking-form` | The questions the visitor can answer, with current answers and errors |
| `fill-booking-form` | Enters answers; nothing is entered if any answer is invalid |
| `review-booking` | Validates the form and summarizes the booking |

No tool books or reschedules. The visitor confirms with the page's own Confirm button.

